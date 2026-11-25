import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Disc3,
  Link2,
  ListMusic,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { MusicState, MusicTrack } from '../types';

interface MusicPlayerPanelProps {
  musicState: MusicState | null;
  currentSec: number;
  durationSec: number;
  volume: number;
  onVolumeChange: (val: number) => void;
  onAddMusicUrl: (url: string) => Promise<{ ok?: boolean; error?: string; count?: number }>;
  onPlay: (index?: number) => void;
  onPause: () => void;
  onSeek: (sec: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onRemoveFromQueue: (index: number) => void;
  onRemovePlaylistBlock: (playlistBlockId: string) => void;
  onClearQueue: () => void;
  onLoopChange: (mode: 'none' | 'one' | 'all') => void;
  onClose: () => void;
}

type QueueNode =
  | { kind: 'single'; index: number; track: MusicTrack }
  | {
      kind: 'playlist';
      blockId: string;
      title: string;
      thumbnail: string;
      platform: string;
      items: Array<{ index: number; track: MusicTrack }>;
    };

const PLATFORM_BADGES: Record<string, { label: string; cls: string }> = {
  youtube: { label: 'YouTube', cls: 'bg-[#ff0000]/20 text-[#ff6b6b] border-[#ff0000]/35' },
  spotify: { label: 'Spotify', cls: 'bg-[#1db954]/20 text-[#4ade80] border-[#1db954]/35' },
  soundcloud: { label: 'SoundCloud', cls: 'bg-[#ff5500]/20 text-[#fb923c] border-[#ff5500]/35' },
};

function formatSec(sec?: number) {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const MusicPlayerPanel: React.FC<MusicPlayerPanelProps> = ({
  musicState,
  currentSec,
  durationSec,
  volume,
  onVolumeChange,
  onAddMusicUrl,
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrev,
  onRemoveFromQueue,
  onRemovePlaylistBlock,
  onClearQueue,
  onLoopChange,
  onClose,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});

  const queue = musicState?.queue || [];
  const currentIndex = musicState?.currentIndex ?? -1;
  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;
  const isPlaying = Boolean(musicState?.isPlaying && currentTrack);
  const loopMode = musicState?.loopMode || 'none';

  const cycleLoop = () => {
    const next = loopMode === 'none' ? 'all' : loopMode === 'all' ? 'one' : 'none';
    onLoopChange(next);
  };

  // Group consecutive tracks belonging to the same playlist into a collapsible dropdown block!
  const queueNodes = useMemo<QueueNode[]>(() => {
    const nodes: QueueNode[] = [];
    const blockById = new Map<string, Extract<QueueNode, { kind: 'playlist' }>>();

    queue.forEach((track, index) => {
      if (track.playlistBlockId) {
        let block = blockById.get(track.playlistBlockId);
        if (!block) {
          block = {
            kind: 'playlist',
            blockId: track.playlistBlockId,
            title: track.playlistTitle || 'Playlist',
            thumbnail: track.playlistThumbnail || track.thumbnail || '',
            platform: track.playlistPlatform || track.platform || 'youtube',
            items: [],
          };
          blockById.set(track.playlistBlockId, block);
          nodes.push(block);
        }
        block.items.push({ index, track });
      } else {
        nodes.push({ kind: 'single', index, track });
      }
    });
    return nodes;
  }, [queue]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = urlInput.trim();
    if (!raw) return;
    setLoading(true);
    setError('');
    try {
      const res = await onAddMusicUrl(raw);
      if (res?.error) {
        setError(res.error);
      } else {
        setUrlInput('');
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Não foi possível extrair esta música ou playlist.');
    } finally {
      setLoading(false);
    }
  };

  const toggleBlock = (blockId: string) => {
    setExpandedBlocks((prev) => ({ ...prev, [blockId]: !prev[blockId] }));
  };

  return (
    <div className="w-80 sm:w-88 shrink-0 bg-[#2b2d31] border-l border-white/10 flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-[#1db954]" />
          <h3 className="text-sm font-bold text-white">Tocador de Músicas</h3>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1db954]/20 text-[#4ade80]">
            ÁUDIO
          </span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded text-[#949ba4] hover:text-white cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Add URL (YouTube / Spotify / SoundCloud — tracks OR playlists, NO MP3 upload!) */}
      <form onSubmit={handleSubmit} className="p-3 bg-[#232428] border-b border-white/10 space-y-2">
        <div className="flex flex-wrap gap-1 text-[10px] font-bold">
          <span className="px-1.5 py-0.5 rounded border bg-[#ff0000]/20 border-[#ff0000]/35 text-[#ff6b6b]">
            YouTube
          </span>
          <span className="px-1.5 py-0.5 rounded border bg-[#1db954]/20 border-[#1db954]/35 text-[#4ade80]">
            Spotify
          </span>
          <span className="px-1.5 py-0.5 rounded border bg-[#ff5500]/20 border-[#ff5500]/35 text-[#fb923c]">
            SoundCloud
          </span>
          <span className="text-[#949ba4] self-center ml-1">Músicas e Playlists</span>
        </div>

        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Link2 className="w-3.5 h-3.5 text-[#949ba4] absolute left-2.5 top-2.5" />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Link de música ou playlist..."
              disabled={loading}
              className="w-full bg-[#313338] border border-white/10 rounded-lg pl-8 pr-2.5 py-2 text-xs text-white outline-none focus:border-[#1db954]"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !urlInput.trim()}
            className="px-3 py-2 rounded-lg bg-[#1db954] hover:bg-[#179644] disabled:opacity-50 text-[#07110b] text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {loading ? 'Lendo...' : 'Tocar'}
          </button>
        </div>

        {error && (
          <div className="text-[11px] bg-[#f23f42]/15 text-[#ff8b8d] border border-[#f23f42]/40 px-2.5 py-1.5 rounded-lg">
            {error}
          </div>
        )}
      </form>

      {/* Now Playing Audio Card with Cover Artwork */}
      <div className="p-3.5 bg-gradient-to-b from-[#2b2d31] to-[#2b2d31] border-b border-white/10 space-y-2.5">
        <div className="flex items-center gap-3">
          {currentTrack?.thumbnail ? (
            <img
              src={currentTrack.thumbnail}
              alt={currentTrack.title}
              className="w-12 h-12 rounded-lg object-cover border border-white/15 shrink-0 shadow-md"
            />
          ) : (
            <div
              className={`w-12 h-12 rounded-lg bg-[#1db954]/15 border border-[#1db954]/35 flex items-center justify-center shrink-0 ${
                isPlaying ? 'text-[#4ade80]' : 'text-[#949ba4]'
              }`}
            >
              <Disc3 className={`w-7 h-7 ${isPlaying ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-white truncate">
              {currentTrack ? currentTrack.title : 'Nenhuma música tocando'}
            </div>
            <div className="text-xs text-[#949ba4] truncate">
              {currentTrack
                ? `${currentTrack.artist} • por ${currentTrack.addedBy || 'Amigo'}`
                : 'Somente áudio • sem vídeo'}
            </div>
          </div>
        </div>

        {/* Seek Bar (Instant 0ms Sync) */}
        <div className="space-y-1">
          <input
            type="range"
            min={0}
            max={durationSec > 0 ? durationSec : 100}
            step={0.25}
            value={Math.min(currentSec, durationSec || 100)}
            disabled={!currentTrack || !durationSec}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="w-full h-1.5 accent-[#1db954] cursor-pointer disabled:opacity-40"
          />
          <div className="flex justify-between text-[10px] font-mono text-[#949ba4]">
            <span>{formatSec(currentSec)}</span>
            <span>{durationSec > 0 ? formatSec(durationSec) : formatSec(currentTrack?.duration)}</span>
          </div>
        </div>

        {/* Transport Controls */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={cycleLoop}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                loopMode !== 'none' ? 'text-[#4ade80] bg-[#1db954]/15' : 'text-[#949ba4] hover:text-white'
              }`}
              title={
                loopMode === 'none'
                  ? 'Repetição desativada'
                  : loopMode === 'all'
                  ? 'Repetir fila toda'
                  : 'Repetir faixa atual'
              }
            >
              {loopMode === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onPrev}
              disabled={queue.length === 0}
              className="p-1.5 rounded-lg text-[#dbdee1] hover:bg-[#383a40] disabled:opacity-40 cursor-pointer"
              title="Faixa anterior"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => currentTrack && onSeek(Math.max(0, currentSec - 10))}
              disabled={!currentTrack}
              className="px-1.5 py-1 rounded-lg text-[10px] font-bold text-[#dbdee1] hover:bg-[#383a40] disabled:opacity-40 cursor-pointer"
              title="Voltar 10s para todos"
            >
              -10s
            </button>
            <button
              type="button"
              onClick={() => (isPlaying ? onPause() : onPlay())}
              disabled={queue.length === 0}
              className="w-9 h-9 rounded-full bg-[#1db954] hover:bg-[#179644] disabled:opacity-40 text-[#07110b] flex items-center justify-center shadow-lg transition cursor-pointer"
              title={isPlaying ? 'Pausar para todos' : 'Tocar para todos'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <button
              type="button"
              onClick={() => currentTrack && onSeek(currentSec + 10)}
              disabled={!currentTrack}
              className="px-1.5 py-1 rounded-lg text-[10px] font-bold text-[#dbdee1] hover:bg-[#383a40] disabled:opacity-40 cursor-pointer"
              title="Avançar 10s para todos"
            >
              +10s
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={queue.length === 0}
              className="p-1.5 rounded-lg text-[#dbdee1] hover:bg-[#383a40] disabled:opacity-40 cursor-pointer"
              title="Próxima faixa"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1 flex-1 max-w-[96px]" title="Volume individual (apenas seu fone)">
            <Volume2 className="w-3.5 h-3.5 text-[#949ba4] shrink-0" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="w-full accent-[#1db954] cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Queue with Collapsible Playlist Blocks! */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {queue.length > 0 && (
          <div className="flex items-center justify-between text-[11px] text-[#949ba4]">
            <span className="font-semibold">Fila Sincronizada ({queue.length} faixas)</span>
            <button type="button" onClick={onClearQueue} className="text-[#f23f42] hover:underline cursor-pointer">
              Limpar tudo
            </button>
          </div>
        )}

        {queue.length === 0 ? (
          <div className="text-center py-9 space-y-2 px-3">
            <ListMusic className="w-8 h-8 text-[#1db954] mx-auto opacity-80" />
            <p className="text-xs font-bold text-white">Rádio da Galera (Somente Áudio)</p>
            <p className="text-[11px] text-[#949ba4] leading-relaxed">
              Cole uma música ou playlist do <strong>YouTube, Spotify ou SoundCloud</strong> acima. Playlists aparecem
              em blocos expansíveis para você ver todas as faixas!
            </p>
          </div>
        ) : (
          queueNodes.map((node) => {
            if (node.kind === 'single') {
              const { track, index } = node;
              const active = index === currentIndex;
              const pMeta = PLATFORM_BADGES[track.platform || 'youtube'] || PLATFORM_BADGES.youtube;
              return (
                <div
                  key={track.queueId || `${track.id}-${index}`}
                  onClick={() => onPlay(index)}
                  className={`group flex items-center gap-2.5 p-2 rounded-lg border transition cursor-pointer ${
                    active
                      ? 'bg-[#1db954]/15 border-[#1db954]/50 shadow'
                      : 'bg-[#313338] border-white/5 hover:border-white/15 hover:bg-[#2b2d31]'
                  }`}
                >
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-[#232428] shrink-0 border border-white/10 flex items-center justify-center">
                    {track.thumbnail ? (
                      <img src={track.thumbnail} alt={track.title} className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-4 h-4 text-[#949ba4]" />
                    )}
                    {active && isPlaying && (
                      <div className="absolute inset-0 bg-black/50 flex items-end justify-center gap-0.5 pb-1.5">
                        <span className="w-1 h-2.5 bg-[#4ade80] rounded-full eq-bar" />
                        <span className="w-1 h-4 bg-[#4ade80] rounded-full eq-bar" style={{ animationDelay: '0.2s' }} />
                        <span className="w-1 h-2 bg-[#4ade80] rounded-full eq-bar" style={{ animationDelay: '0.4s' }} />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate">{track.title}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-[9px] font-bold px-1.5 rounded border ${pMeta.cls}`}>{pMeta.label}</span>
                      <span className="text-[10px] text-[#949ba4] truncate">{track.artist}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFromQueue(index);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-[#949ba4] hover:text-[#f23f42] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            }

            // Playlist Dropdown Block!
            const containsActive = node.items.some((x) => x.index === currentIndex);
            const isOpen = expandedBlocks[node.blockId] ?? containsActive;
            const pMeta = PLATFORM_BADGES[node.platform] || PLATFORM_BADGES.youtube;

            return (
              <div
                key={node.blockId}
                className={`rounded-lg border overflow-hidden transition ${
                  containsActive
                    ? 'bg-[#141a22] border-[#1db954]/50 shadow-md'
                    : 'bg-[#313338] border-white/10'
                }`}
              >
                {/* Playlist Block Header (click to expand dropdown!) */}
                <div
                  onClick={() => toggleBlock(node.blockId)}
                  className="flex items-center gap-2.5 p-2.5 hover:bg-white/[0.04] cursor-pointer select-none"
                >
                  <button type="button" className="text-[#949ba4] shrink-0">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>

                  {node.thumbnail ? (
                    <img
                      src={node.thumbnail}
                      alt={node.title}
                      className="w-10 h-10 rounded-lg object-cover border border-white/10 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-[#383a40] flex items-center justify-center shrink-0">
                      <ListMusic className="w-5 h-5 text-[#4ade80]" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate">{node.title}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-[9px] font-bold px-1.5 rounded border ${pMeta.cls}`}>
                        Playlist • {pMeta.label}
                      </span>
                      <span className="text-[10px] text-[#949ba4] font-semibold">
                        {node.items.length} músicas
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemovePlaylistBlock(node.blockId);
                    }}
                    className="p-1.5 rounded text-[#949ba4] hover:text-[#f23f42] hover:bg-white/5 cursor-pointer"
                    title="Remover bloco da playlist"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Expanded Dropdown Tracklist inside the Playlist Block */}
                {isOpen && (
                  <div className="border-t border-white/5 bg-[#232428]/80 p-1.5 space-y-1 max-h-64 overflow-y-auto">
                    {node.items.map(({ index, track }, subIdx) => {
                      const active = index === currentIndex;
                      return (
                        <div
                          key={track.queueId || `${track.id}-${index}`}
                          onClick={() => onPlay(index)}
                          className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition ${
                            active
                              ? 'bg-[#1db954]/20 text-white'
                              : 'hover:bg-[#2b2d31] text-[#dbdee1]'
                          }`}
                        >
                          <span className="w-5 text-[10px] font-mono text-[#949ba4] shrink-0 text-center">
                            {active && isPlaying ? '▶' : subIdx + 1}
                          </span>
                          {track.thumbnail && (
                            <img
                              src={track.thumbnail}
                              alt={track.title}
                              className="w-7 h-7 rounded object-cover shrink-0 border border-white/10"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-semibold truncate">{track.title}</div>
                            <div className="text-[10px] text-[#949ba4] truncate">
                              {track.artist}
                              {track.duration ? ` • ${formatSec(track.duration)}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveFromQueue(index);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-[#949ba4] hover:text-[#f23f42] cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
