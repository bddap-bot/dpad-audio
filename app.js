import relative, { label as relativeLabel } from './schemes/relative.js';
import drift, { label as driftLabel } from './schemes/drift.js';
import fixed, { label as fixedLabel } from './schemes/fixed.js';
import heldbreath, { label as heldbreathLabel, resolve as heldbreathResolve } from './schemes/heldbreath.js';
import patchwalk, { label as patchwalkLabel } from './schemes/patchwalk.js';
import harmonicField, { label as harmonicFieldLabel } from './schemes/harmonic-field.js';
import { renderPhrase } from './synth.js';
import { buildRack, connectLimited, DEFAULT_ORDER } from './fx.js';
import { WAVE_NAMES } from './waves.js';
import { MOD_SOURCES, MIDI_FIELDS, MOD_DEFAULT, MOD_PROPS, mapValue, lfoLevel, adsrLevel } from './mod.js';

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

const LAYER_SLIDERS = [
  { key: 'pitch', label: 'pitch (semis ±)', min: -24, max: 24, step: 1, def: 0 },
  { key: 'detune', label: 'detune (cents ±)', min: -100, max: 100, step: 1, def: 0 },
  { key: 'vibRate', label: 'vibrato rate (Hz)', min: 0, max: 12, step: 0.1, def: 0 },
  { key: 'vibDepth', label: 'vibrato depth (¢)', min: 0, max: 100, step: 1, def: 0 },
  { key: 'decay', label: 'decay ×', min: 0.25, max: 4, step: 0.05, def: 1 },
  { key: 'bright', label: 'brightness ±', min: -1, max: 1, step: 0.01, def: 0 },
  { key: 'crush', label: 'crush +', min: 0, max: 1, step: 0.01, def: 0 },
  { key: 'gain', label: 'gain ×', min: 0, max: 1.5, step: 0.01, def: 1 },
];

const DEV_SLIDERS = [
  { key: 'pitch', label: 'pitch (semis / A2)', min: 0, max: 36, step: 1, def: 12 },
  { key: 'detune', label: 'detune (cents)', min: 0, max: 100, step: 1, def: 0 },
  { key: 'decay', label: 'decay (s)', min: 0.1, max: 3, step: 0.05, def: 1.1 },
  { key: 'bright', label: 'brightness', min: 0, max: 1, step: 0.01, def: 0.55 },
  { key: 'crush', label: 'crush', min: 0, max: 1, step: 0.01, def: 0 },
  { key: 'gain', label: 'gain', min: 0, max: 1, step: 0.01, def: 0.8 },
];

// --- audio: notes render to buffers via the parity synth, then run through
// the post-fx racks. Created suspended; first tap resumes (mobile unlock). ---
// No webkitAudioContext fallback: browsers that need the prefix predate the
// ES modules and AudioWorklet this app requires anyway.
const ctx = new AudioContext();

// Racks are built in default order (reordered below once the config is
// known); each layer rack feeds the master: source → layer rack → master →
// limiter.
const master = buildRack(ctx);
connectLimited(ctx, master.output);
const layerRacks = [1, 2, 3].map(() => {
  const rack = buildRack(ctx);
  rack.output.connect(master.input);
  return rack;
});

// --- config: ONE JSON object is the whole page state (the rl#410
// interface — schema in the README). The hash carries it URL-encoded;
// import/export moves the same object as text; values equal to their default
// are omitted, so a URL/export holds only what changed. ---
const fromSliders = (defs) => Object.fromEntries(defs.map((s) => [s.key, s.def]));
function rackDefaults(rack) {
  const stages = {};
  for (const st of rack.stages) {
    stages[st.key] = { on: false, wet: st.defWet, ...Object.fromEntries(st.params.map((p) => [p.key, p.def])) };
  }
  return { order: [...DEFAULT_ORDER], stages };
}
// Every mappable param, enumerated up front so DEFAULTS.mods can carry one
// default mapping per path — a typo'd path in an import is then an unknown
// key like any other. Paths: dev.<key>, l<n>.<key>, master.<stage>.<wet|key>,
// l<n>.fx.<stage>.<wet|key>. Select params aren't sliders, so no mapping.
const MOD_PARAMS = new Map(); // path -> slider def (min/max/step/log)
for (const s of DEV_SLIDERS) MOD_PARAMS.set(`dev.${s.key}`, s);
for (const n of [1, 2, 3]) for (const s of LAYER_SLIDERS) MOD_PARAMS.set(`l${n}.${s.key}`, s);
function registerRackMods(prefix, rack) {
  for (const st of rack.stages) {
    MOD_PARAMS.set(`${prefix}.${st.key}.wet`, { min: 0, max: 1, step: 0.01, def: st.defWet });
    for (const p of st.params) if (p.kind !== 'select') MOD_PARAMS.set(`${prefix}.${st.key}.${p.key}`, p);
  }
}
registerRackMods('master', master);
layerRacks.forEach((r, i) => registerRackMods(`l${i + 1}.fx`, r));

