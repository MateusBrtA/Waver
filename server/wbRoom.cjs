// Quadro / estúdio de arte em tempo real: regras e eventos únicos para o servidor principal e para a call LAN.
// Tudo que chega de um cliente passa por aqui antes de ser guardado ou repassado:
//  - só campos conhecidos, com tipo e tamanho limitados (ninguém trava o quadro dos outros com um elemento gigante)
//  - imagem só como data:image/... (nada de URL externa que faria o app de todo mundo buscar um endereço qualquer)
//  - limite de elementos, de tamanho total por sala e de eventos por segundo por pessoa
'use strict';

const KINDS = new Set(['stroke', 'line', 'arrow', 'rect', 'ellipse', 'text', 'image', 'gradient', 'artboard', 'path']);
const BRUSHES = new Set([
  'pen', 'airbrush', 'marker', 'calligraphy', 'spray', 'pixel', 'eraser',
  'charcoal', 'watercolor', 'ink', 'splatter', 'crayon', 'neon', 'custom',
]);
// pincéis importados (ponta em PNG pequena, máscara branca com alfa)
const TIP_RE = /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_TIP_CHARS = 120 * 1024;
const MAX_BRUSHES = 32;
const COMPOSITES = new Set([
  'source-over', 'source-atop', 'destination-over', 'destination-out', 'multiply', 'screen', 'overlay', 'darken',
  'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue',
  'saturation', 'color', 'luminosity',
]);
const GRAD_TYPES = new Set(['linear', 'radial', 'reflected', 'angle']);
const BACKGROUNDS = new Set(['dark', 'light', 'grid', 'transparent']);
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const IMAGE_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

const MAX_ELEMENTS = 2500;
const MAX_POINTS = 20000;
const MAX_IMAGE_CHARS = 8 * 1024 * 1024;
const MAX_ROOM_BYTES = 80 * 1024 * 1024;
const MAX_LAYERS = 160; // camadas normais + quadros de animação
const COORD = 1e7;

const num = (v, min, max, def) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
};
const coord = (v) => (v === undefined || v === null ? undefined : Math.round(num(v, -COORD, COORD, 0) * 100) / 100);
const str = (v, max) => String(v ?? '').slice(0, max);

function cleanFx(fx) {
  if (!fx || typeof fx !== 'object') return undefined;
  return {
    brightness: num(fx.brightness, 0, 300, 100),
    contrast: num(fx.contrast, 0, 300, 100),
    saturate: num(fx.saturate, 0, 300, 100),
    hue: num(fx.hue, -180, 180, 0),
    blur: num(fx.blur, 0, 100, 0),
    invert: num(fx.invert, 0, 100, 0),
    grayscale: num(fx.grayscale, 0, 100, 0),
    sepia: num(fx.sepia, 0, 100, 0),
  };
}

function sanitizeLayers(layers) {
  if (!Array.isArray(layers)) return null;
  const seen = new Set();
  const out = [];
  for (const l of layers.slice(0, MAX_LAYERS)) {
    if (!l || typeof l !== 'object' || !ID_RE.test(String(l.id || '')) || seen.has(l.id)) continue;
    seen.add(l.id);
    const layer = {
      id: String(l.id),
      name: str(l.name || 'Camada', 40),
      visible: l.visible !== false,
      locked: Boolean(l.locked),
      opacity: num(l.opacity ?? 1, 0, 1, 1),
      blend: COMPOSITES.has(l.blend) ? l.blend : 'source-over',
    };
    const fx = cleanFx(l.fx);
    if (fx) layer.fx = fx;
    if (l.clip) layer.clip = true;
    if (l.alphaLock) layer.alphaLock = true;
    // quadro de animação: pertence a uma prancheta
    if (l.anim && ID_RE.test(String(l.anim))) layer.anim = String(l.anim);
    out.push(layer);
  }
  return out.length ? out : null;
}

