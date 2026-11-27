# Waver - servidor dedicado no Windows (sem abrir o app).
#
#   .\Iniciar-Servidor.ps1                      inicia na porta 3000 (IPv6 + IPv4)
#   .\Iniciar-Servidor.ps1 -Porta 4000
#   .\Iniciar-Servidor.ps1 -AbrirFirewall       cria a regra de entrada no Firewall do Windows (pede administrador)
#   .\Iniciar-Servidor.ps1 -IniciarComWindows   registra uma tarefa que inicia o servidor junto com o Windows
#   .\Iniciar-Servidor.ps1 -RemoverInicio       remove essa tarefa
param(
  [int]$Porta = 0,
  [string]$Dados = '',
  [switch]$AbrirFirewall,
  [switch]$IniciarComWindows,
  [switch]$RemoverInicio
)
$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Servidor = Join-Path $Raiz 'server'
$EnvFile = Join-Path $PSScriptRoot 'pulsecord.env'
if (-not $Dados) { $Dados = Join-Path $Raiz 'data' }

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Porta: parâmetro > pulsecord.env > 3000
if ($Porta -le 0) {
  $Porta = 3000
  if (Test-Path $EnvFile) {
    $linha = Get-Content $EnvFile | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)' } | Select-Object -First 1
    if ($linha -match '(\d+)') { $Porta = [int]$Matches[1] }
  }
}

if ($RemoverInicio) {
  if (-not (Test-Admin)) { throw 'Rode como administrador para remover a tarefa.' }
  Unregister-ScheduledTask -TaskName 'PulseCord Server' -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host 'Tarefa "PulseCord Server" removida.'
  return
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js não encontrado. Instale a versão LTS (20 ou mais nova):' -ForegroundColor Yellow
  Write-Host '  winget install OpenJS.NodeJS.LTS'
  exit 1
}
$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) { throw "Node.js $major é antigo demais; instale a versão 20 ou mais nova (winget install OpenJS.NodeJS.LTS)." }

if (-not (Test-Path (Join-Path $Servidor 'node_modules'))) {
  Write-Host 'Instalando dependências do servidor (só na primeira vez)...'
  Push-Location $Servidor
  try {
    if (Test-Path 'package-lock.json') { & npm ci --omit=dev --no-audit --no-fund } else { & npm install --omit=dev --no-audit --no-fund }
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as dependências.' }
  } finally { Pop-Location }
}

if ($AbrirFirewall) {
  if (-not (Test-Admin)) { throw 'Rode como administrador para criar a regra do firewall.' }
  Remove-NetFirewallRule -DisplayName "PulseCord Server TCP $Porta" -ErrorAction SilentlyContinue
  # a regra vale para IPv4 e IPv6
  New-NetFirewallRule -DisplayName "PulseCord Server TCP $Porta" -Direction Inbound -Protocol TCP -LocalPort $Porta -Action Allow -Profile Any | Out-Null
  Write-Host "Firewall: porta TCP $Porta liberada (entrada, IPv4 e IPv6)."
  # SFU ligado no pulsecord.env: libera também a faixa de mídia (UDP, e TCP para redes que bloqueiam UDP)
  $sfuMin = 40000; $sfuMax = 40999; $sfuOn = $false
  if (Test-Path $EnvFile) {
    foreach ($l in Get-Content $EnvFile) {
      if ($l -match '^\s*PULSECORD_SFU\s*=\s*(1|on|true|auto)\s*$') { $sfuOn = $true }
      if ($l -match '^\s*PULSECORD_SFU_RTC_MIN_PORT\s*=\s*(\d+)') { $sfuMin = [int]$Matches[1] }
      if ($l -match '^\s*PULSECORD_SFU_RTC_MAX_PORT\s*=\s*(\d+)') { $sfuMax = [int]$Matches[1] }
    }
  }
  if ($sfuOn) {
    foreach ($proto in 'UDP', 'TCP') {
      Remove-NetFirewallRule -DisplayName "PulseCord SFU $proto" -ErrorAction SilentlyContinue
      New-NetFirewallRule -DisplayName "PulseCord SFU $proto" -Direction Inbound -Protocol $proto -LocalPort "$sfuMin-$sfuMax" -Action Allow -Profile Any | Out-Null
    }
    Write-Host "Firewall: SFU liberado em UDP/TCP $sfuMin-$sfuMax (entrada, IPv4 e IPv6)."
  }
}

$nodeArgs = @()
if (Test-Path $EnvFile) { $nodeArgs += "--env-file=$EnvFile" }
# launch.js escolhe a versão (a instalada ou uma baixada pela atualização automática) e reinicia ao atualizar
$nodeArgs += @((Join-Path $Servidor 'launch.js'), '--port', "$Porta", '--data', $Dados)

if ($IniciarComWindows) {
  if (-not (Test-Admin)) { throw 'Rode como administrador para registrar o início automático.' }
  $acao = New-ScheduledTaskAction -Execute $node.Source -Argument (($nodeArgs | ForEach-Object { '"' + $_ + '"' }) -join ' ') -WorkingDirectory $Servidor
  $gatilho = New-ScheduledTaskTrigger -AtStartup
  $config = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName 'PulseCord Server' -Action $acao -Trigger $gatilho -Settings $config -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
  Start-ScheduledTask -TaskName 'PulseCord Server'
  Write-Host 'O servidor agora inicia junto com o Windows (tarefa "PulseCord Server").'
  Write-Host "Código do dono: veja $Dados\owner-code.txt"
  return
}

Write-Host "Iniciando Waver na porta $Porta (Ctrl+C para parar)..."
Push-Location $Servidor
try { & node @nodeArgs } finally { Pop-Location }
