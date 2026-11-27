// Waver - supervisor do servidor dedicado (Debian/Windows sem tela).
//
//   node server/launch.js [--port 3000] [--data /var/lib/pulsecord] ...   (os mesmos argumentos do index.js)
//
// Este arquivo fica na pasta instalada (/opt/pulsecord) e NUNCA se atualiza sozinho: ele só escolhe qual versão
// do servidor rodar e a reinicia quando preciso.
//   - A atualização automática (selfUpdate.js, roda dentro do servidor) monta as versões novas em
//     <dados>/server-live/<versão>. A pasta instalada é só leitura para o serviço.
//   - Quando o servidor pede para trocar de versão (sai com o código 75), sobe a versão nova logo em seguida.
//   - A versão nova está "em teste" até ficar 60 s de pé. Se cair antes disso, volta para a anterior e
//     a versão nova fica marcada como ruim (não é baixada de novo).
//   - Instalar um pacote mais novo à mão (install.sh) sempre ganha das versões baixadas.
import { fork } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXIT_SWITCH = 75;
const TRIAL_MS = Number(process.env.WAVER_SERVER_TRIAL_MS) > 0 ? Number(process.env.WAVER_SERVER_TRIAL_MS) : 60_000;
const args = process.argv.slice(2);

function argValue(name) {
  const i = args.indexOf(`--${name}`);
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}
const DATA_DIR = path.resolve(argValue('data') || process.env.PULSECORD_DATA_DIR || path.join(BASE, 'server', 'data'));
const LIVE = path.join(DATA_DIR, 'server-live');
const STATE_FILE = path.join(LIVE, 'state.json');

const log = (msg) => console.log(`[Waver] ${msg}`);
const VERSION_RE = /^\d+(\.\d+)*$/;

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
function readVersion(root) {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}
function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      active: VERSION_RE.test(String(s.active || '')) ? String(s.active) : null,
      previous: VERSION_RE.test(String(s.previous || '')) ? String(s.previous) : null,
      bad: Array.isArray(s.bad) ? s.bad.filter((v) => VERSION_RE.test(String(v))).slice(-20) : [],
    };
  } catch {
    return { active: null, previous: null, bad: [] };
  }
}
function writeState(s) {
  try {
    fs.mkdirSync(LIVE, { recursive: true });
    fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(s, null, 2));
    fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
  } catch (err) {
    log(`não consegui gravar ${STATE_FILE}: ${err.message}`);
  }
}
const liveDir = (v) => path.join(LIVE, v);
// apaga uma versão baixada sem entrar nas pastas linkadas (node_modules da instalação)
function removeDir(dir) {
  for (const l of [path.join(dir, 'server', 'node_modules', 'mediasoup'), path.join(dir, 'server', 'node_modules')]) {
    try {
      if (fs.lstatSync(l).isSymbolicLink()) fs.unlinkSync(l);
    } catch {}
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

// ---- conferência a cada início: a pasta baixada é gravável pelo serviço, a instalação não ----
// Só roda uma versão baixada se o índice assinado guardado nela conferir com a chave oficial DA INSTALAÇÃO e cada
// arquivo usado tiver o sha256 do índice. Os links de node_modules só podem apontar para a instalação.
function loadPublicKey() {
  for (const file of [path.join(BASE, 'server', 'release-public-key.json'), path.join(BASE, 'electron', 'release-public-key.json')]) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const k = crypto.createPublicKey({ key: Buffer.from(String(j.pub), 'base64'), format: 'der', type: 'spki' });
      if (k.asymmetricKeyType === 'ed25519') return k;
    } catch {}
  }
  return null;
}
const PUBLIC_KEY = loadPublicKey();
function manifestMessage(m) {
  const lines = Object.keys(m.files)
    .sort()
    .map((k) => {
      const f = m.files[k];
      return `${k}\t${f.h}\t${f.s}\t${f.o}\t${f.c}`;
    });
  return Buffer.from(`WAVER-APP-V1\n${m.version}\n${m.runtime}\n${lines.join('\n')}`);
}
const sameReal = (a, b) => {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
};
function verifyVersionDir(v) {
  const dir = liveDir(v);
  try {
    if (!PUBLIC_KEY) return 'sem a chave pública oficial na instalação';
    const rec = JSON.parse(fs.readFileSync(path.join(dir, '.waver-server.json'), 'utf8'));
    const m = rec?.manifest;
    const files = rec?.files;
    if (!m || typeof m !== 'object' || m.version !== v || typeof m.sig !== 'string' || !m.files || !Array.isArray(files)) return 'registro inválido';
    if (!crypto.verify(null, manifestMessage(m), PUBLIC_KEY, Buffer.from(m.sig, 'base64'))) return 'assinatura não confere';
    for (const req of ['server/index.js', 'client/dist/index.html', 'package.json']) if (!files.includes(req)) return `falta ${req}`;
    for (const rel of files) {
      const f = m.files[rel];
      if (!f || typeof rel !== 'string' || rel.split('/').some((p) => !p || p === '.' || p === '..')) return `arquivo fora do índice: ${rel}`;
      const buf = fs.readFileSync(path.join(dir, ...rel.split('/')));
      if (buf.length !== f.s || crypto.createHash('sha256').update(buf).digest('hex') !== f.h) return `arquivo alterado: ${rel}`;
    }
    const nm = path.join(dir, 'server', 'node_modules');
    const st = fs.lstatSync(nm, { throwIfNoEntry: false });
    if (st?.isSymbolicLink()) {
      if (!sameReal(nm, path.join(BASE, 'server', 'node_modules'))) return 'node_modules aponta para fora da instalação';
    } else if (st) {
      // dependências do pacote: aqui dentro só pode haver o link do mediasoup da instalação
      for (const name of fs.readdirSync(nm)) {
        const l = path.join(nm, name);
        if (name !== 'mediasoup' || !fs.lstatSync(l).isSymbolicLink() || !sameReal(l, path.join(BASE, 'server', 'node_modules', 'mediasoup'))) {
          return `server/node_modules/${name} inesperado`;
        }
      }
    }
    return '';
  } catch (err) {
    return err?.code === 'ENOENT' ? 'arquivo faltando' : String(err?.message || err);
  }
}
function usable(v) {
  if (!v || !fs.existsSync(path.join(liveDir(v), 'server', 'index.js'))) return false;
  // confere toda vez que vai subir (uns milissegundos): nada muda entre a conferência e o início
  const problem = verifyVersionDir(v);
  if (problem) log(`a versão baixada ${v} não passou na conferência (${problem}): não vou usá-la.`);
  return !problem;
}