/** Elemento limpo (ou null se inválido). author = { id, name } de quem mandou (o servidor decide, não o cliente). */
function sanitizeElement(el, author, { draft = false } = {}) {
  if (!el || typeof el !== 'object' || !ID_RE.test(String(el.id || '')) || !KINDS.has(el.kind)) return null;
  const out = {
    id: String(el.id),
    kind: el.kind,
    layerId: ID_RE.test(String(el.layerId || '')) ? String(el.layerId) : 'layer-1',
    color: COLOR_RE.test(el.color) ? el.color : '#ffffff',
    size: num(el.size ?? 4, 0.1, 2000, 4),
    opacity: num(el.opacity ?? 1, 0, 1, 1),
    authorId: str(author?.id, 100),
    authorName: str(author?.name, 64),
    createdAt: num(el.createdAt, 0, 8.64e15, Date.now()),
  };
  if (el.hardness !== undefined) out.hardness = num(el.hardness, 0, 1, 0.3);
  if (el.kind === 'stroke') out.brush = BRUSHES.has(el.brush) ? el.brush : 'pen';
  if (out.brush === 'custom') {
    if (!ID_RE.test(String(el.tipId || ''))) out.brush = 'pen';
    else out.tipId = String(el.tipId);
    if (el.spacing !== undefined) out.spacing = num(el.spacing, 0.02, 3, 0.25);
    if (el.jitter !== undefined) out.jitter = num(el.jitter, 0, 1, 0);
  }
  if (el.seed !== undefined) out.seed = Math.floor(num(el.seed, 0, 2147483647, 1));
  if (COMPOSITES.has(el.comp)) out.comp = el.comp;
  for (const k of ['x', 'y', 'x2', 'y2', 'w', 'h', 'tx', 'ty', 'rx', 'ry', 'rw', 'rh']) {
    if (el[k] !== undefined && el[k] !== null) out[k] = coord(el[k]);
  }
  if (el.rot !== undefined) out.rot = num(el.rot, -100, 100, 0);
  if (el.filled !== undefined) out.filled = Boolean(el.filled);
  if (Array.isArray(el.points)) {
    if (el.points.length > MAX_POINTS) return null;
    const pts = [];
    for (const p of el.points) {
      if (!p || typeof p !== 'object') continue;
      pts.push({ x: coord(p.x), y: coord(p.y), p: Math.round(num(p.p ?? 1, 0.01, 1, 1) * 100) / 100 });
    }
    out.points = pts;
  }
  if (el.kind === 'stroke' && !(out.points && out.points.length)) return null;
  if (el.kind === 'path') {
    // curva vetorial: pontos-âncora (p <= 0.5 = canto, senão suave)
    if (!out.points || out.points.length < 2 || out.points.length > 2000) return null;
    out.closed = Boolean(el.closed);
  }
  if (el.text !== undefined) out.text = str(el.text, 5000);
  if (el.fontSize !== undefined) out.fontSize = num(el.fontSize, 4, 600, 28);
  if (el.fontFamily !== undefined) out.fontFamily = str(el.fontFamily, 80);
  if (el.kind === 'image') {
    if (draft) return null; // imagem não vai como rascunho ao vivo
    if (typeof el.dataUrl !== 'string' || el.dataUrl.length > MAX_IMAGE_CHARS || !IMAGE_RE.test(el.dataUrl)) return null;
    out.dataUrl = el.dataUrl;
  }
  if (el.kind === 'gradient') {
    out.color2 = COLOR_RE.test(el.color2) ? el.color2 : '#000000';
    out.gradType = GRAD_TYPES.has(el.gradType) ? el.gradType : 'linear';
    out.gradAlpha2 = num(el.gradAlpha2 ?? 1, 0, 1, 1);
    // área do degradê: limitada a um tamanho razoável
    if (out.rw !== undefined) out.rw = num(out.rw, -200000, 200000, 0);
    if (out.rh !== undefined) out.rh = num(out.rh, -200000, 200000, 0);
  }
  if (el.kind === 'artboard') {
    out.w = num(out.w, 1, 50000, 1080);
    out.h = num(out.h, 1, 50000, 1080);
    if (el.fps !== undefined) out.fps = Math.round(num(el.fps, 1, 60, 12));
  }
  return out;
}

const PATCH_KEYS = ['x', 'y', 'w', 'h', 'x2', 'y2', 'tx', 'ty', 'rot', 'layerId', 'opacity', 'color', 'text', 'fontSize', 'filled', 'color2', 'gradType', 'gradAlpha2', 'comp', 'fps', 'closed'];

