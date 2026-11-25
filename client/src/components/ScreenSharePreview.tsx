import React, { useEffect, useRef } from 'react';
import { MonitorPlay } from 'lucide-react';

/**
 * Miniatura ao passar o mouse em quem está transmitindo (como no Discord).
 * Só há imagem ao vivo de quem está na mesma call (a tela chega por WebRTC); fora dela, mostra o convite para assistir.
 */
export const ScreenSharePreview: React.FC<{
  anchor: DOMRect;
  name: string;
  label?: string;
  stream: MediaStream | null;
  sameCall: boolean;
  onWatch: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}> = ({ anchor, name, label, stream, sameCall, onWatch, onMouseEnter, onMouseLeave }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play().catch(() => {});
    return () => {
      if (v) v.srcObject = null;
    };
  }, [stream]);

  const width = 288;
  const left = Math.min(anchor.right + 10, window.innerWidth - width - 8);
  const top = Math.max(8, Math.min(anchor.top - 40, window.innerHeight - 230));

  return (
    <div
      className="fixed z-[150] animate-fade-up rounded-[8px] bg-[#111214] shadow-[0_8px_24px_rgba(0,0,0,0.5)] overflow-hidden"
      style={{ left, top, width }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button type="button" onClick={onWatch} className="group block w-full text-left cursor-pointer">
        <div className="relative aspect-video bg-black">
          {stream ? (
            <video ref={videoRef} muted playsInline autoPlay className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-[#949ba4]">
              <MonitorPlay className="w-7 h-7" />
              <span className="text-[12px]">{sameCall ? 'Carregando a tela…' : 'Entre na call para ver a tela'}</span>
            </div>
          )}
          <span className="absolute top-2 left-2 text-[10px] font-bold bg-[#f23f42] text-white px-1.5 py-[1px] rounded-full tracking-wide">
            AO VIVO
          </span>
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/45 transition-colors">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity px-3 h-8 rounded-[4px] bg-[#5865f2] text-white text-[13px] font-semibold flex items-center">
              {sameCall ? 'Assistir transmissão' : 'Entrar e assistir'}
            </span>
          </div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[13px] font-semibold text-[#f2f3f5] truncate">{name}</div>
          <div className="text-[12px] text-[#949ba4] truncate">{label || 'Transmitindo a tela'}</div>
        </div>
      </button>
    </div>
  );
};
