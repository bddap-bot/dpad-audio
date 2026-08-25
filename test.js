// Parity checks against crab-world/src/instrument.rs — `node test.js`.
// Mirrors the rust tests that cover the ported math; the DOM/AudioContext
// halves (app.js, fx.js) are exercised in-browser, not here.
import assert from 'node:assert/strict';
import heldbreath, { resolve } from './schemes/heldbreath.js';
import { renderPhrase } from './synth.js';
import { WAVE_NAMES, waveFn } from './waves.js';
import { MOD_DEFAULT, mapValue, lfoLevel, adsrLevel } from './mod.js';

const HIRAJOSHI = [0, 2, 3, 7, 8];
const state = (path) => ({
  path,
  depth: path.length,
  unlocks: new Set(),
  scale: HIRAJOSHI,
  rootHz: 220,
});
const at = (depth) => heldbreath(state(Array(depth).fill('U')), 'D');

// Owner tension curve (rl#380): note 0 pure; detune 50% at 2, full (±48¢) by 8;
// crush 0 through 3, 25% of the 1/3 ceiling at 4, ceiling by 12; both hold.
assert.deepEqual([at(0).detuneCents, at(0).crush], [0, 0], 'note 0 is pure');
assert.ok(Math.abs(at(2).detuneCents / 48 - 0.5) < 1e-3);
assert.equal(at(8).detuneCents, 48);
assert.equal(at(20).detuneCents, 48, 'detune holds');
assert.equal(at(3).crush, 0, 'crush silent before note 4');
assert.ok(Math.abs(at(4).crush - 0.25 / 3) < 1e-3, 'crush pops in at 25% of ceiling');
assert.ok(Math.abs(at(12).crush - 1 / 3) < 1e-6);
assert.ok(Math.abs(at(20).crush - 1 / 3) < 1e-6, 'crush holds');

// Presses stay on the scale (root A2 = 110 — heldbreath voices an octave down).
for (const p of [[], ['U'], ['U', 'U'], ['D', 'L', 'R']]) {
  const f = heldbreath(state(p), 'U').freqHz;
  const semis = 12 * Math.log2(f / 110);
  const folded = ((Math.round(semis) % 12) + 12) % 12;
  assert.ok(Math.abs(semis - Math.round(semis)) < 1e-3 && HIRAJOSHI.includes(folded));
}

// Accepted cadence: chord varies with the code, every note pure, lands the
// home octave (2× root); mono-direction codes never cluster under 2 semitones.
const chord = (p) => resolve(state(p), true);
const pitches = (c) => c.map((n) => Math.round(n.freqHz));
assert.notDeepEqual(pitches(chord(['U', 'U', 'D'])), pitches(chord(['D', 'D', 'U'])));
for (const c of [chord(['U', 'U', 'D']), chord(['D', 'D', 'U'])]) {
  assert.ok(c.every((n) => n.detuneCents === 0 && n.crush === 0));
  assert.ok(Math.abs(c[c.length - 1].freqHz / 110 - 2) < 1e-3, 'exhale lands home');
}
const mono = chord(['R', 'R', 'R', 'R']);
const strum = mono.slice(0, -1);
for (let i = 0; i < strum.length; i++) {
  for (let j = i + 1; j < strum.length; j++) {
    const semis = Math.abs(12 * Math.log2(strum[i].freqHz / strum[j].freqHz));
    assert.ok(semis >= 1.9, `cluster in the derived chord: ${semis}`);
  }
}

// Unknown cadence keeps the accumulated tension, damped, off the scale.
const bad = resolve(state(['U', 'U', 'U', 'U', 'U']), false);
assert.ok(bad[0].detuneCents > 0 && bad[0].crush > 0);
assert.ok(bad.every((n) => n.tauS < 0.25), 'damped, unreleased');
const badSemis = 12 * Math.log2(bad[0].freqHz / 110);
assert.ok(!HIRAJOSHI.includes(((Math.round(badSemis) % 12) + 12) % 12), 'lands OFF the scale');

// The synth terminates, stays clamped with headroom, and actually sounds.
const deep = heldbreath(state(Array(12).fill('D')), 'U');
// deep rendered AS RETURNED by the scheme (no onsetS injected) — a press
// event must sound without the caller patching it up.
const notes = [deep, ...resolve(state(['U']), true)];
const samples = renderPhrase(notes, 44100);
assert.ok(samples.length > 0 && samples.length < 10 * 44100, 'runaway tail');
let peak = 0;
for (const s of samples) peak = Math.max(peak, Math.abs(s));
assert.ok(peak < 0.99, `phrase rides the clamp: ${peak}`);
assert.ok(peak > 0.05, `inaudible phrase: ${peak}`);
let tail = 0;
for (const s of samples.slice(-100)) tail = Math.max(tail, Math.abs(s));
assert.ok(tail < 0.01, `tail still hot at cutoff: ${tail}`);

// Every scheme's press event, rendered AS RETURNED, actually sounds — guards
// the NoteSpec contract between schemes/ and synth.js (a missing field NaNs
// the render into silence, not an error).
for (const name of ['relative', 'drift', 'fixed', 'heldbreath', 'patchwalk', 'harmonic-field']) {
  const m = await import(`./schemes/${name}.js`);
  const ev = m.default(state(['U']), 'D');
  const r = renderPhrase([ev], 44100);
  let p = 0;
  for (const s of r) p = Math.max(p, Math.abs(s));
  assert.ok(r.length > 0 && p > 0.02, `${name} press is silent: len=${r.length} peak=${p}`);
}

