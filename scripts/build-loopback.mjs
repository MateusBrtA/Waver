import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const srcFile = path.join(__dirname, 'pulse-loopback.cs');
const outDir = path.join(rootDir, 'electron', 'bin');
const outExe = path.join(outDir, 'pulse-loopback.exe');

if (process.platform !== 'win32') {
  console.log('[Loopback] Plataforma não é Windows, pulando compilação.');
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });

const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];

const csc = cscCandidates.find((p) => fs.existsSync(p));
if (!csc) {
  console.warn('[Loopback] Aviso: csc.exe não encontrado, fallback do navegador será usado.');
  process.exit(0);
}

try {
  execFileSync(
    csc,
    ['/nologo', '/target:exe', '/platform:x64', '/optimize+', `/out:${outExe}`, srcFile],
    { stdio: 'pipe' }
  );
  console.log('[Loopback] Compilado electron/bin/pulse-loopback.exe com sucesso!');
} catch (err) {
  console.error('[Loopback] Falha ao compilar pulse-loopback.cs:', err.stdout?.toString() || err.message);
  process.exit(1);
}
