import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Palco da call com várias telas lado a lado (como no Discord): todas do mesmo tamanho, com divisórias que dá
// para arrastar para os lados, para cima/baixo (entre as linhas) e na diagonal (no cruzamento das duas). Arrastar
// até uma sumir foca a outra. A borda de baixo muda a altura do palco inteiro (o resto da call ocupa o que sobrar).
// Os quadros ficam SEMPRE no mesmo container e só mudam de posição por CSS: o player do YouTube e os <video> não
// são remontados (nada recarrega nem pisca preto).

export interface StageTile {
  key: string;
  content: React.ReactNode;
}

interface StageGridProps {
  tiles: StageTile[];
  /** quadro em foco (ocupa o palco todo); null ou fora da lista = grade */
  focusKey: string | null;
  /** peso de cada quadro na sua linha e de cada linha no palco (1 = tamanho igual) */
  weights: Record<string, number>;
  onWeightsChange: (weights: Record<string, number>) => void;
  /** a divisória foi arrastada até um quadro sumir: foca o que ficou */
  onCollapseTo: (key: string) => void;
  /** altura escolhida para o palco (px); null = automática */
  heightPx?: number | null;
  /** arrastar a borda de baixo (null = voltar à altura automática) */
  onHeightChange?: (px: number | null) => void;
  className?: string;
}

/** abaixo disso (fração da linha/coluna) o quadro "some" e o outro vira foco */
const MIN_SHARE = 0.08;
const NARROW_PX = 700;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function splitRows<T>(items: T[], narrow: boolean): T[][] {
  if (items.length === 0) return [];
  if (narrow) return items.map((it) => [it]);
  const rows = items.length <= 3 ? 1 : items.length <= 8 ? 2 : 3;
  const perRow = Math.ceil(items.length / rows);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) out.push(items.slice(i, i + perRow));
  return out;
}

interface ColDrag {
  a: string;
  b: string;
  wa: number;
  wb: number;
  rowWeight: number;
}
interface RowDrag {
  ka: string;
  kb: string;
  wa: number;
  wb: number;
  total: number;
  /** quadros de cada uma das duas linhas, com a faixa horizontal (%) de cada um */
  above: Array<{ key: string; left: number; right: number }>;
  below: Array<{ key: string; left: number; right: number }>;
}
interface DragState {
  col?: ColDrag;
  row?: RowDrag;
  height?: { start: number };
  startX: number;
  startY: number;
  widthPx: number;
  heightPx: number;
  left: number;
  startWeights: Record<string, number>;
  cursor: string;
}

