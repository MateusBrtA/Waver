// Motor do estúdio de arte do quadro: pincéis artísticos, degradê, pranchetas, ajustes de camada, visão de
// canais e simetria. Tudo é determinístico (aleatoriedade com semente do traço), então cada pessoa na call
// desenha exatamente o mesmo resultado a partir das mesmas operações.
import type { WhiteboardElement, WhiteboardLayerFx, WhiteboardPoint } from '../types';

export function mulberry(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
};

/** Percorre o traço colocando "carimbos" a cada `spacing` unidades; t = fração do comprimento total (0..1). */
function walkDabs(
  pts: WhiteboardPoint[],
  spacing: number,
  cb: (x: number, y: number, p: number, t: number, ang: number) => void
) {
  if (!pts.length) return;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const step = Math.max(0.4, spacing);
  cb(pts[0].x, pts[0].y, pts[0].p || 1, 0, 0);
  let acc = 0;
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const seg = Math.hypot(dx, dy);
    if (!seg) continue;
    const ang = Math.atan2(dy, dx);
    let d = step - carry;
    while (d <= seg) {
      const f = d / seg;
      cb(a.x + dx * f, a.y + dy * f, (a.p || 1) + ((b.p || 1) - (a.p || 1)) * f, total ? (acc + d) / total : 1, ang);
      d += step;
    }
    carry = seg - (d - step);
    acc += seg;
  }
}

const grainCache = new Map<string, HTMLCanvasElement>();
/** Carimbo com textura (giz de cera / carvão): gerado uma vez por cor+tipo, sempre igual. */
function grainSprite(color: string, kind: 'crayon' | 'charcoal') {
  const key = `${kind}|${color}`;
  let c = grainCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 48;
  const ctx = c.getContext('2d')!;
  const rand = mulberry(kind === 'crayon' ? 913 : 4421);
  const [r, g, b] = hexRgb(color);
  const img = ctx.createImageData(48, 48);
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const dx = (x - 23.5) / 24;
      const dy = (y - 23.5) / 24;
      const d = Math.hypot(dx, dy);
      if (d > 1) continue;
      const edge = kind === 'crayon' ? (d < 0.82 ? 1 : (1 - d) / 0.18) : Math.max(0, 1 - d * d);
      const n = rand();
      const keep = kind === 'crayon' ? n > 0.28 : n > 0.55;
      const a = keep ? edge * (kind === 'crayon' ? 0.55 + n * 0.45 : 0.25 + n * 0.5) : 0;
      const o = (y * 48 + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  if (grainCache.size > 48) grainCache.clear();
  grainCache.set(key, c);
  return c;
}

const softCache = new Map<string, HTMLCanvasElement>();
function softSprite(color: string, hardness: number) {
  const key = `${color}|${hardness.toFixed(2)}`;
  let c = softCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 32 * hardness, 32, 32, 32);
  g.addColorStop(0, rgba(color, 1));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  if (softCache.size > 64) softCache.clear();
  softCache.set(key, c);
  return c;
}

export const ART_BRUSHES = ['charcoal', 'watercolor', 'ink', 'splatter', 'crayon', 'neon', 'custom'] as const;

/** Pontas dos pincéis importados (id → imagem), preenchido pelo painel a partir da biblioteca da sala. */
export const tipRegistry = new Map<string, HTMLImageElement>();
const tintCache = new Map<string, HTMLCanvasElement>();
function tintedTip(id: string, img: HTMLImageElement, color: string) {
  const key = `${id}|${color}|${img.naturalWidth}`;
  let c = tintCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = Math.max(1, img.naturalWidth);
  c.height = Math.max(1, img.naturalHeight);
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  if (tintCache.size > 96) tintCache.clear();
  tintCache.set(key, c);
  return c;
}
export const isArtBrush = (b?: string) => (ART_BRUSHES as readonly string[]).includes(b || '');

/** Margem do traço além dos pontos (para recorte e seleção). */
export function artBrushPad(brush: string, size: number) {
  if (brush === 'custom') return size * 0.75 + 2;
  if (brush === 'splatter') return size * 2.4 + 2;
  if (brush === 'neon') return size * 2 + 4;
  if (brush === 'watercolor') return size * 0.75 + 2;
  return size * 0.6 + 2;
}

