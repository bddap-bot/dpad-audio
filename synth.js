// Buffer-rendered pluck synth, ported from the in-game instrument
// (bddap/rl crab-world/src/instrument.rs) — parity with the game is the
// contract, so notes are synthesized sample-by-sample with the same math
// (additive partials, twin detuned voices, per-partial decay, bitcrush
// PRE-gain) rather than approximated with an oscillator graph.

// Loudness ceiling. 0.35, not 0.5: the accepted-cadence's overlapping notes
// summed to full scale and clipped, heard as a hard edge on the chime.
export const MASTER = 0.35;

// Partial frequency multiples — a touch sharp of harmonic for chime character.
const PARTIALS = [1.0, 2.004, 3.009];
const PARTIAL_BASE = [1.0, 0.25, 0.08];

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Crush intensity → sample-hold decimation + amplitude quantization. The 25%
// entry point holds every 3rd sample at ~10 bits; full crush ~4 bits. Shared
// with crush-worklet.js so the per-note and bus crush can't drift apart.
export function crushParams(amt) {
  return {
    hold: 1 + Math.floor(amt * 11),
    levels: Math.pow(2, 12 - 8 * amt - 1),
  };
}

// A NoteSpec mirrors the game's: { onsetS (optional, default 0), freqHz,
// detuneCents, tauS, brightness 0..1, crush 0..1, gain }. tauS is the
// amplitude time constant; the note rings ~7τ (the page-facing "decay to
// silence" is 7× this).
function makeVoice(spec, sr) {
  const start = Math.floor((spec.onsetS ?? 0) * sr);
  const spread = Math.pow(2, spec.detuneCents / 2400); // voices sit ± half apart
  const brightness = clamp01(spec.brightness);
  const crushAmt = clamp01(spec.crush);
  // Brightness as a 2-pole lowpass magnitude over fixed partial gains — the
  // subtle shading the owner picked by ear.
  const cutoffMult = 2 + 8 * brightness;
  const partials = [];
  PARTIALS.forEach((mult, k) => {
    // τ_k shrinks with partial order, so the tail mellows like a real pluck.
    const tau = spec.tauS / (1 + 0.9 * k);
    const decay = Math.exp(-1 / (tau * sr));
    const amp = PARTIAL_BASE[k] / Math.sqrt(1 + Math.pow(mult / cutoffMult, 4));
    // Unequal twins: equal voices would beat to a full null at the spread's
    // period; these never cancel.
    for (const [voice, level] of [[spread, 0.58], [1 / spread, 0.42]]) {
      const hz = spec.freqHz * mult * voice;
      partials.push({ phase: 0, inc: (2 * Math.PI * hz) / sr, amp: amp * level, decay });
    }
  });
  const crush = crushAmt > 0 ? { ...crushParams(crushAmt), held: 0, holdLeft: 0 } : null;
  return {
    start,
    end: start + Math.floor(spec.tauS * 7 * sr),
    attackSamples: 0.003 * sr,
    gain: spec.gain,
    partials,
    crush,
  };
}

function renderVoice(v, out) {
  for (let t = v.start; t < v.end && t < out.length; t++) {
    const attack = Math.min(1, (t - v.start) / v.attackSamples);
    let s = 0;
    for (const p of v.partials) {
      s += Math.sin(p.phase) * p.amp;
      p.phase = (p.phase + p.inc) % (2 * Math.PI);
      p.amp *= p.decay;
    }
    s *= attack;
    // Crush PRE-gain: the quantization grid rides the note's own amplitude,
    // so polyphony attenuation can't change how coarse the crush sounds.
    const c = v.crush;
    if (c) {
      if (c.holdLeft === 0) {
        c.held = Math.round(s * c.levels) / c.levels;
        c.holdLeft = c.hold;
      }
      c.holdLeft--;
      s = c.held;
    }
    out[t] += s * v.gain;
  }
}

// Render a phrase (array of NoteSpec) to a mono Float32Array.
export function renderPhrase(notes, sampleRate) {
  const voices = notes.map((n) => makeVoice(n, sampleRate));
  const end = voices.reduce((m, v) => Math.max(m, v.end), 0);
  const out = new Float32Array(end);
  for (const v of voices) renderVoice(v, out);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(-1, Math.min(1, out[i] * MASTER));
  }
  return out;
}