function sanitizePatch(current, patch) {
  if (!patch || typeof patch !== 'object') return null;
  const picked = {};
  for (const k of PATCH_KEYS) if (k in patch) picked[k] = patch[k];
  if (!Object.keys(picked).length) return null;
  // confere só as chaves pedidas (patch chega a cada movimento do mouse; pontos e imagem não mudam por aqui)
  const out = {};
  for (const [k, v] of Object.entries(picked)) {
    if (['x', 'y', 'w', 'h', 'x2', 'y2', 'tx', 'ty'].includes(k)) out[k] = coord(v);
    else if (k === 'rot') out.rot = num(v, -100, 100, 0);
    else if (k === 'opacity') out.opacity = num(v, 0, 1, 1);
    else if (k === 'gradAlpha2') out.gradAlpha2 = num(v, 0, 1, 1);
    else if (k === 'fontSize') out.fontSize = num(v, 4, 600, 28);
    else if (k === 'text') out.text = str(v, 5000);
    else if (k === 'filled') out.filled = Boolean(v);
    else if (k === 'closed') out.closed = Boolean(v);
    else if (k === 'fps') out.fps = Math.round(num(v, 1, 60, 12));
    else if (k === 'layerId') {
      if (ID_RE.test(String(v || ''))) out.layerId = String(v);
    } else if (k === 'color' || k === 'color2') {
      if (COLOR_RE.test(v)) out[k] = v;
    } else if (k === 'gradType') {
      if (GRAD_TYPES.has(v)) out.gradType = v;
    } else if (k === 'comp') {
      if (COMPOSITES.has(v)) out.comp = v;
    }
  }
  if (current.kind === 'artboard') {
    if ('w' in out) out.w = num(out.w, 1, 50000, current.w || 1080);
    if ('h' in out) out.h = num(out.h, 1, 50000, current.h || 1080);
  }
  return Object.keys(out).length ? out : null;
}

function approxSize(el) {
  return (el.dataUrl ? el.dataUrl.length : 0) + (el.points ? el.points.length * 28 : 0) + (el.text ? el.text.length : 0) + 300;
}

function sanitizeBrush(b) {
  if (!b || typeof b !== 'object' || !ID_RE.test(String(b.id || ''))) return null;
  if (typeof b.tip !== 'string' || b.tip.length > MAX_TIP_CHARS || !TIP_RE.test(b.tip)) return null;
  return {
    id: String(b.id),
    name: str(b.name || 'Pincel', 40),
    tip: b.tip,
    spacing: num(b.spacing ?? 0.25, 0.02, 3, 0.25),
  };
}

function newState(channelId) {
  return {
    channelId,
    brushes: [],
    background: 'dark',
    layers: [{ id: 'layer-1', name: 'Camada 1', visible: true, locked: false, opacity: 1 }],
    elements: [],
    seq: 0,
  };
}

function roomBytes(wb) {
  // (pincéis: no máx. 32 × 120 KB, fora da conta dos elementos)
  if (typeof wb._bytes !== 'number') wb._bytes = wb.elements.reduce((n, e) => n + approxSize(e), 0);
  return wb._bytes;
}
function recount(wb) {
  wb._bytes = wb.elements.reduce((n, e) => n + approxSize(e), 0);
}

/** Estado sem campos internos (para mandar a quem entra) */
function publicState(wb) {
  return { channelId: wb.channelId, background: wb.background, layers: wb.layers, elements: wb.elements, brushes: wb.brushes || [], seq: wb.seq };
}

/**
 * Liga os eventos wb:* num socket.
 *  ctx.getState(ch)        estado da sala (cria se preciso)
 *  ctx.resolveRoom(ch)     sala efetiva (ou null se este socket não pode usar esta sala)
 *  ctx.canDraw(ch)         pode desenhar? (ver é liberado para quem está na sala)
 *  ctx.author()            { id, name, color } de quem é este socket
 *  ctx.toRoom(ch)          emissor para a sala inteira
 *  ctx.toOthers(ch)        emissor para a sala menos este socket
 */
