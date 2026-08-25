// 20 selectable waveforms (dpad-audio#3). One source of truth per shape: the
// analytic definition in RAW. Tables are derived once at load (zero-mean,
// peak-normalized) and serve BOTH consumers — the buffer synth samples the
// table per-partial, the ring-mod oscillator gets a PeriodicWave from the
// table's DFT — so the two renderings of a wave type can't drift.

const TAU = Math.PI * 2;
const N = 2048; // table length; also bounds the DFT below

const sin = (x) => Math.sin(TAU * x);
// Deterministic per-harmonic "random" (no Math.random: tables must be
// identical across loads or a shared URL wouldn't reproduce the sound).
const hrand = (k) => Math.abs((Math.sin(k * 12.9898) * 43758.5453) % 1);
const harmonics = (list) => (x) => list.reduce((s, [h, a]) => s + a * sin(h * x), 0);

// x in [0,1). DC offset and level are free here — the table builder
// zero-means and peak-normalizes every shape.
const RAW = {
  sine: sin,
  triangle: (x) => (x < 0.5 ? 4 * x - 1 : 3 - 4 * x),
  square: (x) => (x < 0.5 ? 1 : -1),
  'pulse-quarter': (x) => (x < 0.25 ? 1 : -1),
  'pulse-eighth': (x) => (x < 0.125 ? 1 : -1),
  saw: (x) => 2 * x - 1,
  ramp: (x) => 1 - 2 * x,
  'half-sine': (x) => (x < 0.5 ? sin(x) : 0),
  'full-sine': (x) => Math.abs(sin(x)),
  parabola: (x) => 1 - 8 * (x - 0.5) ** 2,
  cubic: (x) => (2 * x - 1) ** 3,
  'round-square': (x) => Math.tanh(4 * sin(x)),
  fold: (x) => Math.sin(2.5 * Math.PI * sin(x)), // wavefolded sine
  organ: harmonics([[1, 1], [2, 0.6], [4, 0.4], [8, 0.25]]),
  hollow: harmonics([[1, 1], [3, 1 / 3], [5, 1 / 5], [7, 1 / 7]]), // odd only
  bright: harmonics([1, 2, 3, 4, 5, 6, 7, 8].map((h) => [h, 1 / h])), // bandlimited saw
  bell: harmonics([[1, 1], [4, 0.5], [7, 0.35], [10, 0.25], [13, 0.15]]),
  stairs: (x) => Math.floor(x * 4),
  chirp: (x) => Math.sin(TAU * (x + 3 * x * x)), // in-cycle up-sweep; integer total turns, so it tiles
  glass: harmonics([...Array(16)].map((_, i) => [i + 1, (0.3 + 0.7 * hrand(i + 1)) / (i + 1)])),
};

function table(f) {
  const t = new Float32Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) mean += t[i] = f(i / N);
  mean /= N;
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs((t[i] -= mean)));
  for (let i = 0; i < N; i++) t[i] /= peak;
  return t;
}

const TABLES = Object.fromEntries(Object.entries(RAW).map(([k, f]) => [k, table(f)]));

export const WAVE_NAMES = Object.keys(RAW);

// Sampler for the buffer synth: phase in radians (as synth.js keeps it),
// linear interpolation. Unknown name falls back to sine — an imported config
// from a future wave-set degrades to audible, not to a crash.
export function waveFn(name) {
  const t = TABLES[name] ?? TABLES.sine;
  return (phase) => {
    const idx = (phase / TAU) * N;
    const i = idx | 0;
    const fr = idx - i;
    return t[i % N] * (1 - fr) + t[(i + 1) % N] * fr;
  };
}

// The same table as a PeriodicWave (ring mod's oscillator input). 96
// harmonics keeps sharp shapes convincingly sharp while staying bandlimited.
export function makePeriodicWave(ctx, name) {
  const t = TABLES[name] ?? TABLES.sine;
  const H = 96;
  const real = new Float32Array(H + 1);
  const imag = new Float32Array(H + 1);
  for (let h = 1; h <= H; h++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      re += t[n] * Math.cos((TAU * h * n) / N);
      im += t[n] * Math.sin((TAU * h * n) / N);
    }
    real[h] = (2 * re) / N;
    imag[h] = (2 * im) / N;
  }
  return ctx.createPeriodicWave(real, imag);
}
