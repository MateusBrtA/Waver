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
const wbRoom = require('../server/wbRoom.cjs');
const { createRecConsent } = require('../server/recConsent.cjs');

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

// ------------------------------------------------------------------ segurança da LAN
// Cada PC tem um par de chaves Ed25519. Todo POST entre PCs é assinado (quem manda, quando, para qual
// endereço, hash do corpo); quem recebe confere a assinatura e a chave registrada daquele peerId.
// IDs novos são derivados da chave (não dá para se passar por eles); IDs antigos usam a 1ª chave vista.
const PEER_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const SIG_WINDOW_MS = 5 * 60 * 1000;

function isPrivateAddress(addr) {
  let a = String(addr || '').trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (a === '::1' || a === 'localhost') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) {
    const [x, y] = a.split('.').map(Number);
    return (
      x === 127 ||
      x === 10 ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 169 && y === 254) ||
      (x === 100 && y >= 64 && y <= 127) || // Tailscale / CGNAT
      x === 25 || // Hamachi
      x === 26 // Radmin VPN
    );
  }
  return /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}

function localAddressSet() {
  const out = new Set(['127.0.0.1', '::1', 'localhost']);
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) out.add(String(info.address).toLowerCase());
  }
  return out;
}

function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf || Buffer.alloc(0)).digest('hex');
}

function derivedPeerId(pubB64) {
  return `peer-k${sha256hex(Buffer.from(pubB64, 'base64')).slice(0, 24)}`;
}

function loadOrCreateIdentityKey(userDataDir) {
  const keyFile = path.join(userDataDir, '.peer-key.json');
  try {
    const j = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    const privateKey = crypto.createPrivateKey({ key: Buffer.from(j.priv, 'base64'), format: 'der', type: 'pkcs8' });
    const pub = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
    if (privateKey.asymmetricKeyType === 'ed25519') return { privateKey, pub };
  } catch {}
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  try {
    fs.writeFileSync(keyFile, JSON.stringify({ v: 1, priv, pub }), { encoding: 'utf8', mode: 0o600 });
  } catch {}
  return { privateKey, pub };
}

function parsePublicKey(pubB64) {
  try {
    if (typeof pubB64 !== 'string' || pubB64.length > 200) return null;
    const k = crypto.createPublicKey({ key: Buffer.from(pubB64, 'base64'), format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ed25519' ? k : null;
  } catch {
    return null;
  }
}

function sigMessage(method, host, pathAndQuery, ts, nonce, bodyHash) {
  return Buffer.from(['PCLAN1', method, String(host || '').toLowerCase(), pathAndQuery, ts, nonce, bodyHash].join('\n'));
}

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));

function sanitizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).filter((a) => a && typeof a === 'object').map((a) => {
    const url = typeof a.url === 'string' ? a.url : '';
    const okUrl = /^\/p2p\/files\/[a-zA-Z0-9._-]+$/.test(url) || /^https?:\/\/[^\s]+$/i.test(url) ? url.slice(0, 2000) : '';
    return {
      id: str(a.id, 80),
      url: okUrl,
      name: str(a.name, 255),
      mimeType: str(a.mimeType, 120),
      size: Number(a.size) || 0,
      kind: str(a.kind, 20),
      waveform: Array.isArray(a.waveform) ? a.waveform.slice(0, 256).map((n) => Number(n) || 0) : undefined,
      durationSec: Number(a.durationSec) || undefined,
      isVoiceMessage: Boolean(a.isVoiceMessage),
    };
  }).filter((a) => a.url);
}

