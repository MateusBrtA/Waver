import { useSyncExternalStore } from 'react';

/** Preferências da integração com o Windows (ficam neste PC). */
export interface DesktopPrefs {
  notifications: boolean;
  notificationSound: boolean;
  shortcuts: { mute: string; deafen: string; overlay: string; clip: string };
  overlayEnabled: boolean;
  overlayCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  overlayOnlySpeaking: boolean;
  overlayOnlyInGames: boolean;
  /** mostra a música tocando (Spotify, navegador...) como atividade */
  mediaActivity: boolean;
  /** mantém os últimos ~30-60 s da chamada para salvar como clipe */
  clipsEnabled: boolean;
}

export const DEFAULT_DESKTOP_PREFS: DesktopPrefs = {
  notifications: true,
  notificationSound: true,
  shortcuts: { mute: 'CommandOrControl+Shift+F9', deafen: 'CommandOrControl+Shift+F10', overlay: 'CommandOrControl+Shift+F11', clip: 'CommandOrControl+Shift+F12' },
  overlayEnabled: false,
  overlayCorner: 'top-left',
  overlayOnlySpeaking: false,
  overlayOnlyInGames: false,
  mediaActivity: false,
  clipsEnabled: false,
};

const KEY = 'pc.desktopPrefs';
const listeners = new Set<() => void>();
let cache: DesktopPrefs | null = null;

function read(): DesktopPrefs {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    cache = {
      ...DEFAULT_DESKTOP_PREFS,
      ...raw,
      shortcuts: { ...DEFAULT_DESKTOP_PREFS.shortcuts, ...(raw?.shortcuts || {}) },
    };
  } catch {
    cache = { ...DEFAULT_DESKTOP_PREFS };
  }
  return cache!;
}

export function getDesktopPrefs() {
  return read();
}

export function updateDesktopPrefs(patch: Partial<DesktopPrefs>) {
  const cur = read();
  cache = { ...cur, ...patch, shortcuts: { ...cur.shortcuts, ...(patch.shortcuts || {}) } };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
  listeners.forEach((fn) => fn());
}

export function useDesktopPrefs(): DesktopPrefs {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    read
  );
}

/** Converte um evento de teclado no formato de atalho do Electron (ex.: CommandOrControl+Shift+M). */
export function keyEventToAccelerator(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = '';
  if (/^F\d{1,2}$/.test(k)) key = k;
  else if (e.code.startsWith('Key')) key = e.code.slice(3);
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  else if (e.code.startsWith('Numpad') && /\d$/.test(e.code)) key = 'num' + e.code.slice(-1);
  else {
    const map: Record<string, string> = {
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      ' ': 'Space',
      Insert: 'Insert',
      Delete: 'Delete',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      Pause: 'Pause',
      ScrollLock: 'Scrolllock',
    };
    key = map[k] || '';
  }
  if (!key) return null;
  // sem modificador só teclas F e de navegação (senão o atalho roubaria letras digitadas em qualquer programa)
  if (parts.length === 0 && !/^F\d{1,2}$|^(Pause|Scrolllock|Insert|Home|End|PageUp|PageDown)$/.test(key)) return null;
  return [...parts, key].join('+');
}

export function prettyAccelerator(acc: string) {
  return (acc || '')
    .replace('CommandOrControl', 'Ctrl')
    .split('+')
    .join(' + ');
}
