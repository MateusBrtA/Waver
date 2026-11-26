// Atualização automática pelo GitHub Releases.
//
// Ao abrir (e de tempos em tempos) o app pergunta ao GitHub qual é a última versão publicada. Se for mais nova,
// baixa o .exe em segundo plano, devagar e parando durante chamadas, confere a assinatura oficial (Ed25519) e o
// SHA-256, e só então avisa que a atualização está pronta. Quem decide a hora de instalar é a pessoa.
//
// O GitHub é tratado como um "caminhão de entrega" não confiável: o que vale é a assinatura feita com a chave
// privada de quem publica o PulseCord (que nunca vai para o GitHub). Release alterada, arquivo trocado ou versão
// mais velha = recusado.
//
// Este módulo não depende do Electron (main.js injeta tudo), para poder ser testado com um GitHub falso.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// nomes do .exe na release (o primeiro é o atual; o outro é o nome antigo, do tempo em que o app era PulseCord)
const EXE_NAMES = {
  portable: ['Waver-Portable.exe', 'PulseCord-Portable.exe'],
  setup: ['Waver-Setup.exe', 'PulseCord-Setup.exe'],
};
const MAX_SIG_BYTES = 8 * 1024;
const MAX_EXE_BYTES = 700 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

class GithubUpdater {
  /**
   * @param {object} o
   * @param {string} o.repo                 "dono/repositorio"
   * @param {string} o.currentVersion       versão deste app
   * @param {'portable'|'setup'} o.kind     qual .exe baixar
   * @param {string} o.downloadDir          onde guardar o download
   * @param {(sig:object, current:string)=>{kind:string,version:string,sha256:string}} o.verifySignature  lança se inválida
   * @param {(a:string,b:string)=>number} o.compareVersions
   * @param {()=>boolean} [o.isBusy]        true = pausa o download (ex.: em chamada)
   * @param {number} [o.maxBytesPerSec]     limite de velocidade do download
   * @param {(state:object)=>void} [o.onState]
   */
  constructor(o) {
    this.repo = String(o.repo || '');
    this.apiBase = (o.apiBase || 'https://api.github.com').replace(/\/+$/, '');
    this.currentVersion = String(o.currentVersion || '0.0.0');
    this.kind = o.kind === 'setup' ? 'setup' : 'portable';
    this.downloadDir = o.downloadDir;
    this.verifySignature = o.verifySignature;
    this.compareVersions = o.compareVersions;
    this.isBusy = o.isBusy || (() => false);
    this.maxBytesPerSec = o.maxBytesPerSec ?? 3 * 1024 * 1024;
    this.fetch = o.fetchImpl || globalThis.fetch;
    this.log = o.log || (() => {});
    this.onState = o.onState || (() => {});
    this.busyPollMs = o.busyPollMs ?? 5000;
    this.state = { status: 'idle' };
    this.etag = null;
    this.cachedRelease = null;
    this.running = null;
    this.timers = [];
    this.abort = null;
  }

  setState(s) {
    this.state = s;
    try {
      this.onState(s);
    } catch {}
  }

  /** Apaga downloads de versões iguais ou mais velhas que a instalada (o .exe já aplicado ocupa ~85 MB). */
  cleanupInstalled() {
    let names = [];
    try {
      names = fs.readdirSync(this.downloadDir);
    } catch {
      return;
    }
    for (const name of names) {
      const m = /^(?:Waver|PulseCord)-(\d[\w.]*)-(?:portable|setup)\.exe(?:\.part(?:\.json)?)?$/.exec(name);
      if (m && this.compareVersions(m[1], this.currentVersion) <= 0) {
        fs.rmSync(path.join(this.downloadDir, name), { force: true });
      }
    }
  }

