/* ======================================================================== *
 * Sound
 *
 * Five built-in critical sounds, synthesised on the spot with the Web Audio
 * API — noise bursts through sweeping filters, oscillators with short
 * envelopes, a little distortion — so the module ships no audio files of
 * anyone else's. A file (per character or the world default) plays through
 * Foundry's audio helper instead. Everything plays on this client only.
 * ======================================================================== */

export const SOUND_PRESETS = {
  synth1: "효과음 1",
  synth2: "효과음 2",
  synth3: "효과음 3",
  synth4: "효과음 4",
  synth5: "효과음 5"
};

/** The fumble cut-in's own three (any of the five above can be used too). */
export const FUMBLE_PRESETS = {
  fumble1: "실패음 1 — 뿌우우 (김빠진 나팔)",
  fumble2: "실패음 2 — 쨍그랑 (깨지는 소리)",
  fumble3: "실패음 3 — 쿵… 휘유우 (떨어지는 소리)"
};

let context = null;
let noiseBuffer = null;

function audioContext() {
  if (context) return context;
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctx) return null;
  try { context = new Ctx(); } catch (_) { context = null; }
  return context;
}

export function interfaceVolume() {
  try {
    const v = Number(game.settings.get("core", "globalInterfaceVolume"));
    return Number.isFinite(v) ? v : 0.5;
  } catch (_) {
    return 0.5;
  }
}

/* ---------------- building blocks ---------------- */

function noise(ctx) {
  if (noiseBuffer?.sampleRate === ctx.sampleRate) return noiseBuffer;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

/** A gain that rises to `peak` in `attack` s and dies away over `decay` s. */
function envelope(ctx, out, t, { attack = 0.005, peak = 1, decay = 0.3 } = {}) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

function noiseBurst(ctx, out, t, { type = "bandpass", from = 500, to = 4000, q = 1, attack = 0.04, peak = 0.7, decay = 0.35 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + attack + decay * 0.6);
  src.connect(filter).connect(envelope(ctx, out, t, { attack, peak, decay }));
  src.start(t);
  src.stop(t + attack + decay + 0.05);
}

function tone(ctx, out, t, { type = "sine", freq = 440, to = null, detune = 0, attack = 0.005, peak = 0.3, decay = 0.6 } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + attack + decay * 0.8);
  osc.detune.value = detune;
  osc.connect(envelope(ctx, out, t, { attack, peak, decay }));
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}

/** Bright metallic ring: inharmonic partials, the higher ones dying first. */
function ring(ctx, out, t, base = 2093, peak = 0.22, length = 0.9) {
  [1, 1.5, 2.24, 3].forEach((ratio, i) => {
    tone(ctx, out, t, { type: i ? "sine" : "triangle", freq: base * ratio, detune: (i % 2 ? 1 : -1) * 7, peak: peak / (i + 1), decay: length - i * 0.12 });
  });
}

function distortion(ctx, amount = 30) {
  const shaper = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  shaper.curve = curve;
  return shaper;
}

/* ---------------- the five sounds ---------------- */

const RECIPES = {
  /** 1 — whoosh, low hit, bright ring ("슉-챙") */
  synth1(ctx, out, t) {
    noiseBurst(ctx, out, t, { from: 450, to: 4200, q: 1.1, attack: 0.07, peak: 0.7, decay: 0.38 });
    tone(ctx, out, t + 0.1, { freq: 140, to: 42, attack: 0.01, peak: 0.9, decay: 0.24 });
    ring(ctx, out, t + 0.1);
  },
  /** 2 — two quick blade slashes and a thin metallic glint */
  synth2(ctx, out, t) {
    noiseBurst(ctx, out, t, { type: "highpass", from: 1800, to: 7000, q: 0.7, attack: 0.015, peak: 0.8, decay: 0.12 });
    noiseBurst(ctx, out, t + 0.11, { type: "highpass", from: 2500, to: 9000, q: 0.7, attack: 0.012, peak: 0.65, decay: 0.14 });
    ring(ctx, out, t + 0.14, 3520, 0.16, 0.7);
    tone(ctx, out, t + 0.12, { type: "triangle", freq: 220, to: 90, peak: 0.35, decay: 0.12 });
  },
  /** 3 — a heavy impact: distorted boom, crack and rumble */
  synth3(ctx, out, t) {
    // Warm drive, then a low-pass so the boom stays a thump rather than a buzz.
    const drive = distortion(ctx, 12);
    const dark = ctx.createBiquadFilter();
    dark.type = "lowpass";
    dark.frequency.value = 700;
    const post = ctx.createGain();
    post.gain.value = 0.7;
    drive.connect(dark).connect(post).connect(out);
    tone(ctx, drive, t, { freq: 120, to: 34, attack: 0.004, peak: 1, decay: 0.7 });
    noiseBurst(ctx, out, t, { type: "lowpass", from: 2200, to: 160, q: 0.5, attack: 0.003, peak: 0.8, decay: 0.45 });
    noiseBurst(ctx, out, t, { type: "bandpass", from: 3500, to: 2500, q: 0.8, attack: 0.002, peak: 0.35, decay: 0.05 });
    const rumble = ctx.createBiquadFilter();
    rumble.type = "lowpass";
    rumble.frequency.value = 220;
    rumble.connect(out);
    tone(ctx, rumble, t + 0.05, { type: "sawtooth", freq: 55, to: 40, attack: 0.02, peak: 0.18, decay: 0.9 });
  },
  /** 4 — a rising chime arpeggio with a little sparkle */
  synth4(ctx, out, t) {
    [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, i) => {
      const at = t + i * 0.065;
      tone(ctx, out, at, { freq: f, peak: 0.2, decay: 0.75 - i * 0.05 });
      tone(ctx, out, at, { freq: f * 2.76, peak: 0.05, decay: 0.3 });
    });
    noiseBurst(ctx, out, t + 0.05, { type: "bandpass", from: 7000, to: 9500, q: 3, attack: 0.15, peak: 0.06, decay: 0.45 });
  },
  /** 5 — a brassy two-hit fanfare stab ("빠-밤!") */
  synth5(ctx, out, t) {
    const stab = (at, notes, length, peak) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 2;
      filter.frequency.setValueAtTime(600, at);
      filter.frequency.exponentialRampToValueAtTime(4200, at + 0.06);
      filter.frequency.exponentialRampToValueAtTime(900, at + length);
      filter.connect(out);
      for (const [i, f] of notes.entries()) {
        tone(ctx, filter, at, { type: "sawtooth", freq: f, detune: i * 4 - 4, attack: 0.012, peak: peak / notes.length, decay: length });
      }
    };
    stab(t, [392, 493.9, 587.3], 0.12, 0.7);
    stab(t + 0.16, [523.3, 659.3, 784, 1046.5], 0.7, 0.85);
    noiseBurst(ctx, out, t + 0.16, { type: "bandpass", from: 6000, to: 9000, q: 1.5, attack: 0.005, peak: 0.08, decay: 0.4 });
  }
};

