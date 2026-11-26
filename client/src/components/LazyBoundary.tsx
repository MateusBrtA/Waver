import React, { Suspense } from 'react';

const RELOAD_KEY = 'pc.chunkReloadAt';

/** Pedaço da interface não encontrado (o host foi atualizado com a aba aberta): recarrega uma vez. */
export function isChunkLoadError(err: unknown) {
  const msg = String((err as Error)?.message || err || '');
  return /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(msg);
}

export function reloadOnceForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

class Boundary extends React.Component<{ children: React.ReactNode; label?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.error('[PulseCord] Falha ao abrir', this.props.label || 'parte da interface', err);
    if (isChunkLoadError(err)) reloadOnceForNewBuild();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-3 rounded-md bg-[#111214] border border-white/10 px-4 py-2.5 text-sm text-[#dbdee1] shadow-xl">
        Não foi possível abrir {this.props.label || 'esta janela'}.
        <button
          type="button"
          className="px-3 h-7 rounded bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold cursor-pointer"
          onClick={() => window.location.reload()}
        >
          Recarregar
        </button>
      </div>
    );
  }
}

/**
 * Suspense + proteção de erro para partes carregadas sob demanda: um erro dentro delas
 * (ou um arquivo que sumiu) não derruba o app inteiro.
 */
export const LazyBoundary: React.FC<{ children: React.ReactNode; label?: string; fallback?: React.ReactNode }> = ({
  children,
  label,
  fallback = null,
}) => (
  <Boundary label={label}>
    <Suspense fallback={fallback}>{children}</Suspense>
  </Boundary>
);
