// Exportação do estúdio de arte: GIF animado e PSD em camadas, escritos à mão (sem dependências).

/* ------------------------------------------------------------------ bytes */

class ByteWriter {
  buf = new Uint8Array(1 << 16);
  len = 0;
  private grow(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  u8(v: number) {
    this.grow(1);
    this.buf[this.len++] = v & 0xff;
  }
  u16le(v: number) {
    this.u8(v);
    this.u8(v >> 8);
  }
  u16be(v: number) {
    this.u8(v >> 8);
    this.u8(v);
  }
  u32be(v: number) {
    this.u8(v >>> 24);
    this.u8(v >>> 16);
    this.u8(v >>> 8);
    this.u8(v);
  }
  i16be(v: number) {
    this.u16be(v < 0 ? v + 0x10000 : v);
  }
  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
  bytes(b: Uint8Array) {
    this.grow(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  /** reserva 4 bytes e devolve uma função que escreve ali o tamanho do que veio depois */
  lengthSlot() {
    const at = this.len;
    this.u32be(0);
    return () => {
      const n = this.len - at - 4;
      this.buf[at] = n >>> 24;
      this.buf[at + 1] = (n >>> 16) & 0xff;
      this.buf[at + 2] = (n >>> 8) & 0xff;
      this.buf[at + 3] = n & 0xff;
    };
  }
  result() {
    return this.buf.slice(0, this.len);
  }
}

/* ------------------------------------------------------------------ paleta (median cut) */

function buildPalette(rgba: Uint8ClampedArray) {
  const hist = new Uint32Array(32768);
  let opaque = 0;
  let transparent = false;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) {
      transparent = true;
      continue;
    }
    hist[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)]++;
    opaque++;
  }
  const keys: number[] = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) keys.push(k);
  const maxColors = transparent ? 255 : 256;
  type Box = { keys: number[]; count: number };
  const ch = (k: number, c: number) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);
  const boxes: Box[] = keys.length ? [{ keys, count: opaque }] : [];
  while (boxes.length < maxColors) {
    // divide a caixa com mais "peso × variação"
    let best = -1;
    let bestScore = 0;
    let bestCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.keys.length < 2) continue;
      for (let c = 0; c < 3; c++) {
        let lo = 31;
        let hi = 0;
        for (const k of b.keys) {
          const v = ch(k, c);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const score = (hi - lo) * Math.sqrt(b.count);
        if (score > bestScore) {
          bestScore = score;
          best = i;
          bestCh = c;
        }
      }
    }
    if (best === -1) break;
    const b = boxes[best];
    b.keys.sort((x, y) => ch(x, bestCh) - ch(y, bestCh));
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < b.keys.length - 1; i++) {
      acc += hist[b.keys[i]];
      if (acc >= b.count / 2) {
        cut = i + 1;
        break;
      }
      cut = i + 1;
    }
    const a = b.keys.slice(0, cut);
    const c2 = b.keys.slice(cut);
    const sum = (ks: number[]) => ks.reduce((n, k) => n + hist[k], 0);
    boxes.splice(best, 1, { keys: a, count: sum(a) }, { keys: c2, count: sum(c2) });
  }
  const palette = new Uint8Array(256 * 3);
  boxes.forEach((b, i) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    let n = 0;
    for (const k of b.keys) {
      const w = hist[k];
      r += ((k >> 10) * 8 + 4) * w;
      g += (((k >> 5) & 31) * 8 + 4) * w;
      bl += ((k & 31) * 8 + 4) * w;
      n += w;
    }
    palette[i * 3] = Math.round(r / n);
    palette[i * 3 + 1] = Math.round(g / n);
    palette[i * 3 + 2] = Math.round(bl / n);
  });
  // cada cor de 15 bits aponta para a cor mais próxima da paleta
  const lookup = new Uint8Array(32768);
  for (const k of keys) {
    const r = (k >> 10) * 8 + 4;
    const g = ((k >> 5) & 31) * 8 + 4;
    const bl = (k & 31) * 8 + 4;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const dr = palette[i * 3] - r;
      const dg = palette[i * 3 + 1] - g;
      const db = palette[i * 3 + 2] - bl;
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    lookup[k] = bi;
  }
  return { palette, lookup, transparentIndex: transparent ? 255 : -1 };
}

/* ------------------------------------------------------------------ LZW do GIF */

function lzw(indices: Uint8Array, out: ByteWriter) {
  const minCode = 8;
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let codeSize = minCode + 1;
  let next = eoi + 1;
  let table = new Map<number, number>();
  const block = new Uint8Array(255);
  let blockLen = 0;
  let cur = 0;
  let bits = 0;
  const flushByte = (b: number) => {
    block[blockLen++] = b;
    if (blockLen === 255) {
      out.u8(255);
      out.bytes(block);
      blockLen = 0;
    }
  };
  const emit = (code: number) => {
    cur |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      flushByte(cur & 0xff);
      cur >>>= 8;
      bits -= 8;
    }
  };
  out.u8(minCode);
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      codeSize = minCode + 1;
      table = new Map();
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) flushByte(cur & 0xff);
  if (blockLen) {
    out.u8(blockLen);
    out.bytes(block.subarray(0, blockLen));
  }
  out.u8(0);
}

