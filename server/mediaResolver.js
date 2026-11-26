import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// In-memory LRU registries (bounded so RAM never leaks)
const mediaRegistry = new Map(); // id -> MediaEntry
const unfurlCache = new Map(); // url -> { data, ts }
const searchStreamCache = new Map(); // normalized query -> { streamUrl, httpHeaders, mimeType, duration, thumbnail, resolvedAt }
let ytDlpEnsurePromise = null;
let cachedYtDlpPath = null;
let ytDataDir = null;

/** cookies.txt do YouTube colado pelo dono do servidor (Configurações do servidor → Mídia). */
export function getYouTubeCookiesPath(dataDir = ytDataDir) {
  return dataDir ? path.join(dataDir, 'youtube-cookies.txt') : null;
}

export function hasYouTubeCookies(dataDir = ytDataDir) {
  const p = getYouTubeCookiesPath(dataDir);
  try {
    return Boolean(p && fs.existsSync(p) && fs.statSync(p).size > 20);
  } catch {
    return false;
  }
}

export function setYouTubeCookies(dataDir, text) {
  const p = getYouTubeCookiesPath(dataDir);
  if (!p) return false;
  const clean = String(text || '').trim();
  if (!clean) {
    try {
      fs.unlinkSync(p);
    } catch {}
    return false;
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // formato Netscape exigido pelo yt-dlp
  const body = clean.startsWith('# Netscape') || clean.startsWith('# HTTP Cookie File') ? clean : `# Netscape HTTP Cookie File\n${clean}`;
  fs.writeFileSync(p, body + '\n', 'utf8');
  return true;
}

const BOT_CHECK_RE = /not a bot|sign in to confirm|confirm you.?re not|login required|HTTP Error 429/i;
export function isYouTubeBotBlock(err) {
  return BOT_CHECK_RE.test(String(err?.message || err || ''));
}

function setRegistryEntry(entry) {
  if (mediaRegistry.size >= 400) {
    const oldestKey = mediaRegistry.keys().next().value;
    if (oldestKey) mediaRegistry.delete(oldestKey);
  }
  mediaRegistry.set(entry.id, entry);
  return entry;
}

export function getMediaRegistryEntry(mediaId) {
  return mediaRegistry.get(mediaId) || null;
}

function findExistingYtDlp(dataDir) {
  if (cachedYtDlpPath && fs.existsSync(cachedYtDlpPath)) return cachedYtDlpPath;

  const candidates = [];
  if (dataDir) candidates.push(path.join(dataDir, 'bin', 'yt-dlp.exe'));
  if (process.platform === 'win32') {
    const pathDirs = (process.env.PATH || '').split(';').filter(Boolean);
    for (const d of pathDirs) candidates.push(path.join(d, 'yt-dlp.exe'));
    const appData = process.env.APPDATA || '';
    if (appData) {
      const pyRoot = path.join(appData, 'Python');
      if (fs.existsSync(pyRoot)) {
        try {
          for (const sub of fs.readdirSync(pyRoot)) {
            candidates.push(path.join(pyRoot, sub, 'Scripts', 'yt-dlp.exe'));
          }
        } catch {}
      }
    }
    const localAppData = process.env.LOCALAPPDATA || '';
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'));
    }
  } else {
    for (const d of (process.env.PATH || '').split(':').filter(Boolean)) {
      candidates.push(path.join(d, 'yt-dlp'));
    }
  }

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) {
        cachedYtDlpPath = c;
        return c;
      }
    } catch {}
  }
  return null;
}

let lastYtDlpUpdateCheck = 0;
/**
 * Extratores do YouTube/SoundCloud quebram com frequência. Se o yt-dlp baixado pelo app
 * tiver mais de 3 dias, roda "yt-dlp -U" em segundo plano (sem bloquear a música atual).
 */
function maybeSelfUpdateYtDlp(binPath, dataDir) {
  try {
    if (!binPath || !dataDir) return;
    if (!binPath.startsWith(path.join(dataDir, 'bin'))) return; // só atualiza a cópia gerenciada pelo app
    const now = Date.now();
    if (now - lastYtDlpUpdateCheck < 6 * 60 * 60 * 1000) return;
    lastYtDlpUpdateCheck = now;
    const ageMs = now - fs.statSync(binPath).mtimeMs;
    if (ageMs < 3 * 24 * 60 * 60 * 1000) return;
    execFile(binPath, ['-U'], { windowsHide: true, timeout: 90000 }, () => {
      try {
        const t = new Date();
        fs.utimesSync(binPath, t, t);
      } catch {}
    });
  } catch {}
}

