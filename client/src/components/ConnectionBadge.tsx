import React from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import { UserConnection } from '../types';

/**
 * Conexões de perfil no estilo Discord: ícone da rede + nome da conta (nunca o link cru).
 * A rede é detectada pela plataforma escolhida OU pelo domínio do link colado.
 */

type PlatformId =
  | 'steam'
  | 'spotify'
  | 'twitch'
  | 'youtube'
  | 'github'
  | 'x'
  | 'instagram'
  | 'tiktok'
  | 'xbox'
  | 'playstation'
  | 'epic'
  | 'reddit'
  | 'battlenet'
  | 'riot'
  | 'facebook'
  | 'linkedin'
  | 'kick'
  | 'web';

interface PlatformMeta {
  name: string;
  color: string;
  domains: string[];
  aliases: string[];
  icon: (props: { className?: string }) => React.ReactElement;
  profileUrl?: (handle: string) => string;
}

const svg = (children: React.ReactNode, viewBox = '0 0 24 24') =>
  function Icon({ className }: { className?: string }) {
    return (
      <svg viewBox={viewBox} className={className} fill="currentColor" aria-hidden>
        {children}
      </svg>
    );
  };

const PLATFORMS: Record<PlatformId, PlatformMeta> = {
  steam: {
    name: 'Steam',
    color: '#c7d5e0',
    domains: ['steamcommunity.com', 'steampowered.com', 's.team'],
    aliases: ['steam'],
    icon: svg(
      <>
        <path d="M12 2a10 10 0 0 0-9.96 9.1l5.36 2.22a2.83 2.83 0 0 1 1.6-.5h.16l2.38-3.46v-.05a3.77 3.77 0 1 1 3.77 3.77h-.09l-3.4 2.43v.13a2.83 2.83 0 0 1-5.6.56L2.4 14.7A10 10 0 1 0 12 2Z" />
        <circle cx="15.31" cy="9.31" r="2.5" />
        <path d="M8.3 17.43a2.1 2.1 0 0 0 1.68-3.86l1.18.49a1.56 1.56 0 1 1-1.2 2.88Z" opacity=".9" />
      </>
    ),
    profileUrl: (h) => `https://steamcommunity.com/id/${encodeURIComponent(h)}`,
  },
  spotify: {
    name: 'Spotify',
    color: '#1db954',
    domains: ['open.spotify.com', 'spotify.com', 'spotify.link'],
    aliases: ['spotify'],
    icon: svg(
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.43a.62.62 0 0 1-.86.2c-2.35-1.43-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.21c3.81-.87 7.08-.5 9.72 1.11.3.18.39.57.2.86Zm1.22-2.73a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.23 1.33.37.22.48.7.26 1.07Zm.1-2.84C14.7 8.95 9.38 8.77 6.3 9.7a.94.94 0 1 1-.54-1.8c3.53-1.07 9.4-.86 13.1 1.33a.94.94 0 0 1-.95 1.62Z" />
    ),
    profileUrl: (h) => `https://open.spotify.com/user/${encodeURIComponent(h)}`,
  },
  twitch: {
    name: 'Twitch',
    color: '#9146ff',
    domains: ['twitch.tv'],
    aliases: ['twitch'],
    icon: svg(<path d="M4.3 2 3 5.4v13.7h4.7V22h2.6l2.8-2.9h3.9L22 14V2H4.3Zm15.9 11.1-3 3h-4.7l-2.6 2.6v-2.6H6V3.8h14.2v9.3ZM17.2 7v5.3h-1.8V7h1.8Zm-4.8 0v5.3h-1.8V7h1.8Z" />),
    profileUrl: (h) => `https://twitch.tv/${encodeURIComponent(h)}`,
  },
  youtube: {
    name: 'YouTube',
    color: '#ff0033',
    domains: ['youtube.com', 'youtu.be'],
    aliases: ['youtube', 'yt'],
    icon: svg(<path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8ZM9.8 15V9l5.8 3-5.8 3Z" />),
    profileUrl: (h) => `https://youtube.com/@${encodeURIComponent(h.replace(/^@/, ''))}`,
  },
  github: {
    name: 'GitHub',
    color: '#f0f6fc',
    domains: ['github.com'],
    aliases: ['github', 'git'],
    icon: svg(<path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.53.1.72-.23.72-.5v-1.8c-2.92.63-3.54-1.4-3.54-1.4-.48-1.22-1.17-1.54-1.17-1.54-.95-.65.08-.64.08-.64 1.05.08 1.6 1.08 1.6 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.18 0-1.14.4-2.08 1.08-2.81-.11-.27-.47-1.33.1-2.78 0 0 .88-.28 2.89 1.08a10 10 0 0 1 5.26 0c2-1.36 2.88-1.08 2.88-1.08.58 1.45.22 2.51.11 2.78.67.73 1.08 1.67 1.08 2.81 0 4.02-2.46 4.9-4.8 5.16.38.33.72.97.72 1.96v2.9c0 .28.19.61.73.5A10.5 10.5 0 0 0 12 1.5Z" />),
    profileUrl: (h) => `https://github.com/${encodeURIComponent(h)}`,
  },
  x: {
    name: 'X',
    color: '#ffffff',
    domains: ['x.com', 'twitter.com'],
    aliases: ['x', 'twitter'],
    icon: svg(<path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43Z" />),
    profileUrl: (h) => `https://x.com/${encodeURIComponent(h.replace(/^@/, ''))}`,
  },
  instagram: {
    name: 'Instagram',
    color: '#e1306c',
    domains: ['instagram.com', 'instagr.am'],
    aliases: ['instagram', 'insta', 'ig'],
    icon: svg(
      <>
        <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Z" />
        <circle cx="17.3" cy="6.7" r="1.2" />
        <path d="M16.6 2H7.4A5.4 5.4 0 0 0 2 7.4v9.2A5.4 5.4 0 0 0 7.4 22h9.2a5.4 5.4 0 0 0 5.4-5.4V7.4A5.4 5.4 0 0 0 16.6 2Zm3.6 14.6a3.6 3.6 0 0 1-3.6 3.6H7.4a3.6 3.6 0 0 1-3.6-3.6V7.4a3.6 3.6 0 0 1 3.6-3.6h9.2a3.6 3.6 0 0 1 3.6 3.6v9.2Z" />
      </>
    ),
    profileUrl: (h) => `https://instagram.com/${encodeURIComponent(h.replace(/^@/, ''))}`,
  },
  tiktok: {
    name: 'TikTok',
    color: '#ffffff',
    domains: ['tiktok.com'],
    aliases: ['tiktok'],
    icon: svg(<path d="M16.6 2h-3.4v13.4a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.4 6.4 0 1 0 5.4 6.3V8.6a8 8 0 0 0 4.6 1.5V6.7A4.7 4.7 0 0 1 16.6 2Z" />),
    profileUrl: (h) => `https://tiktok.com/@${encodeURIComponent(h.replace(/^@/, ''))}`,
  },
  xbox: {
    name: 'Xbox',
    color: '#107c10',
    domains: ['xbox.com'],
    aliases: ['xbox', 'xbox live'],
    icon: svg(
      <path d="M12 2a10 10 0 0 0-6.6 2.5C7.3 3.7 10 5.6 12 7.2c2-1.6 4.7-3.5 6.6-2.7A10 10 0 0 0 12 2ZM4.2 5.8A10 10 0 0 0 2 12c0 2.5.9 4.7 2.4 6.5-.6-2.6 2.6-7.6 5.6-10.6-2.3-2-4.7-2.6-5.8-2.1Zm15.6 0c-1.1-.5-3.5.1-5.8 2.1 3 3 6.2 8 5.6 10.6A10 10 0 0 0 22 12c0-2.3-.8-4.5-2.2-6.2ZM12 10.3c-2.7 2.5-6 7.2-5.6 9.6A10 10 0 0 0 12 22a10 10 0 0 0 5.6-2.1c.4-2.4-2.9-7.1-5.6-9.6Z" />
    ),
  },
  playstation: {
    name: 'PlayStation',
    color: '#0070d1',
    domains: ['playstation.com', 'psnprofiles.com'],
    aliases: ['playstation', 'psn', 'ps'],
    icon: svg(
      <path d="M9.2 3v16.5l3.6 1.2V6.9c0-.7.3-1.1.8-1 .6.2.8.7.8 1.4v5.4c2.3 1.1 4 0 4-3 0-3-1-4.4-4.2-5.5C12.8 3.7 10.6 3.1 9.2 3ZM13.7 18l5.8-2.1c.7-.2.8-.6.2-.8-.6-.2-1.6-.1-2.2.1l-3.8 1.3v-2.1l.2-.1s1.1-.4 2.7-.5c1.5-.2 3.4 0 4.9.6 1.7.5 1.9 1.3 1.4 1.9-.4.6-1.5 1-1.5 1l-7.7 2.8V18ZM3 17.8c-1.7-.5-2-1.5-1.2-2.1.7-.5 2-.9 2-.9l5-1.8v2.1l-3.6 1.3c-.6.2-.7.6-.2.8.6.2 1.6.1 2.2-.1l1.6-.6v1.9l-.3.1a10 10 0 0 1-5.5-.7Z" />
    ),
  },
  epic: {
    name: 'Epic Games',
    color: '#ffffff',
    domains: ['epicgames.com'],
    aliases: ['epic', 'epic games', 'fortnite'],
    icon: svg(
      <path d="M4 2h16v16.3L12 22l-8-3.7V2Zm2.3 2.2v12.6L12 19.5l5.7-2.7V4.2H6.3Zm1.6 2.1h4v1.4H9.5v1.6h2.2v1.4H9.5v1.7h2.4v1.4h-4V6.3Zm5.2 0h1.6v7.5h-1.6V6.3Z" />
    ),
  },
  reddit: {
    name: 'Reddit',
    color: '#ff4500',
    domains: ['reddit.com'],
    aliases: ['reddit'],
    icon: svg(
      <path d="M22 12.1a2.2 2.2 0 0 0-3.7-1.6 10.8 10.8 0 0 0-5.8-1.8l1-4.6 3.2.7a1.6 1.6 0 1 0 .2-1l-3.7-.8a.5.5 0 0 0-.6.4l-1.1 5.3a10.8 10.8 0 0 0-5.9 1.8 2.2 2.2 0 1 0-2.4 3.6 4.3 4.3 0 0 0 0 .7c0 3.5 4 6.3 9 6.3s9-2.8 9-6.3a4.3 4.3 0 0 0 0-.7 2.2 2.2 0 0 0 1.3-2ZM7.4 13.6a1.6 1.6 0 1 1 3.2 0 1.6 1.6 0 0 1-3.2 0Zm8.9 4.2a5.9 5.9 0 0 1-4.3 1.3 5.9 5.9 0 0 1-4.3-1.3.4.4 0 0 1 .6-.6 5.1 5.1 0 0 0 3.7 1 5.1 5.1 0 0 0 3.7-1 .4.4 0 1 1 .6.6Zm-.3-2.6a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Z" />
    ),
    profileUrl: (h) => `https://reddit.com/user/${encodeURIComponent(h.replace(/^u\//, ''))}`,
  },
  battlenet: {
    name: 'Battle.net',
    color: '#148eff',
    domains: ['battle.net', 'blizzard.com'],
    aliases: ['battle.net', 'battlenet', 'blizzard'],
    icon: svg(
      <path d="M12 3c1.7 0 3 2.4 3.4 5.6 3.2-.4 5.9.4 6.4 2 .4 1.2-.6 2.5-2.4 3.6 1 2.6.8 4.9-.6 5.6-1.6.7-4-.8-5.9-3.6-1.4 2.6-3.3 4.2-4.7 3.8-1.6-.5-2-3.1-1.2-6.2C3.9 12.6 2 11 2.4 9.5 2.9 8 5.5 7.5 8.7 8 9.1 5.1 10.4 3 12 3Zm0 6.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z" />
    ),
  },
  riot: {
    name: 'Riot Games',
    color: '#eb0029',
    domains: ['riotgames.com', 'leagueoflegends.com', 'playvalorant.com', 'op.gg', 'tracker.gg'],
    aliases: ['riot', 'riot games', 'league of legends', 'lol', 'valorant'],
    icon: svg(<path d="M13.5 2 2 7.3l2.9 11 2.2-.3-.6-6.8.7-.3 1.2 7 3.7-.5-.6-8 .8-.3 1.4 8.1 3.6-.5-.7-9.1.8-.3 1.5 9.2 2.7-.4L22 5.6 13.5 2ZM13 19.6l.2 1.6 6.6 1-.3-3.6-6.5 1Z" />),
  },
  facebook: {
    name: 'Facebook',
    color: '#1877f2',
    domains: ['facebook.com', 'fb.com'],
    aliases: ['facebook', 'fb'],
    icon: svg(<path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z" />),
  },
  linkedin: {
    name: 'LinkedIn',
    color: '#0a66c2',
    domains: ['linkedin.com'],
    aliases: ['linkedin'],
    icon: svg(<path d="M20.4 2H3.6A1.6 1.6 0 0 0 2 3.6v16.8A1.6 1.6 0 0 0 3.6 22h16.8a1.6 1.6 0 0 0 1.6-1.6V3.6A1.6 1.6 0 0 0 20.4 2ZM8 19H5V9.5h3V19ZM6.5 8.2a1.7 1.7 0 1 1 0-3.5 1.7 1.7 0 0 1 0 3.5ZM19 19h-3v-4.6c0-1.1 0-2.5-1.5-2.5S12.7 13 12.7 14.3V19h-3V9.5h2.8v1.3h.1a3.1 3.1 0 0 1 2.8-1.5c3 0 3.6 2 3.6 4.6V19Z" />),
  },
  kick: {
    name: 'Kick',
    color: '#53fc18',
    domains: ['kick.com'],
    aliases: ['kick'],
    icon: svg(<path d="M3 3h6v4h2V5h2V3h8v6h-2v2h-2v2h2v2h2v6h-8v-2h-2v-2H9v4H3V3Z" />),
    profileUrl: (h) => `https://kick.com/${encodeURIComponent(h)}`,
  },
  web: {
    name: 'Site',
    color: '#b5bac1',
    domains: [],
    aliases: ['site', 'website', 'web', 'link', 'outro'],
    icon: ({ className }) => <Globe className={className} />,
  },
};

export const CONNECTION_PLATFORM_OPTIONS = (Object.keys(PLATFORMS) as PlatformId[])
  .filter((k) => k !== 'web')
  .map((k) => PLATFORMS[k].name)
  .concat('Outro site');

function detectPlatform(conn: UserConnection): PlatformId {
  const handle = String(conn.handle || '').trim();
  const urlMatch = handle.match(/^(?:https?:\/\/)?([^/\s]+\.[a-z]{2,})(?:[/?#]|$)/i);
  if (urlMatch) {
    const host = urlMatch[1].toLowerCase().replace(/^www\.|^m\./, '');
    for (const [id, meta] of Object.entries(PLATFORMS) as [PlatformId, PlatformMeta][]) {
      if (meta.domains.some((d) => host === d || host.endsWith(`.${d}`))) return id;
    }
  }
  const plat = String(conn.platform || '').trim().toLowerCase();
  for (const [id, meta] of Object.entries(PLATFORMS) as [PlatformId, PlatformMeta][]) {
    if (meta.aliases.includes(plat) || meta.name.toLowerCase() === plat) return id;
  }
  return 'web';
}

/** Extrai um nome de exibição legível de um link (ex: steamcommunity.com/id/Fulano/ -> Fulano) */
function displayHandle(conn: UserConnection, id: PlatformId): { label: string; href: string | null } {
  const raw = String(conn.handle || '').trim();
  const looksLikeUrl = /^(https?:\/\/)?[^/\s]+\.[a-z]{2,}(\/|$)/i.test(raw) && /[./]/.test(raw);
  if (looksLikeUrl) {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const u = new URL(href);
      const parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
      let label = '';
      if (id === 'steam') {
        // /id/<nome> ou /profiles/<steamid64>
        const idx = parts.findIndex((p) => p === 'id' || p === 'profiles');
        label = idx >= 0 && parts[idx + 1] ? parts[idx + 1] : parts[parts.length - 1] || '';
      } else if (id === 'spotify' || id === 'reddit') {
        const idx = parts.findIndex((p) => p === 'user' || p === 'u');
        label = idx >= 0 && parts[idx + 1] ? parts[idx + 1] : parts[parts.length - 1] || '';
      } else if (id === 'youtube') {
        const at = parts.find((p) => p.startsWith('@'));
        label = at ? at : parts[parts.length - 1] || '';
      } else if (id === 'web') {
        label = u.hostname.replace(/^www\./, '');
      } else {
        label = parts[0] || '';
      }
      label = label.replace(/^@/, '');
      return { label: label || u.hostname.replace(/^www\./, ''), href };
    } catch {
      return { label: raw, href: null };
    }
  }
  const meta = PLATFORMS[id];
  return { label: raw.replace(/^@/, ''), href: meta.profileUrl ? meta.profileUrl(raw) : null };
}

export function getConnectionInfo(conn: UserConnection) {
  const id = detectPlatform(conn);
  const meta = PLATFORMS[id];
  const { label, href } = displayHandle(conn, id);
  return { id, meta, label, href };
}

export const ConnectionIcon: React.FC<{ connection: UserConnection; className?: string }> = ({ connection, className }) => {
  const { meta } = getConnectionInfo(connection);
  const Icon = meta.icon;
  return (
    <span style={{ color: meta.color }} className="inline-flex">
      <Icon className={className || 'w-6 h-6'} />
    </span>
  );
};

/** Cartão de conexão (perfil completo): ícone + nome + botão de abrir */
export const ConnectionCard: React.FC<{ connection: UserConnection; onRemove?: () => void }> = ({ connection, onRemove }) => {
  const { meta, label, href } = getConnectionInfo(connection);
  const Icon = meta.icon;
  const open = () => {
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  };
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-[#3f4147] bg-[#2b2d31] px-3 py-2.5 min-w-0">
      <span style={{ color: meta.color }} className="shrink-0 inline-flex" title={meta.name}>
        <Icon className="w-6 h-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-[#f2f3f5] truncate" title={label}>
          {label}
        </div>
        <div className="text-xs text-[#949ba4]">{meta.name}</div>
      </div>
      {href && (
        <button
          type="button"
          onClick={open}
          className="p-1 rounded text-[#b5bac1] hover:text-[#f2f3f5] cursor-pointer"
          title={`Abrir no ${meta.name}`}
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="px-1.5 py-0.5 rounded text-xs text-[#f23f42] hover:bg-[#f23f42]/10 cursor-pointer"
        >
          Remover
        </button>
      )}
    </div>
  );
};
