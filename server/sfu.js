// SFU opcional (mediasoup) para chamadas com muita gente.
//
// Na malha (mesh) cada pessoa envia uma cópia do seu áudio/vídeo para cada outra pessoa da call; com 6+
// pessoas o upload de casa satura. Com o SFU cada um envia UMA vez para o servidor e o servidor repassa.
//
// Ligado só quando PULSECORD_SFU=1 (todas as calls) ou PULSECORD_SFU=auto (calls com mais de
// PULSECORD_SFU_MIN_PEERS pessoas). Se o mediasoup não estiver instalado/compilado (ex.: host dentro do
// app Electron no Windows) ou não conseguir abrir as portas, fica tudo na malha, sem erro para o usuário.
import os from 'node:os';

const SOURCES = new Set(['mic', 'cam', 'screen', 'screen-audio']);
const SOURCE_KIND = { mic: 'audio', 'screen-audio': 'audio', cam: 'video', screen: 'video' };

const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  // VP8 primeiro: é o codec com simulcast mais confiável (câmera)
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
  { kind: 'video', mimeType: 'video/VP9', clockRate: 90000, parameters: { 'profile-id': 0, 'x-google-start-bitrate': 1000 } },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1, 'x-google-start-bitrate': 1000 },
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: { 'packetization-mode': 1, 'profile-level-id': '4d0032', 'level-asymmetry-allowed': 1, 'x-google-start-bitrate': 1000 },
  },
];

function parseMode(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (['1', 'on', 'true', 'yes', 'sempre', 'always'].includes(v)) return 'on';
  if (v === 'auto') return 'auto';
  return 'off';
}

function intOr(raw, fallback) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Primeiro IPv4/IPv6 "de verdade" desta máquina (para anunciar aos clientes quando nada foi configurado). */
function detectAddresses() {
  let ipv4 = '';
  let ipv6 = '';
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal) continue;
      if (a.family === 'IPv4' || a.family === 4) {
        if (!ipv4 && !a.address.startsWith('169.254.')) ipv4 = a.address;
      } else if (a.family === 'IPv6' || a.family === 6) {
        const low = a.address.toLowerCase();
        // global: sem link-local (fe80), ULA (fc/fd) e endereços temporários de privacidade não aparecem aqui
        if (!ipv6 && !low.startsWith('fe80') && !low.startsWith('fc') && !low.startsWith('fd') && low !== '::1') ipv6 = a.address;
      }
    }
  }
  return { ipv4, ipv6 };
}

export function readSfuConfig(options = {}, env = process.env) {
  const mode = parseMode(options.mode ?? env.PULSECORD_SFU);
  const detected = mode === 'off' ? { ipv4: '', ipv6: '' } : detectAddresses();
  const pick = (opt, envVal, det) => {
    const v = String(opt ?? envVal ?? '').trim();
    if (v.toLowerCase() === 'off' || v === '-') return '';
    return v || det;
  };
  const minPort = intOr(options.rtcMinPort ?? env.PULSECORD_SFU_RTC_MIN_PORT, 40000);
  const maxPort = intOr(options.rtcMaxPort ?? env.PULSECORD_SFU_RTC_MAX_PORT, 40999);
  return {
    mode,
    // auto: a call vira SFU quando passa deste número de pessoas
    minPeers: Math.max(1, intOr(options.minPeers ?? env.PULSECORD_SFU_MIN_PEERS, 4)),
    announcedIpv4: pick(options.announcedIpv4, env.PULSECORD_SFU_ANNOUNCED_IPV4, detected.ipv4),
    announcedIpv6: pick(options.announcedIpv6, env.PULSECORD_SFU_ANNOUNCED_IPV6, detected.ipv6),
    listenIpv4: String(options.listenIpv4 ?? env.PULSECORD_SFU_LISTEN_IPV4 ?? '0.0.0.0').trim() || '0.0.0.0',
    listenIpv6: String(options.listenIpv6 ?? env.PULSECORD_SFU_LISTEN_IPV6 ?? '::').trim() || '::',
    minPort,
    maxPort,
    enableTcp: String(options.enableTcp ?? env.PULSECORD_SFU_TCP ?? '1') !== '0',
    workers: Math.max(1, Math.min(os.cpus().length || 1, intOr(options.workers ?? env.PULSECORD_SFU_WORKERS, 1))),
    // bitrate máximo que cada pessoa pode enviar ao SFU (todas as fontes juntas)
    maxIncomingBitrate: intOr(options.maxIncomingBitrate ?? env.PULSECORD_SFU_MAX_INCOMING_KBPS, 30000) * 1000,
    logLevel: String(env.PULSECORD_SFU_LOG_LEVEL || 'warn'),
  };
}

