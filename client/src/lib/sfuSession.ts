// Conexão com o SFU (mediasoup) do servidor Waver.
//
// Na malha cada pessoa envia uma cópia da sua mídia para cada outra; aqui cada fonte (microfone, câmera,
// tela, áudio da tela) sobe UMA vez para o servidor, que repassa para os outros. Esta classe cuida só do
// transporte: captura, DSP do microfone, detecção de fala etc. continuam no WebRTCManager.
import { Device, types as ms } from 'mediasoup-client';
import { Socket } from 'socket.io-client';

export type SfuSource = 'mic' | 'cam' | 'screen' | 'screen-audio';

export interface SfuJoinInfo {
  enabled: boolean;
  routerRtpCapabilities?: ms.RtpCapabilities;
}

export interface SfuSessionCallbacks {
  onTrack: (socketId: string, source: SfuSource, track: MediaStreamTrack, consumerId: string) => void;
  onTrackEnded: (socketId: string, source: SfuSource, consumerId: string) => void;
  onStateChange: (state: RTCPeerConnectionState) => void;
  /** os dois transportes falharam e não voltaram com reinício de ICE */
  onFatal: (reason: string) => void;
}

interface ProducerInfo {
  producerId: string;
  socketId: string;
  source: SfuSource;
  kind: 'audio' | 'video';
}

interface ConsumerEntry {
  consumer: ms.Consumer;
  socketId: string;
  source: SfuSource;
}

export interface SfuProduceOptions {
  encodings?: ms.RtpEncodingParameters[];
  codecOptions?: ms.ProducerCodecOptions;
  /** ordem de preferência de codec (ex.: ['video/VP8']) */
  preferCodecs?: string[];
}

const isScreenSource = (s: SfuSource) => s === 'screen' || s === 'screen-audio';

let supportCache: boolean | null = null;

/** Este runtime consegue usar o SFU? (o servidor só liga o SFU numa call se todos disserem que sim) */
export function sfuSupported(): boolean {
  if (supportCache !== null) return supportCache;
  try {
    if (typeof RTCPeerConnection === 'undefined') {
      supportCache = false;
    } else {
      new Device();
      supportCache = true;
    }
  } catch {
    supportCache = false;
  }
  return supportCache;
}

const REQUEST_TIMEOUT_MS = 10_000;

export class SfuSession {
  private device: Device | null = null;
  private sendTransport: ms.Transport | null = null;
  private recvTransport: ms.Transport | null = null;
  private producers = new Map<SfuSource, ms.Producer>();
  /** produce em andamento por fonte (evita dois producers da mesma fonte) */
  private producing = new Map<SfuSource, Promise<ms.Producer | null>>();
  private consumers = new Map<string, ConsumerEntry>();
  private consumedProducers = new Set<string>();
  /** pessoas cuja transmissão eu parei de assistir */
  private unwatched = new Set<string>();
  private closed = false;
  private readyPromise: Promise<void> | null = null;
  private iceRestartTimers = new Map<string, number>();
  private iceRestartAttempts = new Map<string, number>();
  private state: RTCPeerConnectionState = 'new';

  constructor(
    private socket: Socket,
    private iceServers: RTCIceServer[],
    private callbacks: SfuSessionCallbacks
  ) {}

  get connectionState(): RTCPeerConnectionState {
    return this.state;
  }

  get isClosed() {
    return this.closed;
  }

  private async request<T = Record<string, unknown>>(event: string, data: unknown = {}): Promise<T> {
    if (this.closed) throw new Error('SFU fechado');
    const res = (await this.socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck(event, data)) as T & { error?: string };
    if (res && typeof res === 'object' && res.error) throw new Error(res.error);
    return res;
  }

