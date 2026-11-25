const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const cors = require('cors');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_PEER_DISCOVERY_PORT = 41235;
const PROBE_MAGIC = 'PULSECORD_PEER_PROBE_V1';
const ANNOUNCE_TYPE = 'PULSECORD_PEER_V1';

function computeBroadcastAddress(ip, netmask) {
  const ipParts = String(ip).split('.').map(Number);
  const maskParts = String(netmask).split('.').map(Number);
  if (ipParts.length !== 4 || maskParts.length !== 4) return null;
  if (ipParts.some(Number.isNaN) || maskParts.some(Number.isNaN)) return null;
  return ipParts.map((oct, i) => (oct | (~maskParts[i] & 255)) >>> 0).join('.');
}

function getBroadcastTargets() {
  const targets = new Set(['255.255.255.255']);
  const interfaces = os.networkInterfaces();
  for (const infos of Object.values(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family === 'IPv4' && !info.internal && info.netmask) {
        const b = computeBroadcastAddress(info.address, info.netmask);
        if (b) targets.add(b);
      }
    }
  }
  return Array.from(targets);
}

function getPreferredLocalIpv4() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family === 'IPv4' && !info.internal) {
        let prio = 3;
        if (info.address.startsWith('26.')) prio = 1; // Radmin VPN
        else if (info.address.startsWith('192.168.') || info.address.startsWith('10.')) prio = 2;
        candidates.push({ name, address: info.address, prio });
      }
    }
  }
  candidates.sort((a, b) => a.prio - b.prio);
  return candidates[0]?.address || '127.0.0.1';
}

function getOrCreatePeerId(userDataDir) {
  const idFile = path.join(userDataDir, '.peer-id');
  try {
    if (fs.existsSync(idFile)) {
      const existing = fs.readFileSync(idFile, 'utf8').trim();
      if (existing) return existing;
    }
  } catch {}
  const fresh = `peer-${crypto.randomBytes(8).toString('hex')}`;
  try {
    fs.writeFileSync(idFile, fresh, 'utf8');
  } catch {}
  return fresh;
}

class LanPeerMessenger {
  constructor(options = {}) {
    this.userDataDir = options.userDataDir || path.join(os.tmpdir(), `pulsecord-peer-${process.pid}`);
    fs.mkdirSync(this.userDataDir, { recursive: true });
    this.filesDir = path.join(this.userDataDir, 'lan-dm-files');
    fs.mkdirSync(this.filesDir, { recursive: true });

    this.preferredPort = Number(options.port || 0);
    this.discoveryPort = Number(options.discoveryPort || DEFAULT_PEER_DISCOVERY_PORT);
    this.enableDiscovery = options.enableDiscovery !== false;
    this.peerId = options.peerId || getOrCreatePeerId(this.userDataDir);

    this.callbacks = {
      onPeersUpdated: options.onPeersUpdated || null,
      onDmMessage: options.onDmMessage || null,
      onDmPinned: options.onDmPinned || null,
      onCallIncoming: options.onCallIncoming || null,
      onCallResponded: options.onCallResponded || null,
      onGroupUpdated: options.onGroupUpdated || null,
      onGroupMessage: options.onGroupMessage || null,
      onGroupPinned: options.onGroupPinned || null,
      onTrelloUpdated: options.onTrelloUpdated || null,
    };

    this.identity = {
      peerId: this.peerId,
      username: 'pulsecord_user',
      displayName: 'Usuário PulseCord',
      avatarColor: '#5865F2',
      avatarDataUrl: '',
      bannerColor: '#5865F2',
      bio: '',
      statusType: 'online',
      customStatusEmoji: '',
      customStatusText: '',
      currentActivity: null,
    };

    this.port = 0;
    this.httpServer = null;
    this.io = null;
    this.listenSocket = null;
    this.probeSocket = null;
    this.beaconTimer = null;
    this.probeTimer = null;
    this.pruneTimer = null;
    this.peers = new Map(); // peerId -> peer meta

    // 1-on-1 & Group P2P Call Signaling Room States (when calling directly over LAN without a server)
    this.voiceRooms = new Map();
    this.socketVoiceChannel = new Map();
    this.videoStates = new Map();
    this.musicStates = new Map();
    this.whiteboardStates = new Map();
    this.groups = new Map();
    this.trelloBoards = new Map();
    this.groupsFile = path.join(this.userDataDir, 'lan-groups.json');
    this.trelloFile = path.join(this.userDataDir, 'lan-trello.json');
    this.loadLocalCollections();
    this._mediaResolverPromise = null;
  }

  loadLocalCollections() {
    try {
      if (fs.existsSync(this.groupsFile)) {
        const list = JSON.parse(fs.readFileSync(this.groupsFile, 'utf8'));
        if (Array.isArray(list)) {
          for (const g of list) if (g?.id) this.groups.set(g.id, g);
        }
      }
    } catch {}
    try {
      if (fs.existsSync(this.trelloFile)) {
        const map = JSON.parse(fs.readFileSync(this.trelloFile, 'utf8'));
        if (map && typeof map === 'object') {
          for (const [k, v] of Object.entries(map)) {
            if (Array.isArray(v)) this.trelloBoards.set(k, v);
          }
        }
      }
    } catch {}
  }

  persistLocalGroups() {
    try {
      fs.writeFileSync(this.groupsFile, JSON.stringify(Array.from(this.groups.values())), 'utf8');
    } catch {}
  }

  persistLocalTrello() {
    try {
      const obj = Object.fromEntries(this.trelloBoards.entries());
      fs.writeFileSync(this.trelloFile, JSON.stringify(obj), 'utf8');
    } catch {}
  }

