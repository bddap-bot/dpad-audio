// Post-fx exploration chain (dpad-audio#1). No post-processing exists in-game:
// this panel is where effects get PICKED by ear before anything ships. Every
// stage is a dry/wet crossfade, wet-muted until enabled (nodes keep running —
// simplicity over idle-DSP thrift); enabling lands on a musical default, not
// a neutral one. A limiter sits before the destination so no combination of
// maxed settings (delay feedback + big reverb + crush) can get painful.
//
// Default chain order: crush → filter → chorus → phaser → ringmod → distort
// → delay → reverb → comp — reorderable per rack (dpad-audio#2); the order
// serializes in the rack's `order` list.

import { WAVE_NAMES, makePeriodicWave } from './waves.js';

// `lazy: true` = apply on slider release, not per-pixel (for expensive sets).
// Param key 'wet' is reserved (the wet slider claims it in each stage's
// config object) and so is `order` at the rack level (the chain order list).
function param(key, label, min, max, step, def, set, opts = {}) {
  return { key, label, min, max, step, def, set, ...opts };
}

function selectParam(key, label, options, def, set) {
  return { key, label, kind: 'select', options, def, set };
}

function makeStage(ctx, key, label, defWet) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);
  wet.connect(output);
  wet.gain.value = 0;
  return {
    key,
    label,
    input,
    output,
    wet,
    dry,
    params: [],
    enabled: false,
    defWet, // immutable default; wetAmt below is the live value
    wetAmt: defWet,
    setEnabled(on) {
      this.enabled = on;
      this.apply();
    },
    setWet(a) {
      this.wetAmt = a;
      this.apply();
    },
    apply() {
      const w = this.enabled ? this.wetAmt : 0;
      const t = ctx.currentTime;
      this.wet.gain.setTargetAtTime(w, t, 0.02);
      this.dry.gain.setTargetAtTime(1 - w, t, 0.02);
    },
  };
}

function crushStage(ctx) {
  const st = makeStage(ctx, 'crush', 'bitcrush', 1);
  let pending = 0.25;
  // The worklet loads async; until it lands the wet path is silent, which the
  // bypass (wet 0) already is — no fallback path to drift.
  ctx.audioWorklet
    .addModule(new URL('./crush-worklet.js', import.meta.url))
    .then(() => {
      const node = new AudioWorkletNode(ctx, 'crush');
      node.parameters.get('amount').value = pending;
      st.input.connect(node).connect(st.wet);
      st.node = node;
    })
    .catch((e) => console.error('crush worklet failed to load', e));
  st.params = [
    param('amt', 'amount', 0, 1, 0.01, 0.25, (v) => {
      pending = v;
      if (st.node) st.node.parameters.get('amount').value = v;
    }),
  ];
  return st;
}

function filterStage(ctx) {
  const st = makeStage(ctx, 'filter', 'resonant filter', 1);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 1200;
  f.Q.value = 6;
  st.input.connect(f).connect(st.wet);
  st.params = [
    selectParam('type', 'type', ['lowpass', 'highpass'], 'lowpass', (v) => (f.type = v)),
    param('cut', 'cutoff (Hz)', 80, 10000, 1, 1200, (v) => f.frequency.setTargetAtTime(v, ctx.currentTime, 0.02), { log: true }),
    param('q', 'resonance', 0.5, 20, 0.1, 6, (v) => (f.Q.value = v)),
  ];
  return st;
}

function chorusStage(ctx) {
  const st = makeStage(ctx, 'chorus', 'chorus/flanger', 0.5);
  const d = ctx.createDelay(0.05);
  d.delayTime.value = 0.016;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.7;
  const depth = ctx.createGain();
  depth.gain.value = 0.004;
  lfo.connect(depth).connect(d.delayTime);
  lfo.start();
  st.input.connect(d).connect(st.wet);
  st.params = [
    // Slow+wide = chorus; fast+shallow around a short base = flanger territory.
    param('rate', 'rate (Hz)', 0.05, 8, 0.05, 0.7, (v) => (lfo.frequency.value = v)),
    param('depth', 'depth (s)', 0, 0.012, 0.0005, 0.004, (v) => (depth.gain.value = v)),
    param('base', 'base delay (s)', 0.001, 0.03, 0.001, 0.016, (v) => d.delayTime.setTargetAtTime(v, ctx.currentTime, 0.02)),
  ];
  return st;
}

function phaserStage(ctx) {
  const st = makeStage(ctx, 'phaser', 'phaser', 0.5);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.4;
  const depth = ctx.createGain();
  depth.gain.value = 600;
  lfo.connect(depth);
  let node = st.input;
  for (const hz of [400, 800, 1600, 3200]) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.value = hz;
    ap.Q.value = 0.6;
    depth.connect(ap.frequency);
    node.connect(ap);
    node = ap;
  }
  node.connect(st.wet);
  lfo.start();
  st.params = [
    param('rate', 'rate (Hz)', 0.05, 4, 0.05, 0.4, (v) => (lfo.frequency.value = v)),
    param('depth', 'depth (Hz)', 0, 1500, 10, 600, (v) => (depth.gain.value = v)),
  ];
  return st;
}