/** Dados públicos do vídeo (título/canal/miniatura) sem yt-dlp: funciona mesmo com o bloqueio anti-robô. */
async function fetchYouTubeOEmbed(videoId) {
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  try {
    const resp = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function ensureYtDlp(dataDir) {
  if (dataDir) ytDataDir = dataDir;
  const existing = findExistingYtDlp(dataDir);
  if (existing) {
    maybeSelfUpdateYtDlp(existing, dataDir);
    return existing;
  }

  if (!ytDlpEnsurePromise) {
    ytDlpEnsurePromise = (async () => {
      try {
        const targetDir = path.join(dataDir || os.tmpdir(), 'bin');
        fs.mkdirSync(targetDir, { recursive: true });
        const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
        const outPath = path.join(targetDir, binName);
        if (fs.existsSync(outPath)) {
          cachedYtDlpPath = outPath;
          return outPath;
        }
        const dlUrl =
          process.platform === 'win32'
            ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
            : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

        const resp = await fetch(dlUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        const tmp = `${outPath}.tmp`;
        fs.writeFileSync(tmp, buf);
        if (process.platform !== 'win32') fs.chmodSync(tmp, 0o755);
        fs.renameSync(tmp, outPath);
        cachedYtDlpPath = outPath;
        return outPath;
      } finally {
        ytDlpEnsurePromise = null;
      }
    })();
  }
  return ytDlpEnsurePromise;
}

function withoutExtractorArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--extractor-args' && String(args[i + 1] || '').startsWith('youtube:')) {
      i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

/**
 * Roda o yt-dlp. Usa o cookies.txt do servidor quando existir e, se o YouTube responder
 * "confirme que você não é um robô", tenta de novo com outros clientes do player.
 */
async function runYtDlpJson(binPath, args, timeoutMs = 28000) {
  const cookies = getYouTubeCookiesPath();
  const auth = cookies && hasYouTubeCookies() && !args.includes('--cookies') ? ['--cookies', cookies] : [];
  try {
    return await runYtDlpJsonOnce(binPath, [...auth, ...args], timeoutMs);
  } catch (err) {
    if (!isYouTubeBotBlock(err)) throw err;
    const retryArgs = ['--extractor-args', 'youtube:player_client=tv_embedded,web_embedded,mweb', ...withoutExtractorArgs(args)];
    try {
      return await runYtDlpJsonOnce(binPath, [...auth, ...retryArgs], timeoutMs);
    } catch (err2) {
      if (isYouTubeBotBlock(err2)) {
        const e = new Error(
          auth.length
            ? 'O YouTube bloqueou o download mesmo com os cookies salvos. Atualize o cookies.txt nas configurações do servidor.'
            : 'O YouTube pediu login para baixar este link (proteção anti-robô). O dono do servidor pode colar um cookies.txt em Configurações do servidor → Mídia do YouTube.'
        );
        e.botBlocked = true;
        throw e;
      }
      throw err2;
    }
  }
}

// Cada yt-dlp é um processo Python pesado: no máximo 2 ao mesmo tempo no host (uma playlist colada
// não abre 30 de uma vez) e pedidos idênticos em andamento compartilham o mesmo resultado.
const YTDLP_MAX_CONCURRENT = 2;
let ytDlpRunning = 0;
const ytDlpQueue = [];
const ytDlpInFlight = new Map();

function withYtDlpSlot(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      ytDlpRunning += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          ytDlpRunning -= 1;
          const next = ytDlpQueue.shift();
          if (next) next();
        });
    };
    if (ytDlpRunning < YTDLP_MAX_CONCURRENT) run();
    else ytDlpQueue.push(run);
  });
}

function runYtDlpJsonOnce(binPath, args, timeoutMs = 28000) {
  const key = JSON.stringify([binPath, args]);
  const existing = ytDlpInFlight.get(key);
  if (existing) return existing;
  const p = withYtDlpSlot(() => runYtDlpJsonProcess(binPath, args, timeoutMs)).finally(() => ytDlpInFlight.delete(key));
  ytDlpInFlight.set(key, p);
  return p;
}

function runYtDlpJsonProcess(binPath, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      binPath,
      ['--no-warnings', ...args],
      { maxBuffer: 25 * 1024 * 1024, timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message || 'Erro ao executar yt-dlp').toString().trim();
          return reject(new Error(msg.split('\n')[0] || 'Falha ao extrair mídia do link.'));
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('Resposta inválida do extrator de mídia.'));
        }
      }
    );
  });
}

export function detectMediaPlatform(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const h = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
    if (h === 'youtube.com' || h === 'youtu.be' || h === 'music.youtube.com') return 'youtube';
    if (h === 'twitter.com' || h === 'x.com' || h === 'fxtwitter.com' || h === 'vxtwitter.com') return 'twitter';
    if (h === 'instagram.com' || h === 'instagr.am') return 'instagram';
    if (h === 'tiktok.com' || h === 'vm.tiktok.com' || h === 'vt.tiktok.com') return 'tiktok';
    if (h === 'open.spotify.com' || h === 'spotify.link') return 'spotify';
    if (h === 'soundcloud.com' || h === 'on.soundcloud.com') return 'soundcloud';
    return 'unknown';
  } catch {
    return 'invalid';
  }
}

export function extractYouTubeId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const parts = u.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1]) return parts[1];
    return null;
  } catch {
    return null;
  }
}

export function getPlatformMeta(platform) {
  switch (platform) {
    case 'youtube':
      return { name: 'YouTube', color: '#ff0000' };
    case 'twitter':
      return { name: 'X / Twitter', color: '#1d9bf0' };
    case 'instagram':
      return { name: 'Instagram', color: '#e1306c' };
    case 'tiktok':
      return { name: 'TikTok', color: '#00f2ea' };
    case 'spotify':
      return { name: 'Spotify', color: '#1db954' };
    case 'soundcloud':
      return { name: 'SoundCloud', color: '#ff5500' };
    default:
      return { name: 'Mídia Web', color: '#5865f2' };
  }
}

function makeMediaId() {
  return crypto.randomBytes(12).toString('hex');
}

function pickBestThumb(info) {
  if (info?.thumbnail) return info.thumbnail;
  if (Array.isArray(info?.thumbnails) && info.thumbnails.length > 0) {
    return info.thumbnails[info.thumbnails.length - 1]?.url || '';
  }
  return '';
}

function isYouTubePlaylistUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const listId = u.searchParams.get('list');
    if (!listId) return false;
    return u.pathname.includes('/playlist') || !u.searchParams.get('v') || /^(PL|OL|UU|LL)/.test(listId);
  } catch {
    return false;
  }
}

async function resolveSpotifyEntity(rawUrl) {
  // Handle shortlinks by following redirects
  let cleanUrl = rawUrl;
  if (rawUrl.includes('spotify.link')) {
    try {
      const r = await fetch(rawUrl, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA } });
      if (r.url) cleanUrl = r.url;
    } catch {}
  }

  const m = cleanUrl.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|playlist|album)\/([a-zA-Z0-9]+)/i);
  if (!m) throw new Error('Link do Spotify inválido. Use link de música, playlist ou álbum.');
  const kind = m[1].toLowerCase();
  const spotifyId = m[2];
  const embedUrl = `https://open.spotify.com/embed/${kind}/${spotifyId}`;

  const resp = await fetch(embedUrl, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Spotify respondeu HTTP ${resp.status}`);
  const html = await resp.text();

  let entity = null;
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const parsed = JSON.parse(nextDataMatch[1]);
      entity = parsed?.props?.pageProps?.state?.data?.entity || findSpotifyEntityDeep(parsed, kind) || null;
    } catch {}
  }
  if (!entity) {
    // Spotify já mudou o formato do embed: procura qualquer JSON embutido com a entidade
    const scripts = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const sc of scripts) {
      try {
        const body = sc.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
        const found = findSpotifyEntityDeep(JSON.parse(body), kind);
        if (found) {
          entity = found;
          break;
        }
      } catch {}
    }
  }

  if (entity) {
    const cover =
      entity.coverArt?.sources?.[0]?.url ||
      entity.visualIdentity?.image?.[0]?.url ||
      '';

    if (kind === 'track' || entity.type === 'track') {
      const title = entity.name || entity.title || 'Faixa Spotify';
      const artist =
        (Array.isArray(entity.artists) ? entity.artists.map((a) => a.name).join(', ') : entity.subtitle) || 'Spotify';
      const duration = Math.round((entity.duration || 0) / 1000);
      const id = makeMediaId();
      const entry = setRegistryEntry({
        id,
        kind: 'audio',
        platform: 'spotify',
        title,
        artist,
        thumbnail: cover,
        duration,
        originalUrl: cleanUrl,
        searchQuery: `${title} ${artist} official audio`,
        streamUrl: null,
        httpHeaders: {},
        mimeType: 'audio/mp4',
        resolvedAt: 0,
      });
      return {
        isPlaylist: false,
        platform: 'spotify',
        track: serializeTrackForClient(entry),
      };
    }

    const rawTracks = Array.isArray(entity.trackList) ? entity.trackList.slice(0, 80) : [];
    const playlistTitle = entity.name || entity.title || 'Playlist Spotify';
    const tracks = rawTracks.map((t) => {
      const title = t.title || 'Faixa Spotify';
      const artist = t.subtitle || 'Spotify';
      const duration = Math.round((t.duration || 0) / 1000);
      const id = makeMediaId();
      const entry = setRegistryEntry({
        id,
        kind: 'audio',
        platform: 'spotify',
        title,
        artist,
        thumbnail: cover,
        duration,
        originalUrl: t.uri || cleanUrl,
        searchQuery: `${title} ${artist} official audio`,
        streamUrl: null,
        httpHeaders: {},
        mimeType: 'audio/mp4',
        resolvedAt: 0,
      });
      return serializeTrackForClient(entry);
    });

    if (tracks.length > 0) {
      return {
        isPlaylist: true,
        platform: 'spotify',
        playlistTitle,
        playlistThumbnail: cover,
        tracks,
      };
    }
  }

  // Fallback: página pública da faixa (og:title + og:description "Artista · Álbum · Música · Ano")
  let title = '';
  let artist = '';
  let thumb = '';
  try {
    const pageResp = await fetch(`https://open.spotify.com/${kind}/${spotifyId}`, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(10000),
    });
    if (pageResp.ok) {
      const page = await pageResp.text();
      const meta = (prop) => {
        const mm =
          page.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`, 'i')) ||
          page.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${prop}"`, 'i'));
        return mm ? decodeHtmlEntities(mm[1]) : '';
      };
      title = meta('og:title');
      thumb = meta('og:image');
      const desc = meta('og:description');
      if (kind === 'track' && desc.includes('·')) artist = desc.split('·')[0].trim();
    }
  } catch {}

  if (!title) {
    const oeResp = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!oeResp.ok) throw new Error('Não foi possível ler os dados deste link do Spotify.');
    const oe = await oeResp.json();
    title = oe.title || 'Spotify';
    thumb = thumb || oe.thumbnail_url || '';
  }
  if (kind !== 'track') {
    throw new Error('Não consegui ler as faixas desta playlist/álbum do Spotify (pode ser privada). Tente o link de uma música.');
  }
  const id = makeMediaId();
  const entry = setRegistryEntry({
    id,
    kind: 'audio',
    platform: 'spotify',
    title,
    artist: artist || 'Spotify',
    thumbnail: thumb,
    duration: 0,
    originalUrl: cleanUrl,
    searchQuery: `${title} ${artist} audio`.replace(/\s+/g, ' ').trim(),
    streamUrl: null,
    httpHeaders: {},
    mimeType: 'audio/mp4',
    resolvedAt: 0,
  });
  return {
    isPlaylist: false,
    platform: 'spotify',
    track: serializeTrackForClient(entry),
  };
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function findSpotifyEntityDeep(root, kind, depth = 0) {
  if (!root || typeof root !== 'object' || depth > 9) return null;
  if (!Array.isArray(root)) {
    const t = String(root.type || '').toLowerCase();
    if ((root.name || root.title) && (Array.isArray(root.trackList) || (kind === 'track' && t === 'track'))) {
      return root;
    }
  }
  for (const v of Object.values(root)) {
    if (v && typeof v === 'object') {
      const r = findSpotifyEntityDeep(v, kind, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function isHlsUrl(u, protocol) {
  return /m3u8/i.test(String(protocol || '')) || /\.m3u8(\?|$)/i.test(String(u || ''));
}

// =============================================================
// HLS -> arquivo único (o SoundCloud passou a entregar só HLS AAC).
// O <audio> do Chromium/Electron não toca .m3u8, então baixamos os segmentos,
// concatenamos (fMP4 com EXT-X-MAP ou ADTS/MP3 puros funcionam concatenados)
// e servimos o arquivo com suporte a Range (o seek continua funcionando).
// =============================================================
const HLS_CACHE_DIR = path.join(os.tmpdir(), 'pulsecord-media-cache');
const hlsMaterializing = new Map();

function cleanupHlsCache() {
  try {
    if (!fs.existsSync(HLS_CACHE_DIR)) return;
    const files = fs
      .readdirSync(HLS_CACHE_DIR)
      .map((f) => {
        const full = path.join(HLS_CACHE_DIR, f);
        return { full, st: fs.statSync(full) };
      })
      .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    let total = 0;
    for (const item of files) {
      total += item.st.size;
      const tooOld = Date.now() - item.st.mtimeMs > 6 * 60 * 60 * 1000;
      if (tooOld || total > 400 * 1024 * 1024) {
        try {
          fs.unlinkSync(item.full);
        } catch {}
      }
    }
  } catch {}
}

async function fetchText(url, headers) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...(headers || {}) }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HLS HTTP ${r.status}`);
  return r.text();
}

async function materializeHls(entry) {
  if (entry.localFile && fs.existsSync(entry.localFile)) return entry.localFile;
  if (hlsMaterializing.has(entry.id)) return hlsMaterializing.get(entry.id);

  const job = (async () => {
    fs.mkdirSync(HLS_CACHE_DIR, { recursive: true });
    cleanupHlsCache();
    let playlistUrl = entry.streamUrl;
    let text = await fetchText(playlistUrl, entry.httpHeaders);

    // Master playlist -> escolhe a variante de maior banda
    if (/#EXT-X-STREAM-INF/i.test(text)) {
      const lines = text.split(/\r?\n/);
      let best = null;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/#EXT-X-STREAM-INF:.*BANDWIDTH=(\d+)/i);
        if (m && lines[i + 1] && !lines[i + 1].startsWith('#')) {
          const bw = Number(m[1]);
          if (!best || bw > best.bw) best = { bw, uri: lines[i + 1].trim() };
        }
      }
      if (!best) throw new Error('Playlist HLS sem variantes.');
      playlistUrl = new URL(best.uri, playlistUrl).href;
      text = await fetchText(playlistUrl, entry.httpHeaders);
    }

    if (/#EXT-X-KEY:(?!.*METHOD=NONE)/i.test(text)) throw new Error('Faixa protegida (HLS criptografado).');

    const urls = [];
    const mapMatch = text.match(/#EXT-X-MAP:.*URI="([^"]+)"/i);
    if (mapMatch) urls.push(new URL(mapMatch[1], playlistUrl).href);
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (l && !l.startsWith('#')) urls.push(new URL(l, playlistUrl).href);
    }
    if (urls.length === 0) throw new Error('Playlist HLS vazia.');

    // Download paralelo limitado (6 de cada vez), mantendo a ordem
    const parts = new Array(urls.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < urls.length) {
        const idx = cursor++;
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await fetch(urls[idx], {
              headers: { 'User-Agent': UA, ...(entry.httpHeaders || {}) },
              signal: AbortSignal.timeout(20000),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            parts[idx] = Buffer.from(await r.arrayBuffer());
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
          }
        }
        if (lastErr) throw lastErr;
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));

    const first = parts[0];
    // MPEG-TS (sync byte 0x47) não toca no <audio> do Chromium
    if (first && first[0] === 0x47 && (first.length < 189 || first[188] === 0x47)) {
      throw new Error('Formato HLS (MPEG-TS) não suportado.');
    }
    let ext = 'm4a';
    let mime = 'audio/mp4';
    if (first && first[0] === 0xff && (first[1] & 0xf6) === 0xf0) {
      ext = 'aac';
      mime = 'audio/aac';
    } else if (
      first &&
      ((first[0] === 0xff && (first[1] & 0xe0) === 0xe0) || first.subarray(0, 3).toString('latin1') === 'ID3')
    ) {
      ext = 'mp3';
      mime = 'audio/mpeg';
    }
    const outPath = path.join(HLS_CACHE_DIR, `${entry.id}.${ext}`);
    fs.writeFileSync(outPath, Buffer.concat(parts));
    entry.localFile = outPath;
    entry.mimeType = mime;
    return outPath;
  })();

  hlsMaterializing.set(entry.id, job);
  try {
    return await job;
  } finally {
    hlsMaterializing.delete(entry.id);
  }
}

function serializeTrackForClient(entry, extra = {}) {
  return {
    id: entry.id,
    mediaId: entry.id,
    title: entry.title,
    artist: entry.artist || entry.author || 'Desconhecido',
    thumbnail: entry.thumbnail || '',
    duration: entry.duration || 0,
    platform: entry.platform || 'youtube',
    url: `/api/media/stream/${entry.id}`,
    streamPath: `/api/media/stream/${entry.id}`,
    originalUrl: entry.originalUrl || '',
    source: entry.platform || 'web',
    ...extra,
  };
}

/**
 * Resolves a single Watch-Party video URL (YouTube, X/Twitter, Instagram, TikTok).
 */
export async function resolveVideoUrl(rawUrl, dataDir) {
  const url = String(rawUrl || '').trim();
  const platform = detectMediaPlatform(url);
  if (!['youtube', 'twitter', 'instagram', 'tiktok'].includes(platform)) {
    throw new Error('O Tocador de Vídeos aceita links do YouTube, Twitter/X, Instagram e TikTok.');
  }

  if (platform === 'youtube') {
    const youtubeId = extractYouTubeId(url);
    if (youtubeId) {
      try {
        return await resolveVideoUrlWithYtDlp(url, platform, dataDir);
      } catch (err) {
        const meta = await fetchYouTubeOEmbed(youtubeId);
        if (!meta && !isYouTubeBotBlock(err)) throw err;
        return {
          id: makeMediaId(),
          mediaId: '',
          platform,
          youtubeId,
          title: meta?.title || 'Vídeo do YouTube',
          author: meta?.author_name || 'YouTube',
          thumbnail: meta?.thumbnail_url || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
          duration: 0,
          originalUrl: url,
          // sem stream direto: toca só pelo player do YouTube
          streamPath: null,
          audioStreamPath: null,
        };
      }
    }
  }
  return resolveVideoUrlWithYtDlp(url, platform, dataDir);
}

async function resolveVideoUrlWithYtDlp(url, platform, dataDir) {
  const ytDlp = await ensureYtDlp(dataDir);
  const videoFmt =
    'bestvideo[ext=mp4][vcodec^=avc1][height<=1080][protocol^=http]+bestaudio[ext=m4a][protocol^=http]/best[ext=mp4][vcodec^=avc1][acodec!=none][height<=1080][protocol^=http]/best[ext=mp4][acodec!=none][vcodec!=none][protocol^=http]/18/best[acodec!=none][vcodec!=none][protocol^=http]/best';
  const ytArgs = [
    '--no-playlist',
    '--dump-single-json',
    ...(platform === 'youtube' ? ['--extractor-args', 'youtube:player_client=android,default'] : []),
    '-f',
    videoFmt,
    url,
  ];
  const info = await runYtDlpJson(ytDlp, ytArgs);

  const reqFmts = Array.isArray(info.requested_formats) ? info.requested_formats : [];
  let vFmt = null;
  let aFmt = null;
  if (reqFmts.length >= 2) {
    vFmt = reqFmts.find((f) => f.vcodec && f.vcodec !== 'none') || reqFmts[0];
    aFmt = reqFmts.find((f) => f.acodec && f.acodec !== 'none' && f !== vFmt) || null;
  }

  const directUrl = vFmt?.url || info.url || reqFmts[0]?.url;
  if (!directUrl) throw new Error('Não foi possível obter o fluxo de vídeo para este link.');

  const title = info.title || 'Vídeo da Galera';
  const author = info.uploader || info.channel || info.creator || getPlatformMeta(platform).name;
  const thumbnail = pickBestThumb(info);
  const duration = Math.round(Number(info.duration || 0));

  const id = makeMediaId();
  const entry = setRegistryEntry({
    id,
    kind: 'video',
    platform,
    title,
    author,
    thumbnail,
    duration,
    originalUrl: url,
    isDashVideoOnly: Boolean(aFmt?.url),
    streamUrl: directUrl,
    httpHeaders: vFmt?.http_headers || info.http_headers || {},
    mimeType: (vFmt?.ext || info.ext) === 'webm' ? 'video/webm' : 'video/mp4',
    resolvedAt: Date.now(),
  });

  let audioStreamPath = null;
  if (aFmt?.url) {
    const audioId = makeMediaId();
    setRegistryEntry({
      id: audioId,
      kind: 'audio',
      platform,
      title,
      artist: author,
      thumbnail,
      duration,
      originalUrl: url,
      streamUrl: aFmt.url,
      httpHeaders: aFmt.http_headers || info.http_headers || {},
      mimeType: aFmt.ext === 'webm' || aFmt.ext === 'opus' ? 'audio/webm' : 'audio/mp4',
      resolvedAt: Date.now(),
    });
    audioStreamPath = `/api/media/stream/${audioId}`;
  }

  return {
    id: entry.id,
    mediaId: entry.id,
    platform: entry.platform,
    youtubeId: platform === 'youtube' ? extractYouTubeId(url) : null,
    title: entry.title,
    author: entry.author,
    thumbnail: entry.thumbnail,
    duration: entry.duration,
    originalUrl: entry.originalUrl,
    streamPath: `/api/media/stream/${entry.id}`,
    audioStreamPath,
  };
}

/**
 * Resolves an Audio-Only Music track OR Playlist (YouTube, Spotify, SoundCloud).
 */
const SOUNDCLOUD_FORMAT =
  'http_mp3_128/bestaudio[protocol^=http][ext=mp3]/bestaudio[protocol^=http]/hls_aac_160k/bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/hls_mp3_128/bestaudio/best';

export async function resolveMusicUrl(rawUrl, dataDir) {
  const url = String(rawUrl || '').trim();
  const platform = detectMediaPlatform(url);
  if (!['youtube', 'spotify', 'soundcloud'].includes(platform)) {
    throw new Error('O Tocador de Músicas aceita apenas YouTube, Spotify e SoundCloud (músicas ou playlists).');
  }

  if (platform === 'spotify') {
    return resolveSpotifyEntity(url);
  }

  const ytDlp = await ensureYtDlp(dataDir);

  // Use --flat-playlist to handle both YouTube playlists/SoundCloud sets and single items quickly
  if (platform === 'youtube' && !isYouTubePlaylistUrl(url)) {
    // Fast direct resolve for single YouTube music track (audio only!)
    const info = await runYtDlpJson(ytDlp, [
      '--no-playlist',
      '--dump-single-json',
      '-f',
      'bestaudio[ext=m4a][protocol^=http]/bestaudio[ext=webm][protocol^=http]/bestaudio[protocol^=http]/bestaudio/best',
      url,
    ]);
    const directUrl = info.url || info.requested_formats?.find((f) => f.acodec && f.acodec !== 'none')?.url;
    if (!directUrl) throw new Error('Não foi possível extrair o áudio deste link.');

    const id = makeMediaId();
    const entry = setRegistryEntry({
      id,
      kind: 'audio',
      platform: 'youtube',
      title: info.title || 'Música do YouTube',
      artist: info.uploader || info.channel || 'YouTube',
      thumbnail: pickBestThumb(info),
      duration: Math.round(Number(info.duration || 0)),
      originalUrl: url,
      streamUrl: directUrl,
      httpHeaders: info.http_headers || {},
      mimeType: info.ext === 'webm' || info.ext === 'opus' ? 'audio/webm' : 'audio/mp4',
      resolvedAt: Date.now(),
    });
    return {
      isPlaylist: false,
      platform: 'youtube',
      track: serializeTrackForClient(entry),
    };
  }

  // Playlist or SoundCloud track/set
  const info = await runYtDlpJson(
    ytDlp,
    ['--flat-playlist', '--dump-single-json', '--playlist-end', '80', url],
    32000
  );

  if (info._type === 'playlist' && Array.isArray(info.entries)) {
    const validEntries = info.entries.filter((e) => e && (e.id || e.url || e.webpage_url));
    if (validEntries.length === 0) throw new Error('A playlist está vazia ou é privada.');

    const plThumb = pickBestThumb(info) || pickBestThumb(validEntries[0]);
    const tracks = validEntries.slice(0, 80).map((item, idx) => {
      const itemUrl =
        item.webpage_url ||
        (item.url && item.url.startsWith('http')
          ? item.url
          : platform === 'youtube' && item.id
          ? `https://www.youtube.com/watch?v=${item.id}`
          : url);
      const id = makeMediaId();
      const thumb =
        pickBestThumb(item) ||
        (platform === 'youtube' && item.id ? `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg` : plThumb);
      const entry = setRegistryEntry({
        id,
        kind: 'audio',
        platform,
        title: item.title || `Faixa ${idx + 1}`,
        artist: item.uploader || item.channel || getPlatformMeta(platform).name,
        thumbnail: thumb,
        duration: Math.round(Number(item.duration || 0)),
        originalUrl: itemUrl,
        fallbackQuery: item.title ? `${item.title} ${item.uploader || ''}`.trim() : '',
        streamUrl: null,
        httpHeaders: {},
        mimeType: 'audio/mp4',
        resolvedAt: 0,
      });
      return serializeTrackForClient(entry);
    });

    return {
      isPlaylist: true,
      platform,
      playlistTitle: info.title || `Playlist ${getPlatformMeta(platform).name}`,
      playlistThumbnail: plThumb,
      tracks,
    };
  }

  // Single SoundCloud track (SoundCloud agora entrega quase só HLS AAC -> convertido no stream)
  const singleInfo = await runYtDlpJson(ytDlp, ['--no-playlist', '--dump-single-json', '-f', SOUNDCLOUD_FORMAT, url]);

  const directUrl = singleInfo.url || singleInfo.requested_formats?.[0]?.url;
  if (!directUrl) throw new Error('Não foi possível extrair o áudio deste link.');

  const id = makeMediaId();
  const entry = setRegistryEntry({
    id,
    kind: 'audio',
    platform,
    title: singleInfo.title || 'Música',
    artist: singleInfo.uploader || singleInfo.channel || getPlatformMeta(platform).name,
    thumbnail: pickBestThumb(singleInfo),
    duration: Math.round(Number(singleInfo.duration || 0)),
    originalUrl: url,
    streamUrl: directUrl,
    protocol: singleInfo.protocol || '',
    fallbackQuery: `${singleInfo.title || ''} ${singleInfo.uploader || ''}`.trim(),
    httpHeaders: singleInfo.http_headers || {},
    mimeType: singleInfo.ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4',
    resolvedAt: Date.now(),
  });

  return {
    isPlaylist: false,
    platform,
    track: serializeTrackForClient(entry),
  };
}

