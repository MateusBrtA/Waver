import React, { useEffect, useMemo, useRef } from 'react';
import { normalizeServerUrl } from '../lib/api';

export interface CaptionTrack {
  code: string;
  name: string;
}

interface YouTubeSyncPlayerProps {
  youtubeId: string;
  serverUrl?: string;
  isPlaying: boolean;
  positionSec: number;
  serverNow: number;
  clockOffsetMs?: number;
  receivedAt?: number;
  seq?: number;
  lastAction?: string;
  /** velocidade da sala (sincronizada) */
  rate?: number;
  volume: number;
  deafened?: boolean;
  /** legenda individual: só neste PC */
  captionsOn?: boolean;
  captionsLang?: string;
  interactiveControls?: boolean;
  onTimeUpdate?: (curSec: number, durSec: number) => void;
  /** o player chegou ao fim (manda a duração para o servidor conferir com o tempo da sala) */
  onEnded?: (durationSec: number) => void;
  onFallbackNeeded: () => void;
  onCaptionTracks?: (tracks: CaptionTrack[]) => void;
  className?: string;
}

/** Posição esperada agora: posição do servidor + tempo decorrido × velocidade (sem teto — teto fazia o vídeo voltar). */
export function expectedVideoPosition(
  positionSec: number,
  serverNow: number,
  clockOffsetMs: number,
  isPlaying: boolean,
  rate = 1,
  receivedAt?: number
) {
  if (!isPlaying) return positionSec;
  const r = rate > 0 ? rate : 1;
  if (receivedAt && receivedAt > 0) {
    // Conta o tempo a partir da CHEGADA (relógio local, sempre confiável) + o trânsito da rede,
    // limitado a 2 s. Assim um relógio mal sincronizado não desloca o vídeo, e reexecutar o efeito
    // depois não faz o vídeo voltar.
    const transit = Math.min(2, Math.max(0, (receivedAt + clockOffsetMs - serverNow) / 1000));
    const sinceArrival = Math.max(0, (Date.now() - receivedAt) / 1000);
    return positionSec + (transit + Math.min(sinceArrival, 6 * 3600)) * r;
  }
  const elapsed = Math.max(0, (Date.now() + clockOffsetMs - serverNow) / 1000);
  return positionSec + Math.min(elapsed, 6 * 3600) * r;
}