/** Pinta um traço de pincel artístico em `c` (já com a translação do elemento aplicada). */
export function paintArtBrush(c: CanvasRenderingContext2D, el: WhiteboardElement) {
  const pts = el.points || [];
  if (!pts.length) return;
  const base = Math.max(1, el.size || 8);
  const brush = el.brush;
  const rand = mulberry(el.seed || 7);

  if (brush === 'custom') {
    // pincel importado: carimba a ponta na cor do traço (tamanho pela pressão, giro com variação)
    const img = el.tipId ? tipRegistry.get(el.tipId) : undefined;
    const ready = img && img.complete && img.naturalWidth > 0;
    const spacing = Math.max(0.5, (el.spacing ?? 0.25) * base);
    const jitter = el.jitter ?? 0;
    if (!ready) {
      c.fillStyle = el.color;
      walkDabs(pts, spacing, (x, y, p) => {
        c.beginPath();
        c.arc(x, y, Math.max(0.5, base * 0.5 * p), 0, Math.PI * 2);
        c.fill();
      });
      return;
    }
    const tip = tintedTip(el.tipId!, img!, el.color);
    const aspect = tip.height / tip.width;
    walkDabs(pts, spacing, (x, y, p) => {
      const w = base * p;
      const h = w * aspect;
      c.save();
      c.translate(x + (rand() - 0.5) * base * jitter, y + (rand() - 0.5) * base * jitter);
      if (jitter) c.rotate((rand() - 0.5) * Math.PI * 2 * jitter);
      c.drawImage(tip, -w / 2, -h / 2, w, h);
      c.restore();
    });
    return;
  }

  if (brush === 'ink') {
    // nanquim: afina no começo e no fim, engrossa com a pressão
    c.fillStyle = el.color;
    walkDabs(pts, Math.max(0.5, base * 0.08), (x, y, p, t) => {
      const taper = Math.min(1, t / 0.12, (1 - t) / 0.18 + 0.15);
      const r = Math.max(0.35, (base * 0.5) * p * Math.max(0.12, taper));
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    });
  } else if (brush === 'charcoal') {
    const sprite = grainSprite(el.color, 'charcoal');
    walkDabs(pts, Math.max(0.6, base * 0.12), (x, y, p, _t, ang) => {
      const r = base * 0.55 * p * (0.85 + rand() * 0.3);
      c.save();
      c.translate(x + (rand() - 0.5) * base * 0.15, y + (rand() - 0.5) * base * 0.15);
      c.rotate(ang + (rand() - 0.5) * 0.6);
      c.globalAlpha = 0.35 + rand() * 0.35;
      c.drawImage(sprite, -r, -r * 0.7, r * 2, r * 1.4);
      c.restore();
    });
  } else if (brush === 'crayon') {
    const sprite = grainSprite(el.color, 'crayon');
    walkDabs(pts, Math.max(0.6, base * 0.18), (x, y, p) => {
      const r = base * 0.5 * p;
      c.save();
      c.translate(x, y);
      c.rotate(rand() * Math.PI * 2);
      c.globalAlpha = 0.8;
      c.drawImage(sprite, -r, -r, r * 2, r * 2);
      c.restore();
    });
  } else if (brush === 'watercolor') {
    // aquarela: manchas suaves e irregulares que se somam (a opacidade do traço vem de fora, isolada)
    const sprite = softSprite(el.color, 0.15);
    walkDabs(pts, Math.max(0.8, base * 0.22), (x, y, p) => {
      const r = base * 0.75 * p * (0.7 + rand() * 0.6);
      c.globalAlpha = 0.07 + rand() * 0.06;
      c.drawImage(sprite, x - r + (rand() - 0.5) * base * 0.3, y - r + (rand() - 0.5) * base * 0.3, r * 2, r * 2);
    });
    // borda mais escura, como pigmento secando
    c.globalAlpha = 0.18;
    c.strokeStyle = el.color;
    c.lineWidth = Math.max(0.5, base * 0.06);
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x + (rand() - 0.5) * base * 0.5, pts[i].y + (rand() - 0.5) * base * 0.5);
    c.stroke();
    c.globalAlpha = 1;
  } else if (brush === 'splatter') {
    c.fillStyle = el.color;
    walkDabs(pts, Math.max(1, base * 0.5), (x, y, p) => {
      const n = 1 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        const ang = rand() * Math.PI * 2;
        const dist = Math.pow(rand(), 1.6) * base * 2.2 * p;
        const r = Math.max(0.4, base * (0.05 + Math.pow(rand(), 3) * 0.35));
        c.beginPath();
        c.arc(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, r, 0, Math.PI * 2);
        c.fill();
      }
    });
  } else if (brush === 'neon') {
    // neon: brilho colorido + miolo claro; o brilho acompanha o zoom
    const t = c.getTransform();
    const scale = Math.hypot(t.a, t.b) || 1;
    const path = () => {
      c.beginPath();
      c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        c.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
      }
      const last = pts[pts.length - 1];
      c.lineTo(last.x + (pts.length === 1 ? 0.01 : 0), last.y);
    };
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.shadowColor = el.color;
    c.shadowBlur = base * 1.6 * scale;
    c.strokeStyle = el.color;
    c.lineWidth = base * 0.6;
    path();
    c.stroke();
    c.shadowBlur = base * 0.6 * scale;
    c.stroke();
    c.shadowBlur = 0;
    c.strokeStyle = rgba('#ffffff', 0.9);
    c.lineWidth = Math.max(0.6, base * 0.22);
    path();
    c.stroke();
  }
}

