import type { WhiteboardElement, WhiteboardPoint } from '../types';

/**
 * Renderização do whiteboard (canvas 2D). Tudo aqui trabalha em coordenadas de "mundo":
 * o canvas é infinito e quem chama aplica a transformação de câmera (pan/zoom) no contexto.
 */

export type Bounds = { x: number; y: number; w: number; h: number };
export type View = { x: number; y: number; z: number }; // tela(css) = mundo * z + (x, y)

export const WB_FONT = (fs: number) => `600 ${fs}px "gg sans", "Noto Sans", "Segoe UI", sans-serif`;

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6).padEnd(6, '0'), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/* ------------------------------------------------------------------ bounds */

const boundsCache = new WeakMap<WhiteboardElement, Bounds>();

export function imageCenter(el: WhiteboardElement) {
  return { cx: (el.x || 0) + (el.w || 0) / 2, cy: (el.y || 0) + (el.h || 0) / 2 };
}

/** Converte um ponto local (relativo ao centro, sem rotação) da imagem para o mundo. */
export function imageLocalToWorld(el: WhiteboardElement, lx: number, ly: number) {
  const { cx, cy } = imageCenter(el);
  const r = el.rot || 0;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c };
}

export function worldToImageLocal(el: WhiteboardElement, x: number, y: number) {
  const { cx, cy } = imageCenter(el);
  const r = -(el.rot || 0);
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = x - cx;
  const dy = y - cy;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function elementBounds(el: WhiteboardElement): Bounds {
  const cached = boundsCache.get(el);
  if (cached) return cached;
  const s = Math.max(1, el.size || 4);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, pad: number) => {
    if (x - pad < x0) x0 = x - pad;
    if (y - pad < y0) y0 = y - pad;
    if (x + pad > x1) x1 = x + pad;
    if (y + pad > y1) y1 = y + pad;
  };

  if (el.kind === 'stroke') {
    const brush = el.brush || 'pen';
    const pad = brush === 'airbrush' ? s * 0.8 + 2 : brush === 'spray' ? s * 1.3 + 2 : brush === 'pixel' ? s + 2 : s / 2 + 2;
    for (const p of el.points || []) add(p.x, p.y, pad);
  } else if (el.kind === 'line' || el.kind === 'arrow') {
    const pad = s / 2 + (el.kind === 'arrow' ? Math.max(10, s * 3) : 0) + 2;
    add(el.x || 0, el.y || 0, pad);
    add(el.x2 || 0, el.y2 || 0, pad);
  } else if (el.kind === 'rect' || el.kind === 'ellipse') {
    const pad = el.filled ? 1 : s / 2 + 1;
    add(el.x || 0, el.y || 0, pad);
    add((el.x || 0) + (el.w || 0), (el.y || 0) + (el.h || 0), pad);
  } else if (el.kind === 'text') {
    const fs = el.fontSize || 28;
    const lines = String(el.text || '').split('\n');
    const m = getMeasureCtx();
    let width = fs;
    if (m) {
      m.font = WB_FONT(fs);
      for (const line of lines) width = Math.max(width, m.measureText(line).width);
    }
    add(el.x || 0, el.y || 0, 0);
    add((el.x || 0) + width, (el.y || 0) + lines.length * fs * 1.25, 0);
  } else if (el.kind === 'image') {
    const w = el.w || 0;
    const h = el.h || 0;
    if (el.rot) {
      for (const [lx, ly] of [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ]) {
        const p = imageLocalToWorld(el, lx, ly);
        add(p.x, p.y, 0);
      }
    } else {
      add(el.x || 0, el.y || 0, 0);
      add((el.x || 0) + w, (el.y || 0) + h, 0);
    }
  }

  if (!Number.isFinite(x0)) {
    x0 = el.x || 0;
    y0 = el.y || 0;
    x1 = x0;
    y1 = y0;
  }
  const tx = el.kind === 'image' ? 0 : el.tx || 0;
  const ty = el.kind === 'image' ? 0 : el.ty || 0;
  const b = { x: x0 + tx, y: y0 + ty, w: x1 - x0, h: y1 - y0 };
  boundsCache.set(el, b);
  return b;
}

