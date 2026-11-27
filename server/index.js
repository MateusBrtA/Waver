import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { convertBlendToGlb, findBlenderBinary, inspectBlendMetadata } from './blendConverter.js';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_EVERYONE_PERMISSIONS,
  HOST_ALL_PERMISSIONS,
  getDataPaths,
  getDb,
  loadDb,
  normalizeRolePermissions,
  saveDb,
  saveDbNow,
} from './db.js';
import { startLanAdvertiser } from './discovery.js';
import { createSfuManager } from './sfu.js';
import {
  prefetchMedia,
  resolveMusicUrl,
  resolveVideoUrl,
  hasYouTubeCookies,
  setYouTubeCookies,
  streamResolvedMedia,
  unfurlMediaUrl,
} from './mediaResolver.js';
import { clearMediaCache, enforceStorageLimit, getStorageStats } from './storageManager.js';
import { createUpdateHelper } from './updater.js';
import wbRoom from './wbRoom.cjs';
import recConsentMod from './recConsent.cjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AVATAR_COLORS = [
  '#5865F2',
  '#57F287',
  '#FEE75C',
  '#EB459E',
  '#ED4245',
  '#3BA55C',
  '#FAA61A',
  '#00B0F4',
  '#9B59B6',
  '#1ABC9C',
];

export function getNetworkAddresses(port) {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos) continue;
    for (const info of infos) {
      const isV6 = info.family === 'IPv6' || info.family === 6;
      if (isV6 && !info.internal) {
        const a = String(info.address || '').toLowerCase();
        // só endereços alcançáveis: global (2000::/3) e local da rede (fc00::/7); link-local fe80:: fica de fora
        // Teredo (2001:0::/32) é um túnel do Windows que quase nunca recebe conexões: fica de fora
        const isGlobal = /^[23]/.test(a) && !/^2001:0?:/.test(a);
        const isUla = /^f[cd]/.test(a);
        if (!isGlobal && !isUla) continue;
        addresses.push({
          name: `${name} (IPv6${isGlobal ? ' público' : ' da rede local'})`,
          address: a,
          url: `http://[${a}]:${port}`,
          priority: isGlobal ? 4 : 5,
          family: 'IPv6',
        });
        continue;
      }
      if (info.family === 'IPv4' && !info.internal) {
        let label = name;
        let priority = 3;
        if (info.address.startsWith('26.')) {
          label = name.toLowerCase().includes('radmin') ? name : `${name} (Radmin VPN)`;
          priority = 1;
        } else if (info.address.startsWith('100.')) {
          label = `${name} (Tailscale/VPN)`;
          priority = 2;
        } else if (info.address.startsWith('192.168.') || info.address.startsWith('10.')) {
          label = `${name} (Rede Local / VPN)`;
          priority = 2;
        }
        addresses.push({
          name: label,
          address: info.address,
          url: `http://${info.address}:${port}`,
          priority,
        });
      }
    }
  }
  const publicUrl = String(process.env.PULSECORD_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (publicUrl) addresses.push({ name: 'Endereço público', address: publicUrl, url: publicUrl, priority: 0 });
  return addresses.sort((a, b) => a.priority - b.priority);
}

function getDmPairKey(idA, idB) {
  return [String(idA), String(idB)].sort().join('::');
}

function saveDataUrlImage(dataUrl, destDir, prefix) {
  const match = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!match) return null;
  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) return null; // 8MB max for avatar/banner sync
  const filename = `${prefix}-${Date.now()}-${uuidv4().slice(0, 6)}.${ext}`;
  fs.writeFileSync(path.join(destDir, filename), buf);
  return `/uploads/avatars/${filename}`;
}

export function createPulseCordServer(options = {}) {
  const PORT = Number(options.port || process.env.PORT || 3000);
  // '::' escuta IPv6 e IPv4 ao mesmo tempo (dual-stack) no Linux e no Windows; sem IPv6 cai para 0.0.0.0
  const HOST = options.host || process.env.PULSECORD_HOST || process.env.HOST || '::';
  const HEADLESS = Boolean(options.headless);
  const dataDir = options.dataDir || process.env.PULSECORD_DATA_DIR;
  const clientDist = options.clientDistDir || path.join(__dirname, '..', 'client', 'dist');
  const downloadsDir = options.downloadsDir || path.join(__dirname, '..', 'dist-app');

  loadDb(dataDir);
  const dataPaths = getDataPaths();
  const {
    DATA_DIR,
    UPLOADS_DIR,
    IMAGES_DIR,
    TRANSFERS_DIR,
    SOUNDS_DIR,
    MUSIC_DIR,
    AVATARS_DIR,
    MODELS_CACHE_DIR,
    UPDATES_DIR,
  } = dataPaths;

  let appVersion = '3.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    if (pkg?.version) appVersion = pkg.version;
  } catch {}

  const updateHelper = createUpdateHelper({
    appVersion,
    clientDistDir: clientDist,
    downloadsDir,
    updatesDir: UPDATES_DIR,
  });

  const app = express();
  // atrás de um proxy reverso (Caddy/nginx com HTTPS): IP real do cliente vem do X-Forwarded-For
  const trustProxy = String(options.trustProxy ?? process.env.PULSECORD_TRUST_PROXY ?? '').trim();
  if (trustProxy) app.set('trust proxy', trustProxy === 'true' ? true : /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

  // Código do dono (servidor sem tela, ex. Debian): quem entra com ele vira o Host do servidor.
  let OWNER_CODE = '';
  if (HEADLESS) {
    OWNER_CODE = String(process.env.PULSECORD_OWNER_CODE || '').trim();
    const ownerFile = path.join(DATA_DIR, 'owner-code.txt');
    if (!OWNER_CODE) {
      try {
        OWNER_CODE = fs.readFileSync(ownerFile, 'utf8').trim();
      } catch {}
    }
    if (!OWNER_CODE) {
      OWNER_CODE = crypto.randomBytes(9).toString('base64url');
      try {
        fs.writeFileSync(ownerFile, OWNER_CODE + '\n', { mode: 0o600 });
      } catch {}
    }
  }
  const isOwnerCode = (code) => {
    if (!OWNER_CODE || !code) return false;
    const a = Buffer.from(String(code));
    const b = Buffer.from(OWNER_CODE);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  // Limite de tentativas de login por IP (servidor exposto na internet 24 h)
  const loginAttempts = new Map(); // ip -> { count, resetAt }
  const loginRateLimited = (ip) => {
    const now = Date.now();
    let rec = loginAttempts.get(ip);
    if (!rec || rec.resetAt < now) {
      rec = { count: 0, resetAt: now + 60_000 };
      loginAttempts.set(ip, rec);
    }
    rec.count += 1;
    if (loginAttempts.size > 5000) {
      for (const [k, v] of loginAttempts) if (v.resetAt < now) loginAttempts.delete(k);
    }
    return rec.count > 12;
  };

  // TURN próprio (coturn com use-auth-secret): credenciais temporárias geradas aqui, sem senha fixa no cliente
  const TURN_URLS = String(options.turnUrls ?? process.env.PULSECORD_TURN_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const TURN_SECRET = String(options.turnSecret ?? process.env.PULSECORD_TURN_SECRET ?? '');
  const STUN_URLS = String(options.stunUrls ?? process.env.PULSECORD_STUN_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  function buildIceServers(userId) {
    const list = [];
    if (STUN_URLS.length) list.push({ urls: STUN_URLS });
    if (TURN_URLS.length && TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${userId}`;
      const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
      list.push({ urls: TURN_URLS, username, credential });
    }
    return list;
  }

  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );
  app.use(express.json({ limit: '15mb' }));

  app.use(
    '/uploads',
    (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      // arquivo enviado por membro nunca roda como página/script (mesmo aberto direto no navegador)
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; sandbox"
      );
      if (/\.(html?|xhtml|shtml|svg|svgz|xml|xsl|js|mjs|cjs|wasm)$/i.test(req.path)) {
        res.setHeader('Content-Disposition', 'attachment');
        res.type('application/octet-stream');
      }
      next();
    },
    express.static(UPLOADS_DIR, {
      acceptRanges: true,
      maxAge: '7d',
    })
  );

  function sanitizeUser(u) {
    if (!u) return null;
    const baseRoleIds = Array.isArray(u.roleIds) ? u.roleIds : [];
    const roleIds = u.role === 'host' && !baseRoleIds.includes('role-host') ? ['role-host', ...baseRoleIds] : baseRoleIds;
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl || null,
      avatarColor: u.avatarColor || '#5865F2',
      avatarHash: u.avatarHash || null,
      bannerColor: u.bannerColor || '#5865F2',
      bannerUrl: u.bannerUrl || null,
      bannerHash: u.bannerHash || null,
      avatarDecoration: u.avatarDecoration || 'none',
      nameStyle: u.nameStyle || 'default',
      profileEffect: u.profileEffect || 'none',
      profileBgUrl: u.profileBgUrl || null,
      profileBgHash: u.profileBgHash || null,
      bio: u.bio || '',
      pronouns: u.pronouns || '',
      statusType: u.statusType || 'online',
      customStatusEmoji: u.customStatusEmoji || '',
      customStatusText: u.customStatusText || '',
      role: u.role || 'member',
      roleIds,
      badges: Array.isArray(u.badges) ? u.badges : ['nitro', 'early'],
      connections: Array.isArray(u.connections) ? u.connections : [],
      currentActivity: u.currentActivity || null,
      recentActivities: Array.isArray(u.recentActivities) ? u.recentActivities.slice(0, 12) : [],
      serverMuted: Boolean(u.serverMuted),
      serverDeafened: Boolean(u.serverDeafened),
      createdAt: u.createdAt,
    };
  }

  function computeServerPermissions(dbObj, user) {
    if (!user) {
      return Object.fromEntries(ALL_PERMISSION_KEYS.map((k) => [k, false]));
    }
    if (user.role === 'host') return { ...HOST_ALL_PERMISSIONS };

    const everyone = dbObj.roles.find((r) => r.id === 'role-everyone' || r.isEveryone);
    const perms = normalizeRolePermissions(everyone?.permissions, DEFAULT_EVERYONE_PERMISSIONS);
    const roleIds = Array.isArray(user.roleIds) ? user.roleIds : [];

    for (const rid of roleIds) {
      const r = dbObj.roles.find((x) => x.id === rid);
      if (!r) continue;
      if (r.permissions?.administrator) return { ...HOST_ALL_PERMISSIONS };
      for (const key of ALL_PERMISSION_KEYS) {
        if (r.permissions && r.permissions[key]) perms[key] = true;
      }
    }
    return perms;
  }

  // ---- Hierarquia de cargos: ninguém mexe em quem está no mesmo nível ou acima, nem dá o que não tem ----
  function topRolePosition(dbObj, user) {
    if (!user) return -1;
    if (user.role === 'host') return Infinity;
    let top = 0;
    for (const rid of Array.isArray(user.roleIds) ? user.roleIds : []) {
      const r = dbObj.roles.find((x) => x.id === rid);
      if (r && !r.isEveryone && r.id !== 'role-everyone') top = Math.max(top, Number(r.position) || 0);
    }
    return top;
  }
  function canManageRole(dbObj, actor, role) {
    if (!role || role.id === 'role-host') return false;
    if (actor.role === 'host') return true;
    if (role.isEveryone || role.id === 'role-everyone') return true;
    return (Number(role.position) || 0) < topRolePosition(dbObj, actor);
  }
  function canManageMember(dbObj, actor, target) {
    if (!actor || !target || target.role === 'host') return false;
    if (actor.role === 'host') return true;
    if (actor.id === target.id) return false;
    return topRolePosition(dbObj, target) < topRolePosition(dbObj, actor);
  }
  /** Lista de permissões que o autor quer ligar/desligar e que ele mesmo não tem (vazio = ok). */
  function permsBeyondActor(dbObj, actor, changedKeys) {
    if (actor.role === 'host') return [];
    const mine = computeServerPermissions(dbObj, actor);
    return changedKeys.filter((k) => !mine[k]);
  }
  // Permissões que fazem sentido por canal/categoria (nada de administrador, banir, cargos etc.)
  const OVERWRITE_KEYS = new Set([
    'viewChannels', 'viewPrivateChannels', 'manageChannels', 'createInvite', 'sendMessages', 'attachFiles', 'embedLinks',
    'pinMessages', 'manageMessages', 'connectVoice', 'speakVoice', 'streamVideo', 'useSoundboard', 'useMediaQueue',
    'useWhiteboard', 'useTrello', 'muteMembers', 'deafenMembers', 'moveMembers',
  ]);
  function sanitizeOverwrites(dbObj, list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    const seen = new Set();
    for (const o of list.slice(0, 200)) {
      if (!o || typeof o !== 'object') continue;
      const id = String(o.id || '').slice(0, 80);
      if (!id || seen.has(id)) continue;
      const isRole = dbObj.roles.some((r) => r.id === id);
      const isMember = !isRole && dbObj.users.some((u) => u.id === id);
      if (!isRole && !isMember) continue;
      if (id === 'role-host') continue;
      seen.add(id);
      const keys = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : []).filter((k) => OVERWRITE_KEYS.has(k))));
      const allow = keys(o.allow);
      const deny = keys(o.deny).filter((k) => !allow.includes(k));
      out.push({ id, targetType: isRole ? 'role' : 'member', allow, deny });
    }
    return out;
  }
  /**
   * Confere uma troca de overwrites: devolve { list } já limpa, ou { error }.
   * Mexer em permissões de canal exige "Gerenciar cargos"; e só se mexe nas permissões que você mesmo tem.
   */
  function checkOverwriteChange(dbObj, actor, prevList, nextRaw) {
    const next = sanitizeOverwrites(dbObj, nextRaw);
    const flat = (list) => {
      const m = new Set();
      for (const o of list || []) {
        for (const k of o.allow || []) m.add(`${o.id}|${k}|a`);
        for (const k of o.deny || []) m.add(`${o.id}|${k}|d`);
      }
      return m;
    };
    const a = flat(prevList);
    const b = flat(next);
    const changed = new Set();
    for (const x of a) if (!b.has(x)) changed.add(x.split('|')[1]);
    for (const x of b) if (!a.has(x)) changed.add(x.split('|')[1]);
    if (changed.size === 0) return { list: next };
    const perms = computeServerPermissions(dbObj, actor);
    if (actor.role !== 'host' && !perms.manageRoles && !perms.administrator) {
      return { error: 'Mudar permissões de canal exige "Gerenciar cargos".' };
    }
    const beyond = permsBeyondActor(dbObj, actor, Array.from(changed));
    if (beyond.length) return { error: `Você não pode mexer em permissões que não tem: ${beyond.join(', ')}.` };
    return { list: next };
  }

  function applyOverwritesList(perms, overwrites, user) {
    if (!Array.isArray(overwrites) || overwrites.length === 0) return;
    const roleIds = Array.isArray(user.roleIds) ? user.roleIds : [];
    const ev = overwrites.find((o) => o.id === 'role-everyone');
    if (ev) {
      for (const k of ev.deny || []) perms[k] = false;
      for (const k of ev.allow || []) perms[k] = true;
    }
    const roleAllow = new Set();
    const roleDeny = new Set();
    for (const o of overwrites) {
      if (o.targetType === 'role' && o.id !== 'role-everyone' && roleIds.includes(o.id)) {
        for (const k of o.deny || []) roleDeny.add(k);
        for (const k of o.allow || []) roleAllow.add(k);
      }
    }
    for (const k of roleDeny) {
      if (!roleAllow.has(k)) perms[k] = false;
    }
    for (const k of roleAllow) perms[k] = true;

    const mem = overwrites.find((o) => o.id === user.id);
    if (mem) {
      for (const k of mem.deny || []) perms[k] = false;
      for (const k of mem.allow || []) perms[k] = true;
    }
  }

  /** Conta com algum poder de administração/moderação (não pode ser assumida sem confirmação). */
  function isPrivilegedUser(dbObj, user) {
    if (!user) return false;
    if (user.role === 'host') return true;
    const p = computeServerPermissions(dbObj, user);
    return [
      'administrator', 'manageServer', 'manageRoles', 'manageChannels', 'manageExpressions', 'viewAuditLog',
      'kickMembers', 'banMembers', 'manageMessages', 'muteMembers', 'deafenMembers', 'moveMembers',
    ].some((k) => p[k]);
  }

  function computeChannelPermissions(dbObj, user, channel) {
    const perms = computeServerPermissions(dbObj, user);
    if (!user || perms.administrator || user.role === 'host' || !channel) return perms;

    const cat = channel.categoryId ? (dbObj.categories || []).find((c) => c.id === channel.categoryId) : null;
    if (cat?.isPrivate && !perms.viewPrivateChannels) {
      perms.viewChannels = false;
    }
    if (channel.isPrivate && !perms.viewPrivateChannels) {
      perms.viewChannels = false;
    }

    if (cat?.overwrites) applyOverwritesList(perms, cat.overwrites, user);
    if (channel.overwrites) applyOverwritesList(perms, channel.overwrites, user);

    if (!perms.viewChannels) {
      // sem ver o canal, nada mais vale nele (fixar, reagir, apagar, voz...)
      for (const k of Object.keys(perms)) perms[k] = false;
    }
    return perms;
  }

  function getVisibleChannelsForUser(dbObj, user) {
    return (dbObj.channels || []).filter((ch) => computeChannelPermissions(dbObj, user, ch).viewChannels);
  }

  /** Última mensagem de cada canal de texto que a pessoa vê (para a bolinha de "mensagens novas"). */
  function getChannelActivity(dbObj, visibleChannels) {
    const out = {};
    for (const ch of visibleChannels) {
      if (ch.type !== 'text') continue;
      const list = (dbObj.messages || {})[ch.id];
      const last = Array.isArray(list) && list.length ? list[list.length - 1] : null;
      if (last && Number(last.createdAt)) out[ch.id] = { at: Number(last.createdAt), authorId: String(last.authorId || '') };
    }
    return out;
  }

  function isModerator(user) {
    if (!user) return false;
    const p = computeServerPermissions(getDb(), user);
    return (
      p.administrator ||
      p.manageServer ||
      p.manageRoles ||
      p.banMembers ||
      p.kickMembers ||
      p.muteMembers ||
      p.deafenMembers ||
      p.moveMembers
    );
  }

  function appendAuditLog({ type, actor, targetId, targetName, details, reason } = {}) {
    const db = getDb();
    if (!Array.isArray(db.auditLogs)) db.auditLogs = [];
    const entry = {
      id: `audit-${uuidv4().slice(0, 10)}`,
      type: String(type || 'server_update'),
      actorId: actor?.id || 'system',
      actorName: actor?.displayName || 'Sistema',
      actorAvatar: actor?.avatarUrl || null,
      ...(targetId ? { targetId: String(targetId) } : {}),
      ...(targetName ? { targetName: String(targetName) } : {}),
      ...(details ? { details: String(details).slice(0, 220) } : {}),
      ...(reason ? { reason: String(reason).slice(0, 140) } : {}),
      createdAt: Date.now(),
    };
    db.auditLogs.unshift(entry);
    if (db.auditLogs.length > 1000) db.auditLogs = db.auditLogs.slice(0, 1000);
    saveDb();
    for (const s of io.sockets.sockets.values()) {
      const u = db.users.find((x) => x.id === s.data.userId);
      if (u && computeServerPermissions(db, u).viewAuditLog) {
        s.emit('audit:entry', entry);
      }
    }
    return entry;
  }

  function getPublicServerInfo() {
    const db = getDb();
    return {
      name: db.server.name,
      description: db.server.description,
      iconColor: db.server.iconColor,
      iconUrl: db.server.iconUrl || null,
      bannerColor: db.server.bannerColor || db.server.iconColor || '#5865F2',
      bannerUrl: db.server.bannerUrl || null,
      tags: Array.isArray(db.server.tags) ? db.server.tags : [],
      createdAt: db.server.createdAt || Date.now(),
      hasInvitePassword: Boolean(db.server.hasInvitePassword && db.server.invitePasswordHash),
      allowMembersCreateChannels: db.server.allowMembersCreateChannels !== false,
      hasTenorKey: Boolean(db.server.tenorApiKey),
      hasKlipyKey: Boolean(db.server.klipyApiKey),
      hasGiphyKey: Boolean(db.server.giphyApiKey),
      hasYoutubeCookies: hasYouTubeCookies(DATA_DIR),
    };
  }

  function getTokenFromReq(req) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return null;
  }

  function requireAuth(req, res, next) {
    const token = getTokenFromReq(req);
    if (!token) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    const db = getDb();
    const userId = db.sessions[token];
    const user = db.users.find((u) => u.id === userId);
    if (!user) return res.status(401).json({ error: 'Sessão inválida. Faça login novamente.' });
    req.user = user;
    req.token = token;
    next();
  }

  function createUploader(destDir, maxFileSizeMB) {
    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 14);
        const safeExt = /^[a-z0-9.]+$/i.test(ext) ? ext : '';
        cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${safeExt}`);
      },
    });
    return multer({
      storage,
      limits: { fileSize: maxFileSizeMB * 1024 * 1024 },
    });
  }

  const uploadChat = createUploader(IMAGES_DIR, 60);
  const uploadTransfer = createUploader(TRANSFERS_DIR, 1850); // Up to ~1.85 GB (strictly under 2 GB total cap!)
  const uploadSound = createUploader(SOUNDS_DIR, 15);
  const uploadMusic = createUploader(MUSIC_DIR, 80);
  const uploadAvatar = createUploader(AVATARS_DIR, 8);
  const uploadUpdateExe = createUploader(UPDATES_DIR, 450);

  const server = http.createServer(app);
  // Allow long-running LAN uploads up to 2 GB without premature HTTP timeout
  server.requestTimeout = 0;
  server.headersTimeout = 120000;

  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    },
    maxHttpBufferSize: 10e6,
  });

  // Live state
  const onlineUsers = new Map(); // userId -> Set<socketId>
  const voiceRooms = new Map(); // channelId -> Map<socketId, VoiceParticipant>
  const socketVoiceChannel = new Map(); // socketId -> channelId
  const musicStates = new Map();
  const videoStates = new Map();
  const whiteboardStates = new Map();
  const lastChannelMsgAt = new Map();
  const inFlightOneTimeTransfers = new Set();
  const instanceId = uuidv4();
  let activePort = PORT;
  let advertiser = null;
  let cachePruneTimer = null;

  // SFU opcional (mediasoup): só liga com PULSECORD_SFU=1/auto e se o mediasoup carregar nesta máquina
  const sfu = createSfuManager({
    options: options.sfu || {},
    emitTo: (socketId, event, payload) => io.to(socketId).emit(event, payload),
    getSocketChannel: (socketId) => socketVoiceChannel.get(socketId),
    onRoomClosed: (channelId) => io.to(`voice:${channelId}`).emit('sfu:mode', { channelId, enabled: false }),
  });
  let sfuInitPromise = null;

  // Para todos só vai o estado do arquivo (quem já tem a mensagem atualiza); nome e link de download não vazam
  function transferStatus(t) {
    return { id: t.id, burned: Boolean(t.burned), expiredByCache: Boolean(t.expiredByCache), downloadedCount: t.downloadedCount || 0 };
  }

  function markFilePrunedInDb({ bucket, filename, relUrl }) {
    const db = getDb();
    let changed = false;

    if (bucket === 'transfers') {
      for (const t of Object.values(db.transfers)) {
        if (t.filename === filename) {
          t.expiredByCache = true;
          changed = true;
          io.emit('transfer:updated', transferStatus(t));
        }
      }
    }

    const markMsgs = (collections) => {
      for (const list of Object.values(collections)) {
        for (const msg of list) {
          if (Array.isArray(msg.attachments)) {
            for (const att of msg.attachments) {
              if (att.url === relUrl) {
                att.prunedByCache = true;
                changed = true;
              }
            }
          }
          if (msg.transfer && msg.transfer.filename === filename) {
            msg.transfer.expiredByCache = true;
            changed = true;
          }
        }
      }
    };
    markMsgs(db.messages || {});
    markMsgs(db.directMessages || {});
    if (changed) saveDb();
  }

  function runStorageEnforce(incomingBytes = 0) {
    return enforceStorageLimit(dataPaths, incomingBytes, markFilePrunedInDb);
  }

  function setServerMeta({ name, iconColor, iconDataUrl, description } = {}) {
    const db = getDb();
    if (typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 40) {
      db.server.name = name.trim();
    }
    if (typeof iconColor === 'string' && /^#[0-9a-f]{6}$/i.test(iconColor)) {
      db.server.iconColor = iconColor;
    }
    if (typeof iconDataUrl === 'string' && iconDataUrl.startsWith('data:image/')) {
      const saved = saveDataUrlImage(iconDataUrl, AVATARS_DIR, 'srv-icon');
      if (saved) db.server.iconUrl = saved;
    }
    if (typeof description === 'string') {
      db.server.description = description.trim().slice(0, 160);
    }
    saveDbNow();
    const info = getPublicServerInfo();
    io.emit('server:updated', info);
    advertiser?.broadcastNow();
    return info;
  }

  function setServerPassword(rawPassword) {
    const db = getDb();
    const pwd = String(rawPassword || '').trim();
    if (pwd.length > 0) {
      db.server.invitePasswordHash = bcrypt.hashSync(pwd, 8);
      db.server.hasInvitePassword = true;
    } else {
      db.server.invitePasswordHash = null;
      db.server.hasInvitePassword = false;
    }
    saveDbNow();
    io.emit('server:updated', getPublicServerInfo());
    advertiser?.broadcastNow();
    return getPublicServerInfo();
  }

  function getOrCreateMusicState(channelId) {
    if (!musicStates.has(channelId)) {
      musicStates.set(channelId, {
        queue: [],
        currentIndex: -1,
        isPlaying: false,
        positionSec: 0,
        updatedAt: Date.now(),
        loopMode: 'none',
        seq: 0,
        lastAction: 'init',
        actorName: '',
      });
    }
    return musicStates.get(channelId);
  }

  function serializeMusicState(channelId) {
    const s = getOrCreateMusicState(channelId);
    const now = Date.now();
    let livePosition = s.positionSec;
    if (s.isPlaying && s.currentIndex >= 0 && s.currentIndex < s.queue.length) {
      livePosition = s.positionSec + Math.max(0, (now - s.updatedAt) / 1000);
    }
    return {
      channelId,
      queue: s.queue,
      currentIndex: s.currentIndex,
      isPlaying: s.isPlaying,
      positionSec: livePosition,
      updatedAt: now,
      loopMode: s.loopMode,
      seq: s.seq || 0,
      lastAction: s.lastAction || 'init',
      actorName: s.actorName || '',
      serverNow: now,
    };
  }

  function broadcastMusicState(channelId, action = null, actorName = '') {
    const s = getOrCreateMusicState(channelId);
    s.seq = (s.seq || 0) + 1;
    if (action) s.lastAction = action;
    if (actorName) s.actorName = actorName;
    io.to(`voice:${channelId}`).emit('music:state', serializeMusicState(channelId));
  }

  function prefetchNextMusicTrack(channelId) {
    const m = musicStates.get(channelId);
    if (!m || m.queue.length === 0) return;
    const indices = new Set();
    if (m.currentIndex >= 0 && m.currentIndex < m.queue.length) {
      indices.add(m.currentIndex);
      if (m.currentIndex + 1 < m.queue.length) indices.add(m.currentIndex + 1);
      if (m.currentIndex + 2 < m.queue.length) indices.add(m.currentIndex + 2);
      else if (m.loopMode === 'all' && m.queue.length > 0) indices.add(0);
    } else if (m.queue.length > 0) {
      indices.add(0);
      if (m.queue.length > 1) indices.add(1);
    }
    for (const idx of indices) {
      const mid = m.queue[idx]?.mediaId;
      if (mid) prefetchMedia(mid, DATA_DIR);
    }
  }

  function getOrCreateVideoState(channelId) {
    if (!videoStates.has(channelId)) {
      videoStates.set(channelId, {
        queue: [],
        currentIndex: -1,
        isPlaying: false,
        positionSec: 0,
        updatedAt: Date.now(),
        seq: 0,
        lastAction: 'init',
        actorName: '',
        rate: 1,
      });
    }
    return videoStates.get(channelId);
  }
  const videoRate = (s) => (Number.isFinite(s?.rate) && s.rate > 0 ? s.rate : 1);

  function serializeVideoState(channelId) {
    const s = getOrCreateVideoState(channelId);
    const now = Date.now();
    let livePosition = s.positionSec;
    if (s.isPlaying && s.currentIndex >= 0 && s.currentIndex < s.queue.length) {
      livePosition = s.positionSec + Math.max(0, (now - s.updatedAt) / 1000) * videoRate(s);
    }
    return {
      channelId,
      queue: s.queue,
      currentIndex: s.currentIndex,
      isPlaying: s.isPlaying,
      positionSec: livePosition,
      updatedAt: now,
      seq: s.seq || 0,
      lastAction: s.lastAction || 'init',
      actorName: s.actorName || '',
      rate: videoRate(s),
      serverNow: now,
    };
  }

  function broadcastVideoState(channelId, action = null, actorName = '') {
    const s = getOrCreateVideoState(channelId);
    s.seq = (s.seq || 0) + 1;
    if (action) s.lastAction = action;
    if (actorName) s.actorName = actorName;
    io.to(`voice:${channelId}`).emit('video:state', serializeVideoState(channelId));
  }

  function getVoiceRoomsSnapshot() {
    const snap = {};
    for (const [channelId, roomMap] of voiceRooms.entries()) {
      // Do not expose private DM or Private Group call rooms in the public server sidebar snapshot
      if (channelId.startsWith('dm:') || channelId.startsWith('group:')) continue;
      snap[channelId] = Array.from(roomMap.values());
    }
    return snap;
  }

  function emitChannelsUpdated() {
    const db = getDb();
    for (const s of io.sockets.sockets.values()) {
      const u = db.users.find((x) => x.id === s.data.userId);
      if (u) s.emit('channels:updated', getVisibleChannelsForUser(db, u));
    }
  }

  function emitCategoriesUpdated() {
    const db = getDb();
    io.emit('categories:updated', db.categories || []);
  }

  function getOrCreateWhiteboardState(channelId) {
    if (!whiteboardStates.has(channelId)) {
      whiteboardStates.set(channelId, wbRoom.newState(channelId));
    }
    return whiteboardStates.get(channelId);
  }

  function canAccessTrelloScope(db, user, scopeKey) {
    if (!scopeKey || scopeKey === 'server') return computeServerPermissions(db, user).viewChannels;
    if (scopeKey.startsWith('dm:')) {
      return scopeKey.slice(3).split('::').includes(user.id);
    }
    if (scopeKey.startsWith('group:')) {
      const gid = scopeKey.slice(6);
      const grp = db.dmGroups?.[gid];
      return Boolean(grp && Array.isArray(grp.memberIds) && grp.memberIds.includes(user.id));
    }
    return false;
  }

  function emitTrelloUpdate(db, scopeKey, boards) {
    if (scopeKey === 'server') {
      io.emit('trello:updated', { scopeKey, boards });
      return;
    }
    if (scopeKey.startsWith('dm:')) {
      for (const uid of scopeKey.slice(3).split('::')) {
        emitToUser(uid, 'trello:updated', { scopeKey, boards });
      }
      return;
    }
    if (scopeKey.startsWith('group:')) {
      const grp = db.dmGroups?.[scopeKey.slice(6)];
      for (const uid of grp?.memberIds || []) {
        emitToUser(uid, 'trello:updated', { scopeKey, boards });
      }
    }
  }

  // viewerId: quem vai receber a lista. Só a própria pessoa vê que está Invisível e o que está fazendo.
  function getMembersPayload(viewerId = null) {
    const db = getDb();
    return db.users.map((u) => {
      const isOnline = onlineUsers.has(u.id) && onlineUsers.get(u.id).size > 0;
      const clean = sanitizeUser(u);
      // Invisível: aparece offline e não mostra o que está fazendo (jogo, música, histórico de atividades)
      const invisible = clean.statusType === 'invisible';
      const hidden = invisible && u.id !== viewerId;
      return {
        ...clean,
        ...(hidden ? { statusType: 'online', currentActivity: null, recentActivities: [] } : {}),
        online: isOnline && !invisible,
        actuallyConnected: hidden ? false : isOnline,
      };
    });
  }

  // Várias mudanças no mesmo instante (entrar na call + status + atividade) viram UMA transmissão:
  // a lista inteira de membros/salas não é serializada e enviada a todos várias vezes seguidas.
  let usersBroadcastTimer = null;
  let roomsBroadcastTimer = null;
