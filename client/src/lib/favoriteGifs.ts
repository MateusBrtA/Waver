import { useSyncExternalStore } from 'react';

/** GIFs favoritos: ficam neste PC e valem em qualquer servidor (como os favoritos do Discord). */
export interface FavoriteGif {
  url: string;
  previewUrl?: string;
  title?: string;
  addedAt: number;
}

const KEY = 'pulsecord_fav_gifs';
const listeners = new Set<() => void>();
let cache: FavoriteGif[] | null = null;

function read(): FavoriteGif[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    cache = Array.isArray(parsed) ? parsed.filter((g) => g && typeof g.url === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: FavoriteGif[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn());
}

export function isFavoriteGif(url: string) {
  return read().some((g) => g.url === url);
}

export function toggleFavoriteGif(gif: Omit<FavoriteGif, 'addedAt'>): boolean {
  const list = read();
  if (list.some((g) => g.url === gif.url)) {
    write(list.filter((g) => g.url !== gif.url));
    return false;
  }
  write([{ ...gif, addedAt: Date.now() }, ...list].slice(0, 300));
  return true;
}

export function useFavoriteGifs(): FavoriteGif[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    read
  );
}

/** URL parece de GIF (arquivo .gif ou provedores de GIF) */
export function looksLikeGifUrl(url: string) {
  return /\.gif(\?|#|$)/i.test(url) || /(^|\.)(tenor\.com|giphy\.com|media\.tenor\.com)\//i.test(url.replace(/^https?:\/\//, ''));
}
