import relative, { label as relativeLabel } from './schemes/relative.js';
import drift, { label as driftLabel } from './schemes/drift.js';
import fixed, { label as fixedLabel } from './schemes/fixed.js';
import heldbreath, { label as heldbreathLabel, resolve as heldbreathResolve } from './schemes/heldbreath.js';
import patchwalk, { label as patchwalkLabel } from './schemes/patchwalk.js';
import harmonicField, { label as harmonicFieldLabel } from './schemes/harmonic-field.js';
import { renderPhrase } from './synth.js';
import { buildRack, connectLimited, DEFAULT_ORDER } from './fx.js';

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
// the post-fx racks. Created suspended; first tap resumes (mobile unlock). ---
// No webkitAudioContext fallback: browsers that need the prefix predate the
// ES modules and AudioWorklet this app requires anyway.
const ctx = new AudioContext();

// Rack order in the hash: <prefix>order=comma,list. Unknown keys drop and
// missing ones append in default order, so an old URL (no order param) and a
// URL from a future stage-set both decode to something sensible.
function decodeOrder(prefix) {
  const raw = getParam(prefix + 'order');
  if (!raw) return DEFAULT_ORDER;
  const seen = raw.split(',').filter((k) => DEFAULT_ORDER.includes(k));
  return [...new Set([...seen, ...DEFAULT_ORDER.filter((k) => !seen.includes(k))])];
}

// Master rack keeps the pre-#2 fx-* hash keys, so already-shared URLs decode
// unchanged. Each layer rack feeds it: source → layer rack → master → limiter.
const master = buildRack(ctx, decodeOrder('fx-'));
connectLimited(ctx, master.output);

// --- 3 synth layers (dpad-audio#2): a layer is a transform on every note
// played (scheme presses, cadences, dev pluck) — pitch/detune offsets and
// decay/gain multipliers, NOT absolute values, so a scheme's expressive
// curve (tension detune/crush) passes through — plus that layer's own rack.
// Layer 1 defaults to the identity transform, enabled; 2 and 3 start off, so
// an old URL sounds exactly as it always did.
const LAYER_SLIDERS = [
  { key: 'pitch', label: 'pitch (semis ±)', min: -24, max: 24, step: 1, def: 0 },
  { key: 'detune', label: 'detune (cents ±)', min: -100, max: 100, step: 1, def: 0 },
  { key: 'decay', label: 'decay ×', min: 0.25, max: 4, step: 0.05, def: 1 },
  { key: 'bright', label: 'brightness ±', min: -1, max: 1, step: 0.01, def: 0 },
  { key: 'crush', label: 'crush +', min: 0, max: 1, step: 0.01, def: 0 },
  { key: 'gain', label: 'gain ×', min: 0, max: 1.5, step: 0.01, def: 1 },
];

const layers = [1, 2, 3].map((n) => {
  const rack = buildRack(ctx, decodeOrder(`l${n}-fx-`));
  rack.output.connect(master.input);
  const vals = {};
  for (const s of LAYER_SLIDERS) vals[s.key] = getNum(`l${n}-${s.key}`) ?? s.def;
  const en = getParam(`l${n}`);
  // Only an explicit 0 disables — a mangled value on layer 1 then fails
  // toward "sounds like before", not toward silence.
  return { n, rack, vals, enabled: en === null ? n === 1 : en !== '0' };
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));
function layerNote(s, vals) {
  return {
    ...s,
    freqHz: s.freqHz * Math.pow(2, vals.pitch / 12),
    detuneCents: s.detuneCents + vals.detune,
    tauS: s.tauS * vals.decay,
    brightness: clamp01(s.brightness + vals.bright),
    crush: clamp01(s.crush + vals.crush),
    gain: s.gain * vals.gain,
  };
}

let livePhrases = 0;

function ensureAudio() {
  if (ctx.state === 'suspended') ctx.resume();
}

function playPhrase(specs) {
  // Parity: attenuate new phrases by the count still sounding, keeping the
  // summed output out of hard clipping on fast codes. Counted per phrase,
  // not per layer — layers are one musical event.
  const atten = 1 / (1 + 0.3 * livePhrases);
  const scaled = specs.map((s) => ({ ...s, gain: s.gain * atten }));
  let sounding = 0;
  for (const L of layers) {
    if (!L.enabled) continue;
    const rendered = renderPhrase(
      scaled.map((s) => layerNote(s, L.vals)),
      ctx.sampleRate,
    );
    if (rendered.length === 0) continue;
    sounding++;
    playRendered(rendered, L.rack.input, () => {
      if (--sounding === 0) livePhrases--;
    });
  }
  if (sounding > 0) livePhrases++;
}

