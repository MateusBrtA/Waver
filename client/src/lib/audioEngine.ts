import { MusicState } from '../types';
import { resolveMediaUrl } from './api';

type ExtendedAudio = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export type UiToneType =
  | 'join'
  | 'leave'
  | 'mute'
  | 'unmute'
  | 'deafen_on'
  | 'deafen_off'
  | 'muted_speaking_warning';

export class AudioEngine {
  private serverUrl = '';
  private musicAudio: ExtendedAudio;
  private preloadAudio: HTMLAudioElement;
  private preloadedUrl = '';
  private activeSoundAudios: Set<ExtendedAudio> = new Set();
  private uiCtx: AudioContext | null = null;

  private soundboardVolume = 0.8;
  private musicVolume = 0.55;
  private deafened = false;
  private outputDeviceId = '';
  private clockOffsetMs = 0;
  private lastAppliedSeq = -1;

  private currentQueueId: string | null = null;
  private onTrackEnded: ((queueId: string) => void) | null = null;
  private onProgress: ((currentSec: number, durationSec: number) => void) | null = null;
  private onMusicError: ((msg: string) => void) | null = null;

  constructor() {
    this.musicAudio = new Audio() as ExtendedAudio;
    this.musicAudio.crossOrigin = 'anonymous';
    this.musicAudio.preload = 'auto';

    this.preloadAudio = new Audio();
    this.preloadAudio.crossOrigin = 'anonymous';
    this.preloadAudio.preload = 'auto';
    this.preloadAudio.muted = true;

    this.musicAudio.addEventListener('ended', () => {
      if (this.currentQueueId && this.onTrackEnded) {
        this.onTrackEnded(this.currentQueueId);
      }
    });

    this.musicAudio.addEventListener('timeupdate', () => {
      this.onProgress?.(this.musicAudio.currentTime || 0, this.musicAudio.duration || 0);
    });

    this.musicAudio.addEventListener('loadedmetadata', () => {
      this.onProgress?.(this.musicAudio.currentTime || 0, this.musicAudio.duration || 0);
    });

    this.musicAudio.addEventListener('error', () => {
      if (this.currentQueueId) {
        this.onMusicError?.('Não foi possível reproduzir esta faixa de áudio.');
      }
    });
  }

  setServerUrl(url: string) {
    this.serverUrl = url;
  }

  setCallbacks(opts: {
    onTrackEnded?: (queueId: string) => void;
    onProgress?: (currentSec: number, durationSec: number) => void;
    onMusicError?: (msg: string) => void;
  }) {
    if (opts.onTrackEnded) this.onTrackEnded = opts.onTrackEnded;
    if (opts.onProgress) this.onProgress = opts.onProgress;
    if (opts.onMusicError) this.onMusicError = opts.onMusicError;
  }

  setVolumes(soundboardVol: number, musicVol: number) {
    this.soundboardVolume = Math.max(0, Math.min(1, soundboardVol));
    this.musicVolume = Math.max(0, Math.min(1, musicVol));
    this.applyOutputVolumes();
  }

  setDeafened(deafened: boolean) {
    this.deafened = deafened;
    this.applyOutputVolumes();
  }

  async setOutputDevice(deviceId: string) {
    this.outputDeviceId = deviceId;
    if (deviceId && typeof this.musicAudio.setSinkId === 'function') {
      try {
        await this.musicAudio.setSinkId(deviceId);
      } catch {
        // Ignore unsupported sink errors
      }
    }
    for (const a of this.activeSoundAudios) {
      if (deviceId && typeof a.setSinkId === 'function') {
        a.setSinkId(deviceId).catch(() => {});
      }
    }
  }

  private applyOutputVolumes() {
    this.musicAudio.volume = this.deafened ? 0 : this.musicVolume;
    for (const a of this.activeSoundAudios) {
      a.volume = this.deafened ? 0 : this.soundboardVolume;
    }
  }

