// Ponto de entrada do Waver empacotado. Decide qual código abrir:
//  - o que veio dentro do .exe (padrão), ou
//  - uma atualização leve já baixada (%APPDATA%\PulseCord\app-live\<versão>), se for mais nova que o .exe, feita
//    para este mesmo motor (Electron + bibliotecas) e com assinatura oficial e sha256 de todos os arquivos ok.
// Este arquivo, appPack.js, build-info.json e a chave pública vêm SEMPRE do .exe (nunca da pasta baixada).
'use strict';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function compareVersions(a, b) {
  const pa = String(a || '0').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function pickLiveApp() {
  if (!app.isPackaged || process.env.WAVER_NO_PATCH === '1') return null;
  const pack = require('./appPack');
  let runtime = '';
  try {
    runtime = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')).runtime || '';
  } catch {}
  const key = pack.loadPublicKeyFrom(path.join(__dirname, 'release-public-key.json'));
  if (!runtime || !key) return null;
  // mesma pasta de dados que o main.js usa (o app se chamava PulseCord)
  const root = path.join(app.getPath('appData'), 'PulseCord', 'app-live');
  let names = [];
  try {
    names = fs.readdirSync(root).filter((n) => /^\d+(\.\d+)*$/.test(n));
  } catch {
    return null;
  }
  names.sort((a, b) => compareVersions(b, a));
  const current = app.getVersion();
  for (const name of names) {
    if (compareVersions(name, current) <= 0) break;
    const dir = path.join(root, name);
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, pack.MANIFEST_NAME), 'utf8'));
      if (m.version !== name || m.runtime !== runtime) continue;
      pack.verifyManifest(m, key);
      if (!pack.verifyDir(dir, m)) continue;
      return { dir, version: m.version };
    } catch {}
  }
  return null;
}

let live = null;
try {
  live = pickLiveApp();
} catch {
  live = null;
}

if (live) {
  // a pasta baixada tem o app inteiro (código + node_modules): require/import resolvem lá dentro
  const packagedVersion = app.getVersion();
  const liveDir = live.dir;
  const origGetVersion = app.getVersion;
  app.getVersion = () => live.version;
  process.env.WAVER_LIVE_APP_DIR = liveDir;
  process.env.WAVER_PACKAGED_VERSION = packagedVersion;
  try {
    require(path.join(liveDir, 'electron', 'main.js'));
  } catch (err) {
    // o código novo nem carregou: abre o do .exe (e não tenta mais esta versão)
    console.error('[boot] atualização leve falhou ao abrir, usando a versão do .exe:', err);
    try {
      fs.writeFileSync(path.join(liveDir, 'broken.txt'), String(err?.stack || err));
      fs.rmSync(path.join(liveDir, 'waver-app.json'), { force: true });
    } catch {}
    app.getVersion = origGetVersion;
    delete process.env.WAVER_LIVE_APP_DIR;
    require('./main.js');
  }
} else {
  require('./main.js');
}