/* ---------------- the fumble sounds ---------------- */

Object.assign(RECIPES, {
  /** f1 — a deflating horn: three falling notes, the last one sagging and wobbling ("뿌 뿌 뿌우우~") */
  fumble1(ctx, out, t) {
    const horn = (at, freq, to, length, wobble = false) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(500, at);
      filter.frequency.linearRampToValueAtTime(1400, at + 0.06);
      filter.frequency.exponentialRampToValueAtTime(380, at + length);
      filter.connect(out);
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, at);
      osc.frequency.exponentialRampToValueAtTime(to, at + length);
      if (wobble) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 6;
        depth.gain.value = 9;
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(at);
        lfo.stop(at + length + 0.05);
      }
      osc.connect(envelope(ctx, filter, at, { attack: 0.02, peak: 0.55, decay: length }));
      osc.start(at);
      osc.stop(at + length + 0.05);
    };
    horn(t, 311, 293, 0.22);
    horn(t + 0.27, 293, 277, 0.22);
    horn(t + 0.54, 277, 262, 0.22);
    horn(t + 0.82, 262, 185, 0.95, true);
  },
  /** f2 — something breaks: a dull knock, glass shatter and a few tinkling shards */
  fumble2(ctx, out, t) {
    tone(ctx, out, t, { type: "triangle", freq: 180, to: 70, attack: 0.003, peak: 0.6, decay: 0.18 });
    noiseBurst(ctx, out, t + 0.02, { type: "highpass", from: 3000, to: 6500, q: 0.6, attack: 0.004, peak: 0.75, decay: 0.32 });
    noiseBurst(ctx, out, t + 0.03, { type: "bandpass", from: 5200, to: 2600, q: 2, attack: 0.002, peak: 0.4, decay: 0.2 });
    [3951, 5274, 4699, 6272, 4186, 5588].forEach((f, i) => {
      tone(ctx, out, t + 0.09 + i * 0.055 + (i % 2) * 0.02, { freq: f, peak: 0.07, decay: 0.16 + (i % 3) * 0.05 });
    });
  },
  /** f3 — a thud, then a long falling whistle ("쿵… 휘유우우") */
  fumble3(ctx, out, t) {
    const dark = ctx.createBiquadFilter();
    dark.type = "lowpass";
    dark.frequency.value = 500;
    dark.connect(out);
    tone(ctx, dark, t, { freq: 95, to: 38, attack: 0.004, peak: 1, decay: 0.45 });
    noiseBurst(ctx, out, t, { type: "lowpass", from: 900, to: 120, q: 0.4, attack: 0.003, peak: 0.5, decay: 0.3 });
    tone(ctx, out, t + 0.32, { type: "sine", freq: 1650, to: 260, attack: 0.04, peak: 0.22, decay: 1.05 });
    tone(ctx, out, t + 0.32, { type: "sine", freq: 3300, to: 520, attack: 0.04, peak: 0.04, decay: 0.9 });
  }
});

/** Evens out the sounds so switching between them doesn't jump in loudness. */
const LEVEL = { synth1: 1, synth2: 1.05, synth3: 1.3, synth4: 1.9, synth5: 1.4, fumble1: 1.1, fumble2: 1.2, fumble3: 1.3 };

export function playSynth(preset = "synth1", volume = 0.5) {
  const ctx = audioContext();
  const key = RECIPES[preset] ? preset : "synth1";
  const recipe = RECIPES[key];
  if (!ctx || volume <= 0) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const master = ctx.createGain();
  master.gain.value = Math.min(1.9, volume * LEVEL[key]);
  // A soft limiter so stacked layers never clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.ratio.value = 8;
  master.connect(limiter).connect(ctx.destination);
  recipe(ctx, master, ctx.currentTime + 0.02);
}

export function playFile(src, volume = 0.5) {
  const helper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
  if (!helper?.play) return;
  try {
    helper.play({ src, volume: Math.min(1, volume), autoplay: true, loop: false }, false);
  } catch (err) {
    console.warn("rutz-crit-cutin | could not play sound", src, err);
  }
}

/**
 * @param {{preset?: string, file?: string, volume?: number}} sound
 *   preset: "synth1"…"synth5", "file" (play `file`) or "none"
 */
export function playCutinSound({ preset = "synth1", file = "", volume = 0.5 } = {}) {
  if (volume <= 0 || preset === "none") return;
  if (preset === "file") return file ? playFile(file, volume) : undefined;
  return playSynth(preset, volume);
}