function playRendered(rendered, dest, onended) {
  const buf = ctx.createBuffer(1, rendered.length, ctx.sampleRate);
  buf.copyToChannel(rendered, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(dest);
  if (onended) src.onended = onended;
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
  // The 0.001 log grid is anchored at `min`, so the default may sit between
  // ticks; snap the nearest tick onto it or delete-at-default never fires.
  const fromSlider = (v) =>
    p.log ? (Math.abs(v - Math.log10(p.def)) <= 0.0005 ? p.def : Math.pow(10, v)) : v;
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

function devSpec() {
  return {
    onsetS: 0,
    freqHz: (ROOT_HZ / 2) * Math.pow(2, devVals.pitch / 12), // A2, the heldbreath register
    detuneCents: devVals.detune,
    tauS: devVals.decay / 7,
    brightness: devVals.bright,
    crush: devVals.crush,
    gain: devVals.gain,
  };
}

function devPluck() {
  ensureAudio();
  playPhrase([devSpec()]);
}

// Audition one layer in isolation, enabled or not — a slider on a disabled
// layer must still make a sound, or it's a silent knob while tuning.
function auditionLayer(L) {
  ensureAudio();
  const rendered = renderPhrase([layerNote(devSpec(), L.vals)], ctx.sampleRate);
  if (rendered.length > 0) playRendered(rendered, L.rack.input);
}

{
  wirePanel('dev-panel', 'dev');
  const root = document.getElementById('dev-controls');
  for (const s of DEV_SLIDERS) {
    devVals[s.key] = getNum('dev-' + s.key) ?? s.def;
    root.appendChild(
      sliderRow(s, devVals[s.key], (v) => {
        devVals[s.key] = v;
        setParam('dev-' + s.key, v === s.def ? null : v);
      }, devPluck),
    );
  }
  onActivate(document.getElementById('pluck'), devPluck);
}

// --- rack UI: one fieldset per stage, ▲▼ to reorder (audio graph + DOM +
// <prefix>order hash param move together) ---
function buildRackUI(rack, prefix, root) {
  const boxes = new Map(); // stage → its fieldset
  const arrows = new Map(); // stage → { up, down }
  const updateArrows = () => {
    rack.stages.forEach((st, i) => {
      arrows.get(st).up.disabled = i === 0;
      arrows.get(st).down.disabled = i === rack.stages.length - 1;
    });
  };
  const move = (st, delta) => {
    const i = rack.stages.indexOf(st);
    const j = i + delta;
    if (j < 0 || j >= rack.stages.length) return;
    [rack.stages[i], rack.stages[j]] = [rack.stages[j], rack.stages[i]];
    rack.rewire();
    // Move ONLY the pressed stage's box — re-appending every box would yank
    // the node under any in-flight slider drag elsewhere in the rack.
    const box = boxes.get(st);
    const other = boxes.get(rack.stages[i]); // the displaced neighbor, now at i
    const focused = document.activeElement;
    if (delta < 0) root.insertBefore(box, other);
    else root.insertBefore(other, box);
    updateArrows();
    // insertBefore is remove+reinsert, which drops focus to <body> — where
    // the next arrow key would play a note instead of moving again.
    if (focused instanceof HTMLElement && document.activeElement !== focused) {
      focused.focus();
      if (document.activeElement !== focused) {
        // The pressed arrow just got disabled at the rack's edge.
        const a = arrows.get(st);
        (focused === a.up ? a.down : a.up).focus();
      }
    }
    const order = rack.stages.map((s) => s.key).join(',');
    setParam(prefix + 'order', order === DEFAULT_ORDER.join(',') ? null : order);
  };
  for (const st of rack.stages) {
    const box = document.createElement('fieldset');
    box.className = 'fx-stage';
    box.dataset.key = st.key;
    const legend = document.createElement('legend');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = getParam(`${prefix}${st.key}`) === '1';
    toggle.setAttribute('aria-label', `${st.label} on`);
    st.setEnabled(toggle.checked);
    toggle.addEventListener('change', () => {
      st.setEnabled(toggle.checked);
      setParam(`${prefix}${st.key}`, toggle.checked ? '1' : null);
    });
    const name = document.createElement('span');
    name.textContent = st.label;
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'rk-move';
    up.textContent = '▲';
    up.setAttribute('aria-label', `move ${st.label} earlier in the chain`);
    onActivate(up, () => move(st, -1));
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'rk-move';
    down.textContent = '▼';
    down.setAttribute('aria-label', `move ${st.label} later in the chain`);
    onActivate(down, () => move(st, 1));
    arrows.set(st, { up, down });
    legend.append(toggle, name, up, down);
    box.appendChild(legend);
    // Values at their default are DELETED from the hash, not written — the
    // shared URL carries only what was actually changed (rl#410 decodes it).
    const wetP = { key: 'wet', label: 'wet', min: 0, max: 1, step: 0.01, def: st.wetAmt };
    const wet0 = getNum(`${prefix}${st.key}-wet`) ?? st.wetAmt;
    st.setWet(wet0);
    box.appendChild(
      sliderRow(wetP, wet0, (v) => {
        st.setWet(v);
        setParam(`${prefix}${st.key}-wet`, v === wetP.def ? null : v);
      }),
    );
    for (const p of st.params) {
      const k = `${prefix}${st.key}-${p.key}`;
      if (p.kind === 'select') {
        const v0 = p.options.includes(getParam(k)) ? getParam(k) : p.def;
        if (v0 !== p.def) p.set(v0);
        box.appendChild(selectRow(p, v0, (v) => {
          p.set(v);
          setParam(k, v === p.def ? null : v);
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
              setParam(k, v === p.def ? null : v);
            },
            p.lazy ? () => p.set(pending) : null,
          ),
        );
      }
    }
    boxes.set(st, box);
    root.appendChild(box);
  }
  updateArrows();
}

// --- master post-fx panel ---
{
  wirePanel('fx-panel', 'fx');
  buildRackUI(master, 'fx-', document.getElementById('fx-controls'));
}

// --- layer panels: enable toggle in the summary, param sliders, own rack ---
{
  const root = document.getElementById('layers');
  for (const L of layers) {
    const det = document.createElement('details');
    det.className = 'layer-panel';
    const sum = document.createElement('summary');
    const en = document.createElement('input');
    en.type = 'checkbox';
    en.checked = L.enabled;
    en.setAttribute('aria-label', `layer ${L.n} on`);
    // The checkbox lives in the summary; without this its click also
    // toggles the <details>.
    en.addEventListener('click', (e) => e.stopPropagation());
    en.addEventListener('change', () => {
      L.enabled = en.checked;
      setParam(`l${L.n}`, L.enabled === (L.n === 1) ? null : L.enabled ? '1' : '0');
    });
    sum.append(en, ` layer ${L.n}`);
    det.appendChild(sum);
    for (const s of LAYER_SLIDERS) {
      det.appendChild(
        sliderRow(s, L.vals[s.key], (v) => {
          L.vals[s.key] = v;
          setParam(`l${L.n}-${s.key}`, v === s.def ? null : v);
        }, () => auditionLayer(L)),
      );
    }
    const fxDet = document.createElement('details');
    const fxSum = document.createElement('summary');
    fxSum.textContent = `layer ${L.n} fx`;
    const fxRoot = document.createElement('div');
    fxDet.append(fxSum, fxRoot);
    buildRackUI(L.rack, `l${L.n}-fx-`, fxRoot);
    det.appendChild(fxDet);
    root.appendChild(det);
  }
}

// --- sidebar: collapsible, independently scrolling, hosts every panel.
// Absent `sb`, it opens when a panel gate (#dev=1 / #fx=1) is present, so an
// old shared URL still shows what it always showed. ---
{
  const btn = document.getElementById('sidebar-toggle');
  const aside = document.getElementById('sidebar');
  const setOpen = (open) => {
    document.body.classList.toggle('sb-open', open);
    // Closed = offscreen but still in the DOM; inert keeps Tab and screen
    // readers from wandering into ~90 invisible controls.
    aside.inert = !open;
    btn.textContent = open ? '✕' : '🎛';
    btn.setAttribute('aria-expanded', String(open));
  };
  const sb = getParam('sb');
  const open = sb === null ? getParam('dev') === '1' || getParam('fx') === '1' : sb !== '0';
  setOpen(open);
  // Pin the inferred state into the hash: without this, an old #fx=1 URL
  // whose fx panel is later closed (deleting `fx`) would reload with the
  // sidebar shut while it is open on screen.
  if (open && sb === null) setParam('sb', '1');
  onActivate(btn, () => {
    const on = !document.body.classList.contains('sb-open');
    setOpen(on);
    setParam('sb', on ? '1' : '0');
  });
}