const DEFAULTS = {
  scheme: 'heldbreath',
  scale: 'hirajoshi',
  sidebar: false,
  devOpen: false,
  fxOpen: false,
  slOpen: false,
  dev: fromSliders(DEV_SLIDERS),
  // Four fixed custom-slider slots (0..1, namable) — fixed shape keeps the
  // config machinery's exact unknown-key refusal.
  sliders: [1, 2, 3, 4].map(() => ({ name: '', value: 0 })),
  mods: Object.fromEntries([...MOD_PARAMS.keys()].map((k) => [k, { ...MOD_DEFAULT }])),
  master: rackDefaults(master),
  layers: [1, 2, 3].map((n) => ({
    // Layer 1 defaults to the identity transform, enabled; 2 and 3 start
    // off, so a bare URL sounds like the plain instrument.
    on: n === 1,
    wave: 'sine',
    ...fromSliders(LAYER_SLIDERS),
    fx: rackDefaults(layerRacks[n - 1]),
  })),
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Merge an untrusted partial config over the defaults: unknown keys drop,
// type mismatches keep the default (a mangled value self-corrects instead of
// poisoning the page), object-arrays (layers) merge per element.
function merged(def, over) {
  if (isObj(def)) {
    const out = {};
    for (const k of Object.keys(def)) out[k] = merged(def[k], isObj(over) ? over[k] : undefined);
    return out;
  }
  if (Array.isArray(def)) {
    if (def.length && isObj(def[0])) return def.map((d, i) => merged(d, Array.isArray(over) ? over[i] : undefined));
    return Array.isArray(over) ? over : [...def];
  }
  return typeof over === typeof def ? over : def;
}

// The inverse: strip everything equal to its default. Returns undefined when
// nothing differs.
function pruned(def, val) {
  if (isObj(def)) {
    const out = {};
    for (const k of Object.keys(def)) {
      const p = pruned(def[k], val[k]);
      if (p !== undefined) out[k] = p;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (Array.isArray(def)) {
    if (def.length && isObj(def[0])) {
      const arr = def.map((d, i) => pruned(d, val[i]) ?? {});
      return arr.some((o) => Object.keys(o).length) ? arr : undefined;
    }
    return def.join() === val.join() ? undefined : val;
  }
  return def === val ? undefined : val;
}

function parseConfig(text) {
  try {
    const v = JSON.parse(text);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

const pick = (table, k, def) => (Object.hasOwn(table, k ?? '') ? k : def);
const clampNum = (v, p) => (Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.def);

// Rack order sanitizer: unknown keys drop and missing ones append, so a
// config from an older or future stage-set still decodes to something sane.
function sanitizeOrder(order) {
  const seen = (Array.isArray(order) ? order : []).filter((k) => DEFAULT_ORDER.includes(k));
  return [...new Set([...seen, ...DEFAULT_ORDER.filter((k) => !seen.includes(k))])];
}

const rawHash = location.hash.slice(1);
let over = null;
try {
  over = parseConfig(decodeURIComponent(rawHash));
} catch {} // a stray % in a hand-edited hash — fall through to defaults
if (!over && rawHash) {
  // Hand-typed gate shorthand — the ONE non-JSON hash form: #dev=1 / #fx=1
  // (/ #sb=1) opens the panels, nothing else decodes here. The open-panel⇒
  // open-sidebar inference lives HERE only: in the JSON path it would break
  // round-trip identity (sidebar:false prunes away, then un-infers to open).
  const p = new URLSearchParams(rawHash);
  over = { devOpen: p.get('dev') === '1', fxOpen: p.get('fx') === '1' };
  over.sidebar = p.has('sb') ? p.get('sb') !== '0' : over.devOpen || over.fxOpen;
}
const cfg = merged(DEFAULTS, over ?? {});
cfg.scheme = pick(SCHEMES, cfg.scheme, DEFAULTS.scheme);
cfg.scale = pick(SCALES, cfg.scale, DEFAULTS.scale);
for (const s of DEV_SLIDERS) cfg.dev[s.key] = clampNum(cfg.dev[s.key], s);
for (const L of cfg.layers) {
  if (!WAVE_NAMES.includes(L.wave)) L.wave = 'sine';
  for (const s of LAYER_SLIDERS) L[s.key] = clampNum(L[s.key], s);
}
for (const sl of cfg.sliders) sl.value = clampNum(sl.value, { min: 0, max: 1, def: 0 });
for (const m of Object.values(cfg.mods)) {
  if (!MOD_SOURCES.includes(m.src)) m.src = MOD_DEFAULT.src;
  if (!WAVE_NAMES.includes(m.wave)) m.wave = MOD_DEFAULT.wave;
  if (!MIDI_FIELDS.includes(m.field)) m.field = MOD_DEFAULT.field;
  m.slot = Math.round(clampNum(m.slot, { min: 0, max: cfg.sliders.length - 1, def: 0 }));
  for (const [k, p] of Object.entries(MOD_PROPS)) m[k] = clampNum(m[k], { ...p, def: MOD_DEFAULT[k] });
}

// The URL write is debounced: Safari throws once history.replaceState
// exceeds ~100 calls/30 s, which one slider drag would blow through.
let hashTimer = null;
function save() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const p = pruned(DEFAULTS, cfg);
    history.replaceState(null, '', location.pathname + (p ? '#' + encodeURIComponent(JSON.stringify(p)) : ''));
  }, 250);
}

// Apply a config's rack order to the live rack (stages were built in
// default order).
function applyOrder(rack, rcfg) {
  rcfg.order = sanitizeOrder(rcfg.order);
  rack.stages.sort((a, b) => rcfg.order.indexOf(a.key) - rcfg.order.indexOf(b.key));
  rack.rewire();
}
applyOrder(master, cfg.master);
cfg.layers.forEach((L, i) => applyOrder(layerRacks[i], L.fx));

const layers = cfg.layers.map((vals, i) => ({ n: i + 1, rack: layerRacks[i], vals }));

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// --- mod mappings: sources + the applied-value lookup. The formula itself
// (mod.js mapValue) works in the param's normalized 0..1 space; log params
// normalize in log-space, matching their slider position. ---
const tSlider = (p, v) => (p.log ? Math.log10(v) : v);
const normP = (p, v) => (tSlider(p, v) - tSlider(p, p.min)) / (tSlider(p, p.max) - tSlider(p, p.min));
const denormP = (p, n) => {
  const v = tSlider(p, p.min) + n * (tSlider(p, p.max) - tSlider(p, p.min));
  return p.log ? Math.pow(10, v) : v;
};

// Per-note fields the synth tracks, published as 0..1 for the midi source.
const MIDI = { progress: 0, pitch: 0, gate: 0, gain: 0, brightness: 0, crush: 0 };
let gateOnS = null; // adsr gate: press opens (retrigger), clear/cadence closes
let gateOffS = null;
const nowS = () => performance.now() / 1000;

function srcValue(m) {
  if (m.src === 'adsr') return adsrLevel(m, nowS(), gateOnS, gateOffS);
  if (m.src === 'lfo') return lfoLevel(m, nowS());
  if (m.src === 'midi') return MIDI[m.field];
  if (m.src === 'slider') return cfg.sliders[m.slot].value;
  return 0;
}

// Applied value for a mappable param: base when unmapped, so unmapped params
// keep their exact per-note transform semantics.
function mval(path, base) {
  const m = cfg.mods[path];
  if (m.src === 'none') return base;
  return denormP(MOD_PARAMS.get(path), mapValue(m, normP(MOD_PARAMS.get(path), base), srcValue(m)));
}

// Live FX params re-evaluate on a tick (note-time params sample in
// layerNote/devSpec instead). Lazy params (reverb IR rebuild) throttle.
const FX_BIND = new Map(); // path -> { set, base, lazy }
function bindRackMods(prefix, rack, rcfg) {
  for (const st of rack.stages) {
    const sc = rcfg.stages[st.key];
    FX_BIND.set(`${prefix}.${st.key}.wet`, { set: (v) => st.setWet(v), base: () => sc.wet });
    for (const p of st.params) {
      if (p.kind === 'select') continue;
      FX_BIND.set(`${prefix}.${st.key}.${p.key}`, { set: p.set, base: () => sc[p.key], lazy: p.lazy });
    }
  }
}
bindRackMods('master', master, cfg.master);
cfg.layers.forEach((L, i) => bindRackMods(`l${i + 1}.fx`, layerRacks[i], L.fx));

// No-change sets are skipped: expensive setters (reverb's IR rebuild is a
// fresh RANDOM impulse per call, distortion's curve is 1024 points) must not
// churn while a mapped source sits still. Lazy params additionally throttle,
// bounding IR-rebuild clicks while a source IS moving.
const lastSet = new Map();
const lazyLast = new Map();
setInterval(() => {
  for (const [path, b] of FX_BIND) {
    if (cfg.mods[path].src === 'none') continue;
    const v = mval(path, b.base());
    if (lastSet.get(path) === v) continue;
    if (b.lazy) {
      const t = nowS();
      if (t - (lazyLast.get(path) ?? -Infinity) < 0.3) continue;
      lazyLast.set(path, t);
    }
    lastSet.set(path, v);
    b.set(v);
  }
}, 33);

function layerNote(s, L) {
  const lv = (k) => mval(`l${L.n}.${k}`, L.vals[k]);
  return {
    ...s,
    freqHz: s.freqHz * Math.pow(2, lv('pitch') / 12),
    detuneCents: s.detuneCents + lv('detune'),
    tauS: s.tauS * lv('decay'),
    brightness: clamp01(s.brightness + lv('bright')),
    crush: clamp01(s.crush + lv('crush')),
    gain: s.gain * lv('gain'),
    wave: s.wave ?? L.vals.wave,
    vibRateHz: (s.vibRateHz ?? 0) + lv('vibRate'),
    vibDepthCents: (s.vibDepthCents ?? 0) + lv('vibDepth'),
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
    if (!L.vals.on) continue;
    const rendered = renderPhrase(
      scaled.map((s) => layerNote(s, L)),
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
    scale: SCALES[cfg.scale].semis,
    rootHz: ROOT_HZ,
  };
}

let path = [];
let idleTimer = null;

function press(dir) {
  ensureAudio();
  // The adsr gate opens at a code's FIRST press and holds until the path
  // clears — successive notes then walk the envelope (a per-press retrigger
  // would sample t≈0 every note, making a/d/s/r inaudible on note-time params).
  if (path.length === 0) {
    gateOnS = nowS();
    gateOffS = null;
  }
  const spec = SCHEMES[cfg.scheme].fn(comboState(), dir);
  // Publish the midi fields BEFORE rendering, so a midi-mapped param hears
  // the note that triggered it, not the previous one.
  MIDI.gate = 1;
  MIDI.progress = clamp01((path.length + 1) / 8);
  MIDI.pitch = clamp01(Math.log2(spec.freqHz / 110) / 3); // 110..880 Hz → 0..1
  MIDI.gain = clamp01(spec.gain);
  MIDI.brightness = clamp01(spec.brightness);
  MIDI.crush = clamp01(spec.crush);
  playPhrase([spec]);
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
  const resolve = SCHEMES[cfg.scheme].resolve;
  if (!resolve || path.length === 0) return;
  ensureAudio();
  playPhrase(resolve(comboState(), accepted));
  clearPath();
}

function clearPath() {
  path = [];
  clearTimeout(idleTimer);
  if (gateOffS == null) gateOffS = nowS();
  MIDI.gate = 0;
  MIDI.progress = 0;
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
  document.getElementById('cadence').hidden = !SCHEMES[cfg.scheme].resolve;
}

fillPicker('scheme-picker', SCHEMES, cfg.scheme, (v) => {
  cfg.scheme = v;
  clearPath();
  save();
  updateCadenceButtons();
});
fillPicker('scale-picker', SCALES, cfg.scale, (v) => {
  cfg.scale = v;
  clearPath();
  save();
});
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

// WASD aliases the arrows; c/x alias ✓/✗ (dpad-audio#4) — letters dodge the
// browser's own arrow/enter/backspace navigation.
const KEYMAP = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R' };
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // A focused slider/select/textarea/summary owns its keys.
  if (e.target.closest?.('input, select, textarea, button, summary')) return;
  // Modifier chords (ctrl+c copy, cmd+a select-all…) belong to the browser.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (KEYMAP[k]) {
    e.preventDefault();
    press(KEYMAP[k]);
  } else if (k === 'Enter' || k === 'c') {
    cadence(true);
  } else if (k === 'Backspace' || k === 'x') {
    cadence(false);
  } else if (k === 'Escape') {
    clearPath();
  }
});

