// Proxy com a mesma interface do servidor embutido (start/stop/setServerMeta/setServerPassword),
// mas o servidor roda num utilityProcess separado (ver hostWorker.js).
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { utilityProcess } = require('electron');

class HostProcessServer extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.child = null;
    this.spawned = null;
    this.pending = new Map();
    this.seq = 0;
    this.stopping = false;
    this.isUtility = true;
  }

  ensureChild() {
    if (this.spawned) return this.spawned;
    const child = utilityProcess.fork(path.join(__dirname, 'hostWorker.js'), [], {
      serviceName: 'Waver Servidor',
      stdio: 'pipe',
    });
    this.child = child;
    const pipeLog = (stream, fn) =>
      stream?.on('data', (d) => {
        try {
          fn(String(d).trimEnd());
        } catch {}
      });
    pipeLog(child.stdout, (t) => console.log(t));
    pipeLog(child.stderr, (t) => console.error(t));
    child.on('message', (m) => {
      const p = this.pending.get(m?.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(Object.assign(new Error(m.error?.message || 'Erro no servidor.'), { code: m.error?.code }));
    });
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      this.spawned = null;
      for (const p of this.pending.values()) {
        p.reject(Object.assign(new Error('O processo do servidor fechou.'), { code: 'HOST_EXITED' }));
      }
      this.pending.clear();
      if (!this.stopping) this.emit('crash', code);
    });
    this.spawned = new Promise((resolve, reject) => {
      child.once('spawn', () => resolve(child));
      child.once('exit', (code) => reject(Object.assign(new Error(`O processo do servidor não abriu (código ${code}).`), { code: 'HOST_SPAWN_FAILED' })));
    });
    this.spawned.catch(() => {});
    return this.spawned;
  }

  async call(cmd, args, timeoutMs = 30000) {
    const child = await this.ensureChild();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error('O servidor não respondeu.'), { code: 'HOST_TIMEOUT' }));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.postMessage({ id, cmd, args });
    });
  }

  async start(port) {
    this.stopping = false;
    try {
      return await this.call('start', { options: this.options, port }, 60000);
    } catch (err) {
      this.kill();
      throw err;
    }
  }

  async stop() {
    if (!this.child) return;
    this.stopping = true;
    try {
      await this.call('stop', null, 8000);
    } catch {}
    this.kill();
  }

  kill() {
    this.stopping = true;
    try {
      this.child?.kill();
    } catch {}
    this.child = null;
    this.spawned = null;
  }

  setServerMeta(meta) {
    return this.call('setServerMeta', meta).catch(() => null);
  }

  setServerPassword(password) {
    return this.call('setServerPassword', password).catch(() => null);
  }
}

module.exports = { HostProcessServer };
