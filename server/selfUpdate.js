// Atualização automática do servidor dedicado pelo GitHub Releases.
//
// Só roda quando o servidor foi iniciado pelo supervisor (server/launch.js), que escolhe a versão a subir e a
// reinicia. A cada PULSECORD_AUTO_UPDATE_HOURS horas (padrão 6):
//   1. olha a última release do GitHub;
//   2. baixa o índice assinado da atualização leve (waver-app.json, o mesmo que os apps usam) e confere a
//      assinatura com a chave oficial da pasta INSTALADA (nunca com uma chave que veio no download);
//   3. monta a versão nova em <dados>/server-live/<versão> com só o que o servidor usa (server/, client/dist,
//      package.json): o que não mudou é copiado daqui, o resto vem do waver-app.pack por HTTP Range;
//   4. se só a interface mudou, troca na hora, sem reiniciar;
//   5. se o servidor mudou, espera não ter ninguém em chamada e só então reinicia (~2 s; os apps reconectam
//      sozinhos). Passadas PULSECORD_AUTO_UPDATE_MAX_WAIT_H horas (padrão 24) sem a chamada esvaziar, reinicia
//      entre 4h e 6h da manhã (0 = nunca força).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MANIFEST_NAME = 'waver-app.json';
const PACK_NAME = 'waver-app.pack';
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_PACK_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 20000;
const MERGE_GAP = 64 * 1024;
const MAX_RANGE = 8 * 1024 * 1024;
const VERSION_RE = /^\d+(\.\d+)*$/;
const EXIT_SWITCH = 75;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// mesmo formato de electron/appPack.js (o índice é um só para o app e para o servidor)
function manifestMessage(m) {
  const lines = Object.keys(m.files)
    .sort()
    .map((k) => {
      const f = m.files[k];
      return `${k}\t${f.h}\t${f.s}\t${f.o}\t${f.c}`;
    });
  return Buffer.from(`WAVER-APP-V1\n${m.version}\n${m.runtime}\n${lines.join('\n')}`);
}

function isSafeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 400) return false;
  if (rel.includes('\\') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return false;
  if (rel.split('/').some((p) => !p || p === '.' || p === '..')) return false;
  if (/\.(node|exe|dll)$/i.test(rel)) return false;
  return true;
}

export function verifyManifest(m, publicKey) {
  if (!publicKey) throw new Error('sem a chave pública oficial na pasta instalada');
  if (!m || m.v !== 1 || typeof m.version !== 'string' || typeof m.runtime !== 'string' || typeof m.sig !== 'string') {
    throw new Error('índice inválido');
  }
  if (!m.files || typeof m.files !== 'object') throw new Error('índice inválido');
  const keys = Object.keys(m.files);
  if (keys.length === 0 || keys.length > MAX_FILES) throw new Error('índice inválido');
  for (const k of keys) {
    const f = m.files[k];
    if (!isSafeRel(k)) throw new Error(`caminho não permitido: ${k}`);
    if (!f || !/^[a-f0-9]{64}$/.test(String(f.h)) || ![f.s, f.o, f.c].every((n) => Number.isSafeInteger(n) && n >= 0)) {
      throw new Error('índice inválido');
    }
  }
  if (!m.files['server/index.js'] || !m.files['client/dist/index.html'] || !m.files['package.json']) {
    throw new Error('índice sem os arquivos do servidor');
  }
  if (!crypto.verify(null, manifestMessage(m), publicKey, Buffer.from(m.sig, 'base64'))) {
    throw new Error('a atualização não tem a assinatura oficial do Waver');
  }
  return true;
}

export function loadPublicKey(baseDir) {
  // a chave é sempre a da pasta instalada (no pacote do servidor: server/release-public-key.json; no projeto:
  // electron/release-public-key.json)
  for (const file of [path.join(baseDir, 'server', 'release-public-key.json'), path.join(baseDir, 'electron', 'release-public-key.json')]) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const k = crypto.createPublicKey({ key: Buffer.from(String(j.pub), 'base64'), format: 'der', type: 'spki' });
      if (k.asymmetricKeyType === 'ed25519') return k;
    } catch {}
  }
  return null;
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const depsKey = (pkg) =>
  JSON.stringify(['dependencies', 'optionalDependencies'].map((k) => Object.entries(pkg?.[k] || {}).sort()));

function writeFile(root, rel, buf) {
  const full = path.join(root, ...rel.split('/'));
  if (!full.startsWith(root + path.sep)) throw new Error('caminho inválido');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
}

