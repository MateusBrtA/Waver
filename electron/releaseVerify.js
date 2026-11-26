// Confere a assinatura das atualizações (interface e .exe) com a chave pública embutida no app.
// Sem assinatura válida de quem publica o PulseCord, nenhuma atualização vinda de servidor é aplicada.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UI_SIG_NAME = 'pulsecord-ui.sig.json';

function loadPublicKey() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'release-public-key.json'), 'utf8'));
    const k = crypto.createPublicKey({ key: Buffer.from(String(j.pub), 'base64'), format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ed25519' ? k : null;
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = String(a || '0').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function uiSignedMessage(appVersion, files) {
  const lines = Object.keys(files)
    .sort()
    .map((k) => `${k}\t${files[k]}`);
  return Buffer.from(`PULSECORD-UI-V1\n${appVersion}\n${lines.join('\n')}`);
}
function exeSignedMessage(kind, version, sha256) {
  return Buffer.from(`PULSECORD-EXE-V1\n${kind}\n${version}\n${sha256}`);
}

const NOT_SIGNED =
  'Esta atualização não tem a assinatura oficial do PulseCord e foi recusada (proteção contra servidor malicioso). Instale a versão nova manualmente.';

/**
 * Pacote de interface: `files` = { caminho: base64 }. Confere assinatura, versão (igual à do app) e o hash de
 * CADA arquivo recebido; arquivo a mais ou a menos = recusado.
 */
function verifyUiBundle(files, appVersion) {
  const key = loadPublicKey();
  if (!key) throw new Error(NOT_SIGNED);
  let sig;
  try {
    sig = JSON.parse(Buffer.from(String(files[UI_SIG_NAME] || ''), 'base64').toString('utf8'));
  } catch {
    throw new Error(NOT_SIGNED);
  }
  if (!sig || sig.v !== 1 || typeof sig.sig !== 'string' || !sig.files || typeof sig.files !== 'object') throw new Error(NOT_SIGNED);
  if (String(sig.appVersion) !== String(appVersion)) throw new Error('Pacote de interface é de outra versão do app.');
  if (!crypto.verify(null, uiSignedMessage(String(sig.appVersion), sig.files), key, Buffer.from(sig.sig, 'base64'))) {
    throw new Error(NOT_SIGNED);
  }
  const received = Object.keys(files).filter((k) => k !== UI_SIG_NAME).sort();
  const expected = Object.keys(sig.files).sort();
  if (received.join('\n') !== expected.join('\n')) throw new Error('Pacote de interface não confere com a assinatura.');
  for (const rel of received) {
    const h = crypto.createHash('sha256').update(Buffer.from(String(files[rel]), 'base64')).digest('hex');
    if (h !== sig.files[rel]) throw new Error('Pacote de interface foi alterado (hash não confere).');
  }
  return true;
}

/** Cabeçalho X-PulseCord-Signature (base64 de JSON). Devolve { kind, version, sha256 } se válido e mais novo. */
function verifyInstallerSignature(headerB64, currentVersion) {
  const key = loadPublicKey();
  if (!key || !headerB64) throw new Error(NOT_SIGNED);
  let sig;
  try {
    sig = JSON.parse(Buffer.from(String(headerB64), 'base64').toString('utf8'));
  } catch {
    throw new Error(NOT_SIGNED);
  }
  if (!sig || sig.v !== 1 || !['portable', 'setup'].includes(sig.kind) || !/^[a-f0-9]{64}$/.test(String(sig.sha256))) {
    throw new Error(NOT_SIGNED);
  }
  if (!crypto.verify(null, exeSignedMessage(sig.kind, String(sig.version), sig.sha256), key, Buffer.from(String(sig.sig), 'base64'))) {
    throw new Error(NOT_SIGNED);
  }
  if (compareVersions(sig.version, currentVersion) <= 0) {
    throw new Error(`A versão oferecida (${sig.version}) não é mais nova que a sua (${currentVersion}).`);
  }
  return { kind: sig.kind, version: String(sig.version), sha256: sig.sha256 };
}

module.exports = { verifyUiBundle, verifyInstallerSignature, compareVersions, UI_SIG_NAME, hasReleaseKey: () => Boolean(loadPublicKey()) };
