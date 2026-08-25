# dpad-audio

A phone-friendly playground for a d-pad-as-instrument: every press sounds a
note, so entering a combo is playing a melody. Mappings are pure functions
`(comboState, press) -> soundEvent` in `schemes/` — combo state carries the
path so far, depth, and unlock set, so a scheme can vary pitch, detune, and
timbre with where you are in combo space, not just which key you hit. Pick
scheme and scale from the page (or `#scheme=drift&scale=insen`); adding a
scheme is one new file plus one registry line in `app.js`.

The synth (`synth.js`) is a buffer-rendered port of the in-game instrument
(`bddap/rl` `crab-world/src/instrument.rs` — the source of truth): additive
partials, twin detuned voices, per-partial decay, bitcrush pre-gain, and
polyphony attenuation. `heldbreath` is the shipped scheme; its ✓/✗ buttons
trigger the completion cadences (exhale chord / deceptive cadence).

All exploration controls live on a collapsible, independently scrolling
sidebar (🎛), URL-addressable like everything else on the page (`#dev=1`,
`#fx=1`, `#sb=1`; every control syncs into the hash, so a sound you like is a
shareable link): **dev mode** puts the full synth surface on sliders — pitch,
detune, decay, brightness, crush, gain — no code entry needed; **layers**
stack up to three variants of every played note, each a transform (pitch/
detune offsets, decay/gain multipliers) with its own effect rack, so a
scheme's expressive curve passes through; **post-fx** racks are bypassable
wet/dry chains (bitcrush, resonant filter, chorus/flanger, phaser, delay,
reverb), reorderable with the ▲▼ buttons per effect — one master rack plus
one per layer — for picking effects by ear before anything ships in-game —
nothing in them exists in-game yet.

**Hash schema** — the URL is the interface (the in-game chain is rebuilt from
these links), and values at their default are deleted, not written, so a URL
carries only what changed (except `scheme`/`scale`, always pinned at boot, and
`sb`, pinned when a panel gate implies it):

- `scheme`, `scale` — pickers. `dev`, `fx`, `sb` = `1` — dev panel, master fx
  panel, sidebar open (absent `sb` opens the sidebar iff `dev` or `fx` is set).
- `dev-<param>` — dev-mode pluck: `pitch detune decay bright crush gain`.
- `l<n>` (n = 1..3) — layer enable. Layer 1 is ON by default (`l1=0`
  disables); 2 and 3 are off (`l2=1` enables). `l<n>-<param>` — the layer's
  transform: `pitch` (semis ±), `detune` (cents ±), `decay` (×), `bright` (±),
  `crush` (+), `gain` (×); defaults are the identity.
- Racks: master uses prefix `fx-`, layer racks `l<n>-fx-`. Per rack:
  `<prefix><stage>=1` enable, `<prefix><stage>-wet`, `<prefix><stage>-<param>`,
  and `<prefix>order` = comma list of stage keys
  (`crush,filter,chorus,phaser,delay,reverb` is the default; unknown keys are
  dropped, missing ones appended).

The dev sliders shape the *test note* the pluck button fires; the layers shape
*every* note (scheme presses, cadences, and the pluck).

Tests: `node test.js` (synth/scheme math parity) and `./dom-test.sh`
(headless-chromium boot + hash round-trip; needs `chromium` on PATH).

**Live: https://bddap-bot.github.io/dpad-audio/**
