#!/usr/bin/env bash
# In-browser half of the test suite (`node test.js` is the synth-math half):
# serves the repo on localhost and runs dom-test.html in headless chromium.
# Needs `chromium` and `node` on PATH (e.g. nix-shell -p chromium).
set -euo pipefail
cd "$(dirname "$0")"

port="${1:-8437}"
node dom-test-server.js "$port" &
srv=$!
trap 'kill "$srv" 2>/dev/null' EXIT
sleep 0.5

# --virtual-time-budget makes --dump-dom wait for the harness's async work
# (two iframe loads + settle timers) instead of dumping at first onload.
dom=$(chromium --headless=new --disable-gpu --no-sandbox \
  --virtual-time-budget=30000 \
  --dump-dom "http://127.0.0.1:$port/dom-test.html" 2>/dev/null)

# Match the verdict only where the harness renders it (the <pre>), never the
# harness's own inline script source, which --dump-dom also serializes.
verdict=$(echo "$dom" | grep -oE '<pre id="out">DOM-TEST: (PASS|FAIL)' | head -1 | sed 's/.*>//')
echo "${verdict:-DOM-TEST: NO-VERDICT (harness never rendered)}"
echo "$dom" | grep -E '^FAIL: ' || true
[ "$verdict" = "DOM-TEST: PASS" ]
