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

Two exploration panels, both URL-addressable like everything else on the page
(`#dev=1`, `#fx=1`; every slider syncs into the hash, so a sound you like is a
shareable link): **dev mode** puts the full synth surface on sliders — pitch,
detune, decay, brightness, crush, gain — no code entry needed; **post-fx** is
a bypassable wet/dry chain (bitcrush, resonant filter, chorus/flanger, phaser,
delay, reverb) for picking effects by ear before anything ships in-game —
nothing in it exists in-game yet.

**Live: https://bddap-bot.github.io/dpad-audio/**