// no Windows o antivírus segura os arquivos recém-gravados por um instante (EPERM/EBUSY ao renomear a pasta)
async function renameWithRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(from, to);
    } catch (err) {
      if (i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(err?.code)) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

function linkDir(target, link) {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  // junção no Windows (link simbólico comum de pasta pede administrador); no Linux o tipo é ignorado
  fs.symlinkSync(target, link, 'junction');
}

/** apaga uma pasta de versão sem nunca entrar nas pastas linkadas (node_modules da instalação) */
export function removeVersionDir(dir) {
  for (const l of [path.join(dir, 'server', 'node_modules', 'mediasoup'), path.join(dir, 'server', 'node_modules')]) {
    try {
      if (fs.lstatSync(l).isSymbolicLink()) fs.unlinkSync(l);
    } catch {}
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * @param {object} o
 * @param {object} o.instance  retorno de createPulseCordServer (stop, swapClientDist, getVoicePeopleCount)
 * @param {string} o.appVersion
 */
export function startSelfUpdate({ instance, appVersion, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  const BASE = process.env.WAVER_SERVER_BASE;
  const ROOT = process.env.WAVER_SERVER_ROOT;
  const LIVE = process.env.WAVER_SERVER_LIVE;
  const log = (msg) => console.log(`[auto-update] ${msg}`);
  const flag = String(process.env.PULSECORD_AUTO_UPDATE ?? '').trim().toLowerCase();
  const status = { enabled: false, state: 'off', current: appVersion, staged: null, lastCheck: 0, lastError: '' };
  const getStatus = () => ({ ...status });

  if (['0', 'off', 'false', 'no', 'nao', 'não'].includes(flag)) {
    log('desligada (PULSECORD_AUTO_UPDATE=0).');
    return { getStatus, stop() {} };
  }
  if (!BASE || !ROOT || !LIVE || typeof process.send !== 'function') {
    log('desligada: inicie o servidor por server/launch.js (o serviço do install.sh já faz isso).');
    return { getStatus, stop() {} };
  }
  const publicKey = loadPublicKey(BASE);
  const repo =
    String(process.env.PULSECORD_UPDATE_REPO || '').trim() ||
    readJson(path.join(BASE, 'package.json'))?.pulsecordUpdate?.githubRepo ||
    readJson(path.join(ROOT, 'package.json'))?.pulsecordUpdate?.githubRepo ||
    '';
  if (!publicKey || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    log(`desligada: ${!publicKey ? 'sem a chave pública oficial' : 'sem o repositório do GitHub'} na pasta instalada.`);
    return { getStatus, stop() {} };
  }
  const api = String(process.env.PULSECORD_UPDATE_API || 'https://api.github.com').replace(/\/+$/, '');
  const fast = process.env.PULSECORD_AUTO_UPDATE_TEST === '1';
  const hours = Math.max(1, Number(process.env.PULSECORD_AUTO_UPDATE_HOURS) || 6);
  const maxWaitH = process.env.PULSECORD_AUTO_UPDATE_MAX_WAIT_H === undefined ? 24 : Math.max(0, Number(process.env.PULSECORD_AUTO_UPDATE_MAX_WAIT_H) || 0);
  const checkEvery = fast ? 3000 : hours * 3600_000;
  const idleEvery = fast ? 1000 : 60_000;
  Object.assign(status, { enabled: true, state: 'idle' });

  // de onde vêm os arquivos iguais: código do servidor = o que está rodando; interface = a que está servida
  let uiRoot = ROOT;
  let uiVersion = appVersion;
  let staged = null; // { version, dir, at }
  let busy = false;
  let applying = false;
  const timers = [];

  const H = { 'User-Agent': 'Waver-Server-Updater' };
  const badVersions = () => (readJson(path.join(LIVE, 'state.json'))?.bad || []).map(String);
  const readFrom = (root, rel) => {
    try {
      return fs.readFileSync(path.join(root, ...rel.split('/')));
    } catch {
      return null;
    }
  };
  const localCopy = (rel, f) => {
    const root = rel.startsWith('client/dist/') ? uiRoot : ROOT;
    let buf = readFrom(root, rel);
    if (!buf && root !== BASE) buf = readFrom(BASE, rel);
    return buf && buf.length === f.s && sha256(buf) === f.h ? buf : null;
  };

  async function downloadInto(staging, entries, packUrl) {
    const need = [];
    for (const [rel, f] of entries) {
      const buf = localCopy(rel, f);
      if (buf) writeFile(staging, rel, buf);
      else need.push([rel, f]);
    }
    need.sort((a, b) => a[1].o - b[1].o);
    const groups = [];
    for (const item of need) {
      const g = groups[groups.length - 1];
      const end = item[1].o + item[1].c;
      if (g && item[1].o - g.end <= MERGE_GAP && end - g.start <= MAX_RANGE) {
        g.items.push(item);
        g.end = Math.max(g.end, end);
      } else groups.push({ start: item[1].o, end, items: [item] });
    }
    let whole = null;
    let bytes = 0;
    for (const g of groups) {
      let buf;
      let base = 0;
      if (whole) buf = whole;
      else {
        const resp = await fetchImpl(packUrl, { headers: { ...H, Range: `bytes=${g.start}-${g.end - 1}` }, signal: AbortSignal.timeout(120_000) });
        if (!resp.ok) throw new Error(`pacote: HTTP ${resp.status}`);
        const body = Buffer.from(await resp.arrayBuffer());
        if (resp.status === 206) {
          buf = body;
          base = g.start;
        } else {
          if (body.length > MAX_PACK_BYTES) throw new Error('pacote grande demais');
          whole = buf = body;
        }
        bytes += body.length;
      }
      for (const [rel, f] of g.items) {
        const slice = buf.subarray(f.o - base, f.o - base + f.c);
        if (slice.length !== f.c) throw new Error('pedaço do pacote incompleto');
        const out = zlib.brotliDecompressSync(slice, { maxOutputLength: Math.max(1, f.s) });
        if (out.length !== f.s || sha256(out) !== f.h) throw new Error(`arquivo não confere: ${rel}`);
        writeFile(staging, rel, out);
      }
    }
    return { bytes, downloaded: need.length };
  }

  async function check() {
    if (busy || applying) return;
    busy = true;
    status.state = 'checking';
    status.lastCheck = Date.now();
    try {
      const relResp = await fetchImpl(`${api}/repos/${repo}/releases/latest`, {
        headers: { ...H, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!relResp.ok) throw new Error(`GitHub: HTTP ${relResp.status}`);
      const rel = await relResp.json();
      const tagVersion = String(rel?.tag_name || '').replace(/^v/i, '');
      const known = staged?.version || uiVersion;
      if (!VERSION_RE.test(tagVersion) || compareVersions(tagVersion, known) <= 0) {
        status.state = staged ? 'waiting' : 'idle';
        status.lastError = '';
        return;
      }
      if (badVersions().includes(tagVersion)) {
        status.state = staged ? 'waiting' : 'idle';
        return;
      }
      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      const mAsset = assets.find((a) => a?.name === MANIFEST_NAME);
      const pAsset = assets.find((a) => a?.name === PACK_NAME);
      if (!mAsset || !pAsset) throw new Error(`a release ${tagVersion} não tem ${MANIFEST_NAME}/${PACK_NAME}`);
      if ((Number(pAsset.size) || 0) > MAX_PACK_BYTES) throw new Error('pacote grande demais');
      const mUrl = String(mAsset.browser_download_url || '');
      const packUrl = String(pAsset.browser_download_url || '');
      if (!/^https?:\/\//i.test(mUrl) || !/^https?:\/\//i.test(packUrl)) throw new Error('endereço inválido na release');
      const mResp = await fetchImpl(mUrl, { headers: H, signal: AbortSignal.timeout(20_000) });
      if (!mResp.ok) throw new Error(`índice: HTTP ${mResp.status}`);
      const mBuf = Buffer.from(await mResp.arrayBuffer());
      if (mBuf.length > MAX_MANIFEST_BYTES) throw new Error('índice grande demais');
      const m = JSON.parse(mBuf.toString('utf8'));
      verifyManifest(m, publicKey);
      if (!VERSION_RE.test(m.version) || compareVersions(m.version, known) <= 0) {
        status.state = staged ? 'waiting' : 'idle';
        return;
      }
      log(`versão ${m.version} encontrada (rodando ${uiVersion}); baixando o que mudou...`);

      const dir = path.join(LIVE, m.version);
      const staging = `${dir}.staging`;
      removeVersionDir(staging);
      fs.mkdirSync(staging, { recursive: true });
      const all = Object.entries(m.files);
      const core = all.filter(([r]) => r === 'package.json' || r.startsWith('server/') || r.startsWith('client/dist/'));
      let { bytes, downloaded } = await downloadInto(staging, core, packUrl);
      const materialized = core.map(([r]) => r);

      // dependências: iguais às instaladas = usa as da instalação; mudaram = as bibliotecas JS vêm do pacote
      const newServerPkg = readJson(path.join(staging, 'server', 'package.json'));
      const baseServerPkg = readJson(path.join(BASE, 'server', 'package.json'));
      const baseModules = path.join(BASE, 'server', 'node_modules');
      if (!fs.existsSync(baseModules)) throw new Error(`sem ${baseModules}`);
      if (depsKey(newServerPkg) === depsKey(baseServerPkg)) {
        linkDir(fs.realpathSync(baseModules), path.join(staging, 'server', 'node_modules'));
      } else {
        const mods = all.filter(([r]) => r.startsWith('node_modules/'));
        if (!mods.length) throw new Error('as dependências mudaram e o pacote não traz as bibliotecas');
        const r = await downloadInto(staging, mods, packUrl);
        materialized.push(...mods.map(([x]) => x));
        bytes += r.bytes;
        downloaded += r.downloaded;
        // o SFU (mediasoup, binário) não vem no pacote: usa o instalado se a versão pedida for a mesma
        const ms = path.join(baseModules, 'mediasoup');
        if (fs.existsSync(ms) && newServerPkg?.optionalDependencies?.mediasoup === baseServerPkg?.optionalDependencies?.mediasoup) {
          linkDir(fs.realpathSync(ms), path.join(staging, 'server', 'node_modules', 'mediasoup'));
        } else if (newServerPkg?.optionalDependencies?.mediasoup) {
          log('o SFU (mediasoup) mudou de versão: as chamadas ficam em malha até instalar o pacote novo à mão.');
        }
        log('as dependências do servidor mudaram: usando as bibliotecas do pacote.');
      }
      // confere de novo tudo o que foi montado
      for (const [r, f] of core) {
        const buf = readFrom(staging, r);
        if (!buf || buf.length !== f.s || sha256(buf) !== f.h) throw new Error(`a versão montada não confere: ${r}`);
      }
      if (readJson(path.join(staging, 'package.json'))?.version !== m.version) throw new Error('versão do pacote não confere');
      // índice assinado + lista do que foi montado: o supervisor confere tudo de novo a cada início
      fs.writeFileSync(path.join(staging, '.waver-server.json'), JSON.stringify({ manifest: m, files: materialized, at: Date.now() }));
      removeVersionDir(dir);
      await renameWithRetry(staging, dir);
      // uma versão montada antes e ainda não aplicada virou lixo
      if (staged && staged.dir !== dir) removeVersionDir(staged.dir);

      // o que mudou em relação ao que está rodando (package.json muda a versão sempre e não conta)
      const changed = core.filter(([r, f]) => {
        if (r === 'package.json') return false;
        const cur = readFrom(r.startsWith('client/dist/') ? uiRoot : ROOT, r);
        return !cur || cur.length !== f.s || sha256(cur) !== f.h;
      });
      const uiOnly = changed.length > 0 && changed.every(([r]) => r.startsWith('client/dist/')) && depsKey(newServerPkg) === depsKey(readJson(path.join(ROOT, 'server', 'package.json')));
      log(`versão ${m.version} pronta: ${downloaded} arquivo(s) baixado(s), ${bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`}.`);
      status.lastError = '';
      if (uiOnly && typeof instance.swapClientDist === 'function') {
        instance.swapClientDist(path.join(dir, 'client', 'dist'), m.version);
        uiRoot = dir;
        uiVersion = m.version;
        staged = null;
        status.current = m.version;
        status.staged = null;
        status.state = 'idle';
        process.send({ type: 'adopt', version: m.version });
        log(`só a interface mudou: aplicada sem reiniciar (${m.version}).`);
        return;
      }
      staged = { version: m.version, dir, at: Date.now() };
      process.send({ type: 'staged', version: m.version });
      status.staged = m.version;
      status.state = 'waiting';
      log('o servidor reinicia sozinho quando não houver ninguém em chamada.');
      maybeApply();
    } catch (err) {
      status.state = staged ? 'waiting' : 'error';
      status.lastError = String(err?.message || err);
      log(`não deu para atualizar agora: ${status.lastError}. Tento de novo em ${fast ? 'segundos' : `${hours} h`}.`);
    } finally {
      busy = false;
    }
  }

  function maybeApply() {
    if (!staged || applying || busy) return;
    const inCall = Number(instance.getVoicePeopleCount?.() || 0);
    let forced = false;
    if (inCall > 0) {
      const waitedH = (Date.now() - staged.at) / 3600_000;
      const hour = now().getHours();
      if (!(maxWaitH > 0 && waitedH >= maxWaitH && hour >= 4 && hour < 6)) return;
      forced = true;
    }
    applying = true;
    status.state = 'restarting';
    log(
      forced
        ? `reiniciando para a versão ${staged.version} (${inCall} pessoa(s) em chamada, mas a atualização espera há mais de ${maxWaitH} h).`
        : `ninguém em chamada: reiniciando para a versão ${staged.version}.`
    );
    const version = staged.version;
    process.send({ type: 'apply', version }, () => {
      Promise.race([Promise.resolve(instance.stop()).catch(() => {}), new Promise((r) => setTimeout(r, 8000))]).finally(() =>
        process.exit(EXIT_SWITCH)
      );
    });
  }

  timers.push(setTimeout(check, fast ? 1000 : 2 * 60_000));
  timers.push(setInterval(check, checkEvery));
  timers.push(setInterval(maybeApply, idleEvery));
  for (const t of timers) t.unref?.();
  log(`ligada: confere o GitHub (${repo}) a cada ${fast ? '3 s (teste)' : `${hours} h`}.`);
  return {
    getStatus,
    checkNow: check,
    stop() {
      for (const t of timers) clearTimeout(t);
    },
  };
}
