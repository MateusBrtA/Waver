import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

let cachedBlenderPath; // undefined = ainda não procurado, null = não encontrado
let cachedBlenderAt = 0;

function versionScore(p) {
  const m = String(p).match(/(\d+)\.(\d+)/);
  return m ? Number(m[1]) * 1000 + Number(m[2]) : 0;
}

function regQuery(key, value) {
  try {
    const args = ['query', key];
    if (value === null) args.push('/ve');
    else if (value) args.push('/v', value);
    return execFileSync('reg', args, {
      windowsHide: true,
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function steamLibraryDirs() {
  const roots = new Set();
  const hk = regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath').match(/SteamPath\s+REG_SZ\s+(.+)/i);
  if (hk) roots.add(hk[1].trim().replace(/\//g, '\\'));
  const lm = regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath').match(/InstallPath\s+REG_SZ\s+(.+)/i);
  if (lm) roots.add(lm[1].trim());
  roots.add('C:\\Program Files (x86)\\Steam');
  roots.add('C:\\Program Files\\Steam');

  const libs = new Set();
  for (const root of roots) {
    libs.add(root);
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const mm of vdf.matchAll(/"path"\s+"([^"]+)"/gi)) libs.add(mm[1].replace(/\\\\/g, '\\'));
    } catch {}
  }
  return [...libs];
}

/**
 * Localiza o Blender instalado: Program Files, Steam (todas as bibliotecas), Microsoft Store,
 * associação de arquivos .blend no registro e PATH. Pode ser forçado com PULSECORD_BLENDER_PATH.
 */
export function findBlenderBinary() {
  if (cachedBlenderPath !== undefined && Date.now() - cachedBlenderAt < 60 * 1000) {
    if (cachedBlenderPath === null || fs.existsSync(cachedBlenderPath)) return cachedBlenderPath;
  }
  cachedBlenderPath = locateBlenderUncached();
  cachedBlenderAt = Date.now();
  return cachedBlenderPath;
}

function locateBlenderUncached() {
  const envPath = process.env.PULSECORD_BLENDER_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  if (process.platform === 'win32') {
    const candidates = [];
    const addVersionDirs = (base) => {
      try {
        if (!fs.existsSync(base)) return;
        for (const d of fs.readdirSync(base, { withFileTypes: true })) {
          if (d.isDirectory()) candidates.push(path.join(base, d.name, 'blender.exe'));
        }
      } catch {}
    };
    for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files']) {
      if (pf) addVersionDirs(path.join(pf, 'Blender Foundation'));
    }
    if (process.env.LOCALAPPDATA) addVersionDirs(path.join(process.env.LOCALAPPDATA, 'Programs', 'Blender Foundation'));
    // Steam (instalação muito comum)
    for (const lib of steamLibraryDirs()) {
      candidates.push(path.join(lib, 'steamapps', 'common', 'Blender', 'blender.exe'));
    }
    // Associação de arquivos .blend no registro (cobre MSI e versões portáteis registradas)
    for (const key of ['HKCR\\blendfile\\shell\\open\\command', 'HKCU\\Software\\Classes\\blendfile\\shell\\open\\command']) {
      const mm = regQuery(key, null).match(/REG_SZ\s+"?([^"\r\n]+?blender(?:-launcher)?\.exe)"?/i);
      if (mm) candidates.push(mm[1].replace(/blender-launcher\.exe$/i, 'blender.exe'));
    }
    // Microsoft Store (alias de execução)
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'blender.exe'));
    }
    for (const d of (process.env.PATH || '').split(';').filter(Boolean)) {
      candidates.push(path.join(d, 'blender.exe'));
    }

    const found = [...new Set(candidates)].filter((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
    if (found.length === 0) return null;
    found.sort((a, b) => versionScore(b) - versionScore(a));
    return found[0];
  }

  const unixCandidates = [
    '/Applications/Blender.app/Contents/MacOS/Blender',
    '/snap/bin/blender',
    '/usr/bin/blender',
    '/usr/local/bin/blender',
  ];
  for (const d of (process.env.PATH || '').split(':').filter(Boolean)) unixCandidates.push(path.join(d, 'blender'));
  return unixCandidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Pure Node.js binary parser for Blender .blend files (supports both raw and gzip-compressed .blend!).
 * Extracts Blender version, architecture, scene/object/mesh/material counts, and readable block ID names.
 */
export function inspectBlendMetadata(blendFilePath) {
  let raw = fs.readFileSync(blendFilePath);
  if (raw.length < 12) throw new Error('Arquivo .blend inválido ou corrompido.');

  let compressed = false;
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    compressed = true;
    raw = zlib.gunzipSync(raw);
  }

  const magic = raw.subarray(0, 7).toString('ascii');
  if (magic !== 'BLENDER') {
    throw new Error('Cabeçalho BLENDER não encontrado neste arquivo.');
  }

  const pointerSize = raw[7] === 0x2d ? 8 : 4; // '-' = 64-bit, '_' = 32-bit
  const littleEndian = raw[8] === 0x76; // 'v' = little endian, 'V' = big endian
  const verDigits = raw.subarray(9, 12).toString('ascii');
  const major = Number(verDigits[0]) || 0;
  const minor = Number(verDigits.slice(1)) || 0;
  const headerSize = 16 + pointerSize; // FileBlock header = 4B code + 4B size + pointer + 4B SDNA + 4B count

  const counts = {
    scenes: 0,
    objects: 0,
    meshes: 0,
    materials: 0,
    cameras: 0,
    lights: 0,
    armatures: 0,
  };
  const objectNames = [];
  const meshNames = [];
  const materialNames = [];

  const readUInt32 = (off) => (littleEndian ? raw.readUInt32LE(off) : raw.readUInt32BE(off));

  let offset = 12;
  let safety = 0;
  while (offset + headerSize <= raw.length && safety < 50000) {
    safety++;
    const code = raw.subarray(offset, offset + 4).toString('ascii').replace(/\0/g, '');
    const size = readUInt32(offset + 4);
    const bodyOff = offset + headerSize;

    if (code === 'ENDB') break;

    if (code === 'SC') counts.scenes++;
    else if (code === 'OB') counts.objects++;
    else if (code === 'ME') counts.meshes++;
    else if (code === 'MA') counts.materials++;
    else if (code === 'CA') counts.cameras++;
    else if (code === 'LA') counts.lights++;
    else if (code === 'AR') counts.armatures++;

    // Extract ID.name (starts inside ID struct after pointer fields; scan first 120 bytes for matching code prefix e.g. "OBCube")
    if (['OB', 'ME', 'MA', 'SC'].includes(code) && bodyOff + 16 < raw.length && size >= 16) {
      const scanEnd = Math.min(raw.length, bodyOff + Math.min(size, 128));
      const slice = raw.subarray(bodyOff, scanEnd);
      const prefix = Buffer.from(code, 'ascii');
      const idx = slice.indexOf(prefix);
      if (idx !== -1 && idx + 2 < slice.length) {
        let nameEnd = idx + 2;
        while (nameEnd < slice.length && slice[nameEnd] !== 0 && nameEnd - (idx + 2) < 64) nameEnd++;
        const cleanName = slice
          .subarray(idx + 2, nameEnd)
          .toString('utf8')
          .replace(/[^\x20-\x7EÀ-ÿ]/g, '')
          .trim();
        if (cleanName) {
          if (code === 'OB' && objectNames.length < 30) objectNames.push(cleanName);
          if (code === 'ME' && meshNames.length < 30) meshNames.push(cleanName);
          if (code === 'MA' && materialNames.length < 30) materialNames.push(cleanName);
        }
      }
    }

    if (size > raw.length) break;
    offset = bodyOff + size;
  }

  return {
    version: `${major}.${minor}`,
    pointerBits: pointerSize * 8,
    compressed,
    counts,
    objectNames,
    meshNames,
    materialNames,
  };
}

// Script de exportação: caminho de saída vem por argv (aspas/acentos no caminho não quebram nada)
// e as texturas (empacotadas ou externas) vão embutidas no GLB.
const EXPORT_SCRIPT = [
  'import bpy, sys',
  'argv = sys.argv[sys.argv.index("--") + 1:]',
  'out = argv[0]',
  'try:',
  '    bpy.ops.file.make_paths_absolute()',
  'except Exception:',
  '    pass',
  'variants = [',
  '    dict(export_apply=True, export_image_format="AUTO", export_yup=True, export_animations=True),',
  '    dict(export_apply=True, export_yup=True),',
  '    dict(),',
  ']',
  'err = None',
  'for extra in variants:',
  '    try:',
  '        kw = dict(filepath=out, export_format="GLB")',
  '        kw.update(extra)',
  '        bpy.ops.export_scene.gltf(**kw)',
  '        err = None',
  '        break',
  '    except TypeError as e:',
  '        err = e',
  '    except Exception as e:',
  '        err = e',
  '        break',
  'if err is not None:',
  '    print("PULSECORD_EXPORT_ERROR", err)',
  '    sys.exit(3)',
  '',
].join('\n');

/**
 * Converte .blend -> .glb usando o Blender instalado (modo headless).
 */
export function convertBlendToGlb(blendFilePath, outputGlbPath) {
  return new Promise((resolve, reject) => {
    const blender = findBlenderBinary();
    if (!blender) return reject(new Error('BLENDER_NOT_INSTALLED'));

    fs.mkdirSync(path.dirname(outputGlbPath), { recursive: true });
    const scriptPath = path.join(os.tmpdir(), `pulsecord-blend-export-${process.pid}.py`);
    try {
      fs.writeFileSync(scriptPath, EXPORT_SCRIPT, 'utf8');
    } catch (e) {
      return reject(e);
    }

    execFile(
      blender,
      ['--background', '--factory-startup', '--disable-autoexec', blendFilePath, '--python', scriptPath, '--', outputGlbPath],
      { timeout: 180000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err || !fs.existsSync(outputGlbPath) || fs.statSync(outputGlbPath).size === 0) {
          const text = `${stdout || ''}\n${stderr || ''}`;
          const line =
            text.split('\n').find((l) => /PULSECORD_EXPORT_ERROR|Error:/i.test(l)) ||
            err?.message ||
            'Falha ao converter arquivo .blend';
          return reject(new Error(String(line).trim().slice(0, 240)));
        }
        resolve(outputGlbPath);
      }
    );
  });
}