/**
 * Ensures a registered media entry has an active fresh upstream streamUrl (for lazy playlist tracks or Spotify matches).
 */
export async function ensureMediaStreamReady(mediaId, dataDir, forceRefresh = false) {
  const entry = mediaRegistry.get(mediaId);
  if (!entry) return null;

  const isExpired = !entry.streamUrl || Date.now() - (entry.resolvedAt || 0) > 25 * 60 * 1000;
  if (!forceRefresh && !isExpired) return entry;

  if (entry._resolvingPromise) return entry._resolvingPromise;

  entry._resolvingPromise = (async () => {
    try {
      const cacheKey = entry.searchQuery ? entry.searchQuery.toLowerCase().trim() : '';
      if (!forceRefresh && cacheKey) {
        const cached = searchStreamCache.get(cacheKey);
        if (cached && Date.now() - cached.resolvedAt <= 25 * 60 * 1000) {
          entry.streamUrl = cached.streamUrl;
          entry.httpHeaders = cached.httpHeaders;
          entry.mimeType = cached.mimeType;
          entry.resolvedAt = cached.resolvedAt;
          if (!entry.thumbnail && cached.thumbnail) entry.thumbnail = cached.thumbnail;
          if (!entry.duration && cached.duration) entry.duration = cached.duration;
          return entry;
        }
      }

      const ytDlp = await ensureYtDlp(dataDir);
      const target = entry.searchQuery ? `ytsearch1:${entry.searchQuery}` : entry.originalUrl;
      const isSoundCloud = entry.platform === 'soundcloud' && !entry.searchQuery;
      const fmt =
        entry.kind === 'video' && entry.isDashVideoOnly
          ? 'bestvideo[ext=mp4][vcodec^=avc1][height<=1080][protocol^=http]/best[ext=mp4][acodec!=none][vcodec!=none][protocol^=http]/18/best'
          : entry.kind === 'video'
          ? 'best[ext=mp4][vcodec^=avc1][acodec!=none][height<=1080][protocol^=http]/best[ext=mp4][acodec!=none][vcodec!=none][protocol^=http]/18/best'
          : isSoundCloud
          ? SOUNDCLOUD_FORMAT
          : 'bestaudio[ext=m4a][protocol^=http]/bestaudio[ext=webm][protocol^=http]/bestaudio[protocol^=http]/bestaudio/best';
      const isYt = entry.platform === 'youtube' || target.startsWith('ytsearch');
      const baseArgs = ['--no-playlist', '--dump-single-json', '-f', fmt, target];
      let info;
      try {
        // Mesmo caminho que já funciona para links diretos do YouTube
        info = await runYtDlpJson(ytDlp, baseArgs, 25000);
      } catch (firstErr) {
        if (!isYt) throw firstErr;
        info = await runYtDlpJson(
          ytDlp,
          ['--extractor-args', 'youtube:player_client=default,android', ...baseArgs],
          25000
        );
      }
      // ytsearch1 pode devolver um "playlist" com 1 entrada
      if (info?._type === 'playlist' && Array.isArray(info.entries) && info.entries[0]) info = info.entries[0];
      const directUrl =
        info.url ||
        info.requested_formats?.find((f) =>
          entry.kind === 'audio' ? f.acodec && f.acodec !== 'none' : f.vcodec && f.vcodec !== 'none'
        )?.url ||
        info.requested_formats?.[0]?.url;

      if (directUrl) {
        entry.streamUrl = directUrl;
        entry.protocol = info.protocol || '';
        entry.localFile = null;
        entry.httpHeaders = info.http_headers || {};
        entry.resolvedAt = Date.now();
        if (!entry.thumbnail) entry.thumbnail = pickBestThumb(info);
        if (!entry.duration && info.duration) entry.duration = Math.round(Number(info.duration));
        entry.mimeType =
          entry.kind === 'video'
            ? info.ext === 'webm'
              ? 'video/webm'
              : 'video/mp4'
            : info.ext === 'mp3'
            ? 'audio/mpeg'
            : info.ext === 'webm'
            ? 'audio/webm'
            : 'audio/mp4';
        if (cacheKey) {
          if (searchStreamCache.size >= 250) {
            const oldK = searchStreamCache.keys().next().value;
            if (oldK) searchStreamCache.delete(oldK);
          }
          searchStreamCache.set(cacheKey, {
            streamUrl: entry.streamUrl,
            httpHeaders: entry.httpHeaders,
            mimeType: entry.mimeType,
            duration: entry.duration,
            thumbnail: entry.thumbnail,
            resolvedAt: entry.resolvedAt,
          });
        }
      }
      return entry;
    } finally {
      entry._resolvingPromise = null;
    }
  })();

  return entry._resolvingPromise;
}

