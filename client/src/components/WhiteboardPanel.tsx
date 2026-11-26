import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowUpRight,
  Blend,
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Circle,
  Clapperboard,
  Copy,
  Download,
  Droplets,
  Eraser,
  Eye,
  EyeOff,
  FileImage,
  Feather,
  FlipHorizontal2,
  Frame,
  Grid3x3,
  Hand,
  Highlighter,
  ImagePlus,
  Keyboard,
  Layers,
  LayoutGrid,
  Link,
  Lock,
  Map as MapIcon,
  LockOpen,
  Maximize,
  Merge,
  Minimize,
  Minus,
  MousePointer2,
  Move,
  PaintBucket,
  Palette,
  PanelRight,
  Pause,
  Pencil,
  PencilLine,
  PenTool,
  Pipette,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Scan,
  Search,
  Shapes,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Spline,
  SprayCan,
  Square,
  Trash2,
  Type,
  Wind,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Socket } from 'socket.io-client';
import type {
  User,
  WhiteboardBrush,
  WhiteboardBrushTip,
  WhiteboardCursor,
  WhiteboardElement,
  WhiteboardGradientType,
  WhiteboardLayer,
  WhiteboardLayerFx,
  WhiteboardPoint,
  WhiteboardState,
  WhiteboardTool,
} from '../types';
import {
  Bounds,
  DrawEnv,
  View,
  WB_FONT,
  GuideMode,
  clamp,
  drawBackground,
  drawElement,
  drawStrokeFrom,
  isIncrementalStroke,
  drawGuides,
  elementBounds,
  floodFillMask,
  hitTestElement,
  imageLocalToWorld,
  renderElements,
  rgbToHex,
  simplifyPoints,
  unionBounds,
  worldToImageLocal,
} from '../lib/whiteboardRender';
import {
  ChannelView,
  DEFAULT_FX,
  SymmetryMode,
  artboardAt,
  channelFilter,
  drawArtboard,
  hasFx,
  hitArtboardLabel,
  layerFilter,
  mirrorCopies,
  tipRegistry,
  translatePatch,
} from '../lib/artEngine';
import { PsdLayer, downloadBytes, encodeGif, writePsd } from '../lib/artExport';
import { importBrushFiles } from '../lib/brushImport';
import { BUILTIN_BRUSHES } from '../lib/builtinBrushes';
import { buildSvg } from '../lib/svgExport';

type Tool = WhiteboardTool | 'hand';
type HandleId = { hx: -1 | 0 | 1; hy: -1 | 0 | 1 } | 'rot';

const BRUSHES: WhiteboardBrush[] = [
  'pen', 'airbrush', 'marker', 'calligraphy', 'spray', 'pixel', 'eraser',
  'charcoal', 'watercolor', 'ink', 'splatter', 'crayon', 'neon', 'custom',
];
const SHAPES = ['line', 'arrow', 'rect', 'ellipse'] as const;
const isBrush = (t: Tool): t is WhiteboardBrush => (BRUSHES as string[]).includes(t);
const isShape = (t: Tool): t is (typeof SHAPES)[number] => (SHAPES as readonly string[]).includes(t);

const MIN_Z = 0.004;
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
  ['color-burn', 'Superexposição de cor'],
  ['hard-light', 'Luz direta'],
  ['soft-light', 'Luz suave'],
  ['difference', 'Diferença'],
  ['exclusion', 'Exclusão'],
  ['hue', 'Matiz'],
  ['saturation', 'Saturação'],
  ['color', 'Cor'],
  ['luminosity', 'Luminosidade'],
];
// modo do pincel (como ele se mistura com o que já está na camada)
const BRUSH_MODES: Array<[string, string]> = [...BLEND_MODES, ['destination-over', 'Por trás']];
const GRADIENT_TYPES: Array<[WhiteboardGradientType, string]> = [
  ['linear', 'Linear'],
  ['radial', 'Radial'],
  ['reflected', 'Refletido'],
  ['angle', 'Angular'],
];
const ARTBOARD_PRESETS: Array<[string, string]> = [
  ['', 'Livre (arraste)'],
  ['1920x1080', 'Full HD 1920×1080'],
  ['1080x1080', 'Post 1080×1080'],
  ['1080x1350', 'Retrato 1080×1350'],
  ['1080x1920', 'Story 1080×1920'],
  ['2480x3508', 'A4 (300 dpi)'],
  ['3840x2160', '4K 3840×2160'],
];
const FX_FIELDS: Array<[keyof WhiteboardLayerFx, string, number, number]> = [
  ['brightness', 'Brilho', 0, 200],
  ['contrast', 'Contraste', 0, 200],
  ['saturate', 'Saturação', 0, 300],
  ['hue', 'Matiz', -180, 180],
  ['blur', 'Desfoque', 0, 40],
  ['invert', 'Inverter', 0, 100],
  ['grayscale', 'Preto e branco', 0, 100],
  ['sepia', 'Sépia', 0, 100],
];
const CHANNELS: Array<[ChannelView, string]> = [
  ['rgb', 'RGB'],
  ['r', 'Vermelho'],
  ['g', 'Verde'],
  ['b', 'Azul'],
  ['luma', 'Luminosidade'],
  ['alpha', 'Transparência'],
];

const TOOL_GROUPS: Array<Array<{ id: Tool; label: string; key?: string; icon: React.ReactNode }>> = [
  [
    { id: 'select', label: 'Mover / redimensionar', key: 'V', icon: <MousePointer2 className="w-[18px] h-[18px]" /> },
    { id: 'movelayer', label: 'Mover camada inteira', key: 'M', icon: <Move className="w-[18px] h-[18px]" /> },
    { id: 'artboard', label: 'Prancheta (telas)', key: 'P', icon: <Frame className="w-[18px] h-[18px]" /> },
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
    { id: 'charcoal', label: 'Carvão', icon: <PencilLine className="w-[18px] h-[18px]" /> },
    { id: 'watercolor', label: 'Aquarela', icon: <Droplets className="w-[18px] h-[18px]" /> },
    { id: 'ink', label: 'Nanquim', icon: <PenTool className="w-[18px] h-[18px]" /> },
    { id: 'crayon', label: 'Giz de cera', icon: <Pencil className="w-[18px] h-[18px]" /> },
    { id: 'splatter', label: 'Respingos', icon: <Sparkles className="w-[18px] h-[18px]" /> },
    { id: 'neon', label: 'Neon', icon: <Zap className="w-[18px] h-[18px]" /> },
    { id: 'custom', label: 'Pincel importado (PNG, GBR, Krita .bundle)', key: 'K', icon: <Shapes className="w-[18px] h-[18px]" /> },
  ],
  [
    { id: 'line', label: 'Linha', key: 'L', icon: <Minus className="w-[18px] h-[18px]" /> },
    { id: 'arrow', label: 'Seta', key: 'A', icon: <ArrowUpRight className="w-[18px] h-[18px]" /> },
    { id: 'rect', label: 'Retângulo', key: 'U', icon: <Square className="w-[18px] h-[18px]" /> },
    { id: 'ellipse', label: 'Elipse', key: 'O', icon: <Circle className="w-[18px] h-[18px]" /> },
    { id: 'path', label: 'Caneta de curvas (vetor)', key: 'C', icon: <Spline className="w-[18px] h-[18px]" /> },
  ],
  [
    { id: 'text', label: 'Texto', key: 'T', icon: <Type className="w-[18px] h-[18px]" /> },
    { id: 'fill', label: 'Balde de tinta', key: 'G', icon: <PaintBucket className="w-[18px] h-[18px]" /> },
    { id: 'gradient', label: 'Degradê', key: 'J', icon: <Blend className="w-[18px] h-[18px]" /> },
    { id: 'eyedropper', label: 'Conta-gotas', key: 'I', icon: <Pipette className="w-[18px] h-[18px]" /> },
  ],
];
const TOOL_LABEL: Record<string, string> = Object.fromEntries(TOOL_GROUPS.flat().map((t) => [t.id, t.label]));
const KEY_TO_TOOL: Record<string, Tool> = Object.fromEntries(
  TOOL_GROUPS.flat()
    .filter((t) => t.key)
    .map((t) => [t.key!.toLowerCase(), t.id] as [string, Tool])
);

// barra de ferramentas no estilo do Photoshop: cada casa mostra a última ferramenta usada do grupo
const TOOL_SLOTS: Tool[][] = [
  ['select', 'movelayer'],
  ['artboard'],
  ['eyedropper'],
  ['pen', 'pixel', 'calligraphy', 'marker'],
  ['airbrush', 'spray'],
  ['charcoal', 'watercolor', 'ink', 'crayon', 'splatter', 'neon', 'custom'],
  ['eraser'],
  ['gradient', 'fill'],
  ['path'],
  ['text'],
  ['rect', 'ellipse', 'line', 'arrow'],
  ['hand'],
];
const TOOL_ITEM = Object.fromEntries(TOOL_GROUPS.flat().map((t) => [t.id, t])) as Record<string, (typeof TOOL_GROUPS)[number][number]>;
const KIND_LABEL: Record<string, string> = {
  stroke: 'Traço', path: 'Curva', line: 'Linha', arrow: 'Seta', rect: 'Retângulo', ellipse: 'Elipse',
  text: 'Texto', image: 'Imagem', gradient: 'Degradê', artboard: 'Prancheta',
};

type Hsv = { h: number; s: number; v: number };
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function hexToHsv(hex: string): Hsv | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((x) => x / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
function hsvToHex({ h, s, v }: Hsv) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}
const HUE_GRADIENT = 'linear-gradient(to bottom, #f00 0%, #ff0 16.7%, #0f0 33.3%, #0ff 50%, #00f 66.7%, #f0f 83.3%, #f00 100%)';
const PS_SWATCHES: string[] = (() => {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const v = Math.round((i / 11) * 255).toString(16).padStart(2, '0');
    out.push(`#${v}${v}${v}`);
  }
  for (const [sat, val] of [[1, 1], [0.6, 1], [0.3, 1], [1, 0.7], [1, 0.42]]) for (let i = 0; i < 12; i++) out.push(hsvToHex({ h: i * 30, s: sat, v: val }));
  return out;
})();
const GRADIENT_PRESETS: Array<{ name: string; a?: string; b?: string; toT?: boolean }> = [
  { name: 'Frente → Fundo' },
  { name: 'Frente → Transparente', toT: true },
  { name: 'Preto → Branco', a: '#000000', b: '#ffffff' },
  { name: 'Pôr do sol', a: '#ff5f6d', b: '#ffc371' },
  { name: 'Oceano', a: '#2193b0', b: '#6dd5ed' },
  { name: 'Violeta', a: '#7f00ff', b: '#e100ff' },
  { name: 'Floresta', a: '#134e5e', b: '#71b280' },
  { name: 'Fogo', a: '#f12711', b: '#f5af19' },
  { name: 'Noite', a: '#0f2027', b: '#2c5364' },
  { name: 'Pêssego', a: '#ed4264', b: '#ffedbc' },
];
const PS_VARS = {
  '--ps-bar': '#2b2b2b',
  '--ps-panel': '#323232',
  '--ps-menu': '#3a3a3a',
  '--ps-input': '#262626',
  '--ps-hover': '#404040',
  '--ps-active': '#4a4a4a',
  '--ps-sep': '#474747',
  '--ps-accent': '#2680eb',
  '--ps-pop': '#1f1f1f',
  '--ps-work': '#282828',
  '--ps-text': '#d6d6d6',
  '--ps-text2': '#b4b4b4',
  '--ps-mute': '#8e8e8e',
  '--ps-dim': '#6a6a6a',
  '--ps-strong': '#f0f0f0',
} as React.CSSProperties;
const LAYERS_W = 250;
const LAYERS_H = 330;

const MINI_W = 200;
const MINI_H = 128;
const readPref = (k: string, def: string) => {
  try {
    return localStorage.getItem(`pc-wb-${k}`) || def;
  } catch {
    return def;
  }
};
const savePref = (k: string, v: string) => {
  try {
    localStorage.setItem(`pc-wb-${k}`, v);
  } catch {}
};

