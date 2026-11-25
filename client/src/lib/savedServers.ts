import { AppMode } from '../types';

/** Servidor salvo na barra lateral (como a lista de servidores do Discord). Fica só neste PC. */
export interface SavedServer {
  serverUrl: string;
  token: string;
  mode: AppMode;
  name: string;
  iconColor?: string;
  iconUrl?: string | null;
  lastUsedAt: number;
}

const KEY = 'pulsecord_saved_servers';

export const serverKey = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

export function loadSavedServers(): SavedServer[] {
  let list: SavedServer[] = [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      list = parsed.filter((s) => s && typeof s.serverUrl === 'string' && s.serverUrl);
    }
  } catch {
    list = [];
  }
  // migração: a sessão que já existia (versões antigas só guardavam uma) entra na lista
  try {
    const rawSession = localStorage.getItem('pulsecord_session');
    if (rawSession) {
      const s = JSON.parse(rawSession) as { serverUrl?: string; token?: string; mode?: AppMode };
      if (s.serverUrl && s.token && !list.some((x) => serverKey(x.serverUrl) === serverKey(s.serverUrl!))) {
        list.push({
          serverUrl: s.serverUrl,
          token: s.token,
          mode: s.mode === 'host' ? 'host' : 'client',
          name: 'Servidor',
          lastUsedAt: Date.now(),
        });
        persist(list);
      }
    }
  } catch {
    // ignore
  }
  return list;
}

function persist(list: SavedServer[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function upsertSavedServer(list: SavedServer[], entry: Partial<SavedServer> & { serverUrl: string }): SavedServer[] {
  const k = serverKey(entry.serverUrl);
  const idx = list.findIndex((s) => serverKey(s.serverUrl) === k);
  let next: SavedServer[];
  if (idx >= 0) {
    const merged = { ...list[idx], ...stripUndefined(entry) };
    const same = JSON.stringify(merged) === JSON.stringify(list[idx]);
    if (same) return list;
    next = list.slice();
    next[idx] = merged;
  } else {
    next = [
      ...list,
      {
        token: '',
        mode: 'client',
        name: 'Servidor',
        lastUsedAt: Date.now(),
        ...stripUndefined(entry),
      } as SavedServer,
    ];
  }
  persist(next);
  return next;
}

export function removeSavedServer(list: SavedServer[], serverUrl: string): SavedServer[] {
  const k = serverKey(serverUrl);
  const next = list.filter((s) => serverKey(s.serverUrl) !== k);
  if (next.length === list.length) return list;
  persist(next);
  return next;
}

export function clearSavedServers() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as any)[k] = v;
  return out;
}