export function prefetchMedia(mediaId, dataDir) {
  if (!mediaId) return;
  ensureMediaStreamReady(mediaId, dataDir)
    .then((entry) => {
      // Pré-baixa faixas HLS (SoundCloud) para a próxima música começar sem espera
      if (entry?.kind === 'audio' && entry.streamUrl && isHlsUrl(entry.streamUrl, entry.protocol)) {
        return materializeHls(entry);
      }
      return null;
    })
    .catch(() => {});
}

function sendLocalMediaFile(entry, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(entry.localFile, { headers: { 'Content-Type': entry.mimeType || 'audio/mp4' } });
}

export async function streamResolvedMedia(mediaId, req, res, dataDir) {
  let entry;
  try {
    entry = await ensureMediaStreamReady(mediaId, dataDir, false);
  } catch (err) {
    entry = mediaRegistry.get(mediaId) || null;
    if (!entry?.fallbackQuery) {
      return res.status(502).json({ error: err?.message || 'Falha ao resolver mídia.' });
    }
  }
  if (!entry) return res.status(404).json({ error: 'Fluxo de mídia não encontrado ou indisponível.' });

  // SoundCloud/HLS: baixa os segmentos e serve como arquivo comum.
  // Se não der (faixa protegida/formato TS), procura a mesma música no YouTube.
  const needsLocal =
    entry.kind === 'audio' &&
    (entry.localFile || !entry.streamUrl || isHlsUrl(entry.streamUrl, entry.protocol));
  if (needsLocal) {
    try {
      if (entry.localFile && fs.existsSync(entry.localFile)) return sendLocalMediaFile(entry, res);
      if (entry.streamUrl) {
        await materializeHls(entry);
        return sendLocalMediaFile(entry, res);
      }
    } catch {}
    if (entry.fallbackQuery && !entry.searchQuery) {
      entry.searchQuery = `${entry.fallbackQuery} audio`;
      entry.streamUrl = null;
      entry.localFile = null;
      try {
        entry = await ensureMediaStreamReady(mediaId, dataDir, true);
      } catch {}
    }
    if (!entry?.streamUrl) {
      return res.status(502).json({ error: 'Não foi possível tocar esta faixa.' });
    }
    if (isHlsUrl(entry.streamUrl, entry.protocol)) {
      try {
        await materializeHls(entry);
        return sendLocalMediaFile(entry, res);
      } catch {
        return res.status(502).json({ error: 'Formato de áudio não suportado.' });
      }
    }
  }

  const controller = new AbortController();
  const onClose = () => controller.abort();
  req.on('close', onClose);

  const attemptFetch = async (targetEntry) => {
    const headers = {
      'User-Agent': UA,
      ...(targetEntry.httpHeaders || {}),
    };
    if (req.headers.range) headers.Range = req.headers.range;
    return fetch(targetEntry.streamUrl, { headers, signal: controller.signal });
  };

  try {
    let upstream = await attemptFetch(entry);
    if (upstream.status === 403 || upstream.status === 410) {
      entry = await ensureMediaStreamReady(mediaId, dataDir, true);
      if (entry?.streamUrl) upstream = await attemptFetch(entry);
    }

    if (!upstream.ok && upstream.status !== 206) {
      req.off('close', onClose);
      return res.status(502).json({ error: `Origem de mídia retornou HTTP ${upstream.status}` });
    }

    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || entry.mimeType || 'application/octet-stream');
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    const cr = upstream.headers.get('content-range');
    if (cr) res.setHeader('Content-Range', cr);
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'no-store');

    if (!upstream.body) {
      req.off('close', onClose);
      return res.end();
    }

    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on('error', () => {
      if (!res.headersSent) res.status(502);
      res.end();
    });
    res.on('finish', () => req.off('close', onClose));
    res.on('close', () => {
      req.off('close', onClose);
      nodeStream.destroy();
    });
    nodeStream.pipe(res);
  } catch (err) {
    req.off('close', onClose);
    if (err?.name === 'AbortError') return;
    if (!res.headersSent) res.status(502).json({ error: 'Falha ao transmitir mídia externa.' });
  }
}

