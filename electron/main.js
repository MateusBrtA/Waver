const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
  Tray,
} = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const { WindowsRemoteController } = require('./remoteControl');
const { ActivityDetector } = require('./activityDetector');
const { ProcessLoopbackCapture } = require('./audioLoopback');
const { LanPeerMessenger } = require('./lanPeerMessenger');

// ========================
// Proteção contra "write EPIPE" ao fechar o app (stdout/stderr ou pipes de helpers
// fechados). Sem isso o Electron mostra a caixa "A JavaScript error occurred in the main process".
// ========================
for (const stream of [process.stdout, process.stderr]) {
  try {
    stream?.on?.('error', (err) => {
      if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED' || err.code === 'EOF')) return;
    });
  } catch {}
}
const BENIGN_PIPE_CODES = new Set(['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END', 'EOF']);
process.on('uncaughtException', (err) => {
  if (err && BENIGN_PIPE_CODES.has(err.code)) return;
  try {
    require('node:fs').appendFileSync(
      require('node:path').join(require('electron').app.getPath('userData'), 'crash.log'),
      `[${new Date().toISOString()}] ${err?.stack || err}
`,
    );
  } catch {}
  // Erro real: mostra ao usuário (comportamento padrão do Electron) em vez de engolir em silêncio
  try {
    require('electron').dialog.showErrorBox('PulseCord - erro inesperado', String(err?.stack || err));
  } catch {}
});

const IS_DEV = process.env.PULSECORD_DEV === '1';
const DIST_DIR = path.join(__dirname, '..', 'client', 'dist');
const LIVE_UI_DIR = path.join(app.getPath('userData'), 'live-ui');

function getActiveDistDir() {
  try {
    const manifestPath = path.join(LIVE_UI_DIR, 'manifest.json');
    const htmlPath = path.join(LIVE_UI_DIR, 'index.html');
    if (fs.existsSync(manifestPath) && fs.existsSync(htmlPath)) {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (m?.appVersion === app.getVersion()) {
        return LIVE_UI_DIR;
      }
    }
  } catch {}
  return DIST_DIR;
}

function computeDirHash(dir) {
  if (!dir || !fs.existsSync(dir)) return '';
  const files = [];
  const walk = (cur) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name !== 'manifest.json') {
        files.push({ rel: path.relative(dir, full).replace(/\\/g, '/'), full });
      }
    }
  };
  try {
    walk(dir);
    if (files.length === 0) return '';
    const h = crypto.createHash('sha256');
    for (const f of files) {
      h.update(f.rel);
      h.update(fs.readFileSync(f.full));
    }
    return h.digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=384');
app.commandLine.appendSwitch('renderer-process-limit', '2');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let pendingScreenCapture = null;
let activeSharedDisplayId = null;

function readAppPrefs() {
  const p = path.join(app.getPath('userData'), 'app-prefs.json');
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
    }
  } catch {}
  return {};
}

function writeAppPrefs(partial) {
  const p = path.join(app.getPath('userData'), 'app-prefs.json');
  const next = { ...readAppPrefs(), ...partial };
  try {
    fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  } catch {}
  return next;
}

let closeToTray = readAppPrefs().closeToTray !== false;

// ========================
// Native Remote Control (Win32 + ViGEm), Activity Detector & LAN P2P Messenger
// ========================
const remoteController = new WindowsRemoteController();
let rcActivePermissions = { mouse: true, keyboard: true, gamepad: true };
const processLoopback = new ProcessLoopbackCapture();
let activityDetector = null;
let lanPeerMessenger = null;

// ========================
// Local Encrypted Vault Helpers (Global Profile & Private DM History)
// ========================
function getLocalVaultKey() {
  const keyFile = path.join(app.getPath('userData'), '.local-vault.key');
  if (fs.existsSync(keyFile)) {
    const raw = fs.readFileSync(keyFile);
    return raw.length === 32 ? raw : crypto.createHash('sha256').update(raw).digest();
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key);
  return key;
}

function writeEncryptedLocalJson(fileName, obj) {
  const target = path.join(app.getPath('userData'), fileName);
  const key = getLocalVaultKey();
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 6 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(gz), cipher.final()]);
  const tag = cipher.getAuthTag();
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, Buffer.concat([Buffer.from('PCL1', 'ascii'), iv, tag, enc]));
  fs.renameSync(tmp, target);
}

