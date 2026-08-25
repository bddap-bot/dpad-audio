// Per-slider mod mappings (dpad-audio#4): the ONE evaluation path shared by
// note-time params (dev/layer sliders, sampled at trigger) and live FX params
// (ticked continuously in app.js). A mapping is a fixed-shape object — `src`
// selects the kind, the other kinds' fields sit at their defaults and prune
// out of the config — so the existing merge/prune/unknown-key machinery
// handles mappings with no special cases.
import { waveFn } from './waves.js';

export const MOD_SOURCES = ['none', 'adsr', 'lfo', 'midi', 'slider'];
// Fields the synth tracks per note/sequence, published by app.js as 0..1.
export const MIDI_FIELDS = ['progress', 'pitch', 'gate', 'gain', 'brightness', 'crush'];

export const MOD_DEFAULT = {
  src: 'none',
  wave: 'sine', // lfo: one of the waves.js 20
  rate: 1, // lfo Hz
  a: 0.01, d: 0.2, s: 0.7, r: 0.3, // adsr seconds / sustain level
  field: 'progress', // midi field
  slot: 0, // custom-slider index
  offset: 0, // [-1..0]
  amount: 1, // [-2..2]
  min: 0, max: 1, // [-2..2] clamp window on the modulated norm
};

// The mapping formula (README schema): with base and the result in the
// param's normalized 0..1 space and src in 0..1,
//   applied = clamp01( clamp( norm(base) + offset + amount·src, min, max ) )
// The outer clamp01 keeps the value inside the param's range even when the
// min/max window reaches outside it.
export function mapValue(m, baseNorm, src) {
  const v = Math.min(m.max, Math.max(m.min, baseNorm + m.offset + m.amount * src));
  return Math.min(1, Math.max(0, v));
}

// LFO level 0..1: the shared wave table (zero-mean, peak-normalized ±1),
// free-running from t=0 so identical configs phase-align.
export function lfoLevel(m, nowS) {
  const phase = (((nowS * m.rate) % 1) + 1) % 1;
  return (waveFn(m.wave)(phase * 2 * Math.PI) + 1) / 2;
}

// ADSR level 0..1 from gate timestamps (null = never). Zero-length segments
// jump instead of dividing by zero.
export function adsrLevel(m, nowS, onS, offS) {
  if (onS == null || nowS < onS) return 0;
  const held = (t) => {
    if (t < m.a) return m.a > 0 ? t / m.a : 1;
    const td = t - m.a;
    if (td < m.d) return 1 - (1 - m.s) * (td / m.d);
    return m.s;
  };
  if (offS == null || nowS < offS) return held(nowS - onS);
  const atOff = held(offS - onS);
  return m.r > 0 ? Math.max(0, atOff * (1 - (nowS - offS) / m.r)) : 0;
}
