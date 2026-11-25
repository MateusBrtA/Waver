const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

function resolveLoopbackBinary() {
  if (process.platform !== 'win32') return null;
  const candidates = [];
  if (app.isPackaged && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', 'pulse-loopback.exe'));
  }
  candidates.push(path.join(__dirname, 'bin', 'pulse-loopback.exe'));
  return candidates.find((p) => fs.existsSync(p)) || null;
}

class ProcessLoopbackCapture {
  constructor() {
    this.proc = null;
    this.pendingBuf = Buffer.alloc(0);
  }

  start(onPcmChunk) {
    this.stop();
    if (process.platform !== 'win32') {
      return Promise.resolve({ ok: false, error: 'WASAPI loopback disponível apenas no Windows.' });
    }
    const bin = resolveLoopbackBinary();
    if (!bin) {
      return Promise.resolve({ ok: false, error: 'pulse-loopback.exe não encontrado.' });
    }

    return new Promise((resolve) => {
      let settled = false;
      let errBuf = '';
      this.pendingBuf = Buffer.alloc(0);

      const child = spawn(bin, [String(process.pid)], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc = child;
      const swallow = () => {};
      child.stdin?.on('error', swallow);
      child.stdout?.on('error', swallow);
      child.stderr?.on('error', swallow);

      const finish = (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!res.ok) this.stop();
        resolve(res);
      };

      const timer = setTimeout(() => {
        finish({ ok: false, error: 'Timeout iniciando captura loopback WASAPI.' });
      }, 2800);

      child.stderr.on('data', (chunk) => {
        errBuf += chunk.toString('utf8');
        if (!settled && errBuf.includes('READY')) {
          finish({ ok: true, sampleRate: 48000, channels: 2 });
        } else if (!settled && errBuf.includes('ERR:')) {
          finish({ ok: false, error: errBuf.trim() });
        }
      });

      // Slice output into exact 20ms stereo 48kHz Int16 frames (3840 bytes = 960 frames * 4 bytes)
      const FRAME_BYTES = 3840;
      child.stdout.on('data', (data) => {
        this.pendingBuf = this.pendingBuf.length ? Buffer.concat([this.pendingBuf, data]) : data;
        while (this.pendingBuf.length >= FRAME_BYTES) {
          const frame = Buffer.from(this.pendingBuf.subarray(0, FRAME_BYTES));
          this.pendingBuf = this.pendingBuf.subarray(FRAME_BYTES);
          onPcmChunk?.(frame);
        }
      });

      child.on('error', (err) => {
        finish({ ok: false, error: err?.message || 'Erro no helper WASAPI.' });
      });

      child.on('exit', (code) => {
        if (this.proc === child) this.proc = null;
        if (!settled) {
          finish({ ok: false, error: errBuf.trim() || `Helper encerrou com código ${code}` });
        }
      });
    });
  }

  stop() {
    this.pendingBuf = Buffer.alloc(0);
    if (!this.proc) return;
    const p = this.proc;
    this.proc = null;
    try {
      p.stdin?.end();
    } catch {}
    setTimeout(() => {
      try {
        if (!p.killed) p.kill();
      } catch {}
    }, 150);
  }
}

module.exports = { ProcessLoopbackCapture, resolveLoopbackBinary };
