// patchwalk — timbre as place. The combo tree is a territory: each depth-1
// subtree is a timbral region (L glass, R wood, U air, D depth), and every
// press adds a direction-specific delta to a continuous patch vector, step
// size shrinking geometrically with depth — regions far apart, neighborhoods
// close, so a code is a WALK whose sound says where you are, eyes closed.
// Deltas are additive+clamped, so permuted codes converge on (nearly) the
// same destination patch while sounding like different performances en route.
// Depth drags register down and detune up — deep space is darker, wider.

import { degreeToFreq } from './lib.js';

// Where each region pulls the patch. The sketch's patch vector had five
// axes (brightness, inharm, breath, warmth, shimmer); the synth renders
// brightness directly and warmth maps to decay length.
// TODO: inharm/breath/shimmer need partial-ratio, noise, and chorus controls
// the synth doesn't expose — folded into brightness so the walk stays audible.
const ROOT_PATCH = { brightness: 0.35, inharm: 0.15, breath: 0.2, warmth: 0.7 };
const DELTA = {
  L: { brightness: +0.18, inharm: +0.55, breath: -0.1, warmth: -0.25 }, // glass
  R: { brightness: -0.15, inharm: -0.2, breath: +0.05, warmth: +0.35 }, // wood
  U: { brightness: +0.3, inharm: +0.1, breath: +0.45, warmth: -0.15 }, // air
  D: { brightness: -0.3, inharm: +0.15, breath: +0.1, warmth: +0.3 }, // depth
};
const stepAtDepth = (d) => 0.85 * Math.pow(0.6, d);

// Scale-degree motion: U/D step, R/L leap — melodic, everything in scale.
const DEGREE_STEP = { U: 1, D: -1, R: 2, L: -2 };

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function walk(path) {
  const p = { ...ROOT_PATCH };
  let degree = 0;
  path.forEach((dir, i) => {
    const s = stepAtDepth(i);
    for (const k in DELTA[dir]) p[k] = clamp01(p[k] + DELTA[dir][k] * s);
    degree += DEGREE_STEP[dir];
  });
  return { patch: p, degree };
}

export default function patchwalk(state, press) {
  const after = [...state.path, press];
  const { patch, degree } = walk(after);
  const depth = after.length;
  return {
    // deep space sinks: -1 semitone of continuous drift per 3 presses
    freq: degreeToFreq(degree, state.scale, state.rootHz) * Math.pow(2, -depth / 36),
    detuneCents: 3 + depth * 4, // deeper = wider
    gain: 0.8,
    timbre: {
      // inharm/breath tilt the shade so glass and air still read differently
      brightness: clamp01(patch.brightness + 0.15 * patch.inharm + 0.1 * patch.breath),
      decay: 0.7 + patch.warmth * 0.8, // warm regions ring longer
    },
  };
}

export const label = 'patchwalk (timbre as place)';
