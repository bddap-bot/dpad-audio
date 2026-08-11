import relative from './schemes/relative.js';
import drift from './schemes/drift.js';
import fixed from './schemes/fixed.js';
import { label as relativeLabel } from './schemes/relative.js';
import { label as driftLabel } from './schemes/drift.js';
import { label as fixedLabel } from './schemes/fixed.js';
import heldbreath, { label as heldbreathLabel } from './schemes/heldbreath.js';
import patchwalk, { label as patchwalkLabel } from './schemes/patchwalk.js';
import harmonicField, { label as harmonicFieldLabel } from './schemes/harmonic-field.js';

// Adding a scheme = one file in schemes/ + one entry here.
const SCHEMES = {
  relative: { fn: relative, label: relativeLabel },
  drift: { fn: drift, label: driftLabel },
  fixed: { fn: fixed, label: fixedLabel },
  heldbreath: { fn: heldbreath, label: heldbreathLabel },
  patchwalk: { fn: patchwalk, label: patchwalkLabel },
  'harmonic-field': { fn: harmonicField, label: harmonicFieldLabel },
};

const SCALES = {
  'minor-pent': { label: 'minor pentatonic', semis: [0, 3, 5, 7, 10] },
  'major-pent': { label: 'major pentatonic', semis: [0, 2, 4, 7, 9] },
  hirajoshi: { label: 'hirajoshi', semis: [0, 2, 3, 7, 8] },
  insen: { label: 'insen', semis: [0, 1, 5, 7, 10] },
  dorian: { label: 'dorian', semis: [0, 2, 3, 5, 7, 9, 10] },
};

const ROOT_HZ = 220; // A3
const MAX_DEPTH = 12;
const IDLE_CLEAR_MS = 2500;
const GLYPH = { U: '↑', D: '↓', L: '←', R: '→' };

// --- URL params (hash wins over query), e.g. #scheme=drift&scale=insen ---
function params() {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.slice(1));
  return (k) => h.get(k) ?? q.get(k);
}

let schemeKey = SCHEMES[params()('scheme')] ? params()('scheme') : 'relative';
let scaleKey = SCALES[params()('scale')] ? params()('scale') : 'minor-pent';
let path = [];
let idleTimer = null;

// --- audio ---
let ctx = null;

function ensureAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume(); // iOS/Android unlock on first tap
}

// Chime/pluck: two slightly-detuned fundamentals + a fast-decaying partial,
// through a lowpass whose cutoff is the event's brightness.
function play(ev) {
  const t = ctx.currentTime;
  const { decay, brightness } = ev.timbre;

  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(ev.gain * 0.35, t + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, t + decay);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = ev.freq * (2 + brightness * 8);
  lp.Q.value = 0.7;
  out.connect(lp).connect(ctx.destination);

  const stop = t + decay + 0.05;
  for (const [mult, cents, gain, dec] of [
    [1, ev.detuneCents + 3, 1.0, decay],
    [1, ev.detuneCents - 3, 0.7, decay],
    [2, ev.detuneCents, 0.25, decay * 0.4],
    [3.01, ev.detuneCents, 0.08, decay * 0.2],
  ]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = ev.freq * mult;
    osc.detune.value = cents;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(dec, 0.05));
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(stop);
  }
}

// --- combo state + press handling ---
function comboState() {
  return {
    path: [...path],
    depth: path.length,
    unlocks: new Set(), // playground: everything unlocked; here for scheme parity
    scale: SCALES[scaleKey].semis,
    rootHz: ROOT_HZ,
  };
}

function press(dir) {
  ensureAudio();
  if (path.length >= MAX_DEPTH) path = [];
  play(SCHEMES[schemeKey].fn(comboState(), dir));
  path.push(dir);
  renderPath();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(clearPath, IDLE_CLEAR_MS);
  const btn = document.querySelector(`.key[data-dir="${dir}"]`);
  btn.classList.add('lit');
  setTimeout(() => btn.classList.remove('lit'), 150);
}

function clearPath() {
  path = [];
  clearTimeout(idleTimer);
  renderPath();
}

function renderPath() {
  const el = document.getElementById('path');
  el.innerHTML = '';
  path.forEach((d, i) => {
    const s = document.createElement('span');
    s.textContent = GLYPH[d];
    if (i === path.length - 1) s.className = 'latest';
    el.appendChild(s);
  });
}

// --- UI wiring ---
function fillPicker(id, entries, current, onChange) {
  const sel = document.getElementById(id);
  for (const [key, v] of Object.entries(entries)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = v.label;
    sel.appendChild(o);
  }
  sel.value = current;
  sel.addEventListener('change', () => onChange(sel.value));
}

function syncHash() {
  location.hash = `scheme=${schemeKey}&scale=${scaleKey}`;
}

fillPicker('scheme-picker', SCHEMES, schemeKey, (v) => { schemeKey = v; clearPath(); syncHash(); });
fillPicker('scale-picker', SCALES, scaleKey, (v) => { scaleKey = v; clearPath(); syncHash(); });

for (const btn of document.querySelectorAll('.key')) {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    press(btn.dataset.dir);
  });
}
document.getElementById('clear').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  clearPath();
});

const KEYMAP = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' };
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (KEYMAP[e.key]) {
    e.preventDefault();
    press(KEYMAP[e.key]);
  } else if (e.key === 'Escape') {
    clearPath();
  }
});
