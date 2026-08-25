import relative, { label as relativeLabel } from './schemes/relative.js';
import drift, { label as driftLabel } from './schemes/drift.js';
import fixed, { label as fixedLabel } from './schemes/fixed.js';
import heldbreath, { label as heldbreathLabel, resolve as heldbreathResolve } from './schemes/heldbreath.js';
import patchwalk, { label as patchwalkLabel } from './schemes/patchwalk.js';
import harmonicField, { label as harmonicFieldLabel } from './schemes/harmonic-field.js';
import { renderPhrase } from './synth.js';
import { buildFx } from './fx.js';

// Adding a scheme = one file in schemes/ + one entry here. `resolve` (optional)
// gives the scheme completion cadences, triggered by the ✓/✗ buttons.
const SCHEMES = {
  heldbreath: { fn: heldbreath, label: heldbreathLabel, resolve: heldbreathResolve },
  relative: { fn: relative, label: relativeLabel },
  drift: { fn: drift, label: driftLabel },
  fixed: { fn: fixed, label: fixedLabel },
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
const IDLE_CLEAR_MS = 2500;
const GLYPH = { U: '↑', D: '↓', L: '←', R: '→' };

// --- URL params: every knob on the page lives in the hash, so any state is a
// shareable link, e.g. #scheme=heldbreath&fx-delay=1. Query params are folded
// into the hash once at boot (then dropped from the URL — a lingering query
// would resurrect state the user has since turned off). The URL write is
// debounced: Safari throws once history.replaceState exceeds ~100 calls/30 s,
// which one slider drag would blow through. ---
const hash = new URLSearchParams(location.hash.slice(1));
for (const [k, v] of new URLSearchParams(location.search)) {
  if (!hash.has(k)) hash.set(k, v);
}
const getParam = (k) => hash.get(k);
const getNum = (k) => {
  const v = parseFloat(getParam(k));
  return Number.isFinite(v) ? v : null;
};
let hashTimer = null;
function setParam(k, v) {
  if (v === null || v === undefined) hash.delete(k);
  else hash.set(k, String(v));
  clearTimeout(hashTimer);
  hashTimer = setTimeout(
    () => history.replaceState(null, '', location.pathname + '#' + hash.toString()),
    250,
  );
}

// The game (in-game defaults): heldbreath on hirajoshi.
const pick = (table, k, def) => (Object.hasOwn(table, k ?? '') ? k : def);
let schemeKey = pick(SCHEMES, getParam('scheme'), 'heldbreath');
let scaleKey = pick(SCALES, getParam('scale'), 'hirajoshi');
let path = [];
let idleTimer = null;

// --- audio: notes render to buffers via the parity synth, then run through
// the post-fx chain. Created suspended; first tap resumes (mobile unlock). ---
// No webkitAudioContext fallback: browsers that need the prefix predate the
// ES modules and AudioWorklet this app requires anyway.
const ctx = new AudioContext();
const fx = buildFx(ctx);
let livePhrases = 0;

function ensureAudio() {
  if (ctx.state === 'suspended') ctx.resume();
}

function playPhrase(specs) {
  // Parity: attenuate new phrases by the count still sounding, keeping the
  // summed output out of hard clipping on fast codes.
  const atten = 1 / (1 + 0.3 * livePhrases);
  const rendered = renderPhrase(
    specs.map((s) => ({ ...s, gain: s.gain * atten })),
    ctx.sampleRate,
  );
  if (rendered.length === 0) return;
  const buf = ctx.createBuffer(1, rendered.length, ctx.sampleRate);
  buf.copyToChannel(rendered, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(fx.input);
  livePhrases++;
  src.onended = () => livePhrases--;
  src.start();
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
  playPhrase([SCHEMES[schemeKey].fn(comboState(), dir)]);
  path.push(dir);
  renderPath();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(clearPath, IDLE_CLEAR_MS);
  const btn = document.querySelector(`.key[data-dir="${dir}"]`);
  btn.classList.add('lit');
  setTimeout(() => btn.classList.remove('lit'), 150);
}

// Completion cadence: accept = the code registered (exhale), reject = unknown
// code (deceptive cadence). Ends the phrase either way.
function cadence(accepted) {
  const resolve = SCHEMES[schemeKey].resolve;
  if (!resolve || path.length === 0) return;
  ensureAudio();
  playPhrase(resolve(comboState(), accepted));
  clearPath();
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

function updateCadenceButtons() {
  document.getElementById('cadence').hidden = !SCHEMES[schemeKey].resolve;
}

fillPicker('scheme-picker', SCHEMES, schemeKey, (v) => {
  schemeKey = v;
  clearPath();
  setParam('scheme', v);
  updateCadenceButtons();
});
fillPicker('scale-picker', SCALES, scaleKey, (v) => {
  scaleKey = v;
  clearPath();
  setParam('scale', v);
});
setParam('scheme', schemeKey);
setParam('scale', scaleKey);
updateCadenceButtons();

// pointerdown, not click, for press latency — but pointerdown's preventDefault
// also suppresses click, so keyboard activation (click with detail 0) gets its
// own path or Tab+Enter on a button would do nothing.
function onActivate(el, fn) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fn();
  });
  el.addEventListener('click', (e) => {
    if (e.detail === 0) fn();
  });
}

