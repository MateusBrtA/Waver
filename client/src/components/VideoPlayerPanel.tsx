import React, { useState } from 'react';
import {
  Clapperboard,
  Link2,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Trash2,
  Tv,
  Volume2,
  X,
} from 'lucide-react';
import { VideoState } from '../types';

interface VideoPlayerPanelProps {
  videoState: VideoState | null;
  currentSec: number;
  durationSec: number;
  volume: number;
  onVolumeChange: (val: number) => void;
  onAddVideoUrl: (url: string) => Promise<{ ok?: boolean; error?: string }>;
  onPlay: (index?: number) => void;
  onPause: () => void;
  onSeek: (sec: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onRemoveFromQueue: (index: number) => void;
  onClearQueue: () => void;
  onClose: () => void;
}

const PLATFORM_STYLE: Record<string, { label: string; bg: string; text: string }> = {
  youtube: { label: 'YouTube', bg: 'bg-[#ff0000]/20 border-[#ff0000]/40', text: 'text-[#ff6b6b]' },
  twitter: { label: 'X / Twitter', bg: 'bg-[#1d9bf0]/20 border-[#1d9bf0]/40', text: 'text-[#60a5fa]' },
  instagram: { label: 'Instagram', bg: 'bg-[#e1306c]/20 border-[#e1306c]/40', text: 'text-[#f472b6]' },
  tiktok: { label: 'TikTok', bg: 'bg-[#00f2ea]/15 border-[#00f2ea]/40', text: 'text-[#2dd4bf]' },
};

function formatDuration(sec?: number) {
  if (!sec || !Number.isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const VideoPlayerPanel: React.FC<VideoPlayerPanelProps> = ({
  videoState,
  currentSec,
  durationSec,
  volume,
  onVolumeChange,
  onAddVideoUrl,
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onRemoveFromQueue,
  onClearQueue,
  onClose,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const queue = videoState?.queue || [];
  const currentIndex = videoState?.currentIndex ?? -1;
  const currentVideo = currentIndex >= 0 ? queue[currentIndex] : null;
  const isPlaying = Boolean(videoState?.isPlaying && currentVideo);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = urlInput.trim();
    if (!raw) return;
    setLoading(true);
    setError('');
    try {
      const res = await onAddVideoUrl(raw);
      if (res?.error) {
        setError(res.error);
      } else {
        setUrlInput('');
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Não foi possível adicionar este vídeo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full min-w-0 bg-[#2b2d31] flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clapperboard className="w-4 h-4 text-[#f43f5e]" />
          <h3 className="text-sm font-bold text-white">Tocador de Vídeos</h3>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#f43f5e]/20 text-[#fda4af]">
            WATCH PARTY
          </span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded text-[#949ba4] hover:text-white cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Add URL Box */}
      <form onSubmit={handleSubmit} className="p-3 bg-[#232428] border-b border-white/10 space-y-2.5">
        <div className="flex flex-wrap gap-1 text-[10px] font-bold">
          {Object.entries(PLATFORM_STYLE).map(([k, st]) => (
            <span key={k} className={`px-1.5 py-0.5 rounded border ${st.bg} ${st.text}`}>
              {st.label}
            </span>
          ))}
        </div>

        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Link2 className="w-3.5 h-3.5 text-[#949ba4] absolute left-2.5 top-2.5" />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Cole link do YouTube, X, Insta ou TikTok..."
              disabled={loading}
              className="w-full bg-[#313338] border border-white/10 rounded-lg pl-8 pr-2.5 py-2 text-xs text-white outline-none focus:border-[#f43f5e]"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !urlInput.trim()}
            className="px-3 py-2 rounded-lg bg-[#f43f5e] hover:bg-[#e11d48] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {loading ? 'Buscando...' : 'Fila'}
          </button>
        </div>

        {error && (
          <div className="text-[11px] bg-[#f23f42]/15 text-[#ff8b8d] border border-[#f23f42]/40 px-2.5 py-1.5 rounded-lg">
            {error}
          </div>
        )}
      </form>

      {/* Current Video Transport Controls */}
      {currentVideo && (
        <div className="p-3 bg-[#313338] border-b border-white/10 space-y-2.5">
          <div className="flex items-center gap-2.5">
            {currentVideo.thumbnail ? (
              <img
                src={currentVideo.thumbnail}
                alt={currentVideo.title}
                className="w-16 h-10 rounded-lg object-cover bg-black border border-white/10 shrink-0"
              />
            ) : (
              <div className="w-16 h-10 rounded-lg bg-[#383a40] flex items-center justify-center shrink-0">
                <Tv className="w-5 h-5 text-[#f43f5e]" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-white truncate">{currentVideo.title}</div>
              <div className="text-[10px] text-[#949ba4] truncate">
                {currentVideo.author} • por {currentVideo.addedBy || 'Amigo'}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <input
              type="range"
              min={0}
              max={durationSec > 0 ? durationSec : currentVideo.duration || 100}
              step={0.25}
              value={Math.min(currentSec, durationSec || currentVideo.duration || 100)}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="w-full h-1.5 accent-[#ff0033] cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-[#949ba4]">
              <span>{formatDuration(currentSec) || '0:00'}</span>
              <span>{formatDuration(durationSec || currentVideo.duration) || '0:00'}</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onPrev}
                className="p-1.5 rounded-lg bg-[#383a40] hover:bg-[#4e5058] text-white cursor-pointer"
                title="Vídeo anterior"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onSeek(Math.max(0, currentSec - 10))}
                className="px-1.5 py-1 rounded-lg bg-[#383a40] hover:bg-[#4e5058] text-[10px] font-bold text-white flex items-center cursor-pointer"
                title="Voltar 10s para todos"
              >
                <RotateCcw className="w-3 h-3 mr-0.5" />
                10
              </button>
              <button
                type="button"
                onClick={() => (isPlaying ? onPause() : onPlay())}
                className="w-8 h-8 rounded-full bg-[#ff0033] hover:bg-[#cc0029] text-white flex items-center justify-center cursor-pointer shadow-md"
                title={isPlaying ? 'Pausar para todos' : 'Tocar para todos'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={() => onSeek(currentSec + 10)}
                className="px-1.5 py-1 rounded-lg bg-[#383a40] hover:bg-[#4e5058] text-[10px] font-bold text-white flex items-center cursor-pointer"
                title="Avançar 10s para todos"
              >
                10
                <RotateCw className="w-3 h-3 ml-0.5" />
              </button>
              <button
                type="button"
                onClick={onNext}
                className="p-1.5 rounded-lg bg-[#383a40] hover:bg-[#4e5058] text-white cursor-pointer"
                title="Próximo vídeo"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1 flex-1 max-w-[100px]" title="Volume individual (apenas seu fone)">
              <Volume2 className="w-3.5 h-3.5 text-[#949ba4] shrink-0" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                className="w-full accent-[#ff0033] cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* Interactive Responsive Queue with Thumbnails! */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {queue.length > 0 && (
          <div className="flex items-center justify-between text-[11px] text-[#949ba4] pb-1">
            <span className="font-semibold">Fila de Vídeos ({queue.length})</span>
            <button type="button" onClick={onClearQueue} className="text-[#f23f42] hover:underline cursor-pointer">
              Limpar fila
            </button>
          </div>
        )}

        {queue.length === 0 ? (
          <div className="text-center py-10 space-y-2 px-3">
            <Tv className="w-9 h-9 text-[#f43f5e] mx-auto opacity-80" />
            <p className="text-xs font-bold text-white">Cinema da Call (sem precisar compartilhar tela!)</p>
            <p className="text-[11px] text-[#949ba4] leading-relaxed">
              Cole qualquer vídeo do <strong>YouTube, X (Twitter), Instagram ou TikTok</strong> acima. Abre um quadrado
              direto no palco e toca em ordem sincronizado para todos!
            </p>
          </div>
        ) : (
          queue.map((item, idx) => {
            const active = idx === currentIndex;
            const pMeta = PLATFORM_STYLE[item.platform] || PLATFORM_STYLE.youtube;
            return (
              <div
                key={item.queueId}
                onClick={() => onPlay(idx)}
                className={`group flex items-center gap-2.5 p-2 rounded-lg border transition cursor-pointer ${
                  active
                    ? 'bg-[#f43f5e]/15 border-[#f43f5e]/50 shadow-md'
                    : 'bg-[#313338] border-white/5 hover:border-white/15 hover:bg-[#2b2d31]'
                }`}
              >
                <div className="relative w-16 h-10 rounded-lg overflow-hidden bg-black shrink-0 border border-white/10">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#949ba4]">
                      <Play className="w-4 h-4" />
                    </div>
                  )}
                  {item.duration > 0 && (
                    <span className="absolute bottom-0.5 right-0.5 text-[9px] font-mono font-bold bg-black/80 text-white px-1 rounded">
                      {formatDuration(item.duration)}
                    </span>
                  )}
                  {active && isPlaying && (
                    <div className="absolute inset-0 bg-black/45 flex items-end justify-center gap-0.5 pb-1.5">
                      <span className="w-1 h-3 bg-[#f43f5e] rounded-full eq-bar" />
                      <span className="w-1 h-4 bg-[#f43f5e] rounded-full eq-bar" style={{ animationDelay: '0.2s' }} />
                      <span className="w-1 h-2.5 bg-[#f43f5e] rounded-full eq-bar" style={{ animationDelay: '0.4s' }} />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-white truncate">{item.title}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${pMeta.bg} ${pMeta.text}`}>
                      {pMeta.label}
                    </span>
                    <span className="text-[10px] text-[#949ba4] truncate">{item.author}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFromQueue(idx);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-[#949ba4] hover:text-[#f23f42] cursor-pointer"
                  title="Remover vídeo"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