  playSoundboardClip(url: string, clipVolume = 1, onEnded?: () => void) {
    if (this.deafened) {
      window.setTimeout(() => onEnded?.(), 900);
      return;
    }
    const fullUrl = resolveMediaUrl(this.serverUrl, url);
    const audio = new Audio(fullUrl) as ExtendedAudio;
    audio.crossOrigin = 'anonymous';
    audio.volume = Math.max(0, Math.min(1, this.soundboardVolume * clipVolume));
    if (this.outputDeviceId && typeof audio.setSinkId === 'function') {
      audio.setSinkId(this.outputDeviceId).catch(() => {});
    }
    this.activeSoundAudios.add(audio);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      this.activeSoundAudios.delete(audio);
      onEnded?.();
    };
    audio.addEventListener('ended', cleanup);
    audio.addEventListener('error', cleanup);
    audio.play().catch(cleanup);
  }

  stopAllSounds() {
    for (const a of this.activeSoundAudios) {
      a.pause();
      a.currentTime = 0;
    }
    this.activeSoundAudios.clear();
  }

  setClockOffset(offsetMs: number) {
    if (Number.isFinite(offsetMs)) {
      this.clockOffsetMs = offsetMs;
    }
  }

  seekOptimistic(positionSec: number) {
    if (!this.currentQueueId || !Number.isFinite(positionSec)) return;
    try {
      this.musicAudio.currentTime = Math.max(0, positionSec);
      this.onProgress?.(this.musicAudio.currentTime || 0, this.musicAudio.duration || 0);
    } catch {}
  }

  playOptimistic() {
    if (!this.currentQueueId) return;
    this.applyOutputVolumes();
    if (this.musicAudio.paused && this.musicAudio.src) {
      this.musicAudio.play().catch(() => {});
    }
  }

  pauseOptimistic() {
    if (!this.musicAudio.paused) {
      this.musicAudio.pause();
    }
  }

  private prewarmNextTrack(state: MusicState) {
    if (!state.queue || state.queue.length === 0) return;
    const nextIdx =
      state.currentIndex + 1 < state.queue.length
        ? state.currentIndex + 1
        : state.loopMode === 'all'
        ? 0
        : -1;
    if (nextIdx >= 0 && state.queue[nextIdx]?.url) {
      const nextFullUrl = resolveMediaUrl(this.serverUrl, state.queue[nextIdx].url);
      if (nextFullUrl && nextFullUrl !== this.preloadedUrl) {
        this.preloadedUrl = nextFullUrl;
        this.preloadAudio.src = nextFullUrl;
        this.preloadAudio.load();
      }
    }
  }

  syncMusicState(state: MusicState | null) {
    if (!state || state.currentIndex < 0 || !state.queue[state.currentIndex]) {
      this.currentQueueId = null;
      this.lastAppliedSeq = -1;
      this.musicAudio.pause();
      this.musicAudio.removeAttribute('src');
      this.musicAudio.load();
      this.onProgress?.(0, 0);
      return;
    }

    const track = state.queue[state.currentIndex];
    const fullUrl = resolveMediaUrl(this.serverUrl, track.url);
    const trackChanged = this.currentQueueId !== (track.queueId || track.id);
    this.currentQueueId = track.queueId || track.id;

    const incomingSeq = typeof state.seq === 'number' ? state.seq : -1;
    const isNewSeq = incomingSeq !== -1 && incomingSeq !== this.lastAppliedSeq;
    if (incomingSeq !== -1) this.lastAppliedSeq = incomingSeq;

    // Tempo contado a partir da chegada (relógio local) + trânsito da rede limitado a 2 s:
    // relógio mal sincronizado não desloca a música, e o tempo de carregar a faixa também conta.
    const receivedAt = Date.now();
    const transitSec = Math.min(2, Math.max(0, (receivedAt + this.clockOffsetMs - state.serverNow) / 1000));
    const targetNow = () =>
      state.isPlaying ? state.positionSec + transitSec + Math.max(0, (Date.now() - receivedAt) / 1000) : state.positionSec;
    const targetSec = targetNow();

    this.prewarmNextTrack(state);

    if (trackChanged || this.musicAudio.src !== fullUrl) {
      this.musicAudio.src = fullUrl;
      this.musicAudio.load();
      const applyStart = () => {
        const startSec = targetNow();
        if (Number.isFinite(startSec) && startSec > 0.25) {
          try {
            this.musicAudio.currentTime = startSec;
          } catch {
            // ignore seek before ready
          }
        }
        this.applyOutputVolumes();
        if (state.isPlaying) {
          this.musicAudio.play().catch(() => {});
        } else {
          this.musicAudio.pause();
        }
      };
      if (this.musicAudio.readyState >= 1) {
        applyStart();
      } else {
        this.musicAudio.addEventListener('loadedmetadata', applyStart, { once: true });
      }
      return;
    }

    this.applyOutputVolumes();

    const cur = this.musicAudio.currentTime || 0;
    const forceTightSync = isNewSeq && (state.lastAction === 'seek' || state.lastAction === 'track');
    const maxDrift = forceTightSync ? 0.15 : 0.65;

    if (Number.isFinite(targetSec) && Math.abs(cur - targetSec) > maxDrift) {
      try {
        this.musicAudio.currentTime = targetSec;
      } catch {
        // ignore
      }
    }

    if (state.isPlaying) {
      if (this.musicAudio.paused) {
        this.musicAudio.play().catch(() => {});
      }
    } else if (!this.musicAudio.paused) {
      this.musicAudio.pause();
    }
  }

  getMusicPosition(): number {
    return this.musicAudio.currentTime || 0;
  }

  stopMusic() {
    this.currentQueueId = null;
    this.musicAudio.pause();
    this.musicAudio.removeAttribute('src');
    this.musicAudio.load();
  }

  /**
   * Authentic Discord-style distinct UI feedback chimes:
   * - mute vs unmute
   * - deafen_on vs deafen_off (distinct 3-note chime!)
   * - muted_speaking_warning (when talking with mic muted!)
   * - join / leave
   */
  playUiTone(type: UiToneType) {
    // Allow user to always hear deafen toggle, mute feedback, leave, and muted-speaking alert!
    if (this.deafened && type === 'join') return;
    try {
      if (!this.uiCtx || this.uiCtx.state === 'closed') this.uiCtx = new AudioContext();
      const ctx = this.uiCtx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      const playNote = (
        freqStart: number,
        freqEnd: number,
        start: number,
        dur: number,
        gainPeak = 0.08,
        wave: OscillatorType = 'sine'
      ) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(freqStart, now + start);
        if (freqEnd !== freqStart) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + start + dur);
        }
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(gainPeak, now + start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur + 0.02);
      };

      switch (type) {
        case 'join':
          playNote(523.25, 523.25, 0, 0.1, 0.09);
          playNote(659.25, 659.25, 0.08, 0.14, 0.09);
          break;
        case 'leave':
          playNote(523.25, 523.25, 0, 0.09, 0.08);
          playNote(392.0, 392.0, 0.08, 0.15, 0.08);
          break;
        case 'mute':
          // Crisp descending mic-off bop
          playNote(430, 290, 0, 0.11, 0.08, 'triangle');
          break;
        case 'unmute':
          // Crisp ascending mic-on chirp
          playNote(330, 530, 0, 0.11, 0.08, 'triangle');
          break;
        case 'deafen_on':
          // Distinct 3-step deep muffling chime (completely different from mic mute!)
          playNote(350, 320, 0, 0.075, 0.085, 'sine');
          playNote(235, 200, 0.065, 0.08, 0.08, 'sine');
          playNote(155, 130, 0.13, 0.13, 0.075, 'triangle');
          break;
        case 'deafen_off':
          // Distinct 3-step brightening chime!
          playNote(240, 260, 0, 0.07, 0.075, 'sine');
          playNote(370, 390, 0.06, 0.075, 0.08, 'sine');
          playNote(520, 550, 0.12, 0.12, 0.085, 'triangle');
          break;
        case 'muted_speaking_warning':
          // Gentle Discord double-blip warning when talking with muted mic
          playNote(490, 440, 0, 0.08, 0.075, 'triangle');
          playNote(380, 340, 0.1, 0.1, 0.075, 'triangle');
          break;
      }
    } catch {
      // ignore AudioContext restriction
    }
  }
}

export const audioEngine = new AudioEngine();
