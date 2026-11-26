// Gravação da chamada e clipes ("salvar os últimos segundos").
// O áudio de todos (seu microfone + cada participante) é misturado num único stream; se você está
// transmitindo a tela, o vídeo da sua transmissão entra junto.

export interface RecSource {
  key: string;
  stream: MediaStream | null;
}

class CallMixer {
  private ctx = new AudioContext();
  readonly dest = this.ctx.createMediaStreamDestination();
  private sources = new Map<string, MediaStreamAudioSourceNode>();

  sync(list: RecSource[]) {
    const keep = new Set<string>();
    for (const { key, stream } of list) {
      const track = stream?.getAudioTracks()[0];
      if (!track || track.readyState === 'ended') continue;
      const k = `${key}:${track.id}`;
      keep.add(k);
      if (!this.sources.has(k)) {
        const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
        src.connect(this.dest);
        this.sources.set(k, src);
      }
    }
    for (const [k, src] of this.sources) {
      if (!keep.has(k)) {
        src.disconnect();
        this.sources.delete(k);
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  close() {
    for (const s of this.sources.values()) s.disconnect();
    this.sources.clear();
    this.ctx.close().catch(() => {});
  }
}

function pickMime(withVideo: boolean) {
  const opts = withVideo
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm'];
  return opts.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || '';
}

function buildStream(mixer: CallMixer, video: MediaStreamTrack | null) {
  const tracks: MediaStreamTrack[] = [...mixer.dest.stream.getAudioTracks()];
  if (video && video.readyState === 'live') tracks.push(video);
  return new MediaStream(tracks);
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

const VIDEO_BPS = 3_000_000;
const AUDIO_BPS = 128_000;

/** Gravação contínua. No app desktop os pedaços vão direto para o disco (não acumula na memória). */
export class CallRecording {
  private mixer = new CallMixer();
  private rec: MediaRecorder | null = null;
  private memChunks: Blob[] = [];
  private token: string | null = null;
  private writing: Promise<unknown> = Promise.resolve();
  readonly startedAt = Date.now();
  readonly hasVideo: boolean;
  private fileName: string;

  constructor(sources: RecSource[], video: MediaStreamTrack | null) {
    this.mixer.sync(sources);
    this.hasVideo = Boolean(video);
    const mime = pickMime(this.hasVideo);
    this.fileName = `PulseCord-chamada-${stamp()}.webm`;
    const stream = buildStream(this.mixer, video);
    this.rec = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      audioBitsPerSecond: AUDIO_BPS,
      videoBitsPerSecond: this.hasVideo ? VIDEO_BPS : undefined,
    });
    const api = window.electronAPI;
    if (api?.recordingOpen) {
      this.writing = api.recordingOpen(this.fileName).then((t) => (this.token = t)).catch(() => (this.token = null));
    }
    this.rec.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      if (api?.recordingAppend) {
        const blob = e.data;
        this.writing = this.writing.then(async () => {
          if (!this.token) {
            this.memChunks.push(blob);
            return;
          }
          await api.recordingAppend!(this.token, new Uint8Array(await blob.arrayBuffer()));
        });
      } else {
        this.memChunks.push(e.data);
      }
    };
    this.rec.start(2000);
  }

  updateSources(sources: RecSource[]) {
    this.mixer.sync(sources);
  }

  /** Para e devolve o caminho do arquivo salvo (desktop) ou baixa o arquivo (navegador). */
  async stop(): Promise<string | null> {
    const rec = this.rec;
    this.rec = null;
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
    }
    await this.writing;
    this.mixer.close();
    const api = window.electronAPI;
    if (this.token && api?.recordingClose) {
      // pedaços que chegaram antes do arquivo abrir
      if (this.memChunks.length && api.recordingAppend) {
        await api.recordingAppend(this.token, new Uint8Array(await new Blob(this.memChunks).arrayBuffer()));
      }
      return api.recordingClose(this.token);
    }
    return saveBlob(new Blob(this.memChunks, { type: this.hasVideo ? 'video/webm' : 'audio/webm' }), this.fileName);
  }
}