  getGroupsList() {
    return Array.from(this.groups.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  getTrelloBoards(scopeKey) {
    return this.trelloBoards.get(scopeKey) || [];
  }

  async getMediaResolver() {
    if (!this._mediaResolverPromise) {
      const modUrl = pathToFileURL(path.join(__dirname, '..', 'server', 'mediaResolver.js')).href;
      this._mediaResolverPromise = import(modUrl);
    }
    return this._mediaResolverPromise;
  }

  getSelfInfo() {
    const primaryIp = getPreferredLocalIpv4();
    return {
      peerId: this.peerId,
      username: this.identity.username,
      displayName: this.identity.displayName,
      avatarColor: this.identity.avatarColor,
      avatarUrl: this.identity.avatarDataUrl ? `/p2p/avatar/${this.peerId}` : null,
      bannerColor: this.identity.bannerColor,
      bio: this.identity.bio,
      statusType: this.identity.statusType,
      customStatusEmoji: this.identity.customStatusEmoji,
      customStatusText: this.identity.customStatusText,
      currentActivity: this.identity.currentActivity,
      ip: primaryIp,
      p2pPort: this.port,
      p2pUrl: this.port ? `http://127.0.0.1:${this.port}` : '',
      shareUrl: this.port ? `http://${primaryIp}:${this.port}` : '',
    };
  }

  updateIdentity(partial = {}) {
    this.identity = {
      ...this.identity,
      ...partial,
      peerId: this.peerId,
    };
    this.broadcastBeaconNow();
    return this.getSelfInfo();
  }

  getPeersList() {
    return Array.from(this.peers.values())
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map(({ lastSeen: _ls, ...rest }) => rest);
  }

  emitPeers() {
    this.callbacks.onPeersUpdated?.(this.getPeersList());
  }

  buildBeaconPayload() {
    return Buffer.from(
      JSON.stringify({
        type: ANNOUNCE_TYPE,
        peerId: this.peerId,
        username: this.identity.username,
        displayName: this.identity.displayName,
        avatarColor: this.identity.avatarColor,
        hasAvatar: Boolean(this.identity.avatarDataUrl),
        bannerColor: this.identity.bannerColor,
        bio: this.identity.bio,
        statusType: this.identity.statusType,
        customStatusEmoji: this.identity.customStatusEmoji,
        customStatusText: this.identity.customStatusText,
        currentActivity: this.identity.currentActivity,
        p2pPort: this.port,
        primaryIp: getPreferredLocalIpv4(),
      })
    );
  }

  broadcastBeaconNow() {
    if (!this.enableDiscovery || !this.port) return;
    const sock = this.listenSocket || this.probeSocket;
    if (!sock) return;
    try {
      const pkt = this.buildBeaconPayload();
      for (const target of [...getBroadcastTargets(), '127.0.0.1']) {
        sock.send(pkt, this.discoveryPort, target, () => {});
      }
    } catch {}
  }

  scanNow() {
    if (!this.enableDiscovery || !this.probeSocket) return;
    try {
      const magic = Buffer.from(PROBE_MAGIC);
      for (const target of [...getBroadcastTargets(), '127.0.0.1']) {
        this.probeSocket.send(magic, this.discoveryPort, target, () => {});
      }
    } catch {}
  }

  async start() {
    if (this.httpServer) return this.getSelfInfo();

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '15mb' }));

    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, this.filesDir),
      filename: (req, file, cb) => {
        const forcedName = req.headers['x-p2p-filekey'] ? path.basename(String(req.headers['x-p2p-filekey'])) : '';
        if (forcedName && /^[a-zA-Z0-9._-]+$/.test(forcedName)) {
          return cb(null, forcedName);
        }
        const ext = path.extname(file.originalname || '') || '.bin';
        cb(null, `${uuidv4()}${ext}`);
      },
    });
    const upload = multer({ storage, limits: { fileSize: 64 * 1024 * 1024 } });

    app.get('/p2p/info', (_req, res) => {
      res.json(this.getSelfInfo());
    });

    app.get('/p2p/avatar/:peerId?', (_req, res) => {
      const dataUrl = this.identity.avatarDataUrl || '';
      const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
      if (!m) return res.status(404).end();
      res.setHeader('Content-Type', m[1]);
      res.setHeader('Cache-Control', 'no-cache');
      res.send(Buffer.from(m[2], 'base64'));
    });

    app.get('/p2p/files/:filename', (req, res) => {
      const safe = path.basename(req.params.filename || '');
      const full = path.join(this.filesDir, safe);
      if (!fs.existsSync(full)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.sendFile(full);
    });

    app.post('/p2p/upload', upload.single('file'), (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'Arquivo ausente.' });
      res.status(201).json({
        fileKey: req.file.filename,
        url: `/p2p/files/${req.file.filename}`,
        size: req.file.size,
      });
    });

    app.post('/p2p/dm', (req, res) => {
      const { message, fromPeer } = req.body || {};
      if (!message || !message.id) return res.status(400).json({ error: 'Mensagem inválida.' });
      if (fromPeer?.peerId && fromPeer.peerId !== this.peerId) {
        this.upsertPeerFromHttp(fromPeer, req.ip);
      }
      this.callbacks.onDmMessage?.({ message, fromPeerId: fromPeer?.peerId || message.authorId });
      res.json({ ok: true });
    });

    app.post('/p2p/pin', (req, res) => {
      const { peerId, pairKey, messageId, pinned, pinnedAt, pinnedBy } = req.body || {};
      if (!messageId) return res.status(400).json({ error: 'messageId obrigatório.' });
      this.callbacks.onDmPinned?.({
        peerId,
        pairKey,
        messageId,
        pinned: Boolean(pinned),
        pinnedAt: pinnedAt || null,
        pinnedBy: pinnedBy || null,
      });
      res.json({ ok: true });
    });

    app.post('/p2p/call-invite', (req, res) => {
      const { dmRoomId, callServerUrl, fromPeer, group } = req.body || {};
      if (!dmRoomId || !callServerUrl || !fromPeer?.peerId) {
        return res.status(400).json({ error: 'Convite inválido.' });
      }
      this.upsertPeerFromHttp(fromPeer, req.ip);
      if (group?.id) {
        this.groups.set(group.id, { ...group, isLanP2p: true, hostP2pUrl: fromPeer.p2pUrl || `http://${req.ip}:${fromPeer.p2pPort}` });
        this.persistLocalGroups();
        this.callbacks.onGroupUpdated?.({ group: this.groups.get(group.id) });
      }
      this.callbacks.onCallIncoming?.({ dmRoomId, callServerUrl, fromPeer, group });
      res.json({ ok: true });
    });

    app.post('/p2p/group-sync', (req, res) => {
      const { group, fromPeer } = req.body || {};
      if (!group?.id) return res.status(400).json({ error: 'Grupo inválido.' });
      if (fromPeer?.peerId) this.upsertPeerFromHttp(fromPeer, req.ip);
      const nextGroup = { ...group, isLanP2p: true };
      this.groups.set(nextGroup.id, nextGroup);
      this.persistLocalGroups();
      this.callbacks.onGroupUpdated?.({ group: nextGroup });
      res.json({ ok: true });
    });

    app.post('/p2p/group-message', (req, res) => {
      const { groupId, message, fromPeer } = req.body || {};
      if (!groupId || !message?.id) return res.status(400).json({ error: 'Mensagem de grupo inválida.' });
      if (fromPeer?.peerId) this.upsertPeerFromHttp(fromPeer, req.ip);
      this.callbacks.onGroupMessage?.({ groupId, message });
      res.json({ ok: true });
    });

    app.post('/p2p/group-pin', (req, res) => {
      const { groupId, messageId, pinned, pinnedAt, pinnedBy } = req.body || {};
      if (!groupId || !messageId) return res.status(400).json({ error: 'Dados inválidos.' });
      this.callbacks.onGroupPinned?.({
        groupId,
        messageId,
        pinned: Boolean(pinned),
        pinnedAt: pinnedAt || null,
        pinnedBy: pinnedBy || null,
      });
      res.json({ ok: true });
    });

    app.post('/p2p/trello-sync', (req, res) => {
      const { scopeKey, boards, fromPeer } = req.body || {};
      if (!scopeKey || !Array.isArray(boards)) return res.status(400).json({ error: 'Quadro Trello inválido.' });
      if (fromPeer?.peerId) this.upsertPeerFromHttp(fromPeer, req.ip);
      this.trelloBoards.set(scopeKey, boards);
      this.persistLocalTrello();
      this.callbacks.onTrelloUpdated?.({ scopeKey, boards });
      res.json({ ok: true });
    });

    app.post('/p2p/call-respond', (req, res) => {
      const { dmRoomId, accepted, fromPeer } = req.body || {};
      this.callbacks.onCallResponded?.({
        dmRoomId,
        accepted: Boolean(accepted),
        fromPeer,
      });
      res.json({ ok: true });
    });

    app.get('/api/media/stream/:id', async (req, res) => {
      try {
        const mr = await this.getMediaResolver();
        await mr.streamResolvedMedia(req.params.id, req, res, this.userDataDir);
      } catch {
        res.status(404).end();
      }
    });

    app.get('/api/media/yt-embed/:videoId', (req, res) => {
      const vid = String(req.params.videoId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!vid) return res.status(400).send('Invalid video id');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildYoutubeEmbedHtml(vid));
    });

    this.httpServer = http.createServer(app);
    this.io = new Server(this.httpServer, {
      cors: { origin: '*' },
      maxHttpBufferSize: 10 * 1024 * 1024,
    });

    this.attachCallSignaling();

    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(this.preferredPort, '0.0.0.0', () => resolve());
    });
    this.port = this.httpServer.address().port;

    if (this.enableDiscovery) {
      this.startUdpDiscovery();
    }

    return this.getSelfInfo();
  }

  upsertPeerFromHttp(fromPeer, reqIp) {
    if (!fromPeer?.peerId || fromPeer.peerId === this.peerId) return;
    const cleanIp = String(reqIp || '').replace(/^::ffff:/, '') || fromPeer.ip || '127.0.0.1';
    const ip = cleanIp === '::1' ? '127.0.0.1' : cleanIp;
    const p2pPort = Number(fromPeer.p2pPort || 0);
    if (!p2pPort) return;
    this.peers.set(fromPeer.peerId, {
      peerId: fromPeer.peerId,
      username: fromPeer.username || fromPeer.peerId,
      displayName: fromPeer.displayName || 'Amigo LAN',
      avatarColor: fromPeer.avatarColor || '#5865F2',
      avatarUrl: fromPeer.hasAvatar ? `http://${ip}:${p2pPort}/p2p/avatar` : null,
      bannerColor: fromPeer.bannerColor || '#5865F2',
      bio: fromPeer.bio || '',
      statusType: fromPeer.statusType || 'online',
      customStatusEmoji: fromPeer.customStatusEmoji || '',
      customStatusText: fromPeer.customStatusText || '',
      currentActivity: fromPeer.currentActivity || null,
      ip,
      p2pPort,
      p2pUrl: `http://${ip}:${p2pPort}`,
      online: true,
      lastSeen: Date.now(),
    });
    this.emitPeers();
  }

  startUdpDiscovery() {
    const handlePacket = (msg, rinfo) => {
      const str = msg.toString('utf8').trim();
      if (str === PROBE_MAGIC) {
        try {
          const pkt = this.buildBeaconPayload();
          this.listenSocket?.send(pkt, rinfo.port, rinfo.address, () => {});
        } catch {}
        return;
      }
      try {
        const data = JSON.parse(str);
        if (data?.type !== ANNOUNCE_TYPE || !data.peerId || data.peerId === this.peerId || !data.p2pPort) return;
        const ip = rinfo.address && rinfo.address !== '0.0.0.0' ? rinfo.address : data.primaryIp || '127.0.0.1';
        const prev = this.peers.get(data.peerId);
        const next = {
          peerId: data.peerId,
          username: String(data.username || data.peerId),
          displayName: String(data.displayName || 'Amigo LAN'),
          avatarColor: data.avatarColor || '#5865F2',
          avatarUrl: data.hasAvatar ? `http://${ip}:${data.p2pPort}/p2p/avatar` : null,
          bannerColor: data.bannerColor || '#5865F2',
          bio: String(data.bio || ''),
          statusType: data.statusType || 'online',
          customStatusEmoji: data.customStatusEmoji || '',
          customStatusText: data.customStatusText || '',
          currentActivity: data.currentActivity || null,
          ip,
          p2pPort: Number(data.p2pPort),
          p2pUrl: `http://${ip}:${data.p2pPort}`,
          online: true,
          lastSeen: Date.now(),
        };
        const changed =
          !prev ||
          prev.displayName !== next.displayName ||
          prev.ip !== next.ip ||
          prev.p2pPort !== next.p2pPort ||
          prev.statusType !== next.statusType ||
          prev.customStatusText !== next.customStatusText ||
          prev.avatarUrl !== next.avatarUrl ||
          (prev.currentActivity?.name || '') !== (next.currentActivity?.name || '');
        this.peers.set(data.peerId, next);
        if (changed) this.emitPeers();
      } catch {}
    };

    try {
      this.probeSocket = dgram.createSocket('udp4');
      this.probeSocket.on('error', () => {});
      this.probeSocket.on('message', handlePacket);
      this.probeSocket.bind(0, () => {
        try { this.probeSocket.setBroadcast(true); } catch {}
        this.scanNow();
        this.probeTimer = setInterval(() => this.scanNow(), 3000);
      });

      this.listenSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.listenSocket.on('error', () => {});
      this.listenSocket.on('message', handlePacket);
      this.listenSocket.bind(this.discoveryPort, () => {
        try { this.listenSocket.setBroadcast(true); } catch {}
        this.broadcastBeaconNow();
        this.beaconTimer = setInterval(() => this.broadcastBeaconNow(), 3000);
      });

      this.pruneTimer = setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [id, p] of this.peers.entries()) {
          if (now - p.lastSeen > 9500) {
            this.peers.delete(id);
            changed = true;
          }
        }
        if (changed) this.emitPeers();
      }, 3000);
    } catch (err) {
      console.warn('[LAN P2P] UDP discovery warning:', err?.message);
    }
  }

  attachCallSignaling() {
    const getOrCreateVideo = (ch) => {
      if (!this.videoStates.has(ch)) {
        this.videoStates.set(ch, { queue: [], currentIndex: -1, isPlaying: false, positionSec: 0, updatedAt: Date.now(), seq: 0, lastAction: 'init' });
      }
      return this.videoStates.get(ch);
    };
    const broadcastVideo = (ch) => {
      const s = getOrCreateVideo(ch);
      const now = Date.now();
      const livePos = s.isPlaying && s.currentIndex >= 0 ? s.positionSec + Math.max(0, (now - s.updatedAt) / 1000) : s.positionSec;
      this.io.to(`voice:${ch}`).emit('video:state', { ...s, channelId: ch, positionSec: livePos, updatedAt: now, serverNow: now });
    };
    const getOrCreateMusic = (ch) => {
      if (!this.musicStates.has(ch)) {
        this.musicStates.set(ch, { queue: [], currentIndex: -1, isPlaying: false, positionSec: 0, updatedAt: Date.now(), loopMode: 'none', seq: 0, lastAction: 'init' });
      }
      return this.musicStates.get(ch);
    };
    const broadcastMusic = (ch) => {
      const s = getOrCreateMusic(ch);
      const now = Date.now();
      const livePos = s.isPlaying && s.currentIndex >= 0 ? s.positionSec + Math.max(0, (now - s.updatedAt) / 1000) : s.positionSec;
      this.io.to(`voice:${ch}`).emit('music:state', { ...s, channelId: ch, positionSec: livePos, updatedAt: now, serverNow: now });
    };

    const leaveCurrentVoice = (socket) => {
      const prevCh = this.socketVoiceChannel.get(socket.id);
      if (!prevCh) return;
      this.socketVoiceChannel.delete(socket.id);
      socket.leave(`voice:${prevCh}`);
      const room = this.voiceRooms.get(prevCh);
      if (room) {
        room.delete(socket.id);
        this.io.to(`voice:${prevCh}`).emit('voice:peer-left', { channelId: prevCh, socketId: socket.id });
        this.io.to(`voice:${prevCh}`).emit('dm:voice-participants', Array.from(room.values()));
        if (room.size === 0) this.voiceRooms.delete(prevCh);
      }
    };

    this.io.on('connection', (socket) => {
      const q = socket.handshake.auth || {};
      socket.data.user = {
        userId: String(q.userId || uuidv4()),
        displayName: String(q.displayName || 'Amigo LAN'),
        avatarColor: String(q.avatarColor || '#5865F2'),
        avatarUrl: q.avatarUrl || null,
      };

      socket.on('clock:sync', (clientSentAt, cb) => {
        cb?.({ serverNow: Date.now(), clientSentAt });
      });

      const getOrCreateWb = (ch) => {
        if (!this.whiteboardStates.has(ch)) {
          this.whiteboardStates.set(ch, {
            channelId: ch,
            background: 'dark',
            layers: [{ id: 'layer-1', name: 'Camada 1', visible: true, locked: false, opacity: 1 }],
            elements: [],
            seq: 0,
          });
        }
        return this.whiteboardStates.get(ch);
      };

      socket.on('voice:join', ({ channelId, muted, deafened }, cb) => {
        if (!channelId) return cb?.({ error: 'Sala inválida.' });
        leaveCurrentVoice(socket);
        if (!this.voiceRooms.has(channelId)) this.voiceRooms.set(channelId, new Map());
        const room = this.voiceRooms.get(channelId);
        const participant = {
          socketId: socket.id,
          userId: socket.data.user.userId,
          displayName: socket.data.user.displayName,
          avatarUrl: socket.data.user.avatarUrl,
          avatarColor: socket.data.user.avatarColor,
          muted: Boolean(muted),
          deafened: Boolean(deafened),
          cameraOn: false,
          screenSharing: false,
          screenLabel: '',
          streamsMeta: null,
          joinedAt: Date.now(),
        };
        room.set(socket.id, participant);
        this.socketVoiceChannel.set(socket.id, channelId);
        socket.join(`voice:${channelId}`);

        const existingPeers = Array.from(room.values()).filter((p) => p.socketId !== socket.id);
        socket.to(`voice:${channelId}`).emit('voice:peer-joined', { channelId, peer: participant, participant });
        this.io.to(`voice:${channelId}`).emit('dm:voice-participants', Array.from(room.values()));
        this.io.to(`voice:${channelId}`).emit('voice:dm-participants', { channelId, participants: Array.from(room.values()) });
        cb?.({
          ok: true,
          channelId,
          selfSocketId: socket.id,
          peers: existingPeers,
          participants: Array.from(room.values()),
          musicState: { ...getOrCreateMusic(channelId), channelId, serverNow: Date.now() },
          videoState: { ...getOrCreateVideo(channelId), channelId, serverNow: Date.now() },
          whiteboardState: getOrCreateWb(channelId),
        });
      });

      socket.on('voice:leave', () => leaveCurrentVoice(socket));

      socket.on('voice:media-state', (state) => {
        const ch = this.socketVoiceChannel.get(socket.id);
        const room = ch && this.voiceRooms.get(ch);
        const p = room?.get(socket.id);
        if (!p) return;
        Object.assign(p, {
          ...(typeof state.muted === 'boolean' ? { muted: state.muted } : {}),
          ...(typeof state.deafened === 'boolean' ? { deafened: state.deafened } : {}),
          ...(typeof state.cameraOn === 'boolean' ? { cameraOn: state.cameraOn } : {}),
          ...(typeof state.screenSharing === 'boolean' ? { screenSharing: state.screenSharing } : {}),
          ...(typeof state.screenLabel === 'string' ? { screenLabel: state.screenLabel } : {}),
        });
        this.io.to(`voice:${ch}`).emit('voice:media-updated', { channelId: ch, participant: p });
        this.io.to(`voice:${ch}`).emit('dm:voice-participants', Array.from(room.values()));
        this.io.to(`voice:${ch}`).emit('voice:dm-participants', { channelId: ch, participants: Array.from(room.values()) });
      });

      socket.on('rtc:description', ({ targetSocketId, toSocketId, description, streamsMeta }) => {
        const to = targetSocketId || toSocketId;
        if (to && description) {
          this.io.to(to).emit('rtc:description', { fromSocketId: socket.id, description, streamsMeta });
        }
      });

      socket.on('rtc:ice-candidate', ({ targetSocketId, toSocketId, candidate }) => {
        const to = targetSocketId || toSocketId;
        if (to && candidate) {
          this.io.to(to).emit('rtc:ice-candidate', { fromSocketId: socket.id, candidate });
        }
      });

      socket.on('rtc:streams-meta', ({ channelId, targetSocketId, meta, streamsMeta }) => {
        const ch = channelId || this.socketVoiceChannel.get(socket.id);
        const room = ch && this.voiceRooms.get(ch);
        const p = room?.get(socket.id);
        const m = meta || streamsMeta || null;
        if (p) p.streamsMeta = m;
        if (targetSocketId) {
          this.io.to(targetSocketId).emit('rtc:streams-meta', { fromSocketId: socket.id, meta: m, streamsMeta: m });
        } else if (ch) {
          socket.to(`voice:${ch}`).emit('rtc:streams-meta', { fromSocketId: socket.id, meta: m, streamsMeta: m });
        }
      });

      // Whiteboard & Trello inside Direct/Group P2P Calls
      socket.on('wb:join', ({ channelId }, cb) => {
        const targetCh = channelId || this.socketVoiceChannel.get(socket.id);
        if (!targetCh) return cb?.({ error: 'Sala inválida.' });
        socket.join(`voice:${targetCh}`);
        cb?.({ ok: true, state: getOrCreateWb(targetCh) });
      });
      socket.on('wb:add-element', ({ channelId, element }) => {
        const targetCh = channelId || this.socketVoiceChannel.get(socket.id);
        if (!targetCh || !element?.id) return;
        const wb = getOrCreateWb(targetCh);
        const safeEl = {
          ...element,
          authorId: socket.data.user.userId,
          authorName: socket.data.user.displayName,
          createdAt: element.createdAt || Date.now(),
        };
        wb.elements.push(safeEl);
        if (wb.elements.length > 700) wb.elements = wb.elements.slice(-700);
        wb.seq++;
        this.io.to(`voice:${targetCh}`).emit('wb:element-added', { channelId: targetCh, element: safeEl, seq: wb.seq });
      });
      socket.on('wb:update-element', ({ channelId, element }) => {
        const targetCh = channelId || this.socketVoiceChannel.get(socket.id);
        if (!targetCh || !element?.id) return;
        const wb = getOrCreateWb(targetCh);
        const idx = wb.elements.findIndex((e) => e.id === element.id);
        if (idx !== -1) wb.elements[idx] = { ...wb.elements[idx], ...element };
        wb.seq++;
        this.io.to(`voice:${targetCh}`).emit('wb:element-updated', { channelId: targetCh, element: idx !== -1 ? wb.elements[idx] : element, seq: wb.seq });
      });
      socket.on('wb:delete-element', ({ channelId, elementId }) => {
        const targetCh = channelId || this.socketVoiceChannel.get(socket.id);
        if (!targetCh || !elementId) return;
        const wb = getOrCreateWb(targetCh);
        wb.elements = wb.elements.filter((e) => e.id !== elementId);
        wb.seq++;
        this.io.to(`voice:${targetCh}`).emit('wb:state', wb);
      });
      socket.on('wb:undo', ({ channelId }) => {
        const targetCh = channelId || this.socketVoiceChannel.get(socket.id);
        if (!targetCh) return;
        const wb = getOrCreateWb(targetCh);
        for (let i = wb.elements.length - 1; i >= 0; i--) {
          if (wb.elements[i].authorId === socket.data.user.userId) {
            wb.elements.splice(i, 1);
            break;
          }
        }
        wb.seq++;
        this.io.to(`voice:${targetCh}`).emit('wb:state', wb);
      });
      socket.on('wb:clear', ({ channelId, layerId }) => {
        const targetCh = channelId || this.socketVoiceChannel.get(socket.id);
        if (!targetCh) return;
        const wb = getOrCreateWb(targetCh);
        wb.elements = layerId ? wb.elements.filter((e) => e.layerId !== layerId) : [];
        wb.seq++;
        this.io.to(`voice:${targetCh}`).emit('wb:state', wb);
      });
      socket.on('wb:layers-update', ({ channelId, layers }) => {
        const targetCh = channelId || this.socketVoiceChannel.get(socket.id);
        if (!targetCh || !Array.isArray(layers) || !layers.length) return;
        const wb = getOrCreateWb(targetCh);
        wb.layers = layers.slice(0, 12);
        wb.seq++;
        this.io.to(`voice:${targetCh}`).emit('wb:state', wb);
      });
      socket.on('wb:background', ({ channelId, background }) => {
        const targetCh = channelId || this.socketVoiceChannel.get(socket.id);
        if (!targetCh) return;
        const wb = getOrCreateWb(targetCh);
        if (['dark', 'light', 'grid', 'transparent'].includes(background)) {
          wb.background = background;
          wb.seq++;
          this.io.to(`voice:${targetCh}`).emit('wb:state', wb);
        }
      });
      socket.on('wb:cursor', ({ channelId, x, y, size, tool, isDrawing }) => {
        const targetCh = channelId || this.socketVoiceChannel.get(socket.id);
        if (!targetCh) return;
        socket.to(`voice:${targetCh}`).volatile.emit('wb:cursor', {
          socketId: socket.id,
          userId: socket.data.user.userId,
          displayName: socket.data.user.displayName,
          color: socket.data.user.avatarColor || '#5865F2',
          x: Number(x || 0),
          y: Number(y || 0),
          size: Number(size || 6),
          tool: String(tool || 'pen'),
          isDrawing: Boolean(isDrawing),
        });
      });
      socket.on('trello:get', ({ scopeKey }, cb) => {
        cb?.({ ok: true, scopeKey, boards: this.trelloBoards.get(scopeKey) || [] });
      });
      socket.on('trello:sync', ({ scopeKey, boards }, cb) => {
        if (!scopeKey || !Array.isArray(boards)) return cb?.({ error: 'Dados inválidos.' });
        this.trelloBoards.set(scopeKey, boards.slice(0, 15));
        this.persistLocalTrello();
        this.io.emit('trello:updated', { scopeKey, boards: this.trelloBoards.get(scopeKey) });
        this.callbacks.onTrelloUpdated?.({ scopeKey, boards: this.trelloBoards.get(scopeKey) });
        cb?.({ ok: true, boards: this.trelloBoards.get(scopeKey) });
      });

      socket.on('rc:invite', ({ targetSocketId, permissions }) => {
        if (targetSocketId) {
          this.io.to(targetSocketId).emit('rc:invited', {
            fromSocketId: socket.id,
            fromName: socket.data.user.displayName,
            permissions: permissions || { mouse: true, keyboard: true, gamepad: true },
          });
        }
      });
      socket.on('rc:request', ({ targetSocketId }) => {
        if (targetSocketId) {
          this.io.to(targetSocketId).emit('rc:requested', {
            fromSocketId: socket.id,
            fromName: socket.data.user.displayName,
          });
        }
      });
      socket.on('rc:accept', ({ targetSocketId, role, permissions }) => {
        if (targetSocketId) {
          this.io.to(targetSocketId).emit('rc:accepted', {
            fromSocketId: socket.id,
            fromName: socket.data.user.displayName,
            role,
            permissions: permissions || { mouse: true, keyboard: true, gamepad: true },
          });
        }
      });
      socket.on('rc:permissions-update', ({ targetSocketId, permissions }) => {
        if (targetSocketId && permissions) {
          this.io.to(targetSocketId).emit('rc:permissions-updated', {
            fromSocketId: socket.id,
            permissions,
          });
        }
      });
      socket.on('rc:decline', ({ targetSocketId }) => {
        if (targetSocketId) {
          this.io.to(targetSocketId).emit('rc:declined', { fromSocketId: socket.id, fromName: socket.data.user.displayName });
        }
      });
      socket.on('rc:revoke', ({ targetSocketId }) => {
        if (targetSocketId) {
          this.io.to(targetSocketId).emit('rc:revoked', { fromSocketId: socket.id });
        }
      });
      socket.on('rc:input', ({ targetSocketId, event }) => {
        if (targetSocketId && event) {
          this.io.to(targetSocketId).emit('rc:input', { fromSocketId: socket.id, event });
        }
      });

      // Video & Music sync inside private LAN call
      socket.on('video:add-url', async ({ channelId, url }, cb) => {
        const targetCh = channelId || this.socketVoiceChannel.get(socket.id);
        if (!targetCh || !url) return cb?.({ error: 'Sala ou link inválido.' });
        try {
          const mr = await this.getMediaResolver();
          const vid = await mr.resolveVideoUrl(url, this.userDataDir);
          const v = getOrCreateVideo(targetCh);
          const item = { ...vid, queueId: uuidv4(), addedBy: socket.data.user.displayName };
          v.queue.push(item);
          if (v.currentIndex === -1) {
            v.currentIndex = 0;
            v.isPlaying = true;
            v.positionSec = 0;
            v.updatedAt = Date.now();
          }
          v.seq++;
          v.lastAction = 'track';
          broadcastVideo(targetCh);
          cb?.({ ok: true, item });
        } catch (err) {
          cb?.({ error: err?.message || 'Erro ao carregar vídeo.' });
        }
      });
      socket.on('video:play', ({ channelId, index, positionSec }) => {
        const ch = channelId || this.socketVoiceChannel.get(socket.id);
        if (!ch) return;
        const v = getOrCreateVideo(ch);
        if (v.queue.length === 0) return;
        if (typeof index === 'number' && index >= 0 && index < v.queue.length) {
          v.currentIndex = index;
          v.positionSec = typeof positionSec === 'number' ? Math.max(0, positionSec) : 0;
        } else if (v.currentIndex < 0) {
          v.currentIndex = 0;
          v.positionSec = 0;
        } else if (typeof positionSec === 'number') {
          v.positionSec = Math.max(0, positionSec);
        }
        v.isPlaying = true;
        v.updatedAt = Date.now();
        v.seq++;
        v.lastAction = 'play';
        broadcastVideo(ch);
      });
      socket.on('video:pause', ({ channelId, positionSec }) => {
        const ch = channelId || this.socketVoiceChannel.get(socket.id);
        if (!ch) return;
        const v = getOrCreateVideo(ch);
        if (typeof positionSec === 'number') v.positionSec = Math.max(0, positionSec);
        else if (v.isPlaying) v.positionSec += Math.max(0, (Date.now() - v.updatedAt) / 1000);
        v.isPlaying = false;
        v.updatedAt = Date.now();
        v.seq++;
        v.lastAction = 'pause';
        broadcastVideo(ch);
      });
      socket.on('video:seek', ({ channelId, positionSec }) => {
        const ch = channelId || this.socketVoiceChannel.get(socket.id);
        if (!ch) return;
        const v = getOrCreateVideo(ch);
        v.positionSec = Math.max(0, Number(positionSec) || 0);
        v.updatedAt = Date.now();
        v.seq++;
        v.lastAction = 'seek';
        broadcastVideo(ch);
      });
      socket.on('video:next', ({ channelId }) => {
        const ch = channelId || this.socketVoiceChannel.get(socket.id);
        if (!ch) return;
        const v = getOrCreateVideo(ch);
        if (v.queue.length === 0) return;
        v.currentIndex = v.currentIndex + 1 < v.queue.length ? v.currentIndex + 1 : 0;
        v.positionSec = 0;
        v.isPlaying = true;
        v.updatedAt = Date.now();
        v.seq++;
        v.lastAction = 'track';
        broadcastVideo(ch);
      });
      socket.on('video:prev', ({ channelId }) => {
        const ch = channelId || this.socketVoiceChannel.get(socket.id);
        if (!ch) return;
        const v = getOrCreateVideo(ch);
        if (v.queue.length === 0) return;
        v.currentIndex = v.currentIndex - 1 >= 0 ? v.currentIndex - 1 : v.queue.length - 1;
        v.positionSec = 0;
        v.isPlaying = true;
        v.updatedAt = Date.now();
        v.seq++;
        v.lastAction = 'track';
        broadcastVideo(ch);
      });
      socket.on('video:ended', ({ channelId, queueId }) => {
        const ch = channelId || this.socketVoiceChannel.get(socket.id);
        if (!ch) return;
        const v = getOrCreateVideo(ch);
        const cur = v.queue[v.currentIndex];
        if (!cur || cur.queueId !== queueId) return;
        if (v.currentIndex + 1 < v.queue.length) {
          v.currentIndex += 1;
          v.positionSec = 0;
          v.isPlaying = true;
        } else {
          v.isPlaying = false;
          v.positionSec = 0;
        }
        v.updatedAt = Date.now();
        v.seq++;
        v.lastAction = 'track';
        broadcastVideo(ch);
      });
      socket.on('video:remove', ({ channelId, index }) => {
        const ch = channelId || this.socketVoiceChannel.get(socket.id);
        if (!ch) return;
        const v = getOrCreateVideo(ch);
        if (index >= 0 && index < v.queue.length) {
          v.queue.splice(index, 1);
          if (v.queue.length === 0) {
            v.currentIndex = -1;
            v.isPlaying = false;
          } else if (v.currentIndex >= v.queue.length) {
            v.currentIndex = v.queue.length - 1;
          }
          v.seq++;
          v.lastAction = 'track';
          broadcastVideo(ch);
        }
      });
      socket.on('video:clear', ({ channelId }) => {
        const ch = channelId || this.socketVoiceChannel.get(socket.id);
        if (!ch) return;
        const v = getOrCreateVideo(ch);
        v.queue = [];
        v.currentIndex = -1;
        v.isPlaying = false;
        v.positionSec = 0;
        v.seq++;
        v.lastAction = 'clear';
        broadcastVideo(ch);
      });

      socket.on('disconnect', () => leaveCurrentVoice(socket));
    });
  }

  async resolveTargetUrl(targetPeerId, fallbackPeerUrl) {
    const peer = this.peers.get(targetPeerId);
    return peer?.p2pUrl || fallbackPeerUrl || '';
  }

  async sendDm({ toPeerId, peerUrl, content, attachments = [], gifUrl = null, replyTo = null }) {
    const targetUrl = await this.resolveTargetUrl(toPeerId, peerUrl);
    if (!targetUrl) throw new Error('Amigo desconectado ou indisponível na LAN.');

    const msgId = `dm-${uuidv4()}`;
    const pairKey = [this.peerId, toPeerId].sort().join('::');
    const finalAttachments = [];

    for (const att of attachments) {
      if (att.bytes) {
        const ext = path.extname(att.name || '') || (att.isVoiceMessage ? '.webm' : '.bin');
        const fileKey = `${uuidv4()}${ext}`;
        const buf = Buffer.from(att.bytes);
        fs.writeFileSync(path.join(this.filesDir, fileKey), buf);

        const fd = new FormData();
        fd.append('file', new Blob([buf], { type: att.mimeType || 'application/octet-stream' }), att.name || fileKey);
        const upRes = await fetch(`${targetUrl}/p2p/upload`, {
          method: 'POST',
          headers: { 'x-p2p-filekey': fileKey },
          body: fd,
          signal: AbortSignal.timeout(30000),
        });
        if (!upRes.ok) throw new Error('Falha ao enviar anexo P2P para o amigo.');

        finalAttachments.push({
          id: uuidv4(),
          url: `/p2p/files/${fileKey}`,
          name: att.name || fileKey,
          mimeType: att.mimeType || 'application/octet-stream',
          size: buf.length,
          kind: att.kind || (att.isVoiceMessage ? 'audio' : 'file'),
          waveform: att.waveform,
          durationSec: att.durationSec,
          isVoiceMessage: Boolean(att.isVoiceMessage),
        });
      } else if (att.url) {
        finalAttachments.push(att);
      }
    }

    const message = {
      id: msgId,
      channelId: `dm:${pairKey}`,
      pairKey,
      toUserId: toPeerId,
      authorId: this.peerId,
      authorName: this.identity.displayName,
      authorAvatar: null,
      authorColor: this.identity.avatarColor || '#5865F2',
      content: String(content || ''),
      attachments: finalAttachments,
      gifUrl: gifUrl || null,
      replyTo: replyTo || null,
      createdAt: Date.now(),
    };

    const resp = await fetch(`${targetUrl}/p2p/dm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        fromPeer: { ...this.getSelfInfo(), hasAvatar: Boolean(this.identity.avatarDataUrl) },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`Falha ao entregar DM na LAN (HTTP ${resp.status}).`);
    return { ok: true, message };
  }

  async pinDm({ toPeerId, peerUrl, pairKey, messageId, pinned }) {
    const targetUrl = await this.resolveTargetUrl(toPeerId, peerUrl);
    const payload = {
      peerId: this.peerId,
      pairKey,
      messageId,
      pinned: Boolean(pinned),
      pinnedAt: pinned ? Date.now() : null,
      pinnedBy: pinned ? this.identity.displayName : null,
    };
    if (targetUrl) {
      await fetch(`${targetUrl}/p2p/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
    return { ok: true, ...payload };
  }

  async sendCallInvite({ toPeerId, peerUrl, dmRoomId }) {
    const targetUrl = await this.resolveTargetUrl(toPeerId, peerUrl);
    if (!targetUrl) throw new Error('Amigo indisponível na LAN.');
    const self = this.getSelfInfo();
    const callServerUrl = self.shareUrl || `http://127.0.0.1:${this.port}`;
    const resp = await fetch(`${targetUrl}/p2p/call-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dmRoomId,
        callServerUrl,
        fromPeer: { ...self, hasAvatar: Boolean(this.identity.avatarDataUrl) },
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) throw new Error('Falha ao enviar convite de chamada privada.');
    return { ok: true, callServerUrl };
  }

  async sendCallRespond({ toPeerId, peerUrl, dmRoomId, accepted }) {
    const targetUrl = await this.resolveTargetUrl(toPeerId, peerUrl);
    if (!targetUrl) return { ok: false };
    await fetch(`${targetUrl}/p2p/call-respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dmRoomId,
        accepted: Boolean(accepted),
        fromPeer: this.getSelfInfo(),
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
    return { ok: true };
  }

  async saveGroup({ id, name, memberIds = [], membersMeta = [], iconDataUrl, clearIcon } = {}) {
    const existing = id ? this.groups.get(id) : null;
    const self = this.getSelfInfo();
    const cleanMemberIds = Array.from(new Set([this.peerId, ...(Array.isArray(memberIds) ? memberIds : [])]));
    const nextMeta = new Map();
    nextMeta.set(this.peerId, {
      id: this.peerId,
      username: self.username,
      displayName: self.displayName,
      avatarColor: self.avatarColor,
      avatarUrl: null,
      p2pUrl: self.shareUrl || self.p2pUrl,
    });
    for (const m of [...(existing?.membersMeta || []), ...(Array.isArray(membersMeta) ? membersMeta : [])]) {
      if (m?.id && cleanMemberIds.includes(m.id)) {
        const livePeer = this.peers.get(m.id);
        nextMeta.set(m.id, { ...m, ...(livePeer ? { p2pUrl: livePeer.p2pUrl } : {}) });
      }
    }
    for (const mid of cleanMemberIds) {
      if (!nextMeta.has(mid) && this.peers.has(mid)) {
        const lp = this.peers.get(mid);
        nextMeta.set(mid, {
          id: lp.peerId,
          username: lp.username,
          displayName: lp.displayName,
          avatarColor: lp.avatarColor,
          avatarUrl: lp.avatarUrl,
          p2pUrl: lp.p2pUrl,
        });
      }
    }
    const group = {
      id: existing?.id || `grp-${uuidv4().slice(0, 8)}`,
      name: String(name || existing?.name || 'Grupo Privado').trim().slice(0, 40) || 'Grupo Privado',
      iconUrl: clearIcon ? null : typeof iconDataUrl === 'string' && iconDataUrl.startsWith('data:image/') ? iconDataUrl : existing?.iconUrl || null,
      ownerId: existing?.ownerId || this.peerId,
      memberIds: cleanMemberIds,
      membersMeta: Array.from(nextMeta.values()),
      isLanP2p: true,
      hostP2pUrl: existing?.hostP2pUrl || self.shareUrl || self.p2pUrl,
      createdAt: existing?.createdAt || Date.now(),
    };
    this.groups.set(group.id, group);
    this.persistLocalGroups();
    this.callbacks.onGroupUpdated?.({ group });

    const fromPeer = { ...self, hasAvatar: Boolean(this.identity.avatarDataUrl) };
    await Promise.allSettled(
      group.memberIds
        .filter((pid) => pid !== this.peerId)
        .map(async (pid) => {
          const url = await this.resolveTargetUrl(pid, group.membersMeta?.find((m) => m.id === pid)?.p2pUrl);
          if (!url) return;
          await fetch(`${url}/p2p/group-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group, fromPeer }),
            signal: AbortSignal.timeout(5000),
          });
        })
    );
    return { ok: true, group };
  }

  async sendGroupMessage({ groupId, content, attachments = [], gifUrl = null, replyTo = null }) {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Grupo LAN não encontrado.');
    const self = this.getSelfInfo();
    const finalAttachments = [];

    for (const att of attachments) {
      if (att.bytes) {
        const ext = path.extname(att.name || '') || (att.isVoiceMessage ? '.webm' : '.bin');
        const fileKey = `${uuidv4()}${ext}`;
        const buf = Buffer.from(att.bytes);
        fs.writeFileSync(path.join(this.filesDir, fileKey), buf);
        finalAttachments.push({
          id: uuidv4(),
          url: `/p2p/files/${fileKey}`,
          name: att.name || fileKey,
          mimeType: att.mimeType || 'application/octet-stream',
          size: buf.length,
          kind: att.kind || (att.isVoiceMessage ? 'audio' : 'file'),
          waveform: att.waveform,
          durationSec: att.durationSec,
          isVoiceMessage: Boolean(att.isVoiceMessage),
          _rawBuf: buf,
          _fileKey: fileKey,
        });
      } else if (att.url) {
        finalAttachments.push(att);
      }
    }

    const fromPeer = { ...self, hasAvatar: Boolean(this.identity.avatarDataUrl) };
    const cleanAttachments = finalAttachments.map(({ _rawBuf, _fileKey, ...rest }) => rest);
    const message = {
      id: `grpmsg-${uuidv4()}`,
      channelId: `group:${groupId}`,
      authorId: this.peerId,
      authorName: this.identity.displayName,
      authorAvatar: null,
      authorColor: this.identity.avatarColor || '#5865F2',
      content: String(content || ''),
      attachments: cleanAttachments,
      gifUrl: gifUrl || null,
      replyTo: replyTo || null,
      createdAt: Date.now(),
    };

    await Promise.allSettled(
      group.memberIds
        .filter((pid) => pid !== this.peerId)
        .map(async (pid) => {
          const url = await this.resolveTargetUrl(pid, group.membersMeta?.find((m) => m.id === pid)?.p2pUrl);
          if (!url) return;
          for (const att of finalAttachments) {
            if (att._rawBuf && att._fileKey) {
              const fd = new FormData();
              fd.append('file', new Blob([att._rawBuf], { type: att.mimeType || 'application/octet-stream' }), att.name || att._fileKey);
              await fetch(`${url}/p2p/upload`, {
                method: 'POST',
                headers: { 'x-p2p-filekey': att._fileKey },
                body: fd,
                signal: AbortSignal.timeout(20000),
              }).catch(() => {});
            }
          }
          await fetch(`${url}/p2p/group-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId, message, fromPeer }),
            signal: AbortSignal.timeout(6000),
          });
        })
    );
    return { ok: true, message };
  }

  async pinGroupMessage({ groupId, messageId, pinned }) {
    const group = this.groups.get(groupId);
    const payload = {
      groupId,
      messageId,
      pinned: Boolean(pinned),
      pinnedAt: pinned ? Date.now() : null,
      pinnedBy: pinned ? this.identity.displayName : null,
    };
    if (group) {
      await Promise.allSettled(
        group.memberIds
          .filter((pid) => pid !== this.peerId)
          .map(async (pid) => {
            const url = await this.resolveTargetUrl(pid, group.membersMeta?.find((m) => m.id === pid)?.p2pUrl);
            if (!url) return;
            await fetch(`${url}/p2p/group-pin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(5000),
            });
          })
      );
    }
    return { ok: true, ...payload };
  }

  async sendGroupCallInvite({ groupId }) {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Grupo LAN não encontrado.');
    const self = this.getSelfInfo();
    const callServerUrl = self.shareUrl || `http://127.0.0.1:${this.port}`;
    const dmRoomId = `group:${group.id}`;
    const fromPeer = { ...self, hasAvatar: Boolean(this.identity.avatarDataUrl) };
    await Promise.allSettled(
      group.memberIds
        .filter((pid) => pid !== this.peerId)
        .map(async (pid) => {
          const url = await this.resolveTargetUrl(pid, group.membersMeta?.find((m) => m.id === pid)?.p2pUrl);
          if (!url) return;
          await fetch(`${url}/p2p/call-invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dmRoomId, callServerUrl, group, fromPeer }),
            signal: AbortSignal.timeout(6000),
          });
        })
    );
    return { ok: true, dmRoomId, callServerUrl };
  }

  async syncTrello({ scopeKey, boards, peerUrls = [] }) {
    this.trelloBoards.set(scopeKey, boards);
    this.persistLocalTrello();
    const fromPeer = this.getSelfInfo();
    const targets = new Set(peerUrls.filter(Boolean));
    if (scopeKey.startsWith('group:')) {
      const g = this.groups.get(scopeKey.slice(6));
      for (const pid of g?.memberIds || []) {
        if (pid === this.peerId) continue;
        const u = await this.resolveTargetUrl(pid, g.membersMeta?.find((m) => m.id === pid)?.p2pUrl);
        if (u) targets.add(u);
      }
    } else if (scopeKey.startsWith('dm:')) {
      for (const pid of scopeKey.slice(3).split('::')) {
        if (pid === this.peerId) continue;
        const u = await this.resolveTargetUrl(pid);
        if (u) targets.add(u);
      }
    }
    await Promise.allSettled(
      Array.from(targets).map((u) =>
        fetch(`${u}/p2p/trello-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scopeKey, boards, fromPeer }),
          signal: AbortSignal.timeout(5000),
        })
      )
    );
    return { ok: true, boards };
  }

  async stop() {
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    if (this.probeTimer) clearInterval(this.probeTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.beaconTimer = null;
    this.probeTimer = null;
    this.pruneTimer = null;
    try { this.probeSocket?.close(); } catch {}
    try { this.listenSocket?.close(); } catch {}
    this.probeSocket = null;
    this.listenSocket = null;
    if (this.io) {
      await new Promise((r) => this.io.close(() => r()));
      this.io = null;
    }
    if (this.httpServer) {
      await new Promise((r) => this.httpServer.close(() => r()));
      this.httpServer = null;
    }
    this.port = 0;
  }
}

function buildYoutubeEmbedHtml(videoId) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  html, body { margin:0; padding:0; width:100%; height:100%; background:#000; overflow:hidden; }
  #player { width:100%; height:100%; }
</style>
</head>
<body>
<div id="player"></div>
<script src="https://www.youtube.com/iframe_api"></script>
<script>
  var player = null;
  var videoId = ${JSON.stringify(videoId)};
  var post = function(data) {
    try { window.parent.postMessage(Object.assign({ source: 'pulsecord-yt' }, data), '*'); } catch (e) {}
  };
  function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
      videoId: videoId,
      width: '100%',
      height: '100%',
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        enablejsapi: 1,
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        origin: window.location.origin
      },
      events: {
        onReady: function() {
          post({ event: 'ready', duration: Number(player.getDuration() || 0) });
        },
        onStateChange: function(e) {
          post({
            event: 'state',
            state: e.data,
            currentTime: Number(player.getCurrentTime ? player.getCurrentTime() : 0),
            duration: Number(player.getDuration ? player.getDuration() : 0)
          });
        },
        onError: function(e) {
          post({ event: 'error', code: e.data });
        }
      }
    });
  }
  setInterval(function() {
    if (!player || typeof player.getCurrentTime !== 'function') return;
    post({
      event: 'time',
      state: typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1,
      currentTime: Number(player.getCurrentTime() || 0),
      duration: Number(player.getDuration ? player.getDuration() : 0)
    });
  }, 250);
  window.addEventListener('message', function(ev) {
    if (!player || !ev.data || ev.data.target !== 'pulsecord-yt') return;
    var msg = ev.data;
    try {
      if (msg.cmd === 'play' && player.playVideo) player.playVideo();
      else if (msg.cmd === 'pause' && player.pauseVideo) player.pauseVideo();
      else if (msg.cmd === 'seek' && player.seekTo) player.seekTo(Number(msg.sec || 0), true);
      else if (msg.cmd === 'volume') {
        var vol = Math.max(0, Math.min(100, Math.round(Number(msg.volume || 0) * 100)));
        if (vol === 0 && player.mute) player.mute();
        else if (player.unMute) { player.unMute(); if (player.setVolume) player.setVolume(vol); }
      }
    } catch (e) {}
  });
</script>
</body>
</html>`;
}

module.exports = { LanPeerMessenger };