function readEncryptedLocalJson(fileName, fallback) {
  const target = path.join(app.getPath('userData'), fileName);
  if (!fs.existsSync(target)) return fallback;
  try {
    const raw = fs.readFileSync(target);
    if (raw.length < 32 || raw.subarray(0, 4).toString('ascii') !== 'PCL1') return fallback;
    const key = getLocalVaultKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(4, 16));
    decipher.setAuthTag(raw.subarray(16, 32));
    const gz = Buffer.concat([decipher.update(raw.subarray(32)), decipher.final()]);
    return JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  } catch {
    return fallback;
  }
}

// ========================
// Embedded Host, LAN Scanner & Tunnel State
// ========================
let embeddedServerInstance = null;
let lanScanner = null;
let discoveredLanServers = [];
let hostState = {
  running: false,
  starting: false,
  port: 3000,
  localUrl: 'http://localhost:3000',
  addresses: [],
  hasPassword: false,
  externalExisting: false,
  error: '',
  tunnelStatus: 'idle',
  tunnelUrl: '',
  tunnelError: '',
};
let tunnelProcess = null;

function broadcastHostState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('host:status-changed', { ...hostState });
  }
}

function broadcastLanServers() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lan:servers-updated', discoveredLanServers);
  }
}

async function ensureLanScanner() {
  if (lanScanner) return lanScanner;
  try {
    const discUrl = pathToFileURL(path.join(__dirname, '..', 'server', 'discovery.js')).href;
    const { startLanScanner } = await import(discUrl);
    lanScanner = startLanScanner((list) => {
      discoveredLanServers = list;
      broadcastLanServers();
    });
  } catch (err) {
    console.warn('[Electron] LAN scanner warning:', err?.message);
  }
  return lanScanner;
}

async function startEmbeddedHost(preferredPortOrOpts = 3000) {
  const hostOpts =
    typeof preferredPortOrOpts === 'object' && preferredPortOrOpts !== null
      ? preferredPortOrOpts
      : { port: preferredPortOrOpts };

  if (hostState.running && (embeddedServerInstance || hostState.externalExisting)) {
    if (
      embeddedServerInstance &&
      (hostOpts.serverName || hostOpts.iconColor || hostOpts.iconDataUrl || hostOpts.password !== undefined)
    ) {
      if (hostOpts.serverName || hostOpts.iconColor || hostOpts.iconDataUrl) {
        embeddedServerInstance.setServerMeta?.({
          name: hostOpts.serverName,
          iconColor: hostOpts.iconColor,
          iconDataUrl: hostOpts.iconDataUrl,
        });
      }
      if (hostOpts.password !== undefined) {
        const info = embeddedServerInstance.setServerPassword?.(hostOpts.password || '');
        hostState.hasPassword = Boolean(info?.hasInvitePassword);
        broadcastHostState();
      }
    }
    return { ...hostState };
  }

  hostState.starting = true;
  hostState.error = '';
  broadcastHostState();

  try {
    const serverModUrl = pathToFileURL(path.join(__dirname, '..', 'server', 'index.js')).href;
    const { createPulseCordServer, getNetworkAddresses } = await import(serverModUrl);

    const dataDir = path.join(app.getPath('userData'), 'server-data');
    const downloadsDir = path.join(path.dirname(app.getPath('exe')), 'dist-app');

    let targetPort = Number(hostOpts.port) || 3000;
    let startedInfo = null;

    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = createPulseCordServer({
        port: targetPort,
        host: '0.0.0.0',
        dataDir,
        clientDistDir: getActiveDistDir(),
        downloadsDir,
      });

      try {
        startedInfo = await candidate.start(targetPort);
        embeddedServerInstance = candidate;
        break;
      } catch (err) {
        if (err && err.code === 'EADDRINUSE') {
          try {
            const resp = await fetch(`http://127.0.0.1:${targetPort}/api/health`, {
              signal: AbortSignal.timeout(1500),
            });
            if (resp.ok) {
              const health = await resp.json();
              if (health?.ok) {
                hostState = {
                  ...hostState,
                  running: true,
                  starting: false,
                  port: targetPort,
                  localUrl: `http://localhost:${targetPort}`,
                  addresses: health.addresses || getNetworkAddresses(targetPort),
                  hasPassword: Boolean(health.server?.hasInvitePassword),
                  externalExisting: true,
                  error: '',
                };
                broadcastHostState();
                return { ...hostState };
              }
            }
          } catch {
            // Occupied by another app
          }
          targetPort += 1;
        } else {
          throw err;
        }
      }
    }

    if (!startedInfo) {
      throw new Error('Não foi possível abrir uma porta livre (3000-3005) para o servidor.');
    }

    if (embeddedServerInstance) {
      if (hostOpts.serverName || hostOpts.iconColor || hostOpts.iconDataUrl) {
        embeddedServerInstance.setServerMeta?.({
          name: hostOpts.serverName,
          iconColor: hostOpts.iconColor,
          iconDataUrl: hostOpts.iconDataUrl,
        });
      }
      if (hostOpts.password) {
        const info = embeddedServerInstance.setServerPassword?.(hostOpts.password);
        startedInfo.hasPassword = Boolean(info?.hasInvitePassword);
      }
    }

    hostState = {
      ...hostState,
      running: true,
      starting: false,
      port: startedInfo.port,
      localUrl: startedInfo.localUrl,
      addresses: startedInfo.addresses,
      hasPassword: Boolean(startedInfo.hasPassword),
      externalExisting: false,
      error: '',
    };
    broadcastHostState();
    return { ...hostState };
  } catch (err) {
    console.error('[Host] Falha ao iniciar servidor embutido:', err);
    hostState = {
      ...hostState,
      running: false,
      starting: false,
      error: err?.message || 'Erro ao iniciar o servidor local.',
    };
    broadcastHostState();
    return { ...hostState };
  }
}