  start({ firstDelayMs = 30_000, intervalMs = 4 * 60 * 60 * 1000 } = {}) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(this.repo)) return;
    this.cleanupInstalled();
    const t1 = setTimeout(() => this.checkNow().catch(() => {}), firstDelayMs);
    const t2 = setInterval(() => this.checkNow().catch(() => {}), intervalMs);
    t1.unref?.();
    t2.unref?.();
    this.timers.push(t1, t2);
  }

  stop() {
    for (const t of this.timers) clearTimeout(t), clearInterval(t);
    this.timers = [];
    this.abort?.abort();
  }

  /** Uma verificação por vez; chamadas durante uma verificação esperam a mesma. */
  checkNow() {
    if (!this.running) this.running = this.check().finally(() => (this.running = null));
    return this.running;
  }

  async check() {
    const rel = await this.fetchLatestRelease();
    if (!rel) return this.state;
    const tagVersion = String(rel.tag_name || '').replace(/^v/i, '');
    // filtro rápido pelo nome da tag (evita baixar à toa); a decisão de verdade é a versão ASSINADA
    if (!tagVersion || this.compareVersions(tagVersion, this.currentVersion) <= 0) return this.state;
    if (this.state.status === 'ready' && this.state.version === tagVersion) return this.state;

    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const exeName = EXE_NAMES[this.kind].find((n) => assets.some((a) => a?.name === n)) || EXE_NAMES[this.kind][0];
    const exeAsset = assets.find((a) => a?.name === exeName);
    const sigAsset = assets.find((a) => a?.name === `${exeName}.sig.json`);
    if (!exeAsset || !sigAsset) {
      this.log(`[update] release ${rel.tag_name} sem ${exeName} e/ou a assinatura dele`);
      return this.state;
    }

    let signed;
    try {
      const sigText = await this.fetchSmallText(sigAsset.browser_download_url, MAX_SIG_BYTES);
      signed = this.verifySignature(JSON.parse(sigText), this.currentVersion);
      if (signed.kind !== this.kind) throw new Error('A assinatura não é deste tipo de .exe.');
    } catch (err) {
      this.log(`[update] release ${rel.tag_name} recusada: ${err?.message || err}`);
      this.setState({ status: 'error', error: err?.message || String(err) });
      return this.state;
    }

    const notes = String(rel.body || '').slice(0, 4000);
    fs.mkdirSync(this.downloadDir, { recursive: true });
    const finalPath = path.join(this.downloadDir, `Waver-${signed.version}-${this.kind}.exe`);
    try {
      if (fs.existsSync(finalPath) && (await sha256OfFile(finalPath)) === signed.sha256) {
        return this.markReady(signed.version, finalPath, notes);
      }
      fs.rmSync(finalPath, { force: true });
      await this.download(exeAsset, signed, finalPath);
      return this.markReady(signed.version, finalPath, notes);
    } catch (err) {
      this.log(`[update] download da ${signed.version} falhou: ${err?.message || err}`);
      this.setState({ status: 'error', version: signed.version, error: err?.message || String(err) });
      return this.state;
    }
  }

  /**
   * Baixa o .exe deste tipo da última release para instalar AGORA (ex.: "Instalar no PC" a partir do portátil).
   * Diferente da atualização, aceita a MESMA versão deste app; mais velha nunca (não deixa voltar para uma versão
   * com falha já corrigida). Assinatura, tipo e SHA-256 são conferidos do mesmo jeito.
   */
  async downloadForInstall() {
    const rel = await this.fetchLatestRelease();
    if (!rel) throw new Error('Não foi possível falar com o GitHub agora. Confira a internet e tente de novo.');
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const exeName = EXE_NAMES[this.kind].find((n) => assets.some((a) => a?.name === n));
    const exeAsset = exeName && assets.find((a) => a?.name === exeName);
    const sigAsset = exeName && assets.find((a) => a?.name === `${exeName}.sig.json`);
    if (!exeAsset || !sigAsset) throw new Error('A última versão publicada não tem o instalador.');
    const sig = JSON.parse(await this.fetchSmallText(sigAsset.browser_download_url, MAX_SIG_BYTES));
    const signed = this.verifySignature(sig, '0.0.0');
    if (signed.kind !== this.kind) throw new Error('A assinatura não é deste tipo de .exe.');
    if (this.compareVersions(signed.version, this.currentVersion) < 0) {
      throw new Error(`A versão publicada (${signed.version}) é mais velha que esta (${this.currentVersion}).`);
    }
    fs.mkdirSync(this.downloadDir, { recursive: true });
    const finalPath = path.join(this.downloadDir, `Waver-${signed.version}-${this.kind}-install.exe`);
    if (!(fs.existsSync(finalPath) && (await sha256OfFile(finalPath)) === signed.sha256)) {
      fs.rmSync(finalPath, { force: true });
      await this.download(exeAsset, signed, finalPath);
    }
    return { version: signed.version, path: finalPath };
  }

  markReady(version, file, notes) {
    // apaga downloads de versões anteriores
    for (const name of fs.readdirSync(this.downloadDir)) {
      const full = path.join(this.downloadDir, name);
      if (full !== file) fs.rmSync(full, { force: true, recursive: true });
    }
    this.setState({ status: 'ready', version, path: file, kind: this.kind, notes });
    return this.state;
  }

  async fetchLatestRelease() {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Waver-Updater',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    // com ETag, "nada mudou" volta 304 e não gasta o limite de consultas do GitHub
    if (this.etag && this.cachedRelease) headers['If-None-Match'] = this.etag;
    let resp;
    try {
      resp = await this.fetch(`${this.apiBase}/repos/${this.repo}/releases/latest`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      return null; // sem internet: tenta na próxima
    }
    if (resp.status === 304) return this.cachedRelease;
    // 404 = repositório privado/sem release; 403/429 = limite de consultas. Tudo silencioso.
    if (!resp.ok) return null;
    try {
      const rel = await resp.json();
      this.etag = resp.headers.get('etag');
      this.cachedRelease = rel;
      return rel;
    } catch {
      return null;
    }
  }

  async fetchSmallText(url, maxBytes) {
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Endereço do arquivo inválido.');
    const resp = await this.fetch(url, { headers: { 'User-Agent': 'Waver-Updater' }, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('Arquivo de assinatura grande demais.');
    return buf.toString('utf8');
  }

  async download(asset, signed, finalPath) {
    const url = String(asset.browser_download_url || '');
    if (!/^https?:\/\//i.test(url)) throw new Error('Endereço do .exe inválido.');
    const expectedSize = Number(asset.size) || 0;
    if (expectedSize > MAX_EXE_BYTES) throw new Error('Arquivo grande demais.');

    const part = `${finalPath}.part`;
    const partMeta = `${part}.json`;
    // um .part de outro build (outro sha256) não serve para continuar
    try {
      if (JSON.parse(fs.readFileSync(partMeta, 'utf8')).sha256 !== signed.sha256) fs.rmSync(part, { force: true });
    } catch {
      fs.rmSync(part, { force: true });
    }
    fs.writeFileSync(partMeta, JSON.stringify({ sha256: signed.sha256 }));

    let start = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (expectedSize && start >= expectedSize) {
      fs.rmSync(part, { force: true });
      start = 0;
    }
    const hash = crypto.createHash('sha256');
    if (start > 0) {
      await new Promise((resolve, reject) =>
        fs.createReadStream(part).on('data', (d) => hash.update(d)).on('error', reject).on('end', resolve)
      );
    }

    this.abort = new AbortController();
    const headers = { 'User-Agent': 'Waver-Updater' };
    if (start > 0) headers.Range = `bytes=${start}-`;
    const resp = await this.fetch(url, { headers, signal: this.abort.signal });
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
    if (start > 0 && resp.status !== 206) {
      // o servidor não continuou de onde parou: começa do zero
      return this.consume(resp, crypto.createHash('sha256'), 0, signed, part, partMeta, finalPath, expectedSize, 'w');
    }
    return this.consume(resp, hash, start, signed, part, partMeta, finalPath, expectedSize, start > 0 ? 'a' : 'w');
  }

  async consume(resp, hash, loaded, signed, part, partMeta, finalPath, expectedSize, flags) {
    const out = fs.createWriteStream(part, { flags });
    const write = (buf) => new Promise((res, rej) => out.write(buf, (e) => (e ? rej(e) : res())));
    const reader = resp.body.getReader();
    const t0 = Date.now();
    let sessionBytes = 0;
    let pausedMs = 0;
    let lastState = 0;
    try {
      while (true) {
        // em chamada: espera (o resto do download continua depois, do mesmo ponto)
        while (this.isBusy()) {
          if (this.state.status !== 'paused') this.setState({ status: 'paused', version: signed.version, loaded, total: expectedSize });
          const p0 = Date.now();
          await sleep(this.busyPollMs);
          pausedMs += Date.now() - p0;
        }
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        await write(buf);
        hash.update(buf);
        loaded += buf.length;
        sessionBytes += buf.length;
        if (loaded > (expectedSize || MAX_EXE_BYTES) + 1024) throw new Error('O arquivo veio maior do que o anunciado.');
        // limite de velocidade: não disputa a internet com o resto do PC
        if (this.maxBytesPerSec > 0) {
          const ahead = (sessionBytes / this.maxBytesPerSec) * 1000 - (Date.now() - t0 - pausedMs);
          if (ahead > 20) await sleep(ahead);
        }
        if (Date.now() - lastState > 1000) {
          lastState = Date.now();
          this.setState({ status: 'downloading', version: signed.version, loaded, total: expectedSize });
        }
      }
    } finally {
      await new Promise((res) => out.end(res));
      this.abort = null;
    }
    const actual = hash.digest('hex');
    if (actual !== signed.sha256) {
      fs.rmSync(part, { force: true });
      fs.rmSync(partMeta, { force: true });
      throw new Error('O arquivo baixado não confere com a assinatura (SHA-256). Download descartado.');
    }
    fs.renameSync(part, finalPath);
    fs.rmSync(partMeta, { force: true });
  }
}

module.exports = { GithubUpdater, EXE_NAMES };
