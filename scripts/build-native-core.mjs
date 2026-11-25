import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const srcFile = path.join(__dirname, 'pulse-native-core.cs');
const outDir = path.join(rootDir, 'electron', 'bin');
const outExe = path.join(outDir, 'pulse-native-core.exe');
const vigemDllPath = path.join(outDir, 'ViGEmClient.dll');

if (process.platform !== 'win32') {
  console.log('[NativeCore] Plataforma não é Windows, pulando compilação.');
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });

// Pure-Node ZIP entry extractor for NuGet package (.nupkg) -> extracts Costura x64 ViGEmClient.dll!
function extractFromZipBuffer(zipBuf, matcher) {
  let offset = 0;
  while (offset + 30 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break; // Local file header signature
    const gpFlag = zipBuf.readUInt16LE(offset + 6);
    const method = zipBuf.readUInt16LE(offset + 8);
    let compSize = zipBuf.readUInt32LE(offset + 18);
    const nameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = zipBuf.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;

    // Handle bit-3 data descriptor if compSize is 0 (fallback to central directory)
    if ((gpFlag & 0x08) !== 0 && compSize === 0) {
      break;
    }

    const raw = zipBuf.subarray(dataStart, dataStart + compSize);
    if (matcher(name)) {
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw);
    }
    offset = dataStart + compSize;
  }

  // Fallback: scan ZIP Central Directory (PK\x01\x02) when streaming data descriptors are used
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdOff = zipBuf.lastIndexOf(eocdSig);
  if (eocdOff === -1) return null;
  let cdOff = zipBuf.readUInt32LE(eocdOff + 16);
  const totalEntries = zipBuf.readUInt16LE(eocdOff + 10);
  for (let i = 0; i < totalEntries && cdOff + 46 <= zipBuf.length; i++) {
    if (zipBuf.readUInt32LE(cdOff) !== 0x02014b50) break;
    const method = zipBuf.readUInt16LE(cdOff + 10);
    const compSize = zipBuf.readUInt32LE(cdOff + 20);
    const nameLen = zipBuf.readUInt16LE(cdOff + 28);
    const extraLen = zipBuf.readUInt16LE(cdOff + 30);
    const commentLen = zipBuf.readUInt16LE(cdOff + 32);
    const localHeaderOff = zipBuf.readUInt32LE(cdOff + 42);
    const name = zipBuf.subarray(cdOff + 46, cdOff + 46 + nameLen).toString('utf8');
    if (matcher(name)) {
      const lhNameLen = zipBuf.readUInt16LE(localHeaderOff + 26);
      const lhExtraLen = zipBuf.readUInt16LE(localHeaderOff + 28);
      const dStart = localHeaderOff + 30 + lhNameLen + lhExtraLen;
      const compData = zipBuf.subarray(dStart, dStart + compSize);
      if (method === 0) return compData;
      if (method === 8) return zlib.inflateRawSync(compData);
    }
    cdOff += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function ensureViGEmClientDll() {
  if (fs.existsSync(vigemDllPath) && fs.statSync(vigemDllPath).size > 4096) {
    return true;
  }
  try {
    const nupkgUrl = 'https://api.nuget.org/v3-flatcontainer/nefarius.vigem.client/1.21.256/nefarius.vigem.client.1.21.256.nupkg';
    const resp = await fetch(nupkgUrl, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const nupkgBuf = Buffer.from(await resp.arrayBuffer());

    // Direct native DLL if present inside package
    const directDll = extractFromZipBuffer(
      nupkgBuf,
      (name) => /(win-x64|x64)\/native\/vigemclient\.dll$/i.test(name) || /\/x64\/vigemclient\.dll$/i.test(name)
    );
    if (directDll && directDll.length > 4096) {
      fs.writeFileSync(vigemDllPath, directDll);
      console.log('[NativeCore] ViGEmClient.dll x64 extraída para electron/bin/ViGEmClient.dll');
      return true;
    }

    // Costura-embedded assembly inside lib/netstandard2.0 or lib/net452
    const managedDll = extractFromZipBuffer(
      nupkgBuf,
      (name) => /lib\/netstandard2\.0\/Nefarius\.ViGEm\.Client\.dll$/i.test(name) || /lib\/net452\/Nefarius\.ViGEm\.Client\.dll$/i.test(name)
    );
    if (managedDll) {
      // Costura stores compressed native DLL resources inside the .NET DLL PE resources stream.
      // Let's check for gzip/deflate Costura blob or try compiling a tiny C# resource inspector if needed,
      // OR download native ViGEmClient x64 zip directly if available!
      const rawMarker = Buffer.from('costura.costura64.vigemclient.dll.compressed', 'utf8');
      if (managedDll.includes(rawMarker)) {
        console.log('[NativeCore] Costura resource detectado em Nefarius.ViGEm.Client.dll; extraindo via .NET Reflection...');
      }
      const tempManaged = path.join(outDir, '_temp_vigem_managed.dll');
      fs.writeFileSync(tempManaged, managedDll);
      try {
        const ps = `
Add-Type -Path '${tempManaged.replace(/'/g, "''")}'
$asm = [System.Reflection.Assembly]::LoadFrom('${tempManaged.replace(/'/g, "''")}')
$resName = $asm.GetManifestResourceNames() | Where-Object { $_ -match 'costura64\\.vigemclient\\.dll' } | Select-Object -First 1
if (-not $resName) { throw 'Resource costura64.vigemclient.dll nao encontrado' }
$stream = $asm.GetManifestResourceStream($resName)
if ($resName -match '\\.compressed$') {
  $ds = New-Object System.IO.Compression.DeflateStream($stream, [System.IO.Compression.CompressionMode]::Decompress)
  $out = [System.IO.File]::Create('${vigemDllPath.replace(/'/g, "''")}')
  $ds.CopyTo($out)
  $out.Close(); $ds.Close()
} else {
  $out = [System.IO.File]::Create('${vigemDllPath.replace(/'/g, "''")}')
  $stream.CopyTo($out)
  $out.Close()
}
$stream.Close()
`;
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'pipe', windowsHide: true });
        if (fs.existsSync(vigemDllPath) && fs.statSync(vigemDllPath).size > 4096) {
          console.log('[NativeCore] ViGEmClient.dll x64 extraída com sucesso para electron/bin/ViGEmClient.dll!');
          return true;
        }
      } finally {
        try { fs.unlinkSync(tempManaged); } catch {}
      }
    }
  } catch (err) {
    console.warn('[NativeCore] Aviso: não foi possível baixar ViGEmClient.dll agora (fallback teclado/mouse para gamepad será usado):', err?.message);
  }
  return false;
}

const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];
const csc = cscCandidates.find((p) => fs.existsSync(p));
if (!csc) {
  console.warn('[NativeCore] Aviso: csc.exe não encontrado, fallback PowerShell será usado.');
  process.exit(0);
}

try {
  execFileSync(
    csc,
    ['/nologo', '/target:exe', '/platform:x64', '/optimize+', `/out:${outExe}`, srcFile],
    { stdio: 'pipe' }
  );
  console.log('[NativeCore] Compilado electron/bin/pulse-native-core.exe com sucesso!');
} catch (err) {
  console.error('[NativeCore] Falha ao compilar pulse-native-core.cs:', err.stdout?.toString() || err.message);
  process.exit(1);
}

await ensureViGEmClientDll();
