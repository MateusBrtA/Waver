import React, { useEffect, useMemo, useRef } from 'react';
import { normalizeServerUrl } from '../lib/api';

interface YouTubeSyncPlayerProps {
  youtubeId: string;
  serverUrl?: string;
  isPlaying: boolean;
  positionSec: number;
  serverNow: number;
  clockOffsetMs?: number;
  seq?: number;
  lastAction?: string;
  volume: number;
  deafened?: boolean;
  interactiveControls?: boolean;
  onTimeUpdate?: (curSec: number, durSec: number) => void;
  onEnded?: () => void;
  onFallbackNeeded: () => void;
  className?: string;
}

export const YouTubeSyncPlayer: React.FC<YouTubeSyncPlayerProps> = ({
  youtubeId,
  serverUrl,
  isPlaying,
  positionSec,
  serverNow,
  clockOffsetMs = 0,
  seq = 0,
  lastAction,
  volume,
  deafened = false,
  interactiveControls = false,
  onTimeUpdate,
  onEnded,
  onFallbackNeeded,
  className = 'w-full h-full',
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const lastSeqRef = useRef(-1);
  const curTimeRef = useRef(0);
  const durRef = useRef(0);
  const endedSentRef = useRef(false);
  const fallbackCalledRef = useRef(false);

  const iframeSrc = useMemo(() => {
    if (serverUrl && /^https?:\/\//i.test(normalizeServerUrl(serverUrl))) {
      return `${normalizeServerUrl(serverUrl)}/api/media/yt-embed/${encodeURIComponent(youtubeId)}`;
    }
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?enablejsapi=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3`;
  }, [youtubeId, serverUrl]);

  const sendCmd = (cmd: 'play' | 'pause' | 'seek' | 'volume', extra: Record<string, number> = {}) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (iframeSrc.includes('/api/media/yt-embed/')) {
      win.postMessage({ target: 'pulsecord-yt', cmd, ...extra }, '*');
    } else {
      // Direct YouTube IFrame API JSON postMessage fallback when no HTTP bridge is active
      const fnMap: Record<string, string> = {
        play: 'playVideo',
        pause: 'pauseVideo',
        seek: 'seekTo',
        volume: 'setVolume',
      };
      const args =
        cmd === 'seek'
          ? [extra.sec || 0, true]
          : cmd === 'volume'
          ? [Math.round((extra.volume || 0) * 100)]
          : [];
      win.postMessage(JSON.stringify({ event: 'command', func: fnMap[cmd], args }), '*');
    }
  };

  useEffect(() => {
    readyRef.current = false;
    endedSentRef.current = false;
    fallbackCalledRef.current = false;
    curTimeRef.current = 0;

    // Auto-fallback to direct 1080p stream if iframe does not boot cleanly inside 6s
    const bootTimer = window.setTimeout(() => {
      if (!readyRef.current && !fallbackCalledRef.current) {
        fallbackCalledRef.current = true;
        onFallbackNeeded();
      }
    }, 6000);

    const onMsg = (ev: MessageEvent) => {
      let data = ev.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data) return;

      // Official bridge messages from /api/media/yt-embed/:videoId
      if (data.source === 'pulsecord-yt') {
        if (data.event === 'ready') {
          readyRef.current = true;
          window.clearTimeout(bootTimer);
          durRef.current = Number(data.duration || 0);
          sendCmd('volume', { volume: deafened ? 0 : volume });
          const alignedNow = Date.now() + clockOffsetMs;
          const lat = Math.max(0, (alignedNow - serverNow) / 1000);
          const target = isPlaying ? positionSec + Math.min(lat, 1.5) : positionSec;
          if (target > 0.4) sendCmd('seek', { sec: target });
          if (isPlaying) sendCmd('play');
          else sendCmd('pause');
        } else if (data.event === 'time' || data.event === 'state') {
          readyRef.current = true;
          window.clearTimeout(bootTimer);
          const c = Number(data.currentTime || 0);
          const d = Number(data.duration || durRef.current || 0);
          curTimeRef.current = c;
          if (d > 0) durRef.current = d;
          onTimeUpdate?.(c, d);
          if (data.event === 'state' && data.state === 0 && !endedSentRef.current) {
            endedSentRef.current = true;
            onEnded?.();
          } else if (data.event === 'state' && data.state === 1) {
            endedSentRef.current = false;
          }
        } else if (data.event === 'error') {
          if (!fallbackCalledRef.current) {
            fallbackCalledRef.current = true;
            onFallbackNeeded();
          }
        }
      }
    };

    window.addEventListener('message', onMsg);
    return () => {
      window.clearTimeout(bootTimer);
      window.removeEventListener('message', onMsg);
    };
  }, [youtubeId, iframeSrc]);

  // Apply individual volume immediately
  useEffect(() => {
    if (!readyRef.current) return;
    sendCmd('volume', { volume: deafened ? 0 : Math.max(0, Math.min(1, volume)) });
  }, [volume, deafened]);

  // Apply play/pause/seek state sync
  useEffect(() => {
    if (!readyRef.current) return;
    const isNewSeq = seq !== lastSeqRef.current;
    lastSeqRef.current = seq;
    const alignedNow = Date.now() + clockOffsetMs;
    const lat = Math.max(0, (alignedNow - serverNow) / 1000);
    const target = isPlaying ? positionSec + Math.min(lat, 1.5) : positionSec;
    const driftThreshold = isNewSeq && (lastAction === 'seek' || lastAction === 'track') ? 0.25 : 1.35;

    if (Number.isFinite(target) && Math.abs(curTimeRef.current - target) > driftThreshold) {
      sendCmd('seek', { sec: target });
      curTimeRef.current = target;
    }
    if (isPlaying) {
      sendCmd('play');
    } else {
      sendCmd('pause');
    }
  }, [isPlaying, positionSec, serverNow, seq, lastAction, clockOffsetMs]);

  return (
    <div className={`relative bg-black ${className}`}>
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        title="YouTube Player"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        className={`w-full h-full border-0 ${interactiveControls ? '' : 'pointer-events-none'}`}
      />
    </div>
  );
};