for (const btn of document.querySelectorAll('.key')) {
  onActivate(btn, () => press(btn.dataset.dir));
}
onActivate(document.getElementById('clear'), clearPath);
onActivate(document.getElementById('accept'), () => cadence(true));
onActivate(document.getElementById('reject'), () => cadence(false));

const KEYMAP = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' };
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // A focused slider/select/summary owns its keys (arrow-nudge, Enter-toggle).
  if (e.target.closest?.('input, select, textarea, button, summary')) return;
  if (KEYMAP[e.key]) {
    e.preventDefault();
    press(KEYMAP[e.key]);
  } else if (e.key === 'Enter') {
    cadence(true);
  } else if (e.key === 'Backspace') {
    cadence(false);
  } else if (e.key === 'Escape') {
    clearPath();
  }
});

// --- generic control rows (shared by the dev + fx panels) ---
// Log-scaled sliders (filter cutoff) move in log-space; display stays real.
function sliderRow(p, value, onInput, onChange) {
  const row = document.createElement('label');
  row.className = 'ctl-row';
  const name = document.createElement('span');
  name.textContent = p.label;
  const input = document.createElement('input');
  input.type = 'range';
  const toSlider = (v) => (p.log ? Math.log10(v) : v);
  const fromSlider = (v) => (p.log ? Math.pow(10, v) : v);
  input.min = toSlider(p.min);
  input.max = toSlider(p.max);
  input.step = p.log ? 0.001 : p.step;
  input.value = toSlider(value);
  const readout = document.createElement('span');
  readout.className = 'readout';
  const show = (v) => (readout.textContent = p.log ? Math.round(v) : +v.toFixed(3));
  show(value);
  input.addEventListener('input', () => {
    const v = fromSlider(parseFloat(input.value));
    show(v);
    onInput(v);
  });
  if (onChange) input.addEventListener('change', () => onChange());
  row.append(name, input, readout);
  return row;
}

function selectRow(p, value, onInput) {
  const row = document.createElement('label');
  row.className = 'ctl-row';
  const name = document.createElement('span');
  name.textContent = p.label;
  const sel = document.createElement('select');
  for (const opt of p.options) {
    const o = document.createElement('option');
    o.value = o.textContent = opt;
    sel.appendChild(o);
  }
  sel.value = value;
  sel.addEventListener('change', () => onInput(sel.value));
  row.append(name, sel);
  return row;
}