/**
 * Unfurls rich video/music embed previews for Chat links (YouTube, X/Twitter, Instagram, TikTok, Spotify, SoundCloud).
 */
export async function unfurlMediaUrl(rawUrl, dataDir) {
  const url = String(rawUrl || '').trim();
  const platform = detectMediaPlatform(url);
  if (platform === 'invalid' || platform === 'unknown') return null;

  const cached = unfurlCache.get(url);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.data;

  const meta = getPlatformMeta(platform);
  const ytId = platform === 'youtube' ? extractYouTubeId(url) : null;
  let result = {
    url,
    platform,
    providerName: meta.name,
    accentColor: meta.color,
    authorName: meta.name,
    title: url,
    thumbnailUrl: ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : '',
    duration: 0,
    canPlayVideo: ['youtube', 'twitter', 'instagram', 'tiktok'].includes(platform),
    canPlayAudio: ['youtube', 'spotify', 'soundcloud'].includes(platform),
    youtubeId: ytId,
  };

  try {
    let oembedEndpoint = '';
    if (platform === 'youtube') oembedEndpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    else if (platform === 'tiktok') oembedEndpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    else if (platform === 'soundcloud') oembedEndpoint = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    else if (platform === 'spotify') oembedEndpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    else if (platform === 'twitter') {
      const normalized = url.replace(/x\.com/i, 'twitter.com');
      oembedEndpoint = `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalized)}`;
    }

    if (oembedEndpoint) {
      const resp = await fetch(oembedEndpoint, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(7000),
      });
      if (resp.ok) {
        const oe = await resp.json();
        if (oe.author_name) result.authorName = oe.author_name;
        if (oe.title) result.title = oe.title;
        else if (oe.html && platform === 'twitter') {
          const textMatch = String(oe.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (textMatch) result.title = textMatch.slice(0, 160);
        }
        if (oe.thumbnail_url) result.thumbnailUrl = oe.thumbnail_url;
      }
    }

    // For Twitter/Instagram/TikTok without thumbnail yet, query yt-dlp metadata only (no download)
    if (!result.thumbnailUrl && ['twitter', 'instagram', 'tiktok'].includes(platform)) {
      const ytDlp = findExistingYtDlp(dataDir);
      if (ytDlp) {
        const info = await runYtDlpJson(ytDlp, ['--no-playlist', '--dump-single-json', '--skip-download', url], 12000).catch(
          () => null
        );
        if (info) {
          if (info.title) result.title = info.title;
          if (info.uploader || info.channel) result.authorName = info.uploader || info.channel;
          const th = pickBestThumb(info);
          if (th) result.thumbnailUrl = th;
          if (info.duration) result.duration = Math.round(Number(info.duration));
        }
      }
    }
  } catch {
    // Keep best partial result
  }

  if (unfurlCache.size >= 500) {
    const oldest = unfurlCache.keys().next().value;
    if (oldest) unfurlCache.delete(oldest);
  }
  unfurlCache.set(url, { data: result, ts: Date.now() });
  return result;
}