const newId = () => `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const r1 = (n: number) => Math.round(n * 10) / 10;

function isEditableTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

type ClipBase = { c: HTMLCanvasElement; ox: number; oy: number } | null;

/** Papel de cebola no estilo do Krita: cada distância (-5..-1, +1..+5) liga/desliga e tem opacidade própria */
type OnionCfg = { on: Record<string, boolean>; op: Record<string, number>; tint: boolean; prev: string; next: string };
const ONION_OFFSETS = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5];
const DEFAULT_ONION: OnionCfg = {
  on: { '-1': true, '-2': true, '1': true },
  op: { '-5': 0.06, '-4': 0.08, '-3': 0.12, '-2': 0.18, '-1': 0.32, '1': 0.22, '2': 0.12, '3': 0.08, '4': 0.06, '5': 0.05 },
  tint: true,
  prev: '#ff4d4d',
  next: '#33cc66',
};
function loadOnion(): OnionCfg {
  try {
    const raw = JSON.parse(localStorage.getItem('pc-wb-onion') || 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT_ONION;
    const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
    const on: Record<string, boolean> = {};
    const op: Record<string, number> = {};
    for (const o of ONION_OFFSETS) {
      on[o] = Boolean(raw.on?.[o]);
      const n = Number(raw.op?.[o]);
      op[o] = Number.isFinite(n) ? Math.min(1, Math.max(0.02, n)) : DEFAULT_ONION.op[o];
    }
    return { on, op, tint: raw.tint !== false, prev: hex(raw.prev, DEFAULT_ONION.prev), next: hex(raw.next, DEFAULT_ONION.next) };
  } catch {
    return DEFAULT_ONION;
  }
}

/** Quadros de animação que não são o primeiro da prancheta (ficam ocultos em exportações estáticas) */
function nonFirstFrames(layers: WhiteboardLayer[], elements: WhiteboardElement[]) {
  const boards = new Set(elements.filter((e) => e.kind === 'artboard').map((e) => e.id));
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const l of layers) {
    if (!l.anim || !boards.has(l.anim)) continue;
    if (seen.has(l.anim)) out.add(l.id);
    else seen.add(l.anim);
  }
  return out;
}

/**
 * Desenha uma camada já pronta (pixels da tela) no destino com opacidade, mistura e ajustes.
 * clipBase: undefined = camada normal; null = máscara sem base (não aparece); objeto = recorta pela camada de baixo.
 */
function compositeLayer(
  out: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  layer: WhiteboardLayer,
  ox: number,
  oy: number,
  blurScale: number,
  clipBase: ClipBase | undefined,
  scratch: HTMLCanvasElement | null
) {
  if (clipBase === null) return;
  const filter = layerFilter(layer.fx, blurScale);
  out.save();
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.globalAlpha = clamp(layer.opacity ?? 1, 0, 1);
  out.globalCompositeOperation = (layer.blend as GlobalCompositeOperation) || 'source-over';
  if (clipBase === undefined || !scratch) {
    out.filter = filter;
    out.drawImage(src, ox, oy);
  } else {
    if (scratch.width !== src.width || scratch.height !== src.height) {
      scratch.width = src.width;
      scratch.height = src.height;
    }
    const sc = scratch.getContext('2d')!;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalAlpha = 1;
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(0, 0, scratch.width, scratch.height);
    sc.filter = filter;
    sc.drawImage(src, ox, oy);
    sc.filter = 'none';
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(clipBase.c, clipBase.ox, clipBase.oy);
    sc.globalCompositeOperation = 'source-over';
    out.drawImage(scratch, 0, 0);
  }
  out.restore();
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
  mode: 'pan' | 'draw' | 'shape' | 'move' | 'resize' | 'rotate' | 'movelayer' | 'moveboard';
  ids?: string[];
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
  const [brushComp, setBrushComp] = useState('source-over');
  const [gradType, setGradType] = useState<WhiteboardGradientType>('linear');
  const [gradToTransparent, setGradToTransparent] = useState(false);
  const [artboardPreset, setArtboardPreset] = useState('');
  const [channelView, setChannelView] = useState<ChannelView>('rgb');
  const channelViewRef = useRef(channelView);
  channelViewRef.current = channelView;
  const [symmetry, setSymmetry] = useState<SymmetryMode>('off');
  const symmetryRef = useRef(symmetry);
  symmetryRef.current = symmetry;
  const [showFx, setShowFx] = useState(false);
  const [guides, setGuides] = useState<GuideMode>(() => readPref('guides', 'dots') as GuideMode);
  const guidesRef = useRef(guides);
  guidesRef.current = guides;
  const [showMinimap, setShowMinimap] = useState(() => readPref('minimap', '1') === '1');
  const showMinimapRef = useRef(showMinimap);
  showMinimapRef.current = showMinimap;
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const cursorPosT = useRef(0);
  // animação (linha do tempo local; os quadros são camadas sincronizadas)
  const [animOpen, setAnimOpen] = useState(false);
  const [animBoardId, setAnimBoardId] = useState<string | null>(null);
  const animBoardRef = useRef(animBoardId);
  animBoardRef.current = animBoardId;
  const [animFrame, setAnimFrameState] = useState(0);
  const animFrameRef = useRef(0);
  const setAnimFrame = useCallback((i: number) => {
    animFrameRef.current = i;
    setAnimFrameState(i);
  }, []);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const [onion, setOnion] = useState(true);
  const onionRef = useRef(onion);
  onionRef.current = onion;
  const [onionCfg, setOnionCfgState] = useState<OnionCfg>(loadOnion);
  const onionCfgRef = useRef(onionCfg);
  onionCfgRef.current = onionCfg;
  const setOnionCfg = useCallback((fn: (c: OnionCfg) => OnionCfg) => {
    setOnionCfgState((c) => {
      const n = fn(c);
      try {
        localStorage.setItem('pc-wb-onion', JSON.stringify(n));
      } catch {
        /* sem armazenamento: vale só nesta sessão */
      }
      return n;
    });
  }, []);
  const [onionMenu, setOnionMenu] = useState(false);
  const onionTintsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [exporting, setExporting] = useState<string | null>(null);
  // pincel importado em uso
  const [tipId, setTipId] = useState<string | null>(BUILTIN_BRUSHES[0]?.id ?? null);
  const [tipSpacing, setTipSpacing] = useState<number | null>(null);
  const [tipJitter, setTipJitter] = useState(0);
  const [tipGrid, setTipGrid] = useState<{ x: number; y: number } | null>(null);
  // painel "Pincéis" (abaixo de Propriedades): aberto/fechado, busca e embutidos escondidos por quem usa
  const [brushesOpen, setBrushesOpen] = useState(() => readPref('brushesOpen', '1') === '1');
  const [brushQuery, setBrushQuery] = useState('');
  const [hiddenTips, setHiddenTips] = useState<string[]>(() => {
    try {
      const v = JSON.parse(readPref('hiddenTips', '[]'));
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const brushPanelInputRef = useRef<HTMLInputElement>(null);
  const activeLayerIdRef = useRef(activeLayerId);
  activeLayerIdRef.current = activeLayerId;

  const [view, setViewState] = useState<View>({ x: 0, y: 0, z: 1 });
  const viewRef = useRef(view);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [showPanel, setShowPanel] = useState(true);
  // layout no estilo do Photoshop
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [colorTab, setColorTab] = useState<'color' | 'swatches' | 'gradients'>('color');
  const [colorChip, setColorChip] = useState<'fg' | 'bg'>('fg');
  const [propsTab, setPropsTab] = useState<'props' | 'fx'>('props');
  const [layersTab, setLayersTab] = useState<'layers' | 'channels'>('layers');
  const [layerQuery, setLayerQuery] = useState('');
  const [showLayers, setShowLayers] = useState(true);
  const [layersFloat, setLayersFloat] = useState(() => readPref('layersFloat', '1') === '1');
  const [layersPos, setLayersPos] = useState<{ r: number; b: number }>(() => {
    const [r, b] = readPref('layersPos', '16,16').split(',').map(Number);
    return { r: Number.isFinite(r) ? Math.max(0, r) : 16, b: Number.isFinite(b) ? Math.max(0, b) : 16 };
  });
  const [slotPick, setSlotPick] = useState<Record<number, Tool>>({});
  const [flyout, setFlyout] = useState<{ slot: number; x: number; y: number } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv('#ffffff')!);
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const imgInputRef = useRef<HTMLInputElement>(null);
  const tipInputRef = useRef<HTMLInputElement>(null);
  const longPressRef = useRef<number | null>(null);
  const pickColorNow = colorChip === 'bg' ? color2 : color;
  // o seletor HSV acompanha a cor quando ela muda por fora (conta-gotas, amostra, X)
  useEffect(() => {
    const n = hexToHsv(pickColorNow);
    if (!n || hsvToHex(hsvRef.current) === hsvToHex(n)) return;
    setHsv((p) => ({ h: n.s === 0 || n.v === 0 ? p.h : n.h, s: n.s, v: n.v }));
  }, [pickColorNow]);
  useEffect(() => {
    const si = TOOL_SLOTS.findIndex((sl) => sl.includes(tool));
    if (si >= 0 && TOOL_SLOTS[si].length > 1) setSlotPick((p) => (p[si] === tool ? p : { ...p, [si]: tool }));
  }, [tool]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, WhiteboardCursor & { ts: number }>>({});
  const remoteCursorsRef = useRef(remoteCursors);
  remoteCursorsRef.current = remoteCursors;
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
  // arrasto ao vivo de vários (prancheta com conteúdo) e da camada inteira
  const groupMoveRef = useRef<{ ids: Set<string>; dx: number; dy: number } | null>(null);
  const layerMoveRef = useRef<{ layerId: string; dx: number; dy: number } | null>(null);
  // eixo da simetria (fixo no mundo) e o centro usado no traço atual
  const symAxisRef = useRef<{ x: number; y: number }>({ x: 800, y: 450 });
  const symCenterRef = useRef<{ x: number; y: number } | null>(null);
  // desfazer/refazer só do que eu fiz, por id (não depende da ordem do servidor)
  const undoStackRef = useRef<WhiteboardElement[][]>([]);
  const redoStackRef = useRef<WhiteboardElement[][]>([]);
  const liveCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const incDraftsRef = useRef<Map<string, { canvas: HTMLCanvasElement; n: number; key: string; sig: string; lx: number; ly: number }>>(new Map());
  const clipScratchRef = useRef<HTMLCanvasElement | null>(null);
  const chCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingLayersRef = useRef<WhiteboardLayer[] | null>(null);
  const layerTimerRef = useRef<number | null>(null);
  // minimapa: conteúdo desenhado em escala (refeito no máx. a cada ~0,5 s) + retângulo da tela
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const miniContentRef = useRef<HTMLCanvasElement | null>(null);
  const miniMapRef = useRef<{ bx: number; by: number; scale: number; ox: number; oy: number } | null>(null);
  const miniStampRef = useRef<{ els: WhiteboardElement[] | null; layers: WhiteboardLayer[] | null; bg: string; t: number }>({ els: null, layers: null, bg: '', t: 0 });
  const miniTimerRef = useRef<number | null>(null);
  const miniDragRef = useRef<number | null>(null);

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

    // ver um canal: monta tudo numa tela à parte e mostra em tons de cinza no fim
    const chMode = channelViewRef.current;
    let out = ctx;
    if (chMode !== 'rgb') {
      if (!chCanvasRef.current) chCanvasRef.current = document.createElement('canvas');
      const cc = chCanvasRef.current;
      if (cc.width !== W || cc.height !== H) {
        cc.width = W;
        cc.height = H;
      }
      out = cc.getContext('2d')!;
      out.setTransform(1, 0, 0, 1, 0, 0);
      out.globalAlpha = 1;
      out.globalCompositeOperation = 'source-over';
      out.filter = 'none';
      out.clearRect(0, 0, W, H);
      if (chMode !== 'alpha') drawBackground(out, st.background, v, dpr);
    } else drawBackground(ctx, st.background, v, dpr);
    if (chMode === 'rgb' && st.background !== 'grid') drawGuides(ctx, guidesRef.current, v, dpr, st.background === 'light');

    // agrupa por camada (aplicando a edição ao vivo de mover/redimensionar e o arrasto em grupo)
    const fallbackLayer = st.layers[0]?.id || 'layer-1';
    const visibleLayers = new Set(st.layers.filter((l) => l.visible).map((l) => l.id));
    const groups = new Map<string, WhiteboardElement[]>();
    const boards: WhiteboardElement[] = [];
    const patch = livePatchRef.current;
    const hidden = hiddenIdRef.current;
    const gm = groupMoveRef.current;
    for (const raw of st.elements) {
      if (raw.id === hidden) continue;
      let el = patch && raw.id === patch.id ? patch : raw;
      if (gm && gm.ids.has(el.id)) el = { ...el, ...translatePatch(el, gm.dx, gm.dy) };
      const lid = st.layers.some((l) => l.id === el.layerId) ? el.layerId : fallbackLayer;
      if (el.kind === 'artboard') {
        if (visibleLayers.has(lid)) boards.push(el);
        continue;
      }
      let arr = groups.get(lid);
      if (!arr) groups.set(lid, (arr = []));
      arr.push(el);
    }
    const draftGroups = new Map<string, WhiteboardElement[]>();
    const pushDraft = (d: WhiteboardElement) => {
      if (d.kind === 'artboard') {
        boards.push(d);
        return;
      }
      const lid = st.layers.some((l) => l.id === d.layerId) ? d.layerId : fallbackLayer;
      let arr = draftGroups.get(lid);
      if (!arr) draftGroups.set(lid, (arr = []));
      arr.push(d);
    };
    remoteDraftsRef.current.forEach((d) => pushDraft(d.el));
    const myDraft = draftRef.current;
    if (myDraft) {
      pushDraft(myDraft);
      const sc = symCenterRef.current;
      if (sc && symmetryRef.current !== 'off') {
        for (const m of mirrorCopies(myDraft, symmetryRef.current, sc.x, sc.y, () => 'mirror')) pushDraft(m);
      }
    }

    // pranchetas: papel embaixo de todas as camadas
    if (boards.length && chMode !== 'alpha') {
      out.save();
      out.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
      const sel0 = selectedIdRef.current;
      for (const b of boards) drawArtboard(out, b, v.z, b.id === sel0);
      out.restore();
    }

    const caches = cachesRef.current;
    const lives = liveCanvasesRef.current;
    const lm = layerMoveRef.current;
    const blurScale = v.z * dpr;
    let clipBase: ClipBase = null;
    const liveIncIds = new Set<string>();
    // animação: de cada prancheta animada só aparece o quadro atual (+ papel de cebola), recortado nela
    const framesByBoard = new Map<string, { ids: string[]; rect: Bounds }>();
    for (const a of st.elements) {
      if (a.kind !== 'artboard') continue;
      framesByBoard.set(a.id, {
        ids: [],
        rect: { x: (a.x || 0) + (a.tx || 0), y: (a.y || 0) + (a.ty || 0), w: Math.abs(a.w || 0), h: Math.abs(a.h || 0) },
      });
    }
    for (const l of st.layers) if (l.anim) framesByBoard.get(l.anim)?.ids.push(l.id);
    const shownFrame = (boardId: string, ids: string[]) => {
      if (playingRef.current && boardId === animBoardRef.current) return Math.min(animFrameRef.current, ids.length - 1);
      const ai = ids.indexOf(activeLayerIdRef.current);
      if (ai !== -1) return ai;
      return boardId === animBoardRef.current ? Math.min(animFrameRef.current, ids.length - 1) : 0;
    };
    for (const layer of st.layers) {
      let alphaMul = 1;
      let onionTint: string | null = null;
      let frameRect: Bounds | null = null;
      const fl = layer.anim ? framesByBoard.get(layer.anim) : undefined;
      if (fl && fl.ids.length) {
        const fi = fl.ids.indexOf(layer.id);
        const cur = shownFrame(layer.anim!, fl.ids);
        const onionOn = onionRef.current && !playingRef.current && layer.anim === animBoardRef.current;
        const off = fi - cur;
        const oc = onionCfgRef.current;
        alphaMul = off === 0 ? 1 : onionOn && oc.on[off] ? oc.op[off] ?? 0.1 : 0;
        if (off !== 0 && alphaMul && oc.tint) onionTint = off < 0 ? oc.prev : oc.next;
        frameRect = fl.rect;
        if (!alphaMul) {
          caches.delete(layer.id);
          lives.delete(layer.id);
          continue;
        }
      }
      const els = groups.get(layer.id) || [];
      const drafts = draftGroups.get(layer.id);
      if (!drafts) lives.delete(layer.id);
      if (!layer.visible || (!els.length && !drafts)) {
        caches.delete(layer.id);
        if (!layer.clip) clipBase = null;
        continue;
      }
      let entry = caches.get(layer.id);
      if (!entry) {
        entry = { canvas: document.createElement('canvas'), els: [], key: '' };
        caches.set(layer.id, entry);
      }
      if (entry.key !== viewKey || !shallowSame(entry.els, els)) {
        const sized = entry.canvas.width === W && entry.canvas.height === H;
        if (!sized) {
          entry.canvas.width = W;
          entry.canvas.height = H;
        }
        // só chegaram elementos novos no fim (o caso comum): pinta só eles por cima
        const prev = entry.els;
        const appendOnly =
          sized && entry.key === viewKey && prev.length > 0 && els.length > prev.length && prev.every((e, i) => els[i] === e);
        if (appendOnly) renderElements(entry.canvas.getContext('2d')!, els.slice(prev.length), v, dpr, env, visible, true);
        else renderElements(entry.canvas.getContext('2d')!, els, v, dpr, env, visible);
        entry.els = els;
        entry.key = viewKey;
      }
      let src: HTMLCanvasElement = entry.canvas;
      if (drafts) {
        let live = lives.get(layer.id);
        if (!live) {
          live = document.createElement('canvas');
          lives.set(layer.id, live);
        }
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
        for (const d of drafts) {
          if (!isIncrementalStroke(d)) {
            drawElement(lctx, d, env);
            continue;
          }
          // aerógrafo: guarda o que já foi pintado do traço e só acrescenta os pontos novos
          const pts = d.points || [];
          const sig = `${d.color}|${d.size}|${d.opacity}|${d.hardness}|${d.tx}|${d.ty}`;
          let inc = incDraftsRef.current.get(d.id);
          const last = inc && inc.n > 0 ? pts[inc.n - 1] : null;
          const valid =
            inc &&
            inc.key === viewKey &&
            inc.canvas.width === W &&
            inc.canvas.height === H &&
            inc.n <= pts.length &&
            inc.sig === sig &&
            (!inc.n || (last && last.x === inc.lx && last.y === inc.ly));
          if (!inc || !valid) {
            const c = inc?.canvas || document.createElement('canvas');
            c.width = W;
            c.height = H; // também limpa
            inc = { canvas: c, n: 0, key: viewKey, sig, lx: 0, ly: 0 };
            incDraftsRef.current.set(d.id, inc);
          }
          if (pts.length > inc.n) {
            const ictx = inc.canvas.getContext('2d')!;
            ictx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
            drawStrokeFrom(ictx, d, inc.n);
            inc.n = pts.length;
            inc.lx = pts[pts.length - 1].x;
            inc.ly = pts[pts.length - 1].y;
          }
          lctx.save();
          lctx.setTransform(1, 0, 0, 1, 0, 0);
          lctx.globalAlpha = 1;
          lctx.globalCompositeOperation = 'source-over';
          lctx.drawImage(inc.canvas, 0, 0);
          lctx.restore();
          liveIncIds.add(d.id);
        }
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        src = live;
      }
      const ox = lm && lm.layerId === layer.id ? lm.dx * v.z * dpr : 0;
      const oy = lm && lm.layerId === layer.id ? lm.dy * v.z * dpr : 0;
      if (layer.clip && clipBase && !clipScratchRef.current) clipScratchRef.current = document.createElement('canvas');
      if (onionTint) {
        // quadro vizinho tingido (vermelho = antes, verde = depois), como no Krita
        let tc = onionTintsRef.current.get(layer.id);
        if (!tc) onionTintsRef.current.set(layer.id, (tc = document.createElement('canvas')));
        if (tc.width !== W || tc.height !== H) {
          tc.width = W;
          tc.height = H;
        }
        const t = tc.getContext('2d')!;
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.globalAlpha = 1;
        t.globalCompositeOperation = 'copy';
        t.drawImage(src, 0, 0);
        t.globalCompositeOperation = 'source-atop';
        t.globalAlpha = 0.65;
        t.fillStyle = onionTint;
        t.fillRect(0, 0, W, H);
        t.globalAlpha = 1;
        t.globalCompositeOperation = 'source-over';
        src = tc;
      } else onionTintsRef.current.delete(layer.id);
      const lay = alphaMul !== 1 ? { ...layer, opacity: (layer.opacity ?? 1) * alphaMul } : layer;
      if (frameRect) {
        out.save();
        out.setTransform(1, 0, 0, 1, 0, 0);
        out.beginPath();
        out.rect((frameRect.x * v.z + v.x) * dpr, (frameRect.y * v.z + v.y) * dpr, frameRect.w * v.z * dpr, frameRect.h * v.z * dpr);
        out.clip();
      }
      compositeLayer(out, src, lay, ox, oy, blurScale, layer.clip ? clipBase : undefined, clipScratchRef.current);
      if (frameRect) out.restore();
      if (!layer.clip) clipBase = { c: src, ox, oy };
    }
    for (const id of Array.from(caches.keys())) {
      if (!st.layers.some((l) => l.id === id)) caches.delete(id);
    }
    for (const id of Array.from(lives.keys())) {
      if (!st.layers.some((l) => l.id === id)) lives.delete(id);
    }
    for (const id of Array.from(incDraftsRef.current.keys())) {
      if (!liveIncIds.has(id)) incDraftsRef.current.delete(id);
    }

    if (chMode !== 'rgb' && chCanvasRef.current) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.filter = channelFilter(chMode);
      ctx.drawImage(chCanvasRef.current, 0, 0);
      ctx.restore();
    }

    // eixos da simetria
    const symM = symmetryRef.current;
    if (symM !== 'off') {
      const c = symCenterRef.current || symAxisRef.current;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = 'rgba(235,69,158,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      const cx = c.x * v.z + v.x;
      const cy = c.y * v.z + v.y;
      ctx.beginPath();
      if (symM === 'x' || symM === 'xy') {
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
      }
      if (symM === 'y' || symM === 'xy') {
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
      }
      ctx.stroke();
      ctx.restore();
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
      } else if (selEl.kind === 'artboard') {
        // a própria prancheta já aparece destacada
      } else if (selEl.kind === 'gradient') {
        const gx = selEl.tx || 0;
        const gy = selEl.ty || 0;
        const a = toS({ x: (selEl.x || 0) + gx, y: (selEl.y || 0) + gy });
        const b = toS({ x: (selEl.x2 || 0) + gx, y: (selEl.y2 || 0) + gy });
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        for (const pt of [a, b]) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else {
        const b = elementBounds(selEl);
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x * v.z + v.x - 3, b.y * v.z + v.y - 3, b.w * v.z + 6, b.h * v.z + 6);
      }
      ctx.restore();
    }

    drawMinimapRef.current();

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

  const drawMinimapRef = useRef<() => void>(() => {});
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
      // cobre tudo que foi desenhado (nada fica fora da tela), com uma margem
      const box = b && (b.w > 0 || b.h > 0) ? { ...b, w: Math.max(b.w, 1), h: Math.max(b.h, 1) } : DEFAULT_BOARD;
      const z = clamp(Math.min(w / box.w, h / box.h) * 0.92, MIN_Z, 4);
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
        .map((e) => {
          if (e.kind !== 'gradient') return elementBounds(e);
          const gx = e.tx || 0;
          const gy = e.ty || 0;
          const x0 = Math.min(e.x || 0, e.x2 || 0) + gx;
          const y0 = Math.min(e.y || 0, e.y2 || 0) + gy;
          return { x: x0, y: y0, w: Math.abs((e.x2 || 0) - (e.x || 0)), h: Math.abs((e.y2 || 0) - (e.y || 0)) };
        })
    );
  }, []);

  useEffect(() => {
    requestRender();
  }, [wb, selectedId, channelView, symmetry, guides, showMinimap, animFrame, playing, onion, onionCfg, animBoardId, activeLayerId, requestRender]);

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
      liveCanvasesRef.current.clear();
      liveCanvasRef.current = null;
      if (layerTimerRef.current) window.clearTimeout(layerTimerRef.current);
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
    const onTranslated = ({ channelId: ch, ids, dx, dy }: { channelId: string; ids: string[]; dx: number; dy: number }) => {
      if (!forThis(ch) || !Array.isArray(ids)) return;
      const set = new Set(ids);
      setWb((p) => ({ ...p, elements: p.elements.map((e) => (set.has(e.id) ? { ...e, ...translatePatch(e, dx, dy) } : e)) }));
    };
    const onBrushes = ({ channelId: ch, brushes }: { channelId: string; brushes: WhiteboardState['brushes'] }) => {
      if (!forThis(ch) || !Array.isArray(brushes)) return;
      setWb((p) => ({ ...p, brushes }));
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
    socket.on('wb:translated', onTranslated);
    socket.on('wb:brushes', onBrushes);
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
      socket.off('wb:translated', onTranslated);
      socket.off('wb:brushes', onBrushes);
      socket.off('wb:cursor', onCursor);
    };
  }, [socket, channelId, fitTo, contentBounds]);

  // pontas dos pincéis da sala → imagens prontas para o motor de pincel
  useEffect(() => {
    for (const b of [...BUILTIN_BRUSHES, ...(wb.brushes || [])]) {
      const cur = tipRegistry.get(b.id);
      if (cur && cur.src === b.tip) continue;
      const img = new Image();
      img.onload = () => {
        imgVersionRef.current++;
        requestRenderRef.current();
      };
      img.src = b.tip;
      tipRegistry.set(b.id, img);
    }
    if (tipId && !BUILTIN_BRUSHES.some((b) => b.id === tipId) && !(wb.brushes || []).some((b) => b.id === tipId)) setTipId(null);
  }, [wb.brushes, tipId]);

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
    setRecentColors((prev) => [c, ...prev.filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 24));

  const commitElement = useCallback(
    (el: WhiteboardElement, record = true) => {
      setWb((p) => (p.elements.some((x) => x.id === el.id) ? p : { ...p, elements: [...p.elements, el] }));
      if (record) {
        undoStackRef.current.push([el]);
        if (undoStackRef.current.length > 200) undoStackRef.current.shift();
        redoStackRef.current = [];
      }
      // se o servidor recusar (grande demais, sem permissão, muitas ações), some da minha tela também
      socket?.emit('wb:add-element', { channelId, element: el }, (res?: { error?: string }) => {
        if (!res?.error) return;
        setWb((p) => ({ ...p, elements: p.elements.filter((x) => x.id !== el.id) }));
        flash(res.error);
      });
    },
    [socket, channelId, flash]
  );

  /** Vários elementos que se desfazem juntos (simetria) */
  const commitGroup = useCallback(
    (els: WhiteboardElement[]) => {
      for (const el of els) commitElement(el, false);
      undoStackRef.current.push(els);
      if (undoStackRef.current.length > 200) undoStackRef.current.shift();
      redoStackRef.current = [];
    },
    [commitElement]
  );

  const applyTranslate = useCallback(
    (ids: string[], dx0: number, dy0: number) => {
      const dx = r1(dx0);
      const dy = r1(dy0);
      if (!ids.length || (!dx && !dy)) return;
      const set = new Set(ids);
      setWb((p) => ({ ...p, elements: p.elements.map((e) => (set.has(e.id) ? { ...e, ...translatePatch(e, dx, dy) } : e)) }));
      socket?.emit('wb:translate', { channelId, ids, dx, dy });
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

  const flushLayers = () => {
    if (layerTimerRef.current) window.clearTimeout(layerTimerRef.current);
    layerTimerRef.current = null;
    const next = pendingLayersRef.current;
    pendingLayersRef.current = null;
    if (next) socket?.emit('wb:layers-update', { channelId, layers: next });
  };
  // throttle: sliders (ajustes, opacidade) mudam a tela na hora e mandam no máx. ~8x por segundo
  const updateLayers = (next: WhiteboardLayer[], throttle = false) => {
    setWb((p) => ({ ...p, layers: next }));
    pendingLayersRef.current = next;
    if (!throttle) return flushLayers();
    if (!layerTimerRef.current) layerTimerRef.current = window.setTimeout(flushLayers, 120);
  };
  const patchLayer = (id: string, patch: Partial<WhiteboardLayer>, throttle = false) =>
    updateLayers(wbRef.current.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)), throttle);

  const duplicateLayer = (id: string) => {
    if (wb.layers.length >= 160) return flash('Limite de 160 camadas (contando quadros de animação).');
    const src = wb.layers.find((l) => l.id === id);
    if (!src) return;
    flushLayers();
    const nid = `layer-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    socket?.emit('wb:duplicate-layer', { channelId, layerId: id, newLayerId: nid, name: `${src.name} cópia`.slice(0, 40) });
    setActiveLayerId(nid);
  };

  const mergeDown = (id: string) => {
    const idx = wb.layers.findIndex((l) => l.id === id);
    if (idx <= 0) return flash('Não há camada embaixo para mesclar.');
    if (wb.layers[idx].locked || wb.layers[idx - 1].locked) return flash('Desbloqueie as duas camadas para mesclar.');
    const top = wb.layers[idx];
    if (
      (hasFx(top.fx) || top.clip) &&
      !window.confirm(
        `A camada "${top.name}" tem ${[hasFx(top.fx) && 'ajustes (brilho, matiz, desfoque…)', top.clip && 'máscara de recorte'].filter(Boolean).join(' e ')}, que não passam para a camada de baixo ao mesclar. Mesclar mesmo assim?`
      )
    )
      return;
    flushLayers();
    socket?.emit('wb:merge-down', { channelId, layerId: id });
    setActiveLayerId(wb.layers[idx - 1].id);
  };

  const addLayer = () => {
    if (wb.layers.length >= 160) return flash('Limite de 160 camadas (contando quadros de animação).');
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
    const stack = undoStackRef.current;
    while (stack.length) {
      const group = stack.pop()!;
      const cur = wbRef.current.elements;
      const alive = group.map((g) => cur.find((e) => e.id === g.id)).filter(Boolean) as WhiteboardElement[];
      if (!alive.length) continue; // alguém já apagou: vai para o anterior
      redoStackRef.current.push(alive);
      const ids = new Set(alive.map((e) => e.id));
      setWb((p) => ({ ...p, elements: p.elements.filter((e) => !ids.has(e.id)) }));
      setSelectedId((sid) => (sid && ids.has(sid) ? null : sid));
      for (const e of alive) socket?.emit('wb:delete-element', { channelId, elementId: e.id });
      return;
    }
    // nada no histórico desta sessão: desfaz o último meu que o servidor tem
    socket?.emit('wb:undo', { channelId });
  }, [canDraw, socket, channelId]);

  const redo = useCallback(() => {
    if (!canDraw) return;
    const group = redoStackRef.current.pop();
    if (!group) return;
    undoStackRef.current.push(group);
    for (const e of group) commitElement(e, false);
  }, [canDraw, commitElement]);

  const insertImageBlob = useCallback(
    (blob: Blob, at?: { x: number; y: number }) => {
      if (!canDraw || !socket) return;
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
        // cada imagem vira uma camada nova, logo acima da ativa (dá para mesclar depois)
        const cur = wbRef.current;
        if (cur.layers.length >= 160) {
          flash('Limite de 160 camadas: mescle algumas antes de colar mais imagens.');
          return;
        }
        const layerId = `layer-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        const fileName = blob instanceof File && blob.name ? blob.name.replace(/\.[^.]+$/, '') : '';
        const layerName = (fileName || `Imagem ${cur.layers.length + 1}`).slice(0, 40);
        const ai = cur.layers.findIndex((l) => l.id === activeLayerId);
        const nextLayers = cur.layers.slice();
        nextLayers.splice(ai === -1 ? nextLayers.length : ai + 1, 0, { id: layerId, name: layerName, visible: true, locked: false, opacity: 1 });
        wbRef.current = { ...cur, layers: nextLayers }; // várias imagens de uma vez não se atropelam
        setWb((pv) => ({ ...pv, layers: nextLayers }));
        socket.emit('wb:layers-update', { channelId, layers: nextLayers });
        setActiveLayerId(layerId);
        const el: WhiteboardElement = {
          id: newId(),
          kind: 'image',
          layerId,
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
    [canDraw, socket, channelId, activeLayerId, user.id, user.displayName, commitElement, flash]
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

  const exportPng = async (board?: WhiteboardElement) => {
    const b: Bounds | null = board
      ? { x: (board.x || 0) + (board.tx || 0), y: (board.y || 0) + (board.ty || 0), w: Math.abs(board.w || 0), h: Math.abs(board.h || 0) }
      : contentBounds();
    if (!b) return flash('O quadro está vazio.');
    await ensureImagesLoaded();
    const pad = board ? 0 : 32;
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
    if (st.background !== 'transparent' && !board) drawBackground(octx, st.background, ev, 1);
    // papel das pranchetas (sem o nome)
    octx.save();
    octx.setTransform(scale, 0, 0, scale, -bx * scale, -by * scale);
    for (const a of st.elements) {
      if (a.kind !== 'artboard' || !st.layers.some((l) => l.id === a.layerId && l.visible)) continue;
      octx.fillStyle = a.color || '#ffffff';
      octx.fillRect((a.x || 0) + (a.tx || 0), (a.y || 0) + (a.ty || 0), Math.abs(a.w || 0), Math.abs(a.h || 0));
    }
    octx.restore();
    const env = getEnv();
    const lc = document.createElement('canvas');
    lc.width = W;
    lc.height = H;
    const lctx = lc.getContext('2d')!;
    const needClip = st.layers.some((l) => l.clip && l.visible);
    const baseC = needClip ? document.createElement('canvas') : null;
    const scratch = needClip ? document.createElement('canvas') : null;
    if (baseC) {
      baseC.width = W;
      baseC.height = H;
    }
    let base: ClipBase = null;
    const hiddenFrames = nonFirstFrames(st.layers, st.elements);
    for (const layer of st.layers) {
      const els = layer.visible && !hiddenFrames.has(layer.id) ? st.elements.filter((e) => e.layerId === layer.id && e.kind !== 'artboard') : [];
      if (!els.length) {
        if (!layer.clip) base = null;
        continue;
      }
      renderElements(lctx, els, ev, 1, env, null);
      compositeLayer(octx, lc, layer, 0, 0, scale, layer.clip ? base : undefined, scratch);
      if (!layer.clip && baseC) {
        const bctx = baseC.getContext('2d')!;
        bctx.clearRect(0, 0, W, H);
        bctx.drawImage(lc, 0, 0);
        base = { c: baseC, ox: 0, oy: 0 };
      }
    }
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = board ? String(board.text || 'prancheta').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'prancheta' : '';
      a.download = board ? `${safeName}.png` : `whiteboard-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      a.href = url;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
  };

  const fileBase = (board?: WhiteboardElement | null) =>
    board
      ? String(board.text || 'prancheta').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'prancheta'
      : `whiteboard-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;

  const exportBounds = (board?: WhiteboardElement | null): Bounds | null => {
    if (board) return { x: (board.x || 0) + (board.tx || 0), y: (board.y || 0) + (board.ty || 0), w: Math.abs(board.w || 0), h: Math.abs(board.h || 0) };
    const b = contentBounds();
    return b ? { x: b.x - 32, y: b.y - 32, w: b.w + 64, h: b.h + 64 } : null;
  };
  const paperFor = (board?: WhiteboardElement | null) =>
    board ? board.color || '#ffffff' : wbRef.current.background === 'transparent' ? null : wbRef.current.background === 'light' ? '#ffffff' : '#282828';

  /** Pixels de uma camada no recorte, com os ajustes já aplicados */
  const renderLayerCanvas = (layer: WhiteboardLayer, ev: View, W: number, H: number, scale: number) => {
    const els = wbRef.current.elements.filter((e) => e.layerId === layer.id && e.kind !== 'artboard');
    if (!els.length) return null;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    renderElements(c.getContext('2d')!, els, ev, 1, getEnv(), null);
    if (!hasFx(layer.fx)) return c;
    const f = document.createElement('canvas');
    f.width = W;
    f.height = H;
    const fctx = f.getContext('2d')!;
    fctx.filter = layerFilter(layer.fx, scale);
    fctx.drawImage(c, 0, 0);
    return f;
  };

  const exportSvg = (board?: WhiteboardElement | null) => {
    const b = exportBounds(board);
    if (!b) return flash('O quadro está vazio.');
    const st = wbRef.current;
    const hidden = nonFirstFrames(st.layers, st.elements);
    const layers = st.layers.map((l) => (hidden.has(l.id) ? { ...l, visible: false } : l));
    const svg = buildSvg(b, layers, st.elements, paperFor(board));
    downloadBytes(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase(board)}.svg`, 'image/svg+xml');
  };

  /** PSD em camadas (quadros de animação viram camadas; só o 1º fica visível) */
  const exportPsd = async (board?: WhiteboardElement | null) => {
    const b = exportBounds(board);
    if (!b) return flash('O quadro está vazio.');
    setExporting('Gerando PSD…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      await ensureImagesLoaded();
      const st = wbRef.current;
      const inside = (e: WhiteboardElement) => {
        const eb = elementBounds(e);
        return eb.x < b.x + b.w && eb.x + eb.w > b.x && eb.y < b.y + b.h && eb.y + eb.h > b.y;
      };
      const list = st.layers.filter((l) => st.elements.some((e) => e.layerId === l.id && e.kind !== 'artboard' && inside(e)));
      let scale = Math.min(1, 4096 / Math.max(b.w, b.h));
      while (b.w * scale * b.h * scale * 4 * (list.length + 2) * 2 > 700e6 && scale > 0.05) scale *= 0.85;
      const W = Math.max(1, Math.round(b.w * scale));
      const H = Math.max(1, Math.round(b.h * scale));
      const ev: View = { x: -b.x * scale, y: -b.y * scale, z: scale };
      const hidden = nonFirstFrames(st.layers, st.elements);
      const merged = document.createElement('canvas');
      merged.width = W;
      merged.height = H;
      const mctx = merged.getContext('2d')!;
      const out: PsdLayer[] = [];
      const paper = document.createElement('canvas');
      paper.width = W;
      paper.height = H;
      const pctx = paper.getContext('2d')!;
      const bg = paperFor(board);
      let hasPaper = false;
      if (bg) {
        pctx.fillStyle = bg;
        pctx.fillRect(0, 0, W, H);
        hasPaper = true;
      }
      if (!board) {
        pctx.setTransform(scale, 0, 0, scale, ev.x, ev.y);
        for (const a of st.elements) {
          if (a.kind !== 'artboard') continue;
          pctx.fillStyle = a.color || '#ffffff';
          pctx.fillRect((a.x || 0) + (a.tx || 0), (a.y || 0) + (a.ty || 0), Math.abs(a.w || 0), Math.abs(a.h || 0));
          hasPaper = true;
        }
      }
      if (hasPaper) {
        out.push({ name: board ? 'Papel' : 'Fundo', rgba: pctx.getImageData(0, 0, W, H).data, opacity: 1, visible: true });
        mctx.drawImage(paper, 0, 0);
      }
      const scratch = document.createElement('canvas');
      let base: ClipBase = null;
      for (const layer of list) {
        const c = renderLayerCanvas(layer, ev, W, H, scale);
        if (!c) continue;
        const visible = layer.visible && !hidden.has(layer.id);
        out.push({ name: layer.name, rgba: c.getContext('2d')!.getImageData(0, 0, W, H).data, opacity: layer.opacity ?? 1, blend: layer.blend, visible, clip: layer.clip });
        if (visible) {
          compositeLayer(mctx, c, { ...layer, fx: undefined }, 0, 0, scale, layer.clip ? base : undefined, scratch);
          if (!layer.clip) base = { c, ox: 0, oy: 0 };
        }
      }
      if (!out.length) return flash('Nada para exportar nessa área.');
      downloadBytes(writePsd(W, H, out, mctx.getImageData(0, 0, W, H).data), `${fileBase(board)}.psd`, 'image/vnd.adobe.photoshop');
    } finally {
      setExporting(null);
    }
  };

  /** Cada quadro da prancheta já composto (papel + camadas fixas + o quadro), no tamanho máx. pedido */
  const renderBoardFrames = async (board: WhiteboardElement, maxSide: number) => {
    await ensureImagesLoaded();
    const st = wbRef.current;
    const b = exportBounds(board)!;
    const scale = Math.min(1, maxSide / Math.max(b.w, b.h));
    const W = Math.max(2, Math.round(b.w * scale / 2) * 2);
    const H = Math.max(2, Math.round(b.h * scale / 2) * 2);
    const ev: View = { x: -b.x * scale, y: -b.y * scale, z: scale };
    const cache = new Map<string, HTMLCanvasElement | null>();
    const scratch = document.createElement('canvas');
    const frames = st.layers.filter((l) => l.anim === board.id);
    const out: HTMLCanvasElement[] = [];
    for (const fr of frames) {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = board.color || '#ffffff';
      ctx.fillRect(0, 0, W, H);
      let base: ClipBase = null;
      for (const layer of st.layers) {
        if (!layer.visible || (layer.anim && layer.id !== fr.id)) continue;
        let lc: HTMLCanvasElement | null;
        if (layer.anim) lc = renderLayerCanvas(layer, ev, W, H, scale);
        else {
          if (!cache.has(layer.id)) cache.set(layer.id, renderLayerCanvas(layer, ev, W, H, scale));
          lc = cache.get(layer.id) || null;
        }
        if (!lc) {
          if (!layer.clip) base = null;
          continue;
        }
        compositeLayer(ctx, lc, { ...layer, fx: undefined }, 0, 0, scale, layer.clip ? base : undefined, scratch);
        if (!layer.clip) base = { c: lc, ox: 0, oy: 0 };
      }
      out.push(c);
    }
    return { frames: out, W, H };
  };

  const exportGif = async (board: WhiteboardElement) => {
    setExporting('Gerando GIF…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { frames, W, H } = await renderBoardFrames(board, 720);
      if (!frames.length) return flash('A animação não tem quadros.');
      const bytes = encodeGif(frames.map((c) => c.getContext('2d')!.getImageData(0, 0, W, H).data), W, H, 1000 / clamp(board.fps || 12, 1, 60));
      downloadBytes(bytes, `${fileBase(board)}.gif`, 'image/gif');
    } finally {
      setExporting(null);
    }
  };

  const exportWebm = async (board: WhiteboardElement) => {
    if (typeof MediaRecorder === 'undefined') return flash('Gravação de vídeo indisponível aqui.');
    const fps = clamp(board.fps || 12, 1, 60);
    setExporting('Gravando vídeo…');
    try {
      const { frames, W, H } = await renderBoardFrames(board, 1280);
      if (!frames.length) return flash('A animação não tem quadros.');
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(frames[0], 0, 0);
      const stream = c.captureStream(fps);
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunks.push(ev.data);
      };
      const done = new Promise<void>((r) => (rec.onstop = () => r()));
      rec.start();
      const loops = Math.max(1, Math.ceil((2 * fps) / frames.length)); // pelo menos ~2 s
      for (let l = 0; l < loops; l++) {
        for (const f of frames) {
          ctx.drawImage(f, 0, 0);
          await new Promise((r) => setTimeout(r, 1000 / fps));
        }
      }
      rec.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      downloadBytes(new Blob(chunks, { type: 'video/webm' }), `${fileBase(board)}.webm`, 'video/webm');
    } finally {
      setExporting(null);
    }
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

  const pickArtboardLabel = (x: number, y: number) => {
    const st = wbRef.current;
    for (let i = st.elements.length - 1; i >= 0; i--) {
      const el = st.elements[i];
      if (el.kind !== 'artboard') continue;
      const layer = st.layers.find((l) => l.id === el.layerId);
      if (layer && (!layer.visible || layer.locked)) continue;
      if (hitArtboardLabel(el, x, y, viewRef.current.z)) return el;
    }
    return null;
  };

  /** O que está dentro da prancheta (pelo centro) vai junto quando ela é arrastada */
  const artboardContents = (board: WhiteboardElement) => {
    const st = wbRef.current;
    const ax = (board.x || 0) + (board.tx || 0);
    const ay = (board.y || 0) + (board.ty || 0);
    const aw = Math.abs(board.w || 0);
    const ah = Math.abs(board.h || 0);
    const locked = new Set(st.layers.filter((l) => l.locked).map((l) => l.id));
    return st.elements
      .filter((e) => {
        if (e.kind === 'artboard' || locked.has(e.layerId)) return false;
        const b = elementBounds(e);
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        return cx >= ax && cx <= ax + aw && cy >= ay && cy <= ay + ah;
      })
      .map((e) => e.id);
  };

  /** Área que o degradê preenche: a prancheta embaixo do clique, ou tudo que está à vista + o desenho */
  const gradientRegion = (x: number, y: number): Bounds => {
    const board = artboardAt(wbRef.current.elements, x, y);
    if (board) {
      return { x: (board.x || 0) + (board.tx || 0), y: (board.y || 0) + (board.ty || 0), w: Math.abs(board.w || 0), h: Math.abs(board.h || 0) };
    }
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    const vis: Bounds = { x: -v.x / v.z, y: -v.y / v.z, w: w / v.z, h: h / v.z };
    const all = unionBounds([vis, ...(contentBounds() ? [contentBounds()!] : [])]) || vis;
    const padX = all.w * 0.25;
    const padY = all.h * 0.25;
    return { x: all.x - padX, y: all.y - padY, w: all.w + padX * 2, h: all.h + padY * 2 };
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

  const pathPoint = (x: number, y: number, corner: boolean): WhiteboardPoint => ({ x: r1(x), y: r1(y), p: corner ? 0.01 : 1 });

  /** Caneta de curvas: cada clique põe um ponto (Alt = canto); clicar no 1º ponto fecha */
  const handlePathClick = (x: number, y: number, corner: boolean) => {
    const layer = activeLayer!;
    const d = draftRef.current;
    if (!d || d.kind !== 'path') {
      const comp = layer.alphaLock ? 'source-atop' : brushComp;
      draftRef.current = {
        id: newId(),
        kind: 'path',
        layerId: layer.id,
        color,
        size,
        opacity,
        filled: shapeFilled,
        closed: false,
        points: [pathPoint(x, y, corner), pathPoint(x, y, corner)],
        authorId: user.id,
        authorName: user.displayName,
        createdAt: Date.now(),
        ...(comp !== 'source-over' ? { comp } : {}),
      };
      draftSentRef.current = 0;
      flushDraft(true);
      requestRender();
      return;
    }
    const pts = (d.points || []).slice(0, -1);
    const v = viewRef.current;
    const first = pts[0];
    if (pts.length >= 3 && first && Math.hypot((first.x - x) * v.z, (first.y - y) * v.z) <= 9) {
      finishPath(true);
      return;
    }
    const last = pts[pts.length - 1];
    if (last && Math.hypot((last.x - x) * v.z, (last.y - y) * v.z) < 2) return; // 2º clique do clique duplo
    if (pts.length >= 1999) return finishPath(false);
    pts.push(pathPoint(x, y, corner));
    draftRef.current = { ...d, points: [...pts, pathPoint(x, y, corner)] };
    flushDraft(true);
    requestRender();
  };

  function finishPath(close: boolean) {
    const d = draftRef.current;
    if (!d || d.kind !== 'path') return;
    draftRef.current = null;
    const raw = (d.points || []).slice(0, -1);
    const pts = raw.filter((pt, i) => i === 0 || Math.hypot(pt.x - raw[i - 1].x, pt.y - raw[i - 1].y) > 0.5);
    if (pts.length < 2) {
      socket?.emit('wb:draft', { channelId, cancel: true, id: d.id });
      requestRender();
      return;
    }
    commitElement({ ...d, points: pts, closed: close, filled: Boolean(d.filled) && close });
    pushRecent(d.color);
  }
  const finishPathRef = useRef(finishPath);
  finishPathRef.current = finishPath;
  useEffect(() => {
    if (tool !== 'path' && draftRef.current?.kind === 'path') finishPathRef.current(false);
  }, [tool]);

  /** Vetorizar: o traço à mão vira uma curva com poucos pontos (editável e exportável em SVG) */
  const vectorizeStroke = (el: WhiteboardElement) => {
    const src = (el.points || []).map((pt) => ({ x: pt.x + (el.tx || 0), y: pt.y + (el.ty || 0), p: pt.p }));
    const simple = simplifyPoints(src, Math.max(0.6, (el.size || 4) * 0.12));
    if (simple.length < 2) return flash('Traço curto demais para vetorizar.');
    const avgP = src.reduce((a, pt) => a + (pt.p || 1), 0) / Math.max(1, src.length);
    const path: WhiteboardElement = {
      id: newId(),
      kind: 'path',
      layerId: el.layerId,
      color: el.color,
      size: Math.max(1, r1((el.size || 4) * avgP)),
      opacity: el.opacity,
      points: simple,
      closed: false,
      authorId: user.id,
      authorName: user.displayName,
      createdAt: Date.now(),
      ...(el.comp ? { comp: el.comp } : {}),
    };
    commitElement(path);
    deleteElement(el.id);
    setSelectedId(path.id);
    flash(`Vetorizado: ${src.length} pontos → ${simple.length} âncoras.`);
  };

  const importTips = async (files: File[]) => {
    if (!files.length || !socket) return;
    flash('Lendo pincéis…');
    const { tips, skipped } = await importBrushFiles(files);
    if (!tips.length) return flash('Não achei pontas de pincel nesses arquivos (use PNG, .gbr, .gih ou .bundle do Krita).');
    let first: string | null = null;
    let added = 0;
    for (const t of tips.slice(0, 32)) {
      const id = `tip-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const res = await new Promise<{ ok?: boolean; error?: string }>((resolve) => {
        const timer = window.setTimeout(() => resolve({ error: 'O servidor não respondeu (atualize o servidor para usar pincéis importados).' }), 5000);
        socket.emit('wb:brush-add', { channelId, brush: { id, ...t } }, (x?: { ok?: boolean; error?: string }) => {
          window.clearTimeout(timer);
          resolve(x || {});
        });
      });
      if (res.error) {
        flash(res.error);
        break;
      }
      added++;
      first = first || id;
    }
    if (first) {
      setTipId(first);
      setTipSpacing(null);
      flash(`${added} pincel(is) importado(s)${skipped.length ? ` · ignorados: ${skipped.slice(0, 3).join(', ')}` : ''}.`);
    }
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

    // o nome da prancheta é a alça: arrasta a prancheta com o que tem dentro
    if ((effectiveTool === 'select' || effectiveTool === 'artboard') && canDraw) {
      const board = pickArtboardLabel(x, y);
      if (board) {
        setSelectedId(board.id);
        selectedIdRef.current = board.id;
        canvas.setPointerCapture(e.pointerId);
        dragRef.current = { ...base, mode: 'moveboard', start: board, ids: e.altKey ? [board.id] : [board.id, ...artboardContents(board)] };
        return;
      }
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

    if (effectiveTool === 'movelayer') {
      const ids = wbRef.current.elements.filter((el) => el.layerId === activeLayer.id && el.kind !== 'artboard').map((el) => el.id);
      if (!ids.length) return flash('A camada ativa está vazia.');
      canvas.setPointerCapture(e.pointerId);
      dragRef.current = { ...base, mode: 'movelayer', ids };
      layerMoveRef.current = { layerId: activeLayer.id, dx: 0, dy: 0 };
      return;
    }

    if (effectiveTool === 'artboard' && artboardPreset) {
      const [pw, ph] = artboardPreset.split('x').map(Number);
      const n = wbRef.current.elements.filter((el) => el.kind === 'artboard').length + 1;
      const board: WhiteboardElement = {
        id: newId(),
        kind: 'artboard',
        layerId: activeLayer.id,
        color: '#ffffff',
        size: 1,
        opacity: 1,
        x: r1(x - pw / 2),
        y: r1(y - ph / 2),
        w: pw,
        h: ph,
        text: `Prancheta ${n}`,
        authorId: user.id,
        authorName: user.displayName,
        createdAt: Date.now(),
      };
      commitElement(board);
      setSelectedId(board.id);
      return;
    }

    if (effectiveTool === 'text') {
      const hit = pickElement(x, y);
      if (hit && hit.kind === 'text') openTextEditor(hit);
      else setTextEdit({ x, y, value: '', fontSize, color });
      return;
    }

    if (effectiveTool === 'path') {
      handlePathClick(x, y, e.altKey);
      return;
    }
    const curTip = BUILTIN_BRUSHES.find((b) => b.id === tipId) || (wbRef.current.brushes || []).find((b) => b.id === tipId);
    if (effectiveTool === 'custom' && !curTip) return flash('Importe ou escolha um pincel na barra de cima.');

    canvas.setPointerCapture(e.pointerId);
    const pressure = e.pointerType === 'pen' ? clamp(e.pressure || 0.5, 0.05, 1) : 1;
    const p = pressureSize ? pressure : 1;
    const effOpacity = pressureOpacity && e.pointerType === 'pen' ? Math.max(0.1, opacity * pressure) : opacity;
    // "Travar transparência" na camada: o pincel só pinta onde já tem tinta
    const comp = activeLayer.alphaLock ? 'source-atop' : brushComp;
    const common = {
      id: newId(),
      layerId: activeLayer.id,
      color,
      size,
      authorId: user.id,
      authorName: user.displayName,
      createdAt: Date.now(),
      ...(comp !== 'source-over' && effectiveTool !== 'artboard' ? { comp } : {}),
    };
    symCenterRef.current = null;
    if (symmetry !== 'off' && (isBrush(effectiveTool) || isShape(effectiveTool))) {
      const board = artboardAt(wbRef.current.elements, x, y);
      symCenterRef.current = board
        ? {
            x: (board.x || 0) + (board.tx || 0) + Math.abs(board.w || 0) / 2,
            y: (board.y || 0) + (board.ty || 0) + Math.abs(board.h || 0) / 2,
          }
        : { ...symAxisRef.current };
    }
    if (effectiveTool === 'gradient' || effectiveTool === 'artboard') {
      const region = effectiveTool === 'gradient' ? gradientRegion(x, y) : null;
      const n = wbRef.current.elements.filter((el) => el.kind === 'artboard').length + 1;
      draftRef.current =
        effectiveTool === 'gradient'
          ? {
              ...common,
              kind: 'gradient',
              opacity,
              color2,
              gradType,
              gradAlpha2: gradToTransparent ? 0 : 1,
              x: r1(x),
              y: r1(y),
              x2: r1(x),
              y2: r1(y),
              rx: r1(region!.x),
              ry: r1(region!.y),
              rw: r1(region!.w),
              rh: r1(region!.h),
            }
          : { ...common, kind: 'artboard', color: '#ffffff', size: 1, opacity: 1, x: r1(x), y: r1(y), w: 0, h: 0, text: `Prancheta ${n}` };
      dragRef.current = { ...base, mode: 'shape' };
    } else if (isBrush(effectiveTool)) {
      draftRef.current = {
        ...common,
        kind: 'stroke',
        brush: effectiveTool,
        ...(effectiveTool === 'custom' && curTip ? { tipId: curTip.id, spacing: tipSpacing ?? curTip.spacing, jitter: tipJitter } : {}),
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
    if (performance.now() - cursorPosT.current > 80) {
      cursorPosT.current = performance.now();
      setCursorPos({ x: Math.round(x), y: Math.round(y) });
    }
    const drag = dragRef.current;
    emitCursor(x, y, Boolean(drag && (drag.mode === 'draw' || drag.mode === 'shape')));

    if (!drag) {
      const pd = draftRef.current;
      if (pd && pd.kind === 'path' && pd.points?.length) {
        draftRef.current = { ...pd, points: [...pd.points.slice(0, -1), pathPoint(x, y, e.altKey)] };
        flushDraft();
        requestRender();
      }
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

    if (drag.mode === 'movelayer' || drag.mode === 'moveboard') {
      if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 3) return;
      drag.moved = true;
      let dx = x - drag.wx;
      let dy = y - drag.wy;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (drag.mode === 'movelayer' && layerMoveRef.current) layerMoveRef.current = { ...layerMoveRef.current, dx: r1(dx), dy: r1(dy) };
      else groupMoveRef.current = { ids: new Set(drag.ids || []), dx: r1(dx), dy: r1(dy) };
      requestRender();
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
        if (d.kind === 'line' || d.kind === 'arrow' || d.kind === 'gradient') {
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

    if (drag.mode === 'movelayer' || drag.mode === 'moveboard') {
      const off = drag.mode === 'movelayer' ? layerMoveRef.current : groupMoveRef.current;
      if (drag.moved && off && !cancelled && drag.ids?.length) applyTranslate(drag.ids, off.dx, off.dy);
      layerMoveRef.current = null;
      groupMoveRef.current = null;
      requestRender();
      return;
    }

    if (drag.mode === 'draw' || drag.mode === 'shape') {
      let d = draftRef.current;
      draftRef.current = null;
      const symC = symCenterRef.current;
      symCenterRef.current = null;
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
      if (d.kind === 'artboard') {
        const bw = Math.abs(d.w || 0);
        const bh = Math.abs(d.h || 0);
        if (bw < 8 || bh < 8) {
          socket?.emit('wb:draft', { channelId, cancel: true, id: d.id });
          requestRender();
          return;
        }
        d = {
          ...d,
          x: r1(Math.min(d.x || 0, (d.x || 0) + (d.w || 0))),
          y: r1(Math.min(d.y || 0, (d.y || 0) + (d.h || 0))),
          w: r1(bw),
          h: r1(bh),
          x2: undefined,
          y2: undefined,
        };
        commitElement(d);
        setSelectedId(d.id);
        return;
      }
      if (symC && symmetry !== 'off' && d.kind !== 'gradient') commitGroup([d, ...mirrorCopies(d, symmetry, symC.x, symC.y, newId)]);
      else commitElement(d);
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
      if ((e.target as Element | null)?.closest?.('[data-wb-ui]')) return;
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
    if (mod && (k === 'z' || k === 'y')) {
      e.preventDefault();
      if (k === 'y' || e.shiftKey) redo();
      else undo();
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
    if (e.key === 'Enter' && draftRef.current?.kind === 'path') {
      e.preventDefault();
      finishPath(false);
      return;
    }
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

  /* ---------------------------------------------------------------- animação */

  const artboards = useMemo(() => wb.elements.filter((e) => e.kind === 'artboard'), [wb.elements]);
  const artboardIds = useMemo(() => new Set(artboards.map((a) => a.id)), [artboards]);
  const animBoard = useMemo(() => artboards.find((a) => a.id === animBoardId) || null, [artboards, animBoardId]);
  const animFrames = useMemo(() => (animBoard ? wb.layers.filter((l) => l.anim === animBoard.id) : []), [wb.layers, animBoard]);

  // escolher um quadro (pela linha do tempo ou pela camada ativa) mostra esse quadro
  useEffect(() => {
    if (playingRef.current) return;
    const l = wb.layers.find((x) => x.id === activeLayerId);
    if (!l?.anim || !artboardIds.has(l.anim)) return;
    const idx = wb.layers.filter((x) => x.anim === l.anim).findIndex((x) => x.id === l.id);
    if (animBoardRef.current !== l.anim) setAnimBoardId(l.anim);
    if (idx !== -1 && idx !== animFrameRef.current) setAnimFrame(idx);
  }, [activeLayerId, wb.layers, artboardIds, setAnimFrame]);

  useEffect(() => {
    if (!playing) return;
    if (!animBoard || animFrames.length < 2) {
      setPlaying(false);
      return;
    }
    const fps = clamp(animBoard.fps || 12, 1, 60);
    const n = animFrames.length;
    const t = window.setInterval(() => {
      setAnimFrame((animFrameRef.current + 1) % n);
      requestRenderRef.current();
    }, 1000 / fps);
    return () => window.clearInterval(t);
  }, [playing, animBoard, animFrames.length, setAnimFrame]);

  const openAnimation = () => {
    setAnimOpen((open) => {
      if (!open && !artboards.some((a) => a.id === animBoardRef.current)) {
        const pick = selectedEl?.kind === 'artboard' ? selectedEl : artboards[0];
        setAnimBoardId(pick ? pick.id : null);
      }
      return !open;
    });
  };

  const selectFrame = (i: number) => {
    const f = animFrames[i];
    if (!f) return;
    setPlaying(false);
    setAnimFrame(i);
    setActiveLayerId(f.id);
  };

  const addFrame = () => {
    if (!animBoard) return;
    if (wb.layers.length >= 160) return flash('Limite de 160 camadas/quadros.');
    const id = `layer-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const cur = animFrames[Math.min(animFrameRef.current, animFrames.length - 1)];
    const at = cur ? wb.layers.findIndex((l) => l.id === cur.id) + 1 : wb.layers.length;
    const next = wb.layers.slice();
    next.splice(at, 0, { id, name: `Quadro ${animFrames.length + 1}`, visible: true, locked: false, opacity: 1, anim: animBoard.id });
    updateLayers(next);
    setPlaying(false);
    setActiveLayerId(id);
  };

  const moveFrame = (dir: -1 | 1) => {
    const i = Math.min(animFrameRef.current, animFrames.length - 1);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= animFrames.length) return;
    const next = wb.layers.slice();
    const ia = next.findIndex((l) => l.id === animFrames[i].id);
    const ib = next.findIndex((l) => l.id === animFrames[j].id);
    [next[ia], next[ib]] = [next[ib], next[ia]];
    updateLayers(next);
    setAnimFrame(j);
    setActiveLayerId(animFrames[i].id);
  };

  const deleteFrame = () => {
    const i = Math.min(animFrameRef.current, animFrames.length - 1);
    const f = animFrames[i];
    if (!f) return;
    if (wb.layers.length <= 1) return flash('Precisa sobrar pelo menos uma camada.');
    deleteLayer(f.id);
    const rest = animFrames.filter((x) => x.id !== f.id);
    if (rest.length) {
      const ni = Math.max(0, i - 1);
      setAnimFrame(ni);
      setActiveLayerId(rest[ni].id);
    }
  };

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
    : effectiveTool === 'movelayer'
    ? 'move'
    : effectiveTool === 'text'
    ? 'text'
    : isBrush(effectiveTool) && size * view.z >= 4
    ? 'none'
    : 'crosshair';

  /** Refaz o desenho em miniatura (o mundo inteiro desenhado) */
  const rebuildMiniContent = () => {
    const st = wbRef.current;
    const dpr = window.devicePixelRatio || 1;
    const MW = MINI_W * dpr;
    const MH = MINI_H * dpr;
    let box = contentBounds() || DEFAULT_BOARD;
    const padX = Math.max(box.w * 0.08, 40);
    const padY = Math.max(box.h * 0.08, 40);
    box = { x: box.x - padX, y: box.y - padY, w: box.w + padX * 2, h: box.h + padY * 2 };
    const scale = Math.min(MW / box.w, MH / box.h);
    const ox = (MW - box.w * scale) / 2;
    const oy = (MH - box.h * scale) / 2;
    miniMapRef.current = { bx: box.x, by: box.y, scale, ox, oy };
    if (!miniContentRef.current) miniContentRef.current = document.createElement('canvas');
    const mc = miniContentRef.current;
    mc.width = MW;
    mc.height = MH;
    const mctx = mc.getContext('2d')!;
    mctx.fillStyle = st.background === 'light' ? '#ffffff' : '#141517';
    mctx.fillRect(0, 0, MW, MH);
    const mv: View = { x: ox - box.x * scale, y: oy - box.y * scale, z: scale };
    mctx.save();
    mctx.setTransform(mv.z, 0, 0, mv.z, mv.x, mv.y);
    for (const a of st.elements) {
      if (a.kind !== 'artboard') continue;
      mctx.fillStyle = a.color || '#ffffff';
      mctx.fillRect((a.x || 0) + (a.tx || 0), (a.y || 0) + (a.ty || 0), Math.abs(a.w || 0), Math.abs(a.h || 0));
    }
    mctx.restore();
    const tmp = document.createElement('canvas');
    tmp.width = MW;
    tmp.height = MH;
    const tctx = tmp.getContext('2d')!;
    const env = getEnv();
    const hiddenFrames = nonFirstFrames(st.layers, st.elements);
    for (const layer of st.layers) {
      if (!layer.visible || hiddenFrames.has(layer.id)) continue;
      const els = st.elements.filter((e) => e.layerId === layer.id && e.kind !== 'artboard');
      if (!els.length) continue;
      renderElements(tctx, els, mv, 1, env, null);
      mctx.globalAlpha = clamp(layer.opacity ?? 1, 0, 1);
      mctx.globalCompositeOperation = (layer.blend as GlobalCompositeOperation) || 'source-over';
      mctx.drawImage(tmp, 0, 0);
      mctx.globalAlpha = 1;
      mctx.globalCompositeOperation = 'source-over';
    }
  };

  drawMinimapRef.current = () => {
    const mini = miniRef.current;
    if (!showMinimapRef.current || !mini) return;
    const st = wbRef.current;
    const stamp = miniStampRef.current;
    const changed = stamp.els !== st.elements || stamp.layers !== st.layers || stamp.bg !== st.background || !miniContentRef.current;
    if (changed) {
      const now = performance.now();
      if (now - stamp.t > 500 || !miniContentRef.current) {
        miniStampRef.current = { els: st.elements, layers: st.layers, bg: st.background, t: now };
        rebuildMiniContent();
      } else if (!miniTimerRef.current) {
        miniTimerRef.current = window.setTimeout(() => {
          miniTimerRef.current = null;
          requestRenderRef.current();
        }, 520);
      }
    }
    const m = miniMapRef.current;
    const ctx = mini.getContext('2d');
    if (!ctx || !m || !miniContentRef.current) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, mini.width, mini.height);
    ctx.drawImage(miniContentRef.current, 0, 0);
    // retângulo do que estou vendo (preso às bordas se eu estiver longe do desenho)
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    const rx = m.ox + (-v.x / v.z - m.bx) * m.scale;
    const ry = m.oy + (-v.y / v.z - m.by) * m.scale;
    const rw = (w / v.z) * m.scale;
    const rh = (h / v.z) * m.scale;
    const cx = clamp(rx, -2, mini.width - 4);
    const cy = clamp(ry, -2, mini.height - 4);
    ctx.strokeStyle = '#5865f2';
    ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
    ctx.fillStyle = 'rgba(88,101,242,0.14)';
    const cw = Math.max(4, Math.min(rw, mini.width + 4 - cx) - (cx - rx));
    const ch = Math.max(4, Math.min(rh, mini.height + 4 - cy) - (cy - ry));
    ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeRect(cx, cy, cw, ch);
    // outras pessoas (pontinho na cor delas)
    for (const cur of Object.values(remoteCursorsRef.current)) {
      ctx.fillStyle = cur.color;
      const px = m.ox + (cur.x - m.bx) * m.scale;
      const py = m.oy + (cur.y - m.by) * m.scale;
      ctx.beginPath();
      ctx.arc(clamp(px, 3, mini.width - 3), clamp(py, 3, mini.height - 3), 3 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const miniGoTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const m = miniMapRef.current;
    if (!m) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - r.left) * dpr;
    const my = (e.clientY - r.top) * dpr;
    const wx = m.bx + (mx - m.ox) / m.scale;
    const wy = m.by + (my - m.oy) / m.scale;
    const v = viewRef.current;
    const { w, h } = sizeRef.current;
    setView({ x: w / 2 - wx * v.z, y: h / 2 - wy * v.z, z: v.z });
  };

  const zoomPct = view.z >= 0.1 ? Math.round(view.z * 100) : Math.round(view.z * 1000) / 10;
  const toolIsBrush = isBrush(tool);
  const toolIsShape = isShape(tool) || tool === 'path';
  const curTipObj = BUILTIN_BRUSHES.find((b) => b.id === tipId) || (wb.brushes || []).find((b) => b.id === tipId) || null;
  const curTipIsBuiltin = Boolean(curTipObj && BUILTIN_BRUSHES.includes(curTipObj));

  const iconBtn =
    'h-7 min-w-7 px-1.5 rounded-sm flex items-center justify-center gap-1.5 text-[var(--ps-text2)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-hover)] disabled:opacity-40 disabled:pointer-events-none cursor-pointer';


  /* ---------------------------------------------------------------- layout no estilo do Photoshop */
  const psBtn =
    'h-6 min-w-6 px-1 rounded-sm flex items-center justify-center gap-1 text-[var(--ps-text2)] hover:text-white hover:bg-[var(--ps-hover)] disabled:opacity-40 disabled:pointer-events-none cursor-pointer';
  const psField = 'h-6 px-1.5 bg-[var(--ps-input)] border border-black/40 rounded-sm text-[var(--ps-text)] outline-none';
  const setPick = (c: string) => (colorChip === 'bg' ? setColor2(c) : setColor(c));
  const selBoard = selectedEl?.kind === 'artboard' ? selectedEl : null;
  const docBounds = contentBounds();
  const animReady = Boolean(animBoard && animFrames.length);
  const openFx = () => {
    setShowPanel(true);
    setPropsTab('fx');
  };
  const setBackground = (bg: WhiteboardState['background']) => {
    setWb((p) => ({ ...p, background: bg }));
    socket?.emit('wb:background', { channelId, background: bg });
  };
  const setGuideMode = (g: GuideMode) => {
    setGuides(g);
    savePref('guides', g);
  };
  const toggleMinimap = () =>
    setShowMinimap((v) => {
      savePref('minimap', v ? '0' : '1');
      return !v;
    });
  const setFloat = (f: boolean) => {
    setLayersFloat(f);
    setShowLayers(true);
    savePref('layersFloat', f ? '1' : '0');
    if (!f) setShowPanel(true);
  };
  const pickTool = (id: Tool) => {
    setTool(id);
    if (id !== 'select') setSelectedId(null);
  };
  const toggleLayerFlag = (k: 'clip' | 'alphaLock' | 'locked' | 'visible') => {
    if (activeLayer) patchLayer(activeLayer.id, { [k]: !activeLayer[k] });
  };

  type MenuItem = { label: string; key?: string; run?: () => void; disabled?: boolean; checked?: boolean } | null;
  const MENUS: Array<[string, MenuItem[]]> = [
    [
      'Arquivo',
      [
        { label: 'Inserir imagem como camada nova…', key: 'Ctrl+V', run: () => imgInputRef.current?.click(), disabled: !canDraw },
        { label: 'Importar pincéis (PNG, GBR, Krita .bundle)…', run: () => tipInputRef.current?.click(), disabled: !canDraw },
        null,
        { label: 'Exportar PNG', run: () => exportPng() },
        { label: 'Exportar só a prancheta selecionada (PNG)', run: () => selBoard && exportPng(selBoard), disabled: !selBoard },
        { label: 'Exportar SVG (vetor)', run: () => exportSvg(selBoard) },
        { label: 'Exportar PSD (camadas)', run: () => exportPsd(selBoard), disabled: Boolean(exporting) },
        null,
        { label: 'Exportar animação como GIF', run: () => animBoard && exportGif(animBoard), disabled: !animReady || Boolean(exporting) },
        { label: 'Exportar animação como vídeo WebM', run: () => animBoard && exportWebm(animBoard), disabled: !animReady || Boolean(exporting) },
        { label: 'Exportar animação como PSD (quadros = camadas)', run: () => animBoard && exportPsd(animBoard), disabled: !animReady || Boolean(exporting) },
        null,
        { label: 'Fechar whiteboard', run: onClose },
      ],
    ],
    [
      'Editar',
      [
        { label: 'Desfazer', key: 'Ctrl+Z', run: undo, disabled: !canDraw },
        { label: 'Refazer', key: 'Ctrl+Shift+Z', run: redo, disabled: !canDraw },
        null,
        { label: 'Excluir seleção', key: 'Del', run: () => selectedEl && deleteElement(selectedEl.id), disabled: !canDraw || !selectedEl },
        { label: 'Vetorizar traço selecionado', run: () => selectedEl && vectorizeStroke(selectedEl), disabled: !canDraw || selectedEl?.kind !== 'stroke' },
        null,
        { label: 'Limpar a camada ativa', run: () => activeLayer && clearLayer(activeLayer.id), disabled: !canDraw || !activeLayer },
      ],
    ],
    [
      'Imagem',
      [
        ...CHANNELS.map(([v, label]): MenuItem => ({ label: `Ver canal: ${label}`, checked: channelView === v, run: () => setChannelView(v) })),
        null,
        ...(
          [
            ['dark', 'Fundo cinza'],
            ['light', 'Fundo branco'],
            ['grid', 'Fundo em grade'],
            ['transparent', 'Fundo transparente'],
          ] as const
        ).map(([v, label]): MenuItem => ({ label, checked: wb.background === v, disabled: !canDraw, run: () => setBackground(v) })),
        null,
        { label: 'Nova prancheta', key: 'P', run: () => pickTool('artboard'), disabled: !canDraw },
      ],
    ],
    [
      'Camada',
      [
        { label: 'Nova camada', run: addLayer, disabled: !canDraw },
        { label: 'Duplicar camada', run: () => activeLayer && duplicateLayer(activeLayer.id), disabled: !canDraw || !activeLayer },
        { label: 'Excluir camada', run: () => activeLayer && deleteLayer(activeLayer.id), disabled: !canDraw || !activeLayer || wb.layers.length <= 1 },
        {
          label: 'Mesclar com a camada de baixo',
          run: () => activeLayer && mergeDown(activeLayer.id),
          disabled: !canDraw || !activeLayer || wb.layers.indexOf(activeLayer) <= 0,
        },
        null,
        { label: 'Máscara de recorte', checked: Boolean(activeLayer?.clip), run: () => toggleLayerFlag('clip'), disabled: !canDraw || !activeLayer },
        { label: 'Travar pixels transparentes', checked: Boolean(activeLayer?.alphaLock), run: () => toggleLayerFlag('alphaLock'), disabled: !canDraw || !activeLayer },
        { label: 'Bloquear camada', checked: Boolean(activeLayer?.locked), run: () => toggleLayerFlag('locked'), disabled: !canDraw || !activeLayer },
        { label: 'Ocultar camada', checked: activeLayer ? !activeLayer.visible : false, run: () => toggleLayerFlag('visible'), disabled: !canDraw || !activeLayer },
        null,
        { label: 'Ajustes da camada…', run: openFx, disabled: !activeLayer },
      ],
    ],
    [
      'Selecionar',
      [
        { label: 'Ferramenta mover', key: 'V', run: () => pickTool('select') },
        { label: 'Desmarcar', key: 'Esc', run: () => setSelectedId(null), disabled: !selectedEl },
      ],
    ],
    [
      'Filtro',
      [
        ...FX_FIELDS.map(([, label]): MenuItem => ({ label: `${label}…`, run: openFx, disabled: !activeLayer })),
        null,
        {
          label: 'Zerar ajustes da camada',
          run: () => activeLayer && patchLayer(activeLayer.id, { fx: undefined }),
          disabled: !canDraw || !activeLayer || !hasFx(activeLayer.fx),
        },
      ],
    ],
    [
      'Exibir',
      [
        { label: 'Aumentar zoom', key: 'Ctrl +', run: () => zoomAt(1.25) },
        { label: 'Diminuir zoom', key: 'Ctrl −', run: () => zoomAt(1 / 1.25) },
        { label: 'Tamanho real (100%)', key: 'Ctrl 1', run: () => zoomAt(1 / viewRef.current.z) },
        { label: 'Enquadrar tudo', key: 'Ctrl 0', run: () => fitTo(contentBounds()) },
        { label: 'Enquadrar a prancheta selecionada', run: () => selBoard && fitTo(exportBounds(selBoard)), disabled: !selBoard },
        null,
        { label: 'Sem guias', checked: guides === 'off', run: () => setGuideMode('off') },
        { label: 'Guias em pontos', checked: guides === 'dots', run: () => setGuideMode('dots') },
        { label: 'Guias em linhas', checked: guides === 'lines', run: () => setGuideMode('lines') },
        null,
        { label: isFullscreen ? 'Sair da tela cheia' : 'Tela cheia', run: toggleFullscreen },
      ],
    ],
    [
      'Janela',
      [
        { label: 'Camadas', checked: showLayers, run: () => setShowLayers((v) => !v) },
        { label: 'Camadas flutuando sobre o desenho', checked: layersFloat, run: () => setFloat(!layersFloat) },
        { label: 'Cor, propriedades e ajustes', checked: showPanel, run: () => setShowPanel((v) => !v) },
        { label: 'Linha do tempo (animação)', checked: animOpen, run: openAnimation },
        { label: 'Minimapa', checked: showMinimap, run: toggleMinimap },
      ],
    ],
    ['Ajuda', [{ label: 'Atalhos do teclado', run: () => setShowHelp(true) }]],
  ];

  const renderMenuBar = () => (
    <div className="relative z-40 h-7 shrink-0 flex items-center bg-[var(--ps-panel)] border-b border-black/40 text-[12px] text-[var(--ps-text)]">
      <div className="w-8 h-7 flex items-center justify-center shrink-0">
        <span className="w-[18px] h-[18px] rounded-[3px] bg-[var(--ps-accent)] flex items-center justify-center text-white">
          <Brush className="w-3 h-3" />
        </span>
      </div>
      {MENUS.map(([name, items]) => (
        <div key={name} className="relative">
          <button
            type="button"
            className={`h-7 px-2 cursor-pointer ${menuOpen === name ? 'bg-[var(--ps-hover)] text-white' : 'hover:bg-[var(--ps-hover)]'}`}
            onPointerDown={(e) => {
              e.preventDefault();
              setMenuOpen((m) => (m === name ? null : name));
            }}
            onPointerEnter={() => {
              if (menuOpen && menuOpen !== name) setMenuOpen(name);
            }}
          >
            {name}
          </button>
          {menuOpen === name && (
            <div className="absolute left-0 top-7 min-w-[270px] py-1 bg-[var(--ps-menu)] border border-black/60 shadow-2xl">
              {items.map((it, i) =>
                it ? (
                  <button
                    key={i}
                    type="button"
                    disabled={it.disabled}
                    onClick={() => {
                      setMenuOpen(null);
                      it.run?.();
                    }}
                    className="relative w-full h-6 pl-6 pr-4 flex items-center gap-6 text-left cursor-pointer hover:bg-[var(--ps-accent)] hover:text-white disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {it.checked && <span className="absolute left-2">✓</span>}
                    <span className="flex-1 whitespace-nowrap">{it.label}</span>
                    {it.key && <span className="text-[var(--ps-mute)] whitespace-nowrap">{it.key}</span>}
                  </button>
                ) : (
                  <div key={i} className="my-1 h-px bg-black/40" />
                )
              )}
            </div>
          )}
        </div>
      ))}
      <div className="flex-1" />
      <button type="button" className={psBtn} disabled={!canDraw} onClick={undo} title="Desfazer (Ctrl Z)">
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
      <button type="button" className={psBtn} disabled={!canDraw} onClick={redo} title="Refazer (Ctrl Shift Z)">
        <Redo2 className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-4 bg-[var(--ps-sep)] mx-1" />
      <button type="button" className={psBtn} onClick={toggleFullscreen} title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>
        {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
      </button>
      <button type="button" className={`${psBtn} hover:!bg-[#e81123] mr-1`} onClick={onClose} title="Fechar (o desenho continua salvo na call)">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  const renderDocTab = () => (
    <div className="h-[26px] shrink-0 flex items-end bg-[var(--ps-bar)] border-b border-black/40 px-1">
      <div className="h-6 pl-3 pr-2 flex items-center gap-2 bg-[var(--ps-panel)] text-[11px] text-[var(--ps-text)] border-t border-[var(--ps-accent)]">
        <span className="whitespace-nowrap">
          {selBoard ? selBoard.text || 'Prancheta' : 'Whiteboard'} @ {zoomPct}% ({channelView === 'rgb' ? 'RGB' : CHANNELS.find((c) => c[0] === channelView)?.[1]}/8)
        </span>
        <button type="button" onClick={onClose} className="text-[var(--ps-mute)] hover:text-white cursor-pointer" title="Fechar">
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  const renderToolbar = () => (
    <div className="w-10 shrink-0 bg-[var(--ps-panel)] border-r border-black/40 py-1 flex flex-col items-center gap-px overflow-y-auto overflow-x-hidden">
      <div className="w-5 h-[3px] mb-1 border-y border-[var(--ps-sep)] shrink-0" />
      {TOOL_SLOTS.map((slot, si) => {
        const activeHere = slot.includes(effectiveTool);
        const shown = activeHere ? effectiveTool : slotPick[si] || slot[0];
        const item = TOOL_ITEM[shown];
        const enabled = canDraw || shown === 'hand' || shown === 'eyedropper';
        const openFly = (el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          setFlyout({ slot: si, x: r.right + 3, y: r.top });
        };
        const stopPress = () => {
          if (longPressRef.current) window.clearTimeout(longPressRef.current);
          longPressRef.current = null;
        };
        return (
          <React.Fragment key={si}>
            {(si === 3 || si === 8 || si === 11) && <div className="w-6 h-px bg-[var(--ps-sep)] my-1 shrink-0" />}
            <button
              type="button"
              disabled={!enabled}
              onClick={() => pickTool(shown)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (slot.length > 1) openFly(e.currentTarget);
              }}
              onPointerDown={(e) => {
                if (slot.length < 2 || e.button !== 0) return;
                const el = e.currentTarget;
                stopPress();
                longPressRef.current = window.setTimeout(() => openFly(el), 380);
              }}
              onPointerUp={stopPress}
              onPointerLeave={stopPress}
              title={`${item.label}${item.key ? ` (${item.key})` : ''}${slot.length > 1 ? ' · clique direito ou segure: outras do grupo' : ''}`}
              className={`relative w-8 h-8 shrink-0 rounded-sm flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:pointer-events-none [&>svg]:w-4 [&>svg]:h-4 ${
                activeHere ? 'bg-[var(--ps-input)] text-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.5)]' : 'text-[var(--ps-text2)] hover:bg-[var(--ps-hover)] hover:text-white'
              }`}
            >
              {item.icon}
              {slot.length > 1 && (
                <span className="absolute right-[3px] bottom-[3px] w-0 h-0 border-l-[4px] border-l-transparent border-b-[4px] border-b-[var(--ps-text2)]" />
              )}
            </button>
          </React.Fragment>
        );
      })}
      <div className="w-6 h-px bg-[var(--ps-sep)] my-1 shrink-0" />
      {/* cor de frente / de fundo (X troca, D padrão) */}
      <div className="relative w-8 h-10 shrink-0 mt-1">
        <button
          type="button"
          className="absolute left-0 top-0 w-3 h-3 cursor-pointer"
          onClick={() => {
            setColor('#ffffff');
            setColor2('#000000');
          }}
          title="Cores padrão (D)"
        >
          <span className="absolute left-0 top-0 w-2 h-2 bg-white border border-black/60" />
          <span className="absolute left-1 top-1 w-2 h-2 bg-black border border-white/60" />
        </button>
        <button
          type="button"
          className="absolute right-0 top-0 text-[var(--ps-text2)] hover:text-white cursor-pointer"
          onClick={() => {
            setColor(color2);
            setColor2(color);
          }}
          title="Trocar cores (X)"
        >
          <ArrowLeftRight className="w-3 h-3" />
        </button>
        <label
          className="absolute right-0.5 bottom-0 w-5 h-5 border border-black/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] cursor-pointer"
          style={{ backgroundColor: color2 }}
          title="Cor de fundo"
        >
          <input type="color" value={parseHex(color2) ? color2 : '#000000'} onChange={(e) => setColor2(e.target.value)} className="sr-only" />
        </label>
        <label
          className="absolute left-0.5 top-3 w-5 h-5 border border-black/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] cursor-pointer"
          style={{ backgroundColor: color }}
          title="Cor de frente"
        >
          <input type="color" value={parseHex(color) ? color : '#ffffff'} onChange={(e) => setColor(e.target.value)} className="sr-only" />
        </label>
      </div>
      <div className="flex-1 min-h-2" />
      <button type="button" className={psBtn} onClick={() => setShowHelp(true)} title="Atalhos do teclado">
        <Keyboard className="w-4 h-4" />
      </button>
    </div>
  );

  function panelTabs<T extends string>(tabs: Array<[T, string]>, cur: T, set: (t: T) => void, extra?: React.ReactNode) {
    return (
      <div className="h-7 shrink-0 flex items-end gap-0.5 pl-1 pr-1 bg-[var(--ps-bar)] border-b border-black/40">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => set(id)}
            className={`h-6 px-2.5 text-[11px] cursor-pointer whitespace-nowrap ${
              cur === id ? 'bg-[var(--ps-panel)] text-white font-semibold' : 'text-[var(--ps-mute)] hover:text-[var(--ps-text)]'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        {extra && <div className="h-7 flex items-center">{extra}</div>}
      </div>
    );
  }

  const dragPicker = (e: React.PointerEvent<HTMLDivElement>, mode: 'sv' | 'hue') => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const apply = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      const cur = hsvRef.current;
      const n =
        mode === 'sv'
          ? { h: cur.h, s: clamp((cx - r.left) / r.width, 0, 1), v: clamp(1 - (cy - r.top) / r.height, 0, 1) }
          : { ...cur, h: clamp((cy - r.top) / r.height, 0, 1) * 359.9 };
      hsvRef.current = n;
      setHsv(n);
      setPick(hsvToHex(n));
    };
    apply(e.clientX, e.clientY);
    el.onpointermove = (ev) => apply(ev.clientX, ev.clientY);
    el.onpointerup = () => {
      el.onpointermove = null;
      el.onpointerup = null;
    };
  };

  const renderColorPanel = () => (
    <section className="shrink-0 border-b border-black/50">
      {panelTabs(
        [
          ['swatches', 'Amostras'],
          ['gradients', 'Gradientes'],
          ['color', 'Cor'],
        ],
        colorTab,
        setColorTab
      )}
      <div className="p-2">
        {colorTab === 'color' && (
          <div className="flex gap-2">
            <div className="relative w-8 h-8 shrink-0" title="Clique para escolher qual cor o seletor edita">
              <button
                type="button"
                onClick={() => setColorChip('bg')}
                className={`absolute right-0 bottom-0 w-5 h-5 border cursor-pointer ${colorChip === 'bg' ? 'border-white' : 'border-black/70'}`}
                style={{ backgroundColor: color2 }}
                title="Cor de fundo"
              />
              <button
                type="button"
                onClick={() => setColorChip('fg')}
                className={`absolute left-0 top-0 w-5 h-5 border cursor-pointer ${colorChip === 'fg' ? 'border-white' : 'border-black/70'}`}
                style={{ backgroundColor: color }}
                title="Cor de frente"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex gap-1.5 h-[150px]">
                <div
                  className="relative flex-1 cursor-crosshair touch-none"
                  style={{ background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
                  onPointerDown={(e) => dragPicker(e, 'sv')}
                >
                  <div
                    className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.7)] pointer-events-none"
                    style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
                  />
                </div>
                <div className="relative w-3.5 shrink-0 cursor-ns-resize touch-none" style={{ background: HUE_GRADIENT }} onPointerDown={(e) => dragPicker(e, 'hue')}>
                  <div
                    className="absolute -left-1 -right-1 h-[5px] -mt-[2.5px] border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.7)] pointer-events-none"
                    style={{ top: `${(hsv.h / 360) * 100}%` }}
                  />
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="text-[var(--ps-mute)]">#</span>
                <input
                  value={pickColorNow.replace('#', '')}
                  onChange={(e) => {
                    const v = e.target.value.trim().replace('#', '');
                    if (/^[0-9a-f]{0,6}$/i.test(v)) setPick(`#${v}`);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  spellCheck={false}
                  className={`${psField} w-[68px] font-mono uppercase`}
                />
                <span className="text-[var(--ps-mute)] tabular-nums truncate">
                  H {Math.round(hsv.h)}° S {Math.round(hsv.s * 100)}% B {Math.round(hsv.v * 100)}%
                </span>
              </div>
            </div>
          </div>
        )}
        {colorTab === 'swatches' && (
          <div className="grid grid-cols-12 gap-px">
            {PS_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setPick(c)}
                className={`aspect-square cursor-pointer border ${pickColorNow.toLowerCase() === c ? 'border-white' : 'border-black/40'}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        )}
        {colorTab === 'gradients' && (
          <div className="space-y-2">
            <div className="grid grid-cols-5 gap-1.5">
              {GRADIENT_PRESETS.map((g) => {
                const a = g.a || color;
                const b = g.b || (g.toT ? 'transparent' : color2);
                return (
                  <button
                    key={g.name}
                    type="button"
                    disabled={!canDraw}
                    onClick={() => {
                      if (g.a) setColor(g.a);
                      if (g.b) setColor2(g.b);
                      setGradToTransparent(Boolean(g.toT));
                      pickTool('gradient');
                    }}
                    className="h-8 border border-black/60 cursor-pointer hover:border-white disabled:opacity-40"
                    style={{
                      background: `linear-gradient(to right, ${a}, ${b}), repeating-conic-gradient(#999 0% 25%, #666 0% 50%) 0 0 / 8px 8px`,
                    }}
                    title={g.name}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-1">
              {GRADIENT_TYPES.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setGradType(v)}
                  className={`h-6 px-2 rounded-sm cursor-pointer ${gradType === v ? 'bg-[var(--ps-accent)] text-white' : 'bg-[var(--ps-input)] text-[var(--ps-text2)] hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-2">
          <div className="text-[10px] text-[var(--ps-mute)] mb-1">Usadas recentemente</div>
          <div className="flex flex-wrap gap-[3px] min-h-[14px]">
            {recentColors.length ? (
              recentColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPick(c)}
                  className={`w-3.5 h-3.5 cursor-pointer border ${pickColorNow.toLowerCase() === c.toLowerCase() ? 'border-white' : 'border-black/60'}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))
            ) : (
              <span className="text-[10px] text-[var(--ps-dim)]">As cores que você usar aparecem aqui.</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );

  const psSection = (title: string, body: React.ReactNode) => (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 font-semibold text-[var(--ps-text)]">
        <ChevronDown className="w-3 h-3 text-[var(--ps-mute)]" />
        {title}
      </div>
      <div className="pl-4 space-y-1.5">{body}</div>
    </div>
  );

  const renderPropsPanel = () => (
    <section className="flex-1 min-h-[140px] flex flex-col border-b border-black/50">
      {panelTabs(
        [
          ['props', 'Propriedades'],
          ['fx', 'Ajustes'],
        ],
        propsTab,
        setPropsTab
      )}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
        {propsTab === 'props' ? (
          <>
            <div className="flex items-center gap-1.5 text-[var(--ps-text)]">
              {selBoard ? <Frame className="w-3.5 h-3.5" /> : <FileImage className="w-3.5 h-3.5" />}
              <span className="truncate">
                {selBoard ? `Prancheta: ${selBoard.text || 'Prancheta'}` : selectedEl ? `${KIND_LABEL[selectedEl.kind] || 'Elemento'} de ${selectedEl.authorName || '—'}` : 'Documento'}
              </span>
            </div>
            {psSection(
              selBoard ? 'Prancheta' : 'Tela',
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ['L', selBoard ? Math.abs(selBoard.w || 0) : docBounds?.w || 0],
                      ['X', selBoard ? (selBoard.x || 0) + (selBoard.tx || 0) : docBounds?.x || 0],
                      ['A', selBoard ? Math.abs(selBoard.h || 0) : docBounds?.h || 0],
                      ['Y', selBoard ? (selBoard.y || 0) + (selBoard.ty || 0) : docBounds?.y || 0],
                    ] as Array<[string, number]>
                  ).map(([k, val]) => (
                    <label key={k} className="flex items-center gap-1 text-[var(--ps-mute)]">
                      <span className="w-3">{k}</span>
                      <span className={`${psField} flex-1 min-w-0 flex items-center tabular-nums`}>{Math.round(val)} px</span>
                    </label>
                  ))}
                </div>
                <div className="text-[var(--ps-mute)]">Resolução: 72 pixels/polegada</div>
              </>
            )}
            {psSection(
              'Modo e fundo',
              <>
                <label className="flex items-center gap-2 text-[var(--ps-mute)]">
                  <span className="w-12">Canal</span>
                  <select value={channelView} onChange={(e) => setChannelView(e.target.value as ChannelView)} className={`${psField} flex-1 min-w-0 cursor-pointer`}>
                    {CHANNELS.map(([v, label]) => (
                      <option key={v} value={v}>
                        {v === 'rgb' ? 'Cor RGB' : label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[var(--ps-mute)]">
                  <span className="w-12">Fundo</span>
                  <select
                    value={wb.background}
                    disabled={!canDraw}
                    onChange={(e) => setBackground(e.target.value as WhiteboardState['background'])}
                    className={`${psField} flex-1 min-w-0 cursor-pointer`}
                  >
                    <option value="dark">Cinza</option>
                    <option value="light">Branco</option>
                    <option value="grid">Grade</option>
                    <option value="transparent">Transparente</option>
                  </select>
                </label>
              </>
            )}
            {psSection(
              'Réguas e grades',
              <div className="flex items-center gap-1">
                {(
                  [
                    ['off', 'Sem guias', <Square key="o" className="w-3.5 h-3.5" />],
                    ['dots', 'Guias em pontos', <Grid3x3 key="d" className="w-3.5 h-3.5" />],
                    ['lines', 'Guias em linhas', <LayoutGrid key="l" className="w-3.5 h-3.5" />],
                  ] as Array<[GuideMode, string, React.ReactNode]>
                ).map(([g, label, icon]) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGuideMode(g)}
                    title={label}
                    className={`w-7 h-6 rounded-sm flex items-center justify-center cursor-pointer ${
                      guides === g ? 'bg-[var(--ps-accent)] text-white' : 'bg-[var(--ps-input)] text-[var(--ps-text2)] hover:text-white'
                    }`}
                  >
                    {icon}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={toggleMinimap}
                  title="Minimapa"
                  className={`ml-2 h-6 px-2 rounded-sm flex items-center gap-1 cursor-pointer ${
                    showMinimap ? 'bg-[var(--ps-accent)] text-white' : 'bg-[var(--ps-input)] text-[var(--ps-text2)] hover:text-white'
                  }`}
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  Minimapa
                </button>
              </div>
            )}
            {psSection(
              'Ações rápidas',
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ['Exportar PNG', () => exportPng(selBoard || undefined), false],
                    ['Enquadrar', () => fitTo(selBoard ? exportBounds(selBoard) : contentBounds()), false],
                    ['Exportar SVG', () => exportSvg(selBoard), false],
                    ['Exportar PSD', () => exportPsd(selBoard), Boolean(exporting)],
                    ['Inserir imagem', () => imgInputRef.current?.click(), !canDraw],
                    ['Animação', openAnimation, false],
                  ] as Array<[string, () => void, boolean]>
                ).map(([label, run, dis]) => (
                  <button
                    key={label}
                    type="button"
                    disabled={dis}
                    onClick={run}
                    className="h-6 rounded-sm bg-[var(--ps-input)] border border-black/40 text-[var(--ps-text)] hover:bg-[var(--ps-hover)] cursor-pointer disabled:opacity-40"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : activeLayer ? (
          <>
            <div className="flex items-center gap-1.5 text-[var(--ps-text)]">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="truncate">Ajustes de “{activeLayer.name}”</span>
            </div>
                <div className="px-3 pb-2 space-y-1">
                  {FX_FIELDS.map(([k, label, min, max]) => {
                    const val = activeLayer.fx?.[k] ?? DEFAULT_FX[k];
                    return (
                      <label key={k} className="flex items-center gap-2 text-[var(--ps-text2)]">
                        <span className="w-20 shrink-0 truncate">{label}</span>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={k === 'blur' ? 0.5 : 1}
                          value={val}
                          disabled={!canDraw}
                          onChange={(e) => patchLayer(activeLayer.id, { fx: { ...DEFAULT_FX, ...activeLayer.fx, [k]: Number(e.target.value) } }, true)}
                          onDoubleClick={() => patchLayer(activeLayer.id, { fx: { ...DEFAULT_FX, ...activeLayer.fx, [k]: DEFAULT_FX[k] } })}
                          className="flex-1 min-w-0 accent-[var(--ps-accent)]"
                          title="Clique duplo volta ao normal"
                        />
                        <span className="w-8 text-right tabular-nums text-[var(--ps-mute)]">{val}</span>
                      </label>
                    );
                  })}
                  <button
                    type="button"
                    disabled={!canDraw || !hasFx(activeLayer.fx)}
                    onClick={() => patchLayer(activeLayer.id, { fx: undefined })}
                    className="h-6 px-2 rounded bg-[var(--ps-input)] text-[var(--ps-text2)] hover:text-white cursor-pointer disabled:opacity-40"
                  >
                    Zerar ajustes
                  </button>
                </div>
          </>
        ) : (
          <div className="text-[var(--ps-mute)]">Escolha uma camada.</div>
        )}
      </div>
    </section>
  );

  const setHidden = (next: string[]) => {
    setHiddenTips(next);
    savePref('hiddenTips', JSON.stringify(next));
  };
  const chooseTip = (id: string) => {
    setTipId(id);
    setTipSpacing(null);
    pickTool('custom');
  };
  const deleteTip = (b: WhiteboardBrushTip, builtin: boolean) => {
    if (builtin) {
      setHidden([...hiddenTips, b.id]);
    } else {
      if (!canDraw) return;
      socket?.emit('wb:brush-remove', { channelId, id: b.id });
    }
    if (tipId === b.id) setTipId(null);
  };
  const renderBrushesPanel = () => {
    const q = brushQuery.trim().toLowerCase();
    const match = (b: WhiteboardBrushTip) => !q || b.name.toLowerCase().includes(q);
    const room = (wb.brushes || []).filter(match);
    const builtin = BUILTIN_BRUSHES.filter((b) => !hiddenTips.includes(b.id) && match(b));
    const hiddenCount = BUILTIN_BRUSHES.filter((b) => hiddenTips.includes(b.id)).length;
    const tile = (b: WhiteboardBrushTip, isBuiltin: boolean) => (
      <div key={b.id} className="relative group/tip">
        <button
          type="button"
          onClick={() => chooseTip(b.id)}
          className={`w-full aspect-square rounded-sm bg-[#1a1a1a] border flex items-center justify-center cursor-pointer ${
            tipId === b.id && tool === 'custom' ? 'border-[var(--ps-accent)] ring-1 ring-[var(--ps-accent)]' : 'border-black/50 hover:border-white'
          }`}
          title={b.name}
        >
          <img src={b.tip} alt="" draggable={false} className="w-[80%] h-[80%] object-contain" />
        </button>
        {(isBuiltin || canDraw) && (
          <button
            type="button"
            onClick={() => deleteTip(b, isBuiltin)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#f23f42] text-white hidden group-hover/tip:flex items-center justify-center cursor-pointer shadow"
            title={isBuiltin ? `Esconder "${b.name}" (dá para restaurar)` : `Apagar "${b.name}" da sala`}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
    );
    return (
      <section data-wb-brushes className={`flex flex-col border-b border-black/50 ${brushesOpen ? 'flex-1 min-h-[150px]' : ''}`}>
        <div className="h-7 shrink-0 flex items-center gap-1 px-2 bg-[var(--ps-bar)] border-b border-black/40">
          <button
            type="button"
            onClick={() => {
              const next = !brushesOpen;
              setBrushesOpen(next);
              savePref('brushesOpen', next ? '1' : '0');
            }}
            className="flex items-center gap-1 font-semibold text-[var(--ps-strong)] cursor-pointer"
            title={brushesOpen ? 'Recolher' : 'Mostrar'}
          >
            <ChevronDown className={`w-3 h-3 text-[var(--ps-mute)] transition-transform ${brushesOpen ? '' : '-rotate-90'}`} />
            Pincéis
            <span className="font-normal text-[var(--ps-mute)]">({BUILTIN_BRUSHES.length - hiddenCount + (wb.brushes || []).length})</span>
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={!canDraw}
            onClick={() => brushPanelInputRef.current?.click()}
            className="h-5 px-1.5 rounded-sm flex items-center gap-0.5 text-[var(--ps-text2)] hover:text-white hover:bg-[var(--ps-hover)] cursor-pointer disabled:opacity-40"
            title="Importar pincéis: PNG, .gbr/.gih (GIMP/Krita) ou pacote .bundle do Krita"
          >
            <Plus className="w-3 h-3" />
            Importar
          </button>
          <input
            ref={brushPanelInputRef}
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.webp,.gbr,.gih,.bundle,.zip"
            className="hidden"
            onChange={(e) => {
              importTips(Array.from(e.target.files || []));
              e.target.value = '';
            }}
          />
        </div>
        {brushesOpen && (
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
            <div className="flex items-center gap-1 h-6 px-1.5 rounded-sm bg-[var(--ps-input)]">
              <Search className="w-3 h-3 text-[var(--ps-mute)]" />
              <input
                value={brushQuery}
                onChange={(e) => setBrushQuery(e.target.value)}
                placeholder="Buscar pincel"
                className="flex-1 min-w-0 bg-transparent outline-none text-[var(--ps-text)] placeholder:text-[var(--ps-dim)]"
              />
            </div>
            {room.length > 0 && (
              <div>
                <div className="text-[10px] text-[var(--ps-mute)] mb-1">Importados nesta sala</div>
                <div className="grid grid-cols-6 gap-1.5">{room.map((b) => tile(b, false))}</div>
              </div>
            )}
            <div>
              <div className="text-[10px] text-[var(--ps-mute)] mb-1 flex items-center">
                <span className="flex-1">Embutidos (CC0)</span>
                {hiddenCount > 0 && (
                  <button type="button" onClick={() => setHidden([])} className="text-[var(--ps-accent)] hover:underline cursor-pointer">
                    Restaurar {hiddenCount} escondido{hiddenCount > 1 ? 's' : ''}
                  </button>
                )}
              </div>
              {builtin.length ? (
                <div className="grid grid-cols-6 gap-1.5">{builtin.map((b) => tile(b, true))}</div>
              ) : (
                <div className="text-[10px] text-[var(--ps-dim)]">Nenhum pincel{q ? ' com esse nome' : ''}.</div>
              )}
            </div>
            <div className="text-[10px] text-[var(--ps-dim)] leading-snug">
              Clique para pintar com o pincel. Passe o mouse e clique no × para apagar. Embutidos: "60 free gimp / krita brushes" de rubberduck (OpenGameArt), domínio público.
            </div>
          </div>
        )}
      </section>
    );
  };

  const startPanelDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const st = {
      r: Math.min(layersPos.r, Math.max(0, sizeRef.current.w - LAYERS_W)),
      b: Math.min(layersPos.b, Math.max(0, sizeRef.current.h - LAYERS_H)),
    };
    let last = st;
    el.onpointermove = (ev) => {
      const { w, h } = sizeRef.current;
      last = { r: clamp(st.r - (ev.clientX - sx), 0, Math.max(0, w - LAYERS_W)), b: clamp(st.b - (ev.clientY - sy), 0, Math.max(0, h - 60)) };
      setLayersPos(last);
    };
    el.onpointerup = () => {
      el.onpointermove = null;
      el.onpointerup = null;
      savePref('layersPos', `${Math.round(last.r)},${Math.round(last.b)}`);
    };
  };

  const renderLayersPanel = (floating: boolean) => (
    <div className={`flex flex-col min-h-0 ${floating ? 'h-full' : 'flex-1'}`}>
      {floating && (
        <div className="h-[14px] shrink-0 flex items-center justify-end gap-1 px-1 bg-[var(--ps-bar)] cursor-move touch-none" onPointerDown={startPanelDrag} title="Arraste para mover">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setFloat(false)}
            className="text-[var(--ps-mute)] hover:text-white cursor-pointer"
            title="Encaixar no painel da direita"
          >
            <PanelRight className="w-3 h-3" />
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setShowLayers(false)}
            className="text-[var(--ps-mute)] hover:text-white cursor-pointer"
            title="Fechar (Janela › Camadas abre de novo)"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {panelTabs(
        [
          ['layers', 'Camadas'],
          ['channels', 'Canais'],
        ],
        layersTab,
        setLayersTab,
        !floating ? (
          <button type="button" className={psBtn} onClick={() => setFloat(true)} title="Soltar o painel (flutuante sobre o desenho)">
            <Layers className="w-3.5 h-3.5" />
          </button>
        ) : null
      )}
      {layersTab === 'layers' ? (
        <>
          <div className="px-1.5 pt-1.5 space-y-1.5 shrink-0">
            <label className={`${psField} flex items-center gap-1`}>
              <Search className="w-3 h-3 text-[var(--ps-mute)]" />
              <input
                value={layerQuery}
                onChange={(e) => setLayerQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Filtrar por nome"
                className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-[var(--ps-dim)]"
              />
            </label>
            {activeLayer && (
              <>
                <div className="flex items-center gap-1.5">
                  <select
                    value={activeLayer.blend || 'source-over'}
                    disabled={!canDraw}
                    onChange={(e) => patchLayer(activeLayer.id, { blend: e.target.value })}
                    className={`${psField} flex-1 min-w-0 cursor-pointer`}
                    title="Modo de mesclagem da camada"
                  >
                    {BLEND_MODES.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <span className="text-[var(--ps-mute)]">Opac.:</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    disabled={!canDraw}
                    value={Math.round((activeLayer.opacity ?? 1) * 100)}
                    onChange={(e) => patchLayer(activeLayer.id, { opacity: clamp(Number(e.target.value) / 100, 0, 1) }, true)}
                    onKeyDown={(e) => e.stopPropagation()}
                    className={`${psField} w-12 tabular-nums`}
                  />
                </div>
                <div className="flex items-center gap-0.5 text-[var(--ps-mute)]">
                  <span className="mr-1">Travar:</span>
                  {(
                    [
                      ['alphaLock', 'Travar pixels transparentes (pinta só onde já tem tinta)', <Grid3x3 key="a" className="w-3.5 h-3.5" />],
                      ['locked', 'Travar tudo', <Lock key="l" className="w-3.5 h-3.5" />],
                      ['clip', 'Máscara de recorte (só aparece onde a camada de baixo tem tinta)', <Link key="c" className="w-3.5 h-3.5" />],
                    ] as Array<['alphaLock' | 'locked' | 'clip', string, React.ReactNode]>
                  ).map(([k, title, icon]) => (
                    <button
                      key={k}
                      type="button"
                      disabled={!canDraw}
                      onClick={() => toggleLayerFlag(k)}
                      title={title}
                      className={`w-6 h-6 rounded-sm flex items-center justify-center cursor-pointer disabled:opacity-40 ${
                        activeLayer[k] ? 'bg-[var(--ps-accent)] text-white' : 'text-[var(--ps-text2)] hover:bg-[var(--ps-hover)] hover:text-white'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                  <div className="flex-1" />
                  <span className="text-[var(--ps-dim)]">{wb.layers.length} camadas</span>
                </div>
              </>
            )}
          </div>
              <div
                className="flex-1 min-h-0 overflow-y-auto mx-1.5 my-1.5 p-0.5 space-y-px bg-[var(--ps-input)] border border-black/40"
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
                  if (layer.anim && artboardIds.has(layer.anim)) return null; // quadros: na linha do tempo
                  if (layerQuery && !layer.name.toLowerCase().includes(layerQuery.toLowerCase())) return null;
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
                        active ? 'bg-[var(--ps-active)]' : 'hover:bg-[var(--ps-hover)]'
                      } ${layerDrag?.id === layer.id ? 'opacity-40' : ''}`}
                    >
                      {dropBefore && <div className="absolute -top-px left-1 right-1 h-0.5 bg-[var(--ps-accent)] rounded" />}
                      {dropAfter && <div className="absolute -bottom-px left-1 right-1 h-0.5 bg-[var(--ps-accent)] rounded" />}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (canDraw) updateLayers(wb.layers.map((l) => (l.id === layer.id ? { ...l, visible: !l.visible } : l)));
                        }}
                        className="p-1 text-[var(--ps-text2)] hover:text-white cursor-pointer"
                        title={layer.visible ? 'Ocultar' : 'Mostrar'}
                      >
                        {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-[var(--ps-dim)]" />}
                      </button>
                      {layer.clip && <span className="text-[var(--ps-mute)] -mr-1" title="Máscara de recorte">↳</span>}
                      <canvas
                        ref={(c) => {
                          if (c) thumbsRef.current.set(layer.id, c);
                          else thumbsRef.current.delete(layer.id);
                        }}
                        width={64}
                        height={36}
                        className="w-12 h-[27px] rounded-sm shrink-0 border border-black/40"
                        style={{
                          backgroundColor: wb.background === 'light' ? '#fff' : '#282828',
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
                          className="flex-1 min-w-0 h-6 px-1 rounded bg-[var(--ps-input)] text-white outline-none"
                        />
                      ) : (
                        <span
                          className={`flex-1 min-w-0 truncate ${active ? 'text-white' : 'text-[var(--ps-text2)]'}`}
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
                        className={`p-1 cursor-pointer ${layer.locked ? 'text-[#f0b232]' : 'text-[var(--ps-dim)] hover:text-[var(--ps-text2)]'}`}
                        title={layer.locked ? 'Desbloquear' : 'Bloquear'}
                      >
                        {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}

                {artboards
                  .filter((a) => wb.layers.some((l) => l.anim === a.id))
                  .map((a) => {
                    const n = wb.layers.filter((l) => l.anim === a.id).length;
                    const activeHere = activeLayer?.anim === a.id;
                    return (
                      <button
                        key={`anim-${a.id}`}
                        type="button"
                        onClick={() => {
                          setAnimBoardId(a.id);
                          setAnimOpen(true);
                          const first = wb.layers.find((l) => l.anim === a.id);
                          if (first && !activeHere) setActiveLayerId(first.id);
                        }}
                        className={`w-full flex items-center gap-2 pl-1.5 pr-1.5 py-1.5 rounded cursor-pointer text-left ${activeHere ? 'bg-[var(--ps-active)] text-white' : 'text-[var(--ps-text2)] hover:bg-[var(--ps-hover)]'}`}
                        title="Abrir a linha do tempo"
                      >
                        <Clapperboard className="w-3.5 h-3.5 shrink-0" />
                        <span className="flex-1 min-w-0 truncate">
                          {a.text || 'Prancheta'} · {n} quadro(s)
                        </span>
                      </button>
                    );
                  })}

                {/* fundo (como a camada "Fundo" do Photoshop) */}
                <div className="flex items-center gap-2 pl-1 pr-1.5 py-1 mt-1 rounded text-[var(--ps-mute)]">
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
                    className="h-6 bg-[var(--ps-input)] text-[var(--ps-text)] rounded px-1 outline-none cursor-pointer"
                  >
                    <option value="dark">Escuro</option>
                    <option value="light">Branco</option>
                    <option value="grid">Grade</option>
                    <option value="transparent">Transparente</option>
                  </select>
                </div>
              </div>
          <div className="h-7 shrink-0 px-1.5 flex items-center justify-end gap-0.5 border-t border-black/40">
            <button type="button" className={`${psBtn} ${activeLayer?.clip ? '!text-white' : ''}`} disabled={!canDraw || !activeLayer} onClick={() => toggleLayerFlag('clip')} title="Máscara de recorte">
              <Link className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className={`${psBtn} italic font-serif text-[12px] ${activeLayer && hasFx(activeLayer.fx) ? '!text-white' : ''}`}
              disabled={!activeLayer}
              onClick={openFx}
              title="Ajustes da camada"
            >
              fx
            </button>
            <button
              type="button"
              className={psBtn}
              disabled={!canDraw || !activeLayer || wb.layers.indexOf(activeLayer) <= 0}
              onClick={() => activeLayer && mergeDown(activeLayer.id)}
              title="Mesclar com a camada de baixo"
            >
              <Merge className="w-3.5 h-3.5" />
            </button>
            <button type="button" className={psBtn} disabled={!canDraw || !activeLayer} onClick={() => activeLayer && clearLayer(activeLayer.id)} title="Limpar a camada">
              <Eraser className="w-3.5 h-3.5" />
            </button>
            <button type="button" className={psBtn} disabled={!canDraw || !activeLayer} onClick={() => activeLayer && duplicateLayer(activeLayer.id)} title="Duplicar camada">
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button type="button" className={psBtn} disabled={!canDraw} onClick={addLayer} title="Nova camada">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className={`${psBtn} hover:!text-[#f23f42]`}
              disabled={!canDraw || wb.layers.length <= 1 || !activeLayer}
              onClick={() => activeLayer && deleteLayer(activeLayer.id)}
              title="Excluir camada"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-px">
          {CHANNELS.map(([v, label], i) => {
            const on = channelView === v || (channelView === 'rgb' && (v === 'r' || v === 'g' || v === 'b'));
            const sw = v === 'r' ? '#e53935' : v === 'g' ? '#43a047' : v === 'b' ? '#1e88e5' : v === 'alpha' ? '#ffffff' : v === 'luma' ? '#9e9e9e' : 'linear-gradient(135deg,#e53935,#43a047,#1e88e5)';
            return (
              <button
                key={v}
                type="button"
                onClick={() => setChannelView(v)}
                className={`w-full h-9 px-1.5 flex items-center gap-2 cursor-pointer text-left ${channelView === v ? 'bg-[var(--ps-active)] text-white' : 'hover:bg-[var(--ps-hover)]'}`}
              >
                <span className="w-4">{on ? <Eye className="w-3.5 h-3.5" /> : null}</span>
                <span className="w-10 h-7 border border-black/50" style={{ background: sw }} />
                <span className="flex-1">{label}</span>
                <span className="text-[var(--ps-dim)] tabular-nums">{i === 0 ? '' : `${i}`}</span>
              </button>
            );
          })}
          <div className="pt-1 px-1 text-[var(--ps-dim)]">Claro = mais daquele canal. Só muda a sua visualização.</div>
        </div>
      )}
    </div>
  );

  const renderRightSide = () => (
    <>
      <div className="w-9 shrink-0 bg-[var(--ps-panel)] border-l border-black/40 py-1.5 flex flex-col items-center gap-1">
        {(
          [
            ['Cor', <Palette key="c" className="w-4 h-4" />, () => { setShowPanel(true); setColorTab('color'); }, false],
            ['Camadas', <Layers key="l" className="w-4 h-4" />, () => setShowLayers((v) => !v), showLayers],
            ['Ajustes da camada', <SlidersHorizontal key="f" className="w-4 h-4" />, openFx, showPanel && propsTab === 'fx'],
            ['Linha do tempo (animação)', <Clapperboard key="a" className="w-4 h-4" />, openAnimation, animOpen],
            ['Minimapa', <MapIcon key="m" className="w-4 h-4" />, toggleMinimap, showMinimap],
            ['Pincéis', <Shapes key="b" className="w-4 h-4" />, () => { setShowPanel(true); setBrushesOpen(true); savePref('brushesOpen', '1'); pickTool('custom'); }, tool === 'custom'],
            ['Texto', <Type key="t" className="w-4 h-4" />, () => pickTool('text'), tool === 'text'],
          ] as Array<[string, React.ReactNode, () => void, boolean]>
        ).map(([title, icon, run, on]) => (
          <button
            key={title}
            type="button"
            onClick={run}
            title={title}
            className={`w-7 h-7 rounded-sm flex items-center justify-center cursor-pointer ${on ? 'bg-[var(--ps-input)] text-white' : 'text-[var(--ps-text2)] hover:bg-[var(--ps-hover)] hover:text-white'}`}
          >
            {icon}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setShowPanel((v) => !v)}
          title={showPanel ? 'Recolher painéis' : 'Mostrar painéis'}
          className="w-7 h-7 rounded-sm flex items-center justify-center text-[var(--ps-text2)] hover:bg-[var(--ps-hover)] hover:text-white cursor-pointer"
        >
          <PanelRight className="w-4 h-4" />
        </button>
      </div>
      {showPanel && (
        <aside data-wb-ui className="w-[264px] shrink-0 bg-[var(--ps-panel)] border-l border-black/40 flex flex-col min-h-0 text-[11px] text-[var(--ps-text)] overflow-hidden">
          {renderColorPanel()}
          {renderPropsPanel()}
          {renderBrushesPanel()}
          {!layersFloat && showLayers && <section className="flex-[1.4] min-h-[220px] flex flex-col">{renderLayersPanel(false)}</section>}
        </aside>
      )}
    </>
  );

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="relative flex-1 flex flex-col min-h-0 min-w-0 bg-[var(--ps-work)] rounded-lg overflow-hidden select-none outline-none"
      style={PS_VARS}
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
      {renderMenuBar()}
      {/* Barra de opções (muda conforme a ferramenta) */}
      <div className="h-9 shrink-0 px-1.5 flex items-center gap-1 bg-[var(--ps-panel)] border-b border-black/40 text-xs text-[var(--ps-text)] overflow-x-auto overflow-y-hidden">
        <div className="flex items-center gap-0.5 shrink-0" title={TOOL_LABEL[tool]}>
          <span className="w-7 h-7 flex items-center justify-center rounded-sm bg-[var(--ps-input)] border border-black/40 text-white [&>svg]:w-4 [&>svg]:h-4">
            {TOOL_ITEM[tool]?.icon}
          </span>
          <ChevronDown className="w-3 h-3 text-[var(--ps-mute)]" />
        </div>
        <span className="px-1 text-[var(--ps-strong)] whitespace-nowrap">{TOOL_LABEL[tool] || 'Whiteboard'}</span>
        <div className="w-px h-5 bg-[var(--ps-sep)] mx-1 shrink-0" />

        {(toolIsBrush || toolIsShape || tool === 'text') && (
          <label className="flex items-center gap-2 px-2 whitespace-nowrap" title="Tamanho ( [ e ] )">
            <span className="text-[var(--ps-text2)]">Tamanho</span>
            <input
              type="range"
              min={1}
              max={tool === 'text' ? 200 : 300}
              value={tool === 'text' ? fontSize : size}
              onChange={(e) => (tool === 'text' ? setFontSize(Number(e.target.value)) : setSize(Number(e.target.value)))}
              className="w-24 accent-[var(--ps-accent)]"
            />
            <span className="w-10 tabular-nums text-[var(--ps-mute)]">{tool === 'text' ? fontSize : size}px</span>
          </label>
        )}
        {(toolIsBrush || toolIsShape || tool === 'fill' || tool === 'gradient') && (
          <label className="flex items-center gap-2 px-2 whitespace-nowrap">
            <span className="text-[var(--ps-text2)]">Opacidade</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-20 accent-[var(--ps-accent)]"
            />
            <span className="w-9 tabular-nums text-[var(--ps-mute)]">{Math.round(opacity * 100)}%</span>
          </label>
        )}
        {tool === 'airbrush' && (
          <label className="flex items-center gap-2 px-2 whitespace-nowrap">
            <span className="text-[var(--ps-text2)]">Dureza</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={hardness}
              onChange={(e) => setHardness(Number(e.target.value))}
              className="w-16 accent-[var(--ps-accent)]"
            />
            <span className="w-9 tabular-nums text-[var(--ps-mute)]">{Math.round(hardness * 100)}%</span>
          </label>
        )}
        {toolIsBrush && (
          <>
            <label className="flex items-center gap-1.5 px-2 whitespace-nowrap cursor-pointer text-[var(--ps-text2)]" title="Pressão da caneta controla o tamanho">
              <input type="checkbox" checked={pressureSize} onChange={(e) => setPressureSize(e.target.checked)} className="accent-[var(--ps-accent)]" />
              Pressão: tamanho
            </label>
            <label className="flex items-center gap-1.5 px-2 whitespace-nowrap cursor-pointer text-[var(--ps-text2)]" title="Pressão da caneta controla a opacidade">
              <input type="checkbox" checked={pressureOpacity} onChange={(e) => setPressureOpacity(e.target.checked)} className="accent-[var(--ps-accent)]" />
              Pressão: opacidade
            </label>
          </>
        )}
        {(toolIsBrush || toolIsShape || tool === 'gradient') && tool !== 'eraser' && (
          <label className="flex items-center gap-2 px-2 whitespace-nowrap" title="Como a tinta se mistura com o que já está na camada">
            <span className="text-[var(--ps-text2)]">Modo</span>
            <select
              value={brushComp}
              onChange={(e) => setBrushComp(e.target.value)}
              disabled={Boolean(activeLayer?.alphaLock)}
              className="h-7 bg-[var(--ps-input)] text-[var(--ps-text)] rounded px-1.5 outline-none cursor-pointer disabled:opacity-50"
            >
              {BRUSH_MODES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            {activeLayer?.alphaLock && <span className="text-[#f0b232]">transparência travada</span>}
          </label>
        )}
        {tool === 'custom' && (
          <div className="flex items-center gap-1.5 px-1 whitespace-nowrap">
            <select
              value={tipId || ''}
              onChange={(e) => {
                setTipId(e.target.value || null);
                setTipSpacing(null);
              }}
              className="h-7 max-w-44 bg-[var(--ps-input)] text-[var(--ps-text)] rounded px-1.5 outline-none cursor-pointer"
              title="Pincéis embutidos e os importados nesta sala"
            >
              <option value="">Escolha o pincel…</option>
              <optgroup label="Embutidos (CC0)">
                {BUILTIN_BRUSHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
              {(wb.brushes || []).length > 0 && (
                <optgroup label="Importados nesta sala">
                  {(wb.brushes || []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setTipGrid((g) => (g ? null : { x: r.left, y: r.bottom + 4 }));
              }}
              className="w-7 h-7 rounded bg-[var(--ps-input)] border border-black/40 flex items-center justify-center cursor-pointer hover:border-white"
              title="Ver todos os pincéis"
            >
              {curTipObj ? <img src={curTipObj.tip} alt="" className="w-6 h-6 object-contain" /> : <Shapes className="w-4 h-4" />}
            </button>
            {tipGrid && (
              <>
                <div className="fixed inset-0 z-40" onPointerDown={() => setTipGrid(null)} />
                <div
                  data-wb-ui
                  className="fixed z-50 w-[372px] max-h-[360px] overflow-y-auto p-2 bg-[var(--ps-menu)] border border-black/60 shadow-2xl whitespace-normal"
                  style={{ left: Math.min(tipGrid.x, window.innerWidth - 384), top: tipGrid.y }}
                >
                  {(
                    [
                      ['Embutidos (CC0)', BUILTIN_BRUSHES],
                      ['Importados nesta sala', wb.brushes || []],
                    ] as Array<[string, WhiteboardBrushTip[]]>
                  ).map(([label, list]) =>
                    list.length ? (
                      <div key={label} className="mb-2">
                        <div className="text-[10px] text-[var(--ps-mute)] mb-1">{label}</div>
                        <div className="grid grid-cols-8 gap-1">
                          {list.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => {
                                setTipId(b.id);
                                setTipSpacing(null);
                                setTipGrid(null);
                              }}
                              className={`aspect-square rounded-sm bg-[#1a1a1a] border flex items-center justify-center cursor-pointer ${
                                tipId === b.id ? 'border-[var(--ps-accent)]' : 'border-black/50 hover:border-white'
                              }`}
                              title={b.name}
                            >
                              <img src={b.tip} alt="" className="w-[34px] h-[34px] object-contain" />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null
                  )}
                  <div className="text-[10px] text-[var(--ps-dim)]">Embutidos: "60 free gimp / krita brushes" de rubberduck (OpenGameArt), domínio público.</div>
                </div>
              </>
            )}
            <label className={`${iconBtn} border border-[var(--ps-sep)] ${!canDraw ? 'opacity-40 pointer-events-none' : ''}`} title="Importar pincéis: PNG, .gbr/.gih (GIMP/Krita) ou pacote .bundle do Krita">
              <Plus className="w-4 h-4" />
              Importar
              <input
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.webp,.gbr,.gih,.bundle,.zip"
                className="hidden"
                onChange={(e) => {
                  importTips(Array.from(e.target.files || []));
                  e.target.value = '';
                }}
              />
            </label>
            {curTipObj && (
              <>
                <label className="flex items-center gap-1.5 px-1">
                  <span className="text-[var(--ps-text2)]">Espaçamento</span>
                  <input
                    type="range"
                    min={0.02}
                    max={2}
                    step={0.02}
                    value={tipSpacing ?? curTipObj.spacing}
                    onChange={(e) => setTipSpacing(Number(e.target.value))}
                    className="w-16 accent-[var(--ps-accent)]"
                  />
                </label>
                <label className="flex items-center gap-1.5 px-1">
                  <span className="text-[var(--ps-text2)]">Variação</span>
                  <input type="range" min={0} max={1} step={0.05} value={tipJitter} onChange={(e) => setTipJitter(Number(e.target.value))} className="w-14 accent-[var(--ps-accent)]" />
                </label>
                <button
                  type="button"
                  className={`${iconBtn} hover:!text-[#f23f42] ${curTipIsBuiltin ? 'hidden' : ''}`}
                  disabled={!canDraw || curTipIsBuiltin}
                  onClick={() => socket?.emit('wb:brush-remove', { channelId, id: curTipObj.id })}
                  title="Tirar este pincel da sala (traços já feitos ficam redondos)"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        )}
        {tool === 'path' && (
          <span className="px-2 text-[var(--ps-mute)] whitespace-nowrap">Clique para pôr pontos (Alt: canto). Clique no 1º ponto para fechar; Enter ou clique duplo termina.</span>
        )}
        {(toolIsBrush || toolIsShape) && tool !== 'eraser' && tool !== 'path' && (
          <label className="flex items-center gap-1.5 px-2 whitespace-nowrap" title="Desenha espelhado (no centro da prancheta, se começar dentro de uma)">
            <FlipHorizontal2 className="w-4 h-4 text-[var(--ps-text2)]" />
            <select
              value={symmetry}
              onChange={(e) => {
                const m = e.target.value as SymmetryMode;
                if (m !== 'off' && symmetry === 'off') {
                  const v = viewRef.current;
                  const { w, h } = sizeRef.current;
                  symAxisRef.current = { x: r1((w / 2 - v.x) / v.z), y: r1((h / 2 - v.y) / v.z) };
                }
                setSymmetry(m);
              }}
              className="h-7 bg-[var(--ps-input)] text-[var(--ps-text)] rounded px-1.5 outline-none cursor-pointer"
            >
              <option value="off">Sem simetria</option>
              <option value="x">Espelho ↔</option>
              <option value="y">Espelho ↕</option>
              <option value="xy">4 lados</option>
            </select>
            {symmetry !== 'off' && (
              <button
                type="button"
                className="h-7 px-2 rounded bg-[var(--ps-input)] text-[var(--ps-text2)] hover:text-white cursor-pointer"
                onClick={() => {
                  const v = viewRef.current;
                  const { w, h } = sizeRef.current;
                  symAxisRef.current = { x: r1((w / 2 - v.x) / v.z), y: r1((h / 2 - v.y) / v.z) };
                  requestRender();
                }}
                title="Põe o eixo no meio da tela"
              >
                Centralizar eixo
              </button>
            )}
          </label>
        )}
        {tool === 'gradient' && (
          <>
            <select
              value={gradType}
              onChange={(e) => setGradType(e.target.value as WhiteboardGradientType)}
              className="h-7 mx-1 bg-[var(--ps-input)] text-[var(--ps-text)] rounded px-1.5 outline-none cursor-pointer"
              title="Tipo de degradê"
            >
              {GRADIENT_TYPES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <span
              className="w-16 h-5 rounded border border-black/40 shrink-0"
              style={{ background: `linear-gradient(90deg, ${color}, ${gradToTransparent ? 'transparent' : color2})` }}
              title="Cor principal → secundária (X troca)"
            />
            <label className="flex items-center gap-1.5 px-2 whitespace-nowrap cursor-pointer text-[var(--ps-text2)]">
              <input type="checkbox" checked={gradToTransparent} onChange={(e) => setGradToTransparent(e.target.checked)} className="accent-[var(--ps-accent)]" />
              Até transparente
            </label>
            <span className="px-1 text-[var(--ps-mute)] whitespace-nowrap">Arraste para definir a direção. Dentro de uma prancheta, preenche só ela.</span>
          </>
        )}
        {tool === 'artboard' && (
          <>
            <select
              value={artboardPreset}
              onChange={(e) => setArtboardPreset(e.target.value)}
              className="h-7 mx-1 bg-[var(--ps-input)] text-[var(--ps-text)] rounded px-1.5 outline-none cursor-pointer"
              title="Tamanho da prancheta"
            >
              {ARTBOARD_PRESETS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <span className="px-1 text-[var(--ps-mute)] whitespace-nowrap">
              {artboardPreset ? 'Clique para colocar.' : 'Arraste para criar.'} Arraste pelo nome para mover a tela com o que tem dentro (Alt: só a tela).
            </span>
          </>
        )}
        {tool === 'movelayer' && (
          <span className="px-2 text-[var(--ps-mute)] whitespace-nowrap">Arraste para mover tudo da camada ativa ({activeLayer?.name}). Shift trava na horizontal/vertical.</span>
        )}
        {(tool === 'rect' || tool === 'ellipse' || tool === 'path') && (
          <label className="flex items-center gap-1.5 px-2 whitespace-nowrap cursor-pointer text-[var(--ps-text2)]" title={tool === 'path' ? 'Preenche a curva quando ela é fechada' : undefined}>
            <input type="checkbox" checked={shapeFilled} onChange={(e) => setShapeFilled(e.target.checked)} className="accent-[var(--ps-accent)]" />
            Preenchido
          </label>
        )}
        {tool === 'fill' && (
          <label className="flex items-center gap-2 px-2 whitespace-nowrap">
            <span className="text-[var(--ps-text2)]">Tolerância</span>
            <input
              type="range"
              min={0}
              max={160}
              value={fillTolerance}
              onChange={(e) => setFillTolerance(Number(e.target.value))}
              className="w-20 accent-[var(--ps-accent)]"
            />
            <span className="w-7 tabular-nums text-[var(--ps-mute)]">{fillTolerance}</span>
          </label>
        )}
        {tool === 'select' && selectedEl && canDraw && selectedEl.kind === 'artboard' && (
          <div className="flex items-center gap-1.5">
            <input
              key={`${selectedEl.id}-${selectedEl.text}`}
              defaultValue={selectedEl.text || 'Prancheta'}
              onBlur={(e) => {
                const name = e.target.value.trim().slice(0, 60);
                if (name && name !== selectedEl.text) patchElement(selectedEl.id, { text: name });
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="w-32 h-7 px-2 rounded bg-[var(--ps-input)] text-[var(--ps-text)] outline-none"
              title="Nome da prancheta"
            />
            {(['w', 'h'] as const).map((k) => (
              <label key={k} className="flex items-center gap-1 text-[var(--ps-mute)]">
                {k === 'w' ? 'L' : 'A'}
                <input
                  key={`${selectedEl.id}-${k}-${selectedEl[k]}`}
                  type="number"
                  min={8}
                  max={50000}
                  defaultValue={Math.round(Math.abs(selectedEl[k] || 0))}
                  onBlur={(e) => {
                    const n = clamp(Math.round(Number(e.target.value) || 0), 8, 50000);
                    if (n !== Math.round(Math.abs(selectedEl[k] || 0))) patchElement(selectedEl.id, { [k]: n });
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  className="w-16 h-7 px-1.5 rounded bg-[var(--ps-input)] text-[var(--ps-text)] outline-none tabular-nums"
                />
              </label>
            ))}
            <label className="w-7 h-7 rounded border border-black/40 cursor-pointer" style={{ backgroundColor: selectedEl.color }} title="Cor do papel">
              <input type="color" value={selectedEl.color} onChange={(e) => patchElement(selectedEl.id, { color: e.target.value })} className="sr-only" />
            </label>
            <button type="button" className={iconBtn} onClick={() => exportPng(selectedEl)} title="Exportar só esta prancheta (PNG)">
              <Download className="w-4 h-4" />
            </button>
            <button type="button" className={`${iconBtn} hover:!text-[#f23f42]`} onClick={() => deleteElement(selectedEl.id)} title="Excluir a prancheta (o desenho fica)">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
        {tool === 'select' && selectedEl && canDraw && selectedEl.kind === 'gradient' && (
          <div className="flex items-center gap-1.5 mr-1">
            <select
              value={selectedEl.gradType || 'linear'}
              onChange={(e) => patchElement(selectedEl.id, { gradType: e.target.value as WhiteboardGradientType })}
              className="h-7 bg-[var(--ps-input)] text-[var(--ps-text)] rounded px-1.5 outline-none cursor-pointer"
            >
              {GRADIENT_TYPES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <label className="w-6 h-6 rounded border border-black/40 cursor-pointer" style={{ backgroundColor: selectedEl.color }} title="Cor inicial">
              <input type="color" value={selectedEl.color} onChange={(e) => patchElement(selectedEl.id, { color: e.target.value })} className="sr-only" />
            </label>
            <label className="w-6 h-6 rounded border border-black/40 cursor-pointer" style={{ backgroundColor: selectedEl.color2 || '#000000' }} title="Cor final">
              <input type="color" value={selectedEl.color2 || '#000000'} onChange={(e) => patchElement(selectedEl.id, { color2: e.target.value })} className="sr-only" />
            </label>
            <label className="flex items-center gap-1 text-[var(--ps-text2)] cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={(selectedEl.gradAlpha2 ?? 1) === 0}
                onChange={(e) => patchElement(selectedEl.id, { gradAlpha2: e.target.checked ? 0 : 1 })}
                className="accent-[var(--ps-accent)]"
              />
              Até transparente
            </label>
          </div>
        )}
        {tool === 'select' && selectedEl && canDraw && selectedEl.kind !== 'artboard' && (
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
              className="h-7 ml-1 bg-[var(--ps-input)] text-[var(--ps-text)] rounded px-1.5 outline-none cursor-pointer"
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
            {selectedEl.kind === 'stroke' && selectedEl.brush !== 'eraser' && (
              <button type="button" className={iconBtn} onClick={() => vectorizeStroke(selectedEl)} title="Vetorizar: o traço vira uma curva editável (sai em SVG)">
                <Spline className="w-4 h-4" />
              </button>
            )}
            {selectedEl.kind === 'path' && (
              <>
                <label className="flex items-center gap-1 px-1 text-[var(--ps-text2)] cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={Boolean(selectedEl.closed)} onChange={(e) => patchElement(selectedEl.id, { closed: e.target.checked })} className="accent-[var(--ps-accent)]" />
                  Fechada
                </label>
                <label className="flex items-center gap-1 px-1 text-[var(--ps-text2)] cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedEl.filled)}
                    disabled={!selectedEl.closed}
                    onChange={(e) => patchElement(selectedEl.id, { filled: e.target.checked })}
                    className="accent-[var(--ps-accent)]"
                  />
                  Preenchida
                </label>
              </>
            )}
            <button type="button" className={`${iconBtn} hover:!text-[#f23f42]`} onClick={() => deleteElement(selectedEl.id)} title="Excluir (Delete)">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
        {tool === 'select' && !selectedEl && (
          <span className="px-2 text-[var(--ps-mute)] whitespace-nowrap">Clique num item para mover. Imagens: puxe as alças para redimensionar e a bolinha de cima para girar.</span>
        )}

      </div>

      {renderDocTab()}
      <div className="flex-1 flex min-h-0">
        {renderToolbar()}

        {/* Área de desenho infinita */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div ref={viewportRef} className="flex-1 relative overflow-hidden min-h-0 bg-[var(--ps-work)]" style={{ cursor: cursorStyle }}>
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
              if (effectiveTool === 'path') {
                finishPath(false);
                return;
              }
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
              className="absolute z-30 bg-transparent outline-dashed outline-1 outline-[var(--ps-accent)] resize-none overflow-hidden p-0 m-0 leading-[1.25] placeholder:text-[var(--ps-mute)]/60"
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

          {showMinimap && (
            <canvas
              ref={miniRef}
              width={MINI_W * (window.devicePixelRatio || 1)}
              height={MINI_H * (window.devicePixelRatio || 1)}
              className="absolute top-2 right-2 z-20 rounded-md border border-black/50 shadow-lg cursor-pointer touch-none"
              style={{ width: MINI_W, height: MINI_H }}
              title="Minimapa: clique ou arraste para ir até lá"
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                miniDragRef.current = e.pointerId;
                miniGoTo(e);
              }}
              onPointerMove={(e) => {
                if (miniDragRef.current === e.pointerId) miniGoTo(e);
              }}
              onPointerUp={() => (miniDragRef.current = null)}
              onPointerCancel={() => (miniDragRef.current = null)}
              onWheel={(e) => e.stopPropagation()}
              data-wb-ui
            />
          )}

          {exporting && !animOpen && (
            <div className="absolute top-3 left-3 z-30 px-3 py-1.5 rounded bg-[var(--ps-pop)] text-xs text-[#f0b232] shadow-lg pointer-events-none">{exporting}</div>
          )}

          {notice && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded bg-[var(--ps-pop)] text-xs text-[var(--ps-text)] shadow-lg pointer-events-none">
              {notice}
            </div>
          )}
          {!canDraw && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded bg-[var(--ps-pop)]/90 text-xs text-[var(--ps-text2)] pointer-events-none">
              Você não tem permissão para desenhar aqui — só visualizar.
            </div>
          )}

          {layersFloat && showLayers && (
            <div
              data-wb-ui
              className="absolute z-20 flex flex-col bg-[var(--ps-panel)] border border-black/60 shadow-[0_8px_28px_rgba(0,0,0,0.55)] text-[11px] text-[var(--ps-text)]"
              style={{
                width: LAYERS_W,
                height: Math.min(LAYERS_H, Math.max(170, sizeRef.current.h - 16)),
                right: Math.min(layersPos.r, Math.max(0, sizeRef.current.w - LAYERS_W)),
                bottom: Math.min(layersPos.b, Math.max(0, sizeRef.current.h - LAYERS_H)),
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              {renderLayersPanel(true)}
            </div>
          )}
        </div>
          {animOpen && (
            <div
              className="shrink-0 relative bg-[var(--ps-panel)] border-t border-black/50 px-2 py-1.5 text-xs text-[var(--ps-text)] space-y-1.5"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <Clapperboard className="w-4 h-4 text-[var(--ps-text2)]" />
                <span className="font-semibold mr-1">Animação</span>
                {artboards.length ? (
                  <select
                    value={animBoard?.id || ''}
                    onChange={(e) => {
                      setPlaying(false);
                      setAnimBoardId(e.target.value || null);
                      setAnimFrame(0);
                    }}
                    className="h-7 bg-[var(--ps-input)] rounded px-1.5 outline-none cursor-pointer"
                  >
                    <option value="">Escolha a prancheta…</option>
                    {artboards.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.text || 'Prancheta'}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[var(--ps-mute)]">Crie uma prancheta (ferramenta P) — a animação acontece dentro dela.</span>
                )}
                {animBoard && animFrames.length === 0 && (
                  <button type="button" disabled={!canDraw} onClick={addFrame} className="h-7 px-2 rounded bg-[var(--ps-accent)] text-white cursor-pointer disabled:opacity-40">
                    Começar animação nesta prancheta
                  </button>
                )}
                {animBoard && animFrames.length > 0 && (
                  <>
                    <button type="button" className={iconBtn} onClick={() => selectFrame((animFrame - 1 + animFrames.length) % animFrames.length)} title="Quadro anterior">
                      <SkipBack className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className={`${iconBtn} ${playing ? '!text-white bg-[var(--ps-accent)]' : ''}`}
                      disabled={animFrames.length < 2}
                      onClick={() => {
                        if (playing) {
                          setPlaying(false);
                          const f = animFrames[Math.min(animFrameRef.current, animFrames.length - 1)];
                          if (f) setActiveLayerId(f.id);
                        } else setPlaying(true);
                      }}
                      title={playing ? 'Pausar' : 'Tocar'}
                    >
                      {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <button type="button" className={iconBtn} onClick={() => selectFrame((animFrame + 1) % animFrames.length)} title="Próximo quadro">
                      <SkipForward className="w-4 h-4" />
                    </button>
                    <label className="flex items-center gap-1 ml-1 text-[var(--ps-text2)]" title="Quadros por segundo (vale para todos)">
                      FPS
                      <input
                        key={`${animBoard.id}-${animBoard.fps}`}
                        type="number"
                        min={1}
                        max={60}
                        defaultValue={animBoard.fps || 12}
                        disabled={!canDraw}
                        onBlur={(e) => {
                          const f = clamp(Math.round(Number(e.target.value) || 12), 1, 60);
                          if (f !== (animBoard.fps || 12)) patchElement(animBoard.id, { fps: f });
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        className="w-12 h-7 px-1.5 rounded bg-[var(--ps-input)] outline-none tabular-nums"
                      />
                    </label>
                    <label className="flex items-center gap-1 ml-1 text-[var(--ps-text2)] cursor-pointer" title="Mostra quadros vizinhos transparentes (só na sua tela)">
                      <input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} className="accent-[var(--ps-accent)]" />
                      Papel de cebola
                    </label>
                    <div className="relative">
                      <button
                        type="button"
                        className={`${iconBtn} ${onionMenu ? '!text-white bg-[var(--ps-active)]' : ''}`}
                        onClick={() => setOnionMenu((v) => !v)}
                        title="Quais quadros aparecer, opacidade de cada um e cor"
                      >
                        <SlidersHorizontal className="w-4 h-4" />
                      </button>
                      {onionMenu && (
                        <div className="absolute bottom-10 left-0 z-30 w-[330px] p-3 rounded-lg bg-[var(--ps-pop)] border border-black/50 shadow-2xl space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">Papel de cebola</span>
                            <button type="button" className="text-[var(--ps-mute)] hover:text-white cursor-pointer" onClick={() => setOnionCfg(() => DEFAULT_ONION)}>
                              Padrão
                            </button>
                          </div>
                          <div className="text-[var(--ps-mute)]">Clique no número para mostrar/ocultar aquele quadro; a barra é a opacidade.</div>
                          <div className="flex items-end justify-between gap-1">
                            {ONION_OFFSETS.map((o) => {
                              const on = Boolean(onionCfg.on[o]);
                              const op = onionCfg.op[o] ?? 0.1;
                              const tintC = o < 0 ? onionCfg.prev : onionCfg.next;
                              return (
                                <React.Fragment key={o}>
                                  {o === 1 && (
                                    <div className="w-6 h-[104px] flex items-end justify-center pb-1.5 text-[10px] text-white font-bold" title="Quadro atual">
                                      0
                                    </div>
                                  )}
                                  <div className="flex flex-col items-center gap-1">
                                    <div
                                      className="relative w-5 h-20 rounded-sm bg-[#2a2a2a] cursor-ns-resize overflow-hidden"
                                      title={`Opacidade ${Math.round(op * 100)}%`}
                                      onPointerDown={(e) => {
                                        const el = e.currentTarget;
                                        el.setPointerCapture(e.pointerId);
                                        const setFrom = (cy: number) => {
                                          const r = el.getBoundingClientRect();
                                          const v = clamp(1 - (cy - r.top) / r.height, 0.02, 1);
                                          setOnionCfg((c) => ({ ...c, op: { ...c.op, [o]: Math.round(v * 100) / 100 }, on: { ...c.on, [o]: true } }));
                                        };
                                        setFrom(e.clientY);
                                        el.onpointermove = (ev) => setFrom(ev.clientY);
                                        el.onpointerup = () => {
                                          el.onpointermove = null;
                                          el.onpointerup = null;
                                        };
                                      }}
                                    >
                                      <div
                                        className="absolute left-0 right-0 bottom-0"
                                        style={{ height: `${op * 100}%`, backgroundColor: onionCfg.tint ? tintC : '#9a9a9a', opacity: on ? 0.9 : 0.25 }}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setOnionCfg((c) => ({ ...c, on: { ...c.on, [o]: !c.on[o] } }))}
                                      className={`w-6 h-6 rounded text-[10px] tabular-nums cursor-pointer ${on ? 'text-white' : 'bg-[#2a2a2a] text-[#777]'}`}
                                      style={on ? { backgroundColor: onionCfg.tint ? tintC : '#555' } : undefined}
                                    >
                                      {o > 0 ? `+${o}` : o}
                                    </button>
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <label className="flex items-center gap-1.5 text-[var(--ps-text2)] cursor-pointer">
                              <input type="checkbox" checked={onionCfg.tint} onChange={(e) => setOnionCfg((c) => ({ ...c, tint: e.target.checked }))} className="accent-[var(--ps-accent)]" />
                              Tingir
                            </label>
                            <label className="flex items-center gap-1 text-[var(--ps-mute)]" title="Cor dos quadros anteriores">
                              antes
                              <input type="color" value={onionCfg.prev} onChange={(e) => setOnionCfg((c) => ({ ...c, prev: e.target.value }))} className="w-6 h-5 bg-transparent cursor-pointer" />
                            </label>
                            <label className="flex items-center gap-1 text-[var(--ps-mute)]" title="Cor dos quadros seguintes">
                              depois
                              <input type="color" value={onionCfg.next} onChange={(e) => setOnionCfg((c) => ({ ...c, next: e.target.value }))} className="w-6 h-5 bg-transparent cursor-pointer" />
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="w-px h-5 bg-[var(--ps-sep)] mx-1" />
                    <button type="button" className={iconBtn} disabled={!canDraw} onClick={addFrame} title="Novo quadro vazio depois do atual">
                      <Plus className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className={iconBtn}
                      disabled={!canDraw}
                      onClick={() => animFrames[animFrame] && duplicateLayer(animFrames[animFrame].id)}
                      title="Duplicar o quadro atual"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button type="button" className={iconBtn} disabled={!canDraw || animFrame <= 0} onClick={() => moveFrame(-1)} title="Mover quadro para a esquerda">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button type="button" className={iconBtn} disabled={!canDraw || animFrame >= animFrames.length - 1} onClick={() => moveFrame(1)} title="Mover quadro para a direita">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button type="button" className={`${iconBtn} hover:!text-[#f23f42]`} disabled={!canDraw} onClick={deleteFrame} title="Apagar o quadro atual">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="flex-1" />
                    {exporting ? (
                      <span className="text-[#f0b232]">{exporting}</span>
                    ) : (
                      <>
                        <button type="button" className="h-7 px-2 rounded bg-[var(--ps-input)] hover:bg-[var(--ps-hover)] cursor-pointer" onClick={() => exportGif(animBoard)} title="GIF animado (até 720 px)">
                          GIF
                        </button>
                        <button type="button" className="h-7 px-2 rounded bg-[var(--ps-input)] hover:bg-[var(--ps-hover)] cursor-pointer" onClick={() => exportWebm(animBoard)} title="Vídeo WebM (até 1280 px)">
                          WebM
                        </button>
                        <button type="button" className="h-7 px-2 rounded bg-[var(--ps-input)] hover:bg-[var(--ps-hover)] cursor-pointer" onClick={() => exportPsd(animBoard)} title="PSD: cada quadro vira uma camada (Photoshop, Krita, GIMP)">
                          PSD
                        </button>
                      </>
                    )}
                  </>
                )}
                {!animFrames.length && <div className="flex-1" />}
                <button type="button" className={iconBtn} onClick={() => setAnimOpen(false)} title="Fechar a linha do tempo">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {animBoard && animFrames.length > 0 && (
                <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                  {animFrames.map((f, i) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => selectFrame(i)}
                      className={`shrink-0 w-9 h-9 rounded border tabular-nums cursor-pointer ${
                        i === animFrame ? 'bg-[var(--ps-accent)] border-[var(--ps-accent)] text-white' : 'bg-[var(--ps-input)] border-[var(--ps-sep)] text-[var(--ps-text2)] hover:text-white'
                      }`}
                      title={f.name}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <span className="pl-2 text-[var(--ps-mute)] whitespace-nowrap">
                    {animFrames.length} quadro(s) · {((animFrames.length / clamp(animBoard.fps || 12, 1, 60)) || 0).toFixed(2)} s · cada pessoa pode desenhar num quadro
                  </span>
                </div>
              )}
            </div>
          )}

        </div>
        {renderRightSide()}
      </div>

      {/* Barra de status */}
      <div className="h-[22px] shrink-0 px-2 flex items-center gap-3 bg-[var(--ps-bar)] border-t border-black/40 text-[11px] text-[var(--ps-mute)]">
        <span className="tabular-nums w-12">{zoomPct}%</span>
        <span className="tabular-nums whitespace-nowrap">
          {selBoard
            ? `${Math.round(Math.abs(selBoard.w || 0))} px × ${Math.round(Math.abs(selBoard.h || 0))} px`
            : docBounds
              ? `${Math.round(docBounds.w)} px × ${Math.round(docBounds.h)} px`
              : 'vazio'}
        </span>
        {cursorPos && <span className="tabular-nums text-[var(--ps-text2)] whitespace-nowrap">x {cursorPos.x} · y {cursorPos.y}</span>}
        <span className="truncate">Espaço: mover a tela · Ctrl+roda: zoom · Alt+clique: pegar cor · clique direito numa ferramenta: ver o grupo</span>
        <div className="flex-1" />
        {penActive && <span className="text-[#23a55a] whitespace-nowrap">Caneta detectada</span>}
        <span className="whitespace-nowrap">{activeLayer ? `Camada: ${activeLayer.name}` : ''}</span>
      </div>

      <input
        ref={imgInputRef}
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
      <input
        ref={tipInputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,.gbr,.gih,.bundle,.zip"
        className="hidden"
        onChange={(e) => {
          importTips(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />

      {menuOpen && <div className="fixed inset-0 z-30" onPointerDown={() => setMenuOpen(null)} />}

      {flyout && (
        <>
          <div
            className="fixed inset-0 z-40"
            onPointerDown={() => setFlyout(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setFlyout(null);
            }}
          />
          <div
            className="fixed z-50 py-1 min-w-[230px] bg-[var(--ps-menu)] border border-black/60 shadow-2xl text-[12px] text-[var(--ps-text)]"
            style={{ left: flyout.x, top: Math.min(flyout.y, window.innerHeight - TOOL_SLOTS[flyout.slot].length * 28 - 12) }}
          >
            {TOOL_SLOTS[flyout.slot].map((id) => {
              const it = TOOL_ITEM[id];
              return (
                <button
                  key={id}
                  type="button"
                  disabled={!canDraw && id !== 'hand' && id !== 'eyedropper'}
                  onClick={() => {
                    pickTool(id);
                    setSlotPick((pp) => ({ ...pp, [flyout.slot]: id }));
                    setFlyout(null);
                  }}
                  className={`w-full h-7 pl-1.5 pr-3 flex items-center gap-2 text-left cursor-pointer hover:bg-[var(--ps-accent)] hover:text-white disabled:opacity-40 [&>svg]:w-4 [&>svg]:h-4 ${
                    effectiveTool === id ? 'bg-[var(--ps-active)]' : ''
                  }`}
                >
                  <span className="w-2 text-[8px]">{effectiveTool === id ? '■' : ''}</span>
                  {it.icon}
                  <span className="flex-1 whitespace-nowrap">{it.label}</span>
                  {it.key && <span className="text-[var(--ps-mute)]">{it.key}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}

      {showHelp && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onPointerDown={() => setShowHelp(false)}>
          <div
            className="w-[540px] max-w-[92vw] max-h-[80vh] overflow-y-auto bg-[var(--ps-panel)] border border-black/60 shadow-2xl p-4 text-xs text-[var(--ps-text)]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center mb-3">
              <span className="font-semibold text-sm">Atalhos do teclado</span>
              <div className="flex-1" />
              <button type="button" className={psBtn} onClick={() => setShowHelp(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {[
                ...TOOL_GROUPS.flat()
                  .filter((t) => t.key)
                  .map((t) => [t.key!, t.label] as [string, string]),
                ['Espaço (segurar)', 'Mover a tela'],
                ['Ctrl + roda', 'Zoom no cursor'],
                ['Ctrl 0 / Ctrl 1', 'Enquadrar tudo / 100%'],
                ['[ e ]', 'Diminuir / aumentar o pincel'],
                ['X / D', 'Trocar cores / cores padrão'],
                ['Alt + clique', 'Pegar cor'],
                ['Shift', 'Linha reta / manter proporção'],
                ['Ctrl Z / Ctrl Shift Z', 'Desfazer / refazer'],
                ['Ctrl V', 'Colar imagem como camada nova'],
                ['Delete', 'Excluir o item selecionado'],
                ['Enter / Esc', 'Terminar / cancelar a curva'],
              ].map(([k, d]) => (
                <div key={k + d} className="flex items-center gap-2 py-0.5">
                  <span className="min-w-[92px] px-1.5 py-0.5 rounded-sm bg-[var(--ps-input)] border border-black/40 font-mono text-[11px] text-white">{k}</span>
                  <span className="text-[var(--ps-text2)]">{d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
