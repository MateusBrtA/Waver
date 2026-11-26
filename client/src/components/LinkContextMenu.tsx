import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Clapperboard, Copy, ExternalLink, Music } from 'lucide-react';

type MenuState = { x: number; y: number; url: string } | null;

/** Mesma detecção do servidor (server/mediaResolver.js → detectMediaPlatform). */
export function linkPlatform(raw: string): string {
  try {
    const h = new URL(raw).hostname.toLowerCase().replace(/^www\.|^m\./, '');
    if (h === 'youtube.com' || h === 'youtu.be' || h === 'music.youtube.com') return 'youtube';
    if (h === 'twitter.com' || h === 'x.com' || h === 'fxtwitter.com' || h === 'vxtwitter.com') return 'twitter';
    if (h === 'instagram.com' || h === 'instagr.am') return 'instagram';
    if (h === 'tiktok.com' || h === 'vm.tiktok.com' || h === 'vt.tiktok.com') return 'tiktok';
    if (h === 'open.spotify.com' || h === 'spotify.link') return 'spotify';
    if (h === 'soundcloud.com' || h === 'on.soundcloud.com') return 'soundcloud';
    return 'unknown';
  } catch {
    return 'invalid';
  }
}
const VIDEO_PLATFORMS = new Set(['youtube', 'twitter', 'instagram', 'tiktok']);
const MUSIC_PLATFORMS = new Set(['youtube', 'spotify', 'soundcloud']);

interface Props {
  inVoiceCall: boolean;
  onPlayVideo: (url: string) => void;
  onPlayMusic: (url: string) => void;
  onNotify: (msg: string, kind?: 'error' | 'info') => void;
}

/**
 * Clique direito em qualquer link http(s) do app: copiar, abrir no navegador e, se o link for de um
 * site que o Tocador de Vídeos/Músicas aceita, tocar na call. Links com menu próprio usam data-no-link-menu.
 */
export const LinkContextMenu: React.FC<Props> = ({ inVoiceCall, onPlayVideo, onPlayMusic, onNotify }) => {
  const [menu, setMenu] = useState<MenuState>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (!t || t instanceof HTMLImageElement || t instanceof HTMLVideoElement) return; // imagens: menu de imagem
      const a = t.closest('a[href]') as HTMLAnchorElement | null;
      if (!a || a.closest('[data-no-link-menu]')) return;
      const url = a.href;
      if (!/^https?:\/\//i.test(url)) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, url });
    };
    window.addEventListener('contextmenu', onCtx);
    return () => window.removeEventListener('contextmenu', onCtx);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)),
    });
  }, [menu]);

  if (!menu) return null;
  const platform = linkPlatform(menu.url);
  const canVideo = VIDEO_PLATFORMS.has(platform);
  const canMusic = MUSIC_PLATFORMS.has(platform);
  const run = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };
  const item = 'w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-left text-[13px] cursor-pointer transition';
  const enabled = 'text-[#dbdee1] hover:bg-[#5865f2] hover:text-white';
  const disabled = 'text-[#6d6f78] cursor-not-allowed';

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[200] min-w-[230px] max-w-[320px] bg-[#111214] border border-[#2b2d31] rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.6)] p-1.5 select-none"
    >
      <div className="px-2 pb-1 text-[11px] text-[#949ba4] truncate" title={menu.url}>
        {menu.url}
      </div>
      <button
        type="button"
        role="menuitem"
        className={`${item} ${enabled}`}
        onClick={run(() => {
          navigator.clipboard
            .writeText(menu.url)
            .then(() => onNotify('Link copiado.', 'info'))
            .catch(() => onNotify('Não foi possível copiar o link.', 'error'));
        })}
      >
        <Copy className="w-4 h-4" /> Copiar link
      </button>
      <button
        type="button"
        role="menuitem"
        className={`${item} ${enabled}`}
        onClick={run(() => {
          window.open(menu.url, '_blank', 'noopener,noreferrer');
        })}
      >
        <ExternalLink className="w-4 h-4" /> Abrir link
      </button>
      {(canVideo || canMusic) && <div className="my-1 h-px bg-[#2b2d31]" />}
      {canVideo && (
        <button
          type="button"
          role="menuitem"
          disabled={!inVoiceCall}
          title={inVoiceCall ? 'Toca para todos da call no Tocador de Vídeos' : 'Entre numa sala de voz para tocar'}
          className={`${item} ${inVoiceCall ? enabled : disabled}`}
          onClick={run(() => onPlayVideo(menu.url))}
        >
          <Clapperboard className="w-4 h-4" /> Tocar no player de vídeo
          {!inVoiceCall && <span className="ml-auto text-[10px]">entre numa call</span>}
        </button>
      )}
      {canMusic && (
        <button
          type="button"
          role="menuitem"
          disabled={!inVoiceCall}
          title={inVoiceCall ? 'Põe na fila do Tocador de Músicas da call' : 'Entre numa sala de voz para tocar'}
          className={`${item} ${inVoiceCall ? enabled : disabled}`}
          onClick={run(() => onPlayMusic(menu.url))}
        >
          <Music className="w-4 h-4" /> Tocar no tocador de músicas
          {!inVoiceCall && <span className="ml-auto text-[10px]">entre numa call</span>}
        </button>
      )}
    </div>
  );
};
