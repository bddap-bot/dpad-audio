// heldbreath — THE in-game scheme; bddap/rl crab-world/src/instrument.rs is
// the source of truth and this file tracks it (parity sync 2026-08-25).
// An unresolved combo is a held breath: presses are intervals relative to the
// melody so far, depth is a felt tension gradient (twin-voice detune +
// bitcrush), and the first press shades the whole phrase's brightness.
// Completion is a cadence (the ✓/✗ buttons): accept exhales a chord spelled
// from the code's own melody; reject is a deceptive cadence a half-step off
// home that KEEPS the accumulated tension.

import { degreeToFreq } from './lib.js';

// Press = motion, not a key: interval relative to where the melody stands.
const STEP = { U: 2, R: 1, L: -1, D: -2 };

// Region (first press of the code) owns the timbre family — brightness shades
// (L dark, D warm, R hollow-ish, U glassy), the sound the owner picked.
const REGION_BRIGHTNESS = { L: 0.3, D: 0.55, R: 0.4, U: 0.75 };

// The owner's deep-code tension curves (rl#380), by 0-based note index: note 0
// is PURE; detune ramps immediately as sqrt(s/8) of ±48¢ (voices at ± half);
// crush is silent below note 4, pops in at 25% of the ceiling, reaches it by
// note 12. Ceiling dialed to 1/3 of full by playtest (owner 2026-08-14).
const MAX_DETUNE_CENTS = 48;
const MAX_CRUSH = 1 / 3;
const tensionDetune = (s) => Math.min(1, Math.sqrt(s / 8));
const tensionCrush = (s) =>
  s < 4 ? 0 : MAX_CRUSH * Math.min(1, 0.25 + (0.75 * (s - 4)) / 8);

// The melody's walk: the degree after each press in turn. Starts one octave
// above the root (home, mid register); each step clamps to ~3 octaves so an
// uncapped code pins at the edge instead of walking off the piano.
function walk(path, scale) {
  const n = scale.length;
  let deg = n;
  const out = [];
  for (const p of path) {
    deg = Math.max(0, Math.min(3 * n - 1, deg + STEP[p]));
    out.push(deg);
  }
  return out;
}

// heldbreath voices its melody an octave below the page root (dark register).
const rootOf = (state) => state.rootHz / 2;

export default function heldbreath(state, press) {
  const depth = state.depth;
  const region = REGION_BRIGHTNESS[state.path[0] ?? press];
  const degs = walk([...state.path, press], state.scale);
  return {
    freqHz: degreeToFreq(degs[degs.length - 1], state.scale, rootOf(state)),
    detuneCents: MAX_DETUNE_CENTS * tensionDetune(depth),
    tauS: Math.max(0.4, 1.1 - 0.08 * depth) / 7, // breath tightens with depth
    brightness: Math.max(0.15, region - 0.06 * depth),
    crush: tensionCrush(depth),
    gain: 0.8,
  };
}

// Completion = cadence, returned as synth.js NoteSpecs. Accepted is the
// EXHALE, spelled from the code's own melody: the distinct degrees the walk
// visited (most recent four, ≥2 semitones apart, in visit order) strummed as
// a pure chord — detune and crush collapse to zero — landing longest and
// loudest on the home octave. Unknown: a deceptive cadence a half-step off
// home (the one out-of-scale interval), keeping the accumulated detune+crush
// and damping early — the breath is not released.
export function resolve(state, accepted) {
  const scale = state.scale;
  const n = scale.length;
  const root = rootOf(state);
  const home = n;
  if (accepted) {
    const visited = [];
    for (const d of walk(state.path, scale)) {
      if (d !== home && !visited.includes(d)) visited.push(d);
    }
    // Semitone value of a degree — for spacing the chord, since scales with
    // semitone adjacencies (hirajoshi's B-C, E-F) would cluster when a
    // mono-direction code visits neighbors.
    const semi = (i) => 12 * Math.floor(i / n) + scale[((i % n) + n) % n];
    const strum = [];
    for (const d of [...visited].reverse()) {
      if (strum.length === 4) break;
      if (strum.every((e) => Math.abs(semi(d) - semi(e)) >= 2)) strum.push(d);
    }
    strum.reverse();
    const notes = strum.map((d, i) => ({
      onsetS: 0.09 * i,
      freqHz: degreeToFreq(d, scale, root),
      detuneCents: 0,
      tauS: 0.28,
      brightness: 0.7,
      crush: 0,
      gain: 0.6,
    }));
    notes.push({
      onsetS: 0.09 * strum.length,
      freqHz: degreeToFreq(home, scale, root),
      detuneCents: 0,
      tauS: 0.45,
      brightness: 0.85,
      crush: 0,
      gain: 0.85,
    });
    return notes;
  }
  // The ACCUMULATED tension: what the deepest note actually sounded carried
  // (index len−1), not one step past it.
  const depth = Math.max(0, state.path.length - 1);
  const detune = MAX_DETUNE_CENTS * tensionDetune(depth);
  const crush = tensionCrush(depth);
  const homeHz = degreeToFreq(home, scale, root);
  return [
    { onsetS: 0, freqHz: homeHz * 2 ** (1 / 12), detuneCents: detune, tauS: 0.16, brightness: 0.35, crush, gain: 0.9 },
    { onsetS: 0.07, freqHz: homeHz * 2 ** (-5 / 12), detuneCents: detune, tauS: 0.19, brightness: 0.2, crush, gain: 0.75 },
  ];
}

export const label = 'heldbreath (in-game)';
