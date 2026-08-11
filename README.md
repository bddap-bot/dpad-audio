# dpad-audio

A phone-friendly playground for a d-pad-as-instrument: every press sounds a
note, so entering a combo is playing a melody. Mappings are pure functions
`(comboState, press) -> soundEvent` in `schemes/` — combo state carries the
path so far, depth, and unlock set, so a scheme can vary pitch, detune, and
timbre with where you are in combo space, not just which key you hit. Pick
scheme and scale from the page (or `#scheme=drift&scale=insen`); adding a
scheme is one new file plus one registry line in `app.js`.

**Live: https://bddap-bot.github.io/dpad-audio/**
