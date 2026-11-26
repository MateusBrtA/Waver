// Publica a versão atual do Waver no GitHub Releases. Os apps instalados procuram a release nova sozinhos ao abrir
// (electron/githubUpdater.js), baixam em segundo plano e oferecem "Reiniciar e atualizar".
//
//   npm run release:github -- --dry-run             só confere tudo e mostra o que faria
//   npm run release:github                          publica (precisa do GitHub CLI "gh" logado)
//   npm run release:github -- --notes notas.md      usa estas notas (padrão: commits desde a última release)
//
// Antes: suba a versão em package.json, gere o .exe (npm run build:exe ou build:win) e faça push do commit.
// Confere antes de publicar:
//   - versão nova maior que a última release publicada, e a tag ainda não existe;
//   - cada .exe tem .sig.json válido com a chave oficial, da MESMA versão, tipo certo e SHA-256 do arquivo;
//   - o commit atual já está no GitHub (a tag aponta para ele).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const releaseVerify = require('../electron/releaseVerify.js');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const repo = pkg.pulsecordUpdate?.githubRepo;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const notesArg = args.includes('--notes') ? args[args.indexOf('--notes') + 1] : null;

const fail = (msg) => {
  console.error(`\n[release] ERRO: ${msg}`);
  process.exit(1);
};
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryRun = (cmd, a) => {
  try {
    return run(cmd, a);
  } catch {
    return null;
  }
};
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

if (!repo) fail('package.json não tem "pulsecordUpdate.githubRepo".');
if (!tryRun('gh', ['--version'])) fail('GitHub CLI (gh) não encontrado. Instale em https://cli.github.com e rode "gh auth login".');

// 1) versão nova
if (tryRun('gh', ['release', 'view', tag, '--repo', repo, '--json', 'tagName'])) fail(`a release ${tag} já existe. Suba a versão em package.json.`);
const latest = tryRun('gh', ['api', `repos/${repo}/releases/latest`, '--jq', '.tag_name']);
if (latest && releaseVerify.compareVersions(version, latest.replace(/^v/i, '')) <= 0) {
  fail(`a versão ${version} não é maior que a última publicada (${latest}). Os apps só atualizam para versão maior.`);
}

// 2) arquivos
const distApp = path.join(root, 'dist-app');
const files = [];
for (const [name, kind] of [
  ['Waver-Portable.exe', 'portable'],
  ['Waver-Setup.exe', 'setup'],
]) {
  const exe = path.join(distApp, name);
  if (!fs.existsSync(exe)) continue;
  const sigPath = `${exe}.sig.json`;
  if (!fs.existsSync(sigPath)) fail(`${name} sem ${name}.sig.json (gere com npm run build:exe).`);
  const sig = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
  try {
    releaseVerify.verifyInstallerSignatureObject(sig, '0.0.0');
  } catch (err) {
    fail(`assinatura de ${name} inválida: ${err.message}`);
  }
  if (sig.version !== version) fail(`${name} foi assinado como ${sig.version}, mas package.json diz ${version}. Gere o .exe de novo.`);
  if (sig.kind !== kind) fail(`${name}.sig.json é de outro tipo (${sig.kind}).`);
  if (sha256File(exe) !== sig.sha256) fail(`${name} não confere com a assinatura (arquivo trocado depois do build?).`);
  files.push(exe, sigPath);
}
if (!files.some((f) => f.endsWith('Waver-Portable.exe'))) fail('falta dist-app/Waver-Portable.exe desta versão (npm run build:exe).');
for (const ext of ['tar.gz', 'zip']) {
  const p = path.join(root, 'dist-server', `pulsecord-server-${version}.${ext}`);
  if (fs.existsSync(p)) files.push(p);
  else console.warn(`[release] aviso: sem dist-server/pulsecord-server-${version}.${ext} (gere com npm run pack:server).`);
}
if (!files.some((f) => f.endsWith('Waver-Setup.exe'))) console.warn('[release] aviso: sem o instalador (Waver-Setup.exe); use npm run build:win para publicar os dois.');

// 3) commit no GitHub
const head = run('git', ['rev-parse', 'HEAD']);
if (run('git', ['status', '--porcelain', '--untracked-files=no']).split('\n').some((l) => l && !l.endsWith('.claude/launch.json'))) {
  console.warn('[release] aviso: há alterações não commitadas; a release aponta para o último commit, não para elas.');
}
tryRun('git', ['fetch', '--quiet', 'origin']);
const onRemote = tryRun('git', ['branch', '-r', '--contains', head]);
if (!onRemote) fail(`o commit ${head.slice(0, 7)} ainda não está no GitHub. Faça "git push" antes.`);

// 4) notas
let notes = '';
if (notesArg) notes = fs.readFileSync(path.resolve(notesArg), 'utf8');
else {
  const prev = latest && tryRun('git', ['rev-parse', '--verify', '--quiet', `${latest}^{commit}`]) ? latest : null;
  const log = tryRun('git', ['log', '--no-merges', '--format=- %s', prev ? `${prev}..HEAD` : '-15']) || '';
  notes = `## Waver ${version}\n\n${log}\n\n` +
    'Quem já tem o Waver recebe esta versão sozinho: o app baixa em segundo plano, confere a assinatura e mostra "Reiniciar e atualizar".\n\n' +
    '- **Waver-Portable.exe**: não precisa instalar.\n' +
    (files.some((f) => f.endsWith('Waver-Setup.exe')) ? '- **Waver-Setup.exe**: instalador do Windows.\n' : '') +
    (files.some((f) => /pulsecord-server-/.test(f)) ? '- **pulsecord-server-*.tar.gz / .zip**: servidor dedicado (Linux/Windows), veja o README.\n' : '');
}

console.log(`[release] ${repo} ${tag} -> commit ${head.slice(0, 7)}`);
for (const f of files) console.log(`  + ${path.relative(root, f)} (${(fs.statSync(f).size / 1048576).toFixed(1)} MB)`);
console.log(`\n${notes}`);
if (dryRun) {
  console.log('[release] --dry-run: nada foi publicado.');
  process.exit(0);
}

const notesFile = path.join(os.tmpdir(), `pulsecord-release-notes-${Date.now()}.md`);
fs.writeFileSync(notesFile, notes);
try {
  execFileSync('gh', ['release', 'create', tag, ...files, '--repo', repo, '--target', head, '--title', `Waver ${version}`, '--notes-file', notesFile], {
    cwd: root,
    stdio: 'inherit',
  });
} finally {
  fs.rmSync(notesFile, { force: true });
}
console.log(`[release] publicada: https://github.com/${repo}/releases/tag/${tag}`);
