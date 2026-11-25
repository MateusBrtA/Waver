import { useSyncExternalStore } from 'react';

/**
 * Estado "falando" fora do React principal.
 * Antes, cada vez que alguém começava/parava de falar o App inteiro re-renderizava
 * (custo crescia com o número de pessoas na call). Agora só o anel do avatar daquela
 * pessoa é atualizado.
 */
const speaking = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const anyListeners = new Set<() => void>();

export function setSpeaking(id: string | null | undefined, value: boolean) {
  if (!id) return;
  const had = speaking.has(id);
  if (had === value) return;
  if (value) speaking.add(id);
  else speaking.delete(id);
  listeners.get(id)?.forEach((fn) => fn());
  anyListeners.forEach((fn) => fn());
}

export function clearSpeaking(id: string | null | undefined) {
  setSpeaking(id, false);
}

export function isSpeaking(id: string | null | undefined) {
  return Boolean(id && speaking.has(id));
}

function subscribeKey(id: string, fn: () => void) {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(id);
  };
}

const noopUnsub = () => () => {};

export function useIsSpeaking(id: string | null | undefined): boolean {
  return useSyncExternalStore(
    id ? (fn) => subscribeKey(id, fn) : noopUnsub,
    () => Boolean(id && speaking.has(id)),
    () => false
  );
}

export function subscribeAnySpeaking(fn: () => void) {
  anyListeners.add(fn);
  return () => {
    anyListeners.delete(fn);
  };
}
