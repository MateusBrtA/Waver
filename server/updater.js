import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function walkRelFiles(baseDir, curDir = baseDir, acc = []) {
  if (!baseDir || !fs.existsSync(curDir)) return acc;
  for (const entry of fs.readdirSync(curDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(curDir, entry.name);
    if (entry.isDirectory()) {
      walkRelFiles(baseDir, full, acc);
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, full).replace(/\\/g, '/');
      acc.push({ rel, full });
    }
  }
  return acc;
}

export function createUpdateHelper({ appVersion, clientDistDir, downloadsDir, updatesDir }) {
  let cachedUiHash = null;
  let cachedUiBundleGz = null;

  function computeUiHash() {
    if (!clientDistDir || !fs.existsSync(clientDistDir)) return '';
    const files = walkRelFiles(clientDistDir);
    if (files.length === 0) return '';
    const h = crypto.createHash('sha256');
    for (const f of files) {
      h.update(f.rel);
      h.update(fs.readFileSync(f.full));
    }
    cachedUiHash = h.digest('hex').slice(0, 16);
    return cachedUiHash;
  }

  function getUiBundleBuffer() {
    const hash = cachedUiHash || computeUiHash();
    if (cachedUiBundleGz) return { hash, buffer: cachedUiBundleGz };
    if (!clientDistDir || !fs.existsSync(clientDistDir)) return null;

    const files = walkRelFiles(clientDistDir);
    const map = {};
    for (const f of files) {
      map[f.rel] = fs.readFileSync(f.full).toString('base64');
    }
    const json = JSON.stringify({
      appVersion,
      uiHash: hash,
      files: map,
      builtAt: Date.now(),
    });
    cachedUiBundleGz = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 6 });
    return { hash, buffer: cachedUiBundleGz };
  }

  function findInstallerMeta(kind = 'any') {
    const names = kind === 'portable' ? ['PulseCord-Portable.exe', 'PulseCord-Setup.exe'] : ['PulseCord-Setup.exe', 'PulseCord-Portable.exe'];
    const candidates = [];
    if (updatesDir && fs.existsSync(updatesDir)) {
      for (const name of names) {
        candidates.push(path.join(updatesDir, name));
      }
      // Also accept any uploaded .exe in updatesDir
      try {
        for (const entry of fs.readdirSync(updatesDir)) {
          if (entry.toLowerCase().endsWith('.exe')) candidates.push(path.join(updatesDir, entry));
        }
      } catch {}
    }
    if (downloadsDir) {
      const local = [];
      for (const name of names) {
        local.push(path.join(downloadsDir, name));
        local.push(path.join(downloadsDir, '..', name));
      }
      // Sem preferência (clientes antigos não dizem se são portable): o .exe mais novo é a versão atual,
      // então um Setup.exe velho esquecido na pasta não ganha de um portable recém-gerado.
      if (kind !== 'portable') {
        const mtime = (f) => {
          try {
            return fs.statSync(f).mtimeMs;
          } catch {
            return -1;
          }
        };
        local.sort((x, y) => mtime(y) - mtime(x));
      }
      candidates.push(...local);
    }

    for (const p of candidates) {
      try {
        if (p && fs.existsSync(p)) {
          const stat = fs.statSync(p);
          const customMetaFile = updatesDir ? path.join(updatesDir, 'release-meta.json') : '';
          let releaseMeta = null;
          // release-meta.json só descreve o arquivo publicado em updatesDir
          const inUpdatesDir = updatesDir && path.resolve(path.dirname(p)) === path.resolve(updatesDir);
          if (inUpdatesDir && customMetaFile && fs.existsSync(customMetaFile)) {
            try {
              releaseMeta = JSON.parse(fs.readFileSync(customMetaFile, 'utf8'));
            } catch {}
          }
          return {
            path: p,
            name: path.basename(p),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            version: releaseMeta?.version || appVersion,
            sha256: releaseMeta?.sha256 || '',
            notes: releaseMeta?.notes || 'Atualização do servidor Host pronta para instalar sem perder dados.',
          };
        }
      } catch {}
    }
    return null;
  }

  function getManifest() {
    const uiHash = computeUiHash();
    const inst = findInstallerMeta();
    return {
      version: inst?.version || appVersion,
      serverAppVersion: appVersion,
      uiHash,
      hasUiBundle: Boolean(uiHash),
      hasInstaller: Boolean(inst),
      installerName: inst?.name || null,
      installerSize: inst?.size || 0,
      installerSha256: inst?.sha256 || '',
      releaseNotes: inst?.notes || 'Interface e recursos atualizados do PulseCord.',
      updatedAt: inst?.mtimeMs || Date.now(),
    };
  }

  function savePublishedInstaller(tempPath, originalName, versionLabel, notes) {
    if (!updatesDir) throw new Error('Diretório de atualizações não configurado.');
    fs.mkdirSync(updatesDir, { recursive: true });
    const isPortable = /portable/i.test(originalName || '');
    const targetName = isPortable ? 'PulseCord-Portable.exe' : 'PulseCord-Setup.exe';
    const targetPath = path.join(updatesDir, targetName);

    // Compute SHA-256 of uploaded installer
    const buf = fs.readFileSync(tempPath);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    fs.copyFileSync(tempPath, targetPath);
    try { fs.unlinkSync(tempPath); } catch {}

    fs.writeFileSync(
      path.join(updatesDir, 'release-meta.json'),
      JSON.stringify(
        {
          version: versionLabel || appVersion,
          sha256,
          notes: notes || 'Nova versão publicada pelo Host para atualização automática.',
          publishedAt: Date.now(),
        },
        null,
        2
      ),
      'utf8'
    );
    return getManifest();
  }

  return {
    getManifest,
    getUiBundleBuffer,
    findInstallerMeta,
    savePublishedInstaller,
  };
}
