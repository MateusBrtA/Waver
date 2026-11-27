// Gera a atualização leve da release (dist-app/waver-app.pack + waver-app.json assinado) a partir do app.asar
// que o electron-builder acabou de montar (é exatamente o código que vai dentro do .exe). Ver electron/appPack.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const appPack = require('../electron/appPack.js');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const KEY_FILE = process.env.PULSECORD_RELEASE_KEY || path.join(os.homedir(), '.pulsecord-release', 'release-ed25519.json');

const asarPath = process.argv[2] || path.join(root, 'dist-app', 'win-unpacked', 'resources', 'app.asar');
if (!fs.existsSync(asarPath)) {
  console.error(`[app-pack] não achei ${asarPath} (rode o electron-builder antes).`);
  process.exit(1);
}
if (!fs.existsSync(KEY_FILE)) {
  console.warn(`[app-pack] sem chave em ${KEY_FILE}: release sem atualização leve.`);
  process.exit(0);
}
const key = crypto.createPrivateKey({ key: Buffer.from(JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')).priv, 'base64'), format: 'der', type: 'pkcs8' });

// lista de ARQUIVOS pelo cabeçalho do asar (pastas e links ficam de fora sem precisar adivinhar)
const all = [];
// binário nativo não pode vir pela atualização leve: com um, esta release fica sem pacote (vai pelo .exe)
const natives = [];
(function walk(o, pre) {
  for (const [k, v] of Object.entries(o.files || {})) {
    const r = pre ? `${pre}/${k}` : k;
    if (v.files) walk(v, r);
    else if (v.link) continue;
    else {
      all.push(r);
      if (v.unpacked || /\.(node|exe|dll)$/i.test(k)) natives.push(r);
    }
  }
})(asar.getRawHeader(asarPath).header, '');
if (natives.length) {
  console.warn(`[app-pack] o app tem binários nativos (${natives.slice(0, 3).join(', ')}): release sem atualização leve.`);
  for (const n of [appPack.PACK_NAME, appPack.MANIFEST_NAME]) fs.rmSync(path.join(root, 'dist-app', n), { force: true });
  process.exit(0);
}
const files = [];
for (const rel of all) {
  if (!appPack.isSafeRel(rel)) continue;
  // no Windows o @electron/asar só acha caminho aninhado com o separador do sistema. Erro aqui = pacote
  // incompleto (um app sem a interface abriria em branco): para o build em vez de pular o arquivo.
  const buf = asar.extractFile(asarPath, rel.split('/').join(path.sep));
  if (!Buffer.isBuffer(buf)) throw new Error(`[app-pack] não consegui ler ${rel} do app.asar`);
  files.push([rel, buf]);
}
for (const must of ['package.json', 'electron/main.js', 'electron/preload.js', 'server/index.js', 'client/dist/index.html']) {
  if (!files.some(([rel]) => rel === must)) throw new Error(`[app-pack] ${must} ficou fora do pacote`);
}
files.sort((a, b) => a[0].localeCompare(b[0]));

const info = JSON.parse(asar.extractFile(asarPath, 'electron/build-info.json').toString('utf8'));
const asarPkg = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
if (asarPkg.version !== pkg.version) {
  console.error(`[app-pack] o app.asar é da versão ${asarPkg.version}, não da ${pkg.version}.`);
  process.exit(1);
}

const chunks = [];
const index = {};
let offset = 0;
for (const [rel, buf] of files) {
  const c = zlib.brotliCompressSync(buf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });
  index[rel] = { h: appPack.sha256(buf), s: buf.length, o: offset, c: c.length };
  chunks.push(c);
  offset += c.length;
}
const manifest = { v: 1, version: pkg.version, runtime: info.runtime, files: index };
manifest.sig = crypto.sign(null, appPack.manifestMessage(manifest), key).toString('base64');
appPack.verifyManifest(manifest, crypto.createPublicKey(key));

const outDir = path.join(root, 'dist-app');
fs.writeFileSync(path.join(outDir, appPack.PACK_NAME), Buffer.concat(chunks));
fs.writeFileSync(path.join(outDir, appPack.MANIFEST_NAME), JSON.stringify(manifest));
const raw = files.reduce((s, [, b]) => s + b.length, 0);
console.log(
  `[app-pack] ${files.length} arquivos, ${(raw / 1048576).toFixed(1)} MB -> ${(offset / 1048576).toFixed(2)} MB comprimido (runtime ${info.runtime}).`
);
