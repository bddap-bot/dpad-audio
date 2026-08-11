// Pentatonic relative walk (default scheme).
//
// A scheme is a pure function (comboState, press) -> soundEvent.
//   comboState: { path, depth, unlocks, scale, rootHz }
//     path:   presses so far, NOT including this one, e.g. ['U','R']
//     scale:  semitone offsets from the root, e.g. [0,3,5,7,10]
//   press: 'U' | 'D' | 'L' | 'R'
//   soundEvent: { freq, detuneCents, gain, timbre: { decay, brightness } }
//
// Here each direction moves a number of SCALE DEGREES relative to where the
// melody already is, so the same press sounds different depending on the path
// — a combo is a phrase, not four unrelated beeps.

import { walkDegrees, degreeToFreq } from './lib.js';

const STEP = { U: 1, R: 2, D: -1, L: -2 };

export default function relative(state, press) {
  const degree = walkDegrees(state.path, STEP) + STEP[press];
  return {
    freq: degreeToFreq(degree, state.scale, state.rootHz),
    detuneCents: 0,
    gain: 0.8,
    timbre: { decay: 1.1, brightness: 0.5 },
  };
}

export const label = 'relative walk';
