import React from 'react';
import { Clapperboard, Pause, Play, SkipForward } from 'lucide-react';
import { MusicState, VideoState } from '../types';

/** Barrinha "tocando agora" acima do painel de voz (música e vídeo da call). */
export const NowPlayingBar: React.FC<{
  musicState: MusicState | null;
  videoState: VideoState | null;
  onOpenMusic: () => void;
  onOpenVideo: () => void;
  onToggleMusic: () => void;
  onNextMusic: () => void;
}> = ({ musicState, videoState, onOpenMusic, onOpenVideo, onToggleMusic, onNextMusic }) => {
  const track = musicState && musicState.currentIndex >= 0 ? musicState.queue[musicState.currentIndex] : null;
  const video = videoState && videoState.currentIndex >= 0 ? videoState.queue[videoState.currentIndex] : null;
  if (!track && !video) return null;

  return (
    <div className="border-t border-white/10 bg-[#232428] px-2 pt-2 space-y-1.5">
      {track && (
        <div key={track.queueId || track.id} className="animate-fade-up flex items-center gap-2 rounded-[6px] bg-[#2b2d31] p-1.5">
          <button type="button" onClick={onOpenMusic} className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer" title="Abrir o tocador de músicas">
            <div className="relative w-9 h-9 shrink-0 rounded-[4px] overflow-hidden bg-[#1e1f22]">
              {track.thumbnail ? (
                <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
              ) : null}
              {musicState?.isPlaying && (
                <div className="absolute inset-0 bg-black/45 flex items-end justify-center gap-[2px] pb-1.5">
                  {[0, 0.2, 0.4].map((d) => (
                    <span key={d} className="eq-bar w-[3px] h-3 rounded-sm bg-[#23a55a]" style={{ animationDelay: `${d}s` }} />
                  ))}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-[#f2f3f5] truncate">{track.title}</div>
              <div className="text-[11px] text-[#949ba4] truncate">
                {musicState?.isPlaying ? 'Tocando' : 'Pausado'} · {track.artist}
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={onToggleMusic}
            className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[#dbdee1] hover:bg-[#404249] cursor-pointer"
            title={musicState?.isPlaying ? 'Pausar para todos' : 'Tocar para todos'}
          >
            {musicState?.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onNextMusic}
            className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[#dbdee1] hover:bg-[#404249] cursor-pointer"
            title="Próxima"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>
      )}
      {video && (
        <button
          key={video.queueId}
          type="button"
          onClick={onOpenVideo}
          className="animate-fade-up w-full flex items-center gap-2 rounded-[6px] bg-[#2b2d31] hover:bg-[#35373c] p-1.5 text-left cursor-pointer"
          title="Abrir o vídeo da call"
        >
          <div className="relative w-9 h-9 shrink-0 rounded-[4px] overflow-hidden bg-[#1e1f22] flex items-center justify-center">
            {video.thumbnail ? <img src={video.thumbnail} alt="" className="w-full h-full object-cover" /> : <Clapperboard className="w-4 h-4 text-[#949ba4]" />}
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-[#f2f3f5] truncate">{video.title}</div>
            <div className="text-[11px] text-[#949ba4] truncate">
              {videoState?.isPlaying ? 'Assistindo juntos' : 'Vídeo pausado'}
              {videoState?.rate && videoState.rate !== 1 ? ` · ${videoState.rate}x` : ''}
            </div>
          </div>
        </button>
      )}
    </div>
  );
};