// Um único emoji (grafema inteiro: não corta sequências como 👨‍👩‍👧 ou bandeiras no meio)
const emojiSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
function oneEmoji(v, maxUnits = 32) {
  const str = String(v || '').trim();
  if (!str) return '';
  let g = '';
  if (emojiSegmenter) g = emojiSegmenter.segment(str)[Symbol.iterator]().next().value?.segment || '';
  else g = Array.from(str)[0] || '';
  return g.length <= maxUnits && !/[<>\s]/.test(g) ? g : '';
}

// Atividade vinda do app (jogo, música): só campos conhecidos e com tamanho limitado
function sanitizeActivity(a) {
  if (!a || typeof a !== 'object' || typeof a.name !== 'string' || !a.name.trim()) return null;
  const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : undefined);
  return {
    name: a.name.trim().slice(0, 64),
    icon: str(a.icon, 8) || '🎮',
    category: ['game', 'music', 'app'].includes(a.category) ? a.category : 'app',
    color: /^#[0-9a-f]{3,8}$/i.test(String(a.color || '')) ? a.color : '#5865f2',
    details: str(a.details, 128),
    state: str(a.state, 128),
    startedAt: num(a.startedAt),
    lastPlayedAt: num(a.lastPlayedAt),
    totalMinutes: Number.isFinite(Number(a.totalMinutes)) ? Math.max(0, Number(a.totalMinutes)) : undefined,
  };
}

  function broadcastUsers() {
    if (usersBroadcastTimer) return;
    usersBroadcastTimer = setTimeout(() => {
      usersBroadcastTimer = null;
      io.emit('users:update', getMembersPayload());
      // quem está Invisível recebe logo depois a lista com a própria entrada sem máscara
      for (const u of getDb().users) {
        if (u.statusType !== 'invisible') continue;
        const sids = onlineUsers.get(u.id);
        if (!sids || !sids.size) continue;
        const own = getMembersPayload(u.id);
        for (const sid of sids) io.sockets.sockets.get(sid)?.emit('users:update', own);
      }
    }, 50);
  }

  // convites/pedidos de controle remoto ainda sem resposta: `${de}|${para}` -> { kind, at }
  const rcPending = new Map();
  const RC_PENDING_TTL = 3 * 60 * 1000;
  function rcPendingSet(from, to, kind) {
    const now = Date.now();
    if (rcPending.size > 500) {
      for (const [k, v] of rcPending) if (now - v.at > RC_PENDING_TTL) rcPending.delete(k);
    }
    rcPending.set(`${from}|${to}`, { kind, at: now });
  }
  function rcPendingTake(from, to) {
    const key = `${from}|${to}`;
    const p = rcPending.get(key);
    rcPending.delete(key);
    if (!p || Date.now() - p.at > RC_PENDING_TTL) return null;
    return p;
  }
  function rcPendingForget(socketId) {
    for (const k of rcPending.keys()) if (k.startsWith(`${socketId}|`) || k.endsWith(`|${socketId}`)) rcPending.delete(k);
  }

  function broadcastVoiceRooms() {
    if (roomsBroadcastTimer) return;
    roomsBroadcastTimer = setTimeout(() => {
      roomsBroadcastTimer = null;
      io.emit('voice:rooms', getVoiceRoomsSnapshot());
    }, 30);
  }

  function emitToUser(userId, event, payload) {
    const set = onlineUsers.get(userId);
    if (!set) return;
    for (const sid of set) {
      io.to(sid).emit(event, payload);
    }
  }

  function findDownloadableExe(kind = 'setup') {
    const candidates =
      kind === 'portable'
        ? [
            path.join(downloadsDir, 'Waver-Portable.exe'),
            path.join(__dirname, '..', 'Waver-Portable.exe'),
            path.join(downloadsDir, 'PulseCord-Portable.exe'),
            path.join(__dirname, '..', 'PulseCord-Portable.exe'),
          ]
        : [
            path.join(downloadsDir, 'Waver-Setup.exe'),
            path.join(__dirname, '..', 'Waver-Setup.exe'),
            path.join(downloadsDir, 'PulseCord-Setup.exe'),
            path.join(__dirname, '..', 'PulseCord-Setup.exe'),
            path.join(downloadsDir, 'Waver-Portable.exe'),
            path.join(downloadsDir, 'PulseCord-Portable.exe'),
          ];
    return candidates.find((p) => fs.existsSync(p)) || null;
  }

  function isStageModerator(user, chPerms) {
    if (!user) return false;
    if (user.role === 'host') return true;
    const p = chPerms || {};
    return Boolean(p.administrator || p.muteMembers || p.moveMembers || p.manageChannels);
  }

  function syncUserIntoVoiceRooms(user) {
    for (const roomMap of voiceRooms.values()) {
      for (const p of roomMap.values()) {
        if (p.userId === user.id) {
          p.displayName = user.displayName;
          p.avatarColor = user.avatarColor;
          p.avatarUrl = user.avatarUrl;
          p.avatarDecoration = user.avatarDecoration || 'none';
          p.serverMuted = Boolean(user.serverMuted) || Boolean(p.noSpeak) || p.stageRole === 'audience';
          p.serverDeafened = Boolean(user.serverDeafened);
        }
      }
    }
  }

  // ========================
  // REST API
  // ========================

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      version: appVersion,
      server: getPublicServerInfo(),
      addresses: getNetworkAddresses(activePort),
      hasDownloadableExe: Boolean(findDownloadableExe('setup') || findDownloadableExe('portable')),
      sfu: sfu.publicInfo(),
    });
  });

  app.get('/api/download-client', (req, res) => {
    const kind = req.query.kind === 'portable' ? 'portable' : 'setup';
    const exePath = findDownloadableExe(kind);
    if (!exePath) {
      return res.status(404).json({ error: 'Executável .exe não encontrado nesta pasta do host.' });
    }
    res.download(exePath, path.basename(exePath));
  });

  app.get('/api/network-info', requireAuth, (_req, res) => {
    res.json({ port: activePort, addresses: getNetworkAddresses(activePort) });
  });

  // Storage & 2 GB Cache Cap API
  app.get('/api/storage', requireAuth, (_req, res) => {
    res.json({ storage: getStorageStats(dataPaths) });
  });

  app.post('/api/storage/clear', requireAuth, (req, res) => {
    if (!isModerator(req.user)) {
      return res.status(403).json({ error: 'Apenas o host ou moderadores podem limpar o cache do servidor.' });
    }
    const result = clearMediaCache(dataPaths, markFilePrunedInDb);
    res.json({ ok: true, ...result });
  });

  // Media Unfurl, Resolver & Stream Proxy (YouTube / Twitter / Instagram / TikTok / Spotify / SoundCloud)
  app.get('/api/media/unfurl', requireAuth, async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) return res.status(400).json({ error: 'URL obrigatória.' });
    try {
      const embed = await unfurlMediaUrl(rawUrl, DATA_DIR);
      res.json({ embed });
    } catch (err) {
      res.status(400).json({ error: err?.message || 'Não foi possível gerar prévia.' });
    }
  });

  app.post('/api/media/resolve', requireAuth, async (req, res) => {
    const rawUrl = String(req.body?.url || '').trim();
    const mode = req.body?.mode === 'video' ? 'video' : 'audio';
    if (!rawUrl) return res.status(400).json({ error: 'Informe um link válido.' });
    try {
      if (mode === 'video') {
        const video = await resolveVideoUrl(rawUrl, DATA_DIR);
        return res.json({ mode: 'video', video });
      } else {
        const result = await resolveMusicUrl(rawUrl, DATA_DIR);
        return res.json({ mode: 'audio', ...result });
      }
    } catch (err) {
      return res.status(400).json({ error: err?.message || 'Não foi possível extrair mídia deste link.' });
    }
  });

  app.get('/api/media/stream/:id', (req, res) => {
    streamResolvedMedia(req.params.id, req, res, DATA_DIR);
  });

  app.get('/api/media/yt-embed/:videoId', (req, res) => {
    const vid = String(req.params.videoId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!vid) return res.status(400).send('Invalid videoId');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`<!DOCTYPE html>
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
  var videoId = ${JSON.stringify(vid)};
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
        controls: 0,
        disablekb: 1,
        fs: 0,
        cc_load_policy: 0,
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
        },
        onApiChange: function() {
          postCaptions();
        }
      }
    });
  }
  var wantCaptions = false;
  var wantLang = '';
  function postCaptions() {
    try {
      var list = (player && player.getOption && player.getOption('captions', 'tracklist')) || [];
      post({
        event: 'captions',
        tracks: list.map(function(t) { return { code: t.languageCode, name: t.displayName || t.languageName || t.languageCode }; })
      });
      if (wantCaptions && wantLang && player.setOption) player.setOption('captions', 'track', { languageCode: wantLang });
    } catch (e) {}
  }
  function applyCaptions() {
    if (!player) return;
    try {
      if (wantCaptions) {
        player.loadModule && player.loadModule('captions');
        if (wantLang && player.setOption) player.setOption('captions', 'track', { languageCode: wantLang });
      } else {
        player.unloadModule && player.unloadModule('captions');
      }
    } catch (e) {}
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
      else if (msg.cmd === 'rate' && player.setPlaybackRate) player.setPlaybackRate(Number(msg.rate || 1));
      else if (msg.cmd === 'captions') {
        wantCaptions = Boolean(msg.on);
        wantLang = String(msg.lang || '');
        applyCaptions();
        setTimeout(postCaptions, 600);
      }
      else if (msg.cmd === 'volume') {
        var vol = Math.max(0, Math.min(100, Math.round(Number(msg.volume || 0) * 100)));
        if (vol === 0 && player.mute) player.mute();
        else if (player.unMute) { player.unMute(); if (player.setVolume) player.setVolume(vol); }
      }
    } catch (e) {}
  });
</script>
</body>
</html>`);
  });

  // 3D Blender Converter & Inspector
  app.post('/api/3d/convert-blend', requireAuth, async (req, res) => {
    const fileUrl = String(req.body?.fileUrl || '').trim();
    const db = getDb();
    let localPath = '';

    if (fileUrl.startsWith('/uploads/images/')) {
      localPath = path.join(IMAGES_DIR, path.basename(fileUrl));
    } else if (fileUrl.startsWith('/api/transfers/')) {
      const m = fileUrl.match(/\/api\/transfers\/([^/]+)\/download/);
      const tr = m && db.transfers[m[1]];
      if (tr && !tr.burned && !tr.expiredByCache) {
        localPath = path.join(TRANSFERS_DIR, tr.filename);
      }
    }

    if (!localPath || !fs.existsSync(localPath)) {
      return res.status(404).json({ error: 'Arquivo .blend não encontrado no servidor.' });
    }

    let metadata = null;
    try {
      metadata = inspectBlendMetadata(localPath);
    } catch (err) {
      return res.status(400).json({ error: err?.message || 'Arquivo .blend inválido.' });
    }

    const baseHash = crypto.createHash('md5').update(path.basename(localPath)).digest('hex').slice(0, 12);
    const outGlbName = `${baseHash}.glb`;
    const outGlbPath = path.join(MODELS_CACHE_DIR, outGlbName);

    if (fs.existsSync(outGlbPath)) {
      return res.json({
        convertedGlbUrl: `/uploads/models/${outGlbName}`,
        metadata,
        hasHostBlender: Boolean(findBlenderBinary()),
      });
    }

    const hasBlender = Boolean(findBlenderBinary());
    if (!hasBlender) {
      return res.json({
        convertedGlbUrl: null,
        metadata,
        hasHostBlender: false,
      });
    }

    try {
      await convertBlendToGlb(localPath, outGlbPath);
      runStorageEnforce(0);
      return res.json({
        convertedGlbUrl: `/uploads/models/${outGlbName}`,
        metadata,
        hasHostBlender: true,
      });
    } catch (err) {
      return res.json({
        convertedGlbUrl: null,
        metadata,
        hasHostBlender: true,
        conversionError: err?.message || 'Erro ao converter via Blender.',
      });
    }
  });

  // In-App LAN Auto-Updater (Hot UI + Silent Installer)
  app.get('/api/update/manifest', (_req, res) => {
    res.json(updateHelper.getManifest());
  });

  app.get('/api/update/ui-bundle', (_req, res) => {
    const bundle = updateHelper.getUiBundleBuffer();
    if (!bundle) return res.status(404).json({ error: 'Pacote de interface indisponível.' });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('X-PulseCord-UI-Hash', bundle.hash);
    res.setHeader('Cache-Control', 'no-store');
    res.send(bundle.buffer);
  });

  app.get('/api/update/installer', (req, res) => {
    const inst = updateHelper.findInstallerMeta(req.query.kind === 'portable' ? 'portable' : 'any');
    if (!inst || !fs.existsSync(inst.path)) {
      return res.status(404).json({ error: 'Nenhum instalador de atualização disponível no Host.' });
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', inst.size);
    res.setHeader('Content-Disposition', `attachment; filename="${inst.name}"`);
    res.setHeader('X-PulseCord-Installer-Name', inst.name);
    if (inst.sha256) res.setHeader('X-PulseCord-Sha256', inst.sha256);
    if (inst.signature) res.setHeader('X-PulseCord-Signature', Buffer.from(JSON.stringify(inst.signature)).toString('base64'));
    res.setHeader('Cache-Control', 'no-store');
    const stream = fs.createReadStream(inst.path, { highWaterMark: 1024 * 1024 });
    req.on('close', () => stream.destroy());
    stream.pipe(res);
  });

  const publishUpload = uploadUpdateExe.fields([
    { name: 'installer', maxCount: 1 },
    { name: 'signature', maxCount: 1 },
  ]);
  app.post('/api/update/publish-installer', requireAuth, publishUpload, (req, res) => {
    const exeFile = req.files?.installer?.[0];
    const sigFile = req.files?.signature?.[0];
    const cleanup = () => {
      for (const f of [exeFile, sigFile]) if (f?.path) try { fs.unlinkSync(f.path); } catch {}
    };
    if (req.user.role !== 'host') {
      cleanup();
      return res.status(403).json({ error: 'Apenas o Host pode publicar atualizações do app.' });
    }
    if (!exeFile) {
      cleanup();
      return res.status(400).json({ error: 'Envie o arquivo Waver-Setup.exe ou Waver-Portable.exe.' });
    }
    let signatureJson = null;
    if (sigFile) {
      try {
        signatureJson = JSON.parse(fs.readFileSync(sigFile.path, 'utf8'));
      } catch {}
      try { fs.unlinkSync(sigFile.path); } catch {}
    }
    try {
      const manifest = updateHelper.savePublishedInstaller(
        exeFile.path,
        exeFile.originalname,
        String(req.body?.version || appVersion).trim().slice(0, 24),
        String(req.body?.notes || '').trim().slice(0, 200),
        signatureJson
      );
      io.emit('update:available', manifest);
      res.json({ ok: true, manifest });
    } catch (err) {
      res.status(500).json({ error: err?.message || 'Erro ao publicar atualização.' });
    }
  });

  // Servidores STUN/TURN que este servidor oferece aos clientes (configurados no host)
  app.get('/api/rtc/ice-servers', requireAuth, (req, res) => {
    res.json({ iceServers: buildIceServers(req.user.id) });
  });

  // Auth
  app.post('/api/auth/login', (req, res) => {
    const db = getDb();
    const rawUsername = String(req.body?.username || '').trim();
    const displayNameInput = String(req.body?.displayName || '').trim();
    const password = String(req.body?.password || '');
    const invitePassword = String(req.body?.invitePassword || '');
    const hostSelfJoin = Boolean(req.body?.hostSelfJoin);

    if (rawUsername.length < 2 || rawUsername.length > 24) {
      return res.status(400).json({ error: 'Seu nick deve ter entre 2 e 24 caracteres.' });
    }

    const asciiClean = rawUsername
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '');
    const normalized =
      asciiClean.length >= 2
        ? asciiClean
        : `user-${crypto.createHash('md5').update(rawUsername).digest('hex').slice(0, 6)}`;

    const remoteAddr = req.socket?.remoteAddress || '';
    // "Local" só vale para o app do próprio Host falando direto com o servidor. Pelo túnel (cloudflared) ou por um
    // proxy (Caddy/nginx) TODO acesso chega de 127.0.0.1 — antes isso deixava qualquer um entrar como dono, sem senha.
    // Os proxies sempre acrescentam um destes cabeçalhos, e quem está do lado de fora não consegue removê-los.
    const viaProxy = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'cf-ray', 'true-client-ip', 'x-forwarded-host'].some(
      (h) => req.headers[h] !== undefined
    );
    const isLoopbackReq =
      !HEADLESS &&
      !viaProxy &&
      (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1');
    // Pelo túnel da Cloudflare (cloudflared do app do Host) todo mundo chega de 127.0.0.1: sem isto, todos dividiriam
    // o mesmo limite e uma pessoa poderia travar o login dos outros. O cabeçalho só vale no Host do app, sem proxy
    // configurado e vindo do loopback (o cloudflared local; a borda da Cloudflare sempre o reescreve). Atrás de um
    // proxy (Caddy/nginx, com PULSECORD_TRUST_PROXY) o cabeçalho viria do visitante, então lá vale o req.ip.
    const fromLoopback = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
    const cfIp = String(req.headers['cf-connecting-ip'] || '').trim();
    const useCfIp = !HEADLESS && !trustProxy && fromLoopback && cfIp && cfIp.length <= 64 && /^[0-9a-f:.]+$/i.test(cfIp);
    const limitKey = useCfIp ? `cf:${cfIp}` : req.ip || remoteAddr;
    if (!isLoopbackReq && loginRateLimited(limitKey)) {
      return res.status(429).json({ error: 'Muitas tentativas de entrar. Espere um minuto e tente de novo.' });
    }
    const ownerCodeOk = isOwnerCode(req.body?.ownerCode);
    if (req.body?.ownerCode && !ownerCodeOk) {
      return res.status(403).json({ error: 'Código do dono incorreto.' });
    }
    const isHostBypass = (hostSelfJoin && isLoopbackReq) || ownerCodeOk;

    // Check Ban list
    const banned = db.bans.find((b) => b.username === normalized);
    if (banned && !isHostBypass) {
      return res.status(403).json({
        error: `Você foi banido deste servidor${banned.reason ? ` (${banned.reason})` : ''}.`,
        code: 'BANNED',
      });
    }

    // Require server password for non-host users when active
    if (db.server.hasInvitePassword && db.server.invitePasswordHash && !isHostBypass) {
      const inviteValid = invitePassword && bcrypt.compareSync(invitePassword, db.server.invitePasswordHash);
      if (!inviteValid) {
        return res.status(403).json({
          error: invitePassword
            ? 'Senha do servidor incorreta.'
            : 'Este servidor é protegido por senha. Digite a senha para entrar.',
          code: 'SERVER_PASSWORD_REQUIRED',
        });
      }
    }

    // Chave de login: cada conta sem senha ganha uma chave aleatória que fica guardada no app de quem a criou.
    // Sem ela, ninguém entra numa conta que já existe só digitando o mesmo nick.
    const loginKeys = (Array.isArray(req.body?.loginKeys) ? req.body.loginKeys : [])
      .filter((k) => typeof k === 'string' && k.length >= 32 && k.length <= 128)
      .slice(0, 25);
    const wantsLoginKey = req.body?.wantsLoginKey === true;
    const loginKeyOk = (u) => {
      if (!u.loginKeyHash) return false;
      const want = Buffer.from(String(u.loginKeyHash), 'hex');
      return loginKeys.some((k) => {
        const got = crypto.createHash('sha256').update(k).digest();
        return got.length === want.length && crypto.timingSafeEqual(got, want);
      });
    };
    let user = db.users.find((u) => u.username === normalized);
    if (user) {
      if (user.passwordHash && !isHostBypass) {
        if (!password) return res.status(401).json({ error: 'Esta conta exige senha pessoal.', code: 'PERSONAL_PASSWORD_REQUIRED' });
        if (!bcrypt.compareSync(password, user.passwordHash)) {
          return res.status(401).json({ error: 'Senha incorreta para este usuário.', code: 'PERSONAL_PASSWORD_REQUIRED' });
        }
      } else if (!user.passwordHash && !isHostBypass) {
        const nickTaken = (msg) => res.status(409).json({ error: msg, code: 'NICK_TAKEN' });
        if (user.loginKeyHash) {
          if (!loginKeyOk(user)) {
            return nickTaken(
              'Esse nick já pertence a outra pessoa neste servidor. Se a conta é sua, entre pelo mesmo PC/app em que você a criou, ou peça a um administrador para liberar o nick.'
            );
          }
        } else if ((user.role === 'host' || isPrivilegedUser(db, user)) && !(user.loginClaimable && wantsLoginKey)) {
          // conta antiga (antes da chave) com cargo de administração: não pode ser assumida por quem digitar o nick
          return nickTaken(
            'Essa conta tem cargo de administração e ainda não foi confirmada neste PC. Entre pelo app que já estava conectado (ele confirma sozinho), use o código do dono, ou peça ao dono para liberar o nick.'
          );
        }
      }
      if (displayNameInput && displayNameInput.length >= 2 && displayNameInput.length <= 28) {
        user.displayName = displayNameInput;
      }
      if (isHostBypass) {
        user.role = 'host';
      }
    } else {
      // servidor dedicado na internet: ninguém vira dono só por ser o primeiro; precisa do código do dono
      const isFirstUser = (!HEADLESS && db.users.length === 0) || isHostBypass;
      const color = AVATAR_COLORS[db.users.length % AVATAR_COLORS.length];
      user = {
        id: uuidv4(),
        username: normalized,
        displayName: displayNameInput || rawUsername,
        passwordHash: password ? bcrypt.hashSync(password, 8) : null,
        avatarUrl: null,
        avatarColor: color,
        avatarHash: null,
        bannerColor: color,
        bannerUrl: null,
        bannerHash: null,
        avatarDecoration: 'none',
        nameStyle: 'default',
        bio: '',
        pronouns: '',
        statusType: 'online',
        customStatusEmoji: '',
        customStatusText: '',
        role: isFirstUser ? 'host' : 'member',
        roleIds: isFirstUser ? ['role-host', 'role-vip'] : [],
        badges: isFirstUser ? ['host', 'nitro', 'early'] : ['nitro', 'early'],
        connections: [],
        currentActivity: null,
        recentActivities: [],
        serverMuted: false,
        serverDeafened: false,
        createdAt: Date.now(),
      };
      db.users.push(user);
      appendAuditLog({
        type: 'member_join',
        actor: user,
        targetId: user.id,
        targetName: user.displayName,
        details: 'Entrou no servidor pela primeira vez',
      });
    }

    // conta sem senha e ainda sem chave: emite a chave agora (só para apps que sabem guardá-la)
    let issuedLoginKey = null;
    if (wantsLoginKey && !user.passwordHash && !user.loginKeyHash) {
      issuedLoginKey = crypto.randomBytes(32).toString('base64url');
      user.loginKeyHash = crypto.createHash('sha256').update(issuedLoginKey).digest('hex');
      user.loginClaimable = false;
    }

    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = user.id;
    saveDb();
    broadcastUsers();
    advertiser?.broadcastNow();

    res.json({
      token,
      user: sanitizeUser(user),
      server: getPublicServerInfo(),
      ...(issuedLoginKey ? { loginKey: issuedLoginKey } : {}),
    });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    // quem já está conectado (token válido) confirma a própria conta antiga e recebe a chave
    let issuedLoginKey = null;
    if (req.query.wantLoginKey === '1' && !req.user.passwordHash && !req.user.loginKeyHash) {
      issuedLoginKey = crypto.randomBytes(32).toString('base64url');
      req.user.loginKeyHash = crypto.createHash('sha256').update(issuedLoginKey).digest('hex');
      saveDb();
    }
    res.json({
      user: sanitizeUser(req.user),
      server: getPublicServerInfo(),
      ...(issuedLoginKey ? { loginKey: issuedLoginKey } : {}),
    });
  });

  // Liberar nick: apaga a chave/senha da conta e derruba as sessões dela (o próximo a entrar com o nick fica com ele)
  app.post('/api/users/:userId/reset-login', requireAuth, (req, res) => {
    const db = getDb();
    const perms = computeServerPermissions(db, req.user);
    if (req.user.role !== 'host' && !perms.administrator && !perms.manageServer) {
      return res.status(403).json({ error: 'Só o Host ou um administrador pode liberar nicks.' });
    }
    const target = db.users.find((u) => u.id === req.params.userId);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!canManageMember(db, req.user, target)) return res.status(403).json({ error: 'Esse membro está no seu nível ou acima.' });
    target.loginKeyHash = null;
    target.passwordHash = null;
    target.loginClaimable = true; // o próximo login (app novo) fica com a conta, mesmo ela tendo cargo
    for (const [tok, uid] of Object.entries(db.sessions)) if (uid === target.id) delete db.sessions[tok];
    for (const sid of Array.from(onlineUsers.get(target.id) || [])) io.sockets.sockets.get(sid)?.disconnect(true);
    appendAuditLog({
      type: 'member_update',
      actor: req.user,
      targetId: target.id,
      targetName: target.displayName,
      details: `Liberou o nick @${target.username} (chave de login apagada)`,
    });
    saveDb();
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    const db = getDb();
    delete db.sessions[req.token];
    saveDb();
    res.json({ ok: true });
  });

  // Profile & Global LAN Profile Sync
  app.patch('/api/users/me', requireAuth, (req, res) => {
    const db = getDb();
    const b = req.body || {};
    if (typeof b.displayName === 'string' && b.displayName.trim().length >= 2 && b.displayName.trim().length <= 28) {
      const nextName = b.displayName.trim();
      if (nextName !== req.user.displayName && !computeServerPermissions(db, req.user).changeNickname) {
        return res.status(403).json({ error: 'Seu cargo não tem permissão para alterar apelido.' });
      }
      req.user.displayName = nextName;
    }
    if (typeof b.avatarColor === 'string' && /^#[0-9a-f]{6}$/i.test(b.avatarColor)) req.user.avatarColor = b.avatarColor;
    if (typeof b.bannerColor === 'string' && /^#[0-9a-f]{6}$/i.test(b.bannerColor)) req.user.bannerColor = b.bannerColor;
    if (typeof b.bio === 'string') req.user.bio = b.bio.trim().slice(0, 220);
    if (typeof b.pronouns === 'string') req.user.pronouns = b.pronouns.trim().slice(0, 40);
    if (['online', 'idle', 'dnd', 'invisible'].includes(b.statusType)) req.user.statusType = b.statusType;
    if (typeof b.customStatusEmoji === 'string') req.user.customStatusEmoji = oneEmoji(b.customStatusEmoji);
    if (typeof b.customStatusText === 'string') req.user.customStatusText = b.customStatusText.trim().slice(0, 64);
    if (typeof b.avatarDecoration === 'string') req.user.avatarDecoration = b.avatarDecoration.slice(0, 24);
    if (typeof b.nameStyle === 'string') req.user.nameStyle = b.nameStyle.slice(0, 24);
    if (typeof b.profileEffect === 'string') req.user.profileEffect = b.profileEffect.slice(0, 24);
    if (b.clearProfileBg === true) {
      req.user.profileBgUrl = null;
      req.user.profileBgHash = null;
    }
    if (Array.isArray(b.connections)) {
      req.user.connections = b.connections
        .slice(0, 6)
        .filter((c) => c && c.platform && c.handle)
        .map((c) => ({ platform: String(c.platform).slice(0, 24), handle: String(c.handle).slice(0, 48) }));
    }
    if (b.clearBanner === true) {
      req.user.bannerUrl = null;
      req.user.bannerHash = null;
    }

    saveDb();
    syncUserIntoVoiceRooms(req.user);
    broadcastUsers();
    broadcastVoiceRooms();
    res.json({ user: sanitizeUser(req.user) });
  });

  // Automatic Global Profile Sync across ANY LAN server (avatar + banner + status + bio + Nitro style!)
  app.post('/api/users/sync-profile', requireAuth, (req, res) => {
    const b = req.body || {};
    if (typeof b.displayName === 'string' && b.displayName.trim().length >= 2) {
      req.user.displayName = b.displayName.trim().slice(0, 28);
    }
    if (typeof b.avatarColor === 'string' && /^#[0-9a-f]{6}$/i.test(b.avatarColor)) req.user.avatarColor = b.avatarColor;
    if (typeof b.bannerColor === 'string' && /^#[0-9a-f]{6}$/i.test(b.bannerColor)) req.user.bannerColor = b.bannerColor;
    if (typeof b.bio === 'string') req.user.bio = b.bio.trim().slice(0, 220);
    if (typeof b.pronouns === 'string') req.user.pronouns = b.pronouns.trim().slice(0, 40);
    if (['online', 'idle', 'dnd', 'invisible'].includes(b.statusType)) req.user.statusType = b.statusType;
    if (typeof b.customStatusEmoji === 'string') req.user.customStatusEmoji = oneEmoji(b.customStatusEmoji);
    if (typeof b.customStatusText === 'string') req.user.customStatusText = b.customStatusText.trim().slice(0, 64);
    if (typeof b.avatarDecoration === 'string') req.user.avatarDecoration = b.avatarDecoration.slice(0, 24);
    if (typeof b.nameStyle === 'string') req.user.nameStyle = b.nameStyle.slice(0, 24);
    if (Array.isArray(b.connections)) {
      req.user.connections = b.connections
        .slice(0, 6)
        .filter((c) => c && c.platform && c.handle)
        .map((c) => ({ platform: String(c.platform).slice(0, 24), handle: String(c.handle).slice(0, 48) }));
    }
    if (Array.isArray(b.recentActivities)) {
      req.user.recentActivities = b.recentActivities.slice(0, 12);
    }
    if (b.currentActivity !== undefined) {
      req.user.currentActivity = b.currentActivity;
    }

    if (typeof b.avatarDataUrl === 'string' && b.avatarHash && b.avatarHash !== req.user.avatarHash) {
      const saved = saveDataUrlImage(b.avatarDataUrl, AVATARS_DIR, `av-${req.user.id.slice(0, 6)}`);
      if (saved) {
        req.user.avatarUrl = saved;
        req.user.avatarHash = String(b.avatarHash);
      }
    }
    if (typeof b.profileEffect === 'string') req.user.profileEffect = b.profileEffect.slice(0, 24);
    if (b.profileBgDataUrl === null && req.user.profileBgUrl) {
      req.user.profileBgUrl = null;
      req.user.profileBgHash = null;
    } else if (typeof b.profileBgDataUrl === 'string' && b.profileBgHash && b.profileBgHash !== req.user.profileBgHash) {
      const saved = saveDataUrlImage(b.profileBgDataUrl, AVATARS_DIR, `pbg-${req.user.id.slice(0, 6)}`);
      if (saved) {
        req.user.profileBgUrl = saved;
        req.user.profileBgHash = String(b.profileBgHash);
      }
    }
    if (typeof b.bannerDataUrl === 'string' && b.bannerHash && b.bannerHash !== req.user.bannerHash) {
      const saved = saveDataUrlImage(b.bannerDataUrl, AVATARS_DIR, `bn-${req.user.id.slice(0, 6)}`);
      if (saved) {
        req.user.bannerUrl = saved;
        req.user.bannerHash = String(b.bannerHash);
      }
    }

    saveDb();
    syncUserIntoVoiceRooms(req.user);
    broadcastUsers();
    broadcastVoiceRooms();
    res.json({ user: sanitizeUser(req.user) });
  });

  app.post('/api/upload/avatar', requireAuth, uploadAvatar.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    req.user.avatarUrl = `/uploads/avatars/${req.file.filename}`;
    req.user.avatarHash = crypto.createHash('md5').update(fs.readFileSync(req.file.path)).digest('hex');
    saveDb();
    syncUserIntoVoiceRooms(req.user);
    broadcastUsers();
    broadcastVoiceRooms();
    res.json({ user: sanitizeUser(req.user) });
  });

  app.post('/api/upload/banner', requireAuth, uploadAvatar.single('banner'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem de capa enviada.' });
    req.user.bannerUrl = `/uploads/avatars/${req.file.filename}`;
    req.user.bannerHash = crypto.createHash('md5').update(fs.readFileSync(req.file.path)).digest('hex');
    saveDb();
    broadcastUsers();
    res.json({ user: sanitizeUser(req.user) });
  });

  // Fundo do perfil (imagem ou GIF atrás do cartão, separado do banner)
  app.post('/api/upload/profile-bg', requireAuth, uploadAvatar.single('profileBg'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    req.user.profileBgUrl = `/uploads/avatars/${req.file.filename}`;
    req.user.profileBgHash = crypto.createHash('md5').update(fs.readFileSync(req.file.path)).digest('hex');
    saveDb();
    broadcastUsers();
    res.json({ user: sanitizeUser(req.user) });
  });

  // Roles & Granular Permissions
  app.get('/api/roles', requireAuth, (_req, res) => {
    res.json({ roles: getDb().roles });
  });

  app.post('/api/roles', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageRoles) {
      return res.status(403).json({ error: 'Sem permissão para criar cargos (Gerenciar cargos).' });
    }
    const name = String(req.body?.name || '').trim().slice(0, 28);
    const color = /^#[0-9a-f]{6}$/i.test(req.body?.color || '') ? req.body.color : '#5865f2';
    if (name.length < 1) return res.status(400).json({ error: 'Informe um nome para o cargo.' });
    const wantedPerms = normalizeRolePermissions(req.body?.permissions || {}, DEFAULT_EVERYONE_PERMISSIONS);
    const beyondNew = permsBeyondActor(db, req.user, Object.keys(wantedPerms).filter((k) => wantedPerms[k]));
    if (beyondNew.length) {
      return res.status(403).json({ error: `Você não pode criar um cargo com permissões que não tem: ${beyondNew.join(', ')}.` });
    }
    // o cargo novo fica abaixo do seu cargo mais alto (e sempre abaixo do Host)
    const myTop = topRolePosition(db, req.user);
    let newPos = typeof req.body?.position === 'number' && Number.isFinite(req.body.position) ? req.body.position : db.roles.length + 1;
    newPos = Math.max(1, Math.min(99, myTop === Infinity ? newPos : Math.min(newPos, myTop - 1)));
    if (myTop !== Infinity && myTop <= 1) return res.status(403).json({ error: 'Seu cargo não está alto o bastante para criar cargos.' });
    const role = {
      id: `role-${uuidv4().slice(0, 8)}`,
      name,
      color,
      isSystem: false,
      hoist: Boolean(req.body?.hoist),
      position: newPos,
      permissions: wantedPerms,
    };
    db.roles.push(role);
    appendAuditLog({
      type: 'role_create',
      actor: req.user,
      targetId: role.id,
      targetName: role.name,
      details: `Criou o cargo ${role.name}`,
    });
    saveDb();
    io.emit('roles:updated', db.roles);
    emitChannelsUpdated();
    res.status(201).json({ role });
  });

  app.patch('/api/roles/:id', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageRoles) {
      return res.status(403).json({ error: 'Sem permissão para editar cargos.' });
    }
    const role = db.roles.find((r) => r.id === req.params.id);
    if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });
    if (!canManageRole(db, req.user, role)) {
      return res.status(403).json({ error: 'Esse cargo está no seu nível ou acima: você não pode editá-lo.' });
    }
    const b = req.body || {};
    if (b.permissions && typeof b.permissions === 'object' && role.id !== 'role-host') {
      const cur = role.permissions || {};
      const changedKeys = Object.keys(b.permissions).filter(
        (k) => typeof b.permissions[k] === 'boolean' && Boolean(cur[k]) !== b.permissions[k]
      );
      const beyond = permsBeyondActor(db, req.user, changedKeys);
      if (beyond.length) return res.status(403).json({ error: `Você não pode mexer em permissões que não tem: ${beyond.join(', ')}.` });
    }
    if (typeof b.position === 'number' && !role.isSystem) {
      const myTop = topRolePosition(db, req.user);
      if (!Number.isFinite(b.position) || (myTop !== Infinity && b.position >= myTop)) {
        return res.status(403).json({ error: 'Você não pode colocar um cargo no seu nível ou acima.' });
      }
      b.position = Math.max(1, Math.min(99, b.position));
    }
    if (!role.isSystem && typeof b.name === 'string' && b.name.trim().length >= 1) {
      role.name = b.name.trim().slice(0, 28);
    }
    if (!role.isEveryone && typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) {
      role.color = b.color;
    }
    if (typeof b.hoist === 'boolean' && !role.isEveryone) role.hoist = b.hoist;
    if (typeof b.position === 'number' && !role.isSystem) role.position = b.position;
    if (b.permissions && typeof b.permissions === 'object' && role.id !== 'role-host') {
      role.permissions = normalizeRolePermissions({ ...(role.permissions || {}), ...b.permissions }, role.permissions || {});
    }
    appendAuditLog({
      type: 'role_update',
      actor: req.user,
      targetId: role.id,
      targetName: role.name,
      details: `Atualizou permissões/estilo de ${role.name}`,
    });
    saveDb();
    io.emit('roles:updated', db.roles);
    emitChannelsUpdated();
    res.json({ role });
  });

  app.put('/api/roles/reorder', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageRoles) {
      return res.status(403).json({ error: 'Sem permissão para reordenar cargos.' });
    }
    const order = (Array.isArray(req.body?.roleIds) ? req.body.roleIds : []).filter((x) => typeof x === 'string').slice(0, 250);
    const total = order.length;
    const proposed = new Map();
    order.forEach((rid, i) => {
      const r = db.roles.find((x) => x.id === rid);
      if (r && !r.isSystem && !proposed.has(r.id)) proposed.set(r.id, Math.min(99, total - i + 1));
    });
    const myTop = topRolePosition(db, req.user);
    if (myTop !== Infinity) {
      // quem não é o Host só reordena o que está abaixo dele: os cargos do seu nível para cima ficam onde estão
      const movable = db.roles.filter((r) => !r.isSystem && !r.isEveryone);
      const newPos = (r) => (proposed.has(r.id) ? proposed.get(r.id) : Number(r.position) || 0);
      const before = [...movable].sort((x, y) => (Number(y.position) || 0) - (Number(x.position) || 0)).map((r) => r.id);
      const after = [...movable].sort((x, y) => newPos(y) - newPos(x)).map((r) => r.id);
      const above = before.filter((id) => (Number(db.roles.find((r) => r.id === id)?.position) || 0) >= myTop);
      if (after.slice(0, above.length).join('|') !== above.join('|')) {
        return res.status(403).json({ error: 'Você só pode reordenar cargos abaixo do seu.' });
      }
    }
    for (const [rid, pos] of proposed) {
      const r = db.roles.find((x) => x.id === rid);
      if (r) r.position = pos;
    }
    saveDb();
    io.emit('roles:updated', db.roles);
    res.json({ roles: db.roles });
  });

  app.delete('/api/roles/:id', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageRoles) {
      return res.status(403).json({ error: 'Sem permissão para excluir cargos.' });
    }
    const role = db.roles.find((r) => r.id === req.params.id);
    if (!role || role.isSystem) return res.status(400).json({ error: 'Este cargo não pode ser removido.' });
    if (!canManageRole(db, req.user, role)) {
      return res.status(403).json({ error: 'Esse cargo está no seu nível ou acima: você não pode excluí-lo.' });
    }
    db.roles = db.roles.filter((r) => r.id !== role.id);
    for (const u of db.users) {
      if (Array.isArray(u.roleIds)) u.roleIds = u.roleIds.filter((rid) => rid !== role.id);
    }
    appendAuditLog({
      type: 'role_delete',
      actor: req.user,
      targetId: role.id,
      targetName: role.name,
      details: `Excluiu o cargo ${role.name}`,
    });
    saveDb();
    io.emit('roles:updated', db.roles);
    broadcastUsers();
    emitChannelsUpdated();
    res.json({ ok: true });
  });

  app.post('/api/users/:userId/roles', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageRoles) {
      return res.status(403).json({ error: 'Sem permissão para atribuir cargos.' });
    }
    const target = db.users.find((u) => u.id === req.params.userId);
    const roleId = String(req.body?.roleId || '');
    const action = req.body?.action === 'remove' ? 'remove' : 'add';
    const roleObj = db.roles.find((r) => r.id === roleId);
    if (!target || !roleObj) {
      return res.status(404).json({ error: 'Usuário ou cargo não encontrado.' });
    }
    if (roleId === 'role-host' || roleId === 'role-everyone') {
      return res.status(400).json({ error: 'Este cargo de sistema não pode ser alterado.' });
    }
    if (!canManageRole(db, req.user, roleObj)) {
      return res.status(403).json({ error: 'Esse cargo está no seu nível ou acima: você não pode dá-lo nem tirá-lo.' });
    }
    if (target.id !== req.user.id && !canManageMember(db, req.user, target)) {
      return res.status(403).json({ error: 'Esse membro está no seu nível ou acima.' });
    }
    if (action === 'add') {
      const rp = roleObj.permissions || {};
      const beyond = permsBeyondActor(db, req.user, Object.keys(rp).filter((k) => rp[k]));
      if (beyond.length) return res.status(403).json({ error: `Esse cargo tem permissões que você não tem: ${beyond.join(', ')}.` });
    }
    target.roleIds = Array.isArray(target.roleIds) ? target.roleIds : [];
    if (action === 'add' && !target.roleIds.includes(roleId)) target.roleIds.push(roleId);
    if (action === 'remove') target.roleIds = target.roleIds.filter((id) => id !== roleId);
    appendAuditLog({
      type: 'member_role',
      actor: req.user,
      targetId: target.id,
      targetName: target.displayName,
      details: `${action === 'add' ? 'Adicionou' : 'Removeu'} o cargo "${roleObj.name}"`,
    });
    saveDb();
    broadcastUsers();
    emitChannelsUpdated();
    res.json({ user: sanitizeUser(target) });
  });

  app.post('/api/moderation/voice', requireAuth, (req, res) => {
    const db = getDb();
    const perms = computeServerPermissions(db, req.user);
    const { targetUserId, serverMuted, serverDeafened, moveToChannelId } = req.body || {};
    if (typeof serverMuted === 'boolean' && !perms.muteMembers) {
      return res.status(403).json({ error: 'Sem permissão para silenciar membros.' });
    }
    if (typeof serverDeafened === 'boolean' && !perms.deafenMembers) {
      return res.status(403).json({ error: 'Sem permissão para desativar áudio de membros.' });
    }
    if (typeof moveToChannelId === 'string' && moveToChannelId && !perms.moveMembers) {
      return res.status(403).json({ error: 'Sem permissão para mover membros.' });
    }
    const target = db.users.find((u) => u.id === targetUserId);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.id !== req.user.id && !canManageMember(db, req.user, target)) {
      return res.status(403).json({ error: 'Esse membro está no seu nível ou acima.' });
    }

    if (typeof serverMuted === 'boolean') target.serverMuted = serverMuted;
    if (typeof serverDeafened === 'boolean') target.serverDeafened = serverDeafened;

    if (typeof serverMuted === 'boolean' || typeof serverDeafened === 'boolean') {
      appendAuditLog({
        type: 'voice_mod',
        actor: req.user,
        targetId: target.id,
        targetName: target.displayName,
        details: [
          typeof serverMuted === 'boolean' ? (serverMuted ? 'Silenciado no servidor' : 'Microfone liberado') : '',
          typeof serverDeafened === 'boolean' ? (serverDeafened ? 'Áudio desativado' : 'Áudio liberado') : '',
        ].filter(Boolean).join(' • '),
      });
      saveDb();
      syncUserIntoVoiceRooms(target);
      emitToUser(target.id, 'moderation:voice-enforced', {
        serverMuted: Boolean(target.serverMuted),
        serverDeafened: Boolean(target.serverDeafened),
        // quem está na plateia de um palco continua sem microfone
        stageAudience: Array.from(voiceRooms.values()).some((room) =>
          Array.from(room.values()).some((p) => p.userId === target.id && p.stageRole === 'audience')
        ),
        by: req.user.displayName,
      });
      broadcastUsers();
      broadcastVoiceRooms();
    }

    if (typeof moveToChannelId === 'string' && moveToChannelId) {
      const targetCh = db.channels.find((c) => c.id === moveToChannelId && c.type === 'voice');
      if (!targetCh) return res.status(404).json({ error: 'Canal de voz destino não encontrado.' });
      appendAuditLog({
        type: 'voice_mod',
        actor: req.user,
        targetId: target.id,
        targetName: target.displayName,
        details: `Movido para #${targetCh.name}`,
      });
      emitToUser(target.id, 'moderation:move-voice', {
        targetChannelId: targetCh.id,
        channelName: targetCh.name,
        by: req.user.displayName,
      });
    }

    res.json({ ok: true, user: sanitizeUser(target) });
  });

  app.post('/api/moderation/kick', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).kickMembers) {
      return res.status(403).json({ error: 'Sem permissão para expulsar membros (Kick).' });
    }
    const { targetUserId, reason } = req.body || {};
    const target = db.users.find((u) => u.id === targetUserId);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.role === 'host') return res.status(400).json({ error: 'Não é possível expulsar o Host do servidor.' });
    if (!canManageMember(db, req.user, target)) return res.status(403).json({ error: 'Esse membro está no seu nível ou acima.' });

    for (const [tok, uid] of Object.entries(db.sessions)) {
      if (uid === target.id) delete db.sessions[tok];
    }
    const cleanReason = String(reason || '').trim().slice(0, 140);
    const sockets = onlineUsers.get(target.id);
    if (sockets) {
      for (const sid of Array.from(sockets)) {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.emit('moderation:kicked', { reason: cleanReason, by: req.user.displayName });
          s.disconnect(true);
        }
      }
    }
    appendAuditLog({
      type: 'member_kick',
      actor: req.user,
      targetId: target.id,
      targetName: target.displayName,
      reason: cleanReason,
      details: `Expulsou (kick) ${target.displayName}`,
    });
    saveDb();
    broadcastUsers();
    res.json({ ok: true });
  });

  app.get('/api/moderation/bans', requireAuth, (req, res) => {
    if (!computeServerPermissions(getDb(), req.user).banMembers) {
      return res.status(403).json({ error: 'Sem permissão para ver banimentos.' });
    }
    res.json({ bans: getDb().bans });
  });

  app.post('/api/moderation/ban', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).banMembers) {
      return res.status(403).json({ error: 'Sem permissão para banir membros.' });
    }
    const { targetUserId, reason } = req.body || {};
    const target = db.users.find((u) => u.id === targetUserId);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.role === 'host') return res.status(400).json({ error: 'Não é possível banir o Host do servidor.' });
    if (!canManageMember(db, req.user, target)) return res.status(403).json({ error: 'Esse membro está no seu nível ou acima.' });

    const cleanReason = String(reason || '').trim().slice(0, 120);
    if (!db.bans.some((b) => b.userId === target.id)) {
      db.bans.push({
        userId: target.id,
        username: target.username,
        displayName: target.displayName,
        reason: cleanReason,
        bannedBy: req.user.displayName,
        bannedAt: Date.now(),
      });
    }

    for (const [tok, uid] of Object.entries(db.sessions)) {
      if (uid === target.id) delete db.sessions[tok];
    }

    const sockets = onlineUsers.get(target.id);
    if (sockets) {
      for (const sid of Array.from(sockets)) {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.emit('moderation:banned', { reason: cleanReason, by: req.user.displayName });
          s.disconnect(true);
        }
      }
    }

    appendAuditLog({
      type: 'member_ban',
      actor: req.user,
      targetId: target.id,
      targetName: target.displayName,
      reason: cleanReason,
      details: `Baniu ${target.displayName} do servidor`,
    });
    saveDb();
    broadcastUsers();
    io.emit('bans:updated', db.bans);
    res.json({ ok: true, bans: db.bans });
  });

  app.delete('/api/moderation/bans/:userId', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).banMembers) return res.status(403).json({ error: 'Sem permissão.' });
    const prev = db.bans.find((b) => b.userId === req.params.userId);
    db.bans = db.bans.filter((b) => b.userId !== req.params.userId);
    appendAuditLog({
      type: 'member_unban',
      actor: req.user,
      targetId: req.params.userId,
      targetName: prev?.displayName || req.params.userId,
      details: `Desbaniu ${prev?.displayName || 'usuário'}`,
    });
    saveDb();
    io.emit('bans:updated', db.bans);
    res.json({ ok: true, bans: db.bans });
  });

  app.get('/api/audit-logs', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).viewAuditLog) {
      return res.status(403).json({ error: 'Sem permissão para ver o registro de auditoria.' });
    }
    const typeFilter = String(req.query.type || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    let list = Array.isArray(db.auditLogs) ? db.auditLogs : [];
    if (typeFilter && typeFilter !== 'all') {
      list = list.filter((e) => e.type === typeFilter);
    }
    if (q) {
      list = list.filter(
        (e) =>
          (e.actorName || '').toLowerCase().includes(q) ||
          (e.targetName || '').toLowerCase().includes(q) ||
          (e.details || '').toLowerCase().includes(q) ||
          (e.reason || '').toLowerCase().includes(q)
      );
    }
    res.json({ entries: list.slice(0, 300) });
  });

  // Server settings, Icon/Banner & Profile
  app.get('/api/server', requireAuth, (_req, res) => {
    res.json({ server: getPublicServerInfo() });
  });

  app.patch('/api/server', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageServer) {
      return res.status(403).json({ error: 'Sem permissão para gerenciar configurações do servidor.' });
    }
    const {
      name,
      description,
      iconColor,
      bannerColor,
      tags,
      clearIcon,
      clearBanner,
      invitePassword,
      clearInvitePassword,
      allowMembersCreateChannels,
      tenorApiKey,
      klipyApiKey,
      giphyApiKey,
      youtubeCookies,
    } = req.body || {};

    if (typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 40) db.server.name = name.trim();
    if (typeof description === 'string') db.server.description = description.trim().slice(0, 160);
    if (typeof iconColor === 'string' && /^#[0-9a-f]{6}$/i.test(iconColor)) db.server.iconColor = iconColor;
    if (typeof bannerColor === 'string' && /^#[0-9a-f]{6}$/i.test(bannerColor)) db.server.bannerColor = bannerColor;
    if (clearIcon === true) db.server.iconUrl = null;
    if (clearBanner === true) db.server.bannerUrl = null;
    if (Array.isArray(tags)) {
      db.server.tags = tags
        .slice(0, 5)
        .filter((t) => t && t.label)
        .map((t) => ({ emoji: oneEmoji(t.emoji) || '✨', label: String(t.label).trim().slice(0, 24) }));
    }
    if (clearInvitePassword === true) {
      db.server.invitePasswordHash = null;
      db.server.hasInvitePassword = false;
    } else if (typeof invitePassword === 'string' && invitePassword.trim().length > 0) {
      db.server.invitePasswordHash = bcrypt.hashSync(invitePassword.trim(), 8);
      db.server.hasInvitePassword = true;
    }
    if (typeof allowMembersCreateChannels === 'boolean') db.server.allowMembersCreateChannels = allowMembersCreateChannels;
    if (typeof tenorApiKey === 'string') db.server.tenorApiKey = tenorApiKey.trim();
    if (typeof giphyApiKey === 'string') db.server.giphyApiKey = giphyApiKey.trim().slice(0, 200);
    if (typeof klipyApiKey === 'string') db.server.klipyApiKey = klipyApiKey.trim().slice(0, 200);
    if (typeof youtubeCookies === 'string') {
      try {
        setYouTubeCookies(DATA_DIR, youtubeCookies.slice(0, 512 * 1024));
      } catch (err) {
        console.warn('[YouTube] Não foi possível salvar cookies:', err?.message);
      }
    }

    appendAuditLog({
      type: 'server_update',
      actor: req.user,
      targetName: db.server.name,
      details: `Atualizou perfil/configurações do servidor "${db.server.name}"`,
    });
    saveDb();
    const info = getPublicServerInfo();
    io.emit('server:updated', info);
    advertiser?.broadcastNow();
    res.json({ server: info });
  });

  app.post('/api/server/icon', requireAuth, uploadAvatar.single('icon'), (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageServer) {
      return res.status(403).json({ error: 'Sem permissão para alterar o ícone do servidor.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    db.server.iconUrl = `/uploads/avatars/${req.file.filename}`;
    appendAuditLog({ type: 'server_update', actor: req.user, targetName: db.server.name, details: 'Alterou o ícone do servidor' });
    saveDb();
    const info = getPublicServerInfo();
    io.emit('server:updated', info);
    res.json({ server: info });
  });

  app.post('/api/server/banner', requireAuth, uploadAvatar.single('banner'), (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageServer) {
      return res.status(403).json({ error: 'Sem permissão para alterar a faixa do servidor.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    db.server.bannerUrl = `/uploads/avatars/${req.file.filename}`;
    saveDb();
    const info = getPublicServerInfo();
    io.emit('server:updated', info);
    res.json({ server: info });
  });

  // Categories
  app.get('/api/categories', requireAuth, (_req, res) => {
    res.json({ categories: getDb().categories || [] });
  });

  app.post('/api/categories', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageChannels) {
      return res.status(403).json({ error: 'Sem permissão para criar categorias.' });
    }
    const name = String(req.body?.name || '').trim().slice(0, 32);
    if (!name) return res.status(400).json({ error: 'Informe um nome para a categoria.' });
    if (!Array.isArray(db.categories)) db.categories = [];
    const cat = {
      id: `cat-${uuidv4().slice(0, 8)}`,
      name,
      position: db.categories.length,
      isPrivate: Boolean(req.body?.isPrivate),
      overwrites: [],
    };
    if (Array.isArray(req.body?.overwrites)) {
      const chk = checkOverwriteChange(db, req.user, [], req.body.overwrites);
      if (chk.error) return res.status(403).json({ error: chk.error });
      cat.overwrites = chk.list;
    }
    db.categories.push(cat);
    saveDb();
    emitCategoriesUpdated();
    res.status(201).json({ category: cat });
  });

  app.patch('/api/categories/:id', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageChannels) {
      return res.status(403).json({ error: 'Sem permissão para editar categoria.' });
    }
    const cat = (db.categories || []).find((c) => c.id === req.params.id);
    if (!cat) return res.status(404).json({ error: 'Categoria não encontrada.' });
    let nextCatOverwrites = null;
    if (Array.isArray(req.body?.overwrites)) {
      const chk = checkOverwriteChange(db, req.user, cat.overwrites || [], req.body.overwrites);
      if (chk.error) return res.status(403).json({ error: chk.error });
      nextCatOverwrites = chk.list;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) cat.name = req.body.name.trim().slice(0, 32);
    if (typeof req.body?.position === 'number' && Number.isFinite(req.body.position)) cat.position = req.body.position;
    if (typeof req.body?.isPrivate === 'boolean') cat.isPrivate = req.body.isPrivate;
    if (nextCatOverwrites) cat.overwrites = nextCatOverwrites;
    saveDb();
    emitCategoriesUpdated();
    emitChannelsUpdated();
    res.json({ category: cat });
  });

  // Reordenar categorias (arrastar e soltar)
  app.post('/api/categories/reorder', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageChannels) {
      return res.status(403).json({ error: 'Sem permissão para organizar categorias.' });
    }
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!Array.isArray(db.categories)) db.categories = [];
    ids.forEach((id, i) => {
      const cat = db.categories.find((c) => c.id === id);
      if (cat) cat.position = i;
    });
    db.categories.sort((a, b) => (a.position || 0) - (b.position || 0));
    saveDb();
    emitCategoriesUpdated();
    res.json({ ok: true });
  });

  app.delete('/api/categories/:id', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageChannels) {
      return res.status(403).json({ error: 'Sem permissão para excluir categoria.' });
    }
    db.categories = (db.categories || []).filter((c) => c.id !== req.params.id);
    for (const ch of db.channels) {
      if (ch.categoryId === req.params.id) ch.categoryId = null;
    }
    saveDb();
    emitCategoriesUpdated();
    emitChannelsUpdated();
    res.json({ ok: true });
  });

  // Channels
  app.get('/api/channels', requireAuth, (req, res) => {
    const db = getDb();
    const channels = getVisibleChannelsForUser(db, req.user);
    res.json({
      channels,
      categories: db.categories || [],
      voiceRooms: getVoiceRoomsSnapshot(),
      channelActivity: getChannelActivity(db, channels),
    });
  });

  app.post('/api/channels', requireAuth, (req, res) => {
    const db = getDb();
    const canManage = computeServerPermissions(db, req.user).manageChannels;
    const isPrivateReq = Boolean(req.body?.isPrivate);
    if (!canManage && (!db.server.allowMembersCreateChannels || isPrivateReq)) {
      return res.status(403).json({ error: 'Você precisa da permissão "Gerenciar canais" para criar este canal.' });
    }
    const rawName = String(req.body?.name || '').trim();
    const type = req.body?.type === 'voice' ? 'voice' : 'text';
    const topic = String(req.body?.topic || '').trim().slice(0, 1024);

    if (rawName.length < 1 || rawName.length > 36) {
      return res.status(400).json({ error: 'O nome do canal deve ter entre 1 e 36 caracteres.' });
    }

    const formattedName =
      type === 'text'
        ? rawName
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9À-ÿ_-]/gi, '')
            .slice(0, 32) || 'novo-chat'
        : rawName;

    const defaultCatId = type === 'voice' ? 'cat-voice' : 'cat-text';
    const catExists = (db.categories || []).some((c) => c.id === req.body?.categoryId);

    const channel = {
      id: `${type === 'voice' ? 'vc' : 'ch'}-${uuidv4().slice(0, 8)}`,
      name: formattedName,
      type,
      categoryId: req.body?.categoryId === null ? null : catExists ? req.body.categoryId : defaultCatId,
      position: db.channels.length,
      topic,
      slowModeSec: Math.max(0, Math.min(21600, Number(req.body?.slowModeSec || 0))),
      visibility: ['default', 'spoiler', 'nsfw'].includes(req.body?.visibility) ? req.body.visibility : 'default',
      isPrivate: isPrivateReq,
      bitrateKbps: Math.max(32, Math.min(384, Number(req.body?.bitrateKbps || 128))),
      isStage: type === 'voice' && Boolean(req.body?.isStage),
      userLimit: Math.max(0, Math.min(99, Number(req.body?.userLimit || 0))),
      overwrites: [],
      createdAt: Date.now(),
      createdBy: req.user.displayName,
    };

    if (Array.isArray(req.body?.overwrites) && req.body.overwrites.length) {
      const chk = checkOverwriteChange(db, req.user, [], req.body.overwrites);
      if (chk.error) return res.status(403).json({ error: chk.error });
      channel.overwrites = chk.list;
    }
    db.channels.push(channel);
    if (type === 'text') db.messages[channel.id] = [];
    appendAuditLog({
      type: 'channel_create',
      actor: req.user,
      targetId: channel.id,
      targetName: channel.name,
      details: `Criou canal de ${type === 'voice' ? 'voz' : 'texto'} ${isPrivateReq ? 'privado ' : ''}#${channel.name}`,
    });
    saveDb();
    emitChannelsUpdated();
    res.status(201).json({ channel });
  });

  // Reordenar canais / mover para outra categoria (arrastar e soltar, como no Discord)
  app.post('/api/channels/reorder', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageChannels) {
      return res.status(403).json({ error: 'Sem permissão para organizar canais.' });
    }
    const layout = Array.isArray(req.body?.layout) ? req.body.layout.slice(0, 500) : [];
    const catIds = new Set((db.categories || []).map((c) => c.id));
    let changed = 0;
    for (const item of layout) {
      const ch = db.channels.find((c) => c.id === String(item?.id || ''));
      if (!ch) continue;
      if (item.categoryId === null || (typeof item.categoryId === 'string' && catIds.has(item.categoryId))) {
        ch.categoryId = item.categoryId;
      }
      if (Number.isFinite(Number(item.position))) ch.position = Number(item.position);
      changed++;
    }
    if (!changed) return res.status(400).json({ error: 'Nada para reordenar.' });
    db.channels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    saveDb();
    emitChannelsUpdated();
    res.json({ ok: true });
  });

  app.patch('/api/channels/:id', requireAuth, (req, res) => {
    const db = getDb();
    const channel = db.channels.find((c) => c.id === req.params.id);
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });
    if (!computeChannelPermissions(db, req.user, channel).manageChannels) {
      return res.status(403).json({ error: 'Sem permissão para editar este canal.' });
    }
    const b = req.body || {};
    let nextChOverwrites = null;
    if (Array.isArray(b.overwrites)) {
      const chk = checkOverwriteChange(db, req.user, channel.overwrites || [], b.overwrites);
      if (chk.error) return res.status(403).json({ error: chk.error });
      nextChOverwrites = chk.list;
    }
    // trocar de categoria: precisa poder gerenciar canais na categoria de destino também
    if (typeof b.categoryId === 'string' && b.categoryId !== channel.categoryId) {
      const destCat = (db.categories || []).find((c) => c.id === b.categoryId);
      if (!destCat) return res.status(400).json({ error: 'Categoria não encontrada.' });
    }
    if (typeof b.name === 'string' && b.name.trim()) {
      channel.name =
        channel.type === 'text'
          ? b.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9À-ÿ_-]/gi, '').slice(0, 32) || channel.name
          : b.name.trim().slice(0, 36);
    }
    if (typeof b.topic === 'string') channel.topic = b.topic.slice(0, 1024);
    if (b.categoryId === null || typeof b.categoryId === 'string') channel.categoryId = b.categoryId;
    if (typeof b.position === 'number' && Number.isFinite(b.position)) channel.position = b.position;
    if (typeof b.slowModeSec === 'number') channel.slowModeSec = Math.max(0, Math.min(21600, b.slowModeSec));
    if (['default', 'spoiler', 'nsfw'].includes(b.visibility)) channel.visibility = b.visibility;
    if (typeof b.isPrivate === 'boolean') channel.isPrivate = b.isPrivate;
    if (typeof b.bitrateKbps === 'number') channel.bitrateKbps = Math.max(32, Math.min(384, b.bitrateKbps));
    if (typeof b.isStage === 'boolean' && channel.type === 'voice') channel.isStage = b.isStage;
    if (typeof b.userLimit === 'number') channel.userLimit = Math.max(0, Math.min(99, b.userLimit));
    if (nextChOverwrites) channel.overwrites = nextChOverwrites;
    if (b.syncWithCategory && channel.categoryId) {
      const cat = (db.categories || []).find((c) => c.id === channel.categoryId);
      if (cat && checkOverwriteChange(db, req.user, channel.overwrites || [], cat.overwrites || []).error) {
        return res.status(403).json({ error: 'Sincronizar com a categoria muda permissões que você não pode mexer.' });
      }
      if (cat) {
        channel.isPrivate = Boolean(cat.isPrivate);
        channel.overwrites = JSON.parse(JSON.stringify(cat.overwrites || []));
      }
    }
    appendAuditLog({
      type: 'channel_update',
      actor: req.user,
      targetId: channel.id,
      targetName: channel.name,
      details: `Editou configurações/permissões de #${channel.name}`,
    });
    saveDb();
    emitChannelsUpdated();
    res.json({ channel });
  });

  app.post('/api/channels/:id/duplicate', requireAuth, (req, res) => {
    const db = getDb();
    if (!computeServerPermissions(db, req.user).manageChannels) {
      return res.status(403).json({ error: 'Sem permissão para duplicar canal.' });
    }
    const src = db.channels.find((c) => c.id === req.params.id);
    if (!src) return res.status(404).json({ error: 'Canal não encontrado.' });
    const clone = {
      ...JSON.parse(JSON.stringify(src)),
      id: `${src.type === 'voice' ? 'vc' : 'ch'}-${uuidv4().slice(0, 8)}`,
      name: `${src.name.slice(0, 26)}-copia`,
      position: db.channels.length,
      createdAt: Date.now(),
      createdBy: req.user.displayName,
    };
    db.channels.push(clone);
    if (clone.type === 'text') db.messages[clone.id] = [];
    appendAuditLog({
      type: 'channel_create',
      actor: req.user,
      targetId: clone.id,
      targetName: clone.name,
      details: `Duplicou canal #${src.name} -> #${clone.name}`,
    });
    saveDb();
    emitChannelsUpdated();
    res.status(201).json({ channel: clone });
  });

  app.delete('/api/channels/:id', requireAuth, (req, res) => {
    const db = getDb();
    const channel = db.channels.find((c) => c.id === req.params.id);
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });

    if (!computeChannelPermissions(db, req.user, channel).manageChannels && channel.createdBy !== req.user.displayName) {
      return res.status(403).json({ error: 'Sem permissão para excluir este canal.' });
    }

    const sameTypeCount = db.channels.filter((c) => c.type === channel.type).length;
    if (sameTypeCount <= 1) {
      return res
        .status(400)
        .json({ error: `É necessário manter pelo menos 1 canal de ${channel.type === 'text' ? 'texto' : 'voz'}.` });
    }

    db.channels = db.channels.filter((c) => c.id !== channel.id);
    // threads das mensagens do canal também saem (antes ficavam órfãs no banco para sempre)
    for (const m of db.messages[channel.id] || []) {
      if (db.threadMessages?.[m.id]) delete db.threadMessages[m.id];
    }
    delete db.messages[channel.id];
    // eventos marcados neste canal de voz ficam como "outro lugar"
    let eventsTouched = false;
    for (const ev of db.events || []) {
      if (ev.channelId === channel.id) {
        ev.channelId = null;
        ev.location = ev.location || `#${channel.name} (apagado)`;
        eventsTouched = true;
      }
    }
    if (channel.type === 'voice') {
      voiceRooms.delete(channel.id);
      sfu.closeRoom(channel.id);
      musicStates.delete(channel.id);
      videoStates.delete(channel.id);
      whiteboardStates.delete(channel.id);
      io.to(`voice:${channel.id}`).emit('voice:channel-deleted', { channelId: channel.id });
      broadcastVoiceRooms();
    }
    appendAuditLog({
      type: 'channel_delete',
      actor: req.user,
      targetId: channel.id,
      targetName: channel.name,
      details: `Excluiu canal #${channel.name}`,
    });
    saveDb();
    emitChannelsUpdated();
    if (eventsTouched) broadcastEvents();
    res.json({ ok: true });
  });

  // Channel Messages (with private channel view check!)
  // Só quem pode ver o canal recebe os eventos dele (mensagens de canal privado não vão para o resto do servidor)
  function emitToChannel(ch, event, payload) {
    const dbNow = getDb();
    const byId = new Map(dbNow.users.map((u) => [u.id, u]));
    const allowed = new Map();
    for (const sock of io.sockets.sockets.values()) {
      const uid = sock.data?.userId;
      if (!uid) continue;
      if (!allowed.has(uid)) {
        const u = byId.get(uid);
        allowed.set(uid, Boolean(u && computeChannelPermissions(dbNow, u, ch).viewChannels));
      }
      if (allowed.get(uid)) sock.emit(event, payload);
    }
  }

  function findChannelMessage(dbObj, channelId, messageId, threadParentId) {
    if (threadParentId) {
      const list = (dbObj.threadMessages || {})[threadParentId];
      return list ? list.find((m) => m.id === messageId) || null : null;
    }
    const list = dbObj.messages[channelId];
    return list ? list.find((m) => m.id === messageId) || null : null;
  }

  function emitMessageUpdated(ch, msg) {
    if (msg.threadParentId) {
      emitToChannel(ch, 'chat:thread-message-updated', { channelId: ch.id, parentId: msg.threadParentId, message: msg });
    } else {
      emitToChannel(ch, 'chat:message-updated', { channelId: ch.id, message: msg });
    }
  }

  function sanitizePoll(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const question = String(raw.question || '').trim().slice(0, 300);
    const opts = (Array.isArray(raw.options) ? raw.options : [])
      .map((o) => String(o || '').trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 10);
    if (!question || opts.length < 2) return null;
    const hours = Math.min(24 * 7, Math.max(0, Number(raw.durationHours) || 0));
    return {
      question,
      multi: Boolean(raw.multi),
      options: opts.map((text, i) => ({ id: `o${i}`, text, votes: [] })),
      endsAt: hours ? Date.now() + hours * 3600 * 1000 : null,
    };
  }

  // ---- Threads (respostas presas a uma mensagem)
  app.get('/api/channels/:id/threads/:parentId', requireAuth, (req, res) => {
    const db = getDb();
    const ch = db.channels.find((c) => c.id === req.params.id);
    if (!ch || !computeChannelPermissions(db, req.user, ch).viewChannels) {
      return res.status(403).json({ error: 'Sem acesso a este canal.' });
    }
    const parent = findChannelMessage(db, ch.id, req.params.parentId);
    if (!parent) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    res.json({ parent, messages: ((db.threadMessages || {})[parent.id] || []).slice(-500) });
  });

  app.delete('/api/channels/:channelId/threads/:parentId/messages/:messageId', requireAuth, (req, res) => {
    const db = getDb();
    const ch = db.channels.find((c) => c.id === req.params.channelId);
    const parent = ch ? findChannelMessage(db, ch.id, req.params.parentId) : null;
    const list = parent ? (db.threadMessages || {})[parent.id] : null;
    if (!ch || !parent || !list) return res.status(404).json({ error: 'Thread não encontrada.' });
    const idx = list.findIndex((m) => m.id === req.params.messageId);
    if (idx === -1) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    if (list[idx].authorId !== req.user.id && !computeChannelPermissions(db, req.user, ch).manageMessages) {
      return res.status(403).json({ error: 'Você não pode excluir esta mensagem.' });
    }
    list.splice(idx, 1);
    parent.thread = list.length
      ? { ...(parent.thread || {}), count: list.length, lastAt: list[list.length - 1].createdAt }
      : null;
    saveDb();
    emitToChannel(ch, 'chat:thread-message-deleted', { channelId: ch.id, parentId: parent.id, messageId: req.params.messageId });
    emitToChannel(ch, 'chat:message-updated', { channelId: ch.id, message: parent });
    res.json({ ok: true });
  });

  // ---- Eventos agendados (com presença confirmada e lembrete no app)
  function visibleEvents() {
    const cutoff = Date.now() - 12 * 3600 * 1000;
    return (getDb().events || [])
      .filter((e) => (e.endsAt || e.startsAt + 3 * 3600 * 1000) >= cutoff)
      .sort((a, b) => a.startsAt - b.startsAt);
  }
  function broadcastEvents() {
    io.emit('events:updated', visibleEvents());
  }
  function canManageEvent(db, user, ev) {
    if (!user) return false;
    if (ev.createdBy === user.id || user.role === 'host') return true;
    const p = computeServerPermissions(db, user);
    return Boolean(p.administrator || p.manageChannels || p.manageServer);
  }

  app.get('/api/events', requireAuth, (_req, res) => {
    res.json({ events: visibleEvents() });
  });

  app.post('/api/events', requireAuth, (req, res) => {
    const db = getDb();
    const title = String(req.body?.title || '').trim().slice(0, 100);
    const description = String(req.body?.description || '').trim().slice(0, 1000);
    const startsAt = Math.floor(Number(req.body?.startsAt) || 0);
    const endsAtRaw = Math.floor(Number(req.body?.endsAt) || 0);
    const location = String(req.body?.location || '').trim().slice(0, 100);
    const channelId = String(req.body?.channelId || '');
    if (!title) return res.status(400).json({ error: 'Dê um nome ao evento.' });
    if (!startsAt || startsAt < Date.now() - 5 * 60 * 1000) return res.status(400).json({ error: 'Escolha uma data no futuro.' });
    if (startsAt > Date.now() + 366 * 24 * 3600 * 1000) return res.status(400).json({ error: 'Data muito distante.' });
    const channel = channelId ? db.channels.find((c) => c.id === channelId) : null;
    if (channelId && !channel) return res.status(400).json({ error: 'Canal não encontrado.' });
    const ev = {
      id: `evt-${uuidv4()}`,
      title,
      description,
      startsAt,
      endsAt: endsAtRaw > startsAt ? endsAtRaw : null,
      channelId: channel ? channel.id : null,
      location: channel ? '' : location,
      createdBy: req.user.id,
      createdByName: req.user.displayName,
      createdAt: Date.now(),
      rsvps: { [req.user.id]: 'going' },
    };
    if (!Array.isArray(db.events)) db.events = [];
    // limpa eventos que acabaram há mais de 7 dias
    const old = Date.now() - 7 * 24 * 3600 * 1000;
    db.events = db.events.filter((e) => (e.endsAt || e.startsAt + 3 * 3600 * 1000) >= old).slice(-200);
    db.events.push(ev);
    saveDb();
    broadcastEvents();
    res.json({ event: ev });
  });

  app.post('/api/events/:id/rsvp', requireAuth, (req, res) => {
    const db = getDb();
    const ev = (db.events || []).find((e) => e.id === req.params.id);
    if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });
    const status = req.body?.status;
    if (!ev.rsvps || typeof ev.rsvps !== 'object') ev.rsvps = {};
    if (status === 'going' || status === 'maybe' || status === 'no') ev.rsvps[req.user.id] = status;
    else delete ev.rsvps[req.user.id];
    saveDb();
    broadcastEvents();
    res.json({ event: ev });
  });

  app.delete('/api/events/:id', requireAuth, (req, res) => {
    const db = getDb();
    const ev = (db.events || []).find((e) => e.id === req.params.id);
    if (!ev) return res.status(404).json({ error: 'Evento não encontrado.' });
    if (!canManageEvent(db, req.user, ev)) return res.status(403).json({ error: 'Só quem criou o evento pode cancelá-lo.' });
    db.events = db.events.filter((e) => e.id !== ev.id);
    saveDb();
    broadcastEvents();
    res.json({ ok: true });
  });

  // ---- Busca no histórico dos canais (com filtros)
  const foldText = (t) =>
    String(t || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  function messageHas(m, has) {
    const atts = Array.isArray(m.attachments) ? m.attachments : [];
    switch (has) {
      case 'file':
        return atts.length > 0 || Boolean(m.transfer);
      case 'image':
        return Boolean(m.gifUrl) || atts.some((a) => a.kind === 'image' || a.kind === 'gif');
      case 'video':
        return atts.some((a) => a.kind === 'video');
      case 'audio':
        return atts.some((a) => a.kind === 'audio' || a.isVoiceMessage);
      case 'link':
        return /https?:\/\//i.test(m.content || '');
      case 'poll':
        return Boolean(m.poll);
      case 'pinned':
        return Boolean(m.pinned);
      default:
        return true;
    }
  }

  app.get('/api/search', requireAuth, (req, res) => {
    const db = getDb();
    const q = foldText(req.query.q).trim().slice(0, 200);
    const fromQ = foldText(req.query.from).trim().replace(/^@/, '').slice(0, 64);
    const has = String(req.query.has || '');
    const channelId = String(req.query.channelId || '');
    const before = Number(req.query.before) || 0;
    const after = Number(req.query.after) || 0;
    if (!q && !fromQ && !has && !before && !after) return res.json({ results: [], total: 0 });
    const channels = db.channels.filter(
      (c) => c.type === 'text' && (!channelId || c.id === channelId) && computeChannelPermissions(db, req.user, c).viewChannels
    );
    const fromIds = fromQ
      ? new Set(
          db.users
            .filter((u) => foldText(u.displayName).includes(fromQ) || foldText(u.username).includes(fromQ))
            .map((u) => u.id)
        )
      : null;
    const PER_CHANNEL = 50;
    let total = 0;
    const found = [];
    for (const ch of channels) {
      const list = db.messages[ch.id] || [];
      let kept = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (after && m.createdAt < after) break; // lista em ordem de envio
        if (before && m.createdAt >= before) continue;
        if (fromIds && !fromIds.has(m.authorId)) continue;
        if (has && !messageHas(m, has)) continue;
        if (q) {
          const hay = foldText(
            `${m.content || ''} ${(m.attachments || []).map((a) => a.name).join(' ')} ${m.poll?.question || ''} ${
              m.transfer?.originalName || ''
            }`
          );
          if (!hay.includes(q)) continue;
        }
        total++;
        if (kept < PER_CHANNEL) {
          found.push({ ...m, channelName: ch.name });
          kept++;
        }
      }
    }
    found.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ results: found.slice(0, 50), total });
  });

  app.get('/api/channels/:id/messages', requireAuth, (req, res) => {
    const db = getDb();
    const ch = db.channels.find((c) => c.id === req.params.id);
    if (!ch || !computeChannelPermissions(db, req.user, ch).viewChannels) {
      return res.status(403).json({ error: 'Sem acesso a este canal.' });
    }
    const list = db.messages[req.params.id] || [];
    const hydrated = list.slice(-300).map((m) =>
      m.transfer && db.transfers[m.transfer.id] ? { ...m, transfer: db.transfers[m.transfer.id] } : m
    );
    res.json({ messages: hydrated });
  });

  app.get('/api/channels/:id/pins', requireAuth, (req, res) => {
    const db = getDb();
    const ch = db.channels.find((c) => c.id === req.params.id);
    if (!ch || !computeChannelPermissions(db, req.user, ch).viewChannels) {
      return res.status(403).json({ error: 'Sem acesso a este canal.' });
    }
    const list = db.messages[req.params.id] || [];
    res.json({ pins: list.filter((m) => m.pinned) });
  });

  app.post('/api/channels/:channelId/messages/:messageId/pin', requireAuth, (req, res) => {
    const db = getDb();
    const ch = db.channels.find((c) => c.id === req.params.channelId);
    if (!ch || !computeChannelPermissions(db, req.user, ch).pinMessages) {
      return res.status(403).json({ error: 'Sem permissão para fixar mensagens neste canal.' });
    }
    const list = db.messages[req.params.channelId];
    if (!list) return res.status(404).json({ error: 'Canal não encontrado.' });
    const msg = list.find((m) => m.id === req.params.messageId);
    if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada.' });

    const nextPinned = typeof req.body?.pinned === 'boolean' ? req.body.pinned : !msg.pinned;
    msg.pinned = nextPinned;
    msg.pinnedAt = nextPinned ? Date.now() : null;
    msg.pinnedBy = nextPinned ? req.user.displayName : null;
    appendAuditLog({
      type: 'message_pin',
      actor: req.user,
      targetId: msg.id,
      targetName: `#${ch.name}`,
      details: `${nextPinned ? 'Fixou' : 'Desafixou'} uma mensagem em #${ch.name}`,
    });
    saveDb();

    emitToChannel(ch, 'chat:message-pinned', {
      channelId: req.params.channelId,
      message: msg,
      pinnedBy: req.user.displayName,
    });
    res.json({ ok: true, message: msg });
  });

  app.delete('/api/channels/:channelId/messages/:messageId', requireAuth, (req, res) => {
    const db = getDb();
    const ch = db.channels.find((c) => c.id === req.params.channelId);
    const list = db.messages[req.params.channelId];
    if (!list || !ch) return res.status(404).json({ error: 'Canal não encontrado.' });
    const idx = list.findIndex((m) => m.id === req.params.messageId);
    if (idx === -1) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    const msg = list[idx];
    if (msg.authorId !== req.user.id && !computeChannelPermissions(db, req.user, ch).manageMessages) {
      return res.status(403).json({ error: 'Você não pode excluir esta mensagem.' });
    }
    list.splice(idx, 1);
    if (db.threadMessages && db.threadMessages[msg.id]) delete db.threadMessages[msg.id];
    if (msg.authorId !== req.user.id) {
      appendAuditLog({
        type: 'message_delete',
        actor: req.user,
        targetId: msg.authorId,
        targetName: msg.authorName,
        details: `Excluiu mensagem de ${msg.authorName} em #${ch.name}`,
      });
    }
    saveDb();
    emitToChannel(ch, 'chat:message-deleted', { channelId: req.params.channelId, messageId: req.params.messageId });
    res.json({ ok: true });
  });

  // Private Groups (Server Multi-Person DM Chat & Calls + Group Icon!)
  app.get('/api/dm-groups', requireAuth, (req, res) => {
    const db = getDb();
    const list = Object.values(db.dmGroups || {}).filter((g) => Array.isArray(g.memberIds) && g.memberIds.includes(req.user.id));
    res.json({ groups: list });
  });

  app.post('/api/dm-groups', requireAuth, (req, res) => {
    const db = getDb();
    if (!db.dmGroups) db.dmGroups = {};
    if (!db.groupMessages) db.groupMessages = {};
    const name = String(req.body?.name || 'Grupo Privado').trim().slice(0, 40) || 'Grupo Privado';
    const rawMembers = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
    const memberIds = Array.from(new Set([req.user.id, ...rawMembers.filter((id) => db.users.some((u) => u.id === id))])).slice(0, 25);
    let iconUrl = null;
    if (typeof req.body?.iconDataUrl === 'string' && req.body.iconDataUrl.startsWith('data:image/')) {
      iconUrl = saveDataUrlImage(req.body.iconDataUrl, AVATARS_DIR, 'grp');
    }
    const group = {
      id: `grp-${uuidv4().slice(0, 8)}`,
      name,
      iconUrl,
      ownerId: req.user.id,
      memberIds,
      createdAt: Date.now(),
    };
    db.dmGroups[group.id] = group;
    db.groupMessages[group.id] = [];
    saveDb();
    for (const uid of group.memberIds) emitToUser(uid, 'dm-group:updated', { group });
    res.status(201).json({ group });
  });

  app.patch('/api/dm-groups/:id', requireAuth, (req, res) => {
    const db = getDb();
    const group = db.dmGroups?.[req.params.id];
    if (!group || !group.memberIds.includes(req.user.id)) {
      return res.status(404).json({ error: 'Grupo não encontrado.' });
    }
    const prevMembers = [...group.memberIds];
    const b = req.body || {};
    if (typeof b.name === 'string' && b.name.trim()) group.name = b.name.trim().slice(0, 40);
    if (b.clearIcon === true) group.iconUrl = null;
    else if (typeof b.iconDataUrl === 'string' && b.iconDataUrl.startsWith('data:image/')) {
      const saved = saveDataUrlImage(b.iconDataUrl, AVATARS_DIR, `grp-${group.id.slice(4)}`);
      if (saved) group.iconUrl = saved;
    }
    if (Array.isArray(b.addMemberIds)) {
      for (const uid of b.addMemberIds) {
        if (db.users.some((u) => u.id === uid) && !group.memberIds.includes(uid) && group.memberIds.length < 25) {
          group.memberIds.push(uid);
        }
      }
    }
    if (typeof b.removeMemberId === 'string') {
      if (b.removeMemberId === req.user.id || group.ownerId === req.user.id) {
        group.memberIds = group.memberIds.filter((id) => id !== b.removeMemberId);
      }
    }
    saveDb();
    for (const uid of Array.from(new Set([...prevMembers, ...group.memberIds]))) {
      emitToUser(uid, 'dm-group:updated', { group });
    }
    res.json({ group });
  });

  app.post('/api/dm-groups/:id/icon', requireAuth, uploadAvatar.single('icon'), (req, res) => {
    const db = getDb();
    const group = db.dmGroups?.[req.params.id];
    if (!group || !group.memberIds.includes(req.user.id)) {
      return res.status(404).json({ error: 'Grupo não encontrado.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    group.iconUrl = `/uploads/avatars/${req.file.filename}`;
    saveDb();
    for (const uid of group.memberIds) emitToUser(uid, 'dm-group:updated', { group });
    res.json({ group });
  });

  app.get('/api/dm-groups/:id/messages', requireAuth, (req, res) => {
    const db = getDb();
    const group = db.dmGroups?.[req.params.id];
    if (!group || !group.memberIds.includes(req.user.id)) {
      return res.status(403).json({ error: 'Sem acesso a este grupo.' });
    }
    const list = db.groupMessages?.[group.id] || [];
    res.json({ messages: list.slice(-300) });
  });

  // Trello Projects & Kanban Boards (Server + Private Calls / DMs / Groups)
  app.get('/api/trello', requireAuth, (req, res) => {
    const db = getDb();
    const scopeKey = String(req.query.scopeKey || 'server');
    if (!canAccessTrelloScope(db, req.user, scopeKey)) {
      return res.status(403).json({ error: 'Sem acesso a este quadro Trello.' });
    }
    if (!db.trelloBoards) db.trelloBoards = {};
    const boards = db.trelloBoards[scopeKey] || [];
    res.json({ scopeKey, boards });
  });

  app.put('/api/trello', requireAuth, (req, res) => {
    const db = getDb();
    const scopeKey = String(req.body?.scopeKey || 'server');
    if (!canAccessTrelloScope(db, req.user, scopeKey)) {
      return res.status(403).json({ error: 'Sem acesso a este quadro Trello.' });
    }
    if (scopeKey === 'server' && !computeServerPermissions(db, req.user).useTrello) {
      return res.status(403).json({ error: 'Seu cargo não tem permissão para editar o Trello do servidor.' });
    }
    if (!db.trelloBoards) db.trelloBoards = {};
    const incoming = Array.isArray(req.body?.boards) ? req.body.boards.slice(0, 15) : [];
    db.trelloBoards[scopeKey] = incoming;
    saveDb();
    emitTrelloUpdate(db, scopeKey, incoming);
    res.json({ ok: true, scopeKey, boards: incoming });
  });

  // Direct Messages REST
  app.get('/api/dms/:peerUserId/messages', requireAuth, (req, res) => {
    const db = getDb();
    const key = getDmPairKey(req.user.id, req.params.peerUserId);
    const list = db.directMessages[key] || [];
    const hydrated = list.slice(-300).map((m) =>
      m.transfer && db.transfers[m.transfer.id] ? { ...m, transfer: db.transfers[m.transfer.id] } : m
    );
    res.json({ messages: hydrated, pairKey: key });
  });

  // Chat image/GIF/Voice-audio upload (with auto 2 GB cap enforcement & optional waveform metadata)
  app.post('/api/upload/chat', requireAuth, uploadChat.array('files', 6), (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    runStorageEnforce(0);

    let metaArray = [];
    if (req.body?.attachmentMeta) {
      try {
        const parsed = JSON.parse(String(req.body.attachmentMeta));
        if (Array.isArray(parsed)) metaArray = parsed;
      } catch {}
    }

    const attachments = files.map((file, idx) => {
      const mime = file.mimetype || '';
      const ext = path.extname(file.originalname || '').toLowerCase();
      let kind = 'file';
      if (mime === 'image/gif' || ext === '.gif') kind = 'gif';
      else if (mime.startsWith('image/')) kind = 'image';
      else if (mime.startsWith('audio/')) kind = 'audio';
      else if (mime.startsWith('video/')) kind = 'video';

      const meta = metaArray[idx] || {};
      const waveform = Array.isArray(meta.waveform)
        ? meta.waveform.slice(0, 64).map((n) => Math.max(0, Math.min(1, Number(n) || 0)))
        : undefined;
      const durationSec = Number(meta.durationSec || 0) > 0 ? Number(meta.durationSec) : undefined;
      const isVoiceMessage = Boolean(meta.isVoiceMessage);
      if (isVoiceMessage) kind = 'audio';

      return {
        id: uuidv4(),
        url: `/uploads/images/${file.filename}`,
        name: file.originalname || file.filename,
        mimeType: mime,
        size: file.size,
        kind,
        ...(waveform ? { waveform } : {}),
        ...(durationSec ? { durationSec } : {}),
        ...(isVoiceMessage ? { isVoiceMessage: true } : {}),
      };
    });

    res.status(201).json({ attachments });
  });

  // Fast Heavy File Transfer (up to 1.85 GB — Reusable OR One-Time Self-Destruct!)
  app.post(
    '/api/transfers/upload',
    requireAuth,
    (req, _res, next) => {
      const contentLen = Number(req.headers['content-length'] || 0);
      if (contentLen > 0) runStorageEnforce(contentLen);
      next();
    },
    uploadTransfer.single('file'),
    (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo recebido.' });
      const db = getDb();
      const oneTime = String(req.body?.oneTime || req.query?.oneTime || 'false') === 'true';
      const id = `trf-${uuidv4().slice(0, 10)}`;

      const transfer = {
        id,
        filename: req.file.filename,
        originalName: req.file.originalname || req.file.filename,
        mimeType: req.file.mimetype || 'application/octet-stream',
        size: req.file.size,
        oneTime,
        downloadedCount: 0,
        burned: false,
        expiredByCache: false,
        uploadedBy: req.user.displayName,
        uploadedById: req.user.id,
        downloadUrl: `/api/transfers/${id}/download`,
        createdAt: Date.now(),
      };

      db.transfers[id] = transfer;
      saveDb();
      runStorageEnforce(0);

      res.status(201).json({ transfer });
    }
  );

  app.get('/api/transfers/:id/download', (req, res) => {
    const db = getDb();
    const transfer = db.transfers[req.params.id];
    if (!transfer) return res.status(404).json({ error: 'Arquivo não encontrado.' });

    if (transfer.burned) {
      return res.status(410).json({
        error: 'Este arquivo era de download único e já foi baixado e apagado.',
      });
    }
    if (transfer.expiredByCache) {
      return res.status(410).json({
        error: 'Este arquivo foi removido automaticamente para manter o cache abaixo de 2 GB.',
      });
    }

    const filePath = path.join(TRANSFERS_DIR, transfer.filename);
    if (!fs.existsSync(filePath)) {
      transfer.expiredByCache = true;
      saveDb();
      io.emit('transfer:updated', transferStatus(transfer));
      return res.status(410).json({ error: 'Arquivo não está mais disponível no disco.' });
    }

    if (transfer.oneTime) {
      if (inFlightOneTimeTransfers.has(transfer.id)) {
        return res.status(409).json({ error: 'Este download único já está sendo baixado agora.' });
      }
      inFlightOneTimeTransfers.add(transfer.id);
    }

    const stat = fs.statSync(filePath);
    const safeName = transfer.originalName.replace(/["\r\n]/g, '_');
    res.setHeader('Content-Type', transfer.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    res.setHeader('Cache-Control', 'no-store');

    // Retomar download (Range): se a conexão cair no meio de um arquivo grande, o navegador continua de onde parou.
    // Download único não aceita pedaços: ele é apagado ao terminar.
    let start = 0;
    let end = stat.size - 1;
    const range = !transfer.oneTime && /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
    if (!transfer.oneTime) res.setHeader('Accept-Ranges', 'bytes');
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
      } else {
        start = Math.max(0, stat.size - Number(range[2]));
      }
      if (!Number.isFinite(start) || start > end || start >= stat.size) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.status(416).end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    }
    res.setHeader('Content-Length', end - start + 1);
    const reachesEnd = end === stat.size - 1;

    const stream = fs.createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 }); // 1 MB chunks for ultra-fast LAN speed!
    let completed = false;

    res.on('finish', () => {
      completed = true;
      if (!reachesEnd) return; // pedaço do meio de um download retomado: conta só quando chega ao fim
      transfer.downloadedCount = (transfer.downloadedCount || 0) + 1;
      if (transfer.oneTime) {
        inFlightOneTimeTransfers.delete(transfer.id);
        transfer.burned = true;
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
      }
      saveDb();
      io.emit('transfer:updated', transferStatus(transfer));
    });

    res.on('close', () => {
      if (!completed && transfer.oneTime) {
        inFlightOneTimeTransfers.delete(transfer.id);
      }
      stream.destroy();
    });

    stream.on('error', () => {
      inFlightOneTimeTransfers.delete(transfer.id);
      if (!res.headersSent) res.status(500).end();
    });

    stream.pipe(res);
  });

  // Soundboard
  app.get('/api/sounds', requireAuth, (_req, res) => res.json({ sounds: getDb().sounds }));

  app.post('/api/upload/sound', requireAuth, uploadSound.single('audio'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo de áudio (MP3, WAV, OGG, WEBM).' });
    const db = getDb();
    const name = String(req.body?.name || path.parse(req.file.originalname).name || 'Som Novo').trim().slice(0, 32);
    const emoji = oneEmoji(req.body?.emoji) || '🔊';
    const color = /^#[0-9a-f]{6}$/i.test(req.body?.color || '') ? req.body.color : '#5865F2';

    const sound = {
      id: `snd-${uuidv4().slice(0, 8)}`,
      name,
      emoji,
      color,
      url: `/uploads/sounds/${req.file.filename}`,
      volume: 1,
      createdBy: req.user.displayName,
      uploaderId: req.user.id,
      createdAt: Date.now(),
      isStarter: false,
    };

    db.sounds.push(sound);
    saveDb();
    runStorageEnforce(0);
    io.emit('soundboard:updated', db.sounds);
    res.status(201).json({ sound });
  });

  // sons, músicas e GIFs salvos: apaga quem enviou ou quem gerencia expressões (antes qualquer membro apagava tudo)
  const canManageUpload = (user, item) => {
    if (!user || !item) return false;
    const perms = computeServerPermissions(getDb(), user);
    if (user.role === 'host' || perms.administrator || perms.manageExpressions) return true;
    if (item.uploaderId) return item.uploaderId === user.id;
    return Boolean((item.createdBy || item.addedBy) && (item.createdBy || item.addedBy) === user.displayName);
  };

  app.delete('/api/sounds/:id', requireAuth, (req, res) => {
    const db = getDb();
    const idx = db.sounds.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Som não encontrado.' });
    const sound = db.sounds[idx];
    if (sound.isStarter && req.user.role !== 'host') {
      return res.status(403).json({ error: 'Apenas o host pode remover sons padrão.' });
    }
    if (!sound.isStarter && !canManageUpload(req.user, sound)) {
      return res.status(403).json({ error: 'Só quem enviou este som (ou quem gerencia expressões) pode removê-lo.' });
    }
    db.sounds.splice(idx, 1);
    if (!sound.isStarter && sound.url.startsWith('/uploads/sounds/')) {
      const filePath = path.join(SOUNDS_DIR, path.basename(sound.url));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    saveDb();
    io.emit('soundboard:updated', db.sounds);
    res.json({ ok: true });
  });

  // Music Library
  app.get('/api/music/library', requireAuth, (_req, res) => res.json({ tracks: getDb().musicLibrary }));

  app.post('/api/upload/music', requireAuth, uploadMusic.single('audio'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo de áudio (MP3, WAV, OGG, M4A, FLAC).' });
    const db = getDb();
    const fallbackName = path.parse(req.file.originalname || 'Faixa').name;
    const title = String(req.body?.title || fallbackName).trim().slice(0, 64);
    const artist = String(req.body?.artist || req.user.displayName).trim().slice(0, 40);

    const track = {
      id: `trk-${uuidv4().slice(0, 8)}`,
      title,
      artist,
      url: `/uploads/music/${req.file.filename}`,
      source: 'upload',
      addedBy: req.user.displayName,
      uploaderId: req.user.id,
      createdAt: Date.now(),
    };

    db.musicLibrary.unshift(track);
    saveDb();
    runStorageEnforce(0);
    io.emit('music:library-updated', db.musicLibrary);
    res.status(201).json({ track });
  });

  app.delete('/api/music/library/:id', requireAuth, (req, res) => {
    const db = getDb();
    const idx = db.musicLibrary.findIndex((t) => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Faixa não encontrada.' });
    const track = db.musicLibrary[idx];
    if (!canManageUpload(req.user, track)) {
      return res.status(403).json({ error: 'Só quem enviou esta música (ou quem gerencia expressões) pode removê-la.' });
    }
    db.musicLibrary.splice(idx, 1);
    if (track.url.startsWith('/uploads/music/')) {
      const filePath = path.join(MUSIC_DIR, path.basename(track.url));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    saveDb();
    io.emit('music:library-updated', db.musicLibrary);
    res.json({ ok: true });
  });

  // GIFs
  // Busca na internet: KLIPY (substituto gratuito do Tenor, que o Google desligou em 30/06/2026) e GIPHY.
  // As respostas externas são lidas com cuidado (só URLs https) e o erro vai para o app em vez de lista vazia muda.
  const gifCache = new Map(); // `${provider}|${q}` -> { at, results }
  const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) && u.length < 2000 ? u : null);
  function klipyPick(item) {
    // formato do KLIPY: file.{hd,md,sm,xs}.{gif,webp,mp4}.url (alguns campos podem faltar)
    const f = item?.file || item?.files || {};
    const at = (size, kind) => httpsUrl(f?.[size]?.[kind]?.url);
    const url = at('md', 'gif') || at('hd', 'gif') || at('sm', 'gif') || at('xs', 'gif') || at('md', 'webp') || at('hd', 'webp');
    const previewUrl = at('sm', 'gif') || at('xs', 'gif') || at('sm', 'webp') || at('xs', 'webp') || url;
    return { url, previewUrl };
  }
  async function fetchGifJson(url) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { Accept: 'application/json' } });
    let json = null;
    try {
      json = await resp.json();
    } catch {}
    if (!resp.ok) {
      const msg =
        (Array.isArray(json?.errors?.message) && json.errors.message[0]) ||
        json?.meta?.msg ||
        json?.message ||
        `HTTP ${resp.status}`;
      const err = new Error(String(msg).slice(0, 160));
      err.status = resp.status;
      throw err;
    }
    return json;
  }
  async function searchExternalGifs(db, q, customerId) {
    if (db.server.klipyApiKey) {
      const key = encodeURIComponent(db.server.klipyApiKey);
      const base = `https://api.klipy.com/api/v1/${key}/gifs/${q ? 'search' : 'trending'}`;
      const params = new URLSearchParams({ per_page: '24', page: '1', customer_id: customerId, locale: 'pt_BR', content_filter: 'medium' });
      if (q) params.set('q', q);
      const json = await fetchGifJson(`${base}?${params}`);
      const list = Array.isArray(json?.data?.data) ? json.data.data : Array.isArray(json?.data) ? json.data : [];
      return {
        provider: 'klipy',
        results: list
          .filter((item) => item && item.type !== 'ad')
          .map((item) => ({ id: `klipy-${String(item.id ?? item.slug ?? '').slice(0, 64)}`, title: String(item.title || 'GIF').slice(0, 100), ...klipyPick(item) }))
          .filter((g) => g.url),
      };
    }
    if (db.server.giphyApiKey) {
      const key = encodeURIComponent(db.server.giphyApiKey);
      const endpoint = q
        ? `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13&lang=pt`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=24&rating=pg-13`;
      const json = await fetchGifJson(endpoint);
      return {
        provider: 'giphy',
        results: (Array.isArray(json?.data) ? json.data : [])
          .map((item) => ({
            id: `giphy-${String(item.id || '').slice(0, 64)}`,
            title: String(item.title || 'GIF').slice(0, 100),
            url: httpsUrl(item.images?.original?.url) || httpsUrl(item.images?.downsized?.url),
            previewUrl: httpsUrl(item.images?.fixed_width?.url) || httpsUrl(item.images?.original?.url),
          }))
          .filter((g) => g.url),
      };
    }
    return { provider: db.server.tenorApiKey ? 'tenor-off' : 'local', results: [] };
  }

  app.get('/api/gifs', requireAuth, async (req, res) => {
    const db = getDb();
    const q = String(req.query.q || '').trim().slice(0, 100);
    const qLower = q.toLowerCase();

    const savedGifs = qLower
      ? db.savedGifs.filter(
          (g) => g.title.toLowerCase().includes(qLower) || (g.tags || '').toLowerCase().includes(qLower)
        )
      : db.savedGifs;

    let externalResults = [];
    let provider = db.server.klipyApiKey ? 'klipy' : db.server.giphyApiKey ? 'giphy' : db.server.tenorApiKey ? 'tenor-off' : 'local';
    let error = null;
    const keyTag = crypto.createHash('sha256').update(String(db.server.klipyApiKey || db.server.giphyApiKey || '')).digest('hex').slice(0, 8);
    const cacheKey = `${provider}|${keyTag}|${qLower}`;
    const hit = gifCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) {
      externalResults = hit.results;
    } else {
      try {
        // id estável e anônimo para o KLIPY (não manda nome nem id real do usuário)
        const customerId = crypto.createHash('sha256').update(`pulsecord-gif|${req.user.id}`).digest('hex').slice(0, 24);
        const r = await searchExternalGifs(db, q, customerId);
        provider = r.provider;
        externalResults = r.results;
        if (provider === 'klipy' || provider === 'giphy') {
          if (gifCache.size > 200) gifCache.clear();
          gifCache.set(cacheKey, { at: Date.now(), results: externalResults });
        }
      } catch (err) {
        const status = err?.status;
        error =
          status === 401 || status === 403 || status === 404
            ? `A chave do ${provider === 'klipy' ? 'KLIPY' : 'GIPHY'} foi recusada (${err.message}). Confira em Configurações do servidor → Integrações.`
            : status === 429
            ? `Limite de buscas do ${provider === 'klipy' ? 'KLIPY' : 'GIPHY'} atingido. Tente de novo em alguns minutos.`
            : `Não foi possível buscar GIFs agora (${err?.name === 'TimeoutError' ? 'tempo esgotado' : err?.message || 'erro de rede'}).`;
        console.warn('[GIF]', provider, err?.message);
      }
    }

    res.json({ provider, savedGifs, results: externalResults, error });
  });

  app.post('/api/gifs', requireAuth, uploadChat.single('gif'), (req, res) => {
    const db = getDb();
    let url = String(req.body?.url || '').trim();
    if (req.file) url = `/uploads/images/${req.file.filename}`;
    if (!url) return res.status(400).json({ error: 'Informe um link de GIF ou envie um arquivo .gif.' });

    const gif = {
      id: `gif-${uuidv4().slice(0, 8)}`,
      title: String(req.body?.title || 'GIF da Galera').trim().slice(0, 48),
      url,
      previewUrl: url,
      tags: String(req.body?.tags || '').trim().slice(0, 100),
      addedBy: req.user.displayName,
      uploaderId: req.user.id,
      createdAt: Date.now(),
    };

    db.savedGifs.unshift(gif);
    saveDb();
    io.emit('gifs:updated', db.savedGifs);
    res.status(201).json({ gif });
  });

  app.delete('/api/gifs/:id', requireAuth, (req, res) => {
    const db = getDb();
    const idx = db.savedGifs.findIndex((g) => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'GIF não encontrado.' });
    if (!canManageUpload(req.user, db.savedGifs[idx])) {
      return res.status(403).json({ error: 'Só quem salvou este GIF (ou quem gerencia expressões) pode removê-lo.' });
    }
    db.savedGifs.splice(idx, 1);
    saveDb();
    io.emit('gifs:updated', db.savedGifs);
    res.json({ ok: true });
  });

  // ========================
  // Socket.IO Real-Time Layer
  // ========================
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('UNAUTHORIZED'));
    const db = getDb();
    const userId = db.sessions[token];
    const user = db.users.find((u) => u.id === userId);
    if (!user) return next(new Error('UNAUTHORIZED'));
    socket.data.userId = user.id;
    next();
  });

  // ===== Consentimento para gravar a chamada =====
  // Quem quer gravar pede; todos os outros na chamada precisam permitir. Uma recusa (ou 60 s sem resposta)
  // cancela. Quem entra numa chamada que está sendo gravada já confirmou no app antes de entrar.
  const recConsent = recConsentMod.createRecConsent({
    io,
    getRoom: (channelId) => voiceRooms.get(channelId),
    getChannelOf: (sid) => socketVoiceChannel.get(sid),
  });

  function leaveVoiceRoom(socket) {
    const prevChannelId = socketVoiceChannel.get(socket.id);
    if (!prevChannelId) return;
    recConsent.onLeave(socket.id, prevChannelId);

    socketVoiceChannel.delete(socket.id);
    socket.leave(`voice:${prevChannelId}`);

    const roomMap = voiceRooms.get(prevChannelId);
    sfu.removePeer(prevChannelId, socket.id);
    if (roomMap) {
      roomMap.delete(socket.id);
      if (roomMap.size === 0) {
        voiceRooms.delete(prevChannelId);
        sfu.closeRoom(prevChannelId);
        const m = musicStates.get(prevChannelId);
        if (m && m.isPlaying) {
          m.positionSec += Math.max(0, (Date.now() - m.updatedAt) / 1000);
          m.isPlaying = false;
          m.updatedAt = Date.now();
        }
        const v = videoStates.get(prevChannelId);
        if (v && v.isPlaying) {
          v.positionSec += Math.max(0, (Date.now() - v.updatedAt) / 1000) * videoRate(v);
          v.isPlaying = false;
          v.updatedAt = Date.now();
        }
      }
    }

    io.to(`voice:${prevChannelId}`).emit('voice:peer-left', {
      channelId: prevChannelId,
      socketId: socket.id,
    });
    broadcastVoiceRooms();
  }

  io.on('connection', (socket) => {
    const db = getDb();
    const user = db.users.find((u) => u.id === socket.data.userId);
    if (!user) {
      socket.disconnect(true);
      return;
    }

    const wasOffline = !onlineUsers.has(user.id) || onlineUsers.get(user.id).size === 0;
    if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set());
    onlineUsers.get(user.id).add(socket.id);
    if (wasOffline) {
      appendAuditLog({
        type: 'member_join',
        actor: user,
        targetId: user.id,
        targetName: user.displayName,
        details: 'Conectou-se ao servidor',
      });
    }

    const myGroups = Object.values(db.dmGroups || {}).filter(
      (g) => Array.isArray(g.memberIds) && g.memberIds.includes(user.id)
    );

    const visibleChannels = getVisibleChannelsForUser(db, user);
    socket.emit('bootstrap', {
      server: getPublicServerInfo(),
      channels: visibleChannels,
      channelActivity: getChannelActivity(db, visibleChannels),
      categories: db.categories || [],
      roles: db.roles,
      members: getMembersPayload(user.id),
      dmGroups: myGroups,
      voiceRooms: getVoiceRoomsSnapshot(),
      sounds: db.sounds,
      musicLibrary: db.musicLibrary,
      savedGifs: db.savedGifs,
    });
    broadcastUsers();
    advertiser?.broadcastNow();

    // Live Game/App Activity & Status Presence
    socket.on('user:activity', (payload) => {
      const u = getDb().users.find((x) => x.id === socket.data.userId);
      if (!u) return;
      u.currentActivity = sanitizeActivity(payload?.currentActivity);
      if (Array.isArray(payload?.recentActivities)) {
        u.recentActivities = payload.recentActivities.slice(0, 12).map(sanitizeActivity).filter(Boolean);
      }
      saveDb();
      broadcastUsers();
    });

    socket.on('user:status', ({ statusType, customStatusEmoji, customStatusText }) => {
      const u = getDb().users.find((x) => x.id === socket.data.userId);
      if (!u) return;
      if (['online', 'idle', 'dnd', 'invisible'].includes(statusType)) u.statusType = statusType;
      if (typeof customStatusEmoji === 'string') u.customStatusEmoji = oneEmoji(customStatusEmoji);
      if (typeof customStatusText === 'string') u.customStatusText = customStatusText.trim().slice(0, 64);
      saveDb();
      broadcastUsers();
    });

    // Server Text Chat (Permissions + Slow Mode + Embeds/Files check)
    socket.on('chat:send', (payload, cb) => {
      const currentDb = getDb();
      const author = currentDb.users.find((u) => u.id === socket.data.userId);
      if (!author) return;

      const channelId = String(payload?.channelId || '');
      const channel = currentDb.channels.find((c) => c.id === channelId && c.type === 'text');
      if (!channel) return cb?.({ error: 'Canal de texto inválido.' });

      const cPerms = computeChannelPermissions(currentDb, author, channel);
      if (!cPerms.viewChannels || !cPerms.sendMessages) {
        return cb?.({ error: 'Você não tem permissão para enviar mensagens neste canal.' });
      }

      const content = String(payload?.content || '').trim().slice(0, 4000);
      let attachments = Array.isArray(payload?.attachments) ? payload.attachments.slice(0, 6) : [];
      if (attachments.length > 0 && !cPerms.attachFiles) {
        return cb?.({ error: 'Seu cargo não tem permissão para anexar arquivos neste canal.' });
      }
      const gifUrl = typeof payload?.gifUrl === 'string' && payload.gifUrl.trim() ? payload.gifUrl.trim() : null;
      const transfer = payload?.transfer?.id && currentDb.transfers[payload.transfer.id]
        ? currentDb.transfers[payload.transfer.id]
        : null;
      if (transfer && !cPerms.attachFiles) {
        return cb?.({ error: 'Seu cargo não tem permissão para enviar arquivos neste canal.' });
      }
      if ((gifUrl || /https?:\/\//i.test(content)) && !cPerms.embedLinks) {
        // Still allow plain text, or block external embed links when denied
      }

      // Enforce Slow Mode unless manageMessages
      if (channel.slowModeSec > 0 && !cPerms.manageMessages && !cPerms.administrator) {
        const key = `${channel.id}:${author.id}`;
        const prevAt = lastChannelMsgAt.get(key) || 0;
        const remainMs = channel.slowModeSec * 1000 - (Date.now() - prevAt);
        if (remainMs > 0) {
          return cb?.({ error: `Modo Lento ativo! Aguarde ${Math.ceil(remainMs / 1000)}s para enviar novamente.` });
        }
        lastChannelMsgAt.set(key, Date.now());
      }

      const replyTo = payload?.replyTo || null;

      const threadParentId = typeof payload?.threadParentId === 'string' ? payload.threadParentId : '';
      const threadParent = threadParentId ? findChannelMessage(currentDb, channelId, threadParentId) : null;
      if (threadParentId && !threadParent) return cb?.({ error: 'A mensagem da thread não existe mais.' });
      const poll = threadParent ? null : sanitizePoll(payload?.poll);
      if (payload?.poll && !poll && !threadParent) return cb?.({ error: 'A enquete precisa de uma pergunta e pelo menos 2 opções.' });

      if (!content && attachments.length === 0 && !gifUrl && !transfer && !poll) return cb?.({ error: 'Mensagem vazia.' });

      const msg = {
        id: `msg-${uuidv4()}`,
        channelId,
        authorId: author.id,
        authorName: author.displayName,
        authorAvatar: author.avatarUrl || null,
        authorColor: author.avatarColor || '#5865F2',
        content,
        attachments,
        gifUrl,
        transfer,
        replyTo: replyTo
          ? {
              id: String(replyTo.id || ''),
              authorName: String(replyTo.authorName || ''),
              snippet: String(replyTo.snippet || '').slice(0, 120),
            }
          : null,
        createdAt: Date.now(),
      };
      if (poll) msg.poll = poll;

      if (threadParent) {
        msg.threadParentId = threadParent.id;
        if (!currentDb.threadMessages) currentDb.threadMessages = {};
        const tl = currentDb.threadMessages[threadParent.id] || (currentDb.threadMessages[threadParent.id] = []);
        tl.push(msg);
        if (tl.length > 1000) currentDb.threadMessages[threadParent.id] = tl.slice(-1000);
        threadParent.thread = {
          count: currentDb.threadMessages[threadParent.id].length,
          lastAt: msg.createdAt,
          lastAuthorName: author.displayName,
        };
        saveDb();
        emitToChannel(channel, 'chat:thread-message', { channelId, parentId: threadParent.id, message: msg });
        emitToChannel(channel, 'chat:message-updated', { channelId, message: threadParent });
        return cb?.({ ok: true, message: msg });
      }

      if (!currentDb.messages[channelId]) currentDb.messages[channelId] = [];
      currentDb.messages[channelId].push(msg);
      // Compressed encrypted vault keeps up to 5000 text messages per channel using < 300 KB!
      if (currentDb.messages[channelId].length > 5000) {
        currentDb.messages[channelId] = currentDb.messages[channelId].slice(-5000);
      }
      saveDb();

      emitToChannel(channel, 'chat:message', msg);
      cb?.({ ok: true, message: msg });
    });

    // Reações (toque de novo para tirar)
    socket.on('chat:react', (payload, cb) => {
      const db = getDb();
      const actor = db.users.find((u) => u.id === socket.data.userId);
      const ch = db.channels.find((c) => c.id === payload?.channelId && c.type === 'text');
      if (!actor || !ch || !computeChannelPermissions(db, actor, ch).viewChannels) return cb?.({ error: 'Sem acesso a este canal.' });
      const emoji = String(payload?.emoji || '').trim();
      if (!emoji || emoji.length > 32 || /[<>\s]/.test(emoji)) return cb?.({ error: 'Reação inválida.' });
      const msg = findChannelMessage(db, ch.id, String(payload?.messageId || ''), payload?.threadParentId || '');
      if (!msg) return cb?.({ error: 'Mensagem não encontrada.' });
      if (!msg.reactions || typeof msg.reactions !== 'object') msg.reactions = {};
      const list = Array.isArray(msg.reactions[emoji]) ? msg.reactions[emoji] : null;
      if (list && list.includes(actor.id)) {
        msg.reactions[emoji] = list.filter((id) => id !== actor.id);
        if (!msg.reactions[emoji].length) delete msg.reactions[emoji];
      } else {
        if (!list && Object.keys(msg.reactions).length >= 20) return cb?.({ error: 'Limite de 20 reações diferentes.' });
        msg.reactions[emoji] = [...(list || []), actor.id];
      }
      saveDb();
      emitMessageUpdated(ch, msg);
      cb?.({ ok: true });
    });

    // Enquetes: votar (substitui o voto anterior) e encerrar
    socket.on('chat:poll-vote', (payload, cb) => {
      const db = getDb();
      const actor = db.users.find((u) => u.id === socket.data.userId);
      const ch = db.channels.find((c) => c.id === payload?.channelId && c.type === 'text');
      if (!actor || !ch || !computeChannelPermissions(db, actor, ch).viewChannels) return cb?.({ error: 'Sem acesso a este canal.' });
      const msg = findChannelMessage(db, ch.id, String(payload?.messageId || ''));
      if (!msg?.poll) return cb?.({ error: 'Enquete não encontrada.' });
      if (msg.poll.closed || (msg.poll.endsAt && Date.now() > msg.poll.endsAt)) return cb?.({ error: 'Esta enquete já foi encerrada.' });
      const valid = new Set(msg.poll.options.map((o) => o.id));
      let chosen = (Array.isArray(payload?.optionIds) ? payload.optionIds : []).map(String).filter((id) => valid.has(id));
      if (!msg.poll.multi) chosen = chosen.slice(0, 1);
      for (const o of msg.poll.options) {
        o.votes = (o.votes || []).filter((id) => id !== actor.id);
        if (chosen.includes(o.id)) o.votes.push(actor.id);
      }
      saveDb();
      emitMessageUpdated(ch, msg);
      cb?.({ ok: true });
    });

    socket.on('chat:poll-close', (payload, cb) => {
      const db = getDb();
      const actor = db.users.find((u) => u.id === socket.data.userId);
      const ch = db.channels.find((c) => c.id === payload?.channelId && c.type === 'text');
      if (!actor || !ch) return cb?.({ error: 'Canal inválido.' });
      const msg = findChannelMessage(db, ch.id, String(payload?.messageId || ''));
      if (!msg?.poll) return cb?.({ error: 'Enquete não encontrada.' });
      if (msg.authorId !== actor.id && !computeChannelPermissions(db, actor, ch).manageMessages) {
        return cb?.({ error: 'Só quem criou pode encerrar a enquete.' });
      }
      msg.poll.closed = true;
      msg.poll.endsAt = Math.min(msg.poll.endsAt || Date.now(), Date.now());
      saveDb();
      emitMessageUpdated(ch, msg);
      cb?.({ ok: true });
    });

    socket.on('clock:sync', (clientSentAt, cb) => {
      cb?.({ serverNow: Date.now(), clientSentAt });
    });

    socket.on('chat:pin', ({ channelId, messageId, pinned }, cb) => {
      const currentDb = getDb();
      const actor = currentDb.users.find((u) => u.id === socket.data.userId);
      const ch = currentDb.channels.find((c) => c.id === channelId);
      const list = currentDb.messages[channelId];
      if (!actor || !list || !ch) return cb?.({ error: 'Canal inválido.' });
      if (!computeChannelPermissions(currentDb, actor, ch).pinMessages) {
        return cb?.({ error: 'Sem permissão para fixar mensagens neste canal.' });
      }
      const msg = list.find((m) => m.id === messageId);
      if (!msg) return cb?.({ error: 'Mensagem não encontrada.' });
      const nextPinned = typeof pinned === 'boolean' ? pinned : !msg.pinned;
      msg.pinned = nextPinned;
      msg.pinnedAt = nextPinned ? Date.now() : null;
      msg.pinnedBy = nextPinned ? actor.displayName : null;
      appendAuditLog({
        type: 'message_pin',
        actor,
        targetId: msg.id,
        targetName: `#${ch.name}`,
        details: `${nextPinned ? 'Fixou' : 'Desafixou'} mensagem em #${ch.name}`,
      });
      saveDb();
      emitToChannel(ch, 'chat:message-pinned', { channelId, message: msg, pinnedBy: actor.displayName });
      cb?.({ ok: true, message: msg });
    });

    socket.on('chat:typing', ({ channelId, isTyping }) => {
      const author = getDb().users.find((u) => u.id === socket.data.userId);
      if (!author || !channelId) return;
      socket.broadcast.emit('chat:typing', {
        channelId,
        userId: author.id,
        displayName: author.displayName,
        isTyping: Boolean(isTyping),
      });
    });

    // Private Direct Messages (1-on-1)
    socket.on('dm:send', (payload, cb) => {
      const currentDb = getDb();
      const author = currentDb.users.find((u) => u.id === socket.data.userId);
      const toUserId = String(payload?.toUserId || '');
      const recipient = currentDb.users.find((u) => u.id === toUserId);
      if (!author || !recipient) return cb?.({ error: 'Destinatário inválido.' });

      const content = String(payload?.content || '').trim().slice(0, 4000);
      const attachments = Array.isArray(payload?.attachments) ? payload.attachments.slice(0, 6) : [];
      const gifUrl = typeof payload?.gifUrl === 'string' && payload.gifUrl.trim() ? payload.gifUrl.trim() : null;
      const transfer = payload?.transfer?.id && currentDb.transfers[payload.transfer.id]
        ? currentDb.transfers[payload.transfer.id]
        : null;

      if (!content && attachments.length === 0 && !gifUrl && !transfer) return cb?.({ error: 'Mensagem vazia.' });

      const pairKey = getDmPairKey(author.id, recipient.id);
      const msg = {
        id: `dm-${uuidv4()}`,
        channelId: `dm:${pairKey}`,
        pairKey,
        toUserId: recipient.id,
        authorId: author.id,
        authorName: author.displayName,
        authorAvatar: author.avatarUrl || null,
        authorColor: author.avatarColor || '#5865F2',
        content,
        attachments,
        gifUrl,
        transfer,
        replyTo: null,
        createdAt: Date.now(),
      };

      if (!currentDb.directMessages[pairKey]) currentDb.directMessages[pairKey] = [];
      currentDb.directMessages[pairKey].push(msg);
      if (currentDb.directMessages[pairKey].length > 5000) {
        currentDb.directMessages[pairKey] = currentDb.directMessages[pairKey].slice(-5000);
      }
      saveDb();

      emitToUser(author.id, 'dm:message', msg);
      if (recipient.id !== author.id) emitToUser(recipient.id, 'dm:message', msg);
      cb?.({ ok: true, message: msg });
    });

    socket.on('dm:pin', ({ toUserId, messageId, pinned }, cb) => {
      const currentDb = getDb();
      const actor = currentDb.users.find((u) => u.id === socket.data.userId);
      if (!actor || !toUserId || !messageId) return cb?.({ error: 'Parâmetros inválidos.' });
      const pairKey = getDmPairKey(actor.id, String(toUserId));
      const list = currentDb.directMessages[pairKey] || [];
      const msg = list.find((m) => m.id === messageId);
      if (!msg) return cb?.({ error: 'Mensagem privada não encontrada.' });
      const nextPinned = typeof pinned === 'boolean' ? pinned : !msg.pinned;
      msg.pinned = nextPinned;
      msg.pinnedAt = nextPinned ? Date.now() : null;
      msg.pinnedBy = nextPinned ? actor.displayName : null;
      saveDb();
      emitToUser(actor.id, 'dm:message-pinned', { pairKey, message: msg, pinnedBy: actor.displayName });
      if (String(toUserId) !== actor.id) {
        emitToUser(String(toUserId), 'dm:message-pinned', { pairKey, message: msg, pinnedBy: actor.displayName });
      }
      cb?.({ ok: true, message: msg });
    });

    // Private Group Chats & Group Calls
    socket.on('dm-group:send', (payload, cb) => {
      const currentDb = getDb();
      const author = currentDb.users.find((u) => u.id === socket.data.userId);
      const groupId = String(payload?.groupId || '');
      const group = currentDb.dmGroups?.[groupId];
      if (!author || !group || !group.memberIds.includes(author.id)) {
        return cb?.({ error: 'Grupo inválido ou sem acesso.' });
      }
      const content = String(payload?.content || '').trim().slice(0, 4000);
      const attachments = Array.isArray(payload?.attachments) ? payload.attachments.slice(0, 6) : [];
      const gifUrl = typeof payload?.gifUrl === 'string' && payload.gifUrl.trim() ? payload.gifUrl.trim() : null;
      const transfer = payload?.transfer?.id && currentDb.transfers[payload.transfer.id]
        ? currentDb.transfers[payload.transfer.id]
        : null;
      if (!content && attachments.length === 0 && !gifUrl && !transfer) return cb?.({ error: 'Mensagem vazia.' });

      const msg = {
        id: `grpmsg-${uuidv4()}`,
        channelId: `group:${group.id}`,
        authorId: author.id,
        authorName: author.displayName,
        authorAvatar: author.avatarUrl || null,
        authorColor: author.avatarColor || '#5865F2',
        content,
        attachments,
        gifUrl,
        transfer,
        replyTo: payload?.replyTo || null,
        createdAt: Date.now(),
      };
      if (!currentDb.groupMessages) currentDb.groupMessages = {};
      if (!currentDb.groupMessages[group.id]) currentDb.groupMessages[group.id] = [];
      currentDb.groupMessages[group.id].push(msg);
      if (currentDb.groupMessages[group.id].length > 5000) {
        currentDb.groupMessages[group.id] = currentDb.groupMessages[group.id].slice(-5000);
      }
      saveDb();
      for (const uid of group.memberIds) emitToUser(uid, 'dm-group:message', { groupId: group.id, message: msg });
      cb?.({ ok: true, message: msg });
    });

    socket.on('dm-group:pin', ({ groupId, messageId, pinned }, cb) => {
      const currentDb = getDb();
      const actor = currentDb.users.find((u) => u.id === socket.data.userId);
      const group = currentDb.dmGroups?.[groupId];
      if (!actor || !group || !group.memberIds.includes(actor.id)) return cb?.({ error: 'Sem acesso.' });
      const list = currentDb.groupMessages?.[groupId] || [];
      const msg = list.find((m) => m.id === messageId);
      if (!msg) return cb?.({ error: 'Mensagem não encontrada.' });
      const nextPinned = typeof pinned === 'boolean' ? pinned : !msg.pinned;
      msg.pinned = nextPinned;
      msg.pinnedAt = nextPinned ? Date.now() : null;
      msg.pinnedBy = nextPinned ? actor.displayName : null;
      saveDb();
      for (const uid of group.memberIds) {
        emitToUser(uid, 'dm-group:message-pinned', { groupId, message: msg, pinnedBy: actor.displayName });
      }
      cb?.({ ok: true, message: msg });
    });

    socket.on('dm-group:call-invite', ({ groupId }) => {
      const currentDb = getDb();
      const caller = currentDb.users.find((u) => u.id === socket.data.userId);
      const group = currentDb.dmGroups?.[groupId];
      if (!caller || !group || !group.memberIds.includes(caller.id)) return;
      const dmRoomId = `group:${group.id}`;
      for (const uid of group.memberIds) {
        if (uid === caller.id) continue;
        emitToUser(uid, 'dm:call-incoming', {
          dmRoomId,
          fromUser: sanitizeUser(caller),
          group,
        });
      }
    });

    // Private 1-on-1 Call Invites
    socket.on('dm:call-invite', ({ toUserId }) => {
      const currentDb = getDb();
      const caller = currentDb.users.find((u) => u.id === socket.data.userId);
      if (!caller || !toUserId) return;
      const dmRoomId = `dm:${getDmPairKey(caller.id, toUserId)}`;
      emitToUser(toUserId, 'dm:call-incoming', {
        dmRoomId,
        fromUser: sanitizeUser(caller),
      });
    });

    socket.on('dm:call-decline', ({ toUserId, dmRoomId }) => {
      const caller = getDb().users.find((u) => u.id === socket.data.userId);
      if (!caller || !toUserId) return;
      emitToUser(toUserId, 'dm:call-declined', { dmRoomId, byName: caller.displayName });
    });

    // Voice & Video Rooms (supports server voice channels, dm:<pairKey> AND group:<groupId> calls!)
    socket.on('voice:join', async ({ channelId, muted, deafened, sfu: sfuCapable }, cb) => {
      const currentDb = getDb();
      const currentUser = currentDb.users.find((u) => u.id === socket.data.userId);
      if (!currentUser) return cb?.({ error: 'Usuário inválido.' });

      const isPrivateDmRoom = typeof channelId === 'string' && channelId.startsWith('dm:');
      const isPrivateGroupRoom = typeof channelId === 'string' && channelId.startsWith('group:');
      let channelObj = null;
      if (isPrivateDmRoom) {
        const pairIds = channelId.slice(3).split('::');
        if (!pairIds.includes(currentUser.id)) {
          return cb?.({ error: 'Sem acesso a esta chamada privada.' });
        }
      } else if (isPrivateGroupRoom) {
        const gid = channelId.slice(6);
        const grp = currentDb.dmGroups?.[gid];
        if (!grp || !Array.isArray(grp.memberIds) || !grp.memberIds.includes(currentUser.id)) {
          return cb?.({ error: 'Sem acesso a este grupo.' });
        }
      } else {
        channelObj = currentDb.channels.find((c) => c.id === channelId && c.type === 'voice');
        if (!channelObj) return cb?.({ error: 'Sala de voz não encontrada.' });
        const perms = computeChannelPermissions(currentDb, currentUser, channelObj);
        if (!perms.viewChannels || !perms.connectVoice) {
          return cb?.({ error: 'Seu cargo não tem permissão para conectar neste canal de voz.' });
        }
        const curSize = Array.from(voiceRooms.get(channelId)?.values() || []).filter((p) => p.userId !== currentUser.id).length;
        if (channelObj.userLimit > 0 && curSize >= channelObj.userLimit && !perms.moveMembers && !perms.administrator) {
          return cb?.({ error: `Canal cheio (limite ${channelObj.userLimit} usuários).` });
        }
      }

      leaveVoiceRoom(socket);

      if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Map());
      const roomMap = voiceRooms.get(channelId);
      // sockets antigos da mesma conta (queda de rede que o servidor ainda não percebeu, ou outro aparelho)
      // não entram como peers: são removidos logo abaixo
      const existingPeers = Array.from(roomMap.values()).filter((p) => p.userId !== currentUser.id);

      const joinPerms = channelObj ? computeChannelPermissions(currentDb, currentUser, channelObj) : null;
      const canSpeakHere = joinPerms ? joinPerms.speakVoice : true;
      // Palco: moderadores entram falando; o resto entra na plateia (sem microfone) e pode levantar a mão
      const isStage = Boolean(channelObj?.isStage);
      const stageMod = isStage && isStageModerator(currentUser, joinPerms);
      const stageRole = isStage ? (stageMod ? 'speaker' : 'audience') : null;
      const effectiveServerMuted = Boolean(currentUser.serverMuted || !canSpeakHere || stageRole === 'audience');

      const participant = {
        socketId: socket.id,
        userId: currentUser.id,
        displayName: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl || null,
        avatarColor: currentUser.avatarColor || '#5865F2',
        avatarDecoration: currentUser.avatarDecoration || 'none',
        muted: Boolean(muted || effectiveServerMuted),
        deafened: Boolean(deafened || currentUser.serverDeafened),
        serverMuted: effectiveServerMuted,
        serverDeafened: Boolean(currentUser.serverDeafened),
        cameraOn: false,
        screenSharing: false,
        screenLabel: '',
        streamsMeta: null,
        joinedAt: Date.now(),
        noSpeak: !canSpeakHere,
        stageRole,
        handRaised: false,
        recording: null,
        // o cliente sabe usar o SFU (mediasoup-client carregou); clientes antigos não mandam isto
        sfuCapable: Boolean(sfuCapable),
      };

      roomMap.set(socket.id, participant);
      socketVoiceChannel.set(socket.id, channelId);
      socket.join(`voice:${channelId}`);
      recConsent.onJoin(channelId, socket.id);

      // Mesma conta entrando por outro socket: o antigo sai da call (como no Discord). Feito depois de
      // adicionar o novo, para a sala não ficar vazia e pausar música/vídeo numa simples reconexão.
      const staleSockets = [];
      for (const [sid, chId] of socketVoiceChannel) {
        if (sid !== socket.id && voiceRooms.get(chId)?.get(sid)?.userId === currentUser.id) staleSockets.push([sid, chId]);
      }
      for (const [sid, chId] of staleSockets) {
        const oldSock = io.sockets.sockets.get(sid);
        if (oldSock) {
          leaveVoiceRoom(oldSock);
          oldSock.emit('voice:moved-elsewhere', { channelId: chId });
        } else {
          socketVoiceChannel.delete(sid);
          voiceRooms.get(chId)?.delete(sid);
          sfu.removePeer(chId, sid);
          io.to(`voice:${chId}`).emit('voice:peer-left', { channelId: chId, socketId: sid });
        }
      }

      if (channelObj) {
        appendAuditLog({
          type: 'voice_join',
          actor: currentUser,
          targetId: channelObj.id,
          targetName: channelObj.name,
          details: `Entrou na call #${channelObj.name}`,
        });
      }

      // SFU ou malha? Decidido antes de avisar os outros (eles recebem 'sfu:mode' antes do 'voice:peer-joined')
      let sfuInfo = null;
      if (sfu.available) {
        const everyoneCapable = Array.from(roomMap.values()).every((p) => p.sfuCapable);
        const active = sfu.hasRoom(channelId);
        if (active && !everyoneCapable) {
          // entrou alguém com app antigo: a call inteira volta para a malha
          sfu.closeRoom(channelId);
          socket.to(`voice:${channelId}`).emit('sfu:mode', { channelId, enabled: false });
        } else if (everyoneCapable && (active || sfu.shouldUseFor(roomMap.size))) {
          let caps = null;
          try {
            caps = await sfu.ensureRoom(channelId);
          } catch (err) {
            console.warn('[SFU] não foi possível abrir a sala; usando malha:', err?.message || err);
          }
          // saiu (ou trocou de call) enquanto o router era criado
          if (socketVoiceChannel.get(socket.id) !== channelId) return cb?.({ error: 'Você saiu da call.' });
          if (caps) {
            sfuInfo = { enabled: true, routerRtpCapabilities: caps };
            if (!active) {
              socket.to(`voice:${channelId}`).emit('sfu:mode', { channelId, enabled: true, routerRtpCapabilities: caps });
            }
          }
        }
      }

      socket.to(`voice:${channelId}`).emit('voice:peer-joined', { channelId, peer: participant });
      if (isPrivateDmRoom || isPrivateGroupRoom) {
        io.to(`voice:${channelId}`).emit('voice:dm-participants', {
          channelId,
          participants: Array.from(roomMap.values()),
        });
      }
      broadcastVoiceRooms();

      cb?.({
        ok: true,
        channelId,
        selfSocketId: socket.id,
        peers: existingPeers,
        participants: Array.from(roomMap.values()),
        musicState: serializeMusicState(channelId),
        videoState: serializeVideoState(channelId),
        whiteboardState: wbRoom.publicState(getOrCreateWhiteboardState(channelId)),
        sfu: sfuInfo,
      });
    });

    socket.on('voice:leave', () => {
      const prev = socketVoiceChannel.get(socket.id);
      const leaver = getDb().users.find((u) => u.id === socket.data.userId);
      const prevChObj = prev && !prev.startsWith('dm:') && !prev.startsWith('group:')
        ? getDb().channels.find((c) => c.id === prev)
        : null;
      leaveVoiceRoom(socket);
      if (prevChObj && leaver) {
        appendAuditLog({
          type: 'voice_leave',
          actor: leaver,
          targetId: prevChObj.id,
          targetName: prevChObj.name,
          details: `Saiu da call #${prevChObj.name}`,
        });
      }
      if (prev && (prev.startsWith('dm:') || prev.startsWith('group:'))) {
        const roomMap = voiceRooms.get(prev);
        io.to(`voice:${prev}`).emit('voice:dm-participants', {
          channelId: prev,
          participants: roomMap ? Array.from(roomMap.values()) : [],
        });
      }
    });

    socket.on('voice:record-request', (_payload, cb) => recConsent.request(socket, cb));
    socket.on('voice:record-consent', (payload) => recConsent.consent(socket, payload));

    socket.on('voice:media-state', (state) => {
      const channelId = socketVoiceChannel.get(socket.id);
      if (!channelId) return;
      const roomMap = voiceRooms.get(channelId);
      const participant = roomMap?.get(socket.id);
      if (!participant) return;

      const currentDb = getDb();
      const actor = currentDb.users.find((u) => u.id === socket.data.userId);
      const chObj = !channelId.startsWith('dm:') && !channelId.startsWith('group:')
        ? currentDb.channels.find((c) => c.id === channelId)
        : null;
      const canStreamHere = actor && chObj ? computeChannelPermissions(currentDb, actor, chObj).streamVideo : true;

      if (typeof state?.muted === 'boolean') participant.muted = state.muted || Boolean(participant.serverMuted);
      if (typeof state?.deafened === 'boolean') participant.deafened = state.deafened || Boolean(participant.serverDeafened);
      if (typeof state?.cameraOn === 'boolean') participant.cameraOn = canStreamHere ? state.cameraOn : false;
      if (typeof state?.screenSharing === 'boolean') participant.screenSharing = canStreamHere ? state.screenSharing : false;
      if (typeof state?.screenLabel === 'string') participant.screenLabel = state.screenLabel.slice(0, 64);
      // de quem eu saí da transmissão (só ids desta call): quem transmite para de me mandar a tela
      if (Array.isArray(state?.notWatching)) {
        participant.notWatching = state.notWatching
          .filter((id) => typeof id === 'string' && id !== socket.id && roomMap.has(id))
          .slice(0, 32);
      }
      // aviso para todos quando alguém grava a chamada (ou mantém clipes)
      recConsent.applyRecording(socket, channelId, participant, state);

      if ((channelId.startsWith('dm:') || channelId.startsWith('group:')) && roomMap) {
        io.to(`voice:${channelId}`).emit('voice:dm-participants', {
          channelId,
          participants: Array.from(roomMap.values()),
        });
      }
      broadcastVoiceRooms();
    });

    // ---- Palco: levantar a mão, chamar para falar, voltar para a plateia
    socket.on('stage:raise-hand', (payload, cb) => {
      const channelId = socketVoiceChannel.get(socket.id);
      const participant = channelId ? voiceRooms.get(channelId)?.get(socket.id) : null;
      if (!participant || !participant.stageRole) return cb?.({ error: 'Você não está num palco.' });
      participant.handRaised = participant.stageRole === 'audience' && Boolean(payload?.raised);
      broadcastVoiceRooms();
      if (participant.handRaised) {
        io.to(`voice:${channelId}`).emit('stage:hand-raised', { channelId, socketId: socket.id, displayName: participant.displayName });
      }
      cb?.({ ok: true });
    });

    socket.on('stage:set-speaker', (payload, cb) => {
      const channelId = socketVoiceChannel.get(socket.id);
      const roomMap = channelId ? voiceRooms.get(channelId) : null;
      const actorP = roomMap?.get(socket.id);
      const db = getDb();
      const actor = db.users.find((u) => u.id === socket.data.userId);
      const ch = db.channels.find((c) => c.id === channelId);
      if (!actorP || !actor || !ch?.isStage) return cb?.({ error: 'Você não está num palco.' });
      const targetSid = String(payload?.socketId || socket.id);
      const target = roomMap.get(targetSid);
      if (!target) return cb?.({ error: 'Participante não encontrado.' });
      const speaker = Boolean(payload?.speaker);
      const isSelf = targetSid === socket.id;
      // qualquer um pode descer do palco sozinho; subir alguém (ou tirar outra pessoa) é coisa de moderador
      if (!(isSelf && !speaker) && !isStageModerator(actor, computeChannelPermissions(db, actor, ch))) {
        return cb?.({ error: 'Só moderadores do palco podem fazer isso.' });
      }
      const targetUser = db.users.find((u) => u.id === target.userId);
      target.stageRole = speaker ? 'speaker' : 'audience';
      target.handRaised = false;
      target.serverMuted = Boolean(targetUser?.serverMuted) || Boolean(target.noSpeak) || !speaker;
      if (target.serverMuted) target.muted = true;
      const tSock = io.sockets.sockets.get(targetSid);
      tSock?.emit('stage:role', {
        channelId,
        role: target.stageRole,
        serverMuted: target.serverMuted,
        serverDeafened: Boolean(target.serverDeafened),
        by: isSelf ? null : actor.displayName,
      });
      broadcastVoiceRooms();
      cb?.({ ok: true });
    });

    // SFU (mediasoup): transportes, producers e consumers
    sfu.attachSocket(socket);

    // WebRTC Signaling (só para conexões reais: um nome de sala aqui mandaria para todo mundo da sala)
    const isLiveSocketId = (id) => typeof id === 'string' && id.length < 64 && io.sockets.sockets.has(id);
    // sinalização WebRTC só entre quem está na mesma chamada: o app atende ofertas de quem está na call,
    // então sem isso alguém de fora poderia abrir conexão e ouvir o microfone de quem está na chamada.
    const inSameCall = (otherSid) => {
      const ch = socketVoiceChannel.get(socket.id);
      return Boolean(ch) && isLiveSocketId(otherSid) && socketVoiceChannel.get(otherSid) === ch;
    };
    socket.on('rtc:description', ({ targetSocketId, description } = {}) => {
      if (!inSameCall(targetSocketId) || !description) return;
      io.to(targetSocketId).emit('rtc:description', { fromSocketId: socket.id, description });
    });

    socket.on('rtc:ice-candidate', ({ targetSocketId, candidate } = {}) => {
      if (!inSameCall(targetSocketId) || !candidate) return;
      io.to(targetSocketId).emit('rtc:ice-candidate', { fromSocketId: socket.id, candidate });
    });

    socket.on('rtc:streams-meta', ({ targetSocketId, meta } = {}) => {
      const channelId = socketVoiceChannel.get(socket.id);
      if (!channelId) return;
      const participant = voiceRooms.get(channelId)?.get(socket.id);
      if (participant) participant.streamsMeta = meta || null;
      if (targetSocketId) {
        if (inSameCall(targetSocketId)) io.to(targetSocketId).emit('rtc:streams-meta', { fromSocketId: socket.id, meta });
      } else {
        socket.to(`voice:${channelId}`).emit('rtc:streams-meta', { fromSocketId: socket.id, meta });
      }
    });

    // Controle remoto: o "aceitar" só passa se existir um convite/pedido de verdade entre as duas pessoas.
    // Antes, qualquer membro podia mandar um "aceito" falso e o app do outro liberava mouse e teclado sem perguntar.
    const rcPermsOf = (p) => ({ mouse: p?.mouse !== false, keyboard: p?.keyboard !== false, gamepad: p?.gamepad !== false });
    socket.on('rc:invite', ({ targetSocketId } = {}) => {
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      if (!isLiveSocketId(targetSocketId) || targetSocketId === socket.id || !actor) return;
      rcPendingSet(socket.id, targetSocketId, 'invite');
      io.to(targetSocketId).emit('rc:invited', {
        fromSocketId: socket.id,
        fromName: actor.displayName,
        fromUserId: actor.id,
      });
    });

    socket.on('rc:request', ({ targetSocketId } = {}) => {
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      if (!isLiveSocketId(targetSocketId) || targetSocketId === socket.id || !actor) return;
      rcPendingSet(socket.id, targetSocketId, 'request');
      io.to(targetSocketId).emit('rc:requested', {
        fromSocketId: socket.id,
        fromName: actor.displayName,
        fromUserId: actor.id,
      });
    });

    socket.on('rc:accept', ({ targetSocketId, permissions } = {}) => {
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      if (!isLiveSocketId(targetSocketId) || !actor) return;
      // quem aceita responde a um convite/pedido que o outro (targetSocketId) mandou para mim
      const pending = rcPendingTake(targetSocketId, socket.id);
      if (!pending) return;
      io.to(targetSocketId).emit('rc:accepted', {
        fromSocketId: socket.id,
        fromName: actor.displayName,
        // convite: quem convidou passa a ser controlado; pedido: quem pediu passa a controlar
        role: pending.kind === 'invite' ? 'controller' : 'host',
        permissions: rcPermsOf(permissions),
      });
    });

    socket.on('rc:permissions-update', ({ targetSocketId, permissions } = {}) => {
      if (!isLiveSocketId(targetSocketId) || !permissions) return;
      io.to(targetSocketId).emit('rc:permissions-updated', { fromSocketId: socket.id, permissions: rcPermsOf(permissions) });
    });

    socket.on('rc:decline', ({ targetSocketId } = {}) => {
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      if (!isLiveSocketId(targetSocketId) || !actor) return;
      if (!rcPendingTake(targetSocketId, socket.id)) return;
      io.to(targetSocketId).emit('rc:declined', {
        fromSocketId: socket.id,
        fromName: actor.displayName,
      });
    });

    socket.on('rc:revoke', ({ targetSocketId } = {}) => {
      if (!isLiveSocketId(targetSocketId)) return;
      io.to(targetSocketId).emit('rc:revoked', { fromSocketId: socket.id });
    });

    socket.on('rc:input', ({ targetSocketId, event } = {}) => {
      if (!isLiveSocketId(targetSocketId) || !event) return;
      io.to(targetSocketId).emit('rc:input', { fromSocketId: socket.id, event });
    });

    // Soundboard (respects useSoundboard permission!)
    socket.on('soundboard:play', ({ channelId, soundId }) => {
      const activeChannel = socketVoiceChannel.get(socket.id);
      // só toca na chamada em que a pessoa está
      if (!activeChannel || (channelId && channelId !== activeChannel)) return;
      const currentDb = getDb();
      const sound = currentDb.sounds.find((s) => s.id === soundId);
      const actor = currentDb.users.find((u) => u.id === socket.data.userId);
      if (!sound || !actor) return;
      if (!activeChannel.startsWith('dm:') && !activeChannel.startsWith('group:')) {
        const chObj = currentDb.channels.find((c) => c.id === activeChannel);
        if (chObj && !computeChannelPermissions(currentDb, actor, chObj).useSoundboard) return;
      }

      io.to(`voice:${activeChannel}`).emit('soundboard:played', {
        channelId: activeChannel,
        sound,
        playedBy: { userId: actor.id, displayName: actor.displayName, avatarColor: actor.avatarColor },
        playedAt: Date.now(),
      });
    });

    // Quem pode mexer numa sala: canal de voz que a pessoa vê, chamada de DM em que ela é uma das duas pontas,
    // ou grupo do qual ela faz parte. Devolve as permissões do canal (ou {} para DM/grupo) ou null.
    const roomAccess = (chId, userObj) => {
      if (typeof chId !== 'string' || !chId || chId.length > 200 || !userObj) return null;
      const dbCur = getDb();
      if (chId.startsWith('dm:')) return chId.slice(3).split('::').includes(userObj.id) ? {} : null;
      if (chId.startsWith('group:')) {
        const g = dbCur.dmGroups?.[chId.slice(6)];
        return Array.isArray(g?.memberIds) && g.memberIds.includes(userObj.id) ? {} : null;
      }
      const chObj = dbCur.channels.find((c) => c.id === chId);
      if (!chObj) return null;
      const perms = computeChannelPermissions(dbCur, userObj, chObj);
      return perms.viewChannels ? perms : null;
    };

    const canUseMediaInRoom = (targetCh, userObj) => {
      const acc = roomAccess(targetCh, userObj);
      if (!acc) return false;
      return targetCh.startsWith('dm:') || targetCh.startsWith('group:') ? true : Boolean(acc.useMediaQueue);
    };

    // Synchronized Voice Music Player (Audio-only: YouTube / Spotify / SoundCloud + Playlist Blocks!)
    socket.on('music:add', ({ channelId, track }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh || !track?.url) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      if (!canUseMediaInRoom(targetCh, actor)) return;
      const m = getOrCreateMusicState(targetCh);

      m.queue.push({
        queueId: uuidv4(),
        id: track.id || uuidv4(),
        mediaId: track.mediaId || track.id,
        title: String(track.title || 'Faixa de Áudio').trim().slice(0, 100),
        artist: String(track.artist || actor?.displayName || 'Desconhecido').trim().slice(0, 64),
        thumbnail: track.thumbnail || '',
        duration: Number(track.duration || 0),
        platform: track.platform || 'youtube',
        url: String(track.url).trim(),
        addedBy: actor?.displayName || 'Alguém',
      });
      if (m.currentIndex === -1) {
        m.currentIndex = 0;
        m.isPlaying = true;
        m.positionSec = 0;
        m.updatedAt = Date.now();
      }
      broadcastMusicState(targetCh, 'track', actor?.displayName || '');
      prefetchNextMusicTrack(targetCh);
    });

    socket.on('music:add-url', async ({ channelId, url }, cb) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh || !url) return cb?.({ error: 'Sala de voz ou link inválido.' });
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      if (!canUseMediaInRoom(targetCh, actor)) {
        return cb?.({ error: 'Seu cargo não tem permissão para adicionar músicas na fila.' });
      }
      try {
        const res = await resolveMusicUrl(url, DATA_DIR);
        const m = getOrCreateMusicState(targetCh);
        const wasEmpty = m.currentIndex === -1;

        if (res.isPlaylist && Array.isArray(res.tracks) && res.tracks.length > 0) {
          const blockId = `pl-${uuidv4().slice(0, 8)}`;
          const firstIdx = m.queue.length;
          for (const t of res.tracks) {
            m.queue.push({
              queueId: uuidv4(),
              id: t.id,
              mediaId: t.mediaId,
              title: String(t.title || 'Faixa').slice(0, 100),
              artist: String(t.artist || 'Artista').slice(0, 64),
              thumbnail: t.thumbnail || res.playlistThumbnail || '',
              duration: Number(t.duration || 0),
              platform: res.platform,
              url: t.url,
              playlistBlockId: blockId,
              playlistTitle: res.playlistTitle || 'Playlist',
              playlistThumbnail: res.playlistThumbnail || '',
              playlistPlatform: res.platform,
              addedBy: actor?.displayName || 'Alguém',
            });
          }
          if (wasEmpty) {
            m.currentIndex = firstIdx;
            m.isPlaying = true;
            m.positionSec = 0;
            m.updatedAt = Date.now();
          }
          broadcastMusicState(targetCh, 'track', actor?.displayName || '');
          prefetchNextMusicTrack(targetCh);
          cb?.({ ok: true, count: res.tracks.length, playlistTitle: res.playlistTitle });
        } else if (res.track) {
          const t = res.track;
          m.queue.push({
            queueId: uuidv4(),
            id: t.id,
            mediaId: t.mediaId,
            title: String(t.title || 'Faixa').slice(0, 100),
            artist: String(t.artist || 'Artista').slice(0, 64),
            thumbnail: t.thumbnail || '',
            duration: Number(t.duration || 0),
            platform: res.platform,
            url: t.url,
            addedBy: actor?.displayName || 'Alguém',
          });
          if (wasEmpty) {
            m.currentIndex = m.queue.length - 1;
            m.isPlaying = true;
            m.positionSec = 0;
            m.updatedAt = Date.now();
          }
          broadcastMusicState(targetCh, 'track', actor?.displayName || '');
          prefetchNextMusicTrack(targetCh);
          cb?.({ ok: true, count: 1, title: t.title });
        } else {
          cb?.({ error: 'Nenhuma música encontrada neste link.' });
        }
      } catch (err) {
        cb?.({ error: err?.message || 'Erro ao carregar link de música.' });
      }
    });

    socket.on('music:play', ({ channelId, index, positionSec }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      const m = getOrCreateMusicState(targetCh);
      if (m.queue.length === 0) return;

      let action = 'play';
      if (typeof index === 'number' && index >= 0 && index < m.queue.length) {
        m.currentIndex = index;
        m.positionSec = typeof positionSec === 'number' ? Math.max(0, positionSec) : 0;
        action = 'track';
      } else if (m.currentIndex < 0 || m.currentIndex >= m.queue.length) {
        m.currentIndex = 0;
        m.positionSec = 0;
        action = 'track';
      } else if (typeof positionSec === 'number') {
        m.positionSec = Math.max(0, positionSec);
      }
      m.isPlaying = true;
      m.updatedAt = Date.now();
      broadcastMusicState(targetCh, action, actor?.displayName || '');
      prefetchNextMusicTrack(targetCh);
    });

    socket.on('music:pause', ({ channelId, positionSec }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      const m = getOrCreateMusicState(targetCh);
      if (typeof positionSec === 'number') m.positionSec = Math.max(0, positionSec);
      else if (m.isPlaying) m.positionSec += Math.max(0, (Date.now() - m.updatedAt) / 1000);
      m.isPlaying = false;
      m.updatedAt = Date.now();
      broadcastMusicState(targetCh, 'pause', actor?.displayName || '');
    });

    socket.on('music:seek', ({ channelId, positionSec }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      const m = getOrCreateMusicState(targetCh);
      m.positionSec = Math.max(0, Number(positionSec) || 0);
      m.updatedAt = Date.now();
      broadcastMusicState(targetCh, 'seek', actor?.displayName || '');
    });

    socket.on('music:next', ({ channelId }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      const m = getOrCreateMusicState(targetCh);
      if (m.queue.length === 0) return;
      if (m.currentIndex + 1 < m.queue.length) {
        m.currentIndex += 1;
        m.positionSec = 0;
        m.isPlaying = true;
      } else if (m.loopMode === 'all') {
        m.currentIndex = 0;
        m.positionSec = 0;
        m.isPlaying = true;
      } else {
        m.isPlaying = false;
        m.positionSec = 0;
      }
      m.updatedAt = Date.now();
      broadcastMusicState(targetCh, 'track', actor?.displayName || '');
      prefetchNextMusicTrack(targetCh);
    });

    socket.on('music:prev', ({ channelId }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      const m = getOrCreateMusicState(targetCh);
      if (m.queue.length === 0) return;
      m.currentIndex = Math.max(0, m.currentIndex - 1);
      m.positionSec = 0;
      m.isPlaying = true;
      m.updatedAt = Date.now();
      broadcastMusicState(targetCh, 'track', actor?.displayName || '');
      prefetchNextMusicTrack(targetCh);
    });

    socket.on('music:track-ended', ({ channelId, queueId }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const m = getOrCreateMusicState(targetCh);
      const current = m.queue[m.currentIndex];
      if (!current || current.queueId !== queueId || !m.isPlaying) return;
      if (Date.now() - m.updatedAt < 1000) return;

      if (m.loopMode === 'one') {
        m.positionSec = 0;
        m.isPlaying = true;
      } else if (m.currentIndex + 1 < m.queue.length) {
        m.currentIndex += 1;
        m.positionSec = 0;
        m.isPlaying = true;
      } else if (m.loopMode === 'all' && m.queue.length > 0) {
        m.currentIndex = 0;
        m.positionSec = 0;
        m.isPlaying = true;
      } else {
        m.isPlaying = false;
        m.positionSec = 0;
      }
      m.updatedAt = Date.now();
      broadcastMusicState(targetCh, 'track');
      prefetchNextMusicTrack(targetCh);
    });

    socket.on('music:remove', ({ channelId, index }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const m = getOrCreateMusicState(targetCh);
      if (typeof index !== 'number' || index < 0 || index >= m.queue.length) return;
      m.queue.splice(index, 1);
      if (m.queue.length === 0) {
        m.currentIndex = -1;
        m.isPlaying = false;
        m.positionSec = 0;
      } else if (index < m.currentIndex) m.currentIndex -= 1;
      else if (index === m.currentIndex) {
        if (m.currentIndex >= m.queue.length) m.currentIndex = 0;
        m.positionSec = 0;
      }
      m.updatedAt = Date.now();
      broadcastMusicState(targetCh, 'track');
      prefetchNextMusicTrack(targetCh);
    });

    socket.on('music:remove-block', ({ channelId, playlistBlockId }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh || !playlistBlockId) return;
      const m = getOrCreateMusicState(targetCh);
      const currentQueueId = m.queue[m.currentIndex]?.queueId || null;
      const wasPlaying = m.isPlaying;
      m.queue = m.queue.filter((t) => t.playlistBlockId !== playlistBlockId);

      if (m.queue.length === 0) {
        m.currentIndex = -1;
        m.isPlaying = false;
        m.positionSec = 0;
      } else {
        const preservedIdx = currentQueueId ? m.queue.findIndex((t) => t.queueId === currentQueueId) : -1;
        if (preservedIdx !== -1) {
          m.currentIndex = preservedIdx;
        } else {
          m.currentIndex = Math.min(Math.max(0, m.currentIndex), m.queue.length - 1);
          m.positionSec = 0;
          m.isPlaying = wasPlaying;
        }
      }
      m.updatedAt = Date.now();
      broadcastMusicState(targetCh, 'track');
      prefetchNextMusicTrack(targetCh);
    });

    socket.on('music:clear', ({ channelId }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const m = getOrCreateMusicState(targetCh);
      m.queue = [];
      m.currentIndex = -1;
      m.isPlaying = false;
      m.positionSec = 0;
      m.updatedAt = Date.now();
      broadcastMusicState(targetCh, 'clear');
    });

    socket.on('music:loop', ({ channelId, loopMode }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const m = getOrCreateMusicState(targetCh);
      if (['none', 'one', 'all'].includes(loopMode)) {
        m.loopMode = loopMode;
        broadcastMusicState(targetCh, 'loop');
      }
    });

    // Synchronized Watch-Party Video Player (YouTube / Twitter X / Instagram / TikTok — Separate from Music!)
    socket.on('video:add-url', async ({ channelId, url }, cb) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh || !url) return cb?.({ error: 'Sala de voz ou link inválido.' });
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      if (!canUseMediaInRoom(targetCh, actor)) {
        return cb?.({ error: 'Seu cargo não tem permissão para colocar vídeos na fila.' });
      }
      try {
        const vid = await resolveVideoUrl(url, DATA_DIR);
        const v = getOrCreateVideoState(targetCh);
        const item = {
          queueId: uuidv4(),
          id: vid.id,
          mediaId: vid.mediaId,
          platform: vid.platform,
          youtubeId: vid.youtubeId || null,
          title: String(vid.title || 'Vídeo').slice(0, 120),
          author: String(vid.author || '').slice(0, 64),
          thumbnail: vid.thumbnail || '',
          duration: Number(vid.duration || 0),
          originalUrl: vid.originalUrl,
          streamPath: vid.streamPath,
          audioStreamPath: vid.audioStreamPath || null,
          addedBy: actor?.displayName || 'Alguém',
        };
        v.queue.push(item);
        if (v.currentIndex === -1) {
          v.currentIndex = 0;
          v.isPlaying = true;
          v.positionSec = 0;
          v.updatedAt = Date.now();
        }
        broadcastVideoState(targetCh, 'track', actor?.displayName || '');
        cb?.({ ok: true, item });
      } catch (err) {
        cb?.({ error: err?.message || 'Não foi possível carregar este vídeo.' });
      }
    });

    socket.on('video:play', ({ channelId, index, positionSec }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      const v = getOrCreateVideoState(targetCh);
      if (v.queue.length === 0) return;

      let action = 'play';
      if (typeof index === 'number' && index >= 0 && index < v.queue.length) {
        v.currentIndex = index;
        v.positionSec = typeof positionSec === 'number' ? Math.max(0, positionSec) : 0;
        action = 'track';
      } else if (v.currentIndex < 0 || v.currentIndex >= v.queue.length) {
        v.currentIndex = 0;
        v.positionSec = 0;
        action = 'track';
      } else if (typeof positionSec === 'number') {
        v.positionSec = Math.max(0, positionSec);
      }
      v.isPlaying = true;
      v.updatedAt = Date.now();
      broadcastVideoState(targetCh, action, actor?.displayName || '');
    });

    socket.on('video:pause', ({ channelId, positionSec }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      const v = getOrCreateVideoState(targetCh);
      if (typeof positionSec === 'number') v.positionSec = Math.max(0, positionSec);
      else if (v.isPlaying) v.positionSec += Math.max(0, (Date.now() - v.updatedAt) / 1000) * videoRate(v);
      v.isPlaying = false;
      v.updatedAt = Date.now();
      broadcastVideoState(targetCh, 'pause', actor?.displayName || '');
    });

    // velocidade vale para a sala toda (como "assistir junto"); legenda é individual (no cliente)
    socket.on('video:rate', ({ channelId, rate }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      if (!canUseMediaInRoom(targetCh, actor)) return;
      const r = Number(rate);
      if (!Number.isFinite(r) || r < 0.25 || r > 2) return;
      const v = getOrCreateVideoState(targetCh);
      if (v.isPlaying) v.positionSec += Math.max(0, (Date.now() - v.updatedAt) / 1000) * videoRate(v);
      v.rate = Math.round(r * 100) / 100;
      v.updatedAt = Date.now();
      broadcastVideoState(targetCh, 'rate', actor?.displayName || '');
    });

    socket.on('video:seek', ({ channelId, positionSec }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      const v = getOrCreateVideoState(targetCh);
      v.positionSec = Math.max(0, Number(positionSec) || 0);
      v.updatedAt = Date.now();
      broadcastVideoState(targetCh, 'seek', actor?.displayName || '');
    });

    socket.on('video:next', ({ channelId }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      const v = getOrCreateVideoState(targetCh);
      if (v.queue.length === 0) return;
      if (v.currentIndex + 1 < v.queue.length) {
        v.currentIndex += 1;
        v.positionSec = 0;
        v.isPlaying = true;
      } else {
        v.isPlaying = false;
        v.positionSec = 0;
      }
      v.updatedAt = Date.now();
      broadcastVideoState(targetCh, 'track', actor?.displayName || '');
    });

    socket.on('video:prev', ({ channelId }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      const v = getOrCreateVideoState(targetCh);
      if (v.queue.length === 0) return;
      v.currentIndex = Math.max(0, v.currentIndex - 1);
      v.positionSec = 0;
      v.isPlaying = true;
      v.updatedAt = Date.now();
      broadcastVideoState(targetCh, 'track', actor?.displayName || '');
    });

    socket.on('video:ended', ({ channelId, queueId, durationSec } = {}) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const v = getOrCreateVideoState(targetCh);
      const current = v.queue[v.currentIndex];
      if (!current || current.queueId !== queueId || !v.isPlaying) return;
      if (Date.now() - v.updatedAt < 1000) return;
      // Um único cliente não encerra o vídeo de todo mundo à toa (ex.: player dele travou em segundo plano e
      // avisou "terminou"): só vale quando o tempo da SALA chegou mesmo perto do fim.
      const reportedDur = Number(durationSec);
      if (!(Number(current.duration) > 0) && Number.isFinite(reportedDur) && reportedDur > 1 && reportedDur < 24 * 3600) {
        current.duration = Math.round(reportedDur);
      }
      const roomPos = v.positionSec + Math.max(0, (Date.now() - v.updatedAt) / 1000) * videoRate(v);
      const dur = Number(current.duration) || 0;
      if (dur > 0 ? roomPos < dur - 6 : roomPos < 5) return;

      if (v.currentIndex + 1 < v.queue.length) {
        v.currentIndex += 1;
        v.positionSec = 0;
        v.isPlaying = true;
      } else {
        v.isPlaying = false;
        v.positionSec = 0;
      }
      v.updatedAt = Date.now();
      broadcastVideoState(targetCh, 'track');
    });

    socket.on('video:remove', ({ channelId, index }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const v = getOrCreateVideoState(targetCh);
      if (typeof index !== 'number' || index < 0 || index >= v.queue.length) return;
      v.queue.splice(index, 1);
      if (v.queue.length === 0) {
        v.currentIndex = -1;
        v.isPlaying = false;
        v.positionSec = 0;
      } else if (index < v.currentIndex) v.currentIndex -= 1;
      else if (index === v.currentIndex) {
        if (v.currentIndex >= v.queue.length) v.currentIndex = 0;
        v.positionSec = 0;
      }
      v.updatedAt = Date.now();
      broadcastVideoState(targetCh, 'track');
    });

    socket.on('video:clear', ({ channelId }) => {
      const targetCh = channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return;
      const v = getOrCreateVideoState(targetCh);
      v.queue = [];
      v.currentIndex = -1;
      v.isPlaying = false;
      v.positionSec = 0;
      v.updatedAt = Date.now();
      broadcastVideoState(targetCh, 'clear');
    });

    // Collaborative Real-Time Whiteboard (Photoshop Brushes, Tablet Pressure, Pasted Images & Live Colored Cursors!)
    const canUseWb = (chId, userObj) => {
      const acc = roomAccess(chId, userObj);
      if (!acc) return false;
      return chId.startsWith('dm:') || chId.startsWith('group:') ? true : Boolean(acc.useWhiteboard);
    };

    // Música, vídeo, quadro e soundboard: antes, várias ações (pausar, pular, limpar a fila, entrar no quadro)
    // aceitavam qualquer sala, inclusive canais privados e chamadas de DM de outras pessoas.
    socket.use((packet, next) => {
      const ev = String(packet[0] || '');
      const kind = ev.startsWith('music:') ? 'media' : ev.startsWith('video:') ? 'media' : ev.startsWith('wb:') ? 'wb' : ev === 'soundboard:play' ? 'room' : null;
      if (!kind) return next();
      const payload = packet[1] && typeof packet[1] === 'object' ? packet[1] : {};
      const targetCh = payload.channelId || socketVoiceChannel.get(socket.id);
      if (!targetCh) return next(); // o próprio handler responde "sala inválida"
      const actor = getDb().users.find((u) => u.id === socket.data.userId);
      let ok;
      if (kind === 'media') ok = ev === 'music:track-ended' || ev === 'video:ended' ? Boolean(roomAccess(targetCh, actor)) : canUseMediaInRoom(targetCh, actor);
      else if (kind === 'wb') ok = ev === 'wb:join' || ev === 'wb:cursor' ? Boolean(roomAccess(targetCh, actor)) : canUseWb(targetCh, actor);
      else ok = Boolean(roomAccess(targetCh, actor));
      if (ok) return next();
      const ack = packet[packet.length - 1];
      if (typeof ack === 'function') {
        try {
          ack({ error: 'Sem permissão nesta sala.' });
        } catch {}
      }
    });

    // Quadro / estúdio de arte: regras únicas (server/wbRoom.cjs), também usadas pela call LAN
    wbRoom.attachWhiteboard(socket, {
      getState: (ch) => getOrCreateWhiteboardState(ch),
      resolveRoom: (ch) => {
        const target = (typeof ch === 'string' && ch) || socketVoiceChannel.get(socket.id);
        if (!target || typeof target !== 'string') return null;
        const actor = getDb().users.find((u) => u.id === socket.data.userId);
        return roomAccess(target, actor) ? target : null;
      },
      canDraw: (ch) => canUseWb(ch, getDb().users.find((u) => u.id === socket.data.userId)),
      author: () => {
        const actor = getDb().users.find((u) => u.id === socket.data.userId);
        return { id: actor?.id || '', name: actor?.displayName || '', color: actor?.avatarColor };
      },
      toRoom: (ch) => io.to(`voice:${ch}`),
      toOthers: (ch) => socket.to(`voice:${ch}`),
    });

    // Trello Real-Time Socket Sync
    socket.on('trello:get', ({ scopeKey }, cb) => {
      const currentDb = getDb();
      const actor = currentDb.users.find((u) => u.id === socket.data.userId);
      if (!actor || !canAccessTrelloScope(currentDb, actor, scopeKey)) {
        return cb?.({ error: 'Sem acesso a este quadro Trello.' });
      }
      cb?.({ ok: true, scopeKey, boards: currentDb.trelloBoards?.[scopeKey] || [] });
    });

    socket.on('trello:sync', ({ scopeKey, boards }, cb) => {
      const currentDb = getDb();
      const actor = currentDb.users.find((u) => u.id === socket.data.userId);
      if (!actor || !canAccessTrelloScope(currentDb, actor, scopeKey)) {
        return cb?.({ error: 'Sem acesso a este quadro Trello.' });
      }
      if (scopeKey === 'server' && !computeServerPermissions(currentDb, actor).useTrello) {
        return cb?.({ error: 'Sem permissão no cargo para editar o Trello.' });
      }
      if (!currentDb.trelloBoards) currentDb.trelloBoards = {};
      const nextBoards = Array.isArray(boards) ? boards.slice(0, 15) : [];
      currentDb.trelloBoards[scopeKey] = nextBoards;
      saveDb();
      emitTrelloUpdate(currentDb, scopeKey, nextBoards);
      cb?.({ ok: true, boards: nextBoards });
    });

    socket.on('disconnect', () => {
      rcPendingForget(socket.id);
      const prev = socketVoiceChannel.get(socket.id);
      const leaver = getDb().users.find((u) => u.id === socket.data.userId);
      leaveVoiceRoom(socket);
      if (prev && (prev.startsWith('dm:') || prev.startsWith('group:'))) {
        const roomMap = voiceRooms.get(prev);
        io.to(`voice:${prev}`).emit('voice:dm-participants', {
          channelId: prev,
          participants: roomMap ? Array.from(roomMap.values()) : [],
        });
      }
      const set = onlineUsers.get(socket.data.userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineUsers.delete(socket.data.userId);
          if (leaver) {
            appendAuditLog({
              type: 'member_leave',
              actor: leaver,
              targetId: leaver.id,
              targetName: leaver.displayName,
              details: 'Desconectou-se do servidor',
            });
          }
        }
      }
      broadcastUsers();
      advertiser?.broadcastNow();
    });
  });

  if (clientDist && fs.existsSync(clientDist)) {
    app.use(
      express.static(clientDist, {
        // arquivos com hash no nome nunca mudam: o navegador não precisa pedir de novo
        setHeaders: (res, filePath) => {
          if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      })
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
        return next();
      }
      // arquivo antigo da interface (host atualizado com a aba aberta): 404 de verdade, não o index.html,
      // para o cliente perceber e recarregar em vez de travar com tela branca
      if (req.path.startsWith('/assets/')) return res.status(404).end();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((err, _req, res, _next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Arquivo excede o limite de segurança (~1.85 GB) para manter o cache abaixo de 2 GB.' });
    }
    console.error('[Server Error]', err);
    res.status(500).json({ error: err?.message || 'Erro interno no servidor.' });
  });

  async function start(listenPort = PORT) {
    if (!sfuInitPromise) sfuInitPromise = sfu.init().catch((err) => console.warn('[SFU] init:', err?.message || err));
    await sfuInitPromise;
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address();
        activePort = typeof addr === 'object' && addr ? addr.port : listenPort;

        runStorageEnforce(0);
        cachePruneTimer = setInterval(() => runStorageEnforce(0), 5 * 60 * 1000);

        if (options.enableDiscovery !== false) {
          advertiser?.stop();
          advertiser = startLanAdvertiser(() => {
            const db = getDb();
            const addrs = getNetworkAddresses(activePort);
            const hostUser = db.users.find((u) => u.role === 'host');
            return {
              instanceId,
              serverName: db.server.name,
              hostName: hostUser?.displayName || os.hostname(),
              port: activePort,
              primaryIp: addrs[0]?.address || '127.0.0.1',
              hasPassword: Boolean(db.server.hasInvitePassword && db.server.invitePasswordHash),
              onlineCount: onlineUsers.size,
            };
          });
        }

        resolve({
          port: activePort,
          localUrl: `http://localhost:${activePort}`,
          addresses: getNetworkAddresses(activePort),
          hasPassword: Boolean(getDb().server.hasInvitePassword && getDb().server.invitePasswordHash),
        });
      };
      server.once('listening', onListening);
      if (HOST === '::') {
        // máquina sem IPv6: tenta de novo só em IPv4
        server.once('error', (err) => {
          if (err?.code === 'EAFNOSUPPORT' || err?.code === 'EADDRNOTAVAIL' || err?.code === 'EINVAL') {
            console.warn('[Waver] IPv6 indisponível nesta máquina; escutando só em IPv4.');
            server.once('error', onError);
            server.listen(listenPort, '0.0.0.0');
          } else {
            onError(err);
          }
        });
      } else {
        server.once('error', onError);
      }
      server.listen(listenPort, HOST);
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (cachePruneTimer) {
        clearInterval(cachePruneTimer);
        cachePruneTimer = null;
      }
      advertiser?.stop();
      advertiser = null;
      saveDbNow();
      sfu.close().catch(() => {});
      io.close(() => {
        server.close(() => resolve());
      });
    });
  }

  return {
    app,
    server,
    io,
    start,
    stop,
    setServerPassword,
    setServerMeta,
    getAddresses: () => getNetworkAddresses(activePort),
    getPort: () => activePort,
    getOwnerCode: () => OWNER_CODE,
    getDataDir: () => DATA_DIR,
    sfu,
  };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  // Modo servidor dedicado (Debian/Windows sem tela): node server/index.js [--port 3000] [--host ::] [--data /var/lib/pulsecord]
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    return eq ? eq.slice(name.length + 3) : undefined;
  };
  const instance = createPulseCordServer({
    port: arg('port'),
    host: arg('host'),
    dataDir: arg('data'),
    headless: true,
    enableDiscovery: process.env.PULSECORD_LAN_DISCOVERY === '1' || argv.includes('--lan-discovery'),
  });
  instance
    .start()
    .then(({ port, addresses }) => {
      console.log('\n=======================================================');
      console.log('  Waver Server iniciado (modo dedicado)');
      console.log('=======================================================');
      console.log(`  Local:        http://localhost:${port}`);
      for (const a of addresses) {
        console.log(`  ${a.name.padEnd(34)} ${a.url}`);
      }
      console.log(`  Dados:        ${instance.getDataDir()}`);
      console.log('-------------------------------------------------------');
      console.log(`  Código do dono: ${instance.getOwnerCode()}`);
      console.log('  (no app: "Sou o dono deste servidor" na tela de entrar;');
      console.log('   ele também fica salvo em owner-code.txt na pasta de dados)');
      console.log('=======================================================\n');
    })
    .catch((err) => {
      console.error('Erro ao iniciar servidor Waver:', err);
      process.exit(1);
    });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const force = setTimeout(() => process.exit(0), 8000);
    try {
      await instance.stop();
    } finally {
      clearTimeout(force);
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // um erro inesperado não deve derrubar o servidor 24 h: registra e segue (o systemd reinicia se cair)
  process.on('unhandledRejection', (err) => console.error('[Waver] Promessa rejeitada sem tratamento:', err));
}
