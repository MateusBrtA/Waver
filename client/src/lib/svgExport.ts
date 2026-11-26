// Exporta o quadro como SVG (vetor): formas, curvas, texto e traços viram caminhos editáveis em
// Illustrator / Inkscape / Figma. Traços de pincel viram linhas suaves (a textura do pincel não é vetor).
import type { Bounds } from './whiteboardRender';
import { pathBeziers } from './whiteboardRender';
import type { WhiteboardElement, WhiteboardLayer } from '../types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number | undefined) => String(Math.round((v || 0) * 100) / 100);
const color = (c?: string) => (/^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c! : '#ffffff');

function strokeD(el: WhiteboardElement) {
  const pts = el.points || [];
  if (!pts.length) return '';
  if (pts.length === 1) return `M${n(pts[0].x)} ${n(pts[0].y)}l0.01 0`;
  // curva suave pelos pontos médios (mesma ideia do desenho na tela)
  let d = `M${n(pts[0].x)} ${n(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += `Q${n(pts[i].x)} ${n(pts[i].y)} ${n(mx)} ${n(my)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${n(last.x)} ${n(last.y)}`;
}

function elementSvg(el: WhiteboardElement, defs: string[]): string {
  const op = Math.max(0, Math.min(1, el.opacity ?? 1));
  const t = el.kind !== 'image' && (el.tx || el.ty) ? ` transform="translate(${n(el.tx)} ${n(el.ty)})"` : '';
  const o = op < 1 ? ` opacity="${op}"` : '';
  const c = color(el.color);
  const sw = Math.max(0.5, el.size || 4);
  switch (el.kind) {
    case 'stroke': {
      if (el.brush === 'eraser') return '';
      const avgP = (el.points || []).reduce((a, p) => a + (p.p || 1), 0) / Math.max(1, (el.points || []).length);
      const width = el.brush === 'airbrush' || el.brush === 'spray' ? sw * 1.2 : sw * avgP;
      const bo = el.brush === 'marker' ? Math.min(op, 0.5) : op;
      return `<path d="${strokeD(el)}" fill="none" stroke="${c}" stroke-width="${n(width)}" stroke-linecap="${el.brush === 'pixel' ? 'square' : 'round'}" stroke-linejoin="round"${bo < 1 ? ` opacity="${bo}"` : ''}${t}/>`;
    }
    case 'path': {
      const segs = pathBeziers(el.points || [], Boolean(el.closed));
      if (!segs.length) return '';
      let d = `M${n(segs[0][0])} ${n(segs[0][1])}`;
      for (const b of segs) d += `C${n(b[2])} ${n(b[3])} ${n(b[4])} ${n(b[5])} ${n(b[6])} ${n(b[7])}`;
      if (el.closed) d += 'Z';
      const fill = el.filled && el.closed;
      return `<path d="${d}" fill="${fill ? c : 'none'}" ${fill ? '' : `stroke="${c}" stroke-width="${n(sw)}" `}stroke-linecap="round" stroke-linejoin="round"${o}${t}/>`;
    }
    case 'line':
    case 'arrow': {
      let s = `<line x1="${n(el.x)}" y1="${n(el.y)}" x2="${n(el.x2)}" y2="${n(el.y2)}" stroke="${c}" stroke-width="${n(sw)}" stroke-linecap="round"/>`;
      if (el.kind === 'arrow') {
        const x1 = el.x || 0;
        const y1 = el.y || 0;
        const x2 = el.x2 || 0;
        const y2 = el.y2 || 0;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const hl = Math.max(10, sw * 3);
        const p = (a: number) => `${n(x2 - hl * Math.cos(a))},${n(y2 - hl * Math.sin(a))}`;
        s += `<polygon points="${n(x2)},${n(y2)} ${p(ang - Math.PI / 7)} ${p(ang + Math.PI / 7)}" fill="${c}"/>`;
      }
      return `<g${o}${t}>${s}</g>`;
    }
    case 'rect':
    case 'ellipse': {
      const x = Math.min(el.x || 0, (el.x || 0) + (el.w || 0));
      const y = Math.min(el.y || 0, (el.y || 0) + (el.h || 0));
      const w = Math.abs(el.w || 0);
      const h = Math.abs(el.h || 0);
      const paint = el.filled ? `fill="${c}"` : `fill="none" stroke="${c}" stroke-width="${n(sw)}" stroke-linejoin="round"`;
      return el.kind === 'rect'
        ? `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${paint}${o}${t}/>`
        : `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${paint}${o}${t}/>`;
    }
    case 'text': {
      const fs = el.fontSize || 28;
      const lines = String(el.text || '').split('\n');
      const spans = lines
        .map((line, i) => `<tspan x="${n(el.x)}" y="${n((el.y || 0) + i * fs * 1.25)}">${esc(line)}</tspan>`)
        .join('');
      return `<text font-family="gg sans, Segoe UI, sans-serif" font-size="${n(fs)}" font-weight="500" fill="${c}" dominant-baseline="text-before-edge"${o}${t}>${spans}</text>`;
    }
    case 'image': {
      if (!el.dataUrl) return '';
      const w = el.w || 0;
      const h = el.h || 0;
      const rot = el.rot ? ` transform="rotate(${n((el.rot * 180) / Math.PI)} ${n((el.x || 0) + w / 2)} ${n((el.y || 0) + h / 2)})"` : '';
      return `<image href="${el.dataUrl}" x="${n(el.x)}" y="${n(el.y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none"${o}${rot}/>`;
    }
    case 'gradient': {
      const id = `g${defs.length}`;
      const c2 = color(el.color2 || '#000000');
      const a2 = el.gradAlpha2 ?? 1;
      const stops = `<stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c2}" stop-opacity="${a2}"/>`;
      const x1 = el.x || 0;
      const y1 = el.y || 0;
      const x2 = el.x2 || 0;
      const y2 = el.y2 || 0;
      if (el.gradType === 'radial') {
        defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(x1)}" cy="${n(y1)}" r="${n(Math.hypot(x2 - x1, y2 - y1))}">${stops}</radialGradient>`);
      } else if (el.gradType === 'reflected') {
        defs.push(
          `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(2 * x1 - x2)}" y1="${n(2 * y1 - y2)}" x2="${n(x2)}" y2="${n(y2)}"><stop offset="0" stop-color="${c2}" stop-opacity="${a2}"/><stop offset="0.5" stop-color="${c}"/><stop offset="1" stop-color="${c2}" stop-opacity="${a2}"/></linearGradient>`
        );
      } else {
        defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">${stops}</linearGradient>`);
      }
      return `<rect x="${n(el.rx)}" y="${n(el.ry)}" width="${n(el.rw)}" height="${n(el.rh)}" fill="url(#${id})"${o}${t}/>`;
    }
    case 'artboard':
      return `<rect x="${n((el.x || 0) + (el.tx || 0))}" y="${n((el.y || 0) + (el.ty || 0))}" width="${n(Math.abs(el.w || 0))}" height="${n(Math.abs(el.h || 0))}" fill="${c}"/>`;
    default:
      return '';
  }
}