// --- generic control rows (shared by the dev + fx panels) ---
// Log-scaled sliders (filter cutoff) move in log-space; display stays real.
function sliderRow(p, value, onInput, onChange, modPath) {
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
  if (modPath) row.appendChild(modButton(modPath));
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

// --- mod mapping UI: a ◇ button on every mappable slider row opens the ONE
// shared popup (rebuilt per open, emptied on close, so the DOM stays small
// and the round-trip test's control census stays stable). ---
const modBtnUpd = new Map(); // path -> icon refresh
function modButton(path) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mod-btn';
  b.setAttribute('aria-label', `mod mapping: ${path}`);
  const upd = () => {
    const on = cfg.mods[path].src !== 'none';
    b.textContent = on ? '◆' : '◇';
    b.classList.toggle('mapped', on);
  };
  upd();
  modBtnUpd.set(path, upd);
  onActivate(b, () => openModMenu(path, b));
  return b;
}

const modMenu = document.getElementById('mod-menu');
let modMenuPath = null;
function closeModMenu() {
  modMenu.hidden = true;
  modMenu.innerHTML = '';
  modMenuPath = null;
}
document.addEventListener('pointerdown', (e) => {
  if (!modMenu.hidden && !modMenu.contains(e.target) && !e.target.closest?.('.mod-btn')) closeModMenu();
});

