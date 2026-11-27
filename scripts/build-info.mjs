// Grava electron/build-info.json antes do electron-builder: a "identidade do motor" deste build.
// Uma atualização leve só é aplicada num app com o MESMO motor: mesma versão do Electron e mesmos binários
// auxiliares (electron/bin; os .exe compilados aqui contam pelo código-fonte). Mudou qualquer um = .exe completo. (node_modules vai dentro da atualização leve.)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
const binDir = path.join(root, 'electron', 'bin');
const bin = fs.existsSync(binDir)
  ? fs
      .readdirSync(binDir)
      .sort()
      .map((n) => {
        // os .exe compilados aqui (csc antigo, sem /deterministic) mudam de bytes a cada build mesmo sem mudar
        // nada: para eles vale o código-fonte (scripts/<nome>.cs); o resto (ex.: ViGEmClient.dll) vale pelos bytes
        const src = path.join(root, 'scripts', n.replace(/\.exe$/i, '.cs'));
        const useSrc = /\.exe$/i.test(n) && fs.existsSync(src);
        const data = fs.readFileSync(useSrc ? src : path.join(binDir, n));
        return `${n}:${useSrc ? 'src:' : ''}${crypto.createHash('sha256').update(data).digest('hex')}`;
      })
  : [];
const runtime = crypto.createHash('sha256').update(JSON.stringify({ v: 1, electron, bin })).digest('hex').slice(0, 32);
// sem data: o arquivo só muda quando o motor muda (senão toda versão pareceria mudar o processo principal)
fs.writeFileSync(path.join(root, 'electron', 'build-info.json'), JSON.stringify({ runtime, electron }, null, 2) + '\n');
console.log(`[build-info] runtime ${runtime} (Electron ${electron}, ${bin.length} binários)`);
