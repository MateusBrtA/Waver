// Integração com o Windows: atalhos globais, notificações nativas, "Compartilhar no PulseCord" no Explorer.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, Notification, screen, shell } = require('electron');
const { MediaWatcher } = require('./mediaWatcher');

const APP_ID = 'com.pulsecord.app';
const SHARE_KEY = 'HKCU\\Software\\Classes\\*\\shell\\PulseCord';
const MAX_SHARE_BYTES = 1024 * 1024 * 1024; // 1 GB por arquivo

function setupDesktopIntegration({ getWindow, showWindow, iconPath, getActivityDetector }) {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  // ---------------- Atalhos globais (funcionam com o app em segundo plano / dentro do jogo)
  const registered = new Map(); // accelerator -> action
  ipcMain.handle('shortcuts:set', (_e, map) => {
    for (const accel of registered.keys()) {
      try {
        globalShortcut.unregister(accel);
      } catch {}
    }
    registered.clear();
    const failed = [];
    for (const [action, accel] of Object.entries(map || {})) {
      if (!accel || typeof accel !== 'string') continue;
      if (accel === 'CommandOrControl+Shift+Escape') {
        failed.push(action); // reservado: parada de emergência do controle remoto
        continue;
      }
      try {
        const ok = globalShortcut.register(accel, () => send('shortcut:fired', action));
        if (ok) registered.set(accel, action);
        else failed.push(action);
      } catch {
        failed.push(action);
      }
    }
    return { ok: failed.length === 0, failed };
  });
  app.on('will-quit', () => {
    for (const accel of registered.keys()) {
      try {
        globalShortcut.unregister(accel);
      } catch {}
    }
  });

  // ---------------- Notificações nativas
  // O Windows só mostra notificações de apps com um atalho no Menu Iniciar que tenha o mesmo AppUserModelID.
  // No portable não há instalador, então criamos (e atualizamos) esse atalho.
  function ensureStartMenuShortcut() {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    try {
      const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
      const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'PulseCord.lnk');
      let current = null;
      try {
        current = shell.readShortcutLink(lnk);
      } catch {}
      if (current && current.target === target && current.appUserModelId === APP_ID) return;
      shell.writeShortcutLink(lnk, current ? 'replace' : 'create', {
        target,
        appUserModelId: APP_ID,
        description: 'PulseCord',
        icon: target,
        iconIndex: 0,
      });
    } catch (err) {
      console.warn('[PulseCord] Não foi possível criar o atalho do Menu Iniciar:', err?.message || err);
    }
  }
  ensureStartMenuShortcut();

  const live = new Set(); // evita que o coletor de lixo descarte a notificação (o clique se perderia)
  ipcMain.handle('notify:show', (_e, opts) => {
    if (!Notification.isSupported()) return { ok: false };
    const { title, body, iconDataUrl, route, silent } = opts || {};
    let icon;
    try {
      if (typeof iconDataUrl === 'string' && iconDataUrl.startsWith('data:image/')) icon = nativeImage.createFromDataURL(iconDataUrl);
    } catch {}
    if (!icon && iconPath && fs.existsSync(iconPath)) icon = iconPath;
    const n = new Notification({
      title: String(title || 'PulseCord').slice(0, 120),
      body: String(body || '').slice(0, 300),
      icon,
      silent: Boolean(silent),
    });
    live.add(n);
    const drop = () => live.delete(n);
    n.on('click', () => {
      showWindow();
      send('notify:clicked', route || null);
      drop();
    });
    n.on('close', drop);
    n.on('failed', drop);
    n.show();
    setTimeout(drop, 10 * 60 * 1000);
    return { ok: true };
  });

  // ---------------- "Compartilhar no PulseCord" (menu do botão direito no Explorer)
  const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const reg = (args) =>
    new Promise((resolve) => execFile('reg', args, { windowsHide: true }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') })));

  ipcMain.handle('share-menu:get', async () => {
    if (process.platform !== 'win32') return { supported: false, enabled: false };
    const r = await reg(['query', `${SHARE_KEY}\\command`, '/ve']);
    return { supported: app.isPackaged, enabled: r.ok && r.stdout.toLowerCase().includes(exePath().toLowerCase()) };
  });
  ipcMain.handle('share-menu:set', async (_e, enabled) => {
    if (process.platform !== 'win32' || !app.isPackaged) return { ok: false, error: 'Disponível só no app instalado/portable.' };
    if (!enabled) {
      await reg(['delete', SHARE_KEY, '/f']);
      return { ok: true, enabled: false };
    }
    const exe = exePath();
    const steps = [
      ['add', SHARE_KEY, '/ve', '/d', 'Compartilhar no PulseCord', '/f'],
      ['add', SHARE_KEY, '/v', 'Icon', '/d', `"${exe}",0`, '/f'],
      ['add', `${SHARE_KEY}\\command`, '/ve', '/d', `"${exe}" --share "%1"`, '/f'],
    ];
    for (const s of steps) {
      const r = await reg(s);
      if (!r.ok) return { ok: false, error: 'Não foi possível gravar no registro do Windows.' };
    }
    return { ok: true, enabled: true };
  });

  // Arquivos recebidos pelo menu (um processo por arquivo: chegam via second-instance)
  const allowedSharePaths = new Set();
  let pendingShares = [];
  function handleArgv(argv) {
    const list = Array.isArray(argv) ? argv : [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] === '--share' && list[i + 1]) {
        const p = path.resolve(list[i + 1]);
        try {
          const st = fs.statSync(p);
          if (st.isFile()) {
            allowedSharePaths.add(p);
            out.push({ path: p, name: path.basename(p), size: st.size });
          }
        } catch {}
        i++;
      }
    }
    if (!out.length) return;
    pendingShares.push(...out);
    send('share:files', pendingShares);
  }
  ipcMain.handle('share:take-pending', () => {
    const list = pendingShares;
    pendingShares = [];
    return list;
  });
  ipcMain.handle('share:read', async (_e, p) => {
    // só lê arquivos que chegaram pelo menu "Compartilhar" (o renderer não pode pedir qualquer caminho)
    const full = path.resolve(String(p || ''));
    if (!allowedSharePaths.has(full)) throw new Error('Arquivo não autorizado.');
    const st = await fs.promises.stat(full);
    if (st.size > MAX_SHARE_BYTES) throw new Error('Arquivo grande demais para compartilhar por aqui (limite 1 GB).');
    const buf = await fs.promises.readFile(full);
    allowedSharePaths.delete(full);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });
  ipcMain.handle('share:clear', () => {
    pendingShares = [];
    return true;
  });

  // ---------------- Gravações e clipes da chamada (pasta Vídeos\PulseCord)
  const mediaDir = (kind) => {
    let base;
    try {
      base = app.getPath('videos');
    } catch {
      base = app.getPath('documents');
    }
    return path.join(base, 'PulseCord', kind === 'clip' ? 'Clipes' : 'Gravações');
  };
  const safeName = (name) => {
    const n = path.basename(String(name || 'PulseCord.webm')).replace(/[<>:"/\|?*\u0000-\u001f]/g, '_').slice(0, 120);
    return /\.webm$/i.test(n) ? n : `${n}.webm`;
  };
  const openRecordings = new Map(); // token -> { fh, file }
  ipcMain.handle('media:save-file', async (_e, name, bytes, kind) => {
    const dir = mediaDir(kind);
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, safeName(name));
    await fs.promises.writeFile(file, Buffer.from(bytes));
    return file;
  });
  ipcMain.handle('recording:open', async (_e, name) => {
    const dir = mediaDir('recording');
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, safeName(name));
    const fh = await fs.promises.open(file, 'w');
    const token = `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    openRecordings.set(token, { fh, file });
    return token;
  });
  ipcMain.handle('recording:append', async (_e, token, bytes) => {
    const r = openRecordings.get(token);
    if (!r) throw new Error('Gravação não encontrada.');
    await r.fh.write(Buffer.from(bytes));
    return true;
  });
  ipcMain.handle('recording:close', async (_e, token) => {
    const r = openRecordings.get(token);
    if (!r) return null;
    openRecordings.delete(token);
    await r.fh.close().catch(() => {});
    return r.file;
  });
  ipcMain.handle('media:reveal', (_e, file) => {
    const full = path.resolve(String(file || ''));
    const root = path.resolve(path.join(mediaDir('recording'), '..'));
    if (!full.startsWith(root + path.sep)) return false;
    shell.showItemInFolder(full);
    return true;
  });
  app.on('will-quit', () => {
    for (const r of openRecordings.values()) r.fh.close().catch(() => {});
  });

  // ---------------- "Ouvindo agora" (música do controle de mídia do Windows) — opcional
  let mediaWatcher = null;
  ipcMain.handle('media-activity:set', (_e, enabled) => {
    if (process.platform !== 'win32') return false;
    if (enabled) {
      if (!mediaWatcher) mediaWatcher = new MediaWatcher((media) => getActivityDetector?.()?.setMedia(media));
      mediaWatcher.start();
    } else if (mediaWatcher) {
      mediaWatcher.stop();
      mediaWatcher = null;
    }
    return Boolean(enabled);
  });

  // ---------------- Overlay da chamada (janela transparente, clicável "através", sempre no topo)
  // Funciona sobre jogos em janela / tela cheia sem borda. Em tela cheia exclusiva o Windows não deixa nada por cima.
  let overlayWin = null;
  let overlayConfig = { enabled: false, corner: 'top-left', onlySpeaking: false, onlyInGames: false };
  let overlayTimer = null;
  let overlayState = null; // { channelName, participants }
  let overlayUserHidden = false;
  const OVERLAY_W = 300;
  const OVERLAY_H = 420;

  function placeOverlay() {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wa = display.workArea;
    const right = String(overlayConfig.corner).endsWith('right');
    const bottom = String(overlayConfig.corner).startsWith('bottom');
    overlayWin.setBounds({
      x: right ? wa.x + wa.width - OVERLAY_W : wa.x,
      y: bottom ? wa.y + wa.height - OVERLAY_H : wa.y,
      width: OVERLAY_W,
      height: OVERLAY_H,
    });
  }

  function ensureOverlay() {
    if (overlayWin && !overlayWin.isDestroyed()) return overlayWin;
    overlayWin = new BrowserWindow({
      width: OVERLAY_W,
      height: OVERLAY_H,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'overlayPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
    overlayWin.setIgnoreMouseEvents(true);
    overlayWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    overlayWin.webContents.on('will-navigate', (e) => e.preventDefault());
    overlayWin.loadFile(path.join(__dirname, 'overlay.html')).catch(() => {});
    overlayWin.webContents.on('did-finish-load', () => pushOverlay());
    overlayWin.on('closed', () => {
      overlayWin = null;
    });
    return overlayWin;
  }

  function pushOverlay() {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    overlayWin.webContents.send('overlay:render', overlayState ? { ...overlayState, config: overlayConfig } : null);
  }

  function refreshOverlay() {
    const main = getWindow();
    // por cima do próprio PulseCord não precisa
    const mainFocused = Boolean(main && !main.isDestroyed() && main.isFocused());
    const inGame = getActivityDetector?.()?.baseActivity?.category === 'game';
    const active = overlayConfig.enabled && Boolean(overlayState?.channelName);
    // enquanto está numa chamada com o overlay ligado, reavalia de tempos em tempos (jogo abriu/fechou)
    if (active && overlayConfig.onlyInGames && !overlayTimer) overlayTimer = setInterval(refreshOverlay, 5000);
    if ((!active || !overlayConfig.onlyInGames) && overlayTimer) {
      clearInterval(overlayTimer);
      overlayTimer = null;
    }
    const shouldShow = active && !overlayUserHidden && !mainFocused && (!overlayConfig.onlyInGames || inGame);
    if (!shouldShow) {
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.hide();
        // fora da chamada / desligado: fecha a janela para não gastar memória
        if (!overlayConfig.enabled || !overlayState?.channelName) overlayWin.destroy();
      }
      return;
    }
    const win = ensureOverlay();
    if (!win.isVisible()) {
      placeOverlay();
      win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
    }
    pushOverlay();
  }

  ipcMain.handle('overlay:config', (_e, cfg) => {
    overlayConfig = {
      enabled: Boolean(cfg?.enabled),
      corner: ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(cfg?.corner) ? cfg.corner : 'top-left',
      onlySpeaking: Boolean(cfg?.onlySpeaking),
      onlyInGames: Boolean(cfg?.onlyInGames),
    };
    if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) placeOverlay();
    refreshOverlay();
    return overlayConfig;
  });
  ipcMain.on('overlay:state', (_e, state) => {
    if (!state || !state.channelName) {
      overlayState = null;
    } else {
      overlayState = {
        channelName: String(state.channelName).slice(0, 80),
        participants: (Array.isArray(state.participants) ? state.participants : []).slice(0, 25).map((p) => ({
          name: String(p?.name || '').slice(0, 48),
          avatarUrl: typeof p?.avatarUrl === 'string' ? p.avatarUrl.slice(0, 2048) : null,
          avatarColor: typeof p?.avatarColor === 'string' ? p.avatarColor.slice(0, 9) : '',
          speaking: Boolean(p?.speaking),
          muted: Boolean(p?.muted),
          deafened: Boolean(p?.deafened),
        })),
      };
    }
    refreshOverlay();
  });
  ipcMain.handle('overlay:toggle', () => {
    overlayUserHidden = !overlayUserHidden;
    refreshOverlay();
    return !overlayUserHidden;
  });
  const hookMainFocus = () => {
    const main = getWindow();
    if (!main || main.isDestroyed() || main.__overlayHooked) return;
    main.__overlayHooked = true;
    main.on('focus', refreshOverlay);
    main.on('blur', refreshOverlay);
  };
  hookMainFocus();
  app.on('browser-window-created', () => setTimeout(hookMainFocus, 0));
  app.on('will-quit', () => {
    mediaWatcher?.stop();
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  });

  return { handleArgv };
}

module.exports = { setupDesktopIntegration };
