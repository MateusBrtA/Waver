import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ensureStarterSounds } from './starterSounds.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ALL_PERMISSION_KEYS = [
  'viewChannels',
  'viewPrivateChannels',
  'manageChannels',
  'manageRoles',
  'manageExpressions',
  'viewAuditLog',
  'manageServer',
  'createInvite',
  'changeNickname',
  'kickMembers',
  'banMembers',
  'sendMessages',
  'attachFiles',
  'embedLinks',
  'pinMessages',
  'manageMessages',
  'connectVoice',
  'speakVoice',
  'streamVideo',
  'useSoundboard',
  'useMediaQueue',
  'useWhiteboard',
  'useTrello',
  'muteMembers',
  'deafenMembers',
  'moveMembers',
  'administrator',
];

export const DEFAULT_EVERYONE_PERMISSIONS = {
  viewChannels: true,
  createInvite: true,
  changeNickname: true,
  sendMessages: true,
  attachFiles: true,
  embedLinks: true,
  pinMessages: true,
  connectVoice: true,
  speakVoice: true,
  streamVideo: true,
  useSoundboard: true,
  useMediaQueue: true,
  useWhiteboard: true,
  useTrello: true,
  viewPrivateChannels: false,
  manageChannels: false,
  manageRoles: false,
  manageExpressions: false,
  viewAuditLog: false,
  manageServer: false,
  kickMembers: false,
  banMembers: false,
  manageMessages: false,
  muteMembers: false,
  deafenMembers: false,
  moveMembers: false,
  administrator: false,
};

export const HOST_ALL_PERMISSIONS = Object.fromEntries(ALL_PERMISSION_KEYS.map((k) => [k, true]));

export const MOD_PERMISSIONS = {
  ...DEFAULT_EVERYONE_PERMISSIONS,
  viewPrivateChannels: true,
  manageChannels: true,
  manageExpressions: true,
  viewAuditLog: true,
  kickMembers: true,
  banMembers: true,
  manageMessages: true,
  muteMembers: true,
  deafenMembers: true,
  moveMembers: true,
};

export function normalizeRolePermissions(rawPerms, fallbackBase = {}) {
  const out = {};
  for (const key of ALL_PERMISSION_KEYS) {
    if (rawPerms && typeof rawPerms[key] === 'boolean') {
      out[key] = rawPerms[key];
    } else if (typeof fallbackBase[key] === 'boolean') {
      out[key] = fallbackBase[key];
    } else {
      out[key] = false;
    }
  }
  return out;
}

const DEFAULT_ROLES = [
  {
    id: 'role-host',
    name: 'Host',
    color: '#f0b232',
    isSystem: true,
    hoist: true,
    position: 100,
    permissions: { ...HOST_ALL_PERMISSIONS },
  },
  {
    id: 'role-mod',
    name: 'Moderador',
    color: '#23a55a',
    isSystem: false,
    hoist: true,
    position: 50,
    permissions: { ...MOD_PERMISSIONS },
  },
  {
    id: 'role-vip',
    name: 'PulseNitro',
    color: '#eb459e',
    isSystem: false,
    hoist: false,
    position: 20,
    permissions: normalizeRolePermissions({}),
  },
  {
    id: 'role-gamer',
    name: 'Gamer',
    color: '#5865f2',
    isSystem: false,
    hoist: false,
    position: 10,
    permissions: normalizeRolePermissions({}),
  },
  {
    id: 'role-everyone',
    name: '@everyone',
    color: '#949ba4',
    isSystem: true,
    isEveryone: true,
    hoist: false,
    position: 0,
    permissions: { ...DEFAULT_EVERYONE_PERMISSIONS },
  },
];

const DEFAULT_CATEGORIES = [
  { id: 'cat-text', name: 'Canais de Texto', position: 0, isPrivate: false, overwrites: [] },
  { id: 'cat-voice', name: 'Canais de Voz', position: 1, isPrivate: false, overwrites: [] },
];