function stopTunnel() {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill();
    } catch {}
    tunnelProcess = null;
  }
  hostState.tunnelStatus = 'idle';
  hostState.tunnelUrl = '';
  hostState.tunnelError = '';
  broadcastHostState();
  return { ...hostState };
}

async function stopEmbeddedHost() {
  stopTunnel();
  if (embeddedServerInstance) {
    try {
      await embeddedServerInstance.stop();
    } catch {}
    embeddedServerInstance = null;
  }
  hostState = {
    ...hostState,
    running: false,
    starting: false,
    externalExisting: false,
    error: '',
    tunnelStatus: 'idle',
    tunnelUrl: '',
    tunnelError: '',
  };
  broadcastHostState();
  return { ...hostState };
}

async function ensureCloudflaredBinary() {
  const binDir = path.join(app.getPath('userData'), 'bin');
  const binPath = path.join(binDir, 'cloudflared.exe');
  if (fs.existsSync(binPath)) return binPath;

  const localScriptBin = path.join(__dirname, '..', 'scripts', 'cloudflared.exe');
  if (fs.existsSync(localScriptBin)) return localScriptBin;

  fs.mkdirSync(binDir, { recursive: true });
  hostState.tunnelStatus = 'downloading';
  hostState.tunnelError = '';
  broadcastHostState();

  const url =
    'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Falha ao baixar cloudflared (HTTP ${resp.status}).`);
  const arrBuf = await resp.arrayBuffer();
  fs.writeFileSync(binPath, Buffer.from(arrBuf));
  return binPath;
}

async function startTunnel() {
  if (!hostState.running) {
    await startEmbeddedHost(hostState.port);
    if (!hostState.running) return { ...hostState };
  }
  if (tunnelProcess && hostState.tunnelUrl) return { ...hostState };
  stopTunnel();

  try {
    const cfBin = await ensureCloudflaredBinary();
    hostState.tunnelStatus = 'connecting';
    hostState.tunnelError = '';
    hostState.tunnelUrl = '';
    broadcastHostState();

    const child = spawn(cfBin, ['tunnel', '--url', `http://127.0.0.1:${hostState.port}`, '--no-autoupdate'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    tunnelProcess = child;
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});

    const handleChunk = (chunk) => {
      const text = chunk.toString('utf8');
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && !hostState.tunnelUrl) {
        hostState.tunnelUrl = match[0];
        hostState.tunnelStatus = 'connected';
        broadcastHostState();
      }
    };

    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);

    child.on('exit', () => {
      if (tunnelProcess === child) {
        tunnelProcess = null;
        if (hostState.tunnelStatus !== 'idle') {
          hostState.tunnelStatus = hostState.tunnelUrl ? 'idle' : 'error';
          if (!hostState.tunnelUrl) {
            hostState.tunnelError = 'O túnel Cloudflare encerrou antes de gerar o link.';
          }
          hostState.tunnelUrl = '';
          broadcastHostState();
        }
      }
    });

    child.on('error', (err) => {
      hostState.tunnelStatus = 'error';
      hostState.tunnelError = err.message;
      broadcastHostState();
    });

    return { ...hostState };
  } catch (err) {
    hostState.tunnelStatus = 'error';
    hostState.tunnelError = err?.message || 'Erro ao iniciar túnel gratuito.';
    broadcastHostState();
    return { ...hostState };
  }
}

function registerEmergencyRemoteStopShortcut() {
  try {
    globalShortcut.unregister('CommandOrControl+Shift+Escape');
    globalShortcut.register('CommandOrControl+Shift+Escape', () => {
      remoteController.stop();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rc:emergency-stopped');
      }
    });
  } catch {
    // ignore if shortcut unavailable
  }
}

