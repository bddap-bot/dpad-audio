// Parity checks against crab-world/src/instrument.rs — `node test.js`.
// Mirrors the rust tests that cover the ported math; the DOM/AudioContext
// halves (app.js, fx.js) are exercised in-browser, not here.
import assert from 'node:assert/strict';
import heldbreath, { resolve } from './schemes/heldbreath.js';
import { renderPhrase } from './synth.js';

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

console.log('parity tests pass');
