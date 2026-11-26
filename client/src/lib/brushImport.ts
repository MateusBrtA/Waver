// Importa pontas de pincel de arquivos do próprio usuário:
//  - .png / .jpg / .webp (preto no branco ou desenho com transparência)
//  - .gbr / .gih (GIMP e Krita)
//  - .bundle / .zip (pacotes do Krita: usa as pontas da pasta brushes/)
// Tudo vira uma máscara PNG pequena (branco + transparência) que vai para a biblioteca da sala.

export interface ImportedTip {
  name: string;
  tip: string; // data:image/png;base64
  spacing: number;
}

const MAX_SIDE = 128;
const MAX_CHARS = 110 * 1024;

function maskToDataUrl(alpha: Uint8ClampedArray, w: number, h: number) {
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = alpha[i];
  }
  src.getContext('2d')!.putImageData(img, 0, 0);
  let side = MAX_SIDE;
  for (;;) {
    const s = Math.min(1, side / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png');
    if (url.length <= MAX_CHARS || side <= 24) return url.length <= MAX_CHARS ? url : null;
    side = Math.round(side * 0.7);
  }
}

/** Imagem comum: usa a transparência se tiver; senão, quanto mais escuro mais tinta. */
async function tipFromImage(blob: Blob, name: string): Promise<ImportedTip | null> {
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return null;
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const d = x.getImageData(0, 0, w, h).data;
  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 250) {
      hasAlpha = true;
      break;
    }
  }
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    alpha[i] = hasAlpha ? d[i * 4 + 3] : 255 - lum;
  }
  const tip = maskToDataUrl(alpha, w, h);
  return tip ? { name, tip, spacing: 0.25 } : null;
}

/** .gbr (GIMP brush, versão 1 ou 2); devolve a ponta e onde ela termina no arquivo. */
function parseGbr(buf: Uint8Array, at = 0): { tip: ImportedTip | null; end: number } | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (at + 20 > buf.length) return null;
  const headerSize = dv.getUint32(at);
  const version = dv.getUint32(at + 4);
  const w = dv.getUint32(at + 8);
  const h = dv.getUint32(at + 12);
  const bytes = dv.getUint32(at + 16);
  if (!w || !h || w > 4096 || h > 4096 || (bytes !== 1 && bytes !== 4) || headerSize < 20 || headerSize > 4096) return null;
  let spacing = 25;
  let nameStart = at + 20;
  if (version === 2 || version === 3) {
    const magic = String.fromCharCode(buf[at + 20], buf[at + 21], buf[at + 22], buf[at + 23]);
    if (magic !== 'GIMP') return null;
    spacing = dv.getUint32(at + 24);
    nameStart = at + 28;
  }
  const nameBytes = buf.subarray(nameStart, at + headerSize);
  const name = new TextDecoder().decode(nameBytes).replace(/\0+$/, '').trim() || 'Pincel';
  const dataStart = at + headerSize;
  const end = dataStart + w * h * bytes;
  if (end > buf.length) return null;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = bytes === 1 ? buf[dataStart + i] : buf[dataStart + i * 4 + 3];
  const tip = maskToDataUrl(alpha, w, h);
  return { tip: tip ? { name: name.slice(0, 40), tip, spacing: Math.max(0.02, Math.min(3, spacing / 100)) } : null, end };
}

/** .gih (pincel animado do GIMP): duas linhas de texto e depois vários .gbr; usa o primeiro. */
function parseGih(buf: Uint8Array, fallbackName: string) {
  let lines = 0;
  let i = 0;
  while (i < buf.length && lines < 2) if (buf[i++] === 10) lines++;
  const r = parseGbr(buf, i);
  if (r?.tip && r.tip.name === 'Pincel') r.tip.name = fallbackName;
  return r?.tip || null;
}

/** Lê um .zip (.bundle do Krita é um zip) sem bibliotecas: diretório central + DecompressionStream. */
async function unzip(buf: Uint8Array, want: (name: string) => boolean, max = 40) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return [];
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Array<{ name: string; data: Uint8Array }> = [];
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (!want(name) || usize > 32 * 1024 * 1024 || out.length >= max) continue;
    if (dv.getUint32(local, true) !== 0x04034b50) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = buf.subarray(start, start + csize);
    let data: Uint8Array | null = null;
    if (method === 0) data = raw;
    else if (method === 8 && typeof DecompressionStream !== 'undefined') {
      const ds = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(ds).arrayBuffer());
    }
    if (data) out.push({ name, data });
  }
  return out;
}

const baseName = (n: string) => n.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '').slice(0, 40) || 'Pincel';

async function tipsFromBytes(name: string, data: Uint8Array): Promise<ImportedTip[]> {
  const ext = name.toLowerCase().split('.').pop() || '';
  if (ext === 'gbr') {
    const r = parseGbr(data);
    if (r?.tip && r.tip.name === 'Pincel') r.tip.name = baseName(name);
    return r?.tip ? [r.tip] : [];
  }
  if (ext === 'gih') {
    const t = parseGih(data, baseName(name));
    return t ? [t] : [];
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ext)) {
    const t = await tipFromImage(new Blob([data as Uint8Array<ArrayBuffer>]), baseName(name));
    return t ? [t] : [];
  }
  if (ext === 'bundle' || ext === 'zip') {
    // no pacote do Krita as pontas ficam em brushes/ (os .kpp são predefinições do motor do Krita)
    const entries = await unzip(data, (n) => /(^|\/)brushes\/.+\.(gbr|gih|png)$/i.test(n) || (ext === 'zip' && /\.(gbr|gih|png)$/i.test(n)));
    const out: ImportedTip[] = [];
    for (const e of entries) out.push(...(await tipsFromBytes(e.name, e.data)));
    return out;
  }
  return [];
}

export async function importBrushFiles(files: File[]): Promise<{ tips: ImportedTip[]; skipped: string[] }> {
  const tips: ImportedTip[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (f.size > 200 * 1024 * 1024) {
      skipped.push(f.name);
      continue;
    }
    const got = await tipsFromBytes(f.name, new Uint8Array(await f.arrayBuffer())).catch(() => []);
    if (!got.length) skipped.push(f.name);
    tips.push(...got);
  }
  return { tips, skipped };
}
