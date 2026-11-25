import fs from 'node:fs';
import path from 'node:path';

const SAMPLE_RATE = 44100;

function writeWavFile(filePath, samples) {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM
  buffer.writeUInt16LE(1, 20); // Linear PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  fs.writeFileSync(filePath, buffer);
}

function generateAirhorn() {
  const duration = 1.65;
  const len = Math.floor(SAMPLE_RATE * duration);
  const out = new Float32Array(len);
  const blasts = [
    [0.0, 0.14],
    [0.18, 0.32],
    [0.36, 0.50],
    [0.56, 1.55],
  ];
  const freqs = [392.0, 493.88, 587.33, 783.99];
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    let env = 0;
    for (const [start, end] of blasts) {
      if (t >= start && t <= end) {
        const local = t - start;
        const dur = end - start;
        const attack = Math.min(1, local / 0.012);
        const release = Math.min(1, (dur - local) / 0.06);
        env = Math.max(env, attack * release);
      }
    }
    if (env > 0) {
      let sig = 0;
      const vib = 1 + Math.sin(2 * Math.PI * 6 * t) * 0.008;
      for (const f of freqs) {
        const phase = (t * f * vib) % 1;
        // Sawtooth + harmonic punch
        sig += (2 * phase - 1) * 0.22 + Math.sin(2 * Math.PI * f * vib * t) * 0.12;
      }
      out[i] = Math.tanh(sig * 1.8) * env * 0.72;
    }
  }
  return out;
}

function generateVineBoom() {
  const duration = 1.5;
  const len = Math.floor(SAMPLE_RATE * duration);
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const freq = 135 * Math.exp(-t * 6.5) + 34;
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const punch = Math.exp(-t * 28) * (Math.random() * 2 - 1) * 0.5;
    const sub = Math.sin(phase) + 0.35 * Math.sin(phase * 2);
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 2.6);
    out[i] = Math.tanh((sub + punch) * 1.9) * env * 0.85;
  }
  return out;
}

function generateRimshot() {
  const duration = 1.45;
  const len = Math.floor(SAMPLE_RATE * duration);
  const out = new Float32Array(len);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    let v = 0;
    // "Ba" (snare at 0.0)
    if (t >= 0 && t < 0.25) {
      const lt = t;
      p1 += (2 * Math.PI * (220 * Math.exp(-lt * 12) + 120)) / SAMPLE_RATE;
      v += (Math.sin(p1) * 0.6 + (Math.random() * 2 - 1) * 0.55) * Math.exp(-lt * 22);
    }
    // "Dum" (low tom at 0.24)
    if (t >= 0.24 && t < 0.6) {
      const lt = t - 0.24;
      p2 += (2 * Math.PI * (150 * Math.exp(-lt * 8) + 75)) / SAMPLE_RATE;
      v += Math.sin(p2) * 0.85 * Math.exp(-lt * 12);
    }
    // "Tss!" (crash cymbal at 0.52)
    if (t >= 0.52) {
      const lt = t - 0.52;
      const metallic =
        Math.sin(2 * Math.PI * 3140 * lt) * 0.15 +
        Math.sin(2 * Math.PI * 4820 * lt) * 0.15 +
        Math.sin(2 * Math.PI * 7310 * lt) * 0.12 +
        (Math.random() * 2 - 1) * 0.65;
      v += metallic * Math.exp(-lt * 4.5) * 0.7;
    }
    out[i] = Math.tanh(v) * 0.8;
  }
  return out;
}

function generateSadTrombone() {
  const duration = 2.2;
  const len = Math.floor(SAMPLE_RATE * duration);
  const out = new Float32Array(len);
  const notes = [
    { start: 0.0, end: 0.42, f1: 293.66, f2: 288.0 },
    { start: 0.45, end: 0.87, f1: 277.18, f2: 271.0 },
    { start: 0.90, end: 1.32, f1: 261.63, f2: 255.0 },
    { start: 1.35, end: 2.15, f1: 246.94, f2: 218.0 },
  ];
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const note = notes.find((n) => t >= n.start && t <= n.end);
    if (note) {
      const p = (t - note.start) / (note.end - note.start);
      const vib = note.start > 1.2 ? Math.sin(2 * Math.PI * 5.5 * t) * 4.5 : 0;
      const freq = note.f1 + (note.f2 - note.f1) * p + vib;
      phase += (2 * Math.PI * freq) / SAMPLE_RATE;
      const brass =
        Math.sin(phase) * 0.5 +
        Math.sin(phase * 2) * 0.35 +
        Math.sin(phase * 3) * 0.2 +
        Math.sin(phase * 4) * 0.1;
      const attack = Math.min(1, (t - note.start) / 0.03);
      const release = Math.min(1, (note.end - t) / 0.08);
      out[i] = Math.tanh(brass * 1.4) * attack * release * 0.7;
    }
  }
  return out;
}