  /** Carrega o Device, abre os dois transportes e começa a receber o que já está sendo enviado na call. */
  start(routerRtpCapabilities: ms.RtpCapabilities): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.socket.on('sfu:new-producer', this.handleNewProducer);
    this.socket.on('sfu:consumer-closed', this.handleConsumerClosed);
    this.readyPromise = (async () => {
      const device = new Device();
      await device.load({ routerRtpCapabilities });
      if (this.closed) throw new Error('SFU fechado');
      this.device = device;
      this.sendTransport = await this.createTransport('send');
      this.recvTransport = await this.createTransport('recv');
      const { producers } = await this.request<{ producers: ProducerInfo[] }>('sfu:get-producers');
      for (const p of producers || []) this.consume(p).catch((err) => console.warn('[SFU] consume:', err));
    })();
    return this.readyPromise;
  }

  private async createTransport(direction: 'send' | 'recv'): Promise<ms.Transport> {
    const info = await this.request<{
      id: string;
      iceParameters: ms.IceParameters;
      iceCandidates: ms.IceCandidate[];
      dtlsParameters: ms.DtlsParameters;
    }>('sfu:create-transport', { direction });
    if (!this.device || this.closed) throw new Error('SFU fechado');
    const opts: ms.TransportOptions = {
      id: info.id,
      iceParameters: info.iceParameters,
      iceCandidates: info.iceCandidates,
      dtlsParameters: info.dtlsParameters,
      // TURN do servidor ajuda quando a rede bloqueia UDP direto até o SFU
      iceServers: this.iceServers,
    };
    const transport = direction === 'send' ? this.device.createSendTransport(opts) : this.device.createRecvTransport(opts);

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.request('sfu:connect-transport', { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch((err) => errback(err));
    });

    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        this.request<{ id: string }>('sfu:produce', { transportId: transport.id, kind, rtpParameters, appData })
          .then(({ id }) => callback({ id }))
          .catch((err) => errback(err));
      });
    }

    transport.on('connectionstatechange', (state) => {
      this.onTransportState(transport, state);
    });
    return transport;
  }

  private onTransportState(transport: ms.Transport, state: string) {
    if (this.closed) return;
    const pending = this.iceRestartTimers.get(transport.id);
    if (state === 'connected') {
      if (pending) window.clearTimeout(pending);
      this.iceRestartTimers.delete(transport.id);
      this.iceRestartAttempts.delete(transport.id);
    } else if ((state === 'disconnected' || state === 'failed') && !pending) {
      // troca de rede / Wi-Fi oscilando: espera um pouco e renegocia a rota com o servidor
      const attempts = this.iceRestartAttempts.get(transport.id) || 0;
      if (attempts >= 5) {
        if (state === 'failed') this.callbacks.onFatal('não foi possível reconectar ao servidor de mídia');
      } else {
        const delay = state === 'failed' ? 500 : 3000;
        const timer = window.setTimeout(() => {
          this.iceRestartTimers.delete(transport.id);
          if (this.closed || transport.closed) return;
          if (transport.connectionState === 'connected') return;
          this.iceRestartAttempts.set(transport.id, attempts + 1);
          this.restartTransportIce(transport).catch(() => {});
        }, delay);
        this.iceRestartTimers.set(transport.id, timer);
      }
    }
    this.updateState();
  }

  private updateState() {
    const states = [this.sendTransport?.connectionState, this.recvTransport?.connectionState].filter(Boolean) as string[];
    let next: RTCPeerConnectionState = 'connected';
    if (states.includes('failed')) next = 'failed';
    else if (states.includes('disconnected')) next = 'disconnected';
    else if (states.includes('connecting') || states.includes('checking')) next = 'connecting';
    else if (!this.device) next = 'connecting';
    // "new" = transporte ainda sem mídia (ninguém enviando): está tudo certo com o servidor
    if (next !== this.state) {
      this.state = next;
      this.callbacks.onStateChange(next);
    }
  }

  private async restartTransportIce(transport: ms.Transport) {
    const { iceParameters } = await this.request<{ iceParameters: ms.IceParameters }>('sfu:restart-ice', {
      transportId: transport.id,
    });
    await transport.restartIce({ iceParameters });
  }

  /** Reinicia o ICE dos dois transportes (rede trocou). */
  restartIce() {
    for (const t of [this.sendTransport, this.recvTransport]) {
      if (t && !t.closed) this.restartTransportIce(t).catch(() => {});
    }
  }

  private pickCodec(kind: 'audio' | 'video', prefer?: string[]): ms.RtpCodecCapability | undefined {
    if (!this.device || !prefer?.length) return undefined;
    const codecs = (this.device.rtpCapabilities.codecs || []).filter((c) => c.kind === kind);
    for (const mime of prefer) {
      const found = codecs.find((c) => c.mimeType.toLowerCase() === mime.toLowerCase());
      if (found) return found;
    }
    return undefined;
  }

  /** Começa a enviar uma fonte (ou troca a faixa, se ela já está sendo enviada). */
  async produce(source: SfuSource, track: MediaStreamTrack, opts: SfuProduceOptions = {}): Promise<ms.Producer | null> {
    if (!this.readyPromise) throw new Error('SFU não iniciado');
    await this.readyPromise;
    const inFlight = this.producing.get(source);
    if (inFlight) await inFlight.catch(() => null);
    if (this.closed || !this.sendTransport) return null;

    const existing = this.producers.get(source);
    if (existing && !existing.closed) {
      if (existing.track !== track) await existing.replaceTrack({ track });
      return existing;
    }
    const kind = track.kind === 'audio' ? 'audio' : 'video';
    const p = this.sendTransport
      .produce({
        track,
        encodings: opts.encodings,
        codecOptions: opts.codecOptions,
        codec: this.pickCodec(kind, opts.preferCodecs),
        // a faixa é do WebRTCManager (DSP do microfone, câmera...): ele que para quando quiser
        stopTracks: false,
        appData: { source },
      })
      .then((producer) => {
        if (this.closed) {
          producer.close();
          return null;
        }
        this.producers.set(source, producer);
        producer.on('transportclose', () => {
          if (this.producers.get(source) === producer) this.producers.delete(source);
        });
        return producer;
      })
      .finally(() => this.producing.delete(source));
    this.producing.set(source, p);
    return p;
  }

  async replaceTrack(source: SfuSource, track: MediaStreamTrack) {
    const producer = this.producers.get(source);
    if (producer && !producer.closed) await producer.replaceTrack({ track });
  }

  async closeProducer(source: SfuSource) {
    const inFlight = this.producing.get(source);
    if (inFlight) await inFlight.catch(() => null);
    const producer = this.producers.get(source);
    if (!producer) return;
    this.producers.delete(source);
    const id = producer.id;
    producer.close();
    this.request('sfu:close-producer', { producerId: id }).catch(() => {});
  }

  getProducer(source: SfuSource): ms.Producer | null {
    const p = this.producers.get(source);
    return p && !p.closed ? p : null;
  }

  getConsumers(): ConsumerEntry[] {
    return Array.from(this.consumers.values());
  }

  /** Pausa o envio de uma fonte (ninguém está assistindo): o navegador para de codificar e de subir. */
  setProducerPaused(source: SfuSource, paused: boolean) {
    const p = this.producers.get(source);
    if (!p || p.closed || p.paused === paused) return;
    try {
      if (paused) p.pause();
      else p.resume();
    } catch {}
  }

  /** Para (ou volta a) receber a tela e o áudio da tela de uma pessoa. Pausado, o servidor não manda nada. */
  setScreenWatching(socketId: string, watching: boolean) {
    if (watching === !this.unwatched.has(socketId)) return;
    if (watching) this.unwatched.delete(socketId);
    else this.unwatched.add(socketId);
    for (const entry of this.consumers.values()) {
      if (entry.socketId !== socketId || !isScreenSource(entry.source)) continue;
      const id = entry.consumer.id;
      if (watching) {
        entry.consumer.resume();
        this.request('sfu:resume-consumer', { consumerId: id }).catch(() => {});
      } else {
        entry.consumer.pause();
        this.request('sfu:pause-consumer', { consumerId: id }).catch(() => {});
      }
    }
  }

  /** Simulcast: escolhe a camada (0 = menor) que o servidor manda desta câmera para mim. */
  setPreferredLayers(consumerId: string, spatialLayer: number) {
    this.request('sfu:set-layers', { consumerId, spatialLayer }).catch(() => {});
  }

  private handleNewProducer = (info: ProducerInfo) => {
    if (this.closed || !this.readyPromise) return;
    this.readyPromise
      .then(() => this.consume(info))
      .catch((err) => console.warn('[SFU] consume:', err));
  };

  private handleConsumerClosed = ({ consumerId }: { consumerId: string }) => {
    const entry = this.consumers.get(consumerId);
    if (!entry) return;
    this.consumers.delete(consumerId);
    this.consumedProducers.delete(entry.consumer.producerId);
    entry.consumer.close();
    this.callbacks.onTrackEnded(entry.socketId, entry.source, consumerId);
  };

  private async consume(info: ProducerInfo) {
    if (this.closed || !this.device || !this.recvTransport) return;
    if (this.consumedProducers.has(info.producerId)) return;
    this.consumedProducers.add(info.producerId);
    try {
      const res = await this.request<{
        id: string;
        producerId: string;
        kind: 'audio' | 'video';
        rtpParameters: ms.RtpParameters;
        socketId: string;
        source: SfuSource;
      }>('sfu:consume', { producerId: info.producerId, rtpCapabilities: this.device.rtpCapabilities });
      if (this.closed || !this.recvTransport) return;
      const consumer = await this.recvTransport.consume({
        id: res.id,
        producerId: res.producerId,
        kind: res.kind,
        rtpParameters: res.rtpParameters,
        appData: { socketId: res.socketId, source: res.source },
      });
      const entry: ConsumerEntry = { consumer, socketId: res.socketId, source: res.source };
      this.consumers.set(consumer.id, entry);
      consumer.on('transportclose', () => {
        if (this.consumers.delete(consumer.id)) this.callbacks.onTrackEnded(entry.socketId, entry.source, consumer.id);
      });
      try {
        const rec = consumer.rtpReceiver as (RTCRtpReceiver & { jitterBufferTarget?: number }) | undefined;
        if (rec && 'jitterBufferTarget' in rec) rec.jitterBufferTarget = 0;
      } catch {}
      this.callbacks.onTrack(res.socketId, res.source, consumer.track, consumer.id);
      // saiu da transmissão desta pessoa: o consumer fica pausado no servidor (nada chega até eu voltar)
      if (isScreenSource(res.source) && this.unwatched.has(res.socketId)) return;
      await this.request('sfu:resume-consumer', { consumerId: consumer.id });
    } catch (err) {
      this.consumedProducers.delete(info.producerId);
      throw err;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.socket.off('sfu:new-producer', this.handleNewProducer);
    this.socket.off('sfu:consumer-closed', this.handleConsumerClosed);
    for (const t of this.iceRestartTimers.values()) window.clearTimeout(t);
    this.iceRestartTimers.clear();
    for (const p of this.producers.values()) {
      try {
        p.close();
      } catch {}
    }
    this.producers.clear();
    for (const { consumer } of this.consumers.values()) {
      try {
        consumer.close();
      } catch {}
    }
    this.consumers.clear();
    this.consumedProducers.clear();
    try {
      this.sendTransport?.close();
      this.recvTransport?.close();
    } catch {}
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
  }
}