function getOrCreatePeerId(userDataDir, freshId) {
  const idFile = path.join(userDataDir, '.peer-id');
  try {
    if (fs.existsSync(idFile)) {
      const existing = fs.readFileSync(idFile, 'utf8').trim();
      if (existing) return existing;
    }
  } catch {}
  const fresh = freshId || `peer-${crypto.randomBytes(8).toString('hex')}`;
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
    this.identityKey = loadOrCreateIdentityKey(this.userDataDir);
    this.peerId = options.peerId || getOrCreatePeerId(this.userDataDir, derivedPeerId(this.identityKey.pub));
    this.peerKeysFile = path.join(this.userDataDir, 'lan-peer-keys.json');
    this.peerKeys = new Map();
    try {
      const j = JSON.parse(fs.readFileSync(this.peerKeysFile, 'utf8'));
      for (const [k, v] of Object.entries(j || {})) if (typeof v === 'string') this.peerKeys.set(k, v);
    } catch {}
    this.seenNonces = new Map();
    this.ticketKey = crypto.randomBytes(32);
    this.uploadUsage = new Map();

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
      displayName: 'Usuário Waver',
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
    this.lanUserPeer = new Map();
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
      pubKey: this.identityKey.pub,
    };
  }

  // ------------------------------------------------------------ identidade / assinaturas
  /** Registra (ou confere) a chave pública de um peerId. false = chave diferente da registrada (impostor). */
  checkPeerKey(peerId, pubB64) {
    if (!PEER_ID_RE.test(String(peerId || '')) || !parsePublicKey(pubB64)) return false;
    if (String(peerId).startsWith('peer-k')) return derivedPeerId(pubB64) === peerId;
    const pinned = this.peerKeys.get(peerId);
    if (pinned) return pinned === pubB64;
    this.peerKeys.set(peerId, pubB64);
    try {
      fs.writeFileSync(this.peerKeysFile, JSON.stringify(Object.fromEntries(this.peerKeys)), 'utf8');
    } catch {}
    return true;
  }

  signedHeaders(method, url, bodyHash) {
    const u = new URL(url);
    const ts = String(Date.now());
    const nonce = crypto.randomBytes(16).toString('hex');
    const sig = crypto.sign(null, sigMessage(method, u.host, u.pathname + u.search, ts, nonce, bodyHash), this.identityKey.privateKey);
    return {
      'x-p2p-peer': this.peerId,
      'x-p2p-pub': this.identityKey.pub,
      'x-p2p-ts': ts,
      'x-p2p-nonce': nonce,
      'x-p2p-sig': sig.toString('base64'),
    };
  }

  signedPost(baseUrl, pathname, obj, timeoutMs = 6000) {
    const url = `${String(baseUrl).replace(/\/+$/, '')}${pathname}`;
    const body = JSON.stringify(obj);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.signedHeaders('POST', url, sha256hex(Buffer.from(body))) },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  signedUpload(baseUrl, fileKey, buf, mimeType, name, timeoutMs = 30000) {
    const url = `${String(baseUrl).replace(/\/+$/, '')}/p2p/upload`;
    const fileHash = sha256hex(buf);
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mimeType || 'application/octet-stream' }), name || fileKey);
    return fetch(url, {
      method: 'POST',
      headers: { 'x-p2p-filekey': fileKey, 'x-p2p-filehash': fileHash, ...this.signedHeaders('POST', url, fileHash) },
      body: fd,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  /** Middleware: só passa POST com assinatura válida de um par conhecido; req.lanPeerId = quem mandou. */
  verifySignedRequest(req) {
    const h = req.headers;
    const peer = String(h['x-p2p-peer'] || '');
    const pub = String(h['x-p2p-pub'] || '');
    const ts = String(h['x-p2p-ts'] || '');
    const nonce = String(h['x-p2p-nonce'] || '');
    const sig = String(h['x-p2p-sig'] || '');
    if (!PEER_ID_RE.test(peer) || peer === this.peerId) return 'remetente inválido';
    if (!/^\d{10,16}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > SIG_WINDOW_MS) return 'horário fora da janela';
    if (!/^[a-f0-9]{16,64}$/.test(nonce)) return 'nonce inválido';
    const key = parsePublicKey(pub);
    if (!key) return 'chave inválida';
    const isUpload = req.path === '/upload';
    const bodyHash = isUpload ? String(h['x-p2p-filehash'] || '') : sha256hex(req.rawBody || Buffer.alloc(0));
    if (!/^[a-f0-9]{64}$/.test(bodyHash)) return 'hash ausente';
    let ok = false;
    try {
      ok = crypto.verify(null, sigMessage(req.method, h.host, req.originalUrl, ts, nonce, bodyHash), key, Buffer.from(sig, 'base64'));
    } catch {}
    if (!ok) return 'assinatura inválida';
    const now = Date.now();
    if (this.seenNonces.size > 20000) {
      for (const [k, exp] of this.seenNonces) if (exp < now) this.seenNonces.delete(k);
    }
    const nk = `${peer}|${nonce}`;
    if (this.seenNonces.has(nk)) return 'requisição repetida';
    if (!this.checkPeerKey(peer, pub)) return 'chave não confere com a registrada para este amigo';
    this.seenNonces.set(nk, now + SIG_WINDOW_MS * 2);
    req.lanPeerId = peer;
    return null;
  }

  pairKeyWith(peerId) {
    return [this.peerId, peerId].sort().join('::');
  }

  isGroupMember(groupId, peerId) {
    const g = this.groups.get(String(groupId || ''));
    return Boolean(g && Array.isArray(g.memberIds) && g.memberIds.includes(peerId) && g.memberIds.includes(this.peerId));
  }

  /** Sala de call/quadro LAN que esse par pode usar comigo: DM entre nós dois, ou grupo do qual os dois são membros. */
  peerMayUseRoom(peerId, room) {
    const r = String(room || '');
    if (r.startsWith('dm:')) {
      const parts = r.slice(3).split('::');
      if (parts.length !== 2 || !parts.includes(this.peerId)) return false;
      return peerId === this.peerId ? parts.some((x) => x !== this.peerId) || parts[0] === parts[1] : parts.includes(peerId);
    }
    if (r.startsWith('group:')) return this.isGroupMember(r.slice(6), peerId);
    return false;
  }

  mintCallTicket(room, peerId) {
    const payload = Buffer.from(JSON.stringify({ r: room, p: peerId, e: Date.now() + 10 * 60 * 1000 })).toString('base64url');
    const mac = crypto.createHmac('sha256', this.ticketKey).update(payload).digest('base64url');
    return `${payload}.${mac}`;
  }

  verifyCallTicket(ticket) {
    try {
      const [payload, mac] = String(ticket || '').split('.');
      if (!payload || !mac) return null;
      const want = crypto.createHmac('sha256', this.ticketKey).update(payload).digest();
      const got = Buffer.from(mac, 'base64url');
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
      const j = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!j || typeof j.r !== 'string' || typeof j.p !== 'string' || !(Number(j.e) > Date.now())) return null;
      return { room: j.r, peerId: j.p };
    } catch {
      return null;
    }
  }

  /** Ingresso para entrar na call LAN hospedada em `url` (o próprio PC emite; outro PC é pedido com assinatura). */
  async requestCallTicket(url, room) {
    let u;
    try {
      u = new URL(String(url || ''));
    } catch {
      throw new Error('Endereço da call inválido.');
    }
    if (!/^https?:$/.test(u.protocol) || !isPrivateAddress(u.hostname)) throw new Error('Call fora da rede local.');
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (Number(u.port) === this.port && localAddressSet().has(host)) {
      if (!this.peerMayUseRoom(this.peerId, room)) throw new Error('Sala LAN inválida.');
      return this.mintCallTicket(String(room), this.peerId);
    }
    const res = await this.signedPost(u.origin, '/p2p/call-ticket', { room: String(room || '') }, 6000);
    if (!res.ok) throw new Error('O anfitrião recusou a entrada na call.');
    const j = await res.json().catch(() => ({}));
    if (typeof j.ticket !== 'string') throw new Error('Resposta inválida do anfitrião.');
    return j.ticket;
  }

  sanitizeGroup(g) {
    if (!g || typeof g !== 'object') return null;
    const id = String(g.id || '');
    if (!PEER_ID_RE.test(id)) return null;
    const memberIds = Array.from(
      new Set((Array.isArray(g.memberIds) ? g.memberIds : []).map(String).filter((x) => PEER_ID_RE.test(x)))
    ).slice(0, 100);
    const membersMeta = (Array.isArray(g.membersMeta) ? g.membersMeta : [])
      .filter((m) => m && typeof m === 'object' && memberIds.includes(String(m.id)))
      .slice(0, 100)
      .map((m) => ({
        id: String(m.id),
        username: str(m.username, 64),
        displayName: str(m.displayName, 64),
        avatarColor: str(m.avatarColor, 32),
        avatarUrl: typeof m.avatarUrl === 'string' && /^https?:\/\//i.test(m.avatarUrl) ? m.avatarUrl.slice(0, 500) : null,
        p2pUrl: typeof m.p2pUrl === 'string' && /^https?:\/\//i.test(m.p2pUrl) ? m.p2pUrl.slice(0, 200) : '',
      }));
    const icon = typeof g.iconUrl === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(g.iconUrl) && g.iconUrl.length < 3_000_000 ? g.iconUrl : null;
    return {
      id,
      name: str(g.name, 40).trim() || 'Grupo Privado',
      iconUrl: icon,
      ownerId: PEER_ID_RE.test(String(g.ownerId || '')) ? String(g.ownerId) : memberIds[0] || '',
      memberIds,
      membersMeta,
      isLanP2p: true,
      hostP2pUrl: typeof g.hostP2pUrl === 'string' && /^https?:\/\//i.test(g.hostP2pUrl) ? g.hostP2pUrl.slice(0, 200) : '',
      createdAt: Number(g.createdAt) || Date.now(),
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
        pubKey: this.identityKey.pub,
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
    // Só a rede local (LAN/VPN de jogo) fala com este PC.
    app.use((req, res, next) => {
      if (!isPrivateAddress(req.socket.remoteAddress)) return res.status(403).end();
      next();
    });
    app.use(cors());
    app.use(
      express.json({
        limit: '15mb',
        verify: (req, _res, buf) => {
          req.rawBody = Buffer.from(buf);
        },
      })
    );
    // Todo POST /p2p/* precisa vir assinado por um par cuja chave confere
    app.use('/p2p', (req, res, next) => {
      if (req.method !== 'POST') return next();
      const err = this.verifySignedRequest(req);
      if (err) return res.status(401).json({ error: `LAN: ${err}.` });
      next();
    });

    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, this.filesDir),
      filename: (req, file, cb) => {
        const forcedName = req.headers['x-p2p-filekey'] ? path.basename(String(req.headers['x-p2p-filekey'])) : '';
        if (forcedName && /^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,120}$/.test(forcedName)) {
          // nunca sobrescreve um arquivo que já existe (outro amigo não troca o anexo de ninguém)
          if (fs.existsSync(path.join(this.filesDir, forcedName))) return cb(new Error('EXISTS'));
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
      const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/i.exec(dataUrl);
      if (!m) return res.status(404).end();
      res.setHeader('Content-Type', m[1]);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(Buffer.from(m[2], 'base64'));
    });

    app.get('/p2p/files/:filename', (req, res) => {
      const safe = path.basename(req.params.filename || '');
      const full = path.join(this.filesDir, safe);
      if (!safe || !fs.existsSync(full)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      if (/\.(html?|xhtml|svg|xml|js|mjs)$/i.test(safe)) {
        res.setHeader('Content-Disposition', 'attachment');
        res.type('application/octet-stream');
      }
      res.sendFile(full);
    });

    app.post('/p2p/upload', (req, res, next) => {
      // cota por amigo: 1 GB por hora
      const now = Date.now();
      const u = this.uploadUsage.get(req.lanPeerId) || { since: now, bytes: 0 };
      if (now - u.since > 3600000) Object.assign(u, { since: now, bytes: 0 });
      const len = Number(req.headers['content-length']) || 0;
      if (u.bytes + len > 1024 * 1024 * 1024) return res.status(429).json({ error: 'Limite de envio atingido.' });
      u.bytes += len;
      this.uploadUsage.set(req.lanPeerId, u);
      upload.single('file')(req, res, (err) => {
        if (err) return res.status(err.message === 'EXISTS' ? 409 : 400).json({ error: 'Envio recusado.' });
        next();
      });
    }, (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'Arquivo ausente.' });
      // o conteúdo tem que ser exatamente o que foi assinado
      const got = sha256hex(fs.readFileSync(req.file.path));
      if (got !== String(req.headers['x-p2p-filehash'] || '')) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: 'Arquivo não confere com a assinatura.' });
      }
      res.status(201).json({
        fileKey: req.file.filename,
        url: `/p2p/files/${req.file.filename}`,
        size: req.file.size,
      });
    });

    const sender = (req) => req.lanPeerId;
    const fromPeerOf = (req) => {
      const fp = req.body?.fromPeer;
      return fp && typeof fp === 'object' && fp.peerId === sender(req) ? fp : null;
    };
    const cleanMessage = (m, channelId, extra = {}) => ({
      id: str(m.id, 100),
      channelId,
      authorName: str(m.authorName, 64),
      authorAvatar: null,
      authorColor: str(m.authorColor, 32) || '#5865F2',
      content: str(m.content, 8000),
      attachments: sanitizeAttachments(m.attachments),
      gifUrl: typeof m.gifUrl === 'string' && /^https?:\/\//i.test(m.gifUrl) ? m.gifUrl.slice(0, 2000) : null,
      replyTo: m.replyTo && typeof m.replyTo === 'object' ? m.replyTo : null,
      createdAt: Number(m.createdAt) || Date.now(),
      ...extra,
    });
    const okCallUrl = (u) => {
      try {
        const x = new URL(String(u));
        return /^https?:$/.test(x.protocol) && isPrivateAddress(x.hostname) ? x.origin : '';
      } catch {
        return '';
      }
    };

    app.post('/p2p/dm', (req, res) => {
      const { message } = req.body || {};
      const from = sender(req);
      if (!message || typeof message !== 'object' || !message.id) return res.status(400).json({ error: 'Mensagem inválida.' });
      // a DM só pode ser do próprio remetente e para mim
      if (message.authorId !== from) return res.status(403).json({ error: 'Autor não confere.' });
      const pairKey = this.pairKeyWith(from);
      const fp = fromPeerOf(req);
      if (fp) this.upsertPeerFromHttp(fp, req.ip);
      const clean = cleanMessage(message, `dm:${pairKey}`, { pairKey, toUserId: this.peerId, authorId: from });
      this.callbacks.onDmMessage?.({ message: clean, fromPeerId: from });
      res.json({ ok: true });
    });

    app.post('/p2p/pin', (req, res) => {
      const { messageId, pinned, pinnedAt, pinnedBy } = req.body || {};
      if (!messageId) return res.status(400).json({ error: 'messageId obrigatório.' });
      this.callbacks.onDmPinned?.({
        peerId: sender(req),
        pairKey: this.pairKeyWith(sender(req)),
        messageId,
        pinned: Boolean(pinned),
        pinnedAt: pinnedAt || null,
        pinnedBy: pinnedBy ? str(pinnedBy, 64) : null,
      });
      res.json({ ok: true });
    });

    /** Grupo recebido de outro membro: só entra/atualiza se o remetente é membro (e eu também). */
    const acceptGroupFrom = (from, rawGroup, callUrl) => {
      const g = this.sanitizeGroup(rawGroup);
      if (!g || !g.memberIds.includes(from) || !g.memberIds.includes(this.peerId)) return null;
      const existing = this.groups.get(g.id);
      if (existing && !(existing.memberIds || []).includes(from)) return null; // quem não é do grupo não mexe nele
      const next = { ...g, ownerId: existing?.ownerId || g.ownerId, createdAt: existing?.createdAt || g.createdAt };
      if (callUrl) next.hostP2pUrl = callUrl;
      else if (!next.hostP2pUrl) next.hostP2pUrl = existing?.hostP2pUrl || '';
      this.groups.set(next.id, next);
      this.persistLocalGroups();
      this.callbacks.onGroupUpdated?.({ group: next });
      return next;
    };

    app.post('/p2p/call-invite', (req, res) => {
      const { dmRoomId, callServerUrl, group } = req.body || {};
      const from = sender(req);
      const fromPeer = fromPeerOf(req);
      const callUrl = okCallUrl(callServerUrl);
      if (!dmRoomId || !callUrl || !fromPeer) return res.status(400).json({ error: 'Convite inválido.' });
      this.upsertPeerFromHttp(fromPeer, req.ip);
      let acceptedGroup = null;
      if (String(dmRoomId).startsWith('group:')) {
        if (!group || String(dmRoomId) !== `group:${group.id}`) return res.status(400).json({ error: 'Convite inválido.' });
        acceptedGroup = acceptGroupFrom(from, group, callUrl);
        if (!acceptedGroup) return res.status(403).json({ error: 'Sem permissão neste grupo.' });
      } else if (String(dmRoomId) !== `dm:${this.pairKeyWith(from)}`) {
        return res.status(403).json({ error: 'Sala inválida.' });
      }
      this.callbacks.onCallIncoming?.({ dmRoomId: String(dmRoomId), callServerUrl: callUrl, fromPeer, group: acceptedGroup || undefined });
      res.json({ ok: true });
    });

    // Ingresso para entrar na call que este PC hospeda (só para quem é da DM/grupo)
    app.post('/p2p/call-ticket', (req, res) => {
      const room = String(req.body?.room || '');
      if (!this.peerMayUseRoom(sender(req), room)) return res.status(403).json({ error: 'Sem permissão nesta call.' });
      res.json({ ticket: this.mintCallTicket(room, sender(req)) });
    });

    app.post('/p2p/group-sync', (req, res) => {
      const { group } = req.body || {};
      if (!group?.id) return res.status(400).json({ error: 'Grupo inválido.' });
      const fp = fromPeerOf(req);
      if (fp) this.upsertPeerFromHttp(fp, req.ip);
      if (!acceptGroupFrom(sender(req), group, '')) return res.status(403).json({ error: 'Sem permissão neste grupo.' });
      res.json({ ok: true });
    });

    app.post('/p2p/group-message', (req, res) => {
      const { groupId, message } = req.body || {};
      const from = sender(req);
      if (!groupId || !message?.id) return res.status(400).json({ error: 'Mensagem de grupo inválida.' });
      if (!this.isGroupMember(groupId, from) || message.authorId !== from) return res.status(403).json({ error: 'Sem permissão neste grupo.' });
      const fp = fromPeerOf(req);
      if (fp) this.upsertPeerFromHttp(fp, req.ip);
      this.callbacks.onGroupMessage?.({ groupId: String(groupId), message: cleanMessage(message, `group:${groupId}`, { authorId: from }) });
      res.json({ ok: true });
    });

    app.post('/p2p/group-pin', (req, res) => {
      const { groupId, messageId, pinned, pinnedAt, pinnedBy } = req.body || {};
      if (!groupId || !messageId) return res.status(400).json({ error: 'Dados inválidos.' });
      if (!this.isGroupMember(groupId, sender(req))) return res.status(403).json({ error: 'Sem permissão neste grupo.' });
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
      const { scopeKey, boards } = req.body || {};
      if (!scopeKey || !Array.isArray(boards)) return res.status(400).json({ error: 'Quadro Trello inválido.' });
      // quadro de DM: só a nossa DM; quadro de grupo: só membro do grupo
      if (!this.peerMayUseRoom(sender(req), String(scopeKey))) return res.status(403).json({ error: 'Sem permissão neste quadro.' });
      const fp = fromPeerOf(req);
      if (fp) this.upsertPeerFromHttp(fp, req.ip);
      boards.splice(15);
      this.trelloBoards.set(scopeKey, boards);
      this.persistLocalTrello();
      this.callbacks.onTrelloUpdated?.({ scopeKey, boards });
      res.json({ ok: true });
    });

    app.post('/p2p/call-respond', (req, res) => {
      const { dmRoomId, accepted } = req.body || {};
      const fromPeer = fromPeerOf(req);
      if (!fromPeer || !this.peerMayUseRoom(sender(req), String(dmRoomId || ''))) return res.status(403).json({ error: 'Sala inválida.' });
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
      allowRequest: (req, cb) => cb(null, isPrivateAddress(req.socket.remoteAddress)),
    });
    // Call LAN: só entra quem tem ingresso (emitido para a DM/grupo certo); cada conexão fica presa à sua sala
    this.io.use((socket, next) => {
      const t = this.verifyCallTicket(socket.handshake.auth?.ticket);
      if (!t) return next(new Error('LAN_TICKET_REQUIRED'));
      socket.data.lanRoom = t.room;
      socket.data.lanPeerId = t.peerId;
      next();
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
    if (!fromPeer?.peerId || fromPeer.peerId === this.peerId || !PEER_ID_RE.test(String(fromPeer.peerId))) return;
    const cleanIp = String(reqIp || '').replace(/^::ffff:/, '') || fromPeer.ip || '127.0.0.1';
    const ip = cleanIp === '::1' ? '127.0.0.1' : cleanIp;
    const p2pPort = Number(fromPeer.p2pPort || 0);
    if (!p2pPort) return;
    this.peers.set(fromPeer.peerId, {
      peerId: fromPeer.peerId,
      username: str(fromPeer.username, 64) || fromPeer.peerId,
      displayName: str(fromPeer.displayName, 64) || 'Amigo LAN',
      avatarColor: str(fromPeer.avatarColor, 32) || '#5865F2',
      avatarUrl: fromPeer.hasAvatar ? `http://${ip}:${p2pPort}/p2p/avatar` : null,
      bannerColor: str(fromPeer.bannerColor, 32) || '#5865F2',
      bio: str(fromPeer.bio, 500),
      statusType: str(fromPeer.statusType, 20) || 'online',
      customStatusEmoji: str(fromPeer.customStatusEmoji, 32),
      customStatusText: str(fromPeer.customStatusText, 128),
      currentActivity: fromPeer.currentActivity && typeof fromPeer.currentActivity === 'object' ? fromPeer.currentActivity : null,
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
        if (!PEER_ID_RE.test(String(data.peerId)) || !isPrivateAddress(rinfo.address)) return;
        // anúncio com chave diferente da registrada para esse amigo = alguém se passando por ele
        if (!this.checkPeerKey(data.peerId, data.pubKey)) return;
        const pnum = Number(data.p2pPort);
        if (!Number.isInteger(pnum) || pnum < 1 || pnum > 65535) return;
        const ip = rinfo.address && rinfo.address !== '0.0.0.0' ? rinfo.address : data.primaryIp || '127.0.0.1';
        const prev = this.peers.get(data.peerId);
        const next = {
          peerId: data.peerId,
          username: str(data.username, 64) || data.peerId,
          displayName: str(data.displayName, 64) || 'Amigo LAN',
          avatarColor: data.avatarColor || '#5865F2',
          avatarUrl: data.hasAvatar ? `http://${ip}:${data.p2pPort}/p2p/avatar` : null,
          bannerColor: data.bannerColor || '#5865F2',
          bio: str(data.bio, 500),
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

    // mesma regra do servidor: gravar a chamada precisa da permissão de todos
    const recConsent = createRecConsent({
      io: this.io,
      getRoom: (ch) => this.voiceRooms.get(ch),
      getChannelOf: (sid) => this.socketVoiceChannel.get(sid),
    });

    const leaveCurrentVoice = (socket) => {
      const prevCh = this.socketVoiceChannel.get(socket.id);
      if (!prevCh) return;
      recConsent.onLeave(socket.id, prevCh);
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
      const lanRoom = socket.data.lanRoom;
      // o id de conta que o cliente diz ter fica preso ao PC (chave) que o usou primeiro nesta sala:
      // outro participante não se passa por ele (lista da call, quadro, desfazer)
      let claimedId = str(q.userId || uuidv4(), 100);
      const bindKey = `${lanRoom}|${claimedId}`;
      const boundPeer = this.lanUserPeer.get(bindKey);
      if (boundPeer && boundPeer !== socket.data.lanPeerId) claimedId = str(socket.data.lanPeerId || uuidv4(), 100);
      else if (!boundPeer && socket.data.lanPeerId) {
        if (this.lanUserPeer.size > 5000) this.lanUserPeer.clear();
        this.lanUserPeer.set(bindKey, socket.data.lanPeerId);
      }
      socket.data.user = {
        userId: claimedId,
        displayName: str(q.displayName || 'Amigo LAN', 64),
        avatarColor: str(q.avatarColor || '#5865F2', 32),
        avatarUrl: typeof q.avatarUrl === 'string' ? q.avatarUrl.slice(0, 2000) : null,
      };
      // Qualquer evento que cite outra sala (channelId/scopeKey) que não a do ingresso é descartado
      socket.use((packet, next) => {
        const payload = packet[1];
        const ack = typeof packet[packet.length - 1] === 'function' ? packet[packet.length - 1] : null;
        if (payload && typeof payload === 'object') {
          for (const k of ['channelId', 'scopeKey']) {
            if (payload[k] != null && payload[k] !== lanRoom) {
              ack?.({ error: 'Sem permissão nesta sala.' });
              return;
            }
          }
        }
        next();
      });
      const sameRoom = (id) =>
        typeof id === 'string' && id.length < 64 && this.io.sockets.sockets.get(id)?.data?.lanRoom === lanRoom;

      socket.on('clock:sync', (clientSentAt, cb) => {
        cb?.({ serverNow: Date.now(), clientSentAt });
      });

      const getOrCreateWb = (ch) => {
        if (!this.whiteboardStates.has(ch)) {
          this.whiteboardStates.set(ch, wbRoom.newState(ch));
        }
        return this.whiteboardStates.get(ch);
      };

      socket.on('voice:join', ({ channelId, muted, deafened } = {}, cb) => {
        if (!channelId || channelId !== lanRoom) return cb?.({ error: 'Sala inválida.' });
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
          recording: null,
          streamsMeta: null,
          joinedAt: Date.now(),
        };
        room.set(socket.id, participant);
        this.socketVoiceChannel.set(socket.id, channelId);
        socket.join(`voice:${channelId}`);
        recConsent.onJoin(channelId, socket.id);

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
          whiteboardState: wbRoom.publicState(getOrCreateWb(channelId)),
        });
      });

      socket.on('voice:leave', () => leaveCurrentVoice(socket));
      socket.on('voice:record-request', (_payload, cb) => recConsent.request(socket, cb));
      socket.on('voice:record-consent', (payload) => recConsent.consent(socket, payload));

      socket.on('voice:media-state', (state) => {
        const ch = this.socketVoiceChannel.get(socket.id);
        const room = ch && this.voiceRooms.get(ch);
        const p = room?.get(socket.id);
        if (!p || !state || typeof state !== 'object') return;
        recConsent.applyRecording(socket, ch, p, state);
        Object.assign(p, {
          ...(typeof state.muted === 'boolean' ? { muted: state.muted } : {}),
          ...(typeof state.deafened === 'boolean' ? { deafened: state.deafened } : {}),
          ...(typeof state.cameraOn === 'boolean' ? { cameraOn: state.cameraOn } : {}),
          ...(typeof state.screenSharing === 'boolean' ? { screenSharing: state.screenSharing } : {}),
          ...(typeof state.screenLabel === 'string' ? { screenLabel: state.screenLabel.slice(0, 64) } : {}),
          ...(Array.isArray(state.notWatching)
            ? {
                notWatching: state.notWatching
                  .filter((id) => typeof id === 'string' && id !== socket.id && room.has(id))
                  .slice(0, 32),
              }
            : {}),
        });
        this.io.to(`voice:${ch}`).emit('voice:media-updated', { channelId: ch, participant: p });
        this.io.to(`voice:${ch}`).emit('dm:voice-participants', Array.from(room.values()));
        this.io.to(`voice:${ch}`).emit('voice:dm-participants', { channelId: ch, participants: Array.from(room.values()) });
      });

      socket.on('rtc:description', ({ targetSocketId, toSocketId, description, streamsMeta }) => {
        const to = targetSocketId || toSocketId;
        if (sameRoom(to) && description) {
          this.io.to(to).emit('rtc:description', { fromSocketId: socket.id, description, streamsMeta });
        }
      });

      socket.on('rtc:ice-candidate', ({ targetSocketId, toSocketId, candidate }) => {
        const to = targetSocketId || toSocketId;
        if (sameRoom(to) && candidate) {
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
          if (sameRoom(targetSocketId)) this.io.to(targetSocketId).emit('rtc:streams-meta', { fromSocketId: socket.id, meta: m, streamsMeta: m });
        } else if (ch) {
          socket.to(`voice:${ch}`).emit('rtc:streams-meta', { fromSocketId: socket.id, meta: m, streamsMeta: m });
        }
      });

      // Whiteboard & Trello inside Direct/Group P2P Calls
      wbRoom.attachWhiteboard(socket, {
        getState: (ch) => getOrCreateWb(ch),
        // a call LAN só tem uma sala por conexão: a do ingresso assinado
        resolveRoom: (ch) => {
          const target = (typeof ch === 'string' && ch) || this.socketVoiceChannel.get(socket.id);
          return target && target === lanRoom ? target : null;
        },
        canDraw: () => true,
        author: () => ({
          id: socket.data.user.userId,
          name: socket.data.user.displayName,
          color: socket.data.user.avatarColor,
        }),
        toRoom: (ch) => this.io.to(`voice:${ch}`),
        toOthers: (ch) => socket.to(`voice:${ch}`),
      });
      socket.on('trello:get', ({ scopeKey }, cb) => {
        cb?.({ ok: true, scopeKey, boards: this.trelloBoards.get(scopeKey) || [] });
      });
      socket.on('trello:sync', ({ scopeKey, boards }, cb) => {
        if (!scopeKey || !Array.isArray(boards)) return cb?.({ error: 'Dados inválidos.' });
        this.trelloBoards.set(scopeKey, boards.slice(0, 15));
        this.persistLocalTrello();
        this.io.to(`voice:${scopeKey}`).emit('trello:updated', { scopeKey, boards: this.trelloBoards.get(scopeKey) });
        if (!socket.rooms.has(`voice:${scopeKey}`)) socket.emit('trello:updated', { scopeKey, boards: this.trelloBoards.get(scopeKey) });
        this.callbacks.onTrelloUpdated?.({ scopeKey, boards: this.trelloBoards.get(scopeKey) });
        cb?.({ ok: true, boards: this.trelloBoards.get(scopeKey) });
      });

      // Controle remoto: "aceitar" só passa se houver convite/pedido real (evita liberar mouse/teclado com um aceite falso)
      const live = sameRoom;
      const permsOf = (p) => ({ mouse: p?.mouse !== false, keyboard: p?.keyboard !== false, gamepad: p?.gamepad !== false });
      if (!this.rcPending) this.rcPending = new Map();
      const pendSet = (from, to, kind) => {
        const now = Date.now();
        for (const [k, v] of this.rcPending) if (now - v.at > 180000) this.rcPending.delete(k);
        this.rcPending.set(`${from}|${to}`, { kind, at: now });
      };
      const pendTake = (from, to) => {
        const key = `${from}|${to}`;
        const v = this.rcPending.get(key);
        this.rcPending.delete(key);
        return v && Date.now() - v.at <= 180000 ? v : null;
      };
      socket.on('rc:invite', ({ targetSocketId } = {}) => {
        if (!live(targetSocketId) || targetSocketId === socket.id) return;
        pendSet(socket.id, targetSocketId, 'invite');
        this.io.to(targetSocketId).emit('rc:invited', { fromSocketId: socket.id, fromName: socket.data.user.displayName });
      });
      socket.on('rc:request', ({ targetSocketId } = {}) => {
        if (!live(targetSocketId) || targetSocketId === socket.id) return;
        pendSet(socket.id, targetSocketId, 'request');
        this.io.to(targetSocketId).emit('rc:requested', { fromSocketId: socket.id, fromName: socket.data.user.displayName });
      });
      socket.on('rc:accept', ({ targetSocketId, permissions } = {}) => {
        if (!live(targetSocketId)) return;
        const pending = pendTake(targetSocketId, socket.id);
        if (!pending) return;
        this.io.to(targetSocketId).emit('rc:accepted', {
          fromSocketId: socket.id,
          fromName: socket.data.user.displayName,
          role: pending.kind === 'invite' ? 'controller' : 'host',
          permissions: permsOf(permissions),
        });
      });
      socket.on('rc:permissions-update', ({ targetSocketId, permissions } = {}) => {
        if (live(targetSocketId) && permissions) {
          this.io.to(targetSocketId).emit('rc:permissions-updated', { fromSocketId: socket.id, permissions: permsOf(permissions) });
        }
      });
      socket.on('rc:decline', ({ targetSocketId } = {}) => {
        if (live(targetSocketId) && pendTake(targetSocketId, socket.id)) {
          this.io.to(targetSocketId).emit('rc:declined', { fromSocketId: socket.id, fromName: socket.data.user.displayName });
        }
      });
      socket.on('rc:revoke', ({ targetSocketId } = {}) => {
        if (live(targetSocketId)) this.io.to(targetSocketId).emit('rc:revoked', { fromSocketId: socket.id });
      });
      socket.on('rc:input', ({ targetSocketId, event } = {}) => {
        if (live(targetSocketId) && event) this.io.to(targetSocketId).emit('rc:input', { fromSocketId: socket.id, event });
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

        const upRes = await this.signedUpload(targetUrl, fileKey, buf, att.mimeType, att.name, 30000);
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

    const resp = await this.signedPost(
      targetUrl,
      '/p2p/dm',
      { message, fromPeer: { ...this.getSelfInfo(), hasAvatar: Boolean(this.identity.avatarDataUrl) } },
      8000
    );
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
      await this.signedPost(targetUrl, '/p2p/pin', payload, 5000).catch(() => {});
    }
    return { ok: true, ...payload };
  }

  async sendCallInvite({ toPeerId, peerUrl, dmRoomId }) {
    const targetUrl = await this.resolveTargetUrl(toPeerId, peerUrl);
    if (!targetUrl) throw new Error('Amigo indisponível na LAN.');
    const self = this.getSelfInfo();
    const callServerUrl = self.shareUrl || `http://127.0.0.1:${this.port}`;
    const resp = await this.signedPost(
      targetUrl,
      '/p2p/call-invite',
      { dmRoomId, callServerUrl, fromPeer: { ...self, hasAvatar: Boolean(this.identity.avatarDataUrl) } },
      6000
    );
    if (!resp.ok) throw new Error('Falha ao enviar convite de chamada privada.');
    return { ok: true, callServerUrl };
  }

  async sendCallRespond({ toPeerId, peerUrl, dmRoomId, accepted }) {
    const targetUrl = await this.resolveTargetUrl(toPeerId, peerUrl);
    if (!targetUrl) return { ok: false };
    await this.signedPost(targetUrl, '/p2p/call-respond', { dmRoomId, accepted: Boolean(accepted), fromPeer: this.getSelfInfo() }, 5000).catch(() => {});
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
          await this.signedPost(url, '/p2p/group-sync', { group, fromPeer }, 5000);
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
              await this.signedUpload(url, att._fileKey, att._rawBuf, att.mimeType, att.name, 20000).catch(() => {});
            }
          }
          await this.signedPost(url, '/p2p/group-message', { groupId, message, fromPeer }, 6000);
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
            await this.signedPost(url, '/p2p/group-pin', payload, 5000);
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
          await this.signedPost(url, '/p2p/call-invite', { dmRoomId, callServerUrl, group, fromPeer }, 6000);
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
        this.signedPost(u, '/p2p/trello-sync', { scopeKey, boards, fromPeer }, 5000)
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