export function boundsIntersect(a: Bounds, b: Bounds) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (!list.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of list) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Teste de clique preciso (tol em unidades de mundo). */
export function hitTestElement(el: WhiteboardElement, x: number, y: number, tol: number) {
  if (el.kind === 'stroke' && el.brush === 'eraser') return false;
  const b = elementBounds(el);
  if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) return false;
  if (el.kind === 'image') {
    if (!el.rot) return true;
    const l = worldToImageLocal(el, x, y);
    return Math.abs(l.x) <= (el.w || 0) / 2 + tol && Math.abs(l.y) <= (el.h || 0) / 2 + tol;
  }
  const lx = x - (el.tx || 0);
  const ly = y - (el.ty || 0);
  if (el.kind === 'stroke') {
    const pts = el.points || [];
    const r = Math.max(1, el.size || 4) / 2 + tol + (el.brush === 'airbrush' || el.brush === 'spray' ? el.size || 4 : 0);
    if (pts.length === 1) return Math.hypot(lx - pts[0].x, ly - pts[0].y) <= r;
    for (let i = 1; i < pts.length; i++) {
      if (distToSegment(lx, ly, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= r) return true;
    }
    return false;
  }
  if (el.kind === 'line' || el.kind === 'arrow') {
    return distToSegment(lx, ly, el.x || 0, el.y || 0, el.x2 || 0, el.y2 || 0) <= (el.size || 4) / 2 + tol;
  }
  return true;
}

/* ------------------------------------------------------------------ drawing */

export interface DrawEnv {
  imgs: Map<string, HTMLImageElement>;
  onImg: () => void;
  scratch: HTMLCanvasElement;
}

const dabSprites = new Map<string, HTMLCanvasElement>();
function getDabSprite(color: string, hardness: number) {
  const key = `${color}|${hardness.toFixed(2)}`;
  let c = dabSprites.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const [r, g, b] = hexToRgb(color);
  const grad = ctx.createRadialGradient(32, 32, 32 * hardness * 0.95, 32, 32, 32);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  if (dabSprites.size > 64) dabSprites.clear();
  dabSprites.set(key, c);
  return c;
}

function forEachDab(
  pts: WhiteboardPoint[],
  spacing: (p: number) => number,
  cb: (x: number, y: number, p: number) => void
) {
  if (!pts.length) return;
  cb(pts[0].x, pts[0].y, pts[0].p || 1);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) continue;
    const n = Math.max(1, Math.ceil(dist / Math.max(0.5, spacing(b.p || 1))));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      cb(a.x + dx * t, a.y + dy * t, (a.p || 1) + ((b.p || 1) - (a.p || 1)) * t);
    }
  }
}

function paintLineStroke(c: CanvasRenderingContext2D, el: WhiteboardElement) {
  const brush = el.brush || 'pen';
  const pts = el.points || [];
  const base = Math.max(0.5, el.size || 6);
  c.strokeStyle = brush === 'eraser' ? '#000' : el.color;
  c.fillStyle = c.strokeStyle;

  if (brush === 'calligraphy') {
    // pena chata a 45°: a espessura muda conforme a direção do traço
    const nx = Math.SQRT1_2;
    const ny = -Math.SQRT1_2;
    if (pts.length === 1) {
      const w = (base * (pts[0].p || 1)) / 2;
      c.beginPath();
      c.moveTo(pts[0].x + nx * w, pts[0].y + ny * w);
      c.lineTo(pts[0].x - nx * w, pts[0].y - ny * w);
      c.lineWidth = Math.max(1, base * 0.15);
      c.stroke();
      return;
    }
    c.beginPath();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const wa = (base * (a.p || 1)) / 2;
      const wb = (base * (b.p || 1)) / 2;
      c.moveTo(a.x + nx * wa, a.y + ny * wa);
      c.lineTo(b.x + nx * wb, b.y + ny * wb);
      c.lineTo(b.x - nx * wb, b.y - ny * wb);
      c.lineTo(a.x - nx * wa, a.y - ny * wa);
      c.closePath();
    }
    c.fill();
    c.lineWidth = Math.max(0.6, base * 0.08);
    c.lineJoin = 'round';
    c.stroke();
    return;
  }

  c.lineCap = brush === 'marker' ? 'square' : 'round';
  c.lineJoin = 'round';
  if (pts.length === 1) {
    const r = (base * (pts[0].p || 1)) / 2;
    c.beginPath();
    if (brush === 'marker') c.rect(pts[0].x - r, pts[0].y - r, r * 2, r * 2);
    else c.arc(pts[0].x, pts[0].y, Math.max(0.5, r), 0, Math.PI * 2);
    c.fill();
    return;
  }
  const p0 = pts[0].p || 1;
  const uniform = pts.every((p) => Math.abs((p.p || 1) - p0) < 0.02);
  if (uniform) {
    c.lineWidth = Math.max(0.5, base * p0);
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      c.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    }
    const last = pts[pts.length - 1];
    c.lineTo(last.x, last.y);
    c.stroke();
    return;
  }
  // espessura variável (pressão da caneta): segmentos suavizados pelos pontos médios
  let px = pts[0].x;
  let py = pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i];
    const nxt = pts[i + 1];
    const ex = nxt ? (cur.x + nxt.x) / 2 : cur.x;
    const ey = nxt ? (cur.y + nxt.y) / 2 : cur.y;
    c.lineWidth = Math.max(0.5, base * (cur.p || 1));
    c.beginPath();
    c.moveTo(px, py);
    c.quadraticCurveTo(cur.x, cur.y, ex, ey);
    c.stroke();
    px = ex;
    py = ey;
  }
}

