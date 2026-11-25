const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { app, screen } = require('electron');

// Browser KeyboardEvent.code -> Win32 Virtual-Key (VK_*) mapping (preserving L/R modifiers for games)
const CODE_TO_VK = {
  Backspace: 0x08, Tab: 0x09, Enter: 0x0d, NumpadEnter: 0x0d,
  ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3,
  AltLeft: 0xa4, AltRight: 0xa5, Pause: 0x13, CapsLock: 0x14, Escape: 0x1b,
  Space: 0x20, PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24,
  ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  PrintScreen: 0x2c, Insert: 0x2d, Delete: 0x2e,
  Digit0: 0x30, Digit1: 0x31, Digit2: 0x32, Digit3: 0x33, Digit4: 0x34,
  Digit5: 0x35, Digit6: 0x36, Digit7: 0x37, Digit8: 0x38, Digit9: 0x39,
  KeyA: 0x41, KeyB: 0x42, KeyC: 0x43, KeyD: 0x44, KeyE: 0x45, KeyF: 0x46,
  KeyG: 0x47, KeyH: 0x48, KeyI: 0x49, KeyJ: 0x4a, KeyK: 0x4b, KeyL: 0x4c,
  KeyM: 0x4d, KeyN: 0x4e, KeyO: 0x4f, KeyP: 0x50, KeyQ: 0x51, KeyR: 0x52,
  KeyS: 0x53, KeyT: 0x54, KeyU: 0x55, KeyV: 0x56, KeyW: 0x57, KeyX: 0x58,
  KeyY: 0x59, KeyZ: 0x5a,
  MetaLeft: 0x5b, MetaRight: 0x5c, ContextMenu: 0x5d,
  Numpad0: 0x60, Numpad1: 0x61, Numpad2: 0x62, Numpad3: 0x63, Numpad4: 0x64,
  Numpad5: 0x65, Numpad6: 0x66, Numpad7: 0x67, Numpad8: 0x68, Numpad9: 0x69,
  NumpadMultiply: 0x6a, NumpadAdd: 0x6b, NumpadSubtract: 0x6d, NumpadDecimal: 0x6e, NumpadDivide: 0x6f,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75,
  F7: 0x76, F8: 0x77, F9: 0x78, F10: 0x79, F11: 0x7a, F12: 0x7b,
  NumLock: 0x90, ScrollLock: 0x91,
  Semicolon: 0xba, Equal: 0xbb, Comma: 0xbc, Minus: 0xbd, Period: 0xbe,
  Slash: 0xbf, Backquote: 0xc0, BracketLeft: 0xdb, Backslash: 0xdc, BracketRight: 0xdd, Quote: 0xde,
};