/* ------------------------------------------------------------------ degradê */

export function drawGradient(c: CanvasRenderingContext2D, el: WhiteboardElement) {
  const x1 = el.x || 0;
  const y1 = el.y || 0;
  const x2 = el.x2 ?? x1 + 1;
  const y2 = el.y2 ?? y1;
  const len = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const c1 = rgba(el.color, 1);
  const c2 = rgba(el.color2 || '#000000', el.gradAlpha2 ?? 1);
  let g: CanvasGradient;
  const type = el.gradType || 'linear';
  if (type === 'radial') {
    g = c.createRadialGradient(x1, y1, 0, x1, y1, len);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
  } else if (type === 'reflected') {
    g = c.createLinearGradient(x1 - (x2 - x1), y1 - (y2 - y1), x2, y2);
    g.addColorStop(0, c2);
    g.addColorStop(0.5, c1);
    g.addColorStop(1, c2);
  } else if (type === 'angle' && typeof c.createConicGradient === 'function') {
    g = c.createConicGradient(Math.atan2(y2 - y1, x2 - x1), x1, y1);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
  } else {
    g = c.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
  }
  c.fillStyle = g;
  c.fillRect(el.rx ?? x1 - len, el.ry ?? y1 - len, el.rw ?? len * 2, el.rh ?? len * 2);
}

/* ------------------------------------------------------------------ pranchetas */

/** Prancheta ("tela"): papel com nome em cima. Fica embaixo de todas as camadas. */
export function drawArtboard(c: CanvasRenderingContext2D, el: WhiteboardElement, zoom: number, selected: boolean) {
  const x = (el.x || 0) + (el.tx || 0);
  const y = (el.y || 0) + (el.ty || 0);
  const w = Math.abs(el.w || 0);
  const h = Math.abs(el.h || 0);
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.45)';
  c.shadowBlur = 18;
  c.fillStyle = el.color || '#ffffff';
  c.fillRect(x, y, w, h);
  c.shadowBlur = 0;
  c.lineWidth = (selected ? 2 : 1) / zoom;
  c.strokeStyle = selected ? '#5865f2' : 'rgba(0,0,0,0.35)';
  c.strokeRect(x, y, w, h);
  const fs = 12 / zoom;
  c.font = `600 ${fs}px "gg sans", "Segoe UI", sans-serif`;
  c.fillStyle = selected ? '#8ea1ff' : '#b5bac1';
  c.textBaseline = 'bottom';
  c.fillText(`${el.text || 'Prancheta'}  ${Math.round(w)}×${Math.round(h)}`, x, y - 4 / zoom);
  c.restore();
}

/** O nome em cima da prancheta é a "alça" para selecionar/arrastar (como nos editores de imagem). */
export function hitArtboardLabel(el: WhiteboardElement, x: number, y: number, zoom: number) {
  const ax = (el.x || 0) + (el.tx || 0);
  const ay = (el.y || 0) + (el.ty || 0);
  const w = Math.abs(el.w || 0);
  return x >= ax && x <= ax + Math.max(w, 160 / zoom) && y >= ay - 20 / zoom && y <= ay;
}

export function artboardAt(els: WhiteboardElement[], x: number, y: number) {
  for (let i = els.length - 1; i >= 0; i--) {
    const a = els[i];
    if (a.kind !== 'artboard') continue;
    const ax = (a.x || 0) + (a.tx || 0);
    const ay = (a.y || 0) + (a.ty || 0);
    if (x >= ax && x <= ax + Math.abs(a.w || 0) && y >= ay && y <= ay + Math.abs(a.h || 0)) return a;
  }
  return null;
}

/* ------------------------------------------------------------------ mover em grupo */

/** Patch que desloca um elemento (imagens/pranchetas usam x,y; o resto usa tx,ty). */
export function translatePatch(el: WhiteboardElement, dx: number, dy: number): Partial<WhiteboardElement> {
  const r = (n: number) => Math.round(n * 10) / 10;
  if (el.kind === 'image') return { x: r((el.x || 0) + dx), y: r((el.y || 0) + dy) };
  return { tx: r((el.tx || 0) + dx), ty: r((el.ty || 0) + dy) };
}

/* ------------------------------------------------------------------ ajustes de camada */

export const DEFAULT_FX: Required<WhiteboardLayerFx> = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
  blur: 0,
  invert: 0,
  grayscale: 0,
  sepia: 0,
};

