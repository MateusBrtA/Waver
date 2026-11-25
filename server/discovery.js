import dgram from 'node:dgram';
import os from 'node:os';

export const DISCOVERY_PORT = 41234;
const PROBE_MAGIC = 'PULSECORD_DISCOVER_V1';
const ANNOUNCE_TYPE = 'PULSECORD_SERVER_V1';

export function computeBroadcastAddress(ip, netmask) {
  const ipParts = String(ip).split('.').map(Number);
  const maskParts = String(netmask).split('.').map(Number);
  if (ipParts.length !== 4 || maskParts.length !== 4) return null;
  if (ipParts.some(Number.isNaN) || maskParts.some(Number.isNaN)) return null;
  return ipParts.map((oct, i) => (oct | (~maskParts[i] & 255)) >>> 0).join('.');
}

export function getAllBroadcastTargets() {
  const targets = new Set(['255.255.255.255']);
  const interfaces = os.networkInterfaces();
  for (const infos of Object.values(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family === 'IPv4' && !info.internal && info.netmask) {
        const bcast = computeBroadcastAddress(info.address, info.netmask);
        if (bcast) targets.add(bcast);
      }
    }
  }
  return Array.from(targets);
}

export function getLocalIpv4Set() {
  const set = new Set(['127.0.0.1']);
  const interfaces = os.networkInterfaces();
  for (const infos of Object.values(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family === 'IPv4') set.add(info.address);
    }
  }
  return set;
}

export function startLanAdvertiser(getPayload) {
  let socket = null;
  let interval = null;
  let closed = false;

  try {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', (err) => {
      console.warn('[LAN Discovery] Advertiser warning:', err.message);
    });

    const buildPacket = () => {
      const payload = getPayload();
      return Buffer.from(
        JSON.stringify({
          type: ANNOUNCE_TYPE,
          ...payload,
        })
      );
    };

    socket.on('message', (msg, rinfo) => {
      if (closed) return;
      if (msg.toString('utf8').trim() === PROBE_MAGIC) {
        const packet = buildPacket();
        socket.send(packet, rinfo.port, rinfo.address, () => {});
      }
    });

    const broadcastOnce = () => {
      if (closed || !socket) return;
      const packet = buildPacket();
      for (const target of getAllBroadcastTargets()) {
        socket.send(packet, DISCOVERY_PORT, target, () => {});
      }
    };

    socket.bind(DISCOVERY_PORT, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // ignore
      }
      broadcastOnce();
      interval = setInterval(broadcastOnce, 2500);
    });
  } catch (err) {
    console.warn('[LAN Discovery] Failed to start advertiser:', err.message);
  }

  return {
    broadcastNow() {
      if (closed || !socket) return;
      try {
        const packet = Buffer.from(JSON.stringify({ type: ANNOUNCE_TYPE, ...getPayload() }));
        for (const target of getAllBroadcastTargets()) {
          socket.send(packet, DISCOVERY_PORT, target, () => {});
        }
      } catch {
        // ignore
      }
    },
    stop() {
      closed = true;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (socket) {
        try {
          socket.close();
        } catch {
          // ignore
        }
        socket = null;
      }
    },
  };
}

export function startLanScanner(onServersChanged) {
  const servers = new Map(); // instanceId -> server entry
  let closed = false;
  let listenSocket = null;
  let probeSocket = null;
  let probeTimer = null;
  let pruneTimer = null;

  const emitList = () => {
    const list = Array.from(servers.values())
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map(({ lastSeen: _ls, ...rest }) => rest);
    onServersChanged(list);
  };

  const handlePacket = (msg, rinfo) => {
    if (closed) return;
    try {
      const data = JSON.parse(msg.toString('utf8'));
      if (data?.type !== ANNOUNCE_TYPE || !data.instanceId || !data.port) return;

      const localIps = getLocalIpv4Set();
      const reachableIp = rinfo.address && rinfo.address !== '0.0.0.0' ? rinfo.address : data.primaryIp || '127.0.0.1';
      const isSelf = localIps.has(reachableIp);

      let networkLabel = 'Rede Local (LAN)';
      if (isSelf) networkLabel = 'Este PC (Local)';
      else if (reachableIp.startsWith('26.')) networkLabel = 'Radmin VPN';
      else if (reachableIp.startsWith('100.')) networkLabel = 'Tailscale / VPN';

      const prev = servers.get(data.instanceId);
      const next = {
        id: data.instanceId,
        serverName: String(data.serverName || 'PulseCord'),
        hostName: String(data.hostName || ''),
        ip: reachableIp,
        port: Number(data.port),
        url: `http://${reachableIp}:${data.port}`,
        hasPassword: Boolean(data.hasPassword),
        onlineCount: Number(data.onlineCount || 0),
        networkLabel,
        isSelf,
        lastSeen: Date.now(),
      };

      const changed =
        !prev ||
        prev.serverName !== next.serverName ||
        prev.ip !== next.ip ||
        prev.port !== next.port ||
        prev.hasPassword !== next.hasPassword ||
        prev.onlineCount !== next.onlineCount;

      servers.set(data.instanceId, next);
      if (changed) emitList();
    } catch {
      // Ignore unrelated UDP traffic
    }
  };

  const sendProbe = () => {
    if (closed || !probeSocket) return;
    const buf = Buffer.from(PROBE_MAGIC);
    const targets = new Set([...getAllBroadcastTargets(), '127.0.0.1']);
    for (const target of targets) {
      probeSocket.send(buf, DISCOVERY_PORT, target, () => {});
    }
  };

  try {
    // Ephemeral socket for guaranteed unicast replies from hosts (even on same PC!)
    probeSocket = dgram.createSocket('udp4');
    probeSocket.on('error', () => {});
    probeSocket.on('message', handlePacket);
    probeSocket.bind(0, () => {
      try {
        probeSocket.setBroadcast(true);
      } catch {
        // ignore
      }
      sendProbe();
      probeTimer = setInterval(sendProbe, 3000);
    });

    // Passive listener on DISCOVERY_PORT to also catch periodic LAN beacons
    listenSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    listenSocket.on('error', () => {});
    listenSocket.on('message', handlePacket);
    listenSocket.bind(DISCOVERY_PORT, () => {
      try {
        listenSocket.setBroadcast(true);
      } catch {
        // ignore
      }
    });

    pruneTimer = setInterval(() => {
      const now = Date.now();
      let removed = false;
      for (const [id, entry] of servers.entries()) {
        if (now - entry.lastSeen > 8500) {
          servers.delete(id);
          removed = true;
        }
      }
      if (removed) emitList();
    }, 2500);
  } catch (err) {
    console.warn('[LAN Discovery] Failed to start scanner:', err.message);
  }

  return {
    scanNow: sendProbe,
    getServers() {
      return Array.from(servers.values()).map(({ lastSeen: _ls, ...rest }) => rest);
    },
    stop() {
      closed = true;
      if (probeTimer) clearInterval(probeTimer);
      if (pruneTimer) clearInterval(pruneTimer);
      try {
        probeSocket?.close();
      } catch {}
      try {
        listenSocket?.close();
      } catch {}
    },
  };
}
