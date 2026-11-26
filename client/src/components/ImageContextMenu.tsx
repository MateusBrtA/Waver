import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Download, ExternalLink, Link2, Star } from 'lucide-react';
import { isFavoriteGif, looksLikeGifUrl, toggleFavoriteGif } from '../lib/favoriteGifs';

type MenuState = { x: number; y: number; src: string; name: string } | null;

function fileNameFromSrc(src: string) {
  try {
    const u = new URL(src, window.location.href);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last || 'imagem';
  } catch {
    return 'imagem';
  }
}

/** Converte qualquer imagem (inclusive GIF/WebP) em PNG para a área de transferência. */
async function toPngBlob(src: string): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('load'));
    img.src = src;
  });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || 1;
  c.height = img.naturalHeight || 1;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/png'));
}

async function blobToDataUrl(b: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/**
 * Clique direito em imagens (anexos, GIFs, prévias) → copiar / salvar, como no Discord.
 * Imagens pequenas (avatares, ícones) e elementos com menu próprio ficam de fora.
 */
export const ImageContextMenu: React.FC<{ onNotify: (msg: string, kind?: 'error' | 'info') => void }> = ({ onNotify }) => {
  const [menu, setMenu] = useState<MenuState>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (!(t instanceof HTMLImageElement)) return;
      if (t.closest('[data-no-image-menu]')) return;
      const r = t.getBoundingClientRect();
      if (r.width < 56 || r.height < 56) return;
      const src = t.currentSrc || t.src;
      if (!src) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, src, name: t.alt && t.alt.length < 80 && /\.\w{2,5}$/.test(t.alt) ? t.alt : fileNameFromSrc(src) });
    };
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // fecha só o menu, não a janela de trás
      setMenu(null);
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey, true); // captura: antes do Esc das janelas
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - h - 8)),
    });
  }, [menu]);

  if (!menu) return null;

  const copyImage = async () => {
    const { src } = menu;
    setMenu(null);
    try {
      const api = window.electronAPI;
      if (api?.copyImage && !src.startsWith('blob:')) {
        const res = await api.copyImage(src);
        if (res.ok) return onNotify('Imagem copiada.', 'info');
        if (res.dataUrl) {
          const png = await toPngBlob(res.dataUrl);
          const ok = await api.copyImagePng?.(await blobToDataUrl(png));
          if (ok?.ok) return onNotify('Imagem copiada.', 'info');
        }
      }
      const png = await toPngBlob(src);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      onNotify('Imagem copiada.', 'info');
    } catch {
      onNotify('Não foi possível copiar esta imagem.');
    }
  };

  const saveImage = async () => {
    const { src, name } = menu;
    setMenu(null);
    try {
      const api = window.electronAPI;
      if (api?.saveImage && !src.startsWith('blob:')) {
        const res = await api.saveImage(src, name);
        if (res.ok) onNotify('Imagem salva.', 'info');
        else if (!res.canceled) onNotify(res.error || 'Não foi possível salvar.');
        return;
      }
      const blob = await (await fetch(src)).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch {
      onNotify('Não foi possível salvar esta imagem.');
    }
  };

  const copyLink = async () => {
    const { src } = menu;
    setMenu(null);
    try {
      await navigator.clipboard.writeText(src);
      onNotify('Link copiado.', 'info');
    } catch {
      onNotify('Não foi possível copiar o link.');
    }
  };

  const item =
    'w-full flex items-center justify-between gap-6 px-2 h-8 rounded-[3px] text-[14px] text-[#dbdee1] hover:bg-[#5865f2] hover:text-white cursor-pointer';

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[200] min-w-[188px] rounded-[4px] bg-[#111214] p-1.5 shadow-[0_8px_16px_rgba(0,0,0,0.24)]"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" className={item} onClick={copyImage}>
        Copiar imagem <Copy className="w-4 h-4" />
      </button>
      <button type="button" role="menuitem" className={item} onClick={saveImage}>
        Salvar imagem <Download className="w-4 h-4" />
      </button>
      {looksLikeGifUrl(menu.src) && (
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            const added = toggleFavoriteGif({ url: menu.src, previewUrl: menu.src, title: menu.name.replace(/\.gif$/i, '') });
            onNotify(added ? 'GIF adicionado aos favoritos.' : 'GIF removido dos favoritos.', 'info');
            setMenu(null);
          }}
        >
          {isFavoriteGif(menu.src) ? 'Remover dos favoritos' : 'Favoritar GIF'} <Star className="w-4 h-4" />
        </button>
      )}
      <div className="h-px bg-white/10 my-1 mx-1" />
      <button type="button" role="menuitem" className={item} onClick={copyLink}>
        Copiar link <Link2 className="w-4 h-4" />
      </button>
      {!menu.src.startsWith('blob:') && !menu.src.startsWith('data:') && (
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            window.open(menu.src, '_blank', 'noopener');
            setMenu(null);
          }}
        >
          Abrir no navegador <ExternalLink className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
