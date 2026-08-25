# dpad-audio

A phone-friendly playground for a d-pad-as-instrument: every press sounds a
note, so entering a combo is playing a melody. Mappings are pure functions
`(comboState, press) -> soundEvent` in `schemes/` — combo state carries the
path so far, depth, and unlock set, so a scheme can vary pitch, detune, and
timbre with where you are in combo space, not just which key you hit. Pick
scheme and scale from the page; adding a scheme is one new file plus one
registry line in `app.js`.

The synth (`synth.js`) is a buffer-rendered port of the in-game instrument
(`bddap/rl` `crab-world/src/instrument.rs` — the source of truth): additive
partials, twin detuned voices, per-partial decay, bitcrush pre-gain, and
polyphony attenuation. `heldbreath` is the shipped scheme; its ✓/✗ buttons
trigger the completion cadences (exhale chord / deceptive cadence).

All exploration controls live on a collapsible, independently scrolling
sidebar (🎛), and every control syncs into the URL hash, so a sound you like
is a shareable link: **dev mode** puts the full synth surface on sliders —
pitch, detune, decay, brightness, crush, gain — no code entry needed;
**layers** stack up to three variants of every played note, each a transform
(pitch/detune offsets, vibrato, decay/gain multipliers) with its own choice
of 20 waveforms and its own effect rack, so a scheme's expressive curve
passes through; **post-fx** racks are bypassable wet/dry chains (bitcrush,
resonant filter, chorus/flanger, phaser, ring mod, distortion, delay, reverb,
compressor), reorderable with the ▲▼ buttons per effect — one master rack
plus one per layer — for picking effects by ear before anything ships
in-game — nothing in them exists in-game yet. The **config** panel imports
and exports the same object the hash carries, as editable JSON.

**Config schema** — the whole page state is ONE JSON object; the URL hash
carries it URL-encoded (`#%7B%22scheme%22...`), and the config panel's
import/export moves the identical object as text — one schema, three doors.
This is the interface the in-game chain is rebuilt from — the game-facing
fields are `scheme`, `scale`, `layers`, and `master`; `sidebar`/`devOpen`/
`fxOpen`/`dev` are page-only chrome a consumer ignores. Fields equal to
their default are omitted (a URL/export holds only what changed; import uses
replace semantics — missing fields reset to defaults, unknown keys are
refused):

```jsonc
{
  "scheme": "heldbreath",        // schemes/ key
  "scale": "hirajoshi",
  "sidebar": false, "devOpen": false, "fxOpen": false,  // UI open state
  "dev": { "pitch": 12, "detune": 0, "decay": 1.1,      // dev-mode pluck
           "bright": 0.55, "crush": 0, "gain": 0.8 },
  "master": RACK,                // master post-fx
  "layers": [ LAYER, LAYER, LAYER ]
}

LAYER = {
  "on": false,                   // layer 1 defaults on; 2 and 3 off
  "wave": "sine",                // one of the 20 wave types below
  "pitch": 0, "detune": 0,       // semis ± / cents ± offsets
  "vibRate": 0, "vibDepth": 0,   // vibrato Hz / cents
  "decay": 1, "gain": 1,         // multipliers
  "bright": 0, "crush": 0,       // ± / + offsets
  "fx": RACK                     // the layer's own rack
}

RACK = {
  "order": ["crush","filter","chorus","phaser","ringmod",
            "distort","delay","reverb","comp"],   // chain order (default shown;
                                                  // unknown keys drop, missing append)
  "stages": { "<key>": { "on": false, "wet": 0.3, /* per-stage params, e.g. */
                         "time": 0.31, "fb": 0.4 } }
}
```

Stage params: `crush` amt; `filter` type/cut/q; `chorus` rate/depth/base;
`phaser` rate/depth; `ringmod` wave/freq; `distort` drive; `delay` time/fb;
`reverb` size; `comp` thresh/ratio/attack/release. Wave types (layer `wave`
and `ringmod.wave` share the set, defined once in `waves.js`): sine,
triangle, square, pulse-quarter, pulse-eighth, saw, ramp, half-sine,
full-sine, parabola, cubic, round-square, fold, organ, hollow, bright, bell,
stairs, chirp, glass.

One non-JSON hash form survives as a hand-typed shorthand: `#dev=1&fx=1`
(and `sb=1`) just opens the panels (and, absent `sb`, the sidebar with
them). The JSON path takes `sidebar` literally — no inference, so a config
round-trips to identical state.

The dev sliders shape the *test note* the pluck button fires; the layers shape
*every* note (scheme presses, cadences, and the pluck).

Tests: `node test.js` (synth/scheme math parity) and `./dom-test.sh`
(headless-chromium boot + hash round-trip; needs `chromium` on PATH).

**Live: https://bddap-bot.github.io/dpad-audio/**