const DEFAULT_CHANNELS = [
  {
    id: 'ch-geral',
    name: 'geral',
    type: 'text',
    categoryId: 'cat-text',
    position: 0,
    topic: 'Conversa geral da galera — mande mensagens, imagens, GIFs e arquivos até 2 GB!',
    slowModeSec: 0,
    visibility: 'default',
    isPrivate: false,
    overwrites: [],
    createdAt: Date.now(),
    createdBy: 'Sistema',
  },
  {
    id: 'ch-midia',
    name: 'midia-e-gifs',
    type: 'text',
    categoryId: 'cat-text',
    position: 1,
    topic: 'Prints, memes, imagens e GIFs favoritos',
    slowModeSec: 0,
    visibility: 'default',
    isPrivate: false,
    overwrites: [],
    createdAt: Date.now() + 1,
    createdBy: 'Sistema',
  },
  {
    id: 'ch-jogos',
    name: 'jogos',
    type: 'text',
    categoryId: 'cat-text',
    position: 2,
    topic: 'Combine partidas, transmissões em 1080p60 e modo controle remoto',
    slowModeSec: 0,
    visibility: 'default',
    isPrivate: false,
    overwrites: [],
    createdAt: Date.now() + 2,
    createdBy: 'Sistema',
  },
  {
    id: 'vc-geral',
    name: 'Sala Geral',
    type: 'voice',
    categoryId: 'cat-voice',
    position: 0,
    topic: 'Voz, câmera, tela em 1080p60, controle remoto, whiteboard e soundboard',
    isPrivate: false,
    bitrateKbps: 128,
    userLimit: 0,
    overwrites: [],
    createdAt: Date.now() + 3,
    createdBy: 'Sistema',
  },
  {
    id: 'vc-jogatina',
    name: 'Jogatina 1080p',
    type: 'voice',
    categoryId: 'cat-voice',
    position: 1,
    topic: 'Transmissão de jogos com qualidade automática adaptativa',
    isPrivate: false,
    bitrateKbps: 192,
    userLimit: 0,
    overwrites: [],
    createdAt: Date.now() + 4,
    createdBy: 'Sistema',
  },
  {
    id: 'vc-musica',
    name: 'Sala de Música',
    type: 'voice',
    categoryId: 'cat-voice',
    position: 2,
    topic: 'Ouça músicas e sons juntos na fila sincronizada',
    isPrivate: false,
    bitrateKbps: 256,
    userLimit: 0,
    overwrites: [],
    createdAt: Date.now() + 5,
    createdBy: 'Sistema',
  },
];

function createDefaultTrelloBoard(scopeKey, title = 'Projetos do Servidor') {
  return {
    id: `board-${scopeKey.replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'srv'}-1`,
    scopeKey,
    name: title,
    background: 'linear-gradient(135deg, #1e293b 0%, #312e81 55%, #0f172a 100%)',
    labels: [
      { id: 'lbl-urgente', name: 'Urgente', color: '#ef4444' },
      { id: 'lbl-dev', name: 'Dev / Código', color: '#3b82f6' },
      { id: 'lbl-arte', name: 'Design / 3D', color: '#a855f7' },
      { id: 'lbl-ok', name: 'Pronto', color: '#22c55e' },
    ],
    lists: [
      {
        id: 'list-todo',
        title: 'A Fazer',
        cards: [
          {
            id: 'card-welcome',
            title: 'Organize as tarefas do servidor aqui!',
            description: 'Arraste cartões entre colunas, adicione checklists, prazos e etiquetas coloridas.',
            labelIds: ['lbl-dev'],
            dueDate: null,
            completed: false,
            checklist: [
              { id: 'chk-1', text: 'Criar primeiro projeto ou cartão', done: true },
              { id: 'chk-2', text: 'Convidar amigos na call ou no chat', done: false },
            ],
            memberIds: [],
            createdBy: 'Sistema',
            createdAt: Date.now(),
          },
        ],
      },
      { id: 'list-doing', title: 'Em Progresso', cards: [] },
      { id: 'list-done', title: 'Concluído', cards: [] },
    ],
    updatedAt: Date.now(),
    createdBy: 'Sistema',
  };
}

let paths = null;
let vaultKey = null;
let db = null;
let saveTimer = null;

export function getDataPaths() {
  if (!paths) initDataPaths();
  return paths;
}