function generateFanfare() {
  const duration = 1.6;
  const len = Math.floor(SAMPLE_RATE * duration);
  const out = new Float32Array(len);
  const notes = [
    { start: 0.0, end: 0.15, f: 523.25 },
    { start: 0.16, end: 0.31, f: 659.25 },
    { start: 0.32, end: 0.47, f: 783.99 },
    { start: 0.50, end: 1.50, f: 1046.5 },
  ];
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    let sig = 0;
    for (const n of notes) {
      if (t >= n.start && t <= n.end) {
        const lt = t - n.start;
        const dur = n.end - n.start;
        const env = Math.min(1, lt / 0.015) * Math.min(1, (dur - lt) / 0.12);
        sig +=
          (Math.sin(2 * Math.PI * n.f * t) * 0.5 +
            Math.sin(2 * Math.PI * n.f * 2 * t) * 0.25 +
            Math.sin(2 * Math.PI * n.f * 0.5 * t) * 0.25) *
          env;
      }
    }
    out[i] = Math.tanh(sig * 1.2) * 0.65;
  }
  return out;
}

function generateBuzzer() {
  const duration = 0.85;
  const len = Math.floor(SAMPLE_RATE * duration);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, t / 0.01) * Math.min(1, (duration - t) / 0.08);
    const s1 = ((t * 110) % 1) * 2 - 1;
    const s2 = ((t * 116.5) % 1) * 2 - 1;
    out[i] = Math.tanh((s1 + s2) * 1.4) * env * 0.55;
  }
  return out;
}

function generateLevelUp() {
  const duration = 1.05;
  const len = Math.floor(SAMPLE_RATE * duration);
  const out = new Float32Array(len);
  const seq = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
  const step = 0.12;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const idx = Math.floor(t / step);
    if (idx < seq.length) {
      const lt = t - idx * step;
      const f = seq[idx];
      const dur = idx === seq.length - 1 ? duration - idx * step : step;
      const env = Math.min(1, lt / 0.008) * Math.exp((-lt / dur) * 2.2);
      const square = Math.sin(2 * Math.PI * f * t) >= 0 ? 0.5 : -0.5;
      out[i] = (square * 0.45 + Math.sin(2 * Math.PI * f * t) * 0.45) * env * 0.6;
    }
  }
  return out;
}

function generatePing() {
  const duration = 0.65;
  const len = Math.floor(SAMPLE_RATE * duration);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, t / 0.005) * Math.exp(-t * 7);
    const s =
      Math.sin(2 * Math.PI * 880 * t) * 0.55 +
      Math.sin(2 * Math.PI * 1318.5 * t) * 0.35 +
      Math.sin(2 * Math.PI * 1760 * t) * 0.15;
    out[i] = s * env * 0.65;
  }
  return out;
}

export const STARTER_SOUNDS = [
  { id: 'starter-airhorn', file: 'starter-airhorn.wav', name: 'Airhorn MLG', emoji: '📢', color: '#ef4444', gen: generateAirhorn },
  { id: 'starter-boom', file: 'starter-vine-boom.wav', name: 'Vine Boom', emoji: '💥', color: '#f97316', gen: generateVineBoom },
  { id: 'starter-rimshot', file: 'starter-rimshot.wav', name: 'Ba Dum Tss', emoji: '🥁', color: '#eab308', gen: generateRimshot },
  { id: 'starter-sad', file: 'starter-sad-trombone.wav', name: 'Trombone Triste', emoji: '🎺', color: '#6366f1', gen: generateSadTrombone },
  { id: 'starter-fanfare', file: 'starter-fanfare.wav', name: 'Vitória!', emoji: '🏆', color: '#22c55e', gen: generateFanfare },
  { id: 'starter-buzzer', file: 'starter-buzzer.wav', name: 'Errou!', emoji: '🚨', color: '#dc2626', gen: generateBuzzer },
  { id: 'starter-levelup', file: 'starter-levelup.wav', name: 'Level Up', emoji: '⭐', color: '#a855f7', gen: generateLevelUp },
  { id: 'starter-ping', file: 'starter-ping.wav', name: 'Alerta', emoji: '🔔', color: '#06b6d4', gen: generatePing },
];

export function ensureStarterSounds(soundsDir) {
  fs.mkdirSync(soundsDir, { recursive: true });
  return STARTER_SOUNDS.map((s) => {
    const filePath = path.join(soundsDir, s.file);
    if (!fs.existsSync(filePath)) {
      const samples = s.gen();
      writeWavFile(filePath, samples);
    }
    return {
      id: s.id,
      name: s.name,
      emoji: s.emoji,
      color: s.color,
      url: `/uploads/sounds/${s.file}`,
      volume: 0.9,
      createdBy: 'Sistema',
      createdAt: Date.now(),
      isStarter: true,
    };
  });
}