function createTray() {
  if (tray) return tray;
  try {
    const iconCandidate =
      process.platform === 'win32' && fs.existsSync(path.join(__dirname, 'icon.ico'))
        ? path.join(__dirname, 'icon.ico')
        : path.join(__dirname, 'icon.png');
    tray = new Tray(iconCandidate);
    tray.setToolTip('PulseCord — Conectado');
    const restoreWindow = () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
        return;
      }
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.webContents.setFrameRate(60);
      mainWindow.focus();
    };
    const menu = Menu.buildFromTemplate([
      { label: 'Abrir PulseCord', click: restoreWindow },
      { type: 'separator' },
      {
        label: 'Mutar / Desmutar Microfone',
        click: () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('tray:toggle-mute'),
      },
      {
        label: 'Desativar / Ativar Áudio',
        click: () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('tray:toggle-deafen'),
      },
      { type: 'separator' },
      {
        label: 'Sair do PulseCord',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', restoreWindow);
    tray.on('double-click', restoreWindow);
  } catch (err) {
    console.warn('[Tray] Não foi possível criar ícone na bandeja:', err?.message);
  }
  return tray;
}

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 850,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#0b0c10',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      allowRunningInsecureContent: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  if (IS_DEV) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadURL('app://pulsecord/index.html');
  }

  mainWindow.on('close', (e) => {
    try {
      mainWindow.webContents.session.flushStorageData();
    } catch {}
    if (!isQuitting && closeToTray && process.env.PULSECORD_TEST_EXIT !== '1') {
      e.preventDefault();
      mainWindow.hide();
      try {
        mainWindow.webContents.setFrameRate(4);
      } catch {}
    }
  });

  mainWindow.on('show', () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.setFrameRate(60);
      }
    } catch {}
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const allowMulti = IS_DEV || process.argv.includes('--multi');
const gotLock = allowMulti ? true : app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.webContents.setFrameRate(60);
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('app', (request) => {
      const parsed = new URL(request.url);
      let relPath = decodeURIComponent(parsed.pathname);
      if (!relPath || relPath === '/') relPath = '/index.html';

      const activeDist = getActiveDistDir();
      const targetPath = path.normalize(path.join(activeDist, relPath));
      if (!targetPath.startsWith(activeDist) || !fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
        return net.fetch(pathToFileURL(path.join(activeDist, 'index.html')).toString());
      }
      return net.fetch(pathToFileURL(targetPath).toString());
    });

    // Inject clean HTTPS Referer/Origin on YouTube embed & iframe requests inside packaged app://
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://*.ytimg.com/*'] },
      (details, callback) => {
        const ref = details.requestHeaders.Referer || details.requestHeaders.referer || '';
        if (!ref || ref.startsWith('app://') || ref.startsWith('file://')) {
          details.requestHeaders.Referer = 'https://www.youtube.com/';
          details.requestHeaders.Origin = 'https://www.youtube.com';
        }
        callback({ requestHeaders: details.requestHeaders });
      }
    );

    const allowedPermissions = new Set([
      'media',
      'mediaKeySystem',
      'display-capture',
      'audioCapture',
      'videoCapture',
      'speaker-selection',
      'fullscreen',
      'notifications',
      'clipboard-read',
      'clipboard-sanitized-write',
    ]);

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(allowedPermissions.has(permission));
    });

    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      return allowedPermissions.has(permission);
    });

    session.defaultSession.setDisplayMediaRequestHandler(
      async (_request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 1, height: 1 },
          });

          const chosenId = pendingScreenCapture?.sourceId;
          const shareAudio = pendingScreenCapture?.shareAudio ?? true;
          const useProcessLoopback = Boolean(pendingScreenCapture?.useProcessLoopback);
          pendingScreenCapture = null;

          const selected =
            (chosenId && sources.find((s) => s.id === chosenId)) ||
            sources.find((s) => s.id.startsWith('screen:')) ||
            sources[0];

          if (!selected) {
            callback({});
            return;
          }

          activeSharedDisplayId = selected.display_id || null;

          // When Process-Excluded WASAPI Loopback is active, capture ONLY video here so PulseCord's own audio isn't echoed!
          if (useProcessLoopback) {
            callback({ video: selected });
          } else if (shareAudio && process.platform === 'win32') {
            callback({ video: selected, audio: 'loopback' });
          } else {
            callback({ video: selected });
          }
        } catch (err) {
          console.error('[Electron] DisplayMediaRequestHandler error:', err);
          callback({});
        }
      },
      { useSystemPicker: false }
    );

    // Desktop screen capture IPC
    ipcMain.handle('desktop:get-sources', async () => {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });

      return sources
        .filter((s) => s.name && !s.name.startsWith('PulseCord'))
        .map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.id.startsWith('screen:') ? 'screen' : 'window',
          displayId: s.display_id || '',
          thumbnailDataUrl: s.thumbnail.toDataURL(),
          appIconDataUrl: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        }));
    });

    ipcMain.handle('desktop:prepare-screen-capture', (_event, opts) => {
      pendingScreenCapture = {
        sourceId: String(opts?.sourceId || ''),
        shareAudio: opts?.shareAudio !== false,
        useProcessLoopback: Boolean(opts?.useProcessLoopback),
      };
      return true;
    });

    // Process-Excluded WASAPI Loopback (captures PC audio EXCLUDING PulseCord itself -> Zero Echo!)
    ipcMain.handle('loopback:start', async () => {
      return processLoopback.start((frameBuffer) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('loopback:pcm', frameBuffer);
        }
      });
    });
    ipcMain.handle('loopback:stop', () => {
      processLoopback.stop();
      return true;
    });

    // In-App Auto-Updater (Hot UI Bundle + Silent Installer / Portable Self-Replace)
    ipcMain.handle('update:get-local-info', () => ({
      appVersion: app.getVersion(),
      uiHash: computeDirHash(getActiveDistDir()),
      isPackaged: app.isPackaged,
      isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    }));

    ipcMain.handle('update:apply-ui-bundle', async (_event, serverUrl) => {
      const resp = await fetch(`${serverUrl}/api/update/ui-bundle`, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) throw new Error(`Falha ao baixar pacote de interface (HTTP ${resp.status}).`);
      const gz = Buffer.from(await resp.arrayBuffer());
      const parsed = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
      if (!parsed?.files || typeof parsed.files['index.html'] !== 'string') {
        throw new Error('Pacote de interface inválido.');
      }

      const stageDir = `${LIVE_UI_DIR}.staging`;
      fs.rmSync(stageDir, { recursive: true, force: true });
      fs.mkdirSync(stageDir, { recursive: true });

      for (const [rel, b64] of Object.entries(parsed.files)) {
        const safeTarget = path.normalize(path.join(stageDir, rel));
        if (!safeTarget.startsWith(stageDir)) continue;
        fs.mkdirSync(path.dirname(safeTarget), { recursive: true });
        fs.writeFileSync(safeTarget, Buffer.from(String(b64), 'base64'));
      }
      fs.writeFileSync(
        path.join(stageDir, 'manifest.json'),
        JSON.stringify({ appVersion: app.getVersion(), uiHash: parsed.uiHash, appliedAt: Date.now() }),
        'utf8'
      );

      fs.rmSync(LIVE_UI_DIR, { recursive: true, force: true });
      fs.renameSync(stageDir, LIVE_UI_DIR);

      if (mainWindow && !mainWindow.isDestroyed() && !IS_DEV) {
        await mainWindow.loadURL('app://pulsecord/index.html');
      }
      return { ok: true, uiHash: parsed.uiHash };
    });

    ipcMain.handle('update:download-and-install', async (_event, { serverUrl, expectedSha256, installerName }) => {
      const osTmp = require('node:os').tmpdir();
      const targetExe = path.join(osTmp, `PulseCord-Update-${Date.now()}.exe`);
      const resp = await fetch(`${serverUrl}/api/update/installer`);
      if (!resp.ok || !resp.body) {
        throw new Error(`Não foi possível baixar o instalador do Host (HTTP ${resp.status}).`);
      }

      const total = Number(resp.headers.get('content-length') || 0);
      let loaded = 0;
      let lastTick = Date.now();
      let lastLoaded = 0;

      const out = fs.createWriteStream(targetExe);
      const hash = crypto.createHash('sha256');
      const reader = resp.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        out.write(buf);
        hash.update(buf);
        loaded += buf.length;

        const now = Date.now();
        if (now - lastTick >= 150 || loaded === total) {
          const dt = Math.max(0.05, (now - lastTick) / 1000);
          const speedMBps = Number(((loaded - lastLoaded) / dt / (1024 * 1024)).toFixed(1));
          lastTick = now;
          lastLoaded = loaded;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update:progress', {
              percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 50,
              loaded,
              total,
              speedMBps,
            });
          }
        }
      }
      await new Promise((res, rej) => {
        out.end(() => res());
        out.on('error', rej);
      });

      const actualSha = hash.digest('hex');
      if (expectedSha256 && expectedSha256.toLowerCase() !== actualSha.toLowerCase()) {
        try { fs.unlinkSync(targetExe); } catch {}
        throw new Error('Falha na verificação de integridade (SHA-256) da atualização.');
      }

      const portableTarget = process.env.PORTABLE_EXECUTABLE_FILE || '';
      const isPortableDownload = /portable/i.test(installerName || '');
      const psScriptPath = path.join(osTmp, `pulsecord-apply-${Date.now()}.ps1`);

      let psContent = '';
      if (portableTarget) {
        psContent = `
Start-Sleep -Milliseconds 1400
for ($i = 0; $i -lt 20; $i++) {
  try {
    Copy-Item -Force "${targetExe.replace(/"/g, '""')}" "${portableTarget.replace(/"/g, '""')}"
    Remove-Item -Force "${targetExe.replace(/"/g, '""')}" -ErrorAction SilentlyContinue
    Start-Process "${portableTarget.replace(/"/g, '""')}"
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
Remove-Item -Force $MyInvocation.MyCommand.Path -ErrorAction SilentlyContinue
`;
      } else if (isPortableDownload && !app.isPackaged) {
        throw new Error('Atualização por EXE requer versão empacotada do app.');
      } else {
        psContent = `
Start-Sleep -Milliseconds 1400
Start-Process -FilePath "${targetExe.replace(/"/g, '""')}" -ArgumentList "/S" -Wait
$candidates = @(
  "$env:LOCALAPPDATA\\Programs\\PulseCord\\PulseCord.exe",
  "$env:ProgramFiles\\PulseCord\\PulseCord.exe",
  "${process.execPath.replace(/"/g, '""')}"
)
foreach ($p in $candidates) {
  if (Test-Path $p) {
    Start-Process $p
    break
  }
}
Remove-Item -Force "${targetExe.replace(/"/g, '""')}" -ErrorAction SilentlyContinue
Remove-Item -Force $MyInvocation.MyCommand.Path -ErrorAction SilentlyContinue
`;
      }

      fs.writeFileSync(psScriptPath, psContent, 'utf8');
      const updater = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      });
      updater.unref();
      isQuitting = true;
      setTimeout(() => app.quit(), 300);
      return { ok: true };
    });

    // Local Blender .blend -> .glb converter fallback + Theme persistence
    ipcMain.handle('blender:convert-local', async (_event, { bytes, fileName }) => {
      try {
        const modUrl = pathToFileURL(path.join(__dirname, '..', 'server', 'blendConverter.js')).href;
        const { convertBlendToGlb, findBlenderBinary, inspectBlendMetadata } = await import(modUrl);
        const tmpDir = path.join(require('node:os').tmpdir(), 'pulsecord-3d');
        fs.mkdirSync(tmpDir, { recursive: true });
        const safeBase = `${Date.now()}-${path.basename(fileName || 'scene.blend').replace(/[^\w.-]/g, '_')}`;
        const inPath = path.join(tmpDir, safeBase);
        const outPath = path.join(tmpDir, `${safeBase}.glb`);
        fs.writeFileSync(inPath, Buffer.from(bytes));

        let metadata = null;
        try {
          metadata = inspectBlendMetadata(inPath);
        } catch {}

        const hasLocalBlender = Boolean(findBlenderBinary());
        if (!hasLocalBlender) {
          try { fs.unlinkSync(inPath); } catch {}
          return { glbBytes: null, metadata, hasLocalBlender: false };
        }

        await convertBlendToGlb(inPath, outPath);
        const glbBuf = fs.readFileSync(outPath);
        try { fs.unlinkSync(inPath); } catch {}
        try { fs.unlinkSync(outPath); } catch {}
        return { glbBytes: new Uint8Array(glbBuf), metadata, hasLocalBlender: true };
      } catch (err) {
        return { glbBytes: null, metadata: null, error: err?.message || 'Erro ao processar .blend.' };
      }
    });

    ipcMain.handle('theme:load', () => {
      const p = path.join(app.getPath('userData'), 'theme-config.json');
      if (!fs.existsSync(p)) return null;
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        return null;
      }
    });

    ipcMain.handle('theme:save', (_event, themeConfig) => {
      const p = path.join(app.getPath('userData'), 'theme-config.json');
      fs.writeFileSync(p, JSON.stringify(themeConfig || {}, null, 2), 'utf8');
      return true;
    });

    // Parsec / AnyDesk Remote Control + Native Virtual Xbox Controller (ViGEm)
    remoteController.onRumble = ({ slot, large, small }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rc:rumble', { slot, large, small });
      }
    };
    remoteController.onHostActivity = (active) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rc:host-activity', { active });
      }
    };
    ipcMain.handle('rc:set-host-priority', (_event, enabled) => {
      remoteController.setHostPriority(enabled);
      return remoteController.getStatus();
    });
    remoteController.onStatusChange = (st) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rc:status-changed', st);
      }
    };

    ipcMain.handle('rc:enable', () => {
      const ok = remoteController.start(activeSharedDisplayId);
      if (ok) registerEmergencyRemoteStopShortcut();
      return ok;
    });
    ipcMain.handle('rc:disable', () => {
      remoteController.stop();
      globalShortcut.unregister('CommandOrControl+Shift+Escape');
      return true;
    });
    ipcMain.handle('rc:get-status', () => remoteController.getStatus());
    ipcMain.handle('rc:set-permissions', (_event, perms) => {
      if (perms && typeof perms === 'object') {
        rcActivePermissions = {
          mouse: perms.mouse !== false,
          keyboard: perms.keyboard !== false,
          gamepad: perms.gamepad !== false,
        };
      }
      return { ...rcActivePermissions };
    });
    ipcMain.handle('rc:disconnect-gamepad', (_event, slot) => {
      remoteController.disconnectGamepad(slot ?? 0);
      return true;
    });
    ipcMain.handle('rc:retry-vigem', async () => {
      const status = await remoteController.retryViGEm();
      return { vigemStatus: status };
    });
    ipcMain.handle('rc:install-vigembus', async () => {
      try {
        const tmpExe = path.join(os.tmpdir(), 'ViGEmBus_Setup_PulseCord.exe');
        if (!fs.existsSync(tmpExe) || fs.statSync(tmpExe).size < 100000) {
          const url = 'https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe';
          const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(45000) });
          if (!resp.ok) throw new Error(`Falha ao baixar driver ViGEmBus (HTTP ${resp.status}).`);
          fs.writeFileSync(tmpExe, Buffer.from(await resp.arrayBuffer()));
        }
        const err = await shell.openPath(tmpExe);
        if (err) throw new Error(err);
        return { ok: true, path: tmpExe };
      } catch (err) {
        return { ok: false, error: err?.message || 'Não foi possível baixar o instalador ViGEmBus.' };
      }
    });
    ipcMain.on('rc:execute-input', (_event, evt) => {
      remoteController.handleInput(evt, rcActivePermissions);
    });

    // Global Persistent Profile (synced across all LAN servers!) & Encrypted Local DM Archive
    ipcMain.handle('profile:load', () => readEncryptedLocalJson('global-profile.enc', null));
    ipcMain.handle('profile:save', (_event, profile) => {
      writeEncryptedLocalJson('global-profile.enc', profile || {});
      lanPeerMessenger?.updateIdentity(profile || {});
      return true;
    });
    ipcMain.handle('dm-vault:load', () => readEncryptedLocalJson('dm-archive.enc', {}));
    ipcMain.handle('dm-vault:save', (_event, dmMap) => {
      writeEncryptedLocalJson('dm-archive.enc', dmMap || {});
      return true;
    });

    // Activity Detector IPC (uses persistent pulse-native-core.exe zero-spawn snapshot!)
    activityDetector = new ActivityDetector(
      app.getPath('userData'),
      (state) => {
        lanPeerMessenger?.updateIdentity({ currentActivity: state.currentActivity });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('activity:updated', state);
        }
      },
      () => remoteController.scanProcesses()
    );
    activityDetector.start();
    ipcMain.handle('activity:get', () => activityDetector?.getState() || { currentActivity: null, recentActivities: [] });

    // Serverless LAN P2P Messenger (Private Conversations & 1-on-1 Calls without a Server)
    lanPeerMessenger = new LanPeerMessenger({
      userDataDir: app.getPath('userData'),
      onPeersUpdated: (list) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lan-peers:list', list);
        }
      },
      onDmMessage: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lan-peers:dm-message', data);
        }
      },
      onDmPinned: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lan-peers:dm-pinned', data);
        }
      },
      onCallIncoming: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (!mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.webContents.setFrameRate(60);
          }
          mainWindow.webContents.send('lan-peers:call-incoming', data);
        }
      },
      onCallResponded: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lan-peers:call-responded', data);
        }
      },
      onGroupUpdated: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lan-peers:group-updated', data);
        }
      },
      onGroupMessage: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lan-peers:group-message', data);
        }
      },
      onGroupPinned: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lan-peers:group-pinned', data);
        }
      },
      onTrelloUpdated: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lan-peers:trello-updated', data);
        }
      },
    });
    lanPeerMessenger.start().catch((err) => console.warn('[LAN P2P] Start warning:', err?.message));

    ipcMain.handle('lan-peers:self', () => lanPeerMessenger?.getSelfInfo() || null);
    ipcMain.handle('lan-peers:get', () => lanPeerMessenger?.getPeersList() || []);
    ipcMain.handle('lan-peers:scan', () => {
      lanPeerMessenger?.scanNow();
      return lanPeerMessenger?.getPeersList() || [];
    });
    ipcMain.handle('lan-peers:update-identity', (_e, id) => lanPeerMessenger?.updateIdentity(id || {}) || null);
    ipcMain.handle('lan-peers:send-dm', (_e, payload) => lanPeerMessenger.sendDm(payload));
    ipcMain.handle('lan-peers:pin-dm', (_e, payload) => lanPeerMessenger.pinDm(payload));
    ipcMain.handle('lan-peers:call-invite', (_e, payload) => lanPeerMessenger.sendCallInvite(payload));
    ipcMain.handle('lan-peers:call-respond', (_e, payload) => lanPeerMessenger.sendCallRespond(payload));
    ipcMain.handle('lan-peers:get-groups', () => lanPeerMessenger?.getGroupsList() || []);
    ipcMain.handle('lan-peers:save-group', (_e, g) => lanPeerMessenger.saveGroup(g));
    ipcMain.handle('lan-peers:send-group-dm', (_e, p) => lanPeerMessenger.sendGroupMessage(p));
    ipcMain.handle('lan-peers:pin-group-dm', (_e, p) => lanPeerMessenger.pinGroupMessage(p));
    ipcMain.handle('lan-peers:group-call-invite', (_e, p) => lanPeerMessenger.sendGroupCallInvite(p));
    ipcMain.handle('lan-peers:get-trello', (_e, scopeKey) => lanPeerMessenger?.getTrelloBoards(scopeKey) || []);
    ipcMain.handle('lan-peers:sync-trello', (_e, p) => lanPeerMessenger.syncTrello(p));

    // Embedded Host, Password, LAN Discovery & Tunnel IPC
    ipcMain.handle('host:start', (_event, opts) => startEmbeddedHost(opts || 3000));
    ipcMain.handle('host:stop', () => stopEmbeddedHost());
    ipcMain.handle('host:status', () => ({ ...hostState }));
    ipcMain.handle('host:set-password', (_event, password) => {
      if (embeddedServerInstance) {
        const info = embeddedServerInstance.setServerPassword(password || '');
        hostState.hasPassword = Boolean(info?.hasInvitePassword);
        broadcastHostState();
      }
      return { ...hostState };
    });
    ipcMain.handle('host:start-tunnel', () => startTunnel());
    ipcMain.handle('host:stop-tunnel', () => stopTunnel());
    ipcMain.handle('lan:get-servers', async () => {
      await ensureLanScanner();
      return discoveredLanServers;
    });
    ipcMain.handle('lan:scan-now', async () => {
      const scanner = await ensureLanScanner();
      scanner?.scanNow();
      return discoveredLanServers;
    });

    // Window & System Tray controls (Discord close-to-tray behavior)
    ipcMain.on('window:minimize', () => mainWindow?.minimize());
    ipcMain.on('window:maximize', () => {
      if (!mainWindow) return;
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    });
    ipcMain.on('window:close', () => {
      if (!mainWindow) return;
      if (closeToTray && !isQuitting && process.env.PULSECORD_TEST_EXIT !== '1') {
        mainWindow.hide();
        try {
          mainWindow.webContents.setFrameRate(4);
        } catch {}
      } else {
        mainWindow.close();
      }
    });
    ipcMain.handle('app:get-close-to-tray', () => closeToTray);
    ipcMain.handle('app:set-close-to-tray', (_e, enabled) => {
      closeToTray = Boolean(enabled);
      writeAppPrefs({ closeToTray });
      return closeToTray;
    });
    ipcMain.on('app:quit', () => {
      isQuitting = true;
      app.quit();
    });

    ensureLanScanner();
    createTray();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow?.show();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
    // garante que localStorage (sessão, servidores salvos, ajustes) chegou no disco antes de sair
    try {
      session.defaultSession.flushStorageData();
    } catch {}
    processLoopback.stop();
    remoteController.shutdown();
    globalShortcut.unregisterAll();
    activityDetector?.stop();
    stopTunnel();
    lanScanner?.stop();
    lanScanner = null;
    lanPeerMessenger?.stop().catch(() => {});
    lanPeerMessenger = null;
    try {
      tray?.destroy();
    } catch {}
    tray = null;
    if (embeddedServerInstance) {
      embeddedServerInstance.stop().catch(() => {});
      embeddedServerInstance = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && (!closeToTray || isQuitting || process.env.PULSECORD_TEST_EXIT === '1')) {
      app.quit();
    }
  });
}