const baseVersion = readVersion(BASE);
let state = readState();
let child = null;
let childRoot = BASE;
let childVersion = baseVersion;
let trial = null; // { version, fallback } enquanto a versão nova não ficou TRIAL_MS de pé
let trialTimer = null;
let nextTrial = null; // versão que o servidor pediu para subir
let stagedVersion = null; // versão já montada que espera a chamada esvaziar (não pode ser apagada)
let stopping = false;
let crashes = 0;

/** apaga as versões baixadas que não servem mais (fica a ativa, a anterior e a que está rodando) */
function cleanup() {
  let names = [];
  try {
    names = fs.readdirSync(LIVE);
  } catch {
    return;
  }
  const keep = new Set([state.active, state.previous, childRoot === BASE ? null : path.basename(childRoot)].filter(Boolean));
  for (const name of names) {
    // *.staging = download em andamento (o próprio servidor limpa na próxima tentativa)
    if (name === 'state.json' || name.endsWith('.staging') || name.endsWith('.tmp') || keep.has(name)) continue;
    // a versão que o servidor acabou de montar e ainda vai pedir para subir
    if (name === nextTrial || name === stagedVersion) continue;
    removeDir(path.join(LIVE, name));
  }
}

function pickRoot() {
  // pacote instalado à mão mais novo (ou igual) que o baixado: usa o instalado e esquece os baixados
  if (state.active && compareVersions(state.active, baseVersion) <= 0) {
    state = { active: null, previous: null, bad: state.bad };
    writeState(state);
    cleanup();
  }
  if (nextTrial && !state.bad.includes(nextTrial) && compareVersions(nextTrial, baseVersion) > 0 && usable(nextTrial)) {
    const v = nextTrial;
    nextTrial = null;
    trial = { version: v, fallback: state.active };
    return { root: liveDir(v), version: v };
  }
  nextTrial = null;
  if (state.active && !state.bad.includes(state.active) && usable(state.active)) {
    return { root: liveDir(state.active), version: state.active };
  }
  return { root: BASE, version: baseVersion };
}