/**
 * @param {object} deps
 * @param {(socketId: string, event: string, payload: unknown) => void} deps.emitTo
 * @param {(socketId: string) => string | undefined} deps.getSocketChannel canal de voz atual do socket
 * @param {(channelId: string, reason: string) => void} deps.onRoomClosed o SFU caiu: a call volta para a malha
 * @param {object} [deps.options] sobrepõe as variáveis de ambiente (testes)
 */
export function createSfuManager({ emitTo, getSocketChannel, onRoomClosed, options = {} }) {
  const config = readSfuConfig(options);
  const log = (...a) => console.log('[SFU]', ...a);
  const warn = (...a) => console.warn('[SFU]', ...a);

  let mediasoup = null;
  let available = false;
  let unavailableReason = config.mode === 'off' ? 'desligado (PULSECORD_SFU)' : 'iniciando';
  let closing = false;
  const workers = []; // { worker, rooms: number }
  let nextWorker = 0;
  /** channelId -> { router, worker, peers: Map<socketId, Peer>, closed } */
  const rooms = new Map();
  const roomPromises = new Map();

  function listenInfos() {
    const portRange = { min: config.minPort, max: config.maxPort };
    const infos = [];
    const protocols = config.enableTcp ? ['udp', 'tcp'] : ['udp'];
    for (const protocol of protocols) {
      if (config.announcedIpv4) {
        infos.push({ protocol, ip: config.listenIpv4, announcedAddress: config.announcedIpv4, portRange });
      }
      if (config.announcedIpv6) {
        // socket só IPv6: o IPv4 já tem o seu, e os dois podem usar o mesmo número de porta
        infos.push({ protocol, ip: config.listenIpv6, announcedAddress: config.announcedIpv6, portRange, flags: { ipv6Only: true } });
      }
    }
    return infos;
  }

  async function spawnWorker() {
    const worker = await mediasoup.createWorker({ logLevel: config.logLevel });
    const entry = { worker, rooms: 0 };
    worker.on('died', (err) => {
      warn('worker do mediasoup morreu:', err?.message || err);
      const idx = workers.indexOf(entry);
      if (idx !== -1) workers.splice(idx, 1);
      for (const [channelId, room] of rooms) {
        if (room.worker === worker) {
          closeRoom(channelId);
          onRoomClosed?.(channelId, 'worker-died');
        }
      }
      if (!closing) {
        setTimeout(() => {
          if (closing) return;
          spawnWorker()
            .then((e) => workers.push(e))
            .catch((e) => {
              warn('não foi possível recriar o worker:', e?.message || e);
              if (workers.length === 0) {
                available = false;
                unavailableReason = 'worker morreu e não voltou';
              }
            });
        }, 2000);
      }
    });
    return entry;
  }

  async function init() {
    if (config.mode === 'off') return publicInfo();
    try {
      mediasoup = await import('mediasoup');
    } catch (err) {
      unavailableReason = 'mediasoup não instalado/compilado nesta máquina';
      log(`${unavailableReason}; chamadas continuam em malha (P2P). (${err?.code || err?.message || err})`);
      return publicInfo();
    }
    if (!config.announcedIpv4 && !config.announcedIpv6) {
      unavailableReason = 'nenhum IP para anunciar (defina PULSECORD_SFU_ANNOUNCED_IPV4/IPV6)';
      warn(unavailableReason + '; chamadas continuam em malha.');
      return publicInfo();
    }
    try {
      for (let i = 0; i < config.workers; i++) workers.push(await spawnWorker());
      // teste: abre um transporte de verdade nas portas configuradas; se falhar, desliga já aqui,
      // e não no meio de alguém entrando na call
      const router = await workers[0].worker.createRouter({ mediaCodecs: MEDIA_CODECS });
      try {
        const t = await router.createWebRtcTransport({ listenInfos: listenInfos(), preferUdp: true });
        const cands = t.iceCandidates.map((c) => `${c.protocol}/${c.address}:${c.port}`).join(', ');
        t.close();
        log(`pronto: modo ${config.mode}${config.mode === 'auto' ? ` (> ${config.minPeers} pessoas)` : ''}, ` +
          `portas ${config.minPort}-${config.maxPort}, candidatos de teste: ${cands}`);
      } finally {
        router.close();
      }
      available = true;
      unavailableReason = '';
    } catch (err) {
      unavailableReason = `falha ao abrir o SFU: ${err?.message || err}`;
      warn(unavailableReason + '; chamadas continuam em malha.');
      for (const w of workers.splice(0)) {
        try {
          w.worker.close();
        } catch {}
      }
      available = false;
    }
    return publicInfo();
  }

  function publicInfo() {
    return {
      mode: config.mode,
      available,
      minPeers: config.minPeers,
      reason: available ? undefined : unavailableReason,
      rooms: rooms.size,
    };
  }

  /** Esta call (com `count` pessoas) deve usar o SFU? */
  function shouldUseFor(count) {
    if (!available) return false;
    if (config.mode === 'on') return true;
    if (config.mode === 'auto') return count > config.minPeers;
    return false;
  }

  function hasRoom(channelId) {
    return rooms.has(channelId);
  }

  async function ensureRoom(channelId) {
    const existing = rooms.get(channelId);
    if (existing) return existing.router.rtpCapabilities;
    if (!available || workers.length === 0) throw new Error('SFU indisponível');
    let p = roomPromises.get(channelId);
    if (!p) {
      p = (async () => {
        const entry = workers[nextWorker++ % workers.length];
        const router = await entry.worker.createRouter({ mediaCodecs: MEDIA_CODECS, appData: { channelId } });
        const room = { router, worker: entry.worker, entry, peers: new Map(), closed: false };
        entry.rooms += 1;
        rooms.set(channelId, room);
        log(`call ${channelId} agora usa o SFU`);
        return room;
      })().finally(() => roomPromises.delete(channelId));
      roomPromises.set(channelId, p);
    }
    const room = await p;
    return room.router.rtpCapabilities;
  }

  function closeRoom(channelId) {
    const room = rooms.get(channelId);
    if (!room) return;
    rooms.delete(channelId);
    room.closed = true;
    room.entry.rooms = Math.max(0, room.entry.rooms - 1);
    try {
      room.router.close(); // fecha transportes, producers e consumers
    } catch {}
    log(`call ${channelId} saiu do SFU`);
  }

  function removePeer(channelId, socketId) {
    const room = rooms.get(channelId);
    const peer = room?.peers.get(socketId);
    if (!peer) return;
    room.peers.delete(socketId);
    for (const t of peer.transports.values()) {
      try {
        t.close(); // fecha os producers dele -> os consumers dos outros recebem 'producerclose'
      } catch {}
    }
  }

  function getPeer(socket, create = false) {
    const channelId = getSocketChannel(socket.id);
    const room = channelId ? rooms.get(channelId) : null;
    if (!room) return { channelId, room: null, peer: null };
    let peer = room.peers.get(socket.id);
    if (!peer && create) {
      peer = { socketId: socket.id, transports: new Map(), producers: new Map(), consumers: new Map(), sendTransportId: '', recvTransportId: '' };
      room.peers.set(socket.id, peer);
    }
    return { channelId, room, peer };
  }

  function handler(fn) {
    return async (payload, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      try {
        reply(await fn(payload || {}));
      } catch (err) {
        reply({ error: err?.message || String(err) });
      }
    };
  }

  function attachSocket(socket) {
    socket.on(
      'sfu:create-transport',
      handler(async ({ direction }) => {
        const { room, peer } = getPeer(socket, true);
        if (!room || !peer) throw new Error('Esta call não está usando o SFU.');
        const dir = direction === 'send' ? 'send' : 'recv';
        // um transporte de cada direção por pessoa: se pedir de novo (reconexão), troca o antigo
        const oldId = dir === 'send' ? peer.sendTransportId : peer.recvTransportId;
        if (oldId) {
          peer.transports.get(oldId)?.close();
          peer.transports.delete(oldId);
        }
        const transport = await room.router.createWebRtcTransport({
          listenInfos: listenInfos(),
          preferUdp: true,
          // começa alto: sem isto a tela/câmera recebida começa borrada e demora a subir
          initialAvailableOutgoingBitrate: 3_000_000,
          appData: { socketId: socket.id, direction: dir },
        });
        if (room.closed || !room.peers.has(socket.id)) {
          transport.close();
          throw new Error('Saiu da call.');
        }
        if (dir === 'send' && config.maxIncomingBitrate > 0) {
          await transport.setMaxIncomingBitrate(config.maxIncomingBitrate).catch(() => {});
        }
        peer.transports.set(transport.id, transport);
        if (dir === 'send') peer.sendTransportId = transport.id;
        else peer.recvTransportId = transport.id;
        transport.observer.on('close', () => peer.transports.delete(transport.id));
        return {
          ok: true,
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };
      })
    );

    socket.on(
      'sfu:connect-transport',
      handler(async ({ transportId, dtlsParameters }) => {
        const { peer } = getPeer(socket);
        const transport = peer?.transports.get(transportId);
        if (!transport) throw new Error('Transporte não encontrado.');
        await transport.connect({ dtlsParameters });
        return { ok: true };
      })
    );

    socket.on(
      'sfu:restart-ice',
      handler(async ({ transportId }) => {
        const { peer } = getPeer(socket);
        const transport = peer?.transports.get(transportId);
        if (!transport) throw new Error('Transporte não encontrado.');
        const iceParameters = await transport.restartIce();
        return { ok: true, iceParameters };
      })
    );

    socket.on(
      'sfu:produce',
      handler(async ({ transportId, kind, rtpParameters, appData }) => {
        const { channelId, room, peer } = getPeer(socket);
        const transport = peer?.transports.get(transportId);
        if (!room || !transport || transportId !== peer.sendTransportId) throw new Error('Transporte de envio não encontrado.');
        const source = String(appData?.source || '');
        if (!SOURCES.has(source) || SOURCE_KIND[source] !== kind) throw new Error('Fonte de mídia inválida.');
        // uma fonte de cada tipo por pessoa (trocar de câmera reaproveita o producer no cliente)
        const old = peer.producers.get(source);
        if (old) {
          old.close();
          peer.producers.delete(source);
        }
        const producer = await transport.produce({ kind, rtpParameters, appData: { socketId: socket.id, source } });
        peer.producers.set(source, producer);
        producer.observer.on('close', () => {
          if (peer.producers.get(source) === producer) peer.producers.delete(source);
        });
        const info = { channelId, producerId: producer.id, socketId: socket.id, source, kind };
        for (const other of room.peers.values()) {
          if (other.socketId !== socket.id) emitTo(other.socketId, 'sfu:new-producer', info);
        }
        return { ok: true, id: producer.id };
      })
    );

    socket.on(
      'sfu:close-producer',
      handler(async ({ producerId }) => {
        const { peer } = getPeer(socket);
        if (!peer) return { ok: true };
        for (const [source, p] of peer.producers) {
          if (p.id === producerId) {
            p.close();
            peer.producers.delete(source);
          }
        }
        return { ok: true };
      })
    );

    socket.on(
      'sfu:get-producers',
      handler(async () => {
        const { room } = getPeer(socket);
        if (!room) throw new Error('Esta call não está usando o SFU.');
        const list = [];
        for (const other of room.peers.values()) {
          if (other.socketId === socket.id) continue;
          for (const [source, p] of other.producers) {
            if (!p.closed) list.push({ producerId: p.id, socketId: other.socketId, source, kind: p.kind });
          }
        }
        return { ok: true, producers: list };
      })
    );

    socket.on(
      'sfu:consume',
      handler(async ({ producerId, rtpCapabilities }) => {
        const { room, peer } = getPeer(socket);
        const transport = peer?.transports.get(peer?.recvTransportId);
        if (!room || !transport) throw new Error('Transporte de recebimento não encontrado.');
        let producer = null;
        for (const other of room.peers.values()) {
          for (const p of other.producers.values()) if (p.id === producerId) producer = p;
        }
        if (!producer || producer.appData.socketId === socket.id) throw new Error('Mídia não encontrada.');
        if (!room.router.canConsume({ producerId, rtpCapabilities })) throw new Error('Codec incompatível.');
        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          // começa pausado: o cliente monta o player e pede para continuar (vídeo já chega com quadro-chave)
          paused: true,
          appData: { socketId: socket.id, source: producer.appData.source, producerSocketId: producer.appData.socketId },
        });
        peer.consumers.set(consumer.id, consumer);
        consumer.observer.on('close', () => peer.consumers.delete(consumer.id));
        consumer.on('producerclose', () => {
          emitTo(socket.id, 'sfu:consumer-closed', { consumerId: consumer.id, producerId });
        });
        return {
          ok: true,
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          type: consumer.type,
          rtpParameters: consumer.rtpParameters,
          socketId: producer.appData.socketId,
          source: producer.appData.source,
        };
      })
    );

    socket.on(
      'sfu:resume-consumer',
      handler(async ({ consumerId }) => {
        const { peer } = getPeer(socket);
        const consumer = peer?.consumers.get(consumerId);
        if (!consumer) throw new Error('Consumer não encontrado.');
        await consumer.resume();
        return { ok: true };
      })
    );

    // "Parar de assistir": o servidor deixa de mandar esta mídia para mim (não gasta banda nenhuma)
    socket.on(
      'sfu:pause-consumer',
      handler(async ({ consumerId }) => {
        const { peer } = getPeer(socket);
        const consumer = peer?.consumers.get(consumerId);
        if (!consumer) throw new Error('Consumer não encontrado.');
        await consumer.pause();
        return { ok: true };
      })
    );

    socket.on(
      'sfu:set-layers',
      handler(async ({ consumerId, spatialLayer, temporalLayer }) => {
        const { peer } = getPeer(socket);
        const consumer = peer?.consumers.get(consumerId);
        if (!consumer || (consumer.type !== 'simulcast' && consumer.type !== 'svc')) return { ok: true };
        const layers = { spatialLayer: Math.max(0, Math.min(2, Number(spatialLayer) || 0)) };
        if (Number.isInteger(temporalLayer)) layers.temporalLayer = Math.max(0, Math.min(2, temporalLayer));
        await consumer.setPreferredLayers(layers);
        return { ok: true };
      })
    );
  }

  /** Contagem e bytes por pessoa (usado no teste e no diagnóstico). */
  async function getRoomStats(channelId) {
    const room = rooms.get(channelId);
    if (!room) return null;
    const out = [];
    const bytesOf = async (obj, type) => {
      let bytes = 0;
      for (const s of await obj.getStats()) if (s.type === type) bytes += Number(s.byteCount || 0);
      return bytes;
    };
    for (const peer of room.peers.values()) {
      const producers = [];
      for (const [source, p] of peer.producers) producers.push({ source, kind: p.kind, type: p.type, bytes: await bytesOf(p, 'inbound-rtp') });
      const consumers = [];
      for (const c of peer.consumers.values()) {
        consumers.push({ source: c.appData.source, from: c.appData.producerSocketId, type: c.type, paused: c.paused, bytes: await bytesOf(c, 'outbound-rtp') });
      }
      out.push({ socketId: peer.socketId, producers, consumers });
    }
    return out;
  }

  async function close() {
    closing = true;
    for (const id of Array.from(rooms.keys())) closeRoom(id);
    for (const w of workers.splice(0)) {
      try {
        w.worker.close();
      } catch {}
    }
    available = false;
  }

  return {
    config,
    init,
    close,
    publicInfo,
    get available() {
      return available;
    },
    shouldUseFor,
    hasRoom,
    ensureRoom,
    closeRoom,
    removePeer,
    attachSocket,
    getRoomStats,
  };
}
