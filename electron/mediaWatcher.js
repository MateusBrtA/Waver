// Lê o que está tocando no Windows (controle de mídia do sistema: Spotify, navegador, players).
// Um único PowerShell fica aberto e só escreve uma linha quando a música muda; sai sozinho se o app fechar.
const { spawn } = require('node:child_process');

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(5000); $task.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
if (-not $mgr) { [Console]::Out.WriteLine('UNSUPPORTED'); exit 0 }
$parentId = __PARENT_PID__
$last = $null
while ($true) {
  if ($parentId -gt 0 -and -not (Get-Process -Id $parentId -ErrorAction SilentlyContinue)) { exit 0 }
  $out = '-'
  $s = $mgr.GetCurrentSession()
  if ($s) {
    $pb = $s.GetPlaybackInfo()
    if ($pb -and $pb.PlaybackStatus -eq 4) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      if ($p -and $p.Title) { $out = (@{ title = $p.Title; artist = $p.Artist; app = $s.SourceAppUserModelId } | ConvertTo-Json -Compress) }
    }
  }
  if ($out -ne $last) { [Console]::Out.WriteLine($out); [Console]::Out.Flush(); $last = $out }
  Start-Sleep -Seconds 8
}
`;

class MediaWatcher {
  constructor(onChange) {
    this.onChange = onChange;
    this.proc = null;
    this.current = null;
    this.stopped = true;
    this.restartTimer = null;
    this.failures = 0;
  }

  start() {
    if (process.platform !== 'win32' || this.proc) return;
    this.stopped = false;
    const encoded = Buffer.from(PS_SCRIPT.replace('__PARENT_PID__', String(process.pid)), 'utf16le').toString('base64');
    let proc;
    try {
      proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
      );
    } catch {
      return;
    }
    this.proc = proc;
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        this.handleLine(line);
      }
    });
    proc.on('error', () => {});
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
      if (this.stopped) return;
      // caiu: tenta de novo com espera crescente (desiste depois de várias falhas)
      this.failures++;
      if (this.failures > 5) return;
      this.restartTimer = setTimeout(() => this.start(), Math.min(60000, 5000 * this.failures));
    });
  }

  handleLine(line) {
    if (!line) return;
    if (line === 'UNSUPPORTED') {
      this.stop();
      return;
    }
    let next = null;
    if (line !== '-') {
      try {
        const j = JSON.parse(line.replace(/^﻿/, ''));
        const app = String(j.app || '');
        // o próprio PulseCord (player de vídeo) não conta como "ouvindo"
        if (j.title && !/pulsecord|electron/i.test(app)) {
          next = {
            title: String(j.title).slice(0, 128),
            artist: String(j.artist || '').slice(0, 128),
            app: app.slice(0, 128),
          };
        }
      } catch {}
    }
    this.failures = 0;
    const changed = JSON.stringify(next) !== JSON.stringify(this.current);
    this.current = next;
    if (changed) this.onChange?.(next);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
    if (this.current) {
      this.current = null;
      this.onChange?.(null);
    }
  }
}

/** Nome amigável do app de onde vem a mídia. */
function mediaAppName(appId) {
  const a = String(appId || '').toLowerCase();
  if (a.includes('spotify')) return 'Spotify';
  if (a.includes('deezer')) return 'Deezer';
  if (a.includes('tidal')) return 'TIDAL';
  if (a.includes('applemusic') || a.includes('itunes')) return 'Apple Music';
  if (a.includes('youtube')) return 'YouTube Music';
  if (a.includes('zunemusic') || a.includes('media player')) return 'Media Player';
  if (a.includes('vlc')) return 'VLC';
  if (a.includes('foobar')) return 'foobar2000';
  if (a.includes('chrome') || a.includes('msedge') || a.includes('firefox') || a.includes('opera') || a.includes('brave'))
    return 'Navegador';
  return 'Música';
}

module.exports = { MediaWatcher, mediaAppName };