function attachWhiteboard(socket, ctx) {
  // limite de eventos por segundo (cursor e rascunho ao vivo têm cota própria e maior)
  // main: ações que ficam salvas; live: traço ao vivo e arrastar; cursor: só a posição do mouse
  const LIMITS = { main: [60, 30], live: [300, 150], cursor: [120, 60] };
  const buckets = { main: { t: Date.now(), n: 60 }, live: { t: Date.now(), n: 300 }, cursor: { t: Date.now(), n: 120 } };
  const allow = (kind) => {
    const b = buckets[kind];
    const [cap, rate] = LIMITS[kind];
    const now = Date.now();
    b.n = Math.min(cap, b.n + ((now - b.t) / 1000) * rate);
    b.t = now;
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
  };
  const on = (event, kind, handler) =>
    socket.on(event, (payload, cb) => {
      if (!allow(kind)) return typeof cb === 'function' ? cb({ error: 'Calma: muitas ações por segundo no quadro.' }) : undefined;
      const p = payload && typeof payload === 'object' ? payload : {};
      const ch = ctx.resolveRoom(p.channelId);
      if (!ch) return typeof cb === 'function' ? cb({ error: 'Sem permissão nesta sala.' }) : undefined;
      handler(ch, p, typeof cb === 'function' ? cb : null);
    });
  const drawGuard = (ch) => ctx.canDraw(ch);
  const meta = (wb) => ({ channelId: wb.channelId, layers: wb.layers, background: wb.background, seq: wb.seq });

  on('wb:join', 'main', (ch, _p, cb) => {
    socket.join(`voice:${ch}`);
    cb?.({ ok: true, state: publicState(ctx.getState(ch)) });
  });

  // quem mandou recebe { error, id } quando o elemento é recusado, para tirar da própria tela
  on('wb:add-element', 'main', (ch, p, cb) => {
    const id = str(p.element?.id, 80);
    if (!drawGuard(ch)) return cb?.({ error: 'Você não pode desenhar neste quadro.', id });
    const a = ctx.author();
    const el = sanitizeElement(p.element, a);
    if (!el) return cb?.({ error: 'Elemento inválido ou grande demais.', id });
    const wb = ctx.getState(ch);
    const size = approxSize(el);
    const idx = wb.elements.findIndex((e) => e.id === el.id);
    if (idx !== -1 && wb.elements[idx].authorId !== a.id) return cb?.({ error: 'Esse elemento é de outra pessoa.', id });
    if (roomBytes(wb) + size > MAX_ROOM_BYTES) return cb?.({ error: 'O quadro está cheio (muitas imagens). Apague algo antes.', id });
    if (idx !== -1) wb.elements[idx] = el;
    else wb.elements.push(el);
    if (wb.elements.length > MAX_ELEMENTS) wb.elements = wb.elements.slice(-MAX_ELEMENTS);
    recount(wb);
    wb.seq++;
    ctx.toRoom(ch).emit('wb:element-added', { channelId: ch, element: el, seq: wb.seq });
    cb?.({ ok: true, id: el.id });
  });

  on('wb:update-element', 'main', (ch, p) => {
    if (!drawGuard(ch) || !p.element || typeof p.element !== 'object') return;
    const wb = ctx.getState(ch);
    const idx = wb.elements.findIndex((e) => e.id === p.element.id);
    if (idx === -1) return;
    const cur = wb.elements[idx];
    const el = sanitizeElement({ ...cur, ...p.element, id: cur.id, kind: cur.kind }, { id: cur.authorId, name: cur.authorName });
    if (!el) return;
    wb.elements[idx] = el;
    recount(wb);
    wb.seq++;
    ctx.toRoom(ch).emit('wb:element-updated', { channelId: ch, element: el, seq: wb.seq });
  });

  on('wb:patch-element', 'live', (ch, p) => {
    if (!drawGuard(ch)) return;
    const wb = ctx.getState(ch);
    const el = wb.elements.find((e) => e.id === p.id);
    if (!el) return;
    const safe = sanitizePatch(el, p.patch);
    if (!safe) return;
    Object.assign(el, safe);
    wb.seq++;
    ctx.toOthers(ch).emit('wb:element-patched', { channelId: ch, id: el.id, patch: safe, seq: wb.seq });
  });

  on('wb:delete-element', 'main', (ch, p) => {
    if (!drawGuard(ch)) return;
    const wb = ctx.getState(ch);
    const id = String(p.elementId || '');
    const before = wb.elements.length;
    wb.elements = wb.elements.filter((e) => e.id !== id);
    if (wb.elements.length === before) return;
    recount(wb);
    wb.seq++;
    ctx.toRoom(ch).emit('wb:element-deleted', { channelId: ch, id, seq: wb.seq });
  });

  on('wb:reorder-element', 'main', (ch, p) => {
    if (!drawGuard(ch)) return;
    const wb = ctx.getState(ch);
    const idx = wb.elements.findIndex((e) => e.id === p.id);
    if (idx === -1) return;
    const [el] = wb.elements.splice(idx, 1);
    if (p.toFront) wb.elements.push(el);
    else wb.elements.unshift(el);
    wb.seq++;
    ctx.toOthers(ch).emit('wb:element-reordered', { channelId: ch, id: el.id, toFront: Boolean(p.toFront), seq: wb.seq });
  });

  // Mover vários de uma vez (camada inteira, prancheta com o que tem dentro)
  on('wb:translate', 'main', (ch, p) => {
    if (!drawGuard(ch) || !Array.isArray(p.ids)) return;
    const dx = num(p.dx, -COORD, COORD, 0);
    const dy = num(p.dy, -COORD, COORD, 0);
    if (!dx && !dy) return;
    const wb = ctx.getState(ch);
    const want = new Set(p.ids.slice(0, MAX_ELEMENTS).map(String));
    const lockedLayers = new Set(wb.layers.filter((l) => l.locked).map((l) => l.id));
    const ids = [];
    for (const el of wb.elements) {
      if (!want.has(el.id) || lockedLayers.has(el.layerId)) continue;
      // mesmo arredondamento do app (artEngine.translatePatch): todo mundo chega no mesmo número
      const r1 = (n) => Math.round(num(n, -COORD, COORD, 0) * 10) / 10;
      if (el.kind === 'image') {
        el.x = r1((el.x || 0) + dx);
        el.y = r1((el.y || 0) + dy);
      } else {
        el.tx = r1((el.tx || 0) + dx);
        el.ty = r1((el.ty || 0) + dy);
      }
      ids.push(el.id);
    }
    if (!ids.length) return;
    wb.seq++;
    ctx.toOthers(ch).emit('wb:translated', { channelId: ch, ids, dx, dy, seq: wb.seq });
  });

  // Traço ao vivo: repassa o desenho em andamento (não é salvo)
  on('wb:draft', 'live', (ch, p) => {
    if (!drawGuard(ch)) return;
    if (p.cancel) {
      ctx.toOthers(ch).emit('wb:draft', { channelId: ch, socketId: socket.id, cancel: true, id: str(p.id, 80) });
      return;
    }
    const a = ctx.author();
    const d = sanitizeElement(p.draft, a, { draft: true });
    if (!d || (d.points && d.points.length > 4000)) return;
    // não é volátil: o traço ao vivo vai em pedaços (from), e perder um deixaria um buraco na tela dos outros
    ctx.toOthers(ch).emit('wb:draft', {
      channelId: ch,
      socketId: socket.id,
      from: Math.floor(num(p.from, 0, MAX_POINTS, 0)),
      draft: d,
    });
  });

  on('wb:undo', 'main', (ch) => {
    if (!drawGuard(ch)) return;
    const a = ctx.author();
    const wb = ctx.getState(ch);
    for (let i = wb.elements.length - 1; i >= 0; i--) {
      if (wb.elements[i].authorId === a.id) {
        const [rem] = wb.elements.splice(i, 1);
        recount(wb);
        wb.seq++;
        ctx.toRoom(ch).emit('wb:element-deleted', { channelId: ch, id: rem.id, seq: wb.seq });
        return;
      }
    }
  });

  on('wb:clear', 'main', (ch, p) => {
    if (!drawGuard(ch)) return;
    const wb = ctx.getState(ch);
    const layerId = p.layerId ? String(p.layerId) : '';
    wb.elements = layerId ? wb.elements.filter((e) => e.layerId !== layerId) : [];
    recount(wb);
    wb.seq++;
    ctx.toRoom(ch).emit('wb:state', publicState(wb));
  });

  on('wb:layers-update', 'main', (ch, p) => {
    if (!drawGuard(ch)) return;
    const layers = sanitizeLayers(p.layers);
    if (!layers) return;
    const wb = ctx.getState(ch);
    wb.layers = layers;
    wb.seq++;
    ctx.toOthers(ch).emit('wb:meta', meta(wb));
  });

  // Duplicar camada: copia os elementos com ids novos, logo acima da original
  on('wb:duplicate-layer', 'main', (ch, p) => {
    if (!drawGuard(ch)) return;
    const wb = ctx.getState(ch);
    const fromId = String(p.layerId || '');
    const newId = String(p.newLayerId || '');
    const srcIdx = wb.layers.findIndex((l) => l.id === fromId);
    if (srcIdx === -1 || !ID_RE.test(newId) || wb.layers.some((l) => l.id === newId) || wb.layers.length >= MAX_LAYERS) return;
    const src = wb.layers[srcIdx];
    const a = ctx.author();
    // as cópias são de quem duplicou (o "desfazer" do autor original não apaga a cópia de outra pessoa)
    const copies = wb.elements
      .filter((e) => e.layerId === fromId)
      .map((e, i) => ({ ...e, id: `${newId}-${i}-${e.id}`.slice(0, 80), layerId: newId, authorId: str(a.id, 100), authorName: str(a.name, 64) }));
    const extra = copies.reduce((n, e) => n + approxSize(e), 0);
    if (wb.elements.length + copies.length > MAX_ELEMENTS || roomBytes(wb) + extra > MAX_ROOM_BYTES) return;
    wb.layers.splice(srcIdx + 1, 0, { ...src, id: newId, name: str(p.name || `${src.name} cópia`, 40) });
    wb.elements.push(...copies);
    recount(wb);
    wb.seq++;
    ctx.toRoom(ch).emit('wb:state', publicState(wb));
  });

  // Mesclar com a camada de baixo: os elementos passam para ela, por cima do que ela já tinha
  on('wb:merge-down', 'main', (ch, p) => {
    if (!drawGuard(ch)) return;
    const wb = ctx.getState(ch);
    const idx = wb.layers.findIndex((l) => l.id === p.layerId);
    if (idx <= 0) return;
    const top = wb.layers[idx];
    const below = wb.layers[idx - 1];
    if (top.locked || below.locked) return;
    // a opacidade da camada de cima passa para cada elemento, para o resultado ficar igual
    const lo = num(top.opacity ?? 1, 0, 1, 1);
    // o modo de mistura da camada de cima também passa para os elementos (os que não têm modo próprio)
    const blend = typeof top.blend === 'string' && top.blend !== 'source-over' && COMPOSITES.has(top.blend) ? top.blend : null;
    const moved = wb.elements
      .filter((e) => e.layerId === top.id)
      .map((e) => {
        const m = { ...e, layerId: below.id, opacity: Math.round(num(e.opacity ?? 1, 0, 1, 1) * lo * 1000) / 1000 };
        if (blend && (!e.comp || e.comp === 'source-over') && !(e.kind === 'stroke' && e.brush === 'eraser')) m.comp = blend;
        return m;
      });
    wb.elements = [...wb.elements.filter((e) => e.layerId !== top.id), ...moved];
    wb.layers.splice(idx, 1);
    wb.seq++;
    ctx.toRoom(ch).emit('wb:state', publicState(wb));
  });

  // biblioteca de pincéis da sala (todo mundo desenha com a mesma ponta)
  on('wb:brush-add', 'main', (ch, p, cb) => {
    if (!drawGuard(ch)) return cb?.({ error: 'Você não pode desenhar neste quadro.' });
    const b = sanitizeBrush(p.brush);
    if (!b) return cb?.({ error: 'Pincel inválido (use PNG até 120 KB).' });
    const wb = ctx.getState(ch);
    if (!wb.brushes) wb.brushes = [];
    if (wb.brushes.some((x) => x.id === b.id)) return cb?.({ ok: true });
    if (wb.brushes.length >= MAX_BRUSHES) return cb?.({ error: `Limite de ${MAX_BRUSHES} pincéis por sala.` });
    wb.brushes.push(b);
    wb.seq++;
    ctx.toRoom(ch).emit('wb:brushes', { channelId: ch, brushes: wb.brushes });
    cb?.({ ok: true });
  });
  on('wb:brush-remove', 'main', (ch, p) => {
    if (!drawGuard(ch)) return;
    const wb = ctx.getState(ch);
    const before = (wb.brushes || []).length;
    wb.brushes = (wb.brushes || []).filter((x) => x.id !== p.id);
    if (wb.brushes.length === before) return;
    wb.seq++;
    ctx.toRoom(ch).emit('wb:brushes', { channelId: ch, brushes: wb.brushes });
  });

  on('wb:background', 'main', (ch, p) => {
    if (!drawGuard(ch) || !BACKGROUNDS.has(p.background)) return;
    const wb = ctx.getState(ch);
    wb.background = p.background;
    wb.seq++;
    ctx.toOthers(ch).emit('wb:meta', meta(wb));
  });

  on('wb:cursor', 'cursor', (ch, p) => {
    const a = ctx.author();
    ctx.toOthers(ch).volatile.emit('wb:cursor', {
      socketId: socket.id,
      userId: a.id,
      displayName: a.name,
      color: COLOR_RE.test(a.color) ? a.color : '#5865F2',
      x: num(p.x, -COORD, COORD, 0),
      y: num(p.y, -COORD, COORD, 0),
      size: num(p.size, 0, 2000, 6),
      tool: str(p.tool || 'pen', 20),
      isDrawing: Boolean(p.isDrawing),
    });
  });
}

module.exports = { attachWhiteboard, sanitizeElement, sanitizeLayers, sanitizePatch, newState, publicState, MAX_ELEMENTS };
