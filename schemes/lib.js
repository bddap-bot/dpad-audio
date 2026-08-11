// Shared helpers for schemes. Schemes stay pure; all state lives in comboState.

// Fold a path of presses into a running scale-degree using a step table.
export function walkDegrees(path, step) {
  return path.reduce((d, p) => d + step[p], 0);
}

// Scale degree -> frequency. Degrees outside one octave wrap with octave shift.
export function degreeToFreq(degree, scale, rootHz) {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const semis = scale[((degree % n) + n) % n] + 12 * octave;
  return rootHz * Math.pow(2, semis / 12);
}

// Small deterministic hash of a path string, 0..1. Lets timbre vary by region
// of dpad-space without any hidden state.
export function pathHash(path) {
  let h = 2166136261;
  for (const c of path.join('')) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
