// Monta e inicia o script que aplica um .exe novo depois que o app fecha (sem depender do Electron: dá para testar).
//  - portátil: espera o app fechar, troca o Waver-Portable.exe (tentando até o arquivo ser liberado) e abre de novo;
//  - setup: espera o app fechar, roda o instalador em silêncio (/S) e abre o app instalado.
const fs = require('node:fs');
const { spawn } = require('node:child_process');

function buildApplyScript({ mode, src, dst = '', pid, logPath, fallback = '', label = '', setupArgs = '/S' }) {
  // texto entre aspas simples no PowerShell: nada é interpretado ($, `, etc.), só ' vira ''
  const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const head = `
$ErrorActionPreference = 'Continue'
$log = ${q(logPath)}
function Write-Log([string]$m) { try { Add-Content -LiteralPath $log -Value ((Get-Date -Format s) + ' ' + $m) -Encoding UTF8 } catch {} }
$src = ${q(src)}
# espera este app fechar de vez (o .exe em uso não pode ser trocado)
try { Wait-Process -Id ${Number(pid) || 0} -Timeout 40 -ErrorAction SilentlyContinue } catch {}
`;
  let psContent = '';
  if (mode === 'launch') {
    // só abre outro .exe depois que este app fechar (ex.: trocar do portátil para a versão instalada)
    psContent = `${head}
$dst = ${q(dst)}
Write-Log ('abrindo ' + $dst)
Start-Process -FilePath $dst
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`;
  } else if (mode === 'portable') {
    psContent = `${head}
$dst = ${q(dst)}
Write-Log ('atualizando o portátil: ' + $dst)
$ok = $false
# o portátil só solta o arquivo depois de limpar a pasta temporária dele: tenta por até 90 s
for ($i = 0; $i -lt 180; $i++) {
  try { Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop; $ok = $true; break } catch { Start-Sleep -Milliseconds 500 }
}
if ($ok) { Write-Log 'portátil substituído'; Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue }
else { Write-Log ('não foi possível substituir o portátil: ' + $Error[0]) }
Start-Process -FilePath $dst
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`;
  } else {
    psContent = `${head}
Write-Log ${q(label || 'atualizando pelo instalador')}
try {
  $p = Start-Process -FilePath $src -ArgumentList ${q(setupArgs)} -Wait -PassThru -ErrorAction Stop
  Write-Log ('instalador terminou com código ' + $p.ExitCode)
} catch { Write-Log ('o instalador não rodou: ' + $_) }
$candidates = @(
  [IO.Path]::Combine($env:LOCALAPPDATA, 'Programs', 'Waver', 'Waver.exe'),
  [IO.Path]::Combine($env:ProgramFiles, 'Waver', 'Waver.exe'),
  [IO.Path]::Combine($env:LOCALAPPDATA, 'Programs', 'PulseCord', 'PulseCord.exe'),
  [IO.Path]::Combine($env:LOCALAPPDATA, 'Programs', 'PulseCord', 'Waver.exe'),
  [IO.Path]::Combine($env:ProgramFiles, 'PulseCord', 'PulseCord.exe'),
  [IO.Path]::Combine($env:ProgramFiles, 'PulseCord', 'Waver.exe'),
  ${q(fallback)}
)
foreach ($c in $candidates) {
  if ($c -and (Test-Path -LiteralPath $c)) { Write-Log ('abrindo ' + $c); Start-Process -FilePath $c; break }
}
Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`;
  }

  return '\ufeff' + psContent; // com BOM: o PowerShell 5 lê como UTF-8 (caminhos com acento, ex.: C:\Users\João)
}

// Um filho direto do app é encerrado junto quando o app fecha (o script nem chegava a rodar). Pelo "start" do
// cmd o PowerShell fica independente. O caminho vai numa variável de ambiente, entre aspas, para que &, ^ ou
// espaços no nome da pasta do usuário não quebrem a linha de comando.
function startApplyScript(scriptPath, content, onError) {
  fs.writeFileSync(scriptPath, content, 'utf8');
  const child = spawn(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/c', 'start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%WAVER_APPLY_PS1%"'],
    {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
      env: { ...process.env, WAVER_APPLY_PS1: scriptPath },
    }
  );
  child.on('error', (err) => onError?.(err));
  child.unref();
  return child;
}

module.exports = { buildApplyScript, startApplyScript };
