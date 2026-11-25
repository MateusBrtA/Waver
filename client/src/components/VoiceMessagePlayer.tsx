import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Mic, Pause, Play } from 'lucide-react';

interface VoiceMessagePlayerProps {
  src: string;
  name?: string;
  durationSec?: number;
  waveform?: number[];
  isOwn?: boolean;
}

const SPEEDS: Array<1 | 1.5 | 2> = [1, 1.5, 2];

function buildSmoothMirrorWavePath(samples: number[], width: number, height: number): string {
  const count = samples.length;
  if (count === 0) return '';
  const midY = height / 2;
  const maxAmp = midY - 3;
  const stepX = width / Math.max(1, count - 1);

  const topPts: Array<{ x: number; y: number }> = [];
  const botPts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const v = Math.max(0.08, Math.min(1, samples[i]));
    const x = i * stepX;
    const dy = v * maxAmp;
    topPts.push({ x, y: midY - dy });
    botPts.push({ x, y: midY + dy });
  }

  let d = `M ${topPts[0].x.toFixed(1)} ${topPts[0].y.toFixed(1)}`;
  for (let i = 0; i < topPts.length - 1; i++) {
    const cx = ((topPts[i].x + topPts[i + 1].x) / 2).toFixed(1);
    const cy = ((topPts[i].y + topPts[i + 1].y) / 2).toFixed(1);
    d += ` Q ${topPts[i].x.toFixed(1)} ${topPts[i].y.toFixed(1)} ${cx} ${cy}`;
  }
  const lastTop = topPts[topPts.length - 1];
  d += ` L ${lastTop.x.toFixed(1)} ${lastTop.y.toFixed(1)}`;

  const lastBot = botPts[botPts.length - 1];
  d += ` L ${lastBot.x.toFixed(1)} ${lastBot.y.toFixed(1)}`;
  for (let i = botPts.length - 1; i > 0; i--) {
    const cx = ((botPts[i].x + botPts[i - 1].x) / 2).toFixed(1);
    const cy = ((botPts[i].y + botPts[i - 1].y) / 2).toFixed(1);
    d += ` Q ${botPts[i].x.toFixed(1)} ${botPts[i].y.toFixed(1)} ${cx} ${cy}`;
  }
  d += ` L ${botPts[0].x.toFixed(1)} ${botPts[0].y.toFixed(1)} Z`;
  return d;
}