// --- waves (dpad-audio#3): 20 real, distinct, normalized shapes ---
assert.equal(WAVE_NAMES.length, 20, 'exactly 20 wave types');
const TAU = 2 * Math.PI;
const M = 256;
const sampled = WAVE_NAMES.map((n) => {
  const f = waveFn(n);
  return [...Array(M)].map((_, i) => f((TAU * i) / M));
});
sampled.forEach((s, i) => {
  const mean = s.reduce((a, b) => a + b, 0) / M;
  const peak = Math.max(...s.map(Math.abs));
  assert.ok(Math.abs(mean) < 0.02, `${WAVE_NAMES[i]} has DC offset ${mean}`);
  assert.ok(peak > 0.95 && peak <= 1.001, `${WAVE_NAMES[i]} peak ${peak} not normalized`);
});
for (let i = 0; i < sampled.length; i++) {
  for (let j = i + 1; j < sampled.length; j++) {
    const d = Math.max(...sampled[i].map((v, k) => Math.abs(v - sampled[j][k])));
    assert.ok(d > 0.05, `waves ${WAVE_NAMES[i]} and ${WAVE_NAMES[j]} are near-identical (maxdiff ${d})`);
  }
}
assert.equal(waveFn('nonsense')(Math.PI / 2), waveFn('sine')(Math.PI / 2), 'unknown wave falls back to sine');

// --- NoteSpec extensions: wave + vibrato change the render, stay bounded ---
const base = { onsetS: 0, freqHz: 220, detuneCents: 0, tauS: 0.15, brightness: 0.5, crush: 0, gain: 0.8 };
const plain = renderPhrase([base], 44100);
const square = renderPhrase([{ ...base, wave: 'square' }], 44100);
const vib = renderPhrase([{ ...base, vibRateHz: 6, vibDepthCents: 50 }], 44100);
assert.equal(plain.length, square.length);
assert.equal(plain.length, vib.length);
const maxdiff = (a, b) => Math.max(...[...a.keys()].map((i) => Math.abs(a[i] - b[i])));
assert.ok(maxdiff(plain, square) > 0.01, 'wave type has no audible effect');
assert.ok(maxdiff(plain, vib) > 0.01, 'vibrato has no audible effect');
for (const r of [square, vib]) {
  let p = 0;
  for (const s of r) {
    assert.ok(Number.isFinite(s));
    p = Math.max(p, Math.abs(s));
  }
  assert.ok(p > 0.05 && p < 0.99, `extended note peak out of range: ${p}`);
}

// --- mod mappings (dpad-audio#4): the one evaluation path in mod.js ---
// applied = clamp01(clamp(norm(base) + offset + amount·src, min, max))
const md = (over) => ({ ...MOD_DEFAULT, ...over });
assert.equal(mapValue(md({}), 0.3, 0), 0.3, 'identity mapping leaves base alone');
assert.equal(mapValue(md({ offset: -0.5, amount: 2, min: -2, max: 2 }), 0.5, 0.5), 1, 'clamp01 caps the top');
assert.equal(mapValue(md({ amount: -2, min: -2 }), 0.2, 0.4), 0, 'clamp01 caps the bottom');
assert.equal(mapValue(md({ min: 0.2, max: 0.8 }), 0.9, 0), 0.8, 'max window clamps');
assert.equal(mapValue(md({ min: 0.2, max: 0.8 }), 0, 0), 0.2, 'min window clamps');

// adsr piecewise: a=1 d=1 s=0.5 r=1, gate on at t=0, off at t=4.
const env = md({ a: 1, d: 1, s: 0.5, r: 1 });
const lv = (t) => adsrLevel(env, t, 0, 4);
assert.equal(lv(-1), 0, 'silent before the gate');
assert.equal(lv(0.5), 0.5, 'mid-attack');
assert.equal(lv(1), 1, 'attack peak');
assert.equal(lv(1.5), 0.75, 'mid-decay');
assert.equal(lv(3), 0.5, 'sustain');
assert.equal(lv(4.5), 0.25, 'mid-release');
assert.equal(lv(6), 0, 'released');
assert.equal(adsrLevel(md({ a: 0 }), 0, 0, null), 1, 'zero attack jumps, no NaN');
assert.equal(adsrLevel(md({ r: 0 }), 5, 0, 4), 0, 'zero release cuts, no NaN');
assert.equal(adsrLevel(env, 1, null, null), 0, 'no gate yet');

// lfo: sine at 1 Hz — mid at t=0, peak at t=1/4; bounded for every wave.
assert.ok(Math.abs(lfoLevel(md({ wave: 'sine' }), 0) - 0.5) < 0.01);
assert.ok(Math.abs(lfoLevel(md({ wave: 'sine' }), 0.25) - 1) < 0.01);
for (const wave of WAVE_NAMES) {
  for (const t of [0, 0.1, 0.33, 0.7, 12.9]) {
    const v = lfoLevel(md({ wave, rate: 3 }), t);
    assert.ok(v >= 0 && v <= 1, `lfo ${wave} out of range at ${t}: ${v}`);
  }
}

console.log('parity tests pass');
