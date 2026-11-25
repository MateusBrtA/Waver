import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowUpRight,
  Brush,
  ChevronsDown,
  ChevronsUp,
  Circle,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Feather,
  Grid3x3,
  Hand,
  Highlighter,
  ImagePlus,
  Layers,
  Lock,
  LockOpen,
  Maximize,
  Minimize,
  Minus,
  MousePointer2,
  PaintBucket,
  Pipette,
  Plus,
  RotateCcw,
  Scan,
  SprayCan,
  Square,
  Trash2,
  Type,
  Wind,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Socket } from 'socket.io-client';
import type {
  User,
  WhiteboardBrush,
  WhiteboardCursor,
  WhiteboardElement,
  WhiteboardLayer,
  WhiteboardPoint,
  WhiteboardState,
  WhiteboardTool,
} from '../types';
import {
  Bounds,
  DrawEnv,
  View,
  WB_FONT,
  clamp,
  drawBackground,
  drawElement,
  elementBounds,
  floodFillMask,
  hitTestElement,
  imageLocalToWorld,
  renderElements,
  rgbToHex,
  unionBounds,
  worldToImageLocal,
} from '../lib/whiteboardRender';

type Tool = WhiteboardTool | 'hand';
type HandleId = { hx: -1 | 0 | 1; hy: -1 | 0 | 1 } | 'rot';

const BRUSHES: WhiteboardBrush[] = ['pen', 'airbrush', 'marker', 'calligraphy', 'spray', 'pixel', 'eraser'];
const SHAPES = ['line', 'arrow', 'rect', 'ellipse'] as const;
const isBrush = (t: Tool): t is WhiteboardBrush => (BRUSHES as string[]).includes(t);
const isShape = (t: Tool): t is (typeof SHAPES)[number] => (SHAPES as readonly string[]).includes(t);

const MIN_Z = 0.05;
const MAX_Z = 16;
const DEFAULT_BOARD: Bounds = { x: 0, y: 0, w: 1600, h: 900 };
const MAX_IMAGE_SIDE = 2048;

const SWATCHES = [
  '#ffffff', '#000000', '#949ba4', '#f23f42', '#f0b232', '#fee75c',
  '#23a55a', '#00a8fc', '#5865f2', '#9b59b6', '#eb459e', '#7a4b2a',
];

const BLEND_MODES: Array<[string, string]> = [
  ['source-over', 'Normal'],
  ['multiply', 'Multiplicação'],
  ['screen', 'Tela'],
  ['overlay', 'Sobrepor'],
  ['darken', 'Escurecer'],
  ['lighten', 'Clarear'],
  ['color-dodge', 'Subexposição de cor'],
  ['difference', 'Diferença'],
];

const TOOL_GROUPS: Array<Array<{ id: Tool; label: string; key?: string; icon: React.ReactNode }>> = [
  [
    { id: 'select', label: 'Mover / redimensionar', key: 'V', icon: <MousePointer2 className="w-[18px] h-[18px]" /> },
    { id: 'hand', label: 'Mão (arrastar a tela)', key: 'H', icon: <Hand className="w-[18px] h-[18px]" /> },
  ],
  [
    { id: 'pen', label: 'Pincel', key: 'B', icon: <Brush className="w-[18px] h-[18px]" /> },
    { id: 'airbrush', label: 'Aerógrafo', icon: <Wind className="w-[18px] h-[18px]" /> },
    { id: 'marker', label: 'Marca-texto', icon: <Highlighter className="w-[18px] h-[18px]" /> },
    { id: 'calligraphy', label: 'Caneta caligráfica', icon: <Feather className="w-[18px] h-[18px]" /> },
    { id: 'spray', label: 'Spray', icon: <SprayCan className="w-[18px] h-[18px]" /> },
    { id: 'pixel', label: 'Pixel art', icon: <Grid3x3 className="w-[18px] h-[18px]" /> },
    { id: 'eraser', label: 'Borracha', key: 'E', icon: <Eraser className="w-[18px] h-[18px]" /> },
  ],
  [
    { id: 'line', label: 'Linha', key: 'L', icon: <Minus className="w-[18px] h-[18px]" /> },
    { id: 'arrow', label: 'Seta', key: 'A', icon: <ArrowUpRight className="w-[18px] h-[18px]" /> },
    { id: 'rect', label: 'Retângulo', key: 'U', icon: <Square className="w-[18px] h-[18px]" /> },
    { id: 'ellipse', label: 'Elipse', key: 'O', icon: <Circle className="w-[18px] h-[18px]" /> },
  ],
  [
    { id: 'text', label: 'Texto', key: 'T', icon: <Type className="w-[18px] h-[18px]" /> },
    { id: 'fill', label: 'Balde de tinta', key: 'G', icon: <PaintBucket className="w-[18px] h-[18px]" /> },
    { id: 'eyedropper', label: 'Conta-gotas', key: 'I', icon: <Pipette className="w-[18px] h-[18px]" /> },
  ],
];
const TOOL_LABEL: Record<string, string> = Object.fromEntries(TOOL_GROUPS.flat().map((t) => [t.id, t.label]));
const KEY_TO_TOOL: Record<string, Tool> = Object.fromEntries(
  TOOL_GROUPS.flat()
    .filter((t) => t.key)
    .map((t) => [t.key!.toLowerCase(), t.id] as [string, Tool])
);