export function initDataPaths(customDataDir) {
  const dataDir = customDataDir || process.env.PULSECORD_DATA_DIR || path.join(__dirname, 'data');
  const uploadsDir = path.join(dataDir, 'uploads');
  const imagesDir = path.join(uploadsDir, 'images');
  const transfersDir = path.join(uploadsDir, 'transfers');
  const soundsDir = path.join(uploadsDir, 'sounds');
  const musicDir = path.join(uploadsDir, 'music');
  const avatarsDir = path.join(uploadsDir, 'avatars');
  const modelsCacheDir = path.join(uploadsDir, 'models');
  const updatesDir = path.join(dataDir, 'updates');
  const dbFile = path.join(dataDir, 'db.json');
  const messagesVaultFile = path.join(dataDir, 'messages.vault');
  const vaultKeyFile = path.join(dataDir, '.vault.key');

  for (const dir of [
    dataDir,
    uploadsDir,
    imagesDir,
    transfersDir,
    soundsDir,
    musicDir,
    avatarsDir,
    modelsCacheDir,
    updatesDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  paths = {
    DATA_DIR: dataDir,
    UPLOADS_DIR: uploadsDir,
    IMAGES_DIR: imagesDir,
    TRANSFERS_DIR: transfersDir,
    SOUNDS_DIR: soundsDir,
    MUSIC_DIR: musicDir,
    AVATARS_DIR: avatarsDir,
    MODELS_CACHE_DIR: modelsCacheDir,
    UPDATES_DIR: updatesDir,
    DB_FILE: dbFile,
    MESSAGES_VAULT_FILE: messagesVaultFile,
    VAULT_KEY_FILE: vaultKeyFile,
  };

  // Load or generate 256-bit AES-GCM vault key for compressed + encrypted message storage
  if (fs.existsSync(vaultKeyFile)) {
    const rawKey = fs.readFileSync(vaultKeyFile);
    vaultKey = rawKey.length === 32 ? rawKey : crypto.createHash('sha256').update(rawKey).digest();
  } else {
    vaultKey = crypto.randomBytes(32);
    fs.writeFileSync(vaultKeyFile, vaultKey);
  }

  return paths;
}

// AES-256-GCM + Gzip encrypted message vault (80-90% smaller & protected at rest!)
function encryptVaultBuffer(compressed) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: [4B magic "PCV1"][12B iv][16B authTag][ciphertext]
  return Buffer.concat([Buffer.from('PCV1', 'ascii'), iv, tag, encrypted]);
}

function writeEncryptedVault(filePath, jsonStr) {
  const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'), { level: 6 });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, encryptVaultBuffer(compressed));
  fs.renameSync(tmp, filePath);
}

function readEncryptedVault(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath);
  if (raw.length < 32 || raw.subarray(0, 4).toString('ascii') !== 'PCV1') return null;
  const iv = raw.subarray(4, 16);
  const tag = raw.subarray(16, 32);
  const ciphertext = raw.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const jsonStr = zlib.gunzipSync(compressed).toString('utf8');
  return JSON.parse(jsonStr);
}

function createInitialDb(soundsDir) {
  const starterSounds = ensureStarterSounds(soundsDir);
  return {
    server: {
      name: 'PulseCord da Galera',
      description: 'Servidor privado estilo Discord com 1080p120, Parsec, Whiteboard, Trello e chamadas em grupo',
      iconColor: '#5865F2',
      iconUrl: null,
      bannerColor: '#5865F2',
      bannerUrl: null,
      tags: [],
      createdAt: Date.now(),
      invitePasswordHash: null,
      hasInvitePassword: false,
      tenorApiKey: '',
      giphyApiKey: '',
      allowMembersCreateChannels: true,
    },
    roles: DEFAULT_ROLES.map((r) => ({ ...r, permissions: { ...r.permissions } })),
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, overwrites: [] })),
    bans: [],
    auditLogs: [],
    users: [],
    sessions: {},
    channels: DEFAULT_CHANNELS.map((c) => ({ ...c })),
    messages: {
      'ch-geral': [
        {
          id: 'msg-welcome',
          channelId: 'ch-geral',
          authorId: 'system',
          authorName: 'PulseCord',
          authorAvatar: null,
          authorColor: '#5865F2',
          content:
            'Bem-vindo ao PulseCord 4.0! 🎉\n• Configure cargos, permissões granulares, canais privados, registro de auditoria, Whiteboard colaborativa com suporte a mesa digitalizadora, Quadros Trello e chamadas em grupo!\n• Histórico salvo com compressão e criptografia AES-256-GCM!',
          attachments: [],
          gifUrl: null,
          replyTo: null,
          createdAt: Date.now(),
        },
      ],
    },
    directMessages: {}, // pairKey (sorted "idA::idB") -> Message[]
    dmGroups: {}, // groupId -> { id, name, iconUrl, ownerId, memberIds, createdAt }
    groupMessages: {}, // groupId -> Message[]
    trelloBoards: {
      server: [createDefaultTrelloBoard('server', 'Projetos do Servidor')],
    },
    threadMessages: {},
    events: [],
    transfers: {}, // transferId -> { id, filename, originalName, mimeType, size, oneTime, downloadedCount, burned, expiredByCache, uploadedBy, createdAt }
    sounds: starterSounds,
    savedGifs: [],
    musicLibrary: [],
  };
}

