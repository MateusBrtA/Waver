// Mensagens novas nos canais: guarda (neste PC, por servidor) até quando você leu cada canal e compara com a última
// mensagem de cada um (que o servidor manda em `channelActivity`). Na primeira vez num servidor, tudo conta como lido
// (não acende o servidor inteiro só porque atualizou o app).
import { serverKey } from './savedServers';

export type ChannelActivity = Record<string, { at: number; authorId: string }>;
export type ReadMap = Record<string, number>;

const PREFIX = 'waver_read:';
const ME_PREFIX = 'waver_me:';

export function loadReadMap(url: string): ReadMap | null {
  try {
    const raw = localStorage.getItem(PREFIX + serverKey(url));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as ReadMap) : null;
  } catch {
    return null;
  }
}

export function saveReadMap(url: string, map: ReadMap) {
  try {
    localStorage.setItem(PREFIX + serverKey(url), JSON.stringify(map));
  } catch {
    // ignore
  }
}

/** Primeira vez neste servidor: marca o que já existe como lido. */
export function seedReadMap(activity: ChannelActivity): ReadMap {
  const map: ReadMap = {};
  for (const [id, a] of Object.entries(activity)) map[id] = a.at;
  return map;
}

export function unreadChannels(activity: ChannelActivity, read: ReadMap | null, selfId: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!read) return out;
  for (const [id, a] of Object.entries(activity)) {
    if (!a || !a.at) continue;
    if (selfId && a.authorId === selfId) continue; // a última é sua: você estava lá
    if (a.at > (read[id] ?? 0)) out.add(id);
  }
  return out;
}

/** Quem eu sou em cada servidor (para não contar as minhas mensagens nos servidores que não estão abertos). */
export function rememberSelfId(url: string, userId: string) {
  try {
    localStorage.setItem(ME_PREFIX + serverKey(url), userId);
  } catch {
    // ignore
  }
}

export function loadSelfId(url: string): string | null {
  try {
    return localStorage.getItem(ME_PREFIX + serverKey(url));
  } catch {
    return null;
  }
}
