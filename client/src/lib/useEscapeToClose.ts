import { useEffect, useRef } from 'react';

// Pilha de janelas abertas: Esc fecha só a de cima (a última aberta).
const stack: Array<{ current: (() => void) | undefined }> = [];
let listening = false;

function onKey(e: KeyboardEvent) {
  // fase de bolha na window: menus/campos dentro da janela que tratam Esc (preventDefault) têm prioridade
  if (e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.current?.();
}

/** Fecha a janela com Esc (como no Discord), a menos que algo dentro dela já tenha tratado a tecla. */
export function useEscapeToClose(onClose: (() => void) | undefined, enabled = true) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    stack.push(ref);
    if (!listening) {
      window.addEventListener('keydown', onKey);
      listening = true;
    }
    return () => {
      const i = stack.lastIndexOf(ref);
      if (i !== -1) stack.splice(i, 1);
      if (stack.length === 0 && listening) {
        window.removeEventListener('keydown', onKey);
        listening = false;
      }
    };
  }, [enabled]);
}