function fallbackWaveform(seedText: string, len = 48): number[] {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    h ^= i * 7919;
    h = Math.imul(h, 16777619);
    const env = Math.sin(((i + 1) / (len + 1)) * Math.PI);
    const raw = ((h >>> 0) % 100) / 100;
    out.push(Number(Math.max(0.12, Math.min(0.95, 0.2 + raw * 0.72 * (0.4 + env * 0.6))).toFixed(2)));
  }
  return out;
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const VoiceMessagePlayer: React.FC<VoiceMessagePlayerProps> = ({
  src,
  name,
  durationSec = 0,
  waveform,
  isOwn = false,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const clipId = useId();

  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [dur, setDur] = useState(durationSec || 0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [decodedWave, setDecodedWave] = useState<number[] | null>(
    waveform && waveform.length >= 12 ? waveform : null
  );

  // If uploaded file had no stored waveform yet, decode up to 48 real curve points once
  useEffect(() => {
    if (waveform && waveform.length >= 12) {
      setDecodedWave(waveform);
      return;
    }
    let cancelled = false;
    fetch(src)
      .then((r) => {
        const len = Number(r.headers.get('content-length') || 0);
        if (len > 5 * 1024 * 1024) throw new Error('skip');
        return r.arrayBuffer();
      })
      .then(async (buf) => {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        try {
          const decoded = await ctx.decodeAudioData(buf);
          if (cancelled) return;
          const ch = decoded.getChannelData(0);
          const buckets = 48;
          const step = Math.max(1, Math.floor(ch.length / buckets));
          const pts: number[] = [];
          let peakMax = 0.01;
          for (let b = 0; b < buckets; b++) {
            const start = b * step;
            let sum = 0;
            for (let j = 0; j < step && start + j < ch.length; j += 4) {
              const v = Math.abs(ch[start + j]);
              if (v > sum) sum = v;
            }
            if (sum > peakMax) peakMax = sum;
            pts.push(sum);
          }
          setDecodedWave(pts.map((p) => Number(Math.max(0.1, Math.min(1, p / peakMax)).toFixed(2))));
        } finally {
          ctx.close().catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setDecodedWave(fallbackWaveform(src + (name || '')));
      });

    return () => {
      cancelled = true;
    };
  }, [src, name, waveform]);

  const samples = useMemo(
    () => (decodedWave && decodedWave.length >= 8 ? decodedWave : fallbackWaveform(src + (name || ''))),
    [decodedWave, src, name]
  );

  const svgWidth = 220;
  const svgHeight = 36;
  const curvePath = useMemo(() => buildSmoothMirrorWavePath(samples, svgWidth, svgHeight), [samples]);

  const speed = SPEEDS[speedIdx];
  const progress = dur > 0 ? Math.max(0, Math.min(1, curTime / dur)) : 0;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = speed;
    (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  }, [speed]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
    } else {
      a.playbackRate = speed;
      a.play().catch(() => {});
    }
  };

  const handleScrub = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const a = audioRef.current;
    if (!rect || !a || !dur) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * dur;
    setCurTime(a.currentTime);
  };

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border shadow-sm max-w-[360px] select-none ${
        isOwn
          ? 'bg-[#5865f2]/18 border-[#5865f2]/40'
          : 'bg-[#2b2d31] border-white/10'
      }`}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurTime(0);
        }}
        onLoadedMetadata={(e) => {
          const d = (e.currentTarget as HTMLAudioElement).duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
        }}
        onTimeUpdate={(e) => setCurTime((e.currentTarget as HTMLAudioElement).currentTime || 0)}
      />

      <button
        type="button"
        onClick={togglePlay}
        className="w-9 h-9 rounded-full bg-[#5865f2] hover:bg-[#4752c4] text-white flex items-center justify-center shrink-0 shadow cursor-pointer transition"
        title={playing ? 'Pausar áudio' : 'Ouvir áudio'}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          onClick={handleScrub}
          onMouseMove={(e) => {
            if (e.buttons === 1) handleScrub(e);
          }}
          className="w-full h-9 cursor-pointer overflow-visible"
        >
          <defs>
            <clipPath id={`clip-${clipId}`}>
              <rect x={0} y={0} width={progress * svgWidth} height={svgHeight} />
            </clipPath>
            <linearGradient id={`grad-${clipId}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#5865f2" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          {/* Inactive waveform curve */}
          <path d={curvePath} fill="rgba(255,255,255,0.2)" />
          {/* Played waveform curve with gradient clip */}
          <path d={curvePath} fill={`url(#grad-${clipId})`} clipPath={`url(#clip-${clipId})`} />
        </svg>

        <div className="flex items-center justify-between text-[10px] text-[#949ba4] font-mono">
          <span className="flex items-center gap-1 truncate">
            <Mic className="w-2.5 h-2.5 text-[#22d3ee] shrink-0" />
            {formatTime(playing || curTime > 0 ? curTime : dur)}
          </span>
          {dur > 0 && <span>{formatTime(dur)}</span>}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setSpeedIdx((prev) => (prev + 1) % SPEEDS.length)}
        className="px-2 py-1 rounded-full bg-[#383a40] hover:bg-[#5865f2] text-[11px] font-bold text-white transition cursor-pointer shrink-0 min-w-[38px] text-center"
        title="Alternar velocidade (1x / 1.5x / 2x)"
      >
        {speed}x
      </button>
    </div>
  );
};
