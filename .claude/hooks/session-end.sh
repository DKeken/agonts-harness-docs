#!/usr/bin/env bash
# SessionEnd — auto-retro. Mines the just-ended session for self-improvement
# signal and persists a memory card ONLY when something was found (retro.ts skips
# empty cards), then resets the per-session counters so the next session starts a
# clean window. This is the "learn" leg of the loop, automatic — no manual call.
#
# SessionEnd cannot block (output ignored) and fires once per session. Keep it
# quick and fail-open: never let a retro error disrupt session teardown.
set -uo pipefail
HOOK_LABEL="session-end"
. "$(dirname "$0")/_lib.sh"

hook_read_input
cd "$(dirname "$0")/../.." 2>/dev/null || exit 0
command -v bun >/dev/null 2>&1 || exit 0

# transcript path from the payload; fall back to retro's own newest-file scan.
tp="$(printf '%s' "${HOOK_INPUT:-}" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(""); sys.exit(0)
print(d.get("transcript_path","") or "")
' 2>/dev/null)"

if [ -n "$tp" ] && [ -f "$tp" ]; then
  bun scripts/retro.ts --file="$tp" --write >/dev/null 2>&1 || true
else
  bun scripts/retro.ts --write >/dev/null 2>&1 || true
fi

# fresh window for next session (ledger persists; counters do not).
bun scripts/retro.ts --reset-counters >/dev/null 2>&1 || true
exit 0
