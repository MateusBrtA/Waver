import React, { useEffect, useRef, useState } from 'react';
import {
  Clapperboard,
  ExternalLink,
  Loader2,
  Maximize2,
  Music,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ApiClient, normalizeServerUrl, resolveMediaUrl } from '../lib/api';
import { MediaEmbedInfo } from '../types';

const MEDIA_URL_REGEX =
  /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?(?:youtube\.com|youtu\.be|music\.youtube\.com|twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com|instagram\.com|tiktok\.com|open\.spotify\.com|soundcloud\.com)\/[^\s<>"']+/gi;

export function extractEmbeddableMediaUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(MEDIA_URL_REGEX) || [];
  return Array.from(new Set(matches.map((u) => u.replace(/[),.!?;:]+$/, '')))).slice(0, 3);
}

function extractClientYoutubeId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live')) {
        return /^[a-zA-Z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

interface LinkEmbedCardProps {
  url: string;
  api?: ApiClient | null;
  serverUrl: string;
  inVoiceCall: boolean;
  onSendToVoiceVideo?: (url: string) => void;
  onSendToVoiceMusic?: (url: string) => void;
}

export const LinkEmbedCard: React.FC<LinkEmbedCardProps> = ({
  url,
  api = null,
  serverUrl,
  inVoiceCall,
  onSendToVoiceVideo,
  onSendToVoiceMusic,
}) => {
  const [embed, setEmbed] = useState<MediaEmbedInfo | null>(null);
  const [loadingPlay, setLoadingPlay] = useState(false);
  const [ytActive, setYtActive] = useState(false);
  const [ytFallback, setYtFallback] = useState(false);
  const [streamSrc, setStreamSrc] = useState<string>('');
  const [audioSrc, setAudioSrc] = useState<string>('');
  const [mutedInline, setMutedInline] = useState(false);
  const [inlineVol, setInlineVol] = useState(0.85);
  const [inlinePlaying, setInlinePlaying] = useState(true);
  const [inlineCurSec, setInlineCurSec] = useState(0);
  const [inlineDurSec, setInlineDurSec] = useState(0);
  const [streamKind, setStreamKind] = useState<'video' | 'audio'>('video');
  const [playError, setPlayError] = useState('');
  const inlineAudioRef = useRef<HTMLAudioElement | null>(null);
  const inlineVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!api) {
      const ytId = extractClientYoutubeId(url);
      if (ytId) {
        setEmbed({
          url,
          platform: 'youtube',
          providerName: 'YouTube',
          authorName: 'YouTube',
          title: 'Vídeo do YouTube',
          thumbnailUrl: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
          duration: 0,
          youtubeId: ytId,
          accentColor: '#ff0033',
          canPlayVideo: true,
          canPlayAudio: true,
        });
      }
      return;
    }
    api
      .unfurlMediaUrl(url)
      .then((res) => {
        if (!cancelled && res.embed) setEmbed(res.embed);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url, api]);

  if (!embed) return null;

  const formatMmSs = (sec: number) => {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleInlinePlay = async (forceDirectStream = false) => {
    // Prefer official interactive YouTube embed directly inside the chat card whenever embeddable!
    if (embed.youtubeId && !ytFallback && !forceDirectStream) {
      setPlayError('');
      setStreamSrc('');
      setAudioSrc('');
      setYtActive(true);
      return;
    }

    setYtActive(false);
    if (!api) {
      setPlayError('Stream direto disponível apenas conectado a um servidor.');
      return;
    }
    setLoadingPlay(true);
    setPlayError('');
    try {
      const mode: 'video' | 'audio' = embed.canPlayVideo ? 'video' : 'audio';
      const res = await api.resolveMediaUrl(url, mode);
      if (mode === 'video' && res.video?.streamPath) {
        setStreamKind('video');
        setStreamSrc(resolveMediaUrl(serverUrl, res.video.streamPath));
        setAudioSrc(res.video.audioStreamPath ? resolveMediaUrl(serverUrl, res.video.audioStreamPath) : '');
      } else if (res.track?.url) {
        setStreamKind('audio');
        setStreamSrc(resolveMediaUrl(serverUrl, res.track.url));
        setAudioSrc('');
      } else if (res.tracks?.[0]?.url) {
        setStreamKind('audio');
        setStreamSrc(resolveMediaUrl(serverUrl, res.tracks[0].url));
        setAudioSrc('');
      } else {
        throw new Error('Link sem fluxo direto reproduzível inline.');
      }
    } catch (err: unknown) {
      setPlayError((err as Error).message || 'Erro ao carregar player inline.');
    } finally {
      setLoadingPlay(false);
    }
  };

  const seekInlineVideo = (sec: number) => {
    const v = inlineVideoRef.current;
    const aud = inlineAudioRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(inlineDurSec || v.duration || 99999, sec));
    v.currentTime = clamped;
    if (aud && audioSrc) {
      try {
        aud.currentTime = clamped;
      } catch {}
    }
    setInlineCurSec(clamped);
  };

  return (
    <div
      className="mt-2 max-w-[460px] rounded-lg bg-[#2b2d31] border border-[#383a40] overflow-hidden shadow-lg"
      style={{ borderLeftWidth: '4px', borderLeftColor: embed.accentColor || '#5865f2' }}
    >
      <div className="p-3 space-y-2">
        {/* Provider + Author */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-[#949ba4]">{embed.providerName}</div>
            <div className="text-xs font-bold text-white truncate">{embed.authorName}</div>
          </div>

          {inVoiceCall && (
            <div className="flex items-center gap-1 shrink-0">
              {embed.canPlayVideo && onSendToVoiceVideo && (
                <button
                  type="button"
                  onClick={() => onSendToVoiceVideo(url)}
                  className="px-2 py-1 rounded bg-[#383a40] hover:bg-[#ff0033] text-[10px] font-bold text-[#dbdee1] hover:text-white flex items-center gap-1 transition cursor-pointer"
                  title="Tocar este vídeo na chamada (Watch-Party)"
                >
                  <Clapperboard className="w-3 h-3" />
                  Tocar Vídeo
                </button>
              )}
              {embed.canPlayAudio && onSendToVoiceMusic && (
                <button
                  type="button"
                  onClick={() => onSendToVoiceMusic(url)}
                  className="px-2 py-1 rounded bg-[#383a40] hover:bg-[#1db954] text-[10px] font-bold text-[#dbdee1] hover:text-white flex items-center gap-1 transition cursor-pointer"
                  title="Enviar áudio/playlist para o Tocador de Músicas"
                >
                  <Music className="w-3 h-3" />
                  Música
                </button>
              )}
            </div>
          )}
        </div>

        {/* Blue clickable title */}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block text-[13px] font-bold text-[#00a8fc] hover:underline leading-snug line-clamp-2"
        >
          {embed.title}
        </a>

        {/* Official YouTube Player OR Custom YouTube-Style Direct Stream OR Thumbnail */}
        {ytActive && embed.youtubeId ? (
          <div className="relative rounded-lg overflow-hidden bg-black aspect-video border border-white/10">
            <iframe
              src={
                /^https?:\/\//i.test(normalizeServerUrl(serverUrl))
                  ? `${normalizeServerUrl(serverUrl)}/api/media/yt-embed/${encodeURIComponent(embed.youtubeId)}`
                  : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(embed.youtubeId)}?autoplay=1&rel=0&modestbranding=1`
              }
              title={embed.title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              onLoad={(e) => {
                // Auto-play on YouTube iframe bridge once ready
                const win = (e.currentTarget as HTMLIFrameElement).contentWindow;
                window.setTimeout(() => {
                  try {
                    win?.postMessage({ target: 'pulsecord-yt', cmd: 'play' }, '*');
                  } catch {}
                }, 700);
              }}
              className="w-full h-full border-0"
            />
            <button
              type="button"
              onClick={() => {
                setYtFallback(true);
                handleInlinePlay(true);
              }}
              className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/75 hover:bg-[#ff0033] text-[10px] font-bold text-white/90 cursor-pointer"
              title="Alternar para stream direto 1080p (caso o vídeo bloqueie incorporação)"
            >
              Player Direto
            </button>
          </div>
        ) : streamSrc ? (
          streamKind === 'video' ? (
            <div className="relative rounded-lg overflow-hidden bg-black group border border-white/10">
              <video
                ref={inlineVideoRef}
                src={streamSrc}
                autoPlay
                playsInline
                muted={Boolean(audioSrc) || mutedInline}
                onClick={() => {
                  const v = inlineVideoRef.current;
                  if (!v) return;
                  if (v.paused) v.play().catch(() => {});
                  else v.pause();
                }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget as HTMLVideoElement;
                  setInlineDurSec(v.duration || 0);
                  v.volume = audioSrc ? 0 : mutedInline ? 0 : inlineVol;
                }}
                onPlay={(e) => {
                  setInlinePlaying(true);
                  const v = e.currentTarget as HTMLVideoElement;
                  const aud = inlineAudioRef.current;
                  if (aud && audioSrc) {
                    try {
                      if (Math.abs((aud.currentTime || 0) - (v.currentTime || 0)) > 0.15) {
                        aud.currentTime = v.currentTime || 0;
                      }
                    } catch {}
                    aud.volume = mutedInline ? 0 : inlineVol;
                    aud.play().catch(() => {});
                  }
                }}
                onPause={() => {
                  setInlinePlaying(false);
                  inlineAudioRef.current?.pause();
                }}
                onWaiting={() => inlineAudioRef.current?.pause()}
                onPlaying={(e) => {
                  setInlinePlaying(true);
                  const v = e.currentTarget as HTMLVideoElement;
                  const aud = inlineAudioRef.current;
                  if (aud && audioSrc) {
                    if (Math.abs((aud.currentTime || 0) - (v.currentTime || 0)) > 0.15) {
                      try {
                        aud.currentTime = v.currentTime || 0;
                      } catch {}
                    }
                    aud.play().catch(() => {});
                  }
                }}
                onSeeked={(e) => {
                  const v = e.currentTarget as HTMLVideoElement;
                  const aud = inlineAudioRef.current;
                  if (aud && audioSrc) {
                    try {
                      aud.currentTime = v.currentTime || 0;
                    } catch {}
                  }
                }}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget as HTMLVideoElement;
                  setInlineCurSec(v.currentTime || 0);
                  const aud = inlineAudioRef.current;
                  if (aud && audioSrc && !v.paused && Math.abs((aud.currentTime || 0) - (v.currentTime || 0)) > 0.25) {
                    try {
                      aud.currentTime = v.currentTime || 0;
                    } catch {}
                  }
                }}
                onEnded={() => {
                  setInlinePlaying(false);
                  inlineAudioRef.current?.pause();
                }}
                className="w-full max-h-64 rounded-lg bg-black cursor-pointer"
              />
              {audioSrc && <audio ref={inlineAudioRef} src={audioSrc} muted={mutedInline} preload="auto" />}

              {/* YouTube-style overlay control bar */}
              <div className="bg-gradient-to-t from-black/95 via-black/75 to-transparent px-2.5 pt-3 pb-2 space-y-1">
                <input
                  type="range"
                  min={0}
                  max={inlineDurSec > 0 ? inlineDurSec : 100}
                  step={0.5}
                  value={Math.min(inlineCurSec, inlineDurSec || 100)}
                  onChange={(e) => seekInlineVideo(Number(e.target.value))}
                  className="w-full h-1 accent-[#ff0033] cursor-pointer"
                />
                <div className="flex items-center justify-between gap-2 text-white">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const v = inlineVideoRef.current;
                        if (!v) return;
                        if (v.paused) v.play().catch(() => {});
                        else v.pause();
                      }}
                      className="p-1 hover:text-[#ff0033] cursor-pointer"
                    >
                      {inlinePlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => seekInlineVideo(inlineCurSec - 10)}
                      className="p-1 text-[10px] font-bold hover:text-[#ff0033] cursor-pointer flex items-center"
                      title="Voltar 10s"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => seekInlineVideo(inlineCurSec + 10)}
                      className="p-1 text-[10px] font-bold hover:text-[#ff0033] cursor-pointer flex items-center"
                      title="Avançar 10s"
                    >
                      <RotateCw className="w-3 h-3" />
                    </button>
                    <span className="text-[10px] font-mono text-white/80 ml-1">
                      {formatMmSs(inlineCurSec)} / {formatMmSs(inlineDurSec)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setMutedInline((prev) => !prev)}
                      className="p-1 hover:text-[#ff0033] cursor-pointer"
                      title="Volume individual"
                    >
                      {mutedInline || inlineVol === 0 ? (
                        <VolumeX className="w-3.5 h-3.5 text-[#ff0033]" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={mutedInline ? 0 : inlineVol}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setInlineVol(val);
                        setMutedInline(val === 0);
                        if (inlineVideoRef.current && !audioSrc) inlineVideoRef.current.volume = val;
                        if (inlineAudioRef.current) inlineAudioRef.current.volume = val;
                      }}
                      className="w-14 h-1 accent-[#ff0033] cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => inlineVideoRef.current?.requestFullscreen?.().catch(() => {})}
                      className="p-1 hover:text-[#ff0033] cursor-pointer"
                      title="Tela cheia"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[#0d1017] rounded-lg p-2.5 border border-[#383a40]">
              <audio src={streamSrc} controls autoPlay className="w-full h-9" />
            </div>
          )
        ) : embed.thumbnailUrl ? (
          <div className="relative rounded-lg overflow-hidden bg-black aspect-video group">
            <img src={embed.thumbnailUrl} alt={embed.title} className="w-full h-full object-cover" loading="lazy" />
            <div className="absolute inset-0 bg-black/25 group-hover:bg-black/40 transition flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => handleInlinePlay(false)}
                disabled={loadingPlay}
                className="w-14 h-10 rounded-lg bg-[#ff0033]/90 hover:bg-[#ff0033] text-white flex items-center justify-center shadow-xl transition cursor-pointer"
                title="Reproduzir aqui no chat"
              >
                {loadingPlay ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 rounded-lg bg-black/80 hover:bg-black text-white flex items-center justify-center shadow-xl"
                title="Abrir no navegador"
              >
                <PictureInPicture2 className="w-4 h-4" />
              </a>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleInlinePlay(false)}
              disabled={loadingPlay}
              className="px-3 py-1.5 rounded-lg bg-[#383a40] hover:bg-[#ff0033] text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer"
            >
              {loadingPlay ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Reproduzir Mídia
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[#949ba4] hover:text-white flex items-center gap-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Abrir link
            </a>
          </div>
        )}

        {playError && <div className="text-[11px] text-[#f23f42]">{playError}</div>}
      </div>
    </div>
  );
};