function openModMenu(path, anchor) {
  const toggleOff = modMenuPath === path;
  closeModMenu();
  if (toggleOff) return;
  modMenuPath = path;
  const m = cfg.mods[path];
  const set = (k) => (v) => {
    m[k] = v;
    save();
  };
  const head = document.createElement('div');
  head.className = 'mod-head';
  head.textContent = path;
  const body = document.createElement('div');
  const propRow = (k) => sliderRow({ ...MOD_PROPS[k], def: MOD_DEFAULT[k] }, m[k], set(k));
  const rebuild = () => {
    body.innerHTML = '';
    if (m.src === 'lfo') {
      body.appendChild(selectRow({ label: 'wave', options: WAVE_NAMES }, m.wave, set('wave')));
      body.appendChild(propRow('rate'));
    } else if (m.src === 'adsr') {
      for (const k of ['a', 'd', 's', 'r']) body.appendChild(propRow(k));
    } else if (m.src === 'midi') {
      body.appendChild(selectRow({ label: 'field', options: MIDI_FIELDS }, m.field, set('field')));
    } else if (m.src === 'slider') {
      // Index-prefixed labels so duplicate names still address distinct slots.
      const names = cfg.sliders.map((s, i) => `${i + 1} · ${s.name || `custom ${i + 1}`}`);
      body.appendChild(selectRow({ label: 'slider', options: names }, names[m.slot], (v) => {
        m.slot = names.indexOf(v);
        save();
      }));
    }
    if (m.src !== 'none') for (const k of ['offset', 'amount', 'min', 'max']) body.appendChild(propRow(k));
  };
  const srcSel = selectRow({ label: 'source', options: MOD_SOURCES }, m.src, (v) => {
    m.src = v;
    save();
    modBtnUpd.get(path)();
    // A live FX param falls back to its base the moment its mapping stops —
    // and the tick's no-change cache forgets it, so a later remap can't be
    // skipped as "already at that value".
    const b = FX_BIND.get(path);
    if (v === 'none' && b) {
      b.set(b.base());
      lastSet.delete(path);
      lazyLast.delete(path);
    }
    rebuild();
  });
  rebuild();
  modMenu.append(head, srcSel, body);
  modMenu.hidden = false;
  // Position under the button, clamped on-viewport (needs layout first).
  const r = anchor.getBoundingClientRect();
  modMenu.style.left = Math.max(8, Math.min(window.innerWidth - modMenu.offsetWidth - 8, r.right - modMenu.offsetWidth)) + 'px';
  modMenu.style.top = Math.max(8, Math.min(window.innerHeight - modMenu.offsetHeight - 8, r.bottom + 6)) + 'px';
}

