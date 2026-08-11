// Depth drift: relative walk, but the sound DRIFTS as combos go deeper —
// detune widens with depth and timbre varies by which region of dpad-space
// the path has explored (the owner's "detune as combos progress deeper" idea).

import { walkDegrees, degreeToFreq, pathHash } from './lib.js';

const STEP = { U: 1, R: 2, D: -1, L: -2 };

export default function drift(state, press) {
  const degree = walkDegrees(state.path, STEP) + STEP[press];
  const depth = state.depth + 1;
  const sign = depth % 2 === 0 ? 1 : -1;
  return {
    freq: degreeToFreq(degree, state.scale, state.rootHz),
    detuneCents: sign * Math.min(depth * 5, 35),
    gain: 0.8,
    timbre: {
      decay: Math.max(0.5, 1.3 - depth * 0.08),
      brightness: 0.25 + 0.6 * pathHash([...state.path, press]),
    },
  };
}

export const label = 'depth drift';
