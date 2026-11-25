/**
 * Bridges 48 kHz Stereo Int16 PCM frames from the native Windows WASAPI
 * process-excluded loopback helper (pulse-loopback.exe) into a WebRTC-ready MediaStream.
 */

const WORKLET_CODE = `
class LoopbackPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 48000; // 1 sec stereo ring buffer per channel
    this.left = new Float32Array(this.cap);
    this.right = new Float32Array(this.cap);
    this.writeIdx = 0;
    this.readIdx = 0;
    this.count = 0;

    this.port.onmessage = (e) => {
      const int16 = new Int16Array(e.data);
      const frames = Math.floor(int16.length / 2);
      for (let i = 0; i < frames; i++) {
        this.left[this.writeIdx] = int16[i * 2] / 32768;
        this.right[this.writeIdx] = int16[i * 2 + 1] / 32768;
        this.writeIdx = (this.writeIdx + 1) % this.cap;
        if (this.count < this.cap) {
          this.count++;
        } else {
          this.readIdx = (this.readIdx + 1) % this.cap;
        }
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out[1] || outL;
    const len = outL.length;

    if (this.count < len) {
      // Underrun -> clean silence
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      if (this.count > 0) {
        for (let i = 0; i < this.count; i++) {
          outL[i] = this.left[this.readIdx];
          if (outR !== outL) outR[i] = this.right[this.readIdx];
          this.readIdx = (this.readIdx + 1) % this.cap;
        }
        this.count = 0;
      }
      return true;
    }

    for (let i = 0; i < len; i++) {
      outL[i] = this.left[this.readIdx];
      if (outR !== outL) outR[i] = this.right[this.readIdx];
      this.readIdx = (this.readIdx + 1) % this.cap;
    }
    this.count -= len;
    return true;
  }
}
registerProcessor('pulsecord-loopback-pcm', LoopbackPcmProcessor);
`;

export interface LoopbackBridgeHandle {
  track: MediaStreamTrack;
  stop: () => void;
}

export async function createProcessLoopbackAudioTrack(): Promise<LoopbackBridgeHandle | null> {
  if (!window.electronAPI?.startProcessLoopback || !window.electronAPI?.onLoopbackPcm) return null;

  const started = await window.electronAPI.startProcessLoopback();
  if (!started?.ok) return null;

  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});

  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
  const workletUrl = URL.createObjectURL(blob);

  try {
    await ctx.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }

  const node = new AudioWorkletNode(ctx, 'pulsecord-loopback-pcm', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const dest = ctx.createMediaStreamDestination();
  node.connect(dest);

  const unsubPcm = window.electronAPI.onLoopbackPcm((chunk) => {
    try {
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const aligned = u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
        ? u8.buffer
        : u8.slice().buffer;
      node.port.postMessage(aligned, [aligned]);
    } catch {
      // ignore chunk alignment error
    }
  });

  const track = dest.stream.getAudioTracks()[0];
  if (!track) {
    unsubPcm();
    node.disconnect();
    ctx.close().catch(() => {});
    window.electronAPI.stopProcessLoopback().catch(() => {});
    return null;
  }

  let stopped = false;
  return {
    track,
    stop: () => {
      if (stopped) return;
      stopped = true;
      unsubPcm();
      try {
        node.disconnect();
      } catch {}
      try {
        track.stop();
      } catch {}
      ctx.close().catch(() => {});
      window.electronAPI?.stopProcessLoopback().catch(() => {});
    },
  };
}