/**
 * Desenha o traço sozinho num canvas auxiliar e só depois aplica a opacidade, para que
 * segmentos sobrepostos do mesmo traço não fiquem mais escuros (igual ao Photoshop).
 */
function drawIsolated(
  ctx: CanvasRenderingContext2D,
  el: WhiteboardElement,
  alpha: number,
  op: GlobalCompositeOperation,
  paint: (c: CanvasRenderingContext2D) => void,
  scratch: HTMLCanvasElement
) {
  const t = ctx.getTransform();
  const b = elementBounds(el);
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const sx = Math.max(0, Math.floor(t.a * b.x + t.e) - 2);
  const sy = Math.max(0, Math.floor(t.d * b.y + t.f) - 2);
  const ex = Math.min(W, Math.ceil(t.a * (b.x + b.w) + t.e) + 2);
  const ey = Math.min(H, Math.ceil(t.d * (b.y + b.h) + t.f) + 2);
  if (ex <= sx || ey <= sy) return;
  if (scratch.width < W || scratch.height < H) {
    scratch.width = Math.max(scratch.width, W);
    scratch.height = Math.max(scratch.height, H);
  }
  const s = scratch.getContext('2d')!;
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalAlpha = 1;
  s.globalCompositeOperation = 'source-over';
  s.clearRect(sx, sy, ex - sx, ey - sy);
  s.setTransform(t);
  paint(s);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
  ctx.drawImage(scratch, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
  ctx.restore();
}

export function drawElement(ctx: CanvasRenderingContext2D, el: WhiteboardElement, env: DrawEnv) {
  const alpha = clamp(el.opacity ?? 1, 0.02, 1);
  const tx = el.tx || 0;
  const ty = el.ty || 0;

  if (el.kind === 'stroke') {
    const pts = el.points;
    if (!pts || !pts.length) return;
    const brush = el.brush || 'pen';
    if (brush === 'pen' || brush === 'marker' || brush === 'calligraphy' || brush === 'eraser') {
      const a = brush === 'marker' ? Math.min(alpha, 0.5) : alpha;
      const op: GlobalCompositeOperation = brush === 'eraser' ? 'destination-out' : 'source-over';
      if (a >= 0.999) {
        ctx.save();
        ctx.globalCompositeOperation = op;
        ctx.translate(tx, ty);
        paintLineStroke(ctx, el);
        ctx.restore();
      } else {
        drawIsolated(
          ctx,
          el,
          a,
          op,
          (c) => {
            c.translate(tx, ty);
            paintLineStroke(c, el);
          },
          env.scratch
        );
      }
      return;
    }
    const base = Math.max(1, el.size || 6);
    ctx.save();
    ctx.translate(tx, ty);
    if (brush === 'airbrush') {
      const sprite = getDabSprite(el.color, clamp(el.hardness ?? 0.3, 0.05, 1));
      ctx.globalAlpha = clamp(alpha * 0.22, 0.01, 1);
      forEachDab(
        pts,
        (p) => Math.max(0.75, base * p * 0.2),
        (x, y, p) => {
          const r = Math.max(1.5, base * p * 0.75);
          ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
        }
      );
    } else if (brush === 'spray') {
      const rand = mulberry32(el.seed || 1337);
      ctx.fillStyle = el.color;
      ctx.globalAlpha = alpha;
      const dot = Math.max(1, base / 14);
      const count = Math.max(4, Math.round(base * 0.5));
      forEachDab(
        pts,
        () => Math.max(1, base * 0.35),
        (x, y, p) => {
          const spread = base * 1.2 * p;
          for (let k = 0; k < count; k++) {
            const ang = rand() * Math.PI * 2;
            const rad = Math.sqrt(rand()) * spread;
            ctx.fillRect(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad, dot, dot);
          }
        }
      );
    } else if (brush === 'pixel') {
      const step = Math.max(2, Math.round(base));
      const cells = new Set<string>();
      ctx.fillStyle = el.color;
      ctx.globalAlpha = alpha;
      forEachDab(
        pts,
        () => step * 0.5,
        (x, y) => {
          const gx = Math.floor(x / step);
          const gy = Math.floor(y / step);
          const key = `${gx},${gy}`;
          if (cells.has(key)) return;
          cells.add(key);
          ctx.fillRect(gx * step, gy * step, step, step);
        }
      );
    }
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  if (el.kind !== 'image') ctx.translate(tx, ty);

  if (el.kind === 'line' || el.kind === 'arrow') {
    const x1 = el.x || 0;
    const y1 = el.y || 0;
    const x2 = el.x2 || 0;
    const y2 = el.y2 || 0;
    ctx.strokeStyle = el.color;
    ctx.fillStyle = el.color;
    ctx.lineWidth = el.size || 4;
    ctx.lineCap = 'round';
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.max(10, (el.size || 4) * 3);
    const endX = el.kind === 'arrow' ? x2 - Math.cos(ang) * headLen * 0.6 : x2;
    const endY = el.kind === 'arrow' ? y2 - Math.sin(ang) * headLen * 0.6 : y2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    if (el.kind === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(ang - Math.PI / 7), y2 - headLen * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(x2 - headLen * Math.cos(ang + Math.PI / 7), y2 - headLen * Math.sin(ang + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    }
  } else if (el.kind === 'rect' || el.kind === 'ellipse') {
    const x = Math.min(el.x || 0, (el.x || 0) + (el.w || 0));
    const y = Math.min(el.y || 0, (el.y || 0) + (el.h || 0));
    const w = Math.abs(el.w || 0);
    const h = Math.abs(el.h || 0);
    ctx.strokeStyle = el.color;
    ctx.fillStyle = el.color;
    ctx.lineWidth = el.size || 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (el.kind === 'rect') ctx.rect(x, y, w, h);
    else ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
    if (el.filled) ctx.fill();
    else ctx.stroke();
  } else if (el.kind === 'text' && el.text) {
    const fs = el.fontSize || 28;
    ctx.font = WB_FONT(fs);
    ctx.fillStyle = el.color;
    ctx.textBaseline = 'top';
    String(el.text)
      .split('\n')
      .forEach((line, idx) => ctx.fillText(line, el.x || 0, (el.y || 0) + idx * fs * 1.25));
  } else if (el.kind === 'image' && el.dataUrl) {
    let img = env.imgs.get(el.dataUrl);
    if (!img) {
      img = new Image();
      img.onload = env.onImg;
      img.src = el.dataUrl;
      env.imgs.set(el.dataUrl, img);
    }
    if (img.complete && img.naturalWidth > 0) {
      const w = el.w || img.naturalWidth;
      const h = el.h || img.naturalHeight;
      ctx.imageSmoothingQuality = 'high';
      if (el.rot) {
        const { cx, cy } = imageCenter({ ...el, w, h });
        ctx.translate(cx, cy);
        ctx.rotate(el.rot);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        ctx.drawImage(img, el.x || 0, el.y || 0, w, h);
      }
    }
  }
  ctx.restore();
}

/** Renderiza uma lista de elementos num canvas limpo com a câmera `view` (dpr = pixels por px css). */
export function renderElements(
  ctx: CanvasRenderingContext2D,
  els: WhiteboardElement[],
  view: View,
  dpr: number,
  env: DrawEnv,
  visible: Bounds | null
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr * view.z, 0, 0, dpr * view.z, dpr * view.x, dpr * view.y);
  for (const el of els) {
    if (visible && !boundsIntersect(elementBounds(el), visible)) continue;
    drawElement(ctx, el, env);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

let checkerPattern: CanvasPattern | null = null;
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  bg: string,
  view: View,
  dpr: number
) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (bg === 'transparent') {
    if (!checkerPattern) {
      const c = document.createElement('canvas');
      c.width = 24;
      c.height = 24;
      const p = c.getContext('2d')!;
      p.fillStyle = '#2b2d31';
      p.fillRect(0, 0, 24, 24);
      p.fillStyle = '#383a40';
      p.fillRect(0, 0, 12, 12);
      p.fillRect(12, 12, 12, 12);
      checkerPattern = ctx.createPattern(c, 'repeat');
    }
    if (checkerPattern) {
      ctx.fillStyle = checkerPattern;
      ctx.fillRect(0, 0, W, H);
    }
    return;
  }
  ctx.fillStyle = bg === 'light' ? '#ffffff' : '#1e1f22';
  ctx.fillRect(0, 0, W, H);
  if (bg !== 'grid') return;
  let step = 40;
  while (step * view.z < 14) step *= 2;
  const sp = step * view.z * dpr;
  const ox = ((((view.x * dpr) % sp) + sp) % sp);
  const oy = ((((view.y * dpr) % sp) + sp) % sp);
  const isMajor = (screenDev: number, offset: number) =>
    Math.round((screenDev / dpr - offset) / (step * view.z)) % 5 === 0;
  ctx.lineWidth = 1;
  for (let x = ox; x <= W; x += sp) {
    ctx.strokeStyle = isMajor(x, view.x) ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, H);
    ctx.stroke();
  }
  for (let y = oy; y <= H; y += sp) {
    ctx.strokeStyle = isMajor(y, view.y) ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(W, Math.round(y) + 0.5);
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ flood fill */

/**
 * Balde de tinta estilo Photoshop: preenche a região de cor parecida a partir do pixel
 * (px, py) da imagem `src` e devolve um canvas recortado com o preenchimento.
 */
export function floodFillMask(
  src: ImageData,
  px: number,
  py: number,
  color: string,
  tolerance = 40
): { canvas: HTMLCanvasElement; x: number; y: number } | null {
  const { width: W, height: H, data } = src;
  if (px < 0 || py < 0 || px >= W || py >= H) return null;
  const si = (py * W + px) * 4;
  const r0 = data[si];
  const g0 = data[si + 1];
  const b0 = data[si + 2];
  const a0 = data[si + 3];
  const mask = new Uint8Array(W * H);
  const match = (i: number) => {
    const o = i * 4;
    return (
      Math.abs(data[o] - r0) <= tolerance &&
      Math.abs(data[o + 1] - g0) <= tolerance &&
      Math.abs(data[o + 2] - b0) <= tolerance &&
      Math.abs(data[o + 3] - a0) <= tolerance
    );
  };
  let minX = px;
  let maxX = px;
  let minY = py;
  let maxY = py;
  const stack: number[] = [py * W + px];
  while (stack.length) {
    const i = stack.pop()!;
    if (mask[i]) continue;
    const y = (i / W) | 0;
    let lx = i - y * W;
    let rx = lx;
    while (lx > 0 && !mask[y * W + lx - 1] && match(y * W + lx - 1)) lx--;
    while (rx < W - 1 && !mask[y * W + rx + 1] && match(y * W + rx + 1)) rx++;
    for (let x = lx; x <= rx; x++) mask[y * W + x] = 1;
    if (lx < minX) minX = lx;
    if (rx > maxX) maxX = rx;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= H) continue;
      let inSpan = false;
      for (let x = lx; x <= rx; x++) {
        const j = ny * W + x;
        if (!mask[j] && match(j)) {
          if (!inSpan) {
            stack.push(j);
            inSpan = true;
          }
        } else inSpan = false;
      }
    }
  }
  // dilata 1px para cobrir o anti-aliasing das bordas
  const x0 = Math.max(0, minX - 1);
  const y0 = Math.max(0, minY - 1);
  const x1 = Math.min(W - 1, maxX + 1);
  const y1 = Math.min(H - 1, maxY + 1);
  const ow = x1 - x0 + 1;
  const oh = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = ow;
  out.height = oh;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(ow, oh);
  const [r, g, b] = hexToRgb(color);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      const on =
        mask[i] ||
        (x > 0 && mask[i - 1]) ||
        (x < W - 1 && mask[i + 1]) ||
        (y > 0 && mask[i - W]) ||
        (y < H - 1 && mask[i + W]);
      if (!on) continue;
      const o = ((y - y0) * ow + (x - x0)) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return { canvas: out, x: x0, y: y0 };
}
