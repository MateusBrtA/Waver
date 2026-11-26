import type { ActivityEntry } from '../types';

/** "há 12 min", "há 1 h 5 min" desde que a atividade começou. */
export function formatActivityElapsed(startedAt?: number, now = Date.now()) {
  if (!startedAt) return '';
  const min = Math.max(0, Math.floor((now - startedAt) / 60000));
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `há ${h} h${m ? ` ${m} min` : ''}`;
}

/** Texto curto para listas: "Ouvindo Música — Artista" ou o nome do jogo. */
export function activityShortLabel(a: ActivityEntry) {
  if (a.category === 'music' && a.details) return `${a.details}${a.state ? ` — ${a.state}` : ''}`;
  return a.name;
}
