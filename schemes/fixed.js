// Fixed 1:1 baseline: each direction is always the same scale degree
// (L=0 D=1 R=2 U=3). Kept as a comparison point — the owner already rejected
// this as the final mapping; A/B against it to hear why.

import { degreeToFreq } from './lib.js';

const DEGREE = { L: 0, D: 1, R: 2, U: 3 };

export default function fixed(state, press) {
  return {
    freqHz: degreeToFreq(DEGREE[press], state.scale, state.rootHz),
    detuneCents: 0,
    tauS: 1.1 / 7,
    brightness: 0.5,
    crush: 0,
    gain: 0.8,
  };
}

export const label = 'fixed 1:1 (baseline)';
