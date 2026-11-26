// Deixa na pasta do projeto só o Waver-Portable.exe mais recente (roda sozinho no fim dos builds do .exe).
//   - copia dist-app/Waver-Portable.exe para a raiz do projeto, se ele saiu deste build;
//   - apaga da raiz instaladores e cópias antigas (Waver-Setup.exe, PulseCord-*.exe, "Waver-Portable (1).exe"...);
//   - apaga de dist-app os .exe que ficaram de builds anteriores (e as assinaturas/blockmaps deles).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distApp = path.join(root, 'dist-app');
const PORTABLE = 'Waver-Portable.exe';

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const unpacked = path.join(distApp, 'win-unpacked', `${pkg.build?.productName || 'Waver'}.exe`);
if (!fs.existsSync(unpacked)) {
  console.warn('[pasta] dist-app/win-unpacked não existe: nada a organizar.');
  process.exit(0);
}
// tudo que saiu deste build é mais novo que o app empacotado (com folga de 1 min)
const buildTime = fs.statSync(unpacked).mtimeMs - 60_000;
const isFresh = (f) => fs.existsSync(f) && fs.statSync(f).mtimeMs >= buildTime;
const remove = (f, why) => {
  fs.rmSync(f, { force: true });
  console.log(`[pasta] removido ${path.relative(root, f)} (${why})`);
};

// 1) dist-app: tira os .exe de builds anteriores
for (const name of fs.readdirSync(distApp)) {
  const m = /^((?:Waver|PulseCord)-(?:Setup|Portable)\.exe)(\.sig\.json|\.blockmap)?$/i.exec(name);
  if (!m) continue;
  const exe = path.join(distApp, m[1]);
  if (!isFresh(exe)) remove(path.join(distApp, name), 'build antigo');
}
// latest.yml descreve o instalador; se não saiu deste build, aponta para um .exe que não existe mais
const latestYml = path.join(distApp, 'latest.yml');
if (fs.existsSync(latestYml) && !isFresh(latestYml)) remove(latestYml, 'build antigo');

// 2) raiz: só o portátil mais novo
const fresh = path.join(distApp, PORTABLE);
if (!isFresh(fresh)) {
  console.warn('[pasta] este build não gerou o portátil: a raiz do projeto ficou como estava.');
  process.exit(0);
}
for (const name of fs.readdirSync(root)) {
  if (/^(Waver|PulseCord).*\.exe$/i.test(name) && name !== PORTABLE) remove(path.join(root, name), 'versão antiga');
}
fs.copyFileSync(fresh, path.join(root, PORTABLE));
const mb = (fs.statSync(fresh).size / 1048576).toFixed(1);
console.log(`[pasta] ${PORTABLE} atualizado na pasta do projeto (${mb} MB).`);