function clampInt(val, min, max, fallback = 0) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function findNativeCoreBinary() {
  const candidates = [];
  if (app && app.isPackaged && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', 'pulse-native-core.exe'));
  }
  candidates.push(path.join(__dirname, 'bin', 'pulse-native-core.exe'));
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

class WindowsRemoteController {
  constructor() {
    this.proc = null;
    this.ready = false;
    this.enabled = false;
    this.targetDisplayId = null;
    this.vigemStatus = 'unknown'; // 'ok' | 'no_driver' | 'no_dll' | 'unknown'
    this.lineBuf = '';
    this.procWaiters = [];
    this.vigemWaiters = [];
    this.onRumble = null;
    this.onStatusChange = null;
    this.onHostActivity = null;
    this.hostActive = false;
    this.hostPriority = true; // host tem prioridade: enquanto ele mexe, o input remoto é ignorado
  }

  getStatus() {
    return {
      enabled: this.enabled,
      ready: this.ready,
      vigemStatus: this.vigemStatus,
      hostActive: this.hostActive,
      hostPriority: this.hostPriority,
    };
  }

  setHostPriority(enabled) {
    this.hostPriority = Boolean(enabled);
    if (!this.enabled) return;
    if (this.hostPriority) this.sendRaw('PRIORITY_ON 1500');
    else {
      this.sendRaw('PRIORITY_OFF');
      this.setHostActive(false);
    }
  }

  setHostActive(active) {
    if (this.hostActive === active) return;
    this.hostActive = active;
    this.onHostActivity?.(active);
  }

  getTargetBounds() {
    const displays = screen.getAllDisplays();
    let display = screen.getPrimaryDisplay();
    if (this.targetDisplayId) {
      const found = displays.find((d) => String(d.id) === String(this.targetDisplayId));
      if (found) display = found;
    }
    const sf = display.scaleFactor || 1;
    return {
      x: Math.round(display.bounds.x * sf),
      y: Math.round(display.bounds.y * sf),
      width: Math.round(display.bounds.width * sf),
      height: Math.round(display.bounds.height * sf),
    };
  }

  ensureDaemon() {
    if (process.platform !== 'win32') return false;
    if (this.proc && !this.proc.killed) return true;

    const binPath = findNativeCoreBinary();
    if (!binPath) return false;

    this.ready = false;
    this.lineBuf = '';
    this.proc = spawn(binPath, [], {
      cwd: path.dirname(binPath),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    // Evita "Uncaught Exception: write EPIPE" quando o helper nativo encerra antes do app
    const swallow = () => {};
    this.proc.stdin?.on('error', swallow);
    this.proc.stdout?.on('error', swallow);

    this.proc.stdout.on('data', (chunk) => {
      this.lineBuf += chunk.toString('utf8');
      let nlIdx;
      while ((nlIdx = this.lineBuf.indexOf('\n')) !== -1) {
        const line = this.lineBuf.slice(0, nlIdx).trim();
        this.lineBuf = this.lineBuf.slice(nlIdx + 1);
        this.handleStdoutLine(line);
      }
    });

    this.proc.on('exit', () => {
      this.proc = null;
      this.ready = false;
      this.setHostActive(false);
      this.lineBuf = '';
      while (this.procWaiters.length) {
        const w = this.procWaiters.shift();
        w.resolve(null);
      }
      while (this.vigemWaiters.length) {
        const w = this.vigemWaiters.shift();
        w.resolve(this.vigemStatus);
      }
    });

    this.proc.on('error', () => {
      this.proc = null;
      this.ready = false;
    });

    return true;
  }

  normalizeViGEmState(raw) {
    const s = String(raw || '').toUpperCase();
    if (s === 'OK') return 'ok';
    if (s === 'NO_DRIVER') return 'no_driver';
    if (s === 'NO_DLL') return 'no_dll';
    return 'unknown';
  }

  handleStdoutLine(line) {
    if (!line) return;
    if (line.startsWith('READY')) {
      this.ready = true;
      const m = /vigem=(\S+)/i.exec(line);
      if (m) {
        this.vigemStatus = this.normalizeViGEmState(m[1]);
        this.onStatusChange?.(this.getStatus());
      }
    } else if (line.startsWith('VIGEM ')) {
      this.vigemStatus = this.normalizeViGEmState(line.slice(6));
      this.onStatusChange?.(this.getStatus());
      while (this.vigemWaiters.length) {
        const w = this.vigemWaiters.shift();
        w.resolve(this.vigemStatus);
      }
    } else if (line === 'HOST_ACTIVE') {
      // Host pegou o mouse/teclado: solta tudo que o controle remoto estava segurando
      this.sendRaw('RELEASE_KM');
      this.setHostActive(true);
    } else if (line === 'HOST_IDLE') {
      this.setHostActive(false);
    } else if (line.startsWith('RUMBLE ')) {
      const parts = line.split(' ');
      const slot = Number(parts[1] || 0);
      const large = Number(parts[2] || 0);
      const small = Number(parts[3] || 0);
      this.onRumble?.({ slot, large, small });
    } else if (line.startsWith('PROCS ')) {
      const raw = line.slice(6);
      const list = raw ? raw.split('|').filter(Boolean) : [];
      const waiter = this.procWaiters.shift();
      waiter?.resolve(list);
    }
  }

  sendRaw(line) {
    const stdin = this.proc?.stdin;
    if (!this.proc || !stdin || this.proc.killed || this.proc.exitCode !== null) return false;
    if (stdin.destroyed || stdin.writableEnded || !stdin.writable) return false;
    try {
      this.proc.stdin.write(`${line}\n`);
      return true;
    } catch {
      return false;
    }
  }

  start(displayId = null) {
    if (process.platform !== 'win32') return false;
    this.targetDisplayId = displayId;
    this.enabled = true;
    const ok = this.ensureDaemon();
    if (ok && this.hostPriority) this.sendRaw('PRIORITY_ON 1500');
    return ok;
  }

  stop() {
    this.enabled = false;
    if (this.proc && !this.proc.killed) {
      this.sendRaw('PRIORITY_OFF');
      this.sendRaw('RELEASE_ALL');
      for (let slot = 0; slot < 4; slot++) {
        this.sendRaw(`GP_OFF ${slot}`);
      }
    }
  }

  shutdown() {
    this.stop();
    if (this.proc) {
      const p = this.proc;
      try {
        p.stdin?.end();
      } catch {}
      try {
        p.kill();
      } catch {}
      this.proc = null;
      this.ready = false;
    }
  }

  disconnectGamepad(slot = 0) {
    const s = clampInt(slot, 0, 3, 0);
    this.sendRaw(`GP_OFF ${s}`);
  }

  retryViGEm() {
    if (!this.ensureDaemon()) return Promise.resolve('no_dll');
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.vigemStatus), 3000);
      this.vigemWaiters.push({
        resolve: (st) => {
          clearTimeout(timer);
          resolve(st);
        },
      });
      this.sendRaw('VIGEM_RETRY');
    });
  }

  scanProcesses() {
    if (!this.ensureDaemon()) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      this.procWaiters.push({
        resolve: (list) => {
          clearTimeout(timer);
          resolve(list);
        },
      });
      if (!this.sendRaw('SCAN_PROCS')) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  sendLine(line) {
    if (!this.enabled) return;
    this.sendRaw(line);
  }

  handleInput(evt, permissions = null) {
    if (!this.enabled || !evt || typeof evt !== 'object') return;
    const allowMouse = permissions ? Boolean(permissions.mouse) : true;
    const allowKeyboard = permissions ? Boolean(permissions.keyboard) : true;
    const allowGamepad = permissions ? Boolean(permissions.gamepad) : true;

    if (evt.type === 'mousemove' || evt.type === 'mousedown' || evt.type === 'mouseup') {
      if (!allowMouse) return;
      const bounds = this.getTargetBounds();
      if (typeof evt.nx === 'number' && typeof evt.ny === 'number') {
        const clampedX = Math.max(0, Math.min(1, evt.nx));
        const clampedY = Math.max(0, Math.min(1, evt.ny));
        const px = Math.round(bounds.x + clampedX * bounds.width);
        const py = Math.round(bounds.y + clampedY * bounds.height);
        this.sendLine(`M ${px} ${py}`);
      }
      if (evt.type === 'mousedown') {
        const btn = clampInt(evt.button, 0, 4, 0);
        this.sendLine(`MD ${btn}`);
      } else if (evt.type === 'mouseup') {
        const btn = clampInt(evt.button, 0, 4, 0);
        this.sendLine(`MU ${btn}`);
      }
    } else if (evt.type === 'mouserel') {
      if (!allowMouse) return;
      const dx = clampInt(evt.dx, -2000, 2000, 0);
      const dy = clampInt(evt.dy, -2000, 2000, 0);
      if (dx !== 0 || dy !== 0) {
        this.sendLine(`MR ${dx} ${dy}`);
      }
    } else if (evt.type === 'wheel') {
      if (!allowMouse) return;
      const deltaY = Number(evt.deltaY || 0);
      const wheelDelta = deltaY > 0 ? -120 : 120;
      this.sendLine(`W ${wheelDelta}`);
    } else if (evt.type === 'keydown' || evt.type === 'keyup') {
      if (!allowKeyboard) return;
      const vk = CODE_TO_VK[evt.code];
      if (!vk) return;
      this.sendLine(`${evt.type === 'keydown' ? 'KD' : 'KU'} ${vk}`);
    } else if (evt.type === 'gamepad') {
      if (!allowGamepad) return;
      const slot = clampInt(evt.slot, 0, 3, 0);
      const mask = clampInt(evt.buttonsMask, 0, 65535, 0);
      const lt = clampInt(evt.lt, 0, 255, 0);
      const rt = clampInt(evt.rt, 0, 255, 0);
      const lx = clampInt(evt.lx, -32768, 32767, 0);
      const ly = clampInt(evt.ly, -32768, 32767, 0);
      const rx = clampInt(evt.rx, -32768, 32767, 0);
      const ry = clampInt(evt.ry, -32768, 32767, 0);
      this.sendLine(`GP ${slot} ${mask} ${lt} ${rt} ${lx} ${ly} ${rx} ${ry}`);
    }
  }
}

module.exports = { WindowsRemoteController };
