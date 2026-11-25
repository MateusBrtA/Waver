import React from 'react';
import { resolveMediaUrl } from '../lib/api';

/** Efeitos de perfil: animação atrás do cartão (não no banner). Só CSS, sem canvas. */
export const PROFILE_EFFECTS: Record<string, { label: string; className: string }> = {
  none: { label: 'Nenhum', className: '' },
  galaxy: { label: 'Galáxia', className: 'pc-fx-galaxy' },
  aurora: { label: 'Aurora', className: 'pc-fx-aurora' },
  snow: { label: 'Neve', className: 'pc-fx-snow' },
  sakura: { label: 'Sakura', className: 'pc-fx-sakura' },
  embers: { label: 'Brasas', className: 'pc-fx-embers' },
  hearts: { label: 'Corações', className: 'pc-fx-hearts' },
  rain: { label: 'Chuva digital', className: 'pc-fx-rain' },
};

/**
 * Camada de fundo do cartão de perfil: imagem/GIF escolhida + efeito animado.
 * O pai precisa ser `relative`; o conteúdo do cartão fica por cima (z-index 1).
 */
export const ProfileEffectLayer: React.FC<{
  effect?: string | null;
  bgUrl?: string | null;
  serverUrl: string;
  /** altura fixa quando o pai rola (o fundo acompanha a rolagem) */
  sticky?: boolean;
}> = ({ effect, bgUrl, serverUrl, sticky }) => {
  const fx = PROFILE_EFFECTS[effect || 'none'] || PROFILE_EFFECTS.none;
  const full = bgUrl ? (bgUrl.startsWith('data:') ? bgUrl : resolveMediaUrl(serverUrl, bgUrl)) : '';
  if (!fx.className && !full) return null;

  const inner = (
    <div className={`pc-fx-layer pointer-events-none !absolute inset-0 !z-0 overflow-hidden ${sticky ? 'h-full' : ''}`} aria-hidden>
      {full && <img src={full} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />}
      {full && <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/45 to-black/70" />}
      {fx.className && <div className={`absolute inset-0 ${fx.className}`} />}
    </div>
  );

  if (!sticky) return inner;
  // fica preso no topo do contêiner que rola, com a altura da área visível
  return (
    <div className="pc-fx-layer !sticky top-0 h-0 !z-0 pointer-events-none" aria-hidden>
      <div className="absolute left-0 right-0 top-0 h-[86vh] overflow-hidden">{inner}</div>
    </div>
  );
};
