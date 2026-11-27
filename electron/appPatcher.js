// Baixa a atualização leve (ver appPack.js): compara o índice assinado da última release com os arquivos do app
// que está rodando e busca no waver-app.pack (HTTP Range) só o que mudou. Arquivos iguais são copiados daqui
// mesmo. O resultado vai para app-live/<versão> e o boot.js abre de lá na próxima vez.
// Sem dependência do Electron (testável com um GitHub falso).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const appPack = require('./appPack');

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_PACK_BYTES = 200 * 1024 * 1024;
// pedaços próximos no .pack vão num pedido só (menos idas e voltas na internet ruim)
const MERGE_GAP = 64 * 1024;
const MAX_RANGE = 8 * 1024 * 1024;

class AppPatcher {
  /**
   * @param {object} o
   * @param {string} o.runtime          identidade do motor deste .exe (build-info.json)
   * @param {object} o.publicKey        chave pública oficial (KeyObject)
   * @param {string} o.activeRoot       pasta do código em uso (app.asar ou app-live/<versão>)
   * @param {string} o.liveRoot         %APPDATA%\PulseCord\app-live
   * @param {string} o.currentVersion
   * @param {(a:string,b:string)=>number} o.compareVersions
   */
  constructor(o) {
    this.runtime = String(o.runtime || '');
    this.publicKey = o.publicKey;
    this.activeRoot = o.activeRoot;
    this.liveRoot = o.liveRoot;
    this.currentVersion = String(o.currentVersion || '0.0.0');
    this.compareVersions = o.compareVersions;
    this.fetch = o.fetchImpl || globalThis.fetch;
    this.log = o.log || (() => {});
  }

