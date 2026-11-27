// Cópia local das mensagens dos canais de servidor: o canal abre na hora (mesmo sem internet) e depois é
// atualizado pelo servidor.
//  - um arquivo por canal, com as últimas mensagens (no máximo PER_CHANNEL), comprimido (brotli) e cifrado
//    (AES-256-GCM); o nome do arquivo é um hash (não diz qual servidor/canal é);
//  - a chave é aleatória, por instalação, e fica protegida pelo Windows (DPAPI, via safeStorage do Electron):
//    copiar a pasta para outro PC/usuário não abre nada;
//  - o arquivo só abre para o mesmo servidor + usuário + canal (vai junto na autenticação do GCM);
//  - limite total de espaço: os canais abertos há mais tempo saem primeiro.
// Sem dependência do Electron além do safeStorage injetado (testável).
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const MAGIC = Buffer.from('WMC1', 'ascii');
const PER_CHANNEL = 150;
const MAX_MESSAGE_JSON = 24 * 1024;
const MAX_FILES = 400;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

class MessageCache {
  /**
   * @param {object} o
   * @param {string} o.dir
   * @param {{isEncryptionAvailable:()=>boolean, encryptString:(s:string)=>Buffer, decryptString:(b:Buffer)=>string}} [o.safeStorage]
   * @param {()=>Buffer} [o.fallbackKey]  chave usada se o DPAPI não estiver disponível
   */
  constructor(o) {
    this.dir = o.dir;
    this.safeStorage = o.safeStorage || null;
    this.fallbackKey = o.fallbackKey || null;
    this.key = null;
    this.writes = 0;
  }

  getKey() {
    if (this.key) return this.key;
    fs.mkdirSync(this.dir, { recursive: true });
    const keyFile = path.join(this.dir, 'key.bin');
    const ss = this.safeStorage;
    const canDpapi = Boolean(ss && ss.isEncryptionAvailable());
    try {
      const raw = fs.readFileSync(keyFile);
      const kind = raw.subarray(0, 4).toString('ascii');
      let k = null;
      if (kind === 'DPK1' && canDpapi) {
        k = Buffer.from(ss.decryptString(raw.subarray(4)), 'base64');
      } else if (kind === 'FBK1' && this.fallbackKey) {
        const d = crypto.createDecipheriv('aes-256-gcm', this.fallbackKey(), raw.subarray(4, 16));
        d.setAuthTag(raw.subarray(16, 32));
        k = Buffer.concat([d.update(raw.subarray(32)), d.final()]);
      }
      if (k && k.length === 32) return (this.key = k);
    } catch {}
    // chave nova (as cópias antigas, se houver, deixam de abrir e são refeitas)
    this.clearFiles();
    const k = crypto.randomBytes(32);
    if (canDpapi) {
      fs.writeFileSync(keyFile, Buffer.concat([Buffer.from('DPK1'), ss.encryptString(k.toString('base64'))]));
    } else if (this.fallbackKey) {
      // sem DPAPI (raro): a chave fica cifrada com a chave do cofre local do app
      fs.writeFileSync(keyFile, wrapWithFallback(k, this.fallbackKey()));
    }
    // sem nenhum dos dois, a chave só vive na memória (o cache vale até fechar o app)
    return (this.key = k);
  }

  fileId(scope, channelId) {
    return crypto.createHash('sha256').update(`waver-msg-cache\n${scope}\n${channelId}`).digest('hex').slice(0, 40);
  }

  load(scope, channelId) {
    if (!validId(scope) || !validId(channelId)) return null;
    const id = this.fileId(scope, channelId);
    const file = path.join(this.dir, `${id}.bin`);
    let raw;
    try {
      raw = fs.readFileSync(file);
    } catch {
      return null;
    }
    try {
      if (raw.length < 33 || !raw.subarray(0, 4).equals(MAGIC)) return null;
      const d = crypto.createDecipheriv('aes-256-gcm', this.getKey(), raw.subarray(4, 16));
      d.setAAD(Buffer.from(id));
      d.setAuthTag(raw.subarray(16, 32));
      const plain = Buffer.concat([d.update(raw.subarray(32)), d.final()]);
      const json = JSON.parse(zlib.brotliDecompressSync(plain, { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8'));
      // marca como usado (a limpeza tira os mais antigos)
      const now = new Date();
      fs.utimes(file, now, now, () => {});
      return Array.isArray(json?.m) ? json.m : null;
    } catch {
      fs.rm(file, { force: true }, () => {});
      return null;
    }
  }

  save(scope, channelId, messages) {
    if (!validId(scope) || !validId(channelId) || !Array.isArray(messages)) return false;
    const list = [];
    for (const m of messages.slice(-PER_CHANNEL)) {
      if (!m || typeof m !== 'object') continue;
      let s;
      try {
        s = JSON.stringify(m);
      } catch {
        continue;
      }
      if (s.length <= MAX_MESSAGE_JSON) list.push(m); // mensagem gigante (ex.: imagem embutida) não entra
    }
    const id = this.fileId(scope, channelId);
    const file = path.join(this.dir, `${id}.bin`);
    const comp = zlib.brotliCompressSync(Buffer.from(JSON.stringify({ v: 1, m: list }), 'utf8'), {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    });
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.getKey(), iv);
    c.setAAD(Buffer.from(id));
    const enc = Buffer.concat([c.update(comp), c.final()]);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, Buffer.concat([MAGIC, iv, c.getAuthTag(), enc]));
    fs.renameSync(tmp, file);
    if (++this.writes % 20 === 1) this.prune();
    return true;
  }

  remove(scope, channelId) {
    if (!validId(scope) || !validId(channelId)) return;
    fs.rmSync(path.join(this.dir, `${this.fileId(scope, channelId)}.bin`), { force: true });
  }

  /** Mantém o total dentro do limite: apaga os canais abertos há mais tempo. */
  prune() {
    let entries = [];
    try {
      entries = fs
        .readdirSync(this.dir)
        .filter((n) => /^[a-f0-9]{40}\.bin$/.test(n))
        .map((n) => {
          const st = fs.statSync(path.join(this.dir, n));
          return { n, size: st.size, t: st.mtimeMs };
        })
        .sort((a, b) => b.t - a.t);
    } catch {
      return;
    }
    let total = 0;
    entries.forEach((e, i) => {
      total += e.size;
      if (i >= MAX_FILES || total > MAX_TOTAL_BYTES) fs.rmSync(path.join(this.dir, e.n), { force: true });
    });
  }

  clearFiles() {
    try {
      for (const n of fs.readdirSync(this.dir)) if (/\.bin(\.tmp)?$/.test(n) && n !== 'key.bin') fs.rmSync(path.join(this.dir, n), { force: true });
    } catch {}
  }

  /** Apaga tudo (ex.: sair da conta). */
  clearAll() {
    this.clearFiles();
  }
}

function validId(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 512;
}

function wrapWithFallback(k, fallback) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', fallback, iv);
  const enc = Buffer.concat([c.update(k), c.final()]);
  return Buffer.concat([Buffer.from('FBK1'), iv, c.getAuthTag(), enc]);
}

module.exports = { MessageCache, PER_CHANNEL };