function migrateRolesList(rawRoles) {
  const input = Array.isArray(rawRoles) && rawRoles.length > 0 ? rawRoles : [];
  const out = input.map((r, idx) => {
    const fallback =
      r.id === 'role-host'
        ? HOST_ALL_PERMISSIONS
        : r.id === 'role-everyone'
        ? DEFAULT_EVERYONE_PERMISSIONS
        : r.id === 'role-mod'
        ? MOD_PERMISSIONS
        : {};
    return {
      ...r,
      isEveryone: Boolean(r.isEveryone || r.id === 'role-everyone'),
      hoist: Boolean(r.hoist || r.id === 'role-host' || r.id === 'role-mod'),
      position: typeof r.position === 'number' ? r.position : r.id === 'role-host' ? 100 : Math.max(1, 30 - idx),
      permissions: normalizeRolePermissions(r.permissions, fallback),
    };
  });
  if (!out.some((r) => r.id === 'role-everyone')) {
    out.push({
      id: 'role-everyone',
      name: '@everyone',
      color: '#949ba4',
      isSystem: true,
      isEveryone: true,
      hoist: false,
      position: 0,
      permissions: { ...DEFAULT_EVERYONE_PERMISSIONS },
    });
  }
  if (!out.some((r) => r.id === 'role-host')) {
    out.unshift({
      id: 'role-host',
      name: 'Host',
      color: '#f0b232',
      isSystem: true,
      hoist: true,
      position: 100,
      permissions: { ...HOST_ALL_PERMISSIONS },
    });
  }
  return out;
}

export function loadDb(customDataDir) {
  const p = initDataPaths(customDataDir);
  const starterSounds = ensureStarterSounds(p.SOUNDS_DIR);
  const base = createInitialDb(p.SOUNDS_DIR);

  if (fs.existsSync(p.DB_FILE)) {
    try {
      const raw = fs.readFileSync(p.DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);

      let vaultData = null;
      try {
        vaultData = readEncryptedVault(p.MESSAGES_VAULT_FILE);
      } catch (err) {
        console.warn('[DB] Falha ao ler messages.vault, usando fallback:', err.message);
      }

      const rawChannels = Array.isArray(parsed.channels) && parsed.channels.length > 0 ? parsed.channels : base.channels;
      const migratedChannels = rawChannels.map((ch, idx) => ({
        ...ch,
        categoryId: ch.categoryId !== undefined ? ch.categoryId : ch.type === 'voice' ? 'cat-voice' : 'cat-text',
        position: typeof ch.position === 'number' ? ch.position : idx,
        slowModeSec: Number(ch.slowModeSec || 0),
        visibility: ch.visibility || 'default',
        isPrivate: Boolean(ch.isPrivate),
        bitrateKbps: Number(ch.bitrateKbps || 128),
        isStage: Boolean(ch.isStage),
        userLimit: Number(ch.userLimit || 0),
        overwrites: Array.isArray(ch.overwrites) ? ch.overwrites : [],
      }));

      db = {
        ...base,
        ...parsed,
        server: { ...base.server, ...(parsed.server || {}) },
        roles: migrateRolesList(parsed.roles),
        categories: Array.isArray(parsed.categories) && parsed.categories.length > 0 ? parsed.categories : base.categories,
        bans: Array.isArray(parsed.bans) ? parsed.bans : [],
        auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions: parsed.sessions || {},
        channels: migratedChannels,
        messages: vaultData?.messages || parsed.messages || base.messages,
        directMessages: vaultData?.directMessages || parsed.directMessages || {},
        groupMessages: vaultData?.groupMessages || parsed.groupMessages || {},
        // respostas em threads (ficam no cofre criptografado junto com as mensagens)
        threadMessages: vaultData?.threadMessages || parsed.threadMessages || {},
        events: Array.isArray(parsed.events) ? parsed.events : [],
        dmGroups: parsed.dmGroups || {},
        trelloBoards: parsed.trelloBoards && parsed.trelloBoards.server ? parsed.trelloBoards : base.trelloBoards,
        transfers: parsed.transfers || {},
        sounds: Array.isArray(parsed.sounds) ? parsed.sounds : starterSounds,
        savedGifs: Array.isArray(parsed.savedGifs) ? parsed.savedGifs : [],
        musicLibrary: Array.isArray(parsed.musicLibrary) ? parsed.musicLibrary : [],
      };
      // Migrate plain messages into encrypted vault on first load
      if (!vaultData) {
        saveDbNow();
      }
      return db;
    } catch (err) {
      console.error('[DB] Falha ao ler db.json, criando backup e reinicializando:', err);
      fs.copyFileSync(p.DB_FILE, `${p.DB_FILE}.bak-${Date.now()}`);
    }
  }

  db = base;
  saveDbNow();
  return db;
}

