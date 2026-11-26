// Gera o pacote do servidor dedicado (Debian/Windows): dist-server/pulsecord-server-<versão>.tar.gz e .zip
//   node scripts/pack-server.mjs            inclui dist-app/PulseCord-Portable.exe (atualização automática dos amigos)
//   node scripts/pack-server.mjs --no-app   sem o exe (pacote pequeno)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withApp = !process.argv.includes('--no-app');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `pulsecord-server-${pkg.version}`;
const outDir = path.join(root, 'dist-server');
const stage = path.join(outDir, name);

if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
  console.error('client/dist não existe. Rode antes: npm run build:client');
  process.exit(1);
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

const LF_EXT = new Set(['.sh', '.service', '.nft', '.example', '.md', '.env']);
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ext = path.extname(src).toLowerCase();
  if (LF_EXT.has(ext)) {
    fs.writeFileSync(dest, fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n'));
  } else if (ext === '.ps1') {
    // Windows PowerShell 5.1 só lê acentos corretamente com BOM
    const txt = fs.readFileSync(src, 'utf8').replace(/^﻿/, '').replace(/\r?\n/g, '\r\n');
    fs.writeFileSync(dest, '﻿' + txt);
  } else if (ext === '.cmd') {
    fs.writeFileSync(dest, fs.readFileSync(src, 'utf8').replace(/\r?\n/g, '\r\n'));
  } else {
    fs.copyFileSync(src, dest);
  }
}
function copyDir(src, dest, skip = () => false) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (skip(e.name, s)) continue;
    if (e.isDirectory()) copyDir(s, d, skip);
    else if (e.isFile()) copyFile(s, d);
  }
}

// servidor (sem node_modules nem dados)
copyDir(path.join(root, 'server'), path.join(stage, 'server'), (n) => ['node_modules', 'data'].includes(n));
// interface web já compilada (servida pelo próprio servidor)
copyDir(path.join(root, 'client', 'dist'), path.join(stage, 'client', 'dist'));
// scripts de instalação
copyDir(path.join(root, 'deploy'), path.join(stage, 'deploy'));
copyFile(path.join(root, 'deploy', 'README-SERVIDOR.md'), path.join(stage, 'LEIA-ME.md'));
// package.json mínimo: o servidor lê só a versão
fs.writeFileSync(
  path.join(stage, 'package.json'),
  JSON.stringify({ name: 'pulsecord', version: pkg.version, private: true }, null, 2) + '\n'
);
// exe do app: o servidor oferece a atualização aos amigos
fs.mkdirSync(path.join(stage, 'dist-app'), { recursive: true });
const exe = path.join(root, 'dist-app', 'PulseCord-Portable.exe');
if (withApp && fs.existsSync(exe)) fs.copyFileSync(exe, path.join(stage, 'dist-app', 'PulseCord-Portable.exe'));

// compacta (tar do Windows 10+ / Linux)
const tgz = path.join(outDir, `${name}.tar.gz`);
const zip = path.join(outDir, `${name}.zip`);
fs.rmSync(tgz, { force: true });
fs.rmSync(zip, { force: true });
// no Windows usa o bsdtar do sistema (o tar do Git Bash entende "E:" como máquina remota); caminhos relativos
const tarBin =
  process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
execFileSync(tarBin, ['-czf', path.basename(tgz), name], { stdio: 'inherit', cwd: outDir });
try {
  execFileSync(tarBin, ['-a', '-cf', path.basename(zip), name], { stdio: 'inherit', cwd: outDir });
} catch {
  console.warn('(não foi possível gerar o .zip; use o .tar.gz)');
}
const mb = (f) => (fs.existsSync(f) ? (fs.statSync(f).size / 1048576).toFixed(1) + ' MB' : '-');
console.log(`\nPacote pronto:\n  ${tgz}  (${mb(tgz)})  -> Debian\n  ${zip}  (${mb(zip)})  -> Windows`);
