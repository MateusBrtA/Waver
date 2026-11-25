import React, { useCallback, useRef, useState } from 'react';

/** Largura de painel lembrada neste computador (conveniência local, não sincroniza). */
export function usePersistentWidth(key: string, def: number, min: number, max: number) {
  const [width, setWidthState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(key));
      return Number.isFinite(v) && v >= min && v <= max ? v : def;
    } catch {
      return def;
    }
  });
  const setWidth = useCallback(
    (n: number) => {
      const w = Math.round(Math.max(min, Math.min(max, n)));
      setWidthState(w);
      try {
        localStorage.setItem(key, String(w));
      } catch {}
    },
    [key, min, max]
  );
  return [width, setWidth] as const;
}

/**
 * Alça fina para arrastar a borda de um painel (como no Discord/VS Code).
 * side = lado do painel onde a alça fica. Clique duplo volta ao tamanho padrão.
 */
export const PanelResizer: React.FC<{
  side: 'left' | 'right';
  width: number;
  defaultWidth: number;
  onResize: (w: number) => void;
}> = ({ side, width, defaultWidth, onResize }) => {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [active, setActive] = useState(false);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Arraste para redimensionar · clique duplo para o padrão"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        setActive(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        onResize(start.current.w + (side === 'right' ? dx : -dx));
      }}
      onPointerUp={(e) => {
        start.current = null;
        setActive(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {}
      }}
      onDoubleClick={() => onResize(defaultWidth)}
      className={`absolute top-0 bottom-0 z-30 w-[6px] cursor-col-resize group ${side === 'right' ? '-right-[3px]' : '-left-[3px]'}`}
    >
      <div
        className={`absolute top-0 bottom-0 left-[2px] w-[2px] transition-colors ${
          active ? 'bg-[#5865f2]' : 'bg-transparent group-hover:bg-[#5865f2]/60'
        }`}
      />
    </div>
  );
};