export function getDb() {
  if (!db) return loadDb();
  return db;
}

// Assinatura do último cofre gravado: mudanças de presença, perfil, whiteboard etc. não
// recomprimem nem recriptografam todas as mensagens de novo.
let lastVaultSig = '';
let saveGen = 0;
let asyncSaving = false;
let asyncPending = false;

function snapshotForSave() {
  const vaultJson = JSON.stringify({
    messages: db.messages || {},
    directMessages: db.directMessages || {},
    groupMessages: db.groupMessages || {},
    threadMessages: db.threadMessages || {},
  });
  const vaultSig = crypto.createHash('sha1').update(vaultJson).digest('hex');
  const { messages: _m, directMessages: _dm, groupMessages: _gm, threadMessages: _tm, ...metaOnly } = db;
  // JSON compacto: sem indentação o arquivo fica menor e é gerado mais rápido
  return { vaultJson, vaultSig, metaJson: JSON.stringify(metaOnly) };
}

export function saveDbNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!db || !paths) return;
  saveGen += 1; // invalida um salvamento assíncrono que ainda esteja em andamento
  const snap = snapshotForSave();

  // 1) Write compressed + AES-256-GCM encrypted message vault (só se mudou)
  if (snap.vaultSig !== lastVaultSig || !fs.existsSync(paths.MESSAGES_VAULT_FILE)) {
    writeEncryptedVault(paths.MESSAGES_VAULT_FILE, snap.vaultJson);
    lastVaultSig = snap.vaultSig;
  }

  // 2) Write lean metadata JSON (without duplicated raw messages!)
  const tmpFile = `${paths.DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, snap.metaJson, 'utf8');
  fs.renameSync(tmpFile, paths.DB_FILE);
}

const gzipAsync = (buf) =>
  new Promise((resolve, reject) => zlib.gzip(buf, { level: 6 }, (err, out) => (err ? reject(err) : resolve(out))));

async function saveDbAsync() {
  if (!db || !paths) return;
  const gen = saveGen;
  const snap = snapshotForSave();
  // gzip roda no pool de threads do Node e a escrita é assíncrona: o host não trava durante o salvamento
  let vaultBuf = null;
  if (snap.vaultSig !== lastVaultSig) vaultBuf = encryptVaultBuffer(await gzipAsync(Buffer.from(snap.vaultJson, 'utf8')));
  if (gen !== saveGen) return; // um salvamento síncrono mais novo já gravou
  if (vaultBuf) {
    const tmp = `${paths.MESSAGES_VAULT_FILE}.atmp`;
    await fs.promises.writeFile(tmp, vaultBuf);
    if (gen !== saveGen) return;
    await fs.promises.rename(tmp, paths.MESSAGES_VAULT_FILE);
    lastVaultSig = snap.vaultSig;
  }
  const tmpFile = `${paths.DB_FILE}.atmp`;
  await fs.promises.writeFile(tmpFile, snap.metaJson, 'utf8');
  if (gen !== saveGen) return;
  await fs.promises.rename(tmpFile, paths.DB_FILE);
}

export function saveDb() {
  // agrupa várias mudanças seguidas num só salvamento, sem adiar para sempre em chat movimentado
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (asyncSaving) {
      asyncPending = true;
      return;
    }
    asyncSaving = true;
    try {
      await saveDbAsync();
    } catch (err) {
      console.error('[DB] Erro ao salvar db:', err);
    } finally {
      asyncSaving = false;
      if (asyncPending) {
        asyncPending = false;
        saveDb();
      }
    }
  }, 400);
}