function wirePanel(id, key) {
  const el = document.getElementById(id);
  el.open = getParam(key) === '1';
  el.addEventListener('toggle', () => setParam(key, el.open ? '1' : null));
}

// --- dev mode: the full synth surface on sliders, no code entry needed ---
const DEV_SLIDERS = [
  { key: 'pitch', label: 'pitch (semis / A2)', min: 0, max: 36, step: 1, def: 12 },
  { key: 'detune', label: 'detune (cents)', min: 0, max: 100, step: 1, def: 0 },
  { key: 'decay', label: 'decay (s)', min: 0.1, max: 3, step: 0.05, def: 1.1 },
  { key: 'bright', label: 'brightness', min: 0, max: 1, step: 0.01, def: 0.55 },
  { key: 'crush', label: 'crush', min: 0, max: 1, step: 0.01, def: 0 },
  { key: 'gain', label: 'gain', min: 0, max: 1, step: 0.01, def: 0.8 },
];
const devVals = {};

function devPluck() {
  ensureAudio();
  playPhrase([
    {
      onsetS: 0,
      freqHz: (ROOT_HZ / 2) * Math.pow(2, devVals.pitch / 12), // A2, the heldbreath register
      detuneCents: devVals.detune,
      tauS: devVals.decay / 7,
      brightness: devVals.bright,
      crush: devVals.crush,
      gain: devVals.gain,
    },
  ]);
}

{
  wirePanel('dev-panel', 'dev');
  const root = document.getElementById('dev-controls');
  for (const s of DEV_SLIDERS) {
    devVals[s.key] = getNum('dev-' + s.key) ?? s.def;
    root.appendChild(
      sliderRow(s, devVals[s.key], (v) => {
        devVals[s.key] = v;
        setParam('dev-' + s.key, v);
      }, devPluck),
    );
  }
  onActivate(document.getElementById('pluck'), devPluck);
}

// --- post-fx panel: one fieldset per chain stage ---
{
  wirePanel('fx-panel', 'fx');
  const root = document.getElementById('fx-controls');
  for (const st of fx.stages) {
    const box = document.createElement('fieldset');
    box.className = 'fx-stage';
    const legend = document.createElement('legend');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = getParam(`fx-${st.key}`) === '1';
    st.setEnabled(toggle.checked);
    toggle.addEventListener('change', () => {
      st.setEnabled(toggle.checked);
      setParam(`fx-${st.key}`, toggle.checked ? '1' : null);
    });
    const name = document.createElement('span');
    name.textContent = st.label;
    legend.append(toggle, name);
    box.appendChild(legend);
    const wetP = { key: 'wet', label: 'wet', min: 0, max: 1, step: 0.01 };
    const wet0 = getNum(`fx-${st.key}-wet`) ?? st.wetAmt;
    st.setWet(wet0);
    box.appendChild(
      sliderRow(wetP, wet0, (v) => {
        st.setWet(v);
        setParam(`fx-${st.key}-wet`, v);
      }),
    );
    for (const p of st.params) {
      const k = `fx-${st.key}-${p.key}`;
      if (p.kind === 'select') {
        const v0 = p.options.includes(getParam(k)) ? getParam(k) : p.def;
        if (v0 !== p.def) p.set(v0);
        box.appendChild(selectRow(p, v0, (v) => {
          p.set(v);
          setParam(k, v);
        }));
      } else {
        const v0 = getNum(k) ?? p.def;
        if (v0 !== p.def) p.set(v0);
        // Lazy params (expensive sets, e.g. reverb IR rebuild) apply on
        // release; everything else tracks the drag.
        let pending = v0;
        box.appendChild(
          sliderRow(
            p,
            v0,
            (v) => {
              pending = v;
              if (!p.lazy) p.set(v);
              setParam(k, v);
            },
            p.lazy ? () => p.set(pending) : null,
          ),
        );
      }
    }
    root.appendChild(box);
  }
}
