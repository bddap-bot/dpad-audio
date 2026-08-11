// heldbreath — tension gradient: an unresolved combo is a held breath.
// Each press deeper detunes wider, decays shorter, and dims — the beating
// and tightening TELL you how deep you are without counting. The first
// press of a code picks a timbre region that colors the whole phrase.
//
// The design sketch also had cadence events (accept = exhale chord,
// reject = damped miss, unlock = converging bloom); the playground only
// sends directional presses, so those gestures have no trigger here.

import { degreeToFreq } from './lib.js';

// Press = motion, not a key: interval relative to where the melody stands.
const STEP = { U: 2, R: 1, L: -1, D: -2 };

// Region (first press of the code) owns the timbre family.
// TODO: darkpluck/bell/hollow/glass want distinct oscillator recipes; the
// synth's only timbre axes are decay+brightness, so families are shades.
const REGION_BRIGHTNESS = { L: 0.3, D: 0.55, R: 0.4, U: 0.75 };

// Fold the path to the current degree. Start one octave up (mid register),
// clamp to ~3 octaves so deep codes can't run away.
function degreeAfter(path, scale) {
  const n = scale.length;
  let deg = n;
  for (const p of path) deg = Math.max(0, Math.min(3 * n - 1, deg + STEP[p]));
  return deg;
}

export default function heldbreath(state, press) {
  const depth = state.depth;
  const region = REGION_BRIGHTNESS[state.path[0] ?? press];
  return {
    freq: degreeToFreq(
      degreeAfter([...state.path, press], state.scale),
      state.scale,
      state.rootHz / 2 // sketch voiced this an octave down: dark register
    ),
    detuneCents: 6 * (depth + 1), // the gradient: beating grows with depth
    gain: 0.8,
    timbre: {
      decay: Math.max(0.4, 1.1 - 0.08 * depth), // breath tightens
      brightness: Math.max(0.15, region - 0.06 * depth),
    },
  };
}

export const label = 'heldbreath (tension gradient)';