const newId = () => `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const r1 = (n: number) => Math.round(n * 10) / 10;

function isEditableTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function shallowSame(a: WhiteboardElement[], b: WhiteboardElement[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface LayerCache {
  canvas: HTMLCanvasElement;
  els: WhiteboardElement[];
  key: string;
}

interface DragState {
  mode: 'pan' | 'draw' | 'shape' | 'move' | 'resize' | 'rotate';
  pointerId: number;
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  view: View;
  start?: WhiteboardElement;
  handle?: HandleId;
  moved?: boolean;
}

interface WhiteboardPanelProps {
  socket: Socket | null;
  channelId: string;
  user: User;
  canDraw: boolean;
  onClose: () => void;
}

export const WhiteboardPanel: React.FC<WhiteboardPanelProps> = ({ socket, channelId, user, canDraw, onClose }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushCursorRef = useRef<HTMLDivElement | null>(null);

  const [wb, setWb] = useState<WhiteboardState>({
    channelId,
    background: 'dark',
    layers: [{ id: 'layer-1', name: 'Camada 1', visible: true, locked: false, opacity: 1 }],
    elements: [],
    seq: 0,
  });
  const wbRef = useRef(wb);
  wbRef.current = wb;

  const [activeLayerId, setActiveLayerId] = useState('layer-1');
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#ffffff');
  const [color2, setColor2] = useState('#000000');
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [size, setSize] = useState(8);
  const [opacity, setOpacity] = useState(1);
  const [hardness, setHardness] = useState(0.3);
  const [pressureSize, setPressureSize] = useState(true);
  const [pressureOpacity, setPressureOpacity] = useState(false);
  const [shapeFilled, setShapeFilled] = useState(false);
  const [fontSize, setFontSize] = useState(32);
  const [fillTolerance, setFillTolerance] = useState(40);
  const [penActive, setPenActive] = useState(false);

  const [view, setViewState] = useState<View>({ x: 0, y: 0, z: 1 });
  const viewRef = useRef(view);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [showPanel, setShowPanel] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, WhiteboardCursor & { ts: number }>>({});
  const [textEdit, setTextEdit] = useState<{ id?: string; x: number; y: number; value: string; fontSize: number; color: string } | null>(null);
  const textEditRef = useRef(textEdit);
  textEditRef.current = textEdit;
  const [editingLayerName, setEditingLayerName] = useState<string | null>(null);
  const [layerDrag, setLayerDrag] = useState<{ id: string; over: number | null } | null>(null);

  // refs de renderização (fora do React para não re-renderizar a cada ponto)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const cachesRef = useRef<Map<string, LayerCache>>(new Map());
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const envRef = useRef<DrawEnv | null>(null);
  const imgVersionRef = useRef(0);
  const rafRef = useRef(0);
  const draftRef = useRef<WhiteboardElement | null>(null);
  const draftSentRef = useRef(0);
  const lastDraftEmitRef = useRef(0);
  const remoteDraftsRef = useRef<Map<string, { el: WhiteboardElement; ts: number }>>(new Map());
  const livePatchRef = useRef<WhiteboardElement | null>(null);
  const lastPatchEmitRef = useRef(0);
  const hiddenIdRef = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastCursorSentRef = useRef(0);
  const spaceRef = useRef(false);
  const viewTouchedRef = useRef(false);
  const thumbsRef = useRef<Map<string, HTMLCanvasElement | null>>(new Map());
  const lastThumbRef = useRef(0);
  const showPanelRef = useRef(showPanel);
  showPanelRef.current = showPanel;
  const noticeTimerRef = useRef<number | null>(null);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2200);
  }, []);

  /* ---------------------------------------------------------------- render */

  const getEnv = useCallback((): DrawEnv => {
    if (!envRef.current) {
      envRef.current = {
        imgs: new Map(),
        scratch: document.createElement('canvas'),
        onImg: () => {
          imgVersionRef.current++;
          requestRenderRef.current();
        },
      };
    }
    return envRef.current;
  }, []);

  const renderNow = useCallback(() => {
    const canvas = canvasRef.current;
    const { w, h, dpr } = sizeRef.current;
    if (!canvas || !w || !h) return;
    const W = Math.max(1, Math.round(w * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const v = viewRef.current;
    const st = wbRef.current;
    const env = getEnv();
    const visible: Bounds = { x: -v.x / v.z, y: -v.y / v.z, w: w / v.z, h: h / v.z };
    const viewKey = `${v.x.toFixed(2)}|${v.y.toFixed(2)}|${v.z.toFixed(5)}|${W}|${H}|${imgVersionRef.current}`;

    drawBackground(ctx, st.background, v, dpr);

    // agrupa por camada (aplicando a edição ao vivo de mover/redimensionar)
    const fallbackLayer = st.layers[0]?.id || 'layer-1';
    const groups = new Map<string, WhiteboardElement[]>();
    const patch = livePatchRef.current;
    const hidden = hiddenIdRef.current;
    for (const raw of st.elements) {
      if (raw.id === hidden) continue;
      const el = patch && raw.id === patch.id ? patch : raw;
      const lid = st.layers.some((l) => l.id === el.layerId) ? el.layerId : fallbackLayer;
      let arr = groups.get(lid);
      if (!arr) groups.set(lid, (arr = []));
      arr.push(el);
    }
    const draftGroups = new Map<string, WhiteboardElement[]>();
    const pushDraft = (d: WhiteboardElement) => {
      const lid = st.layers.some((l) => l.id === d.layerId) ? d.layerId : fallbackLayer;
      let arr = draftGroups.get(lid);
      if (!arr) draftGroups.set(lid, (arr = []));
      arr.push(d);
    };
    remoteDraftsRef.current.forEach((d) => pushDraft(d.el));
    if (draftRef.current) pushDraft(draftRef.current);

    const caches = cachesRef.current;
    for (const layer of st.layers) {
      const els = groups.get(layer.id) || [];
      const drafts = draftGroups.get(layer.id);
      if (!layer.visible || (!els.length && !drafts)) {
        caches.delete(layer.id);
        continue;
      }
      let entry = caches.get(layer.id);
      if (!entry) {
        entry = { canvas: document.createElement('canvas'), els: [], key: '' };
        caches.set(layer.id, entry);
      }
      if (entry.key !== viewKey || !shallowSame(entry.els, els)) {
        if (entry.canvas.width !== W || entry.canvas.height !== H) {
          entry.canvas.width = W;
          entry.canvas.height = H;
        }
        renderElements(entry.canvas.getContext('2d')!, els, v, dpr, env, visible);
        entry.els = els;
        entry.key = viewKey;
      }
      let src: HTMLCanvasElement = entry.canvas;
      if (drafts) {
        if (!liveCanvasRef.current) liveCanvasRef.current = document.createElement('canvas');
        const live = liveCanvasRef.current;
        if (live.width !== W || live.height !== H) {
          live.width = W;
          live.height = H;
        }
        const lctx = live.getContext('2d')!;
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.globalAlpha = 1;
        lctx.globalCompositeOperation = 'source-over';
        lctx.clearRect(0, 0, W, H);
        lctx.drawImage(entry.canvas, 0, 0);
        lctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
        for (const d of drafts) drawElement(lctx, d, env);
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        src = live;
      }
      ctx.save();
      ctx.globalAlpha = clamp(layer.opacity ?? 1, 0, 1);
      ctx.globalCompositeOperation = (layer.blend as GlobalCompositeOperation) || 'source-over';
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    }
    for (const id of Array.from(caches.keys())) {
      if (!st.layers.some((l) => l.id === id)) caches.delete(id);
    }

    // seleção (caixa + alças)
    const selId = selectedIdRef.current;
    const selEl = selId ? (patch && patch.id === selId ? patch : st.elements.find((e) => e.id === selId)) : null;
    if (selEl && selEl.id !== hidden) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = '#5865f2';
      ctx.lineWidth = 1.5;
      const toS = (p: { x: number; y: number }) => ({ x: p.x * v.z + v.x, y: p.y * v.z + v.y });
      if (selEl.kind === 'image') {
        const w2 = (selEl.w || 0) / 2;
        const h2 = (selEl.h || 0) / 2;
        const corners = [
          [-w2, -h2],
          [w2, -h2],
          [w2, h2],
          [-w2, h2],
        ].map(([lx, ly]) => toS(imageLocalToWorld(selEl, lx, ly)));
        ctx.beginPath();
        corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
        ctx.closePath();
        ctx.stroke();
        const top = toS(imageLocalToWorld(selEl, 0, -h2));
        const rot = toS(imageLocalToWorld(selEl, 0, -h2 - 26 / v.z));
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(rot.x, rot.y);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(rot.x, rot.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        for (const hd of imageHandles(selEl)) {
          const p = toS(imageLocalToWorld(selEl, hd.lx, hd.ly));
          ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
          ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
        }
      } else {
        const b = elementBounds(selEl);
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x * v.z + v.x - 3, b.y * v.z + v.y - 3, b.w * v.z + 6, b.h * v.z + 6);
      }
      ctx.restore();
    }

    // miniaturas das camadas (no máx. ~2x por segundo)
    const now = performance.now();
    if (showPanelRef.current && now - lastThumbRef.current > 450) {
      lastThumbRef.current = now;
      for (const layer of st.layers) {
        const t = thumbsRef.current.get(layer.id);
        if (!t) continue;
        const tctx = t.getContext('2d');
        if (!tctx) continue;
        tctx.clearRect(0, 0, t.width, t.height);
        const entry = caches.get(layer.id);
        if (entry) tctx.drawImage(entry.canvas, 0, 0, t.width, t.height);
      }
    }
  }, [getEnv]);

  const requestRender = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      renderNow();
    });
  }, [renderNow]);
  const requestRenderRef = useRef(requestRender);
  requestRenderRef.current = requestRender;

  const setView = useCallback(
    (next: View, byUser = true) => {
      if (byUser) viewTouchedRef.current = true;
      const v = { x: next.x, y: next.y, z: clamp(next.z, MIN_Z, MAX_Z) };
      viewRef.current = v;
      setViewState(v);
      requestRender();
    },
    [requestRender]
  );

  const zoomAt = useCallback(
    (factor: number, sx?: number, sy?: number) => {
      const v = viewRef.current;
      const { w, h } = sizeRef.current;
      const cx = sx ?? w / 2;
      const cy = sy ?? h / 2;
      const z = clamp(v.z * factor, MIN_Z, MAX_Z);
      const wx = (cx - v.x) / v.z;
      const wy = (cy - v.y) / v.z;
      setView({ x: cx - wx * z, y: cy - wy * z, z });
    },
    [setView]
  );

  const fitTo = useCallback(
    (b: Bounds | null) => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const box = b && b.w > 0 && b.h > 0 ? b : DEFAULT_BOARD;
      const z = clamp(Math.min(w / box.w, h / box.h) * 0.9, MIN_Z, 4);
      setView({ x: w / 2 - (box.x + box.w / 2) * z, y: h / 2 - (box.y + box.h / 2) * z, z }, false);
    },
    [setView]
  );

  const contentBounds = useCallback(() => {
    const st = wbRef.current;
    const visibleLayers = new Set(st.layers.filter((l) => l.visible).map((l) => l.id));
    return unionBounds(
      st.elements
        .filter((e) => visibleLayers.has(e.layerId) && !(e.kind === 'stroke' && e.brush === 'eraser'))
        .map(elementBounds)
    );
  }, []);

  useEffect(() => {
    requestRender();
  }, [wb, selectedId, requestRender]);

  // tamanho do viewport
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const apply = () => {
      const r = vp.getBoundingClientRect();
      sizeRef.current = { w: Math.round(r.width), h: Math.round(r.height), dpr: window.devicePixelRatio || 1 };
      // até a pessoa mexer na câmera, mantém o conteúdo enquadrado (inclusive ao redimensionar o painel)
      if (!viewTouchedRef.current && r.width > 0) fitTo(contentBounds());
      requestRender();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [fitTo, contentBounds, requestRender]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0; // StrictMode remonta: sem isso o próximo requestRender nunca agenda
      cachesRef.current.clear();
      liveCanvasRef.current = null;
      envRef.current = null;
    },
    []
  );

  /* ---------------------------------------------------------------- socket */

  useEffect(() => {
    if (!socket || !channelId) return;
    socket.emit('wb:join', { channelId }, (res: { ok?: boolean; state?: WhiteboardState }) => {
      if (!res?.state) return;
      setWb(res.state);
      const top = res.state.layers[res.state.layers.length - 1];
      if (top) setActiveLayerId(top.id);
      wbRef.current = res.state;
      if (!viewTouchedRef.current) requestAnimationFrame(() => fitTo(contentBounds()));
    });

    const forThis = (ch?: string) => !ch || ch === channelId;
    const onState = (st: WhiteboardState) => {
      if (forThis(st.channelId)) setWb(st);
    };
    const onMeta = (m: { channelId: string; layers?: WhiteboardLayer[]; background?: WhiteboardState['background'] }) => {
      if (!forThis(m.channelId)) return;
      setWb((p) => ({ ...p, layers: m.layers || p.layers, background: m.background || p.background }));
    };
    const onAdded = ({ channelId: ch, element }: { channelId: string; element: WhiteboardElement }) => {
      if (!forThis(ch)) return;
      remoteDraftsRef.current.delete(element.id);
      setWb((p) => {
        const idx = p.elements.findIndex((e) => e.id === element.id);
        if (idx !== -1) {
          const next = p.elements.slice();
          next[idx] = element;
          return { ...p, elements: next };
        }
        return { ...p, elements: [...p.elements, element] };
      });
    };
    const onUpdated = ({ channelId: ch, element }: { channelId: string; element: WhiteboardElement }) => {
      if (!forThis(ch)) return;
      setWb((p) => ({ ...p, elements: p.elements.map((e) => (e.id === element.id ? element : e)) }));
    };
    const onPatched = ({ channelId: ch, id, patch }: { channelId: string; id: string; patch: Partial<WhiteboardElement> }) => {
      if (!forThis(ch)) return;
      setWb((p) => ({ ...p, elements: p.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    };
    const onDeleted = ({ channelId: ch, id }: { channelId: string; id: string }) => {
      if (!forThis(ch)) return;
      setWb((p) => ({ ...p, elements: p.elements.filter((e) => e.id !== id) }));
      setSelectedId((s) => (s === id ? null : s));
    };
    const onReordered = ({ channelId: ch, id, toFront }: { channelId: string; id: string; toFront: boolean }) => {
      if (!forThis(ch)) return;
      setWb((p) => {
        const el = p.elements.find((e) => e.id === id);
        if (!el) return p;
        const rest = p.elements.filter((e) => e.id !== id);
        return { ...p, elements: toFront ? [...rest, el] : [el, ...rest] };
      });
    };
    const onDraft = (msg: { channelId: string; socketId: string; from?: number; draft?: WhiteboardElement; id?: string; cancel?: boolean }) => {
      if (!forThis(msg.channelId)) return;
      const map = remoteDraftsRef.current;
      if (msg.cancel) {
        if (msg.id) map.delete(msg.id);
        requestRenderRef.current();
        return;
      }
      const d = msg.draft;
      if (!d?.id) return;
      const from = msg.from || 0;
      const prev = map.get(d.id);
      if (d.kind !== 'stroke' || !prev || from === 0) {
        map.set(d.id, { el: { ...d, points: d.points ? d.points.slice() : undefined }, ts: Date.now() });
      } else {
        const prevPts = prev.el.points || [];
        const base = prevPts.length >= from ? prevPts.slice(0, from) : prevPts;
        map.set(d.id, { el: { ...prev.el, ...d, points: base.concat(d.points || []) }, ts: Date.now() });
      }
      requestRenderRef.current();
    };
    const onCursor = (cur: WhiteboardCursor) => {
      setRemoteCursors((prev) => ({ ...prev, [cur.socketId]: { ...cur, ts: Date.now() } }));
    };

    socket.on('wb:state', onState);
    socket.on('wb:meta', onMeta);
    socket.on('wb:element-added', onAdded);
    socket.on('wb:element-updated', onUpdated);
    socket.on('wb:element-patched', onPatched);
    socket.on('wb:element-deleted', onDeleted);
    socket.on('wb:element-reordered', onReordered);
    socket.on('wb:draft', onDraft);
    socket.on('wb:cursor', onCursor);

    const pruneT = window.setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        let changed = false;
        const next: Record<string, WhiteboardCursor & { ts: number }> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.ts < 5000) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
      let dropped = false;
      remoteDraftsRef.current.forEach((d, id) => {
        if (now - d.ts > 10000) {
          remoteDraftsRef.current.delete(id);
          dropped = true;
        }
      });
      if (dropped) requestRenderRef.current();
    }, 2000);

    return () => {
      window.clearInterval(pruneT);
      socket.off('wb:state', onState);
      socket.off('wb:meta', onMeta);
      socket.off('wb:element-added', onAdded);
      socket.off('wb:element-updated', onUpdated);
      socket.off('wb:element-patched', onPatched);
      socket.off('wb:element-deleted', onDeleted);
      socket.off('wb:element-reordered', onReordered);
      socket.off('wb:draft', onDraft);
      socket.off('wb:cursor', onCursor);
    };
  }, [socket, channelId, fitTo, contentBounds]);

  // camada ativa removida por outra pessoa
  useEffect(() => {
    if (!wb.layers.some((l) => l.id === activeLayerId) && wb.layers.length) {
      setActiveLayerId(wb.layers[wb.layers.length - 1].id);
    }
  }, [wb.layers, activeLayerId]);

  const activeLayer = useMemo(
    () => wb.layers.find((l) => l.id === activeLayerId) || wb.layers[wb.layers.length - 1],
    [wb.layers, activeLayerId]
  );
  const selectedEl = useMemo(() => wb.elements.find((e) => e.id === selectedId) || null, [wb.elements, selectedId]);

  /* ---------------------------------------------------------------- actions */

  const pushRecent = (c: string) =>
    setRecentColors((prev) => [c, ...prev.filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 10));

  const commitElement = useCallback(
    (el: WhiteboardElement) => {
      setWb((p) => (p.elements.some((x) => x.id === el.id) ? p : { ...p, elements: [...p.elements, el] }));
      socket?.emit('wb:add-element', { channelId, element: el });
    },
    [socket, channelId]
  );

  const patchElement = useCallback(
    (id: string, patch: Partial<WhiteboardElement>) => {
      setWb((p) => ({ ...p, elements: p.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
      socket?.emit('wb:patch-element', { channelId, id, patch });
    },
    [socket, channelId]
  );

  const deleteElement = useCallback(
    (id: string) => {
      setWb((p) => ({ ...p, elements: p.elements.filter((e) => e.id !== id) }));
      setSelectedId((s) => (s === id ? null : s));
      socket?.emit('wb:delete-element', { channelId, elementId: id });
    },
    [socket, channelId]
  );

  const reorderElement = (id: string, toFront: boolean) => {
    setWb((p) => {
      const el = p.elements.find((e) => e.id === id);
      if (!el) return p;
      const rest = p.elements.filter((e) => e.id !== id);
      return { ...p, elements: toFront ? [...rest, el] : [el, ...rest] };
    });
    socket?.emit('wb:reorder-element', { channelId, id, toFront });
  };

  const updateLayers = (next: WhiteboardLayer[]) => {
    setWb((p) => ({ ...p, layers: next }));
    socket?.emit('wb:layers-update', { channelId, layers: next });
  };

  const addLayer = () => {
    if (wb.layers.length >= 32) return flash('Limite de 32 camadas.');
    const id = `layer-${Date.now().toString(36)}`;
    const idx = wb.layers.findIndex((l) => l.id === activeLayerId);
    const next = wb.layers.slice();
    const n = wb.layers.length + 1;
    next.splice(idx === -1 ? next.length : idx + 1, 0, { id, name: `Camada ${n}`, visible: true, locked: false, opacity: 1 });
    updateLayers(next);
    setActiveLayerId(id);
  };

  const deleteLayer = (id: string) => {
    if (wb.layers.length <= 1) return;
    const rem = wb.layers.filter((l) => l.id !== id);
    updateLayers(rem);
    setWb((p) => ({ ...p, elements: p.elements.filter((e) => e.layerId !== id) }));
    socket?.emit('wb:clear', { channelId, layerId: id });
    if (activeLayerId === id) setActiveLayerId(rem[rem.length - 1].id);
  };

  const clearLayer = (id: string) => {
    setWb((p) => ({ ...p, elements: p.elements.filter((e) => e.layerId !== id) }));
    socket?.emit('wb:clear', { channelId, layerId: id });
  };

  const undo = useCallback(() => {
    if (!canDraw) return;
    socket?.emit('wb:undo', { channelId });
  }, [canDraw, socket, channelId]);

  const insertImageBlob = useCallback(
    (blob: Blob, at?: { x: number; y: number }) => {
      if (!canDraw || !socket) return;
      const layer = wbRef.current.layers.find((l) => l.id === activeLayerId);
      if (layer?.locked) return flash('A camada ativa está bloqueada.');
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
        const pw = Math.max(1, Math.round(img.width * scale));
        const ph = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = pw;
        c.height = ph;
        c.getContext('2d')?.drawImage(img, 0, 0, pw, ph);
        const isPng = blob.type === 'image/png' || blob.type === 'image/gif';
        let dataUrl = c.toDataURL(isPng ? 'image/webp' : 'image/jpeg', 0.9);
        if (dataUrl.length > 8_000_000) dataUrl = c.toDataURL('image/jpeg', 0.75);
        const v = viewRef.current;
        const { w, h } = sizeRef.current;
        // 100% do tamanho real, mas cabendo em ~80% da área visível
        const fit = Math.min(1, ((w * 0.8) / v.z) / img.width, ((h * 0.8) / v.z) / img.height);
        const ww = img.width * fit;
        const wh = img.height * fit;
        const cx = at ? at.x : (w / 2 - v.x) / v.z;
        const cy = at ? at.y : (h / 2 - v.y) / v.z;
        const el: WhiteboardElement = {
          id: newId(),
          kind: 'image',
          layerId: activeLayerId,
          color: '#ffffff',
          size: 1,
          opacity: 1,
          x: r1(cx - ww / 2),
          y: r1(cy - wh / 2),
          w: r1(ww),
          h: r1(wh),
          rot: 0,
          dataUrl,
          authorId: user.id,
          authorName: user.displayName,
          createdAt: Date.now(),
        };
        commitElement(el);
        setSelectedId(el.id);
        setTool('select');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        flash('Não consegui abrir essa imagem.');
      };
      img.src = url;
    },
    [canDraw, socket, activeLayerId, user.id, user.displayName, commitElement, flash]
  );

  // Ctrl+V com imagem (sem roubar o colar do chat)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            insertImageBlob(f);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [insertImageBlob]);

  const ensureImagesLoaded = async () => {
    const env = getEnv();
    await Promise.all(
      wbRef.current.elements
        .filter((e) => e.kind === 'image' && e.dataUrl)
        .map(
          (e) =>
            new Promise<void>((resolve) => {
              let img = env.imgs.get(e.dataUrl!);
              if (img && img.complete) return resolve();
              if (!img) {
                img = new Image();
                img.src = e.dataUrl!;
                env.imgs.set(e.dataUrl!, img);
              }
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            })
        )
    );
  };

  const exportPng = async () => {
    const b = contentBounds();
    if (!b) return flash('O quadro está vazio.');
    await ensureImagesLoaded();
    const pad = 32;
    const bx = b.x - pad;
    const by = b.y - pad;
    const bw = b.w + pad * 2;
    const bh = b.h + pad * 2;
    const scale = Math.min(1, 8192 / Math.max(bw, bh));
    const W = Math.max(1, Math.round(bw * scale));
    const H = Math.max(1, Math.round(bh * scale));
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const octx = out.getContext('2d')!;
    const st = wbRef.current;
    const ev: View = { x: -bx * scale, y: -by * scale, z: scale };
    if (st.background !== 'transparent') drawBackground(octx, st.background, ev, 1);
    const env = getEnv();
    const lc = document.createElement('canvas');
    lc.width = W;
    lc.height = H;
    const lctx = lc.getContext('2d')!;
    for (const layer of st.layers) {
      if (!layer.visible) continue;
      const els = st.elements.filter((e) => e.layerId === layer.id);
      if (!els.length) continue;
      renderElements(lctx, els, ev, 1, env, null);
      octx.save();
      octx.globalAlpha = layer.opacity ?? 1;
      octx.globalCompositeOperation = (layer.blend as GlobalCompositeOperation) || 'source-over';
      octx.drawImage(lc, 0, 0);
      octx.restore();
    }
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = `whiteboard-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      a.href = url;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
  };

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  };
  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  /* ---------------------------------------------------------------- pointer */

  const screenPoint = (e: { clientX: number; clientY: number }) => {
    const r = viewportRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const toWorld = (sx: number, sy: number) => {
    const v = viewRef.current;
    return { x: (sx - v.x) / v.z, y: (sy - v.y) / v.z };
  };

  function imageHandles(el: WhiteboardElement) {
    const w2 = (el.w || 0) / 2;
    const h2 = (el.h || 0) / 2;
    const out: Array<{ hx: -1 | 0 | 1; hy: -1 | 0 | 1; lx: number; ly: number }> = [];
    for (const hx of [-1, 0, 1] as const)
      for (const hy of [-1, 0, 1] as const) {
        if (!hx && !hy) continue;
        out.push({ hx, hy, lx: hx * w2, ly: hy * h2 });
      }
    return out;
  }

  const hitHandle = (el: WhiteboardElement, sx: number, sy: number): HandleId | null => {
    if (el.kind !== 'image') return null;
    const v = viewRef.current;
    const toS = (p: { x: number; y: number }) => ({ x: p.x * v.z + v.x, y: p.y * v.z + v.y });
    const rot = toS(imageLocalToWorld(el, 0, -(el.h || 0) / 2 - 26 / v.z));
    if (Math.hypot(sx - rot.x, sy - rot.y) <= 8) return 'rot';
    for (const hd of imageHandles(el)) {
      const p = toS(imageLocalToWorld(el, hd.lx, hd.ly));
      if (Math.abs(sx - p.x) <= 7 && Math.abs(sy - p.y) <= 7) return { hx: hd.hx, hy: hd.hy };
    }
    return null;
  };

  const pickElement = (x: number, y: number) => {
    const st = wbRef.current;
    const tol = 5 / viewRef.current.z;
    const order = st.layers.map((l) => l.id);
    for (let li = order.length - 1; li >= 0; li--) {
      const layer = st.layers[li];
      if (!layer.visible || layer.locked) continue;
      for (let i = st.elements.length - 1; i >= 0; i--) {
        const el = st.elements[i];
        if (el.layerId !== layer.id) continue;
        if (hitTestElement(el, x, y, tol)) return el;
      }
    }
    return null;
  };

  const emitCursor = (x: number, y: number, drawing: boolean) => {
    if (!socket) return;
    const now = performance.now();
    if (now - lastCursorSentRef.current < 40) return;
    lastCursorSentRef.current = now;
    socket.emit('wb:cursor', { channelId, x: r1(x), y: r1(y), size, tool, isDrawing: drawing });
  };

  const flushDraft = (force = false) => {
    const d = draftRef.current;
    if (!d || !socket) return;
    const now = performance.now();
    if (!force && now - lastDraftEmitRef.current < 33) return;
    lastDraftEmitRef.current = now;
    if (d.kind === 'stroke') {
      const pts = d.points || [];
      const from = draftSentRef.current;
      if (from >= pts.length && from > 0) return;
      socket.emit('wb:draft', { channelId, from, draft: { ...d, points: pts.slice(from) } });
      draftSentRef.current = pts.length;
    } else {
      socket.emit('wb:draft', { channelId, from: 0, draft: d });
    }
  };

  const cancelDraft = () => {
    const d = draftRef.current;
    if (!d) return;
    draftRef.current = null;
    socket?.emit('wb:draft', { channelId, cancel: true, id: d.id });
    requestRender();
  };

  const sampleColor = (sx: number, sy: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { dpr } = sizeRef.current;
    const px = ctx.getImageData(Math.round(sx * dpr), Math.round(sy * dpr), 1, 1).data;
    if (px[3] === 0) return;
    const hex = rgbToHex(px[0], px[1], px[2]);
    setColor(hex);
    pushRecent(hex);
  };

  const floodFillAt = (sx: number, sy: number) => {
    const { w, h, dpr } = sizeRef.current;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
    for (const layer of wbRef.current.layers) {
      if (!layer.visible) continue;
      const entry = cachesRef.current.get(layer.id);
      if (!entry) continue;
      tctx.globalAlpha = layer.opacity ?? 1;
      tctx.drawImage(entry.canvas, 0, 0);
    }
    const res = floodFillMask(tctx.getImageData(0, 0, W, H), Math.round(sx * dpr), Math.round(sy * dpr), color, fillTolerance);
    if (!res) return;
    const v = viewRef.current;
    const wx = (res.x / dpr - v.x) / v.z;
    const wy = (res.y / dpr - v.y) / v.z;
    commitElement({
      id: newId(),
      kind: 'image',
      layerId: activeLayerId,
      color,
      size: 1,
      opacity,
      x: r1(wx),
      y: r1(wy),
      w: r1(res.canvas.width / dpr / v.z),
      h: r1(res.canvas.height / dpr / v.z),
      rot: 0,
      dataUrl: res.canvas.toDataURL('image/png'),
      authorId: user.id,
      authorName: user.displayName,
      createdAt: Date.now(),
    });
    pushRecent(color);
  };

  const effectiveTool: Tool = spaceHeld ? 'hand' : tool;

  const updateBrushCursor = (sx: number, sy: number, show: boolean) => {
    const el = brushCursorRef.current;
    if (!el) return;
    const d = size * viewRef.current.z;
    if (!show || !isBrush(effectiveTool) || d < 4 || !canDraw) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.transform = `translate(${sx - d / 2}px, ${sy - d / 2}px)`;
    el.style.borderRadius = effectiveTool === 'pixel' || effectiveTool === 'marker' ? '2px' : '50%';
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || dragRef.current) return;
    rootRef.current?.focus({ preventScroll: true });
    if (e.pointerType === 'pen') setPenActive(true);
    const { sx, sy } = screenPoint(e);
    const { x, y } = toWorld(sx, sy);
    const base: DragState = { mode: 'pan', pointerId: e.pointerId, sx, sy, wx: x, wy: y, view: viewRef.current };

    if (textEditRef.current) {
      commitText();
      return;
    }

    // pan: botão do meio, espaço, ferramenta mão, ou quem não pode desenhar
    if (e.button === 1 || effectiveTool === 'hand' || (!canDraw && e.button === 0 && effectiveTool !== 'eyedropper')) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      dragRef.current = base;
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;

    if (effectiveTool === 'eyedropper' || (e.altKey && (isBrush(effectiveTool) || isShape(effectiveTool) || effectiveTool === 'fill'))) {
      sampleColor(sx, sy);
      return;
    }

    if (effectiveTool === 'select') {
      const st = wbRef.current;
      const cur = selectedId ? st.elements.find((el) => el.id === selectedId) : null;
      const hd = cur ? hitHandle(cur, sx, sy) : null;
      if (cur && hd) {
        canvas.setPointerCapture(e.pointerId);
        dragRef.current = { ...base, mode: hd === 'rot' ? 'rotate' : 'resize', start: cur, handle: hd };
        return;
      }
      const hit = pickElement(x, y);
      if (hit) {
        setSelectedId(hit.id);
        selectedIdRef.current = hit.id;
        canvas.setPointerCapture(e.pointerId);
        dragRef.current = { ...base, mode: 'move', start: hit };
      } else {
        setSelectedId(null);
        canvas.setPointerCapture(e.pointerId);
        dragRef.current = base;
        setPanning(true);
      }
      return;
    }

    if (!activeLayer || !activeLayer.visible) return flash('A camada ativa está oculta.');
    if (activeLayer.locked) return flash('A camada ativa está bloqueada.');

    if (effectiveTool === 'fill') {
      floodFillAt(sx, sy);
      return;
    }

    if (effectiveTool === 'text') {
      const hit = pickElement(x, y);
      if (hit && hit.kind === 'text') openTextEditor(hit);
      else setTextEdit({ x, y, value: '', fontSize, color });
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    const pressure = e.pointerType === 'pen' ? clamp(e.pressure || 0.5, 0.05, 1) : 1;
    const p = pressureSize ? pressure : 1;
    const effOpacity = pressureOpacity && e.pointerType === 'pen' ? Math.max(0.1, opacity * pressure) : opacity;
    const common = {
      id: newId(),
      layerId: activeLayer.id,
      color,
      size,
      authorId: user.id,
      authorName: user.displayName,
      createdAt: Date.now(),
    };
    if (isBrush(effectiveTool)) {
      draftRef.current = {
        ...common,
        kind: 'stroke',
        brush: effectiveTool,
        opacity: effOpacity,
        hardness,
        points: [{ x: r1(x), y: r1(y), p: Math.round(p * 100) / 100 }],
        seed: Math.floor(Math.random() * 999999),
      };
      dragRef.current = { ...base, mode: 'draw' };
    } else if (isShape(effectiveTool)) {
      draftRef.current = {
        ...common,
        kind: effectiveTool,
        opacity,
        filled: (effectiveTool === 'rect' || effectiveTool === 'ellipse') && shapeFilled,
        x: r1(x),
        y: r1(y),
        x2: r1(x),
        y2: r1(y),
        w: 0,
        h: 0,
      };
      dragRef.current = { ...base, mode: 'shape' };
    }
    draftSentRef.current = 0;
    lastDraftEmitRef.current = 0;
    flushDraft(true);
    requestRender();
    emitCursor(x, y, true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = screenPoint(e);
    const { x, y } = toWorld(sx, sy);
    updateBrushCursor(sx, sy, true);
    const drag = dragRef.current;
    emitCursor(x, y, Boolean(drag && (drag.mode === 'draw' || drag.mode === 'shape')));

    if (!drag) {
      // cursor das alças de redimensionar
      const vp = viewportRef.current;
      if (vp && effectiveTool === 'select' && selectedEl?.kind === 'image') {
        const hd = hitHandle(selectedEl, sx, sy);
        vp.style.cursor = hd === 'rot' ? 'grab' : hd ? (hd.hx * hd.hy > 0 ? 'nwse-resize' : hd.hx * hd.hy < 0 ? 'nesw-resize' : hd.hx ? 'ew-resize' : 'ns-resize') : '';
      } else if (vp) vp.style.cursor = '';
      return;
    }
    if (drag.pointerId !== e.pointerId) return;

    if (drag.mode === 'pan') {
      setView({ x: drag.view.x + (sx - drag.sx), y: drag.view.y + (sy - drag.sy), z: drag.view.z });
      return;
    }

    if (drag.mode === 'draw' && draftRef.current) {
      const d = draftRef.current;
      const minDist = 0.6 / viewRef.current.z;
      const coalesced = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() || [e.nativeEvent as PointerEvent];
      const pts = (d.points || []).slice();
      for (const ce of coalesced.length ? coalesced : [e.nativeEvent as PointerEvent]) {
        const sp = screenPoint(ce);
        const wp = toWorld(sp.sx, sp.sy);
        const last = pts[pts.length - 1];
        if (last && Math.hypot(wp.x - last.x, wp.y - last.y) < minDist) continue;
        const pr = ce.pointerType === 'pen' ? clamp(ce.pressure || 0.5, 0.05, 1) : 1;
        pts.push({ x: r1(wp.x), y: r1(wp.y), p: Math.round((pressureSize ? pr : 1) * 100) / 100 });
      }
      if (e.shiftKey && pts.length > 1) {
        // Shift: linha reta a partir do primeiro ponto
        pts.splice(1, pts.length - 2);
      }
      draftRef.current = { ...d, points: pts };
      if (e.shiftKey) draftSentRef.current = 0;
      flushDraft();
      requestRender();
      return;
    }

    if (drag.mode === 'shape' && draftRef.current) {
      const d = draftRef.current;
      let nx = x;
      let ny = y;
      const ox = d.x || 0;
      const oy = d.y || 0;
      if (e.shiftKey) {
        if (d.kind === 'line' || d.kind === 'arrow') {
          const ang = Math.round(Math.atan2(y - oy, x - ox) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(x - ox, y - oy);
          nx = ox + Math.cos(ang) * len;
          ny = oy + Math.sin(ang) * len;
        } else {
          const m = Math.max(Math.abs(x - ox), Math.abs(y - oy));
          nx = ox + Math.sign(x - ox || 1) * m;
          ny = oy + Math.sign(y - oy || 1) * m;
        }
      }
      draftRef.current = { ...d, x2: r1(nx), y2: r1(ny), w: r1(nx - ox), h: r1(ny - oy) };
      flushDraft();
      requestRender();
      return;
    }

    const start = drag.start;
    if (!start) return;
    let patch: Partial<WhiteboardElement> | null = null;
    if (drag.mode === 'move') {
      const dx = x - drag.wx;
      const dy = y - drag.wy;
      if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 3) return;
      drag.moved = true;
      patch =
        start.kind === 'image'
          ? { x: r1((start.x || 0) + dx), y: r1((start.y || 0) + dy) }
          : { tx: r1((start.tx || 0) + dx), ty: r1((start.ty || 0) + dy) };
    } else if (drag.mode === 'resize' && drag.handle && drag.handle !== 'rot') {
      const { hx, hy } = drag.handle;
      const w0 = start.w || 1;
      const h0 = start.h || 1;
      const l = worldToImageLocal(start, x, y);
      const fromCenter = e.altKey;
      const ax = fromCenter ? 0 : -hx * (w0 / 2);
      const ay = fromCenter ? 0 : -hy * (h0 / 2);
      let nw = hx ? Math.max(4, (l.x - ax) * hx * (fromCenter ? 2 : 1)) : w0;
      let nh = hy ? Math.max(4, (l.y - ay) * hy * (fromCenter ? 2 : 1)) : h0;
      if (hx && hy && !e.shiftKey) {
        // cantos mantêm a proporção (Shift libera), como no Photoshop atual
        const s = Math.max(nw / w0, nh / h0);
        nw = w0 * s;
        nh = h0 * s;
      }
      const ncx = fromCenter || !hx ? 0 : ax + (hx * nw) / 2;
      const ncy = fromCenter || !hy ? 0 : ay + (hy * nh) / 2;
      const c = imageLocalToWorld(start, ncx, ncy);
      patch = { x: r1(c.x - nw / 2), y: r1(c.y - nh / 2), w: r1(nw), h: r1(nh) };
    } else if (drag.mode === 'rotate') {
      const cx = (start.x || 0) + (start.w || 0) / 2;
      const cy = (start.y || 0) + (start.h || 0) / 2;
      let ang = Math.atan2(y - cy, x - cx) + Math.PI / 2;
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      patch = { rot: Math.round(ang * 1000) / 1000 };
    }
    if (!patch) return;
    livePatchRef.current = { ...start, ...patch };
    const now = performance.now();
    if (socket && now - lastPatchEmitRef.current > 40) {
      lastPatchEmitRef.current = now;
      socket.emit('wb:patch-element', { channelId, id: start.id, patch });
    }
    requestRender();
  };

  const finishDrag = (e: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
    setPanning(false);

    if (drag.mode === 'draw' || drag.mode === 'shape') {
      const d = draftRef.current;
      draftRef.current = null;
      if (!d || cancelled) {
        if (d) socket?.emit('wb:draft', { channelId, cancel: true, id: d.id });
        requestRender();
        return;
      }
      if (d.kind !== 'stroke' && Math.hypot(d.w || (d.x2 || 0) - (d.x || 0), d.h || (d.y2 || 0) - (d.y || 0)) < 1) {
        socket?.emit('wb:draft', { channelId, cancel: true, id: d.id });
        requestRender();
        return;
      }
      commitElement(d);
      pushRecent(d.color);
      return;
    }

    if (drag.mode === 'move' || drag.mode === 'resize' || drag.mode === 'rotate') {
      const live = livePatchRef.current;
      livePatchRef.current = null;
      if (live && drag.start) {
        const s = drag.start;
        const patch: Partial<WhiteboardElement> = {};
        for (const k of ['x', 'y', 'w', 'h', 'tx', 'ty', 'rot'] as const) {
          if (live[k] !== s[k]) (patch as Record<string, unknown>)[k] = live[k];
        }
        if (Object.keys(patch).length) patchElement(s.id, patch);
      }
      requestRender();
    }
  };

  // roda do mouse: rolar / Ctrl+roda = zoom no cursor (pinça do touchpad também)
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        zoomAt(Math.exp(-e.deltaY * unit * 0.0022), sx, sy);
      } else {
        const v = viewRef.current;
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView({ x: v.x - dx * unit, y: v.y - dy * unit, z: v.z });
      }
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomAt, setView]);

  /* ---------------------------------------------------------------- text */

  function openTextEditor(el: WhiteboardElement) {
    hiddenIdRef.current = el.id;
    setTextEdit({
      id: el.id,
      x: (el.x || 0) + (el.tx || 0),
      y: (el.y || 0) + (el.ty || 0),
      value: el.text || '',
      fontSize: el.fontSize || 28,
      color: el.color,
    });
    requestRender();
  }

  function commitText() {
    const t = textEditRef.current;
    textEditRef.current = null; // evita commit duplo (pointerdown + blur)
    setTextEdit(null);
    hiddenIdRef.current = null;
    if (!t) return;
    const value = t.value.replace(/\s+$/, '');
    if (t.id) {
      if (!value.trim()) deleteElement(t.id);
      else {
        const el = wbRef.current.elements.find((e) => e.id === t.id);
        if (el && (el.text !== value || el.color !== t.color || el.fontSize !== t.fontSize)) {
          patchElement(t.id, { text: value, color: t.color, fontSize: t.fontSize });
        }
      }
      requestRender();
      return;
    }
    if (!value.trim()) return;
    commitElement({
      id: newId(),
      kind: 'text',
      layerId: activeLayerId,
      color: t.color,
      size,
      opacity,
      x: r1(t.x),
      y: r1(t.y),
      text: value,
      fontSize: t.fontSize,
      authorId: user.id,
      authorName: user.displayName,
      createdAt: Date.now(),
    });
    pushRecent(t.color);
  }

  /* ---------------------------------------------------------------- keyboard */

  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    const root = rootRef.current;
    if (!root || !root.isConnected) return;
    // só reage quando o foco está no quadro (ou em lugar nenhum), sem roubar teclas do resto do app
    const ae = document.activeElement;
    if (ae && ae !== document.body && !root.contains(ae)) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === ' ') {
      e.preventDefault();
      if (!spaceRef.current) {
        spaceRef.current = true;
        setSpaceHeld(true);
      }
      return;
    }
    if (mod && k === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (mod && (k === '0' || k === '1' || k === '=' || k === '+' || k === '-')) {
      e.preventDefault();
      if (k === '0') fitTo(contentBounds());
      else if (k === '1') zoomAt(1 / viewRef.current.z);
      else zoomAt(k === '-' ? 1 / 1.25 : 1.25);
      return;
    }
    if (mod) return;
    if (e.key === 'Escape') {
      if (draftRef.current) cancelDraft();
      setSelectedId(null);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && canDraw) {
      e.preventDefault();
      deleteElement(selectedId);
      return;
    }
    if (selectedEl && canDraw && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) / Math.max(0.25, viewRef.current.z);
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (selectedEl.kind === 'image') patchElement(selectedEl.id, { x: r1((selectedEl.x || 0) + dx), y: r1((selectedEl.y || 0) + dy) });
      else patchElement(selectedEl.id, { tx: r1((selectedEl.tx || 0) + dx), ty: r1((selectedEl.ty || 0) + dy) });
      return;
    }
    if (e.key === '[' || e.key === ']') {
      setSize((s) => clamp(Math.round(e.key === ']' ? s * 1.2 + 1 : s / 1.2 - 1), 1, 300));
      return;
    }
    if (k === 'x') {
      setColor(color2);
      setColor2(color);
      return;
    }
    if (k === 'd') {
      setColor('#ffffff');
      setColor2('#000000');
      return;
    }
    const t = KEY_TO_TOOL[k];
    if (t && (canDraw || t === 'hand' || t === 'eyedropper')) {
      setTool(t);
      if (t !== 'select') setSelectedId(null);
    }
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyHandlerRef.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ' && spaceRef.current) {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };
    const blur = () => {
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  /* ---------------------------------------------------------------- layers DnD */

  // lista exibida de cima (última camada) para baixo, igual ao Photoshop
  const displayLayers = useMemo(() => [...wb.layers].reverse(), [wb.layers]);

  const dropLayer = (targetDisplayIdx: number) => {
    if (!layerDrag) return;
    const from = displayLayers.findIndex((l) => l.id === layerDrag.id);
    setLayerDrag(null);
    if (from === -1) return;
    const list = displayLayers.slice();
    const [moved] = list.splice(from, 1);
    const to = targetDisplayIdx > from ? targetDisplayIdx - 1 : targetDisplayIdx;
    list.splice(clamp(to, 0, list.length), 0, moved);
    const next = list.reverse();
    if (next.every((l, i) => l.id === wb.layers[i].id)) return;
    updateLayers(next);
  };

  /* ---------------------------------------------------------------- UI */

  const cursorStyle = panning
    ? 'grabbing'
    : effectiveTool === 'hand' || !canDraw
    ? 'grab'
    : effectiveTool === 'select'
    ? 'default'
    : effectiveTool === 'text'
    ? 'text'
    : isBrush(effectiveTool) && size * view.z >= 4
    ? 'none'
    : 'crosshair';

  const zoomPct = Math.round(view.z * 100);
  const toolIsBrush = isBrush(tool);
  const toolIsShape = isShape(tool);

  const iconBtn =
    'h-8 min-w-8 px-1.5 rounded flex items-center justify-center gap-1.5 text-[#b5bac1] hover:text-[#dbdee1] hover:bg-[#35373c] disabled:opacity-40 disabled:pointer-events-none cursor-pointer';

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#1e1f22] rounded-lg overflow-hidden select-none outline-none"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.items || []).some((i) => i.kind === 'file')) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return;
        e.preventDefault();
        const vp = viewportRef.current;
        let at: { x: number; y: number } | undefined;
        if (vp) {
          const r = vp.getBoundingClientRect();
          at = toWorld(e.clientX - r.left, e.clientY - r.top);
        }
        files.slice(0, 6).forEach((f, i) => insertImageBlob(f, at ? { x: at.x + i * 24, y: at.y + i * 24 } : undefined));
      }}
    >
      {/* Barra de opções (muda conforme a ferramenta) */}
      <div className="h-11 shrink-0 px-2 flex items-center gap-1 bg-[#2b2d31] border-b border-black/25 text-xs text-[#dbdee1] overflow-x-auto overflow-y-hidden">
        <span className="px-2 font-semibold text-[#f2f3f5] whitespace-nowrap">{TOOL_LABEL[tool] || 'Whiteboard'}</span>
        <div className="w-px h-5 bg-[#3f4147] mx-1 shrink-0" />

        {(toolIsBrush || toolIsShape || tool === 'text') && (
          <label className="flex items-center gap-2 px-2 whitespace-nowrap" title="Tamanho ( [ e ] )">
            <span className="text-[#b5bac1]">Tamanho</span>
            <input
              type="range"
              min={1}
              max={tool === 'text' ? 200 : 300}
              value={tool === 'text' ? fontSize : size}
              onChange={(e) => (tool === 'text' ? setFontSize(Number(e.target.value)) : setSize(Number(e.target.value)))}
              className="w-24 accent-[#5865f2]"
            />
            <span className="w-10 tabular-nums text-[#949ba4]">{tool === 'text' ? fontSize : size}px</span>
          </label>
        )}
        {(toolIsBrush || toolIsShape || tool === 'fill') && (
          <label className="flex items-center gap-2 px-2 whitespace-nowrap">
            <span className="text-[#b5bac1]">Opacidade</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-20 accent-[#5865f2]"
            />
            <span className="w-9 tabular-nums text-[#949ba4]">{Math.round(opacity * 100)}%</span>
          </label>
        )}
        {tool === 'airbrush' && (
          <label className="flex items-center gap-2 px-2 whitespace-nowrap">
            <span className="text-[#b5bac1]">Dureza</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={hardness}
              onChange={(e) => setHardness(Number(e.target.value))}
              className="w-16 accent-[#5865f2]"
            />
            <span className="w-9 tabular-nums text-[#949ba4]">{Math.round(hardness * 100)}%</span>
          </label>
        )}
        {toolIsBrush && (
          <>
            <label className="flex items-center gap-1.5 px-2 whitespace-nowrap cursor-pointer text-[#b5bac1]" title="Pressão da caneta controla o tamanho">
              <input type="checkbox" checked={pressureSize} onChange={(e) => setPressureSize(e.target.checked)} className="accent-[#5865f2]" />
              Pressão: tamanho
            </label>
            <label className="flex items-center gap-1.5 px-2 whitespace-nowrap cursor-pointer text-[#b5bac1]" title="Pressão da caneta controla a opacidade">
              <input type="checkbox" checked={pressureOpacity} onChange={(e) => setPressureOpacity(e.target.checked)} className="accent-[#5865f2]" />
              Pressão: opacidade
            </label>
          </>
        )}
        {(tool === 'rect' || tool === 'ellipse') && (
          <label className="flex items-center gap-1.5 px-2 whitespace-nowrap cursor-pointer text-[#b5bac1]">
            <input type="checkbox" checked={shapeFilled} onChange={(e) => setShapeFilled(e.target.checked)} className="accent-[#5865f2]" />
            Preenchido
          </label>
        )}
        {tool === 'fill' && (
          <label className="flex items-center gap-2 px-2 whitespace-nowrap">
            <span className="text-[#b5bac1]">Tolerância</span>
            <input
              type="range"
              min={0}
              max={160}
              value={fillTolerance}
              onChange={(e) => setFillTolerance(Number(e.target.value))}
              className="w-20 accent-[#5865f2]"
            />
            <span className="w-7 tabular-nums text-[#949ba4]">{fillTolerance}</span>
          </label>
        )}
        {tool === 'select' && selectedEl && canDraw && (
          <div className="flex items-center gap-0.5">
            <button type="button" className={iconBtn} onClick={() => reorderElement(selectedEl.id, true)} title="Trazer para a frente">
              <ChevronsUp className="w-4 h-4" />
            </button>
            <button type="button" className={iconBtn} onClick={() => reorderElement(selectedEl.id, false)} title="Enviar para trás">
              <ChevronsDown className="w-4 h-4" />
            </button>
            <select
              value={selectedEl.layerId}
              onChange={(e) => patchElement(selectedEl.id, { layerId: e.target.value })}
              className="h-7 ml-1 bg-[#1e1f22] text-[#dbdee1] rounded px-1.5 outline-none cursor-pointer"
              title="Mover para a camada"
            >
              {displayLayers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {selectedEl.kind === 'image' && (
              <button
                type="button"
                className={iconBtn}
                onClick={() => patchElement(selectedEl.id, { rot: 0 })}
                title="Zerar rotação"
                disabled={!selectedEl.rot}
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            <button type="button" className={`${iconBtn} hover:!text-[#f23f42]`} onClick={() => deleteElement(selectedEl.id)} title="Excluir (Delete)">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
        {tool === 'select' && !selectedEl && (
          <span className="px-2 text-[#949ba4] whitespace-nowrap">Clique num item para mover. Imagens: puxe as alças para redimensionar e a bolinha de cima para girar.</span>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" className={iconBtn} onClick={() => zoomAt(1 / 1.25)} title="Diminuir zoom (Ctrl -)">
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="h-8 w-14 rounded text-[#dbdee1] hover:bg-[#35373c] tabular-nums cursor-pointer"
            onClick={() => zoomAt(1 / viewRef.current.z)}
            title="Zoom 100% (Ctrl 1)"
          >
            {zoomPct}%
          </button>
          <button type="button" className={iconBtn} onClick={() => zoomAt(1.25)} title="Aumentar zoom (Ctrl +)">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button type="button" className={iconBtn} onClick={() => fitTo(contentBounds())} title="Enquadrar tudo (Ctrl 0)">
            <Scan className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-[#3f4147] mx-1" />
          <button type="button" className={iconBtn} disabled={!canDraw} onClick={undo} title="Desfazer (Ctrl Z)">
            <RotateCcw className="w-4 h-4" />
          </button>
          <label className={`${iconBtn} ${!canDraw ? 'opacity-40 pointer-events-none' : ''}`} title="Inserir imagem (ou Ctrl V / arraste o arquivo)">
            <ImagePlus className="w-4 h-4" />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                Array.from(e.target.files || [])
                  .slice(0, 6)
                  .forEach((f) => insertImageBlob(f));
                e.target.value = '';
              }}
            />
          </label>
          <button type="button" className={iconBtn} onClick={exportPng} title="Exportar PNG">
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            className={`${iconBtn} ${showPanel ? '!text-white bg-[#404249]' : ''}`}
            onClick={() => setShowPanel((v) => !v)}
            title="Cores e camadas"
          >
            <Layers className="w-4 h-4" />
          </button>
          <button type="button" className={iconBtn} onClick={toggleFullscreen} title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
          <button type="button" className={iconBtn} onClick={onClose} title="Fechar (o desenho continua salvo na call)">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Ferramentas */}
        <div className="w-12 shrink-0 bg-[#2b2d31] border-r border-black/25 py-1.5 flex flex-col items-center gap-0.5 overflow-y-auto">
          {TOOL_GROUPS.map((group, gi) => (
            <React.Fragment key={gi}>
              {gi > 0 && <div className="w-6 h-px bg-[#3f4147] my-1 shrink-0" />}
              {group.map((item) => {
                const enabled = canDraw || item.id === 'hand' || item.id === 'eyedropper';
                const active = effectiveTool === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!enabled}
                    onClick={() => {
                      setTool(item.id);
                      if (item.id !== 'select') setSelectedId(null);
                    }}
                    title={item.key ? `${item.label} (${item.key})` : item.label}
                    className={`w-9 h-9 shrink-0 rounded flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:pointer-events-none ${
                      active ? 'bg-[#5865f2] text-white' : 'text-[#b5bac1] hover:bg-[#35373c] hover:text-[#dbdee1]'
                    }`}
                  >
                    {item.icon}
                  </button>
                );
              })}
            </React.Fragment>
          ))}

          <div className="flex-1" />
          {/* cor principal / secundária */}
          <div className="relative w-10 h-10 shrink-0 mt-2" title="Cor principal / secundária (X troca, D padrão)">
            <label
              className="absolute right-0 bottom-0 w-6 h-6 rounded border-2 border-[#1e1f22] cursor-pointer shadow"
              style={{ backgroundColor: color2 }}
            >
              <input type="color" value={color2} onChange={(e) => setColor2(e.target.value)} className="sr-only" />
            </label>
            <label
              className="absolute left-0 top-0 w-6 h-6 rounded border-2 border-[#1e1f22] cursor-pointer shadow"
              style={{ backgroundColor: color }}
            >
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="sr-only" />
            </label>
          </div>
          <button
            type="button"
            onClick={() => {
              setColor(color2);
              setColor2(color);
            }}
            className="mt-1 mb-1 p-1 rounded text-[#949ba4] hover:text-white cursor-pointer"
            title="Trocar cores (X)"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Área de desenho infinita */}
        <div ref={viewportRef} className="flex-1 relative overflow-hidden min-w-0" style={{ cursor: cursorStyle }}>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(e) => finishDrag(e)}
            onPointerCancel={(e) => finishDrag(e, true)}
            onPointerLeave={() => updateBrushCursor(0, 0, false)}
            onContextMenu={(e) => e.preventDefault()}
            onDoubleClick={(e) => {
              if (effectiveTool !== 'select' || !canDraw) return;
              const { sx, sy } = screenPoint(e);
              const { x, y } = toWorld(sx, sy);
              const hit = pickElement(x, y);
              if (hit?.kind === 'text') openTextEditor(hit);
            }}
          />

          <div
            ref={brushCursorRef}
            className="pointer-events-none absolute left-0 top-0 border border-white mix-blend-difference"
            style={{ display: 'none' }}
          />

          {Object.values(remoteCursors).map((cur) => {
            const left = cur.x * view.z + view.x;
            const top = cur.y * view.z + view.y;
            if (left < -40 || top < -40 || left > sizeRef.current.w + 40 || top > sizeRef.current.h + 40) return null;
            return (
              <div
                key={cur.socketId}
                className="pointer-events-none absolute left-0 top-0 flex items-start gap-1 z-20"
                style={{ transform: `translate(${left - 2}px, ${top - 2}px)`, transition: 'transform 60ms linear' }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill={cur.color}>
                  <path d="M1 1 L13 7 L8 8.5 L6.5 14 Z" stroke="#000" strokeWidth="1.2" />
                </svg>
                <span className="mt-3 px-1.5 py-0.5 rounded text-[11px] font-semibold text-white whitespace-nowrap" style={{ backgroundColor: cur.color }}>
                  {cur.displayName}
                </span>
              </div>
            );
          })}

          {textEdit && (
            <textarea
              autoFocus
              value={textEdit.value}
              onChange={(e) => setTextEdit((t) => (t ? { ...t, value: e.target.value } : t))}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitText();
                } else if (e.key === 'Escape') {
                  setTextEdit(null);
                  hiddenIdRef.current = null;
                  requestRender();
                }
              }}
              onBlur={commitText}
              placeholder="Digite… (Shift+Enter quebra linha)"
              rows={Math.max(1, textEdit.value.split('\n').length)}
              className="absolute z-30 bg-transparent outline-dashed outline-1 outline-[#5865f2] resize-none overflow-hidden p-0 m-0 leading-[1.25] placeholder:text-[#949ba4]/60"
              style={{
                left: textEdit.x * view.z + view.x,
                top: textEdit.y * view.z + view.y,
                font: WB_FONT(textEdit.fontSize * view.z),
                color: textEdit.color,
                minWidth: 160,
                width: `${Math.max(160, (Math.max(...textEdit.value.split('\n').map((l) => l.length), 12) + 2) * textEdit.fontSize * view.z * 0.56)}px`,
              }}
            />
          )}

          {notice && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded bg-[#111214] text-xs text-[#dbdee1] shadow-lg pointer-events-none">
              {notice}
            </div>
          )}
          {!canDraw && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded bg-[#111214]/90 text-xs text-[#b5bac1] pointer-events-none">
              Você não tem permissão para desenhar aqui — só visualizar.
            </div>
          )}
        </div>

        {/* Painel lateral: cores + camadas */}
        {showPanel && (
          <aside className="w-60 shrink-0 bg-[#2b2d31] border-l border-black/25 flex flex-col min-h-0 text-xs">
            <section className="p-3 space-y-2 border-b border-black/25">
              <div className="text-[11px] font-bold uppercase text-[#b5bac1]">Cor</div>
              <div className="flex items-center gap-2">
                <label className="w-9 h-9 rounded cursor-pointer shrink-0 border border-black/40" style={{ backgroundColor: color }}>
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="sr-only" />
                </label>
                <input
                  value={color}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (/^#?[0-9a-f]{0,6}$/i.test(v)) setColor(v.startsWith('#') ? v : `#${v}`);
                  }}
                  spellCheck={false}
                  className="flex-1 min-w-0 h-8 px-2 rounded bg-[#1e1f22] text-[#dbdee1] font-mono uppercase outline-none"
                />
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-6 rounded cursor-pointer border ${color.toLowerCase() === c ? 'border-white' : 'border-black/40'}`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              {recentColors.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {recentColors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className="w-4 h-4 rounded-sm cursor-pointer border border-black/40"
                      style={{ backgroundColor: c }}
                      title={`Recente: ${c}`}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="flex-1 min-h-0 flex flex-col">
              <div className="px-3 pt-3 pb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase text-[#b5bac1]">Camadas</span>
                <span className="text-[#949ba4]">{wb.layers.length}</span>
              </div>
              {activeLayer && (
                <div className="px-3 pb-2 flex items-center gap-2">
                  <select
                    value={activeLayer.blend || 'source-over'}
                    disabled={!canDraw}
                    onChange={(e) => updateLayers(wb.layers.map((l) => (l.id === activeLayer.id ? { ...l, blend: e.target.value } : l)))}
                    className="flex-1 min-w-0 h-7 bg-[#1e1f22] text-[#dbdee1] rounded px-1.5 outline-none cursor-pointer"
                    title="Modo de mesclagem da camada"
                  >
                    {BLEND_MODES.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-[#949ba4]" title="Opacidade da camada">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={!canDraw}
                      value={Math.round((activeLayer.opacity ?? 1) * 100)}
                      onChange={(e) =>
                        updateLayers(
                          wb.layers.map((l) =>
                            l.id === activeLayer.id ? { ...l, opacity: clamp(Number(e.target.value) / 100, 0, 1) } : l
                          )
                        )
                      }
                      className="w-12 h-7 bg-[#1e1f22] text-[#dbdee1] rounded px-1.5 outline-none tabular-nums"
                    />
                    %
                  </label>
                </div>
              )}

              <div
                className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5"
                onDragOver={(e) => {
                  if (layerDrag) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (!layerDrag) return;
                  e.preventDefault();
                  dropLayer(layerDrag.over ?? displayLayers.length);
                }}
              >
                {displayLayers.map((layer, idx) => {
                  const active = layer.id === activeLayer?.id;
                  const dropBefore = layerDrag && layerDrag.over === idx && layerDrag.id !== layer.id;
                  const dropAfter = layerDrag && layerDrag.over === displayLayers.length && idx === displayLayers.length - 1;
                  return (
                    <div
                      key={layer.id}
                      draggable={canDraw && editingLayerName !== layer.id}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', layer.id);
                        setLayerDrag({ id: layer.id, over: null });
                      }}
                      onDragEnd={() => setLayerDrag(null)}
                      onDragOver={(e) => {
                        if (!layerDrag) return;
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        const over = e.clientY < r.top + r.height / 2 ? idx : idx + 1;
                        if (over !== layerDrag.over) setLayerDrag({ ...layerDrag, over });
                      }}
                      onClick={() => setActiveLayerId(layer.id)}
                      className={`relative flex items-center gap-2 pl-1 pr-1.5 py-1 rounded cursor-pointer ${
                        active ? 'bg-[#404249]' : 'hover:bg-[#35373c]'
                      } ${layerDrag?.id === layer.id ? 'opacity-40' : ''}`}
                    >
                      {dropBefore && <div className="absolute -top-px left-1 right-1 h-0.5 bg-[#5865f2] rounded" />}
                      {dropAfter && <div className="absolute -bottom-px left-1 right-1 h-0.5 bg-[#5865f2] rounded" />}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (canDraw) updateLayers(wb.layers.map((l) => (l.id === layer.id ? { ...l, visible: !l.visible } : l)));
                        }}
                        className="p-1 text-[#b5bac1] hover:text-white cursor-pointer"
                        title={layer.visible ? 'Ocultar' : 'Mostrar'}
                      >
                        {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-[#6d6f78]" />}
                      </button>
                      <canvas
                        ref={(c) => {
                          if (c) thumbsRef.current.set(layer.id, c);
                          else thumbsRef.current.delete(layer.id);
                        }}
                        width={64}
                        height={36}
                        className="w-12 h-[27px] rounded-sm shrink-0 border border-black/40"
                        style={{
                          backgroundColor: wb.background === 'light' ? '#fff' : '#1e1f22',
                        }}
                      />
                      {editingLayerName === layer.id ? (
                        <input
                          autoFocus
                          defaultValue={layer.name}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') setEditingLayerName(null);
                          }}
                          onBlur={(e) => {
                            const name = e.target.value.trim().slice(0, 40);
                            setEditingLayerName(null);
                            if (name && name !== layer.name) updateLayers(wb.layers.map((l) => (l.id === layer.id ? { ...l, name } : l)));
                          }}
                          className="flex-1 min-w-0 h-6 px-1 rounded bg-[#1e1f22] text-white outline-none"
                        />
                      ) : (
                        <span
                          className={`flex-1 min-w-0 truncate ${active ? 'text-white' : 'text-[#b5bac1]'}`}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (canDraw) setEditingLayerName(layer.id);
                          }}
                          title="Clique duplo para renomear · arraste para reordenar"
                        >
                          {layer.name}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (canDraw) updateLayers(wb.layers.map((l) => (l.id === layer.id ? { ...l, locked: !l.locked } : l)));
                        }}
                        className={`p-1 cursor-pointer ${layer.locked ? 'text-[#f0b232]' : 'text-[#6d6f78] hover:text-[#b5bac1]'}`}
                        title={layer.locked ? 'Desbloquear' : 'Bloquear'}
                      >
                        {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}

                {/* fundo (como a camada "Fundo" do Photoshop) */}
                <div className="flex items-center gap-2 pl-1 pr-1.5 py-1 mt-1 rounded text-[#949ba4]">
                  <span className="w-[22px]" />
                  <span className="flex-1">Fundo</span>
                  <select
                    value={wb.background}
                    disabled={!canDraw}
                    onChange={(e) => {
                      const bg = e.target.value as WhiteboardState['background'];
                      setWb((p) => ({ ...p, background: bg }));
                      socket?.emit('wb:background', { channelId, background: bg });
                    }}
                    className="h-6 bg-[#1e1f22] text-[#dbdee1] rounded px-1 outline-none cursor-pointer"
                  >
                    <option value="dark">Escuro</option>
                    <option value="light">Branco</option>
                    <option value="grid">Grade</option>
                    <option value="transparent">Transparente</option>
                  </select>
                </div>
              </div>

              <div className="h-10 shrink-0 px-2 flex items-center justify-end gap-0.5 border-t border-black/25">
                <button
                  type="button"
                  className={iconBtn}
                  disabled={!canDraw || !activeLayer}
                  onClick={() => activeLayer && clearLayer(activeLayer.id)}
                  title="Limpar a camada ativa"
                >
                  <Eraser className="w-4 h-4" />
                </button>
                <button type="button" className={iconBtn} disabled={!canDraw} onClick={addLayer} title="Nova camada">
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  className={`${iconBtn} hover:!text-[#f23f42]`}
                  disabled={!canDraw || wb.layers.length <= 1 || !activeLayer}
                  onClick={() => activeLayer && deleteLayer(activeLayer.id)}
                  title="Excluir camada"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </section>
          </aside>
        )}
      </div>

      {/* Barra de status */}
      <div className="h-6 shrink-0 px-3 flex items-center gap-3 bg-[#232428] text-[11px] text-[#949ba4]">
        <span className="tabular-nums">{zoomPct}%</span>
        <span className="truncate">
          Espaço/botão do meio: mover a tela · Ctrl+roda: zoom · Alt+clique: pegar cor · Shift: linha reta / proporção
        </span>
        <div className="flex-1" />
        {penActive && <span className="text-[#23a55a]">Caneta detectada</span>}
        <span>{activeLayer ? `Camada: ${activeLayer.name}` : ''}</span>
      </div>
    </div>
  );
};