export function hasFx(fx?: WhiteboardLayerFx) {
  if (!fx) return false;
  return (Object.keys(DEFAULT_FX) as Array<keyof WhiteboardLayerFx>).some(
    (k) => fx[k] !== undefined && fx[k] !== DEFAULT_FX[k]
  );
}

/** Filtro CSS do canvas para os ajustes; `scale` converte o desfoque de mundo para pixels da tela. */
export function layerFilter(fx: WhiteboardLayerFx | undefined, scale: number) {
  if (!hasFx(fx)) return 'none';
  const f = { ...DEFAULT_FX, ...fx };
  const parts: string[] = [];
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`);
  if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`);
  if (f.invert) parts.push(`invert(${f.invert}%)`);
  if (f.grayscale) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.sepia) parts.push(`sepia(${f.sepia}%)`);
  if (f.blur) parts.push(`blur(${Math.max(0, f.blur * scale).toFixed(2)}px)`);
  return parts.join(' ') || 'none';
}

/* ------------------------------------------------------------------ canais */

export type ChannelView = 'rgb' | 'r' | 'g' | 'b' | 'alpha' | 'luma';

const CHANNEL_MATRICES: Record<Exclude<ChannelView, 'rgb'>, string> = {
  r: '1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 1 0',
  g: '0 1 0 0 0  0 1 0 0 0  0 1 0 0 0  0 0 0 1 0',
  b: '0 0 1 0 0  0 0 1 0 0  0 0 1 0 0  0 0 0 1 0',
  alpha: '0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1',
  luma: '0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0',
};

/** Garante os filtros SVG (uma vez) e devolve o `ctx.filter` para ver um canal em tons de cinza. */
export function channelFilter(mode: ChannelView) {
  if (mode === 'rgb') return 'none';
  if (!document.getElementById('pc-wb-channels')) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('id', 'pc-wb-channels');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';
    for (const [k, values] of Object.entries(CHANNEL_MATRICES)) {
      const f = document.createElementNS(ns, 'filter');
      f.setAttribute('id', `pc-wb-ch-${k}`);
      f.setAttribute('color-interpolation-filters', 'sRGB');
      const m = document.createElementNS(ns, 'feColorMatrix');
      m.setAttribute('type', 'matrix');
      m.setAttribute('values', values);
      f.appendChild(m);
      svg.appendChild(f);
    }
    document.body.appendChild(svg);
  }
  return `url(#pc-wb-ch-${mode})`;
}

/* ------------------------------------------------------------------ simetria */

export type SymmetryMode = 'off' | 'x' | 'y' | 'xy';

function mirrorPoint(x: number, y: number, ax: 'x' | 'y', cx: number, cy: number) {
  return ax === 'x' ? { x: 2 * cx - x, y } : { x, y: 2 * cy - y };
}

/** Cópias espelhadas do elemento (traços e formas) em volta de (cx, cy). Novos ids e sementes. */
export function mirrorCopies(
  el: WhiteboardElement,
  mode: SymmetryMode,
  cx: number,
  cy: number,
  newId: () => string
): WhiteboardElement[] {
  if (mode === 'off') return [];
  const axesList: Array<Array<'x' | 'y'>> = mode === 'x' ? [['x']] : mode === 'y' ? [['y']] : [['x'], ['y'], ['x', 'y']];
  const out: WhiteboardElement[] = [];
  for (const axes of axesList) {
    let e: WhiteboardElement = { ...el, id: newId(), seed: ((el.seed || 1) * 31 + out.length + 7) % 999983 };
    for (const ax of axes) {
      if (e.points) e = { ...e, points: e.points.map((p) => ({ ...p, ...mirrorPoint(p.x, p.y, ax, cx, cy) })) };
      if (e.kind === 'line' || e.kind === 'arrow' || e.kind === 'gradient') {
        const a = mirrorPoint(e.x || 0, e.y || 0, ax, cx, cy);
        const b = mirrorPoint(e.x2 || 0, e.y2 || 0, ax, cx, cy);
        e = { ...e, x: a.x, y: a.y, x2: b.x, y2: b.y };
      } else if (e.kind === 'rect' || e.kind === 'ellipse') {
        const a = mirrorPoint(e.x || 0, e.y || 0, ax, cx, cy);
        e = ax === 'x' ? { ...e, x: a.x, w: -(e.w || 0) } : { ...e, y: a.y, h: -(e.h || 0) };
      }
    }
    if (e.kind === 'rect' || e.kind === 'ellipse') {
      // largura/altura positivas (a elipse não desenha raio negativo)
      const w = e.w || 0;
      const h = e.h || 0;
      e = { ...e, x: Math.min(e.x || 0, (e.x || 0) + w), y: Math.min(e.y || 0, (e.y || 0) + h), w: Math.abs(w), h: Math.abs(h) };
    }
    out.push(e);
  }
  return out;
}
