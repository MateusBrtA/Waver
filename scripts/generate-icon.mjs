import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIZE = 256;

// Minimal CRC32 for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter None
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

function buildIcoFromPng(pngBuf, size = 256) {
  // ICO header (6 bytes) + 1 directory entry (16 bytes) + PNG payload
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = ICO
  header.writeUInt16LE(1, 4); // count = 1
  header[6] = size >= 256 ? 0 : size; // width (0 means 256)
  header[7] = size >= 256 ? 0 : size; // height
  header[8] = 0; // colors
  header[9] = 0; // reserved
  header.writeUInt16LE(1, 10); // color planes
  header.writeUInt16LE(32, 12); // bpp
  header.writeUInt32LE(pngBuf.length, 14); // image size
  header.writeUInt32LE(22, 18); // image offset
  return Buffer.concat([header, pngBuf]);
}

function distToRoundedRect(x, y, cx, cy, halfW, halfH, r) {
  const dx = Math.max(Math.abs(x - cx) - (halfW - r), 0);
  const dy = Math.max(Math.abs(y - cy) - (halfH - r), 0);
  return Math.hypot(dx, dy) - r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);
  const t = c1 / c2;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function renderIcon() {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  // Audio pulse polyline inside the badge
  const pts = [
    [48, 134],
    [82, 134],
    [98, 92],
    [118, 174],
    [140, 74],
    [160, 156],
    [176, 134],
    [208, 134],
  ];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = (y * SIZE + x) * 4;
      const dRect = distToRoundedRect(x, y, cx, cy, 114, 114, 52);
      if (dRect > 1.5) continue;

      const edgeAlpha = Math.max(0, Math.min(1, 0.5 - dRect));

      // Vibrant blurple-to-indigo diagonal gradient
      const g = (x + y) / (SIZE * 2);
      let r = Math.round(98 * (1 - g) + 60 * g);
      let gr = Math.round(114 * (1 - g) + 69 * g);
      let b = Math.round(248 * (1 - g) + 185 * g);

      // Subtle inner highlight ring
      const dRing = Math.abs(dRect + 10);
      if (dRing < 2.2) {
        const ringMix = (1 - dRing / 2.2) * 0.22;
        r = Math.round(r * (1 - ringMix) + 255 * ringMix);
        gr = Math.round(gr * (1 - ringMix) + 255 * ringMix);
        b = Math.round(b * (1 - ringMix) + 255 * ringMix);
      }

      // Live emerald indicator dot in top-right
      const dDot = Math.hypot(x - 190, y - 68) - 14;
      if (dDot < 1.5) {
        const dotMix = Math.max(0, Math.min(1, 0.5 - dDot));
        r = Math.round(r * (1 - dotMix) + 52 * dotMix);
        gr = Math.round(gr * (1 - dotMix) + 211 * dotMix);
        b = Math.round(b * (1 - dotMix) + 120 * dotMix);
      }

      // Crisp white audio pulse waveform
      let minSeg = 9999;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        if (d < minSeg) minSeg = d;
      }
      const stroke = minSeg - 9.5;
      if (stroke < 1.5) {
        const wMix = Math.max(0, Math.min(1, 0.5 - stroke));
        r = Math.round(r * (1 - wMix) + 255 * wMix);
        gr = Math.round(gr * (1 - wMix) + 255 * wMix);
        b = Math.round(b * (1 - wMix) + 255 * wMix);
      }

      buf[idx] = r;
      buf[idx + 1] = gr;
      buf[idx + 2] = b;
      buf[idx + 3] = Math.round(edgeAlpha * 255);
    }
  }
  return buf;
}

const outDir = path.join(__dirname, '..', 'electron');
fs.mkdirSync(outDir, { recursive: true });

const rgba = renderIcon();
const png = encodePng(SIZE, SIZE, rgba);
const ico = buildIcoFromPng(png, SIZE);

fs.writeFileSync(path.join(outDir, 'icon.png'), png);
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('[Icon] Gerados electron/icon.png e electron/icon.ico com sucesso!');