function wirePanel(id, key) {
  const el = document.getElementById(id);
  el.open = cfg[key];
  el.addEventListener('toggle', () => {
    cfg[key] = el.open;
    save();
  });
}

// --- custom sliders: four namable 0..1 mod sources, at the top of the
// sidebar ---
{
  wirePanel('sliders-panel', 'slOpen');
  const root = document.getElementById('sliders-controls');
  cfg.sliders.forEach((sl, i) => {
    const row = sliderRow({ label: '', min: 0, max: 1, step: 0.01, def: 0 }, sl.value, (v) => {
      sl.value = v;
      save();
    });
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'sl-name';
    name.placeholder = `custom ${i + 1}`;
    name.value = sl.name;
    name.setAttribute('aria-label', `custom slider ${i + 1} name`);
    name.addEventListener('input', () => {
      sl.name = name.value;
      save();
    });
    row.replaceChild(name, row.firstChild); // the label span → the name box
    root.appendChild(row);
  });
}

// --- dev mode: the full synth surface on sliders, no code entry needed ---
const devVals = cfg.dev;

function devSpec() {
  const dv = (k) => mval(`dev.${k}`, devVals[k]);
  return {
    onsetS: 0,
    freqHz: (ROOT_HZ / 2) * Math.pow(2, dv('pitch') / 12), // A2, the heldbreath register
    detuneCents: dv('detune'),
    tauS: dv('decay') / 7,
    brightness: dv('bright'),
    crush: dv('crush'),
    gain: dv('gain'),
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
  const rendered = renderPhrase([layerNote(devSpec(), L)], ctx.sampleRate);
  if (rendered.length > 0) playRendered(rendered, L.rack.input);
}

{
  wirePanel('dev-panel', 'devOpen');
  const root = document.getElementById('dev-controls');
  for (const s of DEV_SLIDERS) {
    root.appendChild(
      sliderRow(s, devVals[s.key], (v) => {
        devVals[s.key] = v;
        save();
      }, devPluck, `dev.${s.key}`),
    );
  }
  onActivate(document.getElementById('pluck'), devPluck);
}

// --- rack UI: one fieldset per stage, ▲▼ to reorder (audio graph + DOM +
// the config's order list move together) ---
function buildRackUI(rack, rcfg, root, prefix) {
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
    rcfg.order = rack.stages.map((s) => s.key);
    save();
  };
  for (const st of rack.stages) {
    const sc = rcfg.stages[st.key];
    const box = document.createElement('fieldset');
    box.className = 'fx-stage';
    box.dataset.key = st.key;
    const legend = document.createElement('legend');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = sc.on === true;
    sc.on = toggle.checked;
    toggle.setAttribute('aria-label', `${st.label} on`);
    st.setEnabled(toggle.checked);
    toggle.addEventListener('change', () => {
      st.setEnabled(toggle.checked);
      sc.on = toggle.checked;
      save();
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
    const wetP = { key: 'wet', label: 'wet', min: 0, max: 1, step: 0.01, def: st.defWet };
    sc.wet = clampNum(sc.wet, wetP);
    st.setWet(sc.wet);
    box.appendChild(
      sliderRow(wetP, sc.wet, (v) => {
        st.setWet(v);
        sc.wet = v;
        save();
      }, null, `${prefix}.${st.key}.wet`),
    );
    for (const p of st.params) {
      if (p.kind === 'select') {
        if (!p.options.includes(sc[p.key])) sc[p.key] = p.def;
        if (sc[p.key] !== p.def) p.set(sc[p.key]);
        box.appendChild(selectRow(p, sc[p.key], (v) => {
          p.set(v);
          sc[p.key] = v;
          save();
        }));
      } else {
        sc[p.key] = clampNum(sc[p.key], p);
        if (sc[p.key] !== p.def) p.set(sc[p.key]);
        // Lazy params (expensive sets, e.g. reverb IR rebuild) apply on
        // release; everything else tracks the drag.
        let pending = sc[p.key];
        box.appendChild(
          sliderRow(
            p,
            sc[p.key],
            (v) => {
              pending = v;
              if (!p.lazy) p.set(v);
              sc[p.key] = v;
              save();
            },
            p.lazy ? () => p.set(pending) : null,
            `${prefix}.${st.key}.${p.key}`,
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
  wirePanel('fx-panel', 'fxOpen');
  buildRackUI(master, cfg.master, document.getElementById('fx-controls'), 'master');
}

// --- layer panels: enable toggle in the summary, wave picker, param
// sliders, own rack ---
{
  const root = document.getElementById('layers');
  for (const L of layers) {
    const det = document.createElement('details');
    det.className = 'layer-panel';
    const sum = document.createElement('summary');
    const en = document.createElement('input');
    en.type = 'checkbox';
    en.checked = L.vals.on;
    en.setAttribute('aria-label', `layer ${L.n} on`);
    // The checkbox lives in the summary; without this its click also
    // toggles the <details>.
    en.addEventListener('click', (e) => e.stopPropagation());
    en.addEventListener('change', () => {
      L.vals.on = en.checked;
      save();
    });
    sum.append(en, ` layer ${L.n}`);
    det.appendChild(sum);
    det.appendChild(
      selectRow({ label: 'wave', options: WAVE_NAMES }, L.vals.wave, (v) => {
        L.vals.wave = v;
        save();
        auditionLayer(L);
      }),
    );
    for (const s of LAYER_SLIDERS) {
      det.appendChild(
        sliderRow(s, L.vals[s.key], (v) => {
          L.vals[s.key] = v;
          save();
        }, () => auditionLayer(L), `l${L.n}.${s.key}`),
      );
    }
    const fxDet = document.createElement('details');
    const fxSum = document.createElement('summary');
    fxSum.textContent = `layer ${L.n} fx`;
    const fxRoot = document.createElement('div');
    fxDet.append(fxSum, fxRoot);
    buildRackUI(L.rack, L.vals.fx, fxRoot, `l${L.n}.fx`);
    det.appendChild(fxDet);
    root.appendChild(det);
  }
}

// --- config panel: import/export of the SAME object the hash carries ---
{
  const text = document.getElementById('cfg-text');
  const msg = document.getElementById('cfg-msg');
  onActivate(document.getElementById('cfg-export'), () => {
    text.value = JSON.stringify(pruned(DEFAULTS, cfg) ?? {}, null, 2);
    msg.textContent = 'exported (defaults omitted)';
    navigator.clipboard?.writeText(text.value).then(
      () => (msg.textContent = 'exported + copied'),
      () => {},
    );
  });
  // Hash decode is lenient (an unknown key in a URL self-corrects to the
  // default), but import is a hand-edited interface: a typo'd key silently
  // ignored would read as "no audible change, no explanation" — refuse it.
  function unknownKeys(def, over, path) {
    if (isObj(def) && isObj(over)) {
      return Object.keys(over).flatMap((k) =>
        Object.hasOwn(def, k) ? unknownKeys(def[k], over[k], path + k + '.') : [path + k],
      );
    }
    if (Array.isArray(def) && Array.isArray(over) && def.length && isObj(def[0])) {
      return over.flatMap((o, i) => (i < def.length ? unknownKeys(def[i], o, path + i + '.') : [path + i]));
    }
    return [];
  }
  onActivate(document.getElementById('cfg-import'), () => {
    const v = parseConfig(text.value);
    if (!v) {
      msg.textContent = 'not a JSON object';
      return;
    }
    const unknown = unknownKeys(DEFAULTS, v, '');
    if (unknown.length) {
      msg.textContent = 'unknown keys: ' + unknown.join(', ');
      return;
    }
    // Import REPLACES the whole config (missing fields = defaults). The
    // hash is the one decode path, so apply by writing it and reloading —
    // after killing any pending debounced save, which would otherwise fire
    // during navigation and clobber the imported hash with the old state.
    clearTimeout(hashTimer);
    const p = pruned(DEFAULTS, merged(DEFAULTS, v));
    location.hash = p ? encodeURIComponent(JSON.stringify(p)) : '';
    location.reload();
  });
}

// --- sidebar: collapsible, independently scrolling, hosts every panel ---
{
  const btn = document.getElementById('sidebar-toggle');
  const aside = document.getElementById('sidebar');
  const setOpen = (open) => {
    document.body.classList.toggle('sb-open', open);
    // Closed = offscreen but still in the DOM; inert keeps Tab and screen
    // readers from wandering into ~100 invisible controls.
    aside.inert = !open;
    btn.textContent = open ? '✕' : '🎛';
    btn.setAttribute('aria-expanded', String(open));
  };
  setOpen(cfg.sidebar);
  onActivate(btn, () => {
    cfg.sidebar = !document.body.classList.contains('sb-open');
    setOpen(cfg.sidebar);
    save();
  });
}
