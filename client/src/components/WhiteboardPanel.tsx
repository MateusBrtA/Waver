import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Circle,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Grid,
  Highlighter,
  ImagePlus,
  Layers,
  Minus,
  MousePointer2,
  PaintBucket,
  PenTool,
  Pipette,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Type,
  Wind,
  X,
} from 'lucide-react';
import { Socket } from 'socket.io-client';
import {
  User,
  WhiteboardBrush,
  WhiteboardCursor,
  WhiteboardElement,
  WhiteboardLayer,
  WhiteboardPoint,
  WhiteboardState,
  WhiteboardTool,
} from '../types';

const BOARD_W = 1600;
const BOARD_H = 900;

const SWATCHES = [
  '#ffffff', '#000000', '#ef4444', '#f97316', '#facc15',
  '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getWorldCoords(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return { x: 0, y: 0 };
  return {
    x: Math.max(0, Math.min(BOARD_W, ((clientX - r.left) / r.width) * BOARD_W)),
    y: Math.max(0, Math.min(BOARD_H, ((clientY - r.top) / r.height) * BOARD_H)),
  };
}

function drawElementOnCtx(
  ctx: CanvasRenderingContext2D,
  el: WhiteboardElement,
  imgCache: Map<string, HTMLImageElement>,
  onImgLoaded: () => void
) {
  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, el.opacity ?? 1));

  if (el.kind === 'stroke' && el.points && el.points.length > 0) {
    const brush = el.brush || 'pen';
    const baseSize = Math.max(1, el.size || 6);
    if (brush === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
    }

    if (brush === 'airbrush') {
      const pts = el.points;
      const hardness = Math.max(0.05, Math.min(1, el.hardness ?? 0.25));
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const radius = Math.max(2, baseSize * (pt.p || 0.75) * 1.4);
        const grad = ctx.createRadialGradient(pt.x, pt.y, radius * hardness * 0.3, pt.x, pt.y, radius);
        grad.addColorStop(0, el.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (brush === 'spray') {
      const rand = mulberry32(el.seed || 1337);
      ctx.fillStyle = el.color;
      for (const pt of el.points) {
        const spread = baseSize * 1.8 * (pt.p || 0.8);
        const count = Math.max(6, Math.round(baseSize * 0.9));
        for (let k = 0; k < count; k++) {
          const ang = rand() * Math.PI * 2;
          const rad = rand() * spread;
          ctx.fillRect(pt.x + Math.cos(ang) * rad, pt.y + Math.sin(ang) * rad, 1.8, 1.8);
        }
      }
    } else if (brush === 'pixel') {
      const step = Math.max(4, Math.round(baseSize));
      ctx.fillStyle = el.color;
      for (const pt of el.points) {
        const gx = Math.floor(pt.x / step) * step;
        const gy = Math.floor(pt.y / step) * step;
        ctx.fillRect(gx, gy, step, step);
      }
    } else {
      if (brush === 'marker') {
        ctx.globalAlpha = Math.min(0.45, el.opacity ?? 0.45);
        ctx.lineCap = 'square';
      } else if (brush === 'calligraphy') {
        ctx.lineCap = 'butt';
      } else {
        ctx.lineCap = 'round';
      }
      ctx.lineJoin = 'round';
      ctx.strokeStyle = brush === 'eraser' ? '#000' : el.color;

      const pts = el.points;
      if (pts.length === 1) {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, Math.max(1, (baseSize * (pts[0].p || 0.75)) / 2), 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1];
          const cur = pts[i];
          const w = Math.max(1, baseSize * ((prev.p + cur.p) * 0.5 || 0.75));
          ctx.lineWidth = brush === 'calligraphy' ? Math.max(1.5, w * 0.85) : w;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(cur.x, cur.y);
          ctx.stroke();
        }
      }
    }
  } else if (el.kind === 'line' || el.kind === 'arrow') {
    const x1 = el.x || 0;
    const y1 = el.y || 0;
    const x2 = el.x2 || 0;
    const y2 = el.y2 || 0;
    ctx.strokeStyle = el.color;
    ctx.fillStyle = el.color;
    ctx.lineWidth = el.size || 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (el.kind === 'arrow') {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const headLen = Math.max(12, (el.size || 4) * 3.5);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(ang - Math.PI / 6), y2 - headLen * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(x2 - headLen * Math.cos(ang + Math.PI / 6), y2 - headLen * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
  } else if (el.kind === 'rect') {
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.size || 4;
    ctx.strokeRect(el.x || 0, el.y || 0, el.w || 0, el.h || 0);
  } else if (el.kind === 'ellipse') {
    const rx = Math.abs(el.w || 0) / 2;
    const ry = Math.abs(el.h || 0) / 2;
    const cx = (el.x || 0) + (el.w || 0) / 2;
    const cy = (el.y || 0) + (el.h || 0) / 2;
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.size || 4;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (el.kind === 'text' && el.text) {
    const fs = el.fontSize || 28;
    ctx.font = `700 ${fs}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = el.color;
    ctx.textBaseline = 'top';
    const lines = String(el.text).split('\n');
    lines.forEach((line, idx) => {
      ctx.fillText(line, el.x || 0, (el.y || 0) + idx * fs * 1.25);
    });
  } else if (el.kind === 'image' && el.dataUrl) {
    let img = imgCache.get(el.dataUrl);
    if (!img) {
      img = new Image();
      img.onload = onImgLoaded;
      img.src = el.dataUrl;
      imgCache.set(el.dataUrl, img);
    }
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, el.x || 0, el.y || 0, el.w || img.naturalWidth, el.h || img.naturalHeight);
    }
  }

  ctx.restore();
}

interface WhiteboardPanelProps {
  socket: Socket | null;
  channelId: string;
  user: User;
  canDraw: boolean;
  onClose: () => void;
}

export const WhiteboardPanel: React.FC<WhiteboardPanelProps> = ({
  socket,
  channelId,
  user,
  canDraw,
  onClose,
}) => {
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenLayersRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const [wbState, setWbState] = useState<WhiteboardState>({
    channelId,
    background: 'dark',
    layers: [{ id: 'layer-1', name: 'Camada 1', visible: true, locked: false, opacity: 1 }],
    elements: [],
    seq: 0,
  });
  const [activeLayerId, setActiveLayerId] = useState('layer-1');
  const [tool, setTool] = useState<WhiteboardTool>('pen');
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(6);
  const [opacity, setOpacity] = useState(1);
  const [hardness, setHardness] = useState(0.35);
  const [pressureSize, setPressureSize] = useState(true);
  const [pressureOpacity, setPressureOpacity] = useState(false);
  const [tabletActive, setTabletActive] = useState(false);

  const [showLayers, setShowLayers] = useState(false);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, WhiteboardCursor & { ts: number }>>({});
  const [draftEl, setDraftEl] = useState<WhiteboardElement | null>(null);
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number } | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const lastCursorSentRef = useRef(0);

  // Sync with Socket.IO room
  useEffect(() => {
    if (!socket || !channelId) return;
    socket.emit('wb:join', { channelId }, (res: { ok?: boolean; state?: WhiteboardState }) => {
      if (res?.state) {
        setWbState(res.state);
        if (res.state.layers?.[0]) setActiveLayerId(res.state.layers[0].id);
      }
    });

    const onState = (st: WhiteboardState) => {
      if (st.channelId === channelId) setWbState(st);
    };
    const onAdded = ({ channelId: ch, element }: { channelId: string; element: WhiteboardElement }) => {
      if (ch !== channelId) return;
      setWbState((prev) => {
        if (prev.elements.some((e) => e.id === element.id)) return prev;
        return { ...prev, elements: [...prev.elements, element] };
      });
    };
    const onUpdated = ({ channelId: ch, element }: { channelId: string; element: WhiteboardElement }) => {
      if (ch !== channelId) return;
      setWbState((prev) => ({
        ...prev,
        elements: prev.elements.map((e) => (e.id === element.id ? element : e)),
      }));
    };
    const onCursor = (cur: WhiteboardCursor) => {
      setRemoteCursors((prev) => ({ ...prev, [cur.socketId]: { ...cur, ts: Date.now() } }));
    };

    socket.on('wb:state', onState);
    socket.on('wb:element-added', onAdded);
    socket.on('wb:element-updated', onUpdated);
    socket.on('wb:cursor', onCursor);

    const pruneT = window.setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        const next: Record<string, WhiteboardCursor & { ts: number }> = {};
        let changed = false;
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.ts < 5000) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 2000);

    return () => {
      window.clearInterval(pruneT);
      socket.off('wb:state', onState);
      socket.off('wb:element-added', onAdded);
      socket.off('wb:element-updated', onUpdated);
      socket.off('wb:cursor', onCursor);
    };
  }, [socket, channelId]);

  const redrawCanvas = useCallback(() => {
    const disp = displayCanvasRef.current;
    if (!disp) return;
    const dctx = disp.getContext('2d');
    if (!dctx) return;

    dctx.clearRect(0, 0, BOARD_W, BOARD_H);

    // Background fill
    if (wbState.background === 'dark') {
      dctx.fillStyle = '#12151f';
      dctx.fillRect(0, 0, BOARD_W, BOARD_H);
    } else if (wbState.background === 'light') {
      dctx.fillStyle = '#f8fafc';
      dctx.fillRect(0, 0, BOARD_W, BOARD_H);
    } else if (wbState.background === 'grid') {
      dctx.fillStyle = '#141722';
      dctx.fillRect(0, 0, BOARD_W, BOARD_H);
      dctx.strokeStyle = 'rgba(255,255,255,0.06)';
      dctx.lineWidth = 1;
      for (let gx = 0; gx <= BOARD_W; gx += 40) {
        dctx.beginPath();
        dctx.moveTo(gx, 0);
        dctx.lineTo(gx, BOARD_H);
        dctx.stroke();
      }
      for (let gy = 0; gy <= BOARD_H; gy += 40) {
        dctx.beginPath();
        dctx.moveTo(0, gy);
        dctx.lineTo(BOARD_W, gy);
        dctx.stroke();
      }
    }

    const allEls = draftEl ? [...wbState.elements, draftEl] : wbState.elements;

    for (const layer of wbState.layers) {
      if (!layer.visible) continue;
      let off = offscreenLayersRef.current.get(layer.id);
      if (!off) {
        off = document.createElement('canvas');
        off.width = BOARD_W;
        off.height = BOARD_H;
        offscreenLayersRef.current.set(layer.id, off);
      }
      const octx = off.getContext('2d');
      if (!octx) continue;
      octx.clearRect(0, 0, BOARD_W, BOARD_H);

      for (const el of allEls) {
        if ((el.layerId || 'layer-1') !== layer.id) continue;
        drawElementOnCtx(octx, el, imgCacheRef.current, redrawCanvas);
      }

      dctx.save();
      dctx.globalAlpha = Math.max(0.05, Math.min(1, layer.opacity ?? 1));
      dctx.drawImage(off, 0, 0);
      dctx.restore();
    }
  }, [wbState, draftEl]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const insertImageFile = useCallback(
    (blob: Blob) => {
      if (!canDraw || !socket) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxW = 920;
          const scale = Math.min(1, maxW / img.width);
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          c.getContext('2d')?.drawImage(img, 0, 0, w, h);
          const dataUrl = c.toDataURL('image/webp', 0.86);
          const el: WhiteboardElement = {
            id: `wb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind: 'image',
            layerId: activeLayerId,
            color: '#fff',
            size: 1,
            opacity: 1,
            x: Math.round((BOARD_W - w) / 2),
            y: Math.round((BOARD_H - h) / 2),
            w,
            h,
            dataUrl,
            authorId: user.id,
            authorName: user.displayName,
            createdAt: Date.now(),
          };
          setWbState((p) => ({ ...p, elements: [...p.elements, el] }));
          socket.emit('wb:add-element', { channelId, element: el });
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(blob);
    },
    [canDraw, socket, channelId, activeLayerId, user.id, user.displayName]
  );

  // Paste images directly with Ctrl+V!
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            insertImageFile(f);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [insertImageFile]);

  const activeLayerObj = useMemo(
    () => wbState.layers.find((l) => l.id === activeLayerId) || wbState.layers[0],
    [wbState.layers, activeLayerId]
  );

  const emitCursor = (x: number, y: number, isDrawing: boolean) => {
    if (!socket) return;
    const now = performance.now();
    if (now - lastCursorSentRef.current < 32) return;
    lastCursorSentRef.current = now;
    socket.emit('wb:cursor', { channelId, x, y, size, tool, isDrawing });
  };

  const commitElement = (el: WhiteboardElement) => {
    setWbState((p) => (p.elements.some((x) => x.id === el.id) ? p : { ...p, elements: [...p.elements, el] }));
    socket?.emit('wb:add-element', { channelId, element: el });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    if (e.pointerType === 'pen') setTabletActive(true);
    const { x, y } = getWorldCoords(canvas, e.clientX, e.clientY);

    if (tool === 'eyedropper') {
      const ctx = canvas.getContext('2d');
      const px = ctx?.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      if (px) {
        const hex = `#${[px[0], px[1], px[2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
        setColor(hex);
        setTool('pen');
      }
      return;
    }

    if (!canDraw || activeLayerObj?.locked) return;

    if (tool === 'fill') {
      const el: WhiteboardElement = {
        id: `wb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'rect',
        layerId: activeLayerId,
        color,
        size: Math.max(BOARD_W, BOARD_H),
        opacity,
        x: BOARD_W / 2,
        y: BOARD_H / 2,
        w: 1,
        h: 1,
        authorId: user.id,
        authorName: user.displayName,
        createdAt: Date.now(),
      };
      commitElement(el);
      return;
    }

    if (tool === 'text') {
      setTextInputPos({ x, y });
      setTextDraft('');
      return;
    }

    if (tool === 'select') {
      // Find topmost image or text hit
      for (let i = wbState.elements.length - 1; i >= 0; i--) {
        const el = wbState.elements[i];
        if (el.kind === 'image' && x >= (el.x || 0) && x <= (el.x || 0) + (el.w || 0) && y >= (el.y || 0) && y <= (el.y || 0) + (el.h || 0)) {
          setDragTargetId(el.id);
          dragOffsetRef.current = { dx: x - (el.x || 0), dy: y - (el.y || 0) };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
        if (el.kind === 'text' && x >= (el.x || 0) - 8 && x <= (el.x || 0) + 320 && y >= (el.y || 0) - 8 && y <= (el.y || 0) + 60) {
          setDragTargetId(el.id);
          dragOffsetRef.current = { dx: x - (el.x || 0), dy: y - (el.y || 0) };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    const p = e.pointerType === 'pen' ? Math.max(0.08, e.pressure || 0.6) : 0.75;
    const effOpacity = pressureOpacity && e.pointerType === 'pen' ? Math.max(0.15, opacity * p) : opacity;
    const isBrush = ['pen', 'airbrush', 'marker', 'calligraphy', 'spray', 'pixel', 'eraser'].includes(tool);

    if (isBrush) {
      const pt: WhiteboardPoint = { x, y, p: pressureSize ? p : 0.8 };
      setDraftEl({
        id: `wb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'stroke',
        brush: tool as WhiteboardBrush,
        layerId: activeLayerId,
        color,
        size,
        opacity: effOpacity,
        hardness,
        points: [pt],
        seed: Math.floor(Math.random() * 999999),
        authorId: user.id,
        authorName: user.displayName,
        createdAt: Date.now(),
      });
    } else {
      setDraftEl({
        id: `wb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: tool as 'line' | 'arrow' | 'rect' | 'ellipse',
        layerId: activeLayerId,
        color,
        size,
        opacity,
        x,
        y,
        x2: x,
        y2: y,
        w: 0,
        h: 0,
        authorId: user.id,
        authorName: user.displayName,
        createdAt: Date.now(),
      });
    }
    emitCursor(x, y, true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    if (e.pointerType === 'pen') setTabletActive(true);

    const { x, y } = getWorldCoords(canvas, e.clientX, e.clientY);
    emitCursor(x, y, Boolean(draftEl));

    if (dragTargetId) {
      const nx = x - dragOffsetRef.current.dx;
      const ny = y - dragOffsetRef.current.dy;
      setWbState((prev) => ({
        ...prev,
        elements: prev.elements.map((el) => (el.id === dragTargetId ? { ...el, x: nx, y: ny } : el)),
      }));
      return;
    }

    if (!draftEl) return;

    if (draftEl.kind === 'stroke') {
      const coalesced = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() || [e.nativeEvent as PointerEvent];
      const newPts: WhiteboardPoint[] = coalesced.map((ce) => {
        const wc = getWorldCoords(canvas, ce.clientX, ce.clientY);
        const cp = ce.pointerType === 'pen' ? Math.max(0.08, ce.pressure || 0.6) : 0.75;
        return { x: wc.x, y: wc.y, p: pressureSize ? cp : 0.8 };
      });
      setDraftEl((prev) => (prev ? { ...prev, points: [...(prev.points || []), ...newPts] } : null));
    } else {
      setDraftEl((prev) =>
        prev
          ? {
              ...prev,
              x2: x,
              y2: y,
              w: x - (prev.x || 0),
              h: y - (prev.y || 0),
            }
          : null
      );
    }
  };

  const handlePointerUp = () => {
    if (dragTargetId) {
      const updated = wbState.elements.find((e) => e.id === dragTargetId);
      if (updated) socket?.emit('wb:update-element', { channelId, element: updated });
      setDragTargetId(null);
      return;
    }
    if (!draftEl) return;
    commitElement(draftEl);
    setDraftEl(null);
  };

  const handleCommitText = () => {
    if (!textInputPos || !textDraft.trim()) {
      setTextInputPos(null);
      return;
    }
    commitElement({
      id: `wb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'text',
      layerId: activeLayerId,
      color,
      size,
      opacity,
      x: textInputPos.x,
      y: textInputPos.y,
      text: textDraft.trim(),
      fontSize: Math.max(16, Math.min(84, size * 3)),
      authorId: user.id,
      authorName: user.displayName,
      createdAt: Date.now(),
    });
    setTextInputPos(null);
    setTextDraft('');
  };

  const handleDownloadPng = () => {
    const disp = displayCanvasRef.current;
    if (!disp) return;
    const link = document.createElement('a');
    link.download = `pulsecord-whiteboard-${Date.now()}.png`;
    link.href = disp.toDataURL('image/png');
    link.click();
  };

  const updateLayers = (next: WhiteboardLayer[]) => {
    setWbState((p) => ({ ...p, layers: next }));
    socket?.emit('wb:layers-update', { channelId, layers: next });
  };

  const TOOL_ITEMS: Array<{ id: WhiteboardTool; label: string; icon: React.ReactNode }> = [
    { id: 'select', label: 'Mover Texto / Imagem', icon: <MousePointer2 className="w-4 h-4" /> },
    { id: 'pen', label: 'Pincel / Caneta (Mesa)', icon: <PenTool className="w-4 h-4" /> },
    { id: 'airbrush', label: 'Aerógrafo Suave (Photoshop)', icon: <Wind className="w-4 h-4" /> },
    { id: 'marker', label: 'Marca-texto / Marcador', icon: <Highlighter className="w-4 h-4" /> },
    { id: 'calligraphy', label: 'Caneta Caligráfica', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'spray', label: 'Spray Tinta', icon: <Sparkles className="w-4 h-4 rotate-45" /> },
    { id: 'pixel', label: 'Pincel Pixel Art', icon: <Grid className="w-4 h-4" /> },
    { id: 'eraser', label: 'Borracha na Camada', icon: <Eraser className="w-4 h-4" /> },
    { id: 'line', label: 'Linha Reta', icon: <Minus className="w-4 h-4" /> },
    { id: 'arrow', label: 'Seta', icon: <ArrowUpRight className="w-4 h-4" /> },
    { id: 'rect', label: 'Retângulo', icon: <Square className="w-4 h-4" /> },
    { id: 'ellipse', label: 'Círculo / Elipse', icon: <Circle className="w-4 h-4" /> },
    { id: 'text', label: 'Adicionar Mensagem / Texto', icon: <Type className="w-4 h-4" /> },
    { id: 'eyedropper', label: 'Conta-gotas (Photoshop)', icon: <Pipette className="w-4 h-4" /> },
    { id: 'fill', label: 'Balde de Tinta', icon: <PaintBucket className="w-4 h-4" /> },
  ];

  return (
    <div className="flex-1 flex flex-col bg-[#0d0f17] rounded-lg border border-white/10 overflow-hidden relative select-none">
      {/* Top Photoshop Studio Bar */}
      <div className="px-3 py-2 bg-[#2b2d31] border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-white flex items-center gap-1.5 mr-1">
            🎨 Whiteboard Studio
          </span>
          {tabletActive && (
            <span className="text-[10px] font-bold bg-[#23a55a]/20 text-[#4ade80] px-2 py-0.5 rounded-full">
              Mesa Digitalizadora Ativa ✓
            </span>
          )}

          {/* Colors & Sliders */}
          <div className="flex items-center gap-1 bg-[#1e1f22] px-2 py-1 rounded-lg border border-white/5">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-5 h-5 bg-transparent border-0 cursor-pointer rounded"
              title="Cor personalizada"
            />
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-4 h-4 rounded-full cursor-pointer transition ${color === c ? 'ring-2 ring-white scale-110' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-[11px] text-[#dbdee1] bg-[#1e1f22] px-2.5 py-1 rounded-lg">
            <span>Tam: {size}px</span>
            <input type="range" min={1} max={64} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-16 accent-[#5865f2]" />
          </label>

          <label className="flex items-center gap-1.5 text-[11px] text-[#dbdee1] bg-[#1e1f22] px-2.5 py-1 rounded-lg">
            <span>Opac: {Math.round(opacity * 100)}%</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-14 accent-[#23a55a]"
            />
          </label>

          <label className="flex items-center gap-1.5 text-[11px] text-[#dbdee1] bg-[#1e1f22] px-2.5 py-1 rounded-lg" title="Dureza (Aerógrafo)">
            <span>Dur: {Math.round(hardness * 100)}%</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={hardness}
              onChange={(e) => setHardness(Number(e.target.value))}
              className="w-12 accent-[#f0b232]"
            />
          </label>

          <label className="flex items-center gap-1 text-[10px] text-[#949ba4] cursor-pointer" title="Usar pressão da caneta para variar a espessura">
            <input type="checkbox" checked={pressureSize} onChange={(e) => setPressureSize(e.target.checked)} className="accent-[#5865f2]" />
            Pressão Tam.
          </label>
          <label className="flex items-center gap-1 text-[10px] text-[#949ba4] cursor-pointer" title="Usar pressão da caneta para variar a opacidade">
            <input type="checkbox" checked={pressureOpacity} onChange={(e) => setPressureOpacity(e.target.checked)} className="accent-[#5865f2]" />
            Pressão Opac.
          </label>
        </div>

        {/* Right Actions: Image Paste/Upload, Layers, Undo, Clear, Download PNG */}
        <div className="flex items-center gap-1.5">
          <label
            className="px-2.5 py-1.5 rounded-lg bg-[#383a40] hover:bg-[#4e5058] text-[#dbdee1] hover:text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            title="Você também pode pressionar Ctrl+V direto na tela!"
          >
            <ImagePlus className="w-3.5 h-3.5" />
            Imagem / Ctrl+V
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) insertImageFile(f);
                e.target.value = '';
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => setShowLayers((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
              showLayers ? 'bg-[#5865f2] text-white' : 'bg-[#383a40] text-[#dbdee1] hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Camadas ({wbState.layers.length})
          </button>

          <button
            type="button"
            disabled={!canDraw}
            onClick={() => socket?.emit('wb:undo', { channelId })}
            className="p-1.5 rounded-lg bg-[#383a40] hover:bg-[#4e5058] text-[#dbdee1] disabled:opacity-40 cursor-pointer"
            title="Desfazer meu último traço"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={!canDraw}
            onClick={() => socket?.emit('wb:clear', { channelId })}
            className="p-1.5 rounded-lg bg-[#383a40] hover:bg-[#da373c] text-[#dbdee1] hover:text-white disabled:opacity-40 cursor-pointer"
            title="Limpar lousa inteira"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleDownloadPng}
            className="px-3 py-1.5 rounded-lg bg-[#23a55a] hover:bg-[#1a8245] text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            title="Baixar o desenho e mensagens como imagem PNG"
          >
            <Download className="w-3.5 h-3.5" />
            Baixar PNG
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#949ba4] hover:text-white hover:bg-white/10 cursor-pointer"
            title="Fechar Whiteboard (os desenhos continuam salvos na call)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Workspace: Left Vertical Toolbar + Responsive Canvas + Optional Layers Drawer */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        <div className="w-11 shrink-0 bg-[#2b2d31] border-r border-white/10 p-1 flex flex-col items-center gap-1 overflow-y-auto">
          {TOOL_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={!canDraw && item.id !== 'eyedropper'}
              onClick={() => setTool(item.id)}
              title={item.label}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition cursor-pointer disabled:opacity-35 ${
                tool === item.id ? 'bg-[#5865f2] text-white shadow' : 'text-[#949ba4] hover:bg-[#383a40] hover:text-white'
              }`}
            >
              {item.icon}
            </button>
          ))}
        </div>

        {/* Interactive Synced Canvas */}
        <div className="flex-1 flex items-center justify-center p-2 bg-[#111214] relative overflow-hidden">
          <div className="relative w-full h-full flex items-center justify-center">
            <canvas
              ref={displayCanvasRef}
              width={BOARD_W}
              height={BOARD_H}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="max-w-full max-h-full aspect-video rounded-lg border border-white/15 shadow-2xl touch-none cursor-crosshair bg-transparent"
              style={{
                backgroundImage:
                  wbState.background === 'transparent'
                    ? 'linear-gradient(45deg, #2b2d31 25%, transparent 25%), linear-gradient(-45deg, #2b2d31 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2b2d31 75%), linear-gradient(-45deg, transparent 75%, #2b2d31 75%)'
                    : undefined,
                backgroundSize: wbState.background === 'transparent' ? '24px 24px' : undefined,
              }}
            />

            {/* Remote Collaborators Colored Mouse Cursors */}
            {Object.values(remoteCursors).map((cur) => (
              <div
                key={cur.socketId}
                className="pointer-events-none absolute flex items-center gap-1 z-30 transition-all duration-75"
                style={{
                  left: `${(cur.x / BOARD_W) * 100}%`,
                  top: `${(cur.y / BOARD_H) * 100}%`,
                  transform: 'translate(-2px, -2px)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill={cur.color}>
                  <path d="M1 1 L13 7 L8 8.5 L6.5 14 Z" stroke="#000" strokeWidth="1.2" />
                </svg>
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white shadow whitespace-nowrap"
                  style={{ backgroundColor: cur.color }}
                >
                  {cur.displayName}
                </span>
              </div>
            ))}

            {/* Inline Text Input Box */}
            {textInputPos && (
              <div
                className="absolute z-40 bg-[#2b2d31] border-2 border-[#5865f2] rounded-lg p-1.5 shadow-2xl flex items-center gap-1"
                style={{
                  left: `${Math.min(80, (textInputPos.x / BOARD_W) * 100)}%`,
                  top: `${Math.min(82, (textInputPos.y / BOARD_H) * 100)}%`,
                }}
              >
                <input
                  type="text"
                  autoFocus
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCommitText();
                    if (e.key === 'Escape') setTextInputPos(null);
                  }}
                  placeholder="Digite sua mensagem..."
                  className="bg-[#1e1f22] text-white text-xs px-2.5 py-1 rounded outline-none w-48"
                />
                <button
                  type="button"
                  onClick={handleCommitText}
                  className="px-2 py-1 bg-[#23a55a] text-white rounded text-[11px] font-bold cursor-pointer"
                >
                  OK
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Photoshop-style Layers & Background Panel */}
        {showLayers && (
          <div className="w-60 shrink-0 bg-[#2b2d31] border-l border-white/10 p-3 flex flex-col gap-3 text-xs overflow-y-auto">
            <div className="space-y-1.5">
              <div className="font-bold uppercase tracking-wider text-[10px] text-[#949ba4]">Fundo do Quadro</div>
              <div className="grid grid-cols-2 gap-1">
                {(
                  [
                    ['dark', 'Escuro'],
                    ['light', 'Branco'],
                    ['grid', 'Grade'],
                    ['transparent', 'Transparente'],
                  ] as const
                ).map(([bg, lbl]) => (
                  <button
                    key={bg}
                    type="button"
                    disabled={!canDraw}
                    onClick={() => socket?.emit('wb:background', { channelId, background: bg })}
                    className={`py-1 px-2 rounded font-semibold cursor-pointer ${
                      wbState.background === bg ? 'bg-[#5865f2] text-white' : 'bg-[#383a40] text-[#dbdee1]'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-white/10">
              <span className="font-bold uppercase tracking-wider text-[10px] text-[#949ba4]">Camadas</span>
              <button
                type="button"
                disabled={!canDraw}
                onClick={() => {
                  const id = `layer-${Date.now().toString(36)}`;
                  updateLayers([...wbState.layers, { id, name: `Camada ${wbState.layers.length + 1}`, visible: true, locked: false, opacity: 1 }]);
                  setActiveLayerId(id);
                }}
                className="px-2 py-0.5 rounded bg-[#23a55a] text-white font-bold flex items-center gap-0.5 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                Nova
              </button>
            </div>

            <div className="space-y-1.5">
              {[...wbState.layers].reverse().map((layer) => (
                <div
                  key={layer.id}
                  onClick={() => setActiveLayerId(layer.id)}
                  className={`p-2 rounded-lg border cursor-pointer space-y-1.5 ${
                    activeLayerId === layer.id ? 'bg-[#5865f2]/20 border-[#5865f2]' : 'bg-[#0d0f17] border-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-white truncate">{layer.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateLayers(wbState.layers.map((l) => (l.id === layer.id ? { ...l, visible: !l.visible } : l)));
                        }}
                        className="p-1 text-[#949ba4] hover:text-white cursor-pointer"
                      >
                        {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      {wbState.layers.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rem = wbState.layers.filter((l) => l.id !== layer.id);
                            updateLayers(rem);
                            if (activeLayerId === layer.id && rem[0]) setActiveLayerId(rem[0].id);
                          }}
                          className="p-1 text-[#f23f42] hover:text-white cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={layer.opacity}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      updateLayers(wbState.layers.map((l) => (l.id === layer.id ? { ...l, opacity: Number(e.target.value) } : l)))
                    }
                    className="w-full accent-[#5865f2]"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