/**
 * Clipes: dois gravadores defasados em 30 s, cada um reinicia a cada 60 s. Ao salvar, usa o que
 * tem entre 30 e 60 s gravados. Fica tudo na memória (no máximo ~1 min por gravador).
 */
export class ClipBuffer {
  private mixer = new CallMixer();
  private video: MediaStreamTrack | null = null;
  private slots: Array<{ rec: MediaRecorder; chunks: Blob[]; startedAt: number } | null> = [null, null];
  private timers: number[] = [];
  private stopped = false;
  static readonly WINDOW_MS = 60_000;

  constructor(sources: RecSource[], video: MediaStreamTrack | null) {
    this.mixer.sync(sources);
    this.video = video;
    this.startSlot(0);
    this.timers.push(window.setTimeout(() => this.startSlot(1), ClipBuffer.WINDOW_MS / 2));
  }

  updateSources(sources: RecSource[], video: MediaStreamTrack | null) {
    this.mixer.sync(sources);
    this.video = video; // entra no próximo ciclo dos gravadores
  }

  private startSlot(i: number) {
    if (this.stopped) return;
    const old = this.slots[i];
    if (old && old.rec.state !== 'inactive') {
      old.rec.ondataavailable = null;
      old.rec.stop();
    }
    const withVideo = Boolean(this.video && this.video.readyState === 'live');
    const mime = pickMime(withVideo);
    const rec = new MediaRecorder(buildStream(this.mixer, withVideo ? this.video : null), {
      mimeType: mime || undefined,
      audioBitsPerSecond: AUDIO_BPS,
      videoBitsPerSecond: withVideo ? VIDEO_BPS : undefined,
    });
    const slot = { rec, chunks: [] as Blob[], startedAt: Date.now() };
    rec.ondataavailable = (e) => e.data && e.data.size > 0 && slot.chunks.push(e.data);
    rec.start(1000);
    this.slots[i] = slot;
    this.timers[i] = window.setTimeout(() => this.startSlot(i), ClipBuffer.WINDOW_MS);
  }

  /** Salva o clipe e reinicia aquele gravador. */
  async save(): Promise<{ path: string | null; seconds: number }> {
    const live = this.slots.filter(Boolean) as Array<{ rec: MediaRecorder; chunks: Blob[]; startedAt: number }>;
    if (!live.length) return { path: null, seconds: 0 };
    const best = live.reduce((a, b) => (a.startedAt < b.startedAt ? a : b));
    const idx = this.slots.indexOf(best);
    const seconds = Math.round((Date.now() - best.startedAt) / 1000);
    await new Promise<void>((resolve) => {
      best.rec.onstop = () => resolve();
      best.rec.requestData();
      best.rec.stop();
    });
    window.clearTimeout(this.timers[idx]);
    const withVideo = best.rec.mimeType.startsWith('video');
    const blob = new Blob(best.chunks, { type: withVideo ? 'video/webm' : 'audio/webm' });
    this.slots[idx] = null;
    this.startSlot(idx);
    const path = await saveBlob(blob, `PulseCord-clipe-${stamp()}.webm`, 'clip');
    return { path, seconds };
  }

  stop() {
    this.stopped = true;
    this.timers.forEach((t) => window.clearTimeout(t));
    for (const s of this.slots) {
      if (s && s.rec.state !== 'inactive') {
        s.rec.ondataavailable = null;
        s.rec.stop();
      }
    }
    this.slots = [null, null];
    this.mixer.close();
  }
}

async function saveBlob(blob: Blob, name: string, kind: 'clip' | 'recording' = 'recording'): Promise<string | null> {
  const api = window.electronAPI;
  if (api?.saveMediaFile) {
    return api.saveMediaFile(name, new Uint8Array(await blob.arrayBuffer()), kind);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  return null;
}