export const YouTubeSyncPlayer: React.FC<YouTubeSyncPlayerProps> = ({
  youtubeId,
  serverUrl,
  isPlaying,
  positionSec,
  serverNow,
  clockOffsetMs = 0,
  receivedAt,
  seq = 0,
  lastAction,
  rate = 1,
  volume,
  deafened = false,
  captionsOn = false,
  captionsLang = '',
  interactiveControls = false,
  onTimeUpdate,
  onEnded,
  onFallbackNeeded,
  onCaptionTracks,
  className = 'w-full h-full',
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const lastSeqRef = useRef(-1);
  const curTimeRef = useRef(0);
  const durRef = useRef(0);
  const endedSentRef = useRef(false);
  const fallbackCalledRef = useRef(false);
  // player parado sozinho enquanto a sala está tocando (janela em segundo plano, buffer, YouTube travou)
  const stalledSinceRef = useRef(0);
  const lastResumeRef = useRef(0);

  // valores mais recentes para o handler de "ready" (que é registrado uma vez por vídeo)
  const latest = useRef({ isPlaying, positionSec, serverNow, clockOffsetMs, receivedAt, rate, volume, deafened, captionsOn, captionsLang });
  latest.current = { isPlaying, positionSec, serverNow, clockOffsetMs, receivedAt, rate, volume, deafened, captionsOn, captionsLang };
  const cbs = useRef({ onTimeUpdate, onEnded, onFallbackNeeded, onCaptionTracks });
  cbs.current = { onTimeUpdate, onEnded, onFallbackNeeded, onCaptionTracks };

  const usesBridge = Boolean(serverUrl && /^https?:\/\//i.test(normalizeServerUrl(serverUrl)));
  const iframeSrc = useMemo(() => {
    if (usesBridge && serverUrl) {
      return `${normalizeServerUrl(serverUrl)}/api/media/yt-embed/${encodeURIComponent(youtubeId)}`;
    }
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?enablejsapi=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&controls=0&disablekb=1&fs=0`;
  }, [youtubeId, serverUrl, usesBridge]);

  const sendCmd = (
    cmd: 'play' | 'pause' | 'seek' | 'volume' | 'rate' | 'captions',
    extra: Record<string, number | string | boolean> = {}
  ) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (usesBridge) {
      win.postMessage({ target: 'pulsecord-yt', cmd, ...extra }, '*');
      return;
    }
    // API JSON do iframe oficial (sem a ponte do servidor)
    const fnMap: Record<string, string> = {
      play: 'playVideo',
      pause: 'pauseVideo',
      seek: 'seekTo',
      volume: 'setVolume',
      rate: 'setPlaybackRate',
    };
    if (!fnMap[cmd]) return;
    const args =
      cmd === 'seek'
        ? [Number(extra.sec) || 0, true]
        : cmd === 'volume'
        ? [Math.round((Number(extra.volume) || 0) * 100)]
        : cmd === 'rate'
        ? [Number(extra.rate) || 1]
        : [];
    win.postMessage(JSON.stringify({ event: 'command', func: fnMap[cmd], args }), '*');
  };

  useEffect(() => {
    readyRef.current = false;
    endedSentRef.current = false;
    fallbackCalledRef.current = false;
    curTimeRef.current = 0;

    // Se o iframe não subir em 8 s, usa o stream direto (quando existir)
    const bootTimer = window.setTimeout(() => {
      if (!readyRef.current && !fallbackCalledRef.current) {
        fallbackCalledRef.current = true;
        cbs.current.onFallbackNeeded();
      }
    }, 8000);

    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      let data = ev.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || data.source !== 'pulsecord-yt') return;
      const L = latest.current;

      if (data.event === 'ready') {
        readyRef.current = true;
        window.clearTimeout(bootTimer);
        durRef.current = Number(data.duration || 0);
        sendCmd('volume', { volume: L.deafened ? 0 : L.volume });
        sendCmd('rate', { rate: L.rate });
        if (L.captionsOn) sendCmd('captions', { on: true, lang: L.captionsLang });
        const target = expectedVideoPosition(L.positionSec, L.serverNow, L.clockOffsetMs, L.isPlaying, L.rate, L.receivedAt);
        if (target > 0.4) sendCmd('seek', { sec: target });
        sendCmd(L.isPlaying ? 'play' : 'pause');
      } else if (data.event === 'time' || data.event === 'state') {
        readyRef.current = true;
        window.clearTimeout(bootTimer);
        const c = Number(data.currentTime || 0);
        const d = Number(data.duration || durRef.current || 0);
        curTimeRef.current = c;
        if (d > 0) durRef.current = d;
        cbs.current.onTimeUpdate?.(c, d);
        if (data.event === 'state' && data.state === 0 && !endedSentRef.current) {
          endedSentRef.current = true;
          cbs.current.onEnded?.(d);
        } else if (data.event === 'state' && data.state === 1) {
          endedSentRef.current = false;
        }
        // A sala está tocando mas este player parou sozinho (pausado=2, não iniciado=-1, carregado=5, ou "fim"
        // antes da hora): volta a tocar na posição da sala. Nada disso é enviado para os outros.
        const st = Number(data.state);
        const target = expectedVideoPosition(L.positionSec, L.serverNow, L.clockOffsetMs, L.isPlaying, L.rate, L.receivedAt);
        const stoppedEarly = st === 0 && d > 0 && target < d - 6;
        if (L.isPlaying && (st === 2 || st === -1 || st === 5 || stoppedEarly)) {
          const now = Date.now();
          if (!stalledSinceRef.current) stalledSinceRef.current = now;
          if (now - stalledSinceRef.current > 1200 && now - lastResumeRef.current > 2500) {
            lastResumeRef.current = now;
            if (Number.isFinite(target) && Math.abs(c - target) > 1.5) sendCmd('seek', { sec: target });
            sendCmd('play');
            if (stoppedEarly) endedSentRef.current = false;
          }
        } else {
          stalledSinceRef.current = 0;
        }
      } else if (data.event === 'captions') {
        cbs.current.onCaptionTracks?.(Array.isArray(data.tracks) ? data.tracks : []);
      } else if (data.event === 'error') {
        if (!fallbackCalledRef.current) {
          fallbackCalledRef.current = true;
          cbs.current.onFallbackNeeded();
        }
      }
    };

    window.addEventListener('message', onMsg);
    return () => {
      window.clearTimeout(bootTimer);
      window.removeEventListener('message', onMsg);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeId, iframeSrc]);

  // Voltou do segundo plano (janela restaurada/focada): confere a posição e retoma se a sala está tocando
  useEffect(() => {
    const resync = () => {
      if (!readyRef.current || document.visibilityState === 'hidden') return;
      const L = latest.current;
      const target = expectedVideoPosition(L.positionSec, L.serverNow, L.clockOffsetMs, L.isPlaying, L.rate, L.receivedAt);
      if (Number.isFinite(target) && Math.abs(curTimeRef.current - target) > 1.5) sendCmd('seek', { sec: target });
      sendCmd(L.isPlaying ? 'play' : 'pause');
      sendCmd('volume', { volume: L.deafened ? 0 : Math.max(0, Math.min(1, L.volume)) });
    };
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', resync);
    return () => {
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', resync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeSrc]);

  // Volume individual: não mexe em posição
  useEffect(() => {
    if (!readyRef.current) return;
    sendCmd('volume', { volume: deafened ? 0 : Math.max(0, Math.min(1, volume)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, deafened]);

  useEffect(() => {
    if (!readyRef.current) return;
    sendCmd('rate', { rate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);

  useEffect(() => {
    if (!readyRef.current) return;
    sendCmd('captions', { on: captionsOn, lang: captionsLang });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captionsOn, captionsLang]);

  // Play/pause/seek da sala
  useEffect(() => {
    if (!readyRef.current) return;
    const isNewSeq = seq !== lastSeqRef.current;
    lastSeqRef.current = seq;
    const target = expectedVideoPosition(positionSec, serverNow, clockOffsetMs, isPlaying, rate, receivedAt);
    const driftThreshold = isNewSeq && (lastAction === 'seek' || lastAction === 'track') ? 0.25 : 1.5;

    if (Number.isFinite(target) && Math.abs(curTimeRef.current - target) > driftThreshold) {
      sendCmd('seek', { sec: target });
      curTimeRef.current = target;
    }
    sendCmd(isPlaying ? 'play' : 'pause');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, positionSec, serverNow, seq, lastAction]);

  return (
    <div className={`relative bg-black ${className}`}>
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        title="YouTube Player"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        // sem foco/clique no iframe: os controles são os do Waver (e o teclado do PTT continua na página)
        tabIndex={-1}
        className={`w-full h-full border-0 ${interactiveControls ? '' : 'pointer-events-none'}`}
      />
    </div>
  );
};
