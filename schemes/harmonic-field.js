// harmonic field — the combo tree is a pitch lattice. U/D step the melody
// axis (scale steps); L/R step the chord axis (motion by scale-thirds —
// harmonic color). Two orderings of the same presses land on the same
// lattice point: different melody, identical arrival harmony.
//
// The sketch sounded each node as lead + a third-stack pad rooted at the
// chord axis; the synth renders one voice per press, so here U/D presses
// sound the melody note and L/R presses sound the chord root you moved to,
// an octave down — the axis split stays audible as register + interval.
// TODO: the pad chord under the lead needs a multi-voice event the synth
// can't render. (The sketch's unlock-widening scale is the playground's
// scale picker; everything is unlocked here.)

import { degreeToFreq } from './lib.js';

const MOVES = { L: [-1, 0], R: [1, 0], D: [0, -1], U: [0, 1] };

export default function harmonicField(state, press) {
  let x = 0;
  let y = 0;
  for (const p of [...state.path, press]) {
    x += MOVES[p][0];
    y += MOVES[p][1];
  }
  const depth = state.depth + 1;
  const chordAxis = press === 'L' || press === 'R';
  // chord root at lattice x = scale degree 2x (a third-stack's foot)
  const deg = chordAxis ? 2 * x - state.scale.length : y;
  return {
    freq: degreeToFreq(deg, state.scale, state.rootHz),
    // deeper = hazier and darker
    detuneCents: Math.min(depth, 8) * 1.3,
    gain: chordAxis ? 0.7 : 0.85,
    timbre: {
      decay: chordAxis ? 1.6 : 0.9, // pad register rings longer than the lead
      brightness: Math.max(0.25, 1 - depth * 0.09) * (chordAxis ? 0.6 : 1),
    },
  };
}

export const label = 'harmonic field (pitch lattice)';
