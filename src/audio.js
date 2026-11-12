// Sound without any audio files: everything is synthesised with Web Audio.
// Browsers only allow sound after a tap or key press, so unlock() is called
// from the first user input.

let ctx = null;
let master = null;
let muted = false;
let noiseBuffer = null;
const engine = {};
const fx = {};

function build() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  ctx = new AudioContextClass();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(ctx.destination);

  // looping white noise, shared by wind, tyre screech and crashes
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

  // engine: two slightly detuned oscillators through a low-pass filter
  engine.filter = ctx.createBiquadFilter();
  engine.filter.type = "lowpass";
  engine.filter.frequency.value = 500;
  engine.gain = ctx.createGain();
  engine.gain.gain.value = 0;
  engine.a = ctx.createOscillator();
  engine.a.type = "sawtooth";
  engine.b = ctx.createOscillator();
  engine.b.type = "square";
  engine.b.detune.value = 9;
  engine.a.connect(engine.filter);
  engine.b.connect(engine.filter);
  engine.filter.connect(engine.gain);
  engine.gain.connect(master);
  engine.a.start();
  engine.b.start();

  // tyre screech while drifting
  fx.screech = loopNoise("bandpass", 1900, 5);
  // wind / nitro whoosh
  fx.whoosh = loopNoise("highpass", 1400, 0.7);
}

function loopNoise(type, frequency, q) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start();
  return gain;
}

export const audio = {
  unlock() {
    if (!ctx) {
      try {
        build();
      } catch {
        ctx = null;
        return;
      }
    }
    ctx?.resume?.();
  },

  setMuted(value) {
    muted = value;
    if (master) {
      master.gain.setTargetAtTime(value ? 0 : 0.55, ctx.currentTime, 0.03);
    }
  },

  get muted() {
    return muted;
  },

  // Called every frame while racing. speed01: 0..1.2, throttle: 0..1
  engine({ speed01, throttle, nitro, drifting, offRoad }) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const pitch = 48 + speed01 * 120 + (nitro ? 30 : 0);
    engine.a.frequency.setTargetAtTime(pitch, t, 0.05);
    engine.b.frequency.setTargetAtTime(pitch * 0.5, t, 0.05);
    engine.filter.frequency.setTargetAtTime(380 + speed01 * 900 + throttle * 300, t, 0.08);
    engine.gain.gain.setTargetAtTime(0.05 + throttle * 0.05 + (nitro ? 0.03 : 0), t, 0.06);
    fx.screech.gain.setTargetAtTime(drifting ? 0.07 : offRoad && speed01 > 0.3 ? 0.02 : 0, t, 0.05);
    fx.whoosh.gain.setTargetAtTime(nitro ? 0.09 : speed01 > 0.8 ? 0.015 : 0, t, 0.08);
  },

  silence() {
    if (!ctx) return;
    const t = ctx.currentTime;
    engine.gain.gain.setTargetAtTime(0, t, 0.05);
    fx.screech.gain.setTargetAtTime(0, t, 0.05);
    fx.whoosh.gain.setTargetAtTime(0, t, 0.05);
  },

  beep(frequency = 440, duration = 0.18, type = "square", volume = 0.18) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  },

  countdown(final) {
    this.beep(final ? 880 : 520, final ? 0.45 : 0.16);
  },

  boost() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.25);
    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.32);
  },

  crash(power = 1) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.min(0.4, 0.12 + power * 0.25), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + 0.3);
  },

  // a short rising whoosh when a boost pad is collected
  pad() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [from, to, type] of [
      [220, 660, "triangle"],
      [440, 1320, "sine"],
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + 0.28);
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + 0.34);
    }
  },

  // a quieter two-note chime for a new personal best
  lap() {
    [659, 880].forEach((f, i) => setTimeout(() => this.beep(f, 0.12, "sine", 0.12), i * 90));
  },

  // four-note fanfare for a new track record
  record() {
    [659, 784, 988, 1319].forEach((f, i) =>
      setTimeout(() => this.beep(f, 0.16, "triangle", 0.16), i * 85),
    );
  },

  warn() {
    [220, 196].forEach((f, i) => setTimeout(() => this.beep(f, 0.14, "square", 0.1), i * 170));
  },

  finish(won) {
    const notes = won ? [523, 659, 784, 1047] : [440, 392, 349];
    notes.forEach((f, i) => setTimeout(() => this.beep(f, 0.22, "triangle", 0.2), i * 130));
  },
};

// Don't keep making noise while the tab is in the background.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend?.();
    else ctx.resume?.();
  });
}
