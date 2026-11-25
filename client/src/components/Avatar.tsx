import React, { useEffect, useState } from 'react';
import { resolveMediaUrl } from '../lib/api';
import { useIsSpeaking } from '../lib/speakingStore';
import { PresenceStatus } from '../types';

/**
 * Decorações de avatar (camada por cima do avatar, como no Discord).
 * Só animam em tamanhos grandes (perfil) ou ao passar o mouse — em listas ficam estáticas,
 * para não gastar GPU com dezenas de animações ao mesmo tempo.
 * As chaves antigas (neon-blurple, emerald, fire, galaxy, gold, cyber) continuam válidas.
 */
export const AVATAR_DECORATIONS: Record<string, { label: string; ringClass: string; badge?: string }> = {
  none: { label: 'Nenhuma', ringClass: '' },
  waves: { label: 'Ondas', ringClass: 'pc-deco-waves' },
  aurora: { label: 'Aurora', ringClass: 'pc-deco-aurora' },
  orbit: { label: 'Órbita', ringClass: 'pc-deco-orbit' },
  'neon-blurple': { label: 'Neon', ringClass: 'pc-deco-neon' },
  emerald: { label: 'Esmeralda', ringClass: 'pc-deco-emerald' },
  fire: { label: 'Chamas', ringClass: 'pc-deco-fire' },
  galaxy: { label: 'Galáxia', ringClass: 'pc-deco-galaxy' },
  gold: { label: 'Coroa', ringClass: 'pc-deco-gold', badge: '👑' },
  cyber: { label: 'Cyber', ringClass: 'pc-deco-cyber' },
  sakura: { label: 'Sakura', ringClass: 'pc-deco-sakura' },
};

export const NAME_STYLES: Record<string, { label: string; className: string }> = {
  default: { label: 'Padrão', className: 'text-white' },
  blurple: {
    label: 'Gradiente Azul',
    className: 'bg-gradient-to-r from-[#818cf8] via-[#5865f2] to-[#c084fc] bg-clip-text text-transparent',
  },
  emerald: {
    label: 'Esmeralda',
    className: 'bg-gradient-to-r from-[#4ade80] to-[#06b6d4] bg-clip-text text-transparent',
  },
  gold: {
    label: 'Dourado',
    className: 'bg-gradient-to-r from-[#fde047] via-[#f59e0b] to-[#fde047] bg-clip-text text-transparent',
  },
  cyber: {
    label: 'Rosa',
    className: 'bg-gradient-to-r from-[#f472b6] via-[#ec4899] to-[#a855f7] bg-clip-text text-transparent',
  },
};

// Primeiro quadro de GIFs (avatar parado até a pessoa falar ou o mouse passar, como no Discord)
const gifStillCache = new Map<string, string | null>();
const gifStillPending = new Map<string, Promise<string | null>>();

function looksLikeGif(url: string) {
  return /^data:image\/gif/i.test(url) || /\.gif(\?|#|$)/i.test(url);
}

function loadGifStill(url: string): Promise<string | null> {
  if (gifStillCache.has(url)) return Promise.resolve(gifStillCache.get(url) ?? null);
  let p = gifStillPending.get(url);
  if (!p) {
    p = new Promise<string | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const size = Math.min(256, Math.max(img.naturalWidth, img.naturalHeight) || 128);
          const c = document.createElement('canvas');
          c.width = size;
          c.height = size;
          const ctx = c.getContext('2d')!;
          const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          resolve(c.toDataURL('image/png'));
        } catch {
          resolve(null); // canvas "sujo" (sem CORS): deixa animado
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }).then((still) => {
      gifStillCache.set(url, still);
      gifStillPending.delete(url);
      return still;
    });
    gifStillPending.set(url, p);
  }
  return p;
}

function useGifStill(url: string, enabled: boolean) {
  const [still, setStill] = useState<string | null>(() => (enabled && url ? gifStillCache.get(url) ?? null : null));
  useEffect(() => {
    if (!enabled || !url || !looksLikeGif(url)) {
      setStill(null);
      return;
    }
    let alive = true;
    loadGifStill(url).then((s) => alive && setStill(s));
    return () => {
      alive = false;
    };
  }, [url, enabled]);
  return still;
}

interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  color?: string;
  decoration?: string;
  serverUrl: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  statusType?: PresenceStatus;
  speaking?: boolean;
  /** socketId para ler o estado "falando" direto do speakingStore (sem re-render do app) */
  speakingId?: string | null;
  soundboardActive?: boolean;
  borderBg?: string;
  className?: string;
  /** Força animação da decoração mesmo em tamanhos pequenos */
  animateDecoration?: boolean;
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-xl',
  xl: 'w-20 h-20 text-2xl',
};

const DOT_SIZE_MAP = {
  xs: 'w-2.5 h-2.5 border-[1.5px]',
  sm: 'w-3 h-3 border-2',
  md: 'w-3.5 h-3.5 border-[2.5px]',
  lg: 'w-4 h-4 border-[3px]',
  xl: 'w-5 h-5 border-[3.5px]',
};

export const Avatar: React.FC<AvatarProps> = ({
  name,
  avatarUrl,
  color = '#5865F2',
  decoration = 'none',
  serverUrl,
  size = 'md',
  online,
  statusType = 'online',
  speaking,
  speakingId,
  soundboardActive,
  borderBg = '#2b2d31',
  className = '',
  animateDecoration,
}) => {
  const storeSpeaking = useIsSpeaking(speakingId);
  const isSpeaking = Boolean(speaking || storeSpeaking);

  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const fullUrl = avatarUrl ? resolveMediaUrl(serverUrl, avatarUrl) : '';
  const deco = AVATAR_DECORATIONS[decoration || 'none'] || AVATAR_DECORATIONS.none;
  const largeSize = size === 'lg' || size === 'xl';
  // decoração anima em perfis grandes, ao passar o mouse e enquanto a pessoa fala (como no Discord)
  const animated = (animateDecoration ?? largeSize) || isSpeaking || Boolean(soundboardActive);
  const [hovered, setHovered] = useState(false);
  const gifStill = useGifStill(fullUrl, !largeSize);
  const shownUrl = gifStill && !(isSpeaking || hovered || animateDecoration) ? gifStill : fullUrl;

  const showDot = typeof online === 'boolean';
  const effectiveStatus: PresenceStatus | 'offline' = !online ? 'offline' : statusType || 'online';

  return (
    <div
      className={`pc-avatar relative inline-flex shrink-0 ${animated ? 'pc-deco-animated' : ''} ${className}`}
      onMouseEnter={gifStill ? () => setHovered(true) : undefined}
      onMouseLeave={gifStill ? () => setHovered(false) : undefined}
    >
      <div
        className={`${SIZE_MAP[size]} rounded-full overflow-hidden flex items-center justify-center font-semibold text-white select-none ${
          soundboardActive ? 'pc-ring-soundboard' : isSpeaking ? 'pc-ring-speaking' : ''
        }`}
        style={{ backgroundColor: fullUrl ? '#1e1f22' : color }}
      >
        {fullUrl ? (
          <img src={shownUrl} alt={name} draggable={false} className="w-full h-full object-cover" />
        ) : (
          <span>{initials || '?'}</span>
        )}
      </div>

      {deco.ringClass && <span aria-hidden className={`pc-deco ${deco.ringClass}`} />}

      {deco.badge && (size === 'lg' || size === 'xl') && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-lg drop-shadow select-none pointer-events-none z-[2]">
          {deco.badge}
        </span>
      )}

      {showDot && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full flex items-center justify-center z-[3] ${DOT_SIZE_MAP[size]}`}
          style={{
            borderColor: borderBg,
            backgroundColor:
              effectiveStatus === 'online'
                ? '#23a55a'
                : effectiveStatus === 'idle'
                ? '#f0b232'
                : effectiveStatus === 'dnd'
                ? '#f23f42'
                : '#80848e',
          }}
        >
          {effectiveStatus === 'dnd' && <span className="w-[60%] h-[2px] bg-[#1e1f22] rounded-full" />}
          {effectiveStatus === 'offline' && <span className="w-[45%] h-[45%] rounded-full bg-[#1e1f22]" />}
        </span>
      )}
    </div>
  );
};