  async fetchManifest(asset) {
    const url = String(asset?.browser_download_url || '');
    if (!/^https?:\/\//i.test(url)) throw new Error('Endereço do índice inválido.');
    const resp = await this.fetch(url, { headers: { 'User-Agent': 'Waver-Updater' }, signal: AbortSignal.timeout(20000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_MANIFEST_BYTES) throw new Error('Índice grande demais.');
    return JSON.parse(buf.toString('utf8'));
  }

  /**
   * Prepara a atualização leve da release. Devolve null quando ela não serve (sem os arquivos na release, outro
   * motor, versão não mais nova) e o chamador usa o .exe completo.
   * @returns {Promise<null | {version:string, dir:string, renderOnly:boolean, bytes:number, files:number}>}
   */
  async prepare(rel, onProgress = () => {}) {
    const assets = Array.isArray(rel?.assets) ? rel.assets : [];
    const mAsset = assets.find((a) => a?.name === appPack.MANIFEST_NAME);
    const pAsset = assets.find((a) => a?.name === appPack.PACK_NAME);
    if (!mAsset || !pAsset || !this.runtime || !this.publicKey) return null;
    if ((Number(pAsset.size) || 0) > MAX_PACK_BYTES) return null;

    const m = await this.fetchManifest(mAsset);
    appPack.verifyManifest(m, this.publicKey);
    if (this.compareVersions(m.version, this.currentVersion) <= 0) return null;
    if (m.runtime !== this.runtime) {
      this.log(`[update] ${m.version} precisa do .exe completo (motor diferente)`);
      return null;
    }
    if (!/^\d+(\.\d+)*$/.test(m.version)) return null;

    const dir = path.join(this.liveRoot, m.version);
    const changed = [];
    // já preparada antes (ex.: o app fechou antes de reiniciar)
    try {
      const old = JSON.parse(fs.readFileSync(path.join(dir, appPack.MANIFEST_NAME), 'utf8'));
      if (old.sig === m.sig && appPack.verifyDir(dir, m)) {
        for (const [rel, f] of Object.entries(m.files)) if (!this.sameAsActive(rel, f)) changed.push(rel);
        return { version: m.version, dir, renderOnly: isRenderOnly(changed), bytes: 0, files: changed.length };
      }
    } catch {}

    const staging = `${dir}.staging`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const need = [];
    for (const [rel, f] of Object.entries(m.files)) {
      const buf = this.readActive(rel);
      if (buf && buf.length === f.s && appPack.sha256(buf) === f.h) {
        writeFile(staging, rel, buf);
      } else {
        need.push([rel, f]);
        changed.push(rel);
      }
    }

    const total = need.reduce((s, [, f]) => s + f.c, 0);
    let loaded = 0;
    onProgress(0, total);
    need.sort((a, b) => a[1].o - b[1].o);
    const groups = [];
    for (const item of need) {
      const g = groups[groups.length - 1];
      const end = item[1].o + item[1].c;
      if (g && item[1].o - g.end <= MERGE_GAP && end - g.start <= MAX_RANGE) {
        g.items.push(item);
        g.end = Math.max(g.end, end);
      } else {
        groups.push({ start: item[1].o, end, items: [item] });
      }
    }

    let whole = null; // o servidor ignorou o Range e mandou o .pack inteiro: usa ele para todo o resto
    const packUrl = String(pAsset.browser_download_url || '');
    if (!/^https?:\/\//i.test(packUrl)) throw new Error('Endereço do pacote inválido.');
    for (const g of groups) {
      let buf;
      let base;
      if (whole) {
        buf = whole;
        base = 0;
      } else {
        const resp = await this.fetch(packUrl, {
          headers: { 'User-Agent': 'Waver-Updater', Range: `bytes=${g.start}-${g.end - 1}` },
          signal: AbortSignal.timeout(120000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = Buffer.from(await resp.arrayBuffer());
        if (resp.status === 206) {
          buf = body;
          base = g.start;
        } else {
          if (body.length > MAX_PACK_BYTES) throw new Error('Pacote grande demais.');
          whole = body;
          buf = body;
          base = 0;
        }
      }
      for (const [rel, f] of g.items) {
        const slice = buf.subarray(f.o - base, f.o - base + f.c);
        if (slice.length !== f.c) throw new Error('Pedaço do pacote incompleto.');
        const out = zlib.brotliDecompressSync(slice, { maxOutputLength: Math.max(1, f.s) });
        if (out.length !== f.s || appPack.sha256(out) !== f.h) throw new Error(`Arquivo da atualização não confere: ${rel}`);
        writeFile(staging, rel, out);
        loaded += f.c;
        onProgress(loaded, total);
      }
    }

    fs.writeFileSync(path.join(staging, appPack.MANIFEST_NAME), JSON.stringify(m));
    if (!appPack.verifyDir(staging, m)) throw new Error('A atualização montada não confere.');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
    return { version: m.version, dir, renderOnly: isRenderOnly(changed), bytes: total, files: changed.length };
  }

  readActive(rel) {
    try {
      return fs.readFileSync(path.join(this.activeRoot, ...rel.split('/')));
    } catch {
      return null;
    }
  }

  sameAsActive(rel, f) {
    const buf = this.readActive(rel);
    return Boolean(buf && buf.length === f.s && appPack.sha256(buf) === f.h);
  }

  /**
   * Apaga versões leves que não servem mais (mais velhas que a em uso ou que o .exe) e restos de download.
   * onlyKeep: apaga TUDO que não estiver em keepVersions (ex.: chegou uma nova, as baixadas antes viram lixo).
   */
  cleanup(keepVersions = [], { onlyKeep = false } = {}) {
    let names = [];
    try {
      names = fs.readdirSync(this.liveRoot);
    } catch {
      return;
    }
    const keep = new Set(keepVersions.filter(Boolean));
    // a pasta de onde o processo principal está rodando nunca sai (depois de uma atualização só de interface, o
    // processo principal continua sendo o da versão anterior até reiniciar)
    const active = path.resolve(String(this.activeRoot || ''));
    if (path.dirname(active) === path.resolve(this.liveRoot)) keep.add(path.basename(active));
    for (const name of names) {
      const full = path.join(this.liveRoot, name);
      const isVersion = /^\d+(\.\d+)*$/.test(name);
      if (keep.has(name)) continue;
      if (onlyKeep || !isVersion || this.compareVersions(name, this.currentVersion) <= 0) {
        try {
          fs.rmSync(full, { recursive: true, force: true });
        } catch {}
      }
    }
  }
}

function writeFile(root, rel, buf) {
  const full = path.join(root, ...rel.split('/'));
  if (!full.startsWith(root + path.sep)) throw new Error('Caminho inválido.');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
}

/** só a interface mudou (package.json muda a versão sempre e não conta): dá para aplicar só recarregando a janela */
function isRenderOnly(changed) {
  const real = changed.filter((r) => r !== 'package.json');
  return real.length > 0 && real.every((r) => r.startsWith('client/dist/'));
}

module.exports = { AppPatcher, isRenderOnly };