function commitTrial() {
  if (!trial) return;
  const v = trial.version;
  // a anterior é a que rodava antes do teste (null = a versão instalada)
  state = { active: v, previous: trial.fallback || null, bad: state.bad };
  trial = null;
  writeState(state);
  cleanup();
  log(`versão ${v} confirmada.`);
}

function start() {
  const { root, version } = pickRoot();
  stagedVersion = null;
  childRoot = root;
  childVersion = version;
  const entry = path.join(root, 'server', 'index.js');
  log(`iniciando o servidor ${version}${root === BASE ? '' : ' (atualização automática)'}${trial ? ' em teste' : ''}`);
  child = fork(entry, args, {
    cwd: path.join(root, 'server'),
    stdio: 'inherit',
    env: {
      ...process.env,
      WAVER_SERVER_BASE: BASE,
      WAVER_SERVER_ROOT: root,
      WAVER_SERVER_LIVE: LIVE,
      PULSECORD_DOWNLOADS_DIR: process.env.PULSECORD_DOWNLOADS_DIR || path.join(BASE, 'dist-app'),
    },
  });
  let ready = false;
  child.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') {
      ready = true;
      crashes = 0;
      if (trial) {
        clearTimeout(trialTimer);
        trialTimer = setTimeout(commitTrial, TRIAL_MS);
      }
    } else if (msg.type === 'staged' && VERSION_RE.test(String(msg.version || ''))) {
      stagedVersion = String(msg.version);
    } else if (msg.type === 'apply' && VERSION_RE.test(String(msg.version || ''))) {
      // o servidor vai sair com EXIT_SWITCH logo depois
      nextTrial = String(msg.version);
    } else if (msg.type === 'adopt' && VERSION_RE.test(String(msg.version || '')) && usable(String(msg.version))) {
      // só a interface mudou: o servidor já trocou sem reiniciar; da próxima vez que subir, sobe esta
      const v = String(msg.version);
      if (state.active !== v) state = { active: v, previous: state.active || null, bad: state.bad };
      writeState(state);
      cleanup();
      log(`interface ${v} aplicada sem reiniciar.`);
    }
  });
  child.on('exit', (code, signal) => {
    child = null;
    clearTimeout(trialTimer);
    if (stopping) process.exit(code ?? 0);
    if (code === EXIT_SWITCH) {
      log('reiniciando para atualizar...');
      if (trial) commitTrial(); // pediu outra troca: esta já estava rodando bem
      return start();
    }
    if (trial) {
      // a versão nova caiu antes de ficar de pé: volta para a anterior e não tenta mais esta
      const v = trial.version;
      log(`a versão ${v} caiu ao iniciar (código ${code ?? signal}): voltando para a anterior.`);
      state = { ...state, bad: [...state.bad.filter((b) => b !== v), v] };
      trial = null;
      writeState(state);
      removeDir(liveDir(v));
      return start();
    }
    crashes += 1;
    if (!ready && childRoot !== BASE && crashes >= 3) {
      // uma versão baixada que parou de subir: volta para a instalada
      log(`a versão ${childVersion} não sobe mais: voltando para a versão instalada ${baseVersion}.`);
      state = { active: null, previous: null, bad: [...state.bad.filter((b) => b !== childVersion), childVersion] };
      writeState(state);
      crashes = 0;
    }
    const wait = Math.min(30_000, 2000 * crashes);
    log(`o servidor parou (código ${code ?? signal}); iniciando de novo em ${Math.round(wait / 1000)} s.`);
    setTimeout(start, wait);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  if (!child) process.exit(0);
  // desligar com calma: fechar o canal faz o servidor salvar e sair (no Windows, kill() mataria na hora, no meio
  // do salvamento; e o Ctrl+C já chega ao servidor também)
  try {
    child.disconnect();
  } catch {}
  setTimeout(() => {
    try {
      child?.kill('SIGKILL');
    } catch {}
    process.exit(0);
  }, 12_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