const CSS_BLEND: Record<string, string> = {
  multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light',
  difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};

/** SVG do recorte `b` com uma camada (<g>) por camada do quadro. */
export function buildSvg(b: Bounds, layers: WhiteboardLayer[], elements: WhiteboardElement[], background: string | null, skipLayer?: (l: WhiteboardLayer) => boolean) {
  const defs: string[] = [];
  const parts: string[] = [];
  if (background) parts.push(`<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="${background}"/>`);
  for (const a of elements) if (a.kind === 'artboard') parts.push(elementSvg(a, defs));
  for (const layer of layers) {
    if (skipLayer?.(layer)) continue;
    const els = elements.filter((e) => e.layerId === layer.id && e.kind !== 'artboard');
    if (!els.length) continue;
    const blend = CSS_BLEND[layer.blend || ''];
    const attrs = [
      `id="${esc(layer.id)}"`,
      `inkscape:label="${esc(layer.name)}"`,
      'inkscape:groupmode="layer"',
      layer.visible ? '' : 'style="display:none"',
      (layer.opacity ?? 1) < 1 ? `opacity="${layer.opacity}"` : '',
      blend && layer.visible ? `style="mix-blend-mode:${blend}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    parts.push(`<g ${attrs}>${els.map((e) => elementSvg(e, defs)).join('')}</g>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${n(b.w)}" height="${n(b.h)}" viewBox="${n(b.x)} ${n(b.y)} ${n(b.w)} ${n(b.h)}">
<defs>${defs.join('')}</defs>
${parts.join('\n')}
</svg>`;
}