/** GIF animado: cada quadro RGBA (w×h), atraso em ms, repete para sempre. */
export function encodeGif(frames: Uint8ClampedArray[], w: number, h: number, delayMs: number) {
  const out = new ByteWriter();
  out.ascii('GIF89a');
  out.u16le(w);
  out.u16le(h);
  out.u8(0); // sem paleta global
  out.u8(0);
  out.u8(0);
  // repetir sempre
  out.bytes(new Uint8Array([0x21, 0xff, 0x0b]));
  out.ascii('NETSCAPE2.0');
  out.bytes(new Uint8Array([0x03, 0x01, 0x00, 0x00, 0x00]));
  const delay = Math.max(2, Math.round(delayMs / 10));
  for (const rgba of frames) {
    const { palette, lookup, transparentIndex } = buildPalette(rgba);
    const idx = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < idx.length; p++, i += 4) {
      idx[p] =
        transparentIndex >= 0 && rgba[i + 3] < 128
          ? transparentIndex
          : lookup[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)];
    }
    out.bytes(new Uint8Array([0x21, 0xf9, 0x04, transparentIndex >= 0 ? (2 << 2) | 1 : 1 << 2]));
    out.u16le(delay);
    out.u8(transparentIndex >= 0 ? transparentIndex : 0);
    out.u8(0);
    out.u8(0x2c);
    out.u16le(0);
    out.u16le(0);
    out.u16le(w);
    out.u16le(h);
    out.u8(0x80 | 7); // paleta local de 256 cores
    out.bytes(palette);
    lzw(idx, out);
  }
  out.u8(0x3b);
  return out.result();
}

/* ------------------------------------------------------------------ PSD */

const PSD_BLEND: Record<string, string> = {
  'source-over': 'norm',
  multiply: 'mul ',
  screen: 'scrn',
  overlay: 'over',
  darken: 'dark',
  lighten: 'lite',
  'color-dodge': 'div ',
  'color-burn': 'idiv',
  'hard-light': 'hLit',
  'soft-light': 'sLit',
  difference: 'diff',
  exclusion: 'smud',
  hue: 'hue ',
  saturation: 'sat ',
  color: 'colr',
  luminosity: 'lum ',
};

export interface PsdLayer {
  name: string;
  rgba: Uint8ClampedArray; // w×h
  opacity: number; // 0..1
  blend?: string;
  visible: boolean;
  clip?: boolean;
}

/**
 * PSD (Photoshop, Krita, GIMP, Photopea abrem) com camadas RGBA sem compressão.
 * `layers` vai de baixo para cima; `merged` é a imagem achatada (prévia).
 */
export function writePsd(w: number, h: number, layers: PsdLayer[], merged: Uint8ClampedArray) {
  const out = new ByteWriter();
  out.ascii('8BPS');
  out.u16be(1);
  out.bytes(new Uint8Array(6));
  out.u16be(4); // RGBA
  out.u32be(h);
  out.u32be(w);
  out.u16be(8);
  out.u16be(3); // RGB
  out.u32be(0); // color mode data
  out.u32be(0); // image resources

  const endLayerMask = out.lengthSlot();
  const endLayerInfo = out.lengthSlot();
  out.i16be(-layers.length); // negativo: o primeiro canal alfa é a transparência da imagem achatada
  const plane = w * h;
  for (const l of layers) {
    out.u32be(0);
    out.u32be(0);
    out.u32be(h);
    out.u32be(w);
    out.u16be(4);
    for (const id of [-1, 0, 1, 2]) {
      out.i16be(id);
      out.u32be(plane + 2);
    }
    out.ascii('8BIM');
    out.ascii(PSD_BLEND[l.blend || 'source-over'] || 'norm');
    out.u8(Math.round(Math.max(0, Math.min(1, l.opacity)) * 255));
    out.u8(l.clip ? 1 : 0);
    out.u8(l.visible ? 0 : 2);
    out.u8(0);
    const endExtra = out.lengthSlot();
    out.u32be(0); // máscara
    out.u32be(0); // faixas de mistura
    // nome Pascal (ASCII) com preenchimento para múltiplo de 4
    const ascii = l.name.replace(/[^\x20-\x7e]/g, '_').slice(0, 255);
    out.u8(ascii.length);
    out.ascii(ascii);
    for (let pad = (ascii.length + 1) % 4; pad && pad < 4; pad++) out.u8(0);
    // nome Unicode (acentos)
    out.ascii('8BIM');
    out.ascii('luni');
    const endLuni = out.lengthSlot();
    out.u32be(l.name.length);
    for (let i = 0; i < l.name.length; i++) out.u16be(l.name.charCodeAt(i));
    if ((l.name.length * 2 + 4) % 4) out.u16be(0);
    endLuni();
    endExtra();
  }
  const chan = new Uint8Array(plane);
  for (const l of layers) {
    for (const c of [3, 0, 1, 2]) {
      out.u16be(0); // sem compressão
      for (let p = 0, i = c; p < plane; p++, i += 4) chan[p] = l.rgba[i];
      out.bytes(chan);
    }
  }
  if (out.len % 2) out.u8(0);
  endLayerInfo();
  out.u32be(0); // máscara global
  endLayerMask();

  out.u16be(0); // imagem achatada sem compressão: R, G, B, A
  for (const c of [0, 1, 2, 3]) {
    for (let p = 0, i = c; p < plane; p++, i += 4) chan[p] = merged[i];
    out.bytes(chan);
  }
  return out.result();
}

export function downloadBytes(bytes: Uint8Array | Blob, name: string, type: string) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
