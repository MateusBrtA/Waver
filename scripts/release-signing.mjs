// Assinatura das atualizações do PulseCord (Ed25519).
//
// O app só instala uma atualização vinda de um servidor (interface "a quente" ou .exe) se ela estiver assinada
// com a chave de quem publica o PulseCord. Assim, o dono de um servidor qualquer não consegue empurrar um
// programa para o PC de quem entra no servidor dele.
//
//   node scripts/release-signing.mjs init      cria a chave (uma vez) e grava a chave pública no app
//   node scripts/release-signing.mjs sign-ui   assina client/dist        (roda sozinho no build:client)
//   node scripts/release-signing.mjs sign-exe  assina dist-app/*.exe     (roda sozinho no build:exe/installer/win)
//
// A chave PRIVADA fica fora do projeto: %USERPROFILE%\.pulsecord-release\release-ed25519.json
// (ou no caminho de PULSECORD_RELEASE_KEY). Faça backup dela: sem ela, os apps já instalados não aceitam
// atualizações novas pelo servidor (aí é preciso instalar a versão nova manualmente).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const KEY_FILE = process.env.PULSECORD_RELEASE_KEY || path.join(os.homedir(), '.pulsecord-release', 'release-ed25519.json');
const PUB_FILE = path.join(root, 'electron', 'release-public-key.json');
const DIST = path.join(root, 'client', 'dist');
const DIST_APP = path.join(root, 'dist-app');
export const UI_SIG_NAME = 'pulsecord-ui.sig.json';

export function uiSignedMessage(appVersion, files) {
  const lines = Object.keys(files)
    .sort()
    .map((k) => `${k}\t${files[k]}`);
  return Buffer.from(`PULSECORD-UI-V1\n${appVersion}\n${lines.join('\n')}`);
}
export function exeSignedMessage(kind, version, sha256) {
  return Buffer.from(`PULSECORD-EXE-V1\n${kind}\n${version}\n${sha256}`);
}

function loadKey() {
  if (!fs.existsSync(KEY_FILE)) return null;
  const j = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  return crypto.createPrivateKey({ key: Buffer.from(j.priv, 'base64'), format: 'der', type: 'pkcs8' });
}

function walk(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, acc);
    else if (e.isFile()) acc.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return acc;
}

const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function init() {
  if (fs.existsSync(KEY_FILE)) {
    const priv = loadKey();
    const pub = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).toString('base64');
    fs.writeFileSync(PUB_FILE, JSON.stringify({ v: 1, pub }, null, 2) + '\n');
    console.log(`Chave já existia (${KEY_FILE}); chave pública regravada em electron/release-public-key.json.`);
    return;
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(
    KEY_FILE,
    JSON.stringify({ v: 1, priv: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), createdAt: new Date().toISOString() }),
    { mode: 0o600 }
  );
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  fs.writeFileSync(PUB_FILE, JSON.stringify({ v: 1, pub }, null, 2) + '\n');
  console.log(`Chave criada em ${KEY_FILE}\nFAÇA BACKUP DESSE ARQUIVO (pendrive, gerenciador de senhas). Chave pública gravada no app.`);
}

function signUi() {
  const key = loadKey();
  if (!key) {
    console.warn(`[assinatura] sem chave em ${KEY_FILE}: a interface sai SEM assinatura (os apps não aceitam a atualização a quente dela). Rode "node scripts/release-signing.mjs init".`);
    return;
  }
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('client/dist não existe: rode o build do client antes.');
  const files = {};
  for (const rel of walk(DIST)) if (rel !== UI_SIG_NAME) files[rel] = sha256File(path.join(DIST, rel));
  const sig = crypto.sign(null, uiSignedMessage(pkg.version, files), key).toString('base64');
  fs.writeFileSync(path.join(DIST, UI_SIG_NAME), JSON.stringify({ v: 1, appVersion: pkg.version, files, sig }));
  console.log(`[assinatura] interface v${pkg.version} assinada (${Object.keys(files).length} arquivos).`);
}

function signExe() {
  const key = loadKey();
  if (!key) {
    console.warn(`[assinatura] sem chave em ${KEY_FILE}: os .exe saem SEM assinatura de atualização.`);
    return;
  }
  if (!fs.existsSync(DIST_APP)) return;
  // só assina o que saiu deste build: um .exe mais velho que o app empacotado agora é de outra versão
  const unpacked = path.join(DIST_APP, 'win-unpacked', `${pkg.build?.productName || 'Waver'}.exe`);
  const buildTime = fs.existsSync(unpacked) ? fs.statSync(unpacked).mtimeMs - 60_000 : 0;
  for (const name of fs.readdirSync(DIST_APP)) {
    if (!/^(Waver|PulseCord)-(Setup|Portable)\.exe$/i.test(name)) continue;
    const full = path.join(DIST_APP, name);
    if (fs.statSync(full).mtimeMs < buildTime) {
      fs.rmSync(`${full}.sig.json`, { force: true });
      console.warn(`[assinatura] ${name} é de um build antigo: não assinado (assinatura velha removida).`);
      continue;
    }
    const kind = /portable/i.test(name) ? 'portable' : 'setup';
    const sha256 = sha256File(full);
    const sig = crypto.sign(null, exeSignedMessage(kind, pkg.version, sha256), key).toString('base64');
    fs.writeFileSync(`${full}.sig.json`, JSON.stringify({ v: 1, kind, version: pkg.version, sha256, sig }));
    console.log(`[assinatura] ${name} v${pkg.version} assinado.`);
  }
}

const cmd = process.argv[2];
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (cmd === 'init') init();
    else if (cmd === 'sign-ui') signUi();
    else if (cmd === 'sign-exe') signExe();
    else console.log('uso: node scripts/release-signing.mjs init | sign-ui | sign-exe');
  } catch (err) {
    console.error('[assinatura]', err?.message || err);
    process.exit(1);
  }
}
