// Gera o PulseCord para Windows ASSINADO digitalmente (some o aviso "Editor desconhecido" do SmartScreen).
//   npm run build:signed            portable + instalador
//   npm run build:signed -- portable
//
// Escolha UMA forma de assinar (variáveis de ambiente):
//  1) Certificado em token/nuvem (Certum SimplySign, SafeNet, DigiCert KeyLocker...), já aparecendo no
//     repositório de certificados do Windows:   PULSECORD_SIGN_THUMBPRINT=<impressão digital SHA1>
//  2) Arquivo .pfx (certificado antigo ou de teste):   CSC_LINK=C:\caminho\cert.pfx  CSC_KEY_PASSWORD=...
//  3) Azure Artifact Signing (Trusted Signing):  AZURE_SIGN_ENDPOINT, AZURE_SIGN_ACCOUNT, AZURE_SIGN_PROFILE,
//     AZURE_SIGN_PUBLISHER + AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
// Detalhes: docs/ASSINATURA-DIGITAL.md
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const env = process.env;
const TIMESTAMP = env.PULSECORD_SIGN_TIMESTAMP || 'http://time.certum.pl';

function findSigntool() {
  if (env.SIGNTOOL_PATH && fs.existsSync(env.SIGNTOOL_PATH)) return env.SIGNTOOL_PATH;
  const kits = path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  if (fs.existsSync(kits)) {
    const versions = fs.readdirSync(kits).filter((d) => /^10\./.test(d)).sort().reverse();
    for (const v of versions) {
      const p = path.join(kits, v, 'x64', 'signtool.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const win = { ...(pkg.build?.win || {}) };
let mode = '';
if (env.PULSECORD_SIGN_THUMBPRINT) {
  mode = 'thumbprint';
  const signtool = findSigntool();
  if (!signtool) {
    console.error('signtool.exe não encontrado. Instale o "Windows SDK" (só a parte "Signing Tools") ou defina SIGNTOOL_PATH.');
    process.exit(1);
  }
  const thumb = env.PULSECORD_SIGN_THUMBPRINT.replace(/\s/g, '');
  win.signtoolOptions = {
    ...(win.signtoolOptions || {}),
    signingHashAlgorithms: ['sha256'],
    // assina cada .exe/.dll com o certificado do token (o PIN é pedido pelo próprio driver do token)
    sign: async (cfg) => {
      execFileSync(
        signtool,
        ['sign', '/sha1', thumb, '/fd', 'sha256', '/tr', TIMESTAMP, '/td', 'sha256', '/d', 'PulseCord', cfg.path],
        { stdio: 'inherit' }
      );
    },
  };
} else if (env.AZURE_SIGN_ENDPOINT) {
  mode = 'azure';
  for (const k of ['AZURE_SIGN_ACCOUNT', 'AZURE_SIGN_PROFILE', 'AZURE_SIGN_PUBLISHER', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']) {
    if (!env[k]) {
      console.error(`Falta a variável ${k} para assinar com o Azure.`);
      process.exit(1);
    }
  }
  win.azureSignOptions = {
    endpoint: env.AZURE_SIGN_ENDPOINT,
    codeSigningAccountName: env.AZURE_SIGN_ACCOUNT,
    certificateProfileName: env.AZURE_SIGN_PROFILE,
    publisherName: env.AZURE_SIGN_PUBLISHER,
  };
} else if (env.CSC_LINK) {
  mode = 'pfx';
  win.signtoolOptions = { ...(win.signtoolOptions || {}), signingHashAlgorithms: ['sha256'], rfc3161TimeStampServer: TIMESTAMP };
} else {
  console.error(
    'Nenhum certificado configurado.\n' +
      'Defina PULSECORD_SIGN_THUMBPRINT (token/nuvem), CSC_LINK + CSC_KEY_PASSWORD (.pfx) ou as variáveis AZURE_SIGN_*.\n' +
      'Veja docs/ASSINATURA-DIGITAL.md.'
  );
  process.exit(1);
}

const wanted = process.argv.slice(2).filter((a) => ['portable', 'nsis'].includes(a));
const targets = wanted.length ? wanted : ['nsis', 'portable'];
console.log(`Assinando com: ${mode} | alvos: ${targets.join(', ')}`);

const { build, Platform } = await import('electron-builder');
await build({
  targets: Platform.WINDOWS.createTarget(targets, 1 /* x64 */),
  config: { ...pkg.build, win: { ...win, target: targets.map((t) => ({ target: t, arch: ['x64'] })) } },
});

// confere a assinatura do que saiu
const outDir = path.join(root, pkg.build?.directories?.output || 'dist');
for (const f of ['PulseCord-Portable.exe', 'PulseCord-Setup.exe']) {
  const p = path.join(outDir, f);
  if (!fs.existsSync(p)) continue;
  try {
    const st = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${p.replace(/'/g, "''")}').Status`],
      { encoding: 'utf8' }
    ).trim();
    console.log(`${f}: assinatura ${st}`);
  } catch {}
}