export const StageGrid: React.FC<StageGridProps> = ({
  tiles,
  focusKey,
  weights,
  onWeightsChange,
  onCollapseTo,
  heightPx = null,
  onHeightChange,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const weightsRef = useRef(weights);
  weightsRef.current = weights;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW_PX));
    ro.observe(el);
    setNarrow(el.clientWidth < NARROW_PX);
    return () => ro.disconnect();
  }, []);

  const focused = focusKey && tiles.some((t) => t.key === focusKey) ? focusKey : null;
  const w = (key: string) => Math.max(0.01, weights[key] ?? 1);

  const rects = new Map<string, Rect>();
  const colHandles: Array<ColDrag & { left: number; top: number; height: number; row: number }> = [];
  const rowHandles: Array<RowDrag & { top: number }> = [];
  const corners: Array<{ key: string; left: number; top: number; col: ColDrag; row: RowDrag }> = [];
  if (focused) {
    rects.set(focused, { left: 0, top: 0, width: 100, height: 100 });
  } else {
    const rows = splitRows(
      tiles.map((t) => t.key),
      narrow
    );
    const n = rows.length;
    // peso de cada linha (a chave muda com o número de linhas: outra arrumação começa igual)
    const rowKey = (r: number) => `__r${n}:${r}`;
    const rw = (r: number) => Math.max(0.01, weights[rowKey(r)] ?? 1);
    const rowsTotal = rows.reduce((s, _row, r) => s + rw(r), 0);
    const spans: Array<Array<{ key: string; left: number; right: number }>> = [];
    let y = 0;
    rows.forEach((row, r) => {
      const rowWeight = row.reduce((s, k) => s + w(k), 0);
      const top = y;
      const height = (rw(r) / rowsTotal) * 100;
      y += height;
      let x = 0;
      const span: Array<{ key: string; left: number; right: number }> = [];
      row.forEach((k, i) => {
        const width = (w(k) / rowWeight) * 100;
        rects.set(k, { left: x, top, width, height });
        span.push({ key: k, left: x, right: x + width });
        x += width;
        if (i < row.length - 1) colHandles.push({ a: k, b: row[i + 1], wa: w(k), wb: w(row[i + 1]), rowWeight, left: x, top, height, row: r });
      });
      spans.push(span);
    });
    for (let r = 0; r < n - 1; r++) {
      rowHandles.push({
        ka: rowKey(r),
        kb: rowKey(r + 1),
        wa: rw(r),
        wb: rw(r + 1),
        total: rowsTotal,
        above: spans[r],
        below: spans[r + 1],
        top: rects.get(rows[r + 1][0])!.top,
      });
    }
    // cruzamentos: a divisória de uma linha encostando na divisória entre linhas = arraste na diagonal
    for (const c of colHandles) {
      const col: ColDrag = { a: c.a, b: c.b, wa: c.wa, wb: c.wb, rowWeight: c.rowWeight };
      const below = rowHandles[c.row];
      const above = rowHandles[c.row - 1];
      if (below) corners.push({ key: `c:${c.a}|${c.b}|b`, left: c.left, top: c.top + c.height, col, row: below });
      if (above) corners.push({ key: `c:${c.a}|${c.b}|t`, left: c.left, top: c.top, col, row: above });
    }
  }

  const endDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const startDrag = (e: React.PointerEvent, state: Omit<DragState, 'startX' | 'startY' | 'widthPx' | 'heightPx' | 'left' | 'startWeights'>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const box = containerRef.current?.getBoundingClientRect();
    dragRef.current = {
      ...state,
      startX: e.clientX,
      startY: e.clientY,
      widthPx: Math.max(1, box?.width || 1),
      heightPx: Math.max(1, box?.height || 1),
      left: box?.left || 0,
      startWeights: { ...weights },
    };
    setDrag(state.cursor);
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.height) {
        onHeightChange?.(Math.round(d.height.start + (e.clientY - d.startY)));
        return;
      }
      const next = { ...weightsRef.current };
      if (d.col) {
        const c = d.col;
        const dw = ((e.clientX - d.startX) / d.widthPx) * c.rowWeight;
        const na = c.wa + dw;
        const nb = c.wb - dw;
        if (na / c.rowWeight < MIN_SHARE || nb / c.rowWeight < MIN_SHARE) {
          // um dos dois sumiu: volta os tamanhos de antes do arraste (desfocar restaura) e foca o que ficou
          onWeightsChange(d.startWeights);
          onCollapseTo(na / c.rowWeight < MIN_SHARE ? c.b : c.a);
          endDrag();
          return;
        }
        next[c.a] = na;
        next[c.b] = nb;
      }
      if (d.row) {
        const r = d.row;
        const dw = ((e.clientY - d.startY) / d.heightPx) * r.total;
        const na = r.wa + dw;
        const nb = r.wb - dw;
        if (na / r.total < MIN_SHARE || nb / r.total < MIN_SHARE) {
          // uma linha inteira sumiu: foca a tela da linha que ficou que está debaixo do mouse
          const keep = na / r.total < MIN_SHARE ? r.below : r.above;
          const xPct = ((e.clientX - d.left) / d.widthPx) * 100;
          const hit = keep.find((s) => xPct >= s.left && xPct < s.right) || keep[0];
          onWeightsChange(d.startWeights);
          if (hit) onCollapseTo(hit.key);
          endDrag();
          return;
        }
        next[r.ka] = na;
        next[r.kb] = nb;
      }
      onWeightsChange(next);
    };
    const up = () => endDrag();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag, onWeightsChange, onCollapseTo, onHeightChange]);

  const hint = 'Arraste para mudar o tamanho (até o fim para focar uma tela). Duplo clique iguala.';

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      style={{
        ...(heightPx ? { height: heightPx, flex: '0 0 auto' } : null),
        ...(drag ? { cursor: drag, userSelect: 'none' } : null),
      }}
    >
      {tiles.map((t) => {
        const rect = rects.get(t.key);
        return (
          <div
            key={t.key}
            data-stage-tile={t.key}
            className="absolute p-1"
            style={
              rect
                ? {
                    left: `${rect.left}%`,
                    top: `${rect.top}%`,
                    width: `${rect.width}%`,
                    height: `${rect.height}%`,
                    transition: drag ? 'none' : 'left 160ms ease, top 160ms ease, width 160ms ease, height 160ms ease',
                  }
                : { display: 'none' }
            }
          >
            {t.content}
          </div>
        );
      })}
      {colHandles.map((h) => (
        <div
          key={`h:${h.a}|${h.b}`}
          role="separator"
          aria-orientation="vertical"
          title={hint}
          onPointerDown={(e) => startDrag(e, { col: h, cursor: 'col-resize' })}
          onDoubleClick={() => {
            const avg = (h.wa + h.wb) / 2;
            onWeightsChange({ ...weights, [h.a]: avg, [h.b]: avg });
          }}
          className="absolute z-20 w-3 -translate-x-1/2 cursor-col-resize group/handle flex items-center justify-center"
          style={{ left: `${h.left}%`, top: `${h.top}%`, height: `${h.height}%` }}
        >
          <div className="w-1 h-12 rounded-full bg-white/15 group-hover/handle:bg-[#5865f2] transition" />
        </div>
      ))}
      {rowHandles.map((h) => (
        <div
          key={`r:${h.ka}`}
          role="separator"
          aria-orientation="horizontal"
          title={hint}
          onPointerDown={(e) => startDrag(e, { row: h, cursor: 'row-resize' })}
          onDoubleClick={() => {
            const avg = (h.wa + h.wb) / 2;
            onWeightsChange({ ...weights, [h.ka]: avg, [h.kb]: avg });
          }}
          className="absolute z-20 left-0 right-0 h-3 -translate-y-1/2 cursor-row-resize group/handle flex items-center justify-center"
          style={{ top: `${h.top}%` }}
        >
          <div className="h-1 w-12 rounded-full bg-white/15 group-hover/handle:bg-[#5865f2] transition" />
        </div>
      ))}
      {corners.map((c) => (
        <div
          key={c.key}
          title={hint}
          onPointerDown={(e) => startDrag(e, { col: c.col, row: c.row, cursor: 'move' })}
          onDoubleClick={() => {
            const ac = (c.col.wa + c.col.wb) / 2;
            const ar = (c.row.wa + c.row.wb) / 2;
            onWeightsChange({ ...weights, [c.col.a]: ac, [c.col.b]: ac, [c.row.ka]: ar, [c.row.kb]: ar });
          }}
          className="absolute z-30 w-5 h-5 -translate-x-1/2 -translate-y-1/2 cursor-move group/handle flex items-center justify-center"
          style={{ left: `${c.left}%`, top: `${c.top}%` }}
        >
          <div className="w-2.5 h-2.5 rounded-full bg-white/25 group-hover/handle:bg-[#5865f2] transition" />
        </div>
      ))}
      {onHeightChange && (
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Arraste para mudar a altura do palco. Duplo clique volta ao automático."
          onPointerDown={(e) => startDrag(e, { height: { start: containerRef.current?.clientHeight || 300 }, cursor: 'row-resize' })}
          onDoubleClick={() => onHeightChange(null)}
          className="absolute z-20 left-1/4 right-1/4 bottom-0 h-3 translate-y-1/2 cursor-row-resize group/handle flex items-center justify-center"
        >
          <div className="h-1 w-16 rounded-full bg-white/15 group-hover/handle:bg-[#5865f2] transition" />
        </div>
      )}
    </div>
  );
};
