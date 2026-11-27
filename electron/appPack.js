// Atualização "leve" do Waver: só os arquivos que mudaram, sem baixar o .exe inteiro.
//
// O .exe traz o Electron (o motor, ~85 MB) e o código do app (~4 MB: electron/, server/, client/dist). Quase
// toda versão nova muda só o código. A release leva então, além do .exe:
//   waver-app.pack   todos os arquivos do código, cada um comprimido (brotli), um atrás do outro
//   waver-app.json   índice assinado: caminho -> sha256, tamanho e posição dentro do .pack
// O app compara com os arquivos que já tem e baixa (HTTP Range) só os pedaços que mudaram. Como o índice é
// sempre o da ÚLTIMA versão, quem está várias versões atrás baixa de uma vez só a diferença até a mais nova.
// As bibliotecas JS (node_modules, ~3,6 MB) também vão no pacote, então dependência nova chega pela atualização
// leve. Se o motor mudou (versão do Electron ou binários auxiliares de electron/bin), o índice diz outro
// "runtime" e o app usa o .exe completo, como antes.
//
// Os arquivos ficam em %APPDATA%\PulseCord\app-live\<versão>\ e o boot.js (dentro do .exe) só os usa se a
// assinatura (chave oficial embutida no .exe) e o sha256 de CADA arquivo conferirem. Sem isso, abre o código
// que veio no .exe.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_NAME = 'waver-app.json';
const PACK_NAME = 'waver-app.pack';
const MAX_FILES = 20000;

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
  const parts = rel.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) return false;
  // o código do app e as bibliotecas JS (node_modules). A chave pública e os binários ficam sempre os do .exe.
  if (!/^(electron|server|client\/dist|node_modules)\//.test(rel) && rel !== 'package.json') return false;
  if (/\.(node|exe|dll)$/i.test(rel)) return false;
  if (rel.startsWith('electron/bin/') || rel === 'electron/release-public-key.json') return false;
  return true;
}

/** Confere formato e assinatura do índice. Lança se algo não bater. */
function verifyManifest(m, publicKey) {
  if (!publicKey) throw new Error('Sem chave pública oficial.');
  if (!m || m.v !== 1 || typeof m.version !== 'string' || typeof m.runtime !== 'string' || typeof m.sig !== 'string') {
    throw new Error('Índice da atualização inválido.');
  }
  if (!m.files || typeof m.files !== 'object') throw new Error('Índice da atualização inválido.');
  const keys = Object.keys(m.files);
  if (keys.length === 0 || keys.length > MAX_FILES) throw new Error('Índice da atualização inválido.');
  for (const k of keys) {
    const f = m.files[k];
    if (!isSafeRel(k)) throw new Error(`Caminho não permitido na atualização: ${k}`);
    if (!f || !/^[a-f0-9]{64}$/.test(String(f.h)) || ![f.s, f.o, f.c].every((n) => Number.isSafeInteger(n) && n >= 0)) {
      throw new Error('Índice da atualização inválido.');
    }
  }
  if (!m.files['electron/main.js'] || !m.files['package.json']) throw new Error('Índice da atualização incompleto.');
  if (!crypto.verify(null, manifestMessage(m), publicKey, Buffer.from(m.sig, 'base64'))) {
    throw new Error('A atualização não tem a assinatura oficial do Waver.');
  }
  return true;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Confere se a pasta tem exatamente os arquivos do índice com os sha256 certos (feito a cada abertura antes de
 * usar a pasta: ~4 MB, poucos milissegundos).
 */
function verifyDir(dir, m) {
  for (const [rel, f] of Object.entries(m.files)) {
    const full = path.join(dir, ...rel.split('/'));
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      return false;
    }
    if (buf.length !== f.s || sha256(buf) !== f.h) return false;
  }
  return true;
}

function loadPublicKeyFrom(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const k = crypto.createPublicKey({ key: Buffer.from(String(j.pub), 'base64'), format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ed25519' ? k : null;
  } catch {
    return null;
  }
}

module.exports = { MANIFEST_NAME, PACK_NAME, manifestMessage, verifyManifest, verifyDir, isSafeRel, sha256, loadPublicKeyFrom };