function delayStage(ctx) {
  const st = makeStage(ctx, 'delay', 'delay', 0.3);
  const d = ctx.createDelay(2);
  d.delayTime.value = 0.31;
  const fb = ctx.createGain();
  fb.gain.value = 0.4;
  // Darkening lowpass in the loop so repeats recede instead of piling up.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2500;
  st.input.connect(d);
  d.connect(tone).connect(fb).connect(d);
  d.connect(st.wet);
  st.params = [
    param('time', 'time (s)', 0.05, 1.5, 0.01, 0.31, (v) => d.delayTime.setTargetAtTime(v, ctx.currentTime, 0.02)),
    param('fb', 'feedback', 0, 0.9, 0.01, 0.4, (v) => (fb.gain.value = v)),
  ];
  return st;
}

function impulse(ctx, seconds) {
  const len = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let energy = 0;
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      energy += data[i] * data[i];
    }
    // Unit energy, so the size slider changes the room, not the volume.
    const scale = 1 / Math.sqrt(energy);
    for (let i = 0; i < len; i++) data[i] *= scale;
  }
  return buf;
}

function reverbStage(ctx) {
  const st = makeStage(ctx, 'reverb', 'reverb', 0.35);
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, 1.8);
  st.input.connect(conv).connect(st.wet);
  st.params = [
    param('size', 'size (s)', 0.2, 6, 0.1, 1.8, (v) => (conv.buffer = impulse(ctx, v)), {
      lazy: true, // a fresh multi-second IR per pixel of drag would click and churn
    }),
  ];
  return st;
}

// Ring modulation: the input times an oscillator running the SAME wave set
// the layers select from (dpad-audio#3) — one wave implementation, two
// projections (waves.js tables → sampler for the synth, PeriodicWave here).
function ringmodStage(ctx) {
  const st = makeStage(ctx, 'ringmod', 'ring mod', 0.7);
  const mod = ctx.createGain();
  mod.gain.value = 0; // the oscillator IS the gain: out = in × osc
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(makePeriodicWave(ctx, 'sine'));
  osc.frequency.value = 220;
  osc.start();
  osc.connect(mod.gain);
  st.input.connect(mod).connect(st.wet);
  st.params = [
    selectParam('wave', 'wave', WAVE_NAMES, 'sine', (v) => osc.setPeriodicWave(makePeriodicWave(ctx, v))),
    param('freq', 'freq (Hz)', 1, 2000, 1, 220, (v) => osc.frequency.setTargetAtTime(v, ctx.currentTime, 0.02), { log: true }),
  ];
  return st;
}

function distortStage(ctx) {
  const st = makeStage(ctx, 'distort', 'distortion', 0.6);
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '4x';
  const post = ctx.createGain();
  const apply = (drive) => {
    const n = 1024;
    const c = new Float32Array(n);
    const k = 1 + drive * 60;
    // tanh(kx)/tanh(k): unity endpoints at any drive, so the slider moves
    // saturation, not level; post trim offsets the loudness the curve adds.
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    shaper.curve = c;
    post.gain.value = 1 / (1 + drive);
  };
  apply(0.35);
  st.input.connect(shaper).connect(post).connect(st.wet);
  st.params = [param('drive', 'drive', 0, 1, 0.01, 0.35, apply)];
  return st;
}

function compStage(ctx) {
  const st = makeStage(ctx, 'comp', 'compressor', 1);
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -24;
  c.knee.value = 12;
  c.ratio.value = 4;
  c.attack.value = 0.01;
  c.release.value = 0.2;
  st.input.connect(c).connect(st.wet);
  st.params = [
    param('thresh', 'threshold (dB)', -60, 0, 1, -24, (v) => (c.threshold.value = v)),
    param('ratio', 'ratio', 1, 20, 0.5, 4, (v) => (c.ratio.value = v)),
    param('attack', 'attack (s)', 0.001, 0.3, 0.001, 0.01, (v) => (c.attack.value = v)),
    param('release', 'release (s)', 0.05, 1, 0.01, 0.2, (v) => (c.release.value = v)),
  ];
  return st;
}

const STAGE_MAKERS = {
  crush: crushStage,
  filter: filterStage,
  chorus: chorusStage,
  phaser: phaserStage,
  ringmod: ringmodStage,
  distort: distortStage,
  delay: delayStage,
  reverb: reverbStage,
  comp: compStage,
};
export const DEFAULT_ORDER = Object.keys(STAGE_MAKERS);

// A rack: the stages chained between `input` and `output` in the given
// order. `stages` is mutable (reorder = swap entries, then rewire()) —
// rewire touches only inter-stage edges, so external connections on
// `input`/`output` survive.
export function buildRack(ctx, order = DEFAULT_ORDER) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const stages = order.map((k) => STAGE_MAKERS[k](ctx));
  const rack = {
    input,
    output,
    stages,
    rewire() {
      input.disconnect();
      // Stage outputs' only outgoing edges are chain edges (dry/wet connect
      // INTO them), so a blanket disconnect is safe.
      for (const st of stages) st.output.disconnect();
      let node = input;
      for (const st of stages) {
        node.connect(st.input);
        node = st.output;
      }
      node.connect(output);
    },
  };
  rack.rewire();
  return rack;
}

// Limiter before the destination so no combination of maxed settings (delay
// feedback + big reverb + crush, now ×4 racks) can get painful.
export function connectLimited(ctx, node) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  node.connect(limiter).connect(ctx.destination);
}
