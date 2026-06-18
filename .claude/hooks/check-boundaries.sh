#!/usr/bin/env bash
# Stop — end-of-turn fitness gate. The EVIDENCE gate (hard): scripts/evidence.ts
# re-derives the tree hash of changed src and BLOCKS the Stop (exit 2) if the
# edits added typecheck errors above baseline. "Done" must compile — and the
# proof is recomputed from the actual files, so it can't be faked by a marker.
# evidence.ts only runs the expensive typecheck when changed-file content differs
# from the last green stamp, and self-downgrades to advisory after repeated
# identical blocks so the agent is never trapped.
set -uo pipefail
HOOK_LABEL="stop"
. "$(dirname "$0")/_lib.sh"

hook_read_input
# bail if we're already inside a Stop-triggered continuation.
printf '%s' "${HOOK_INPUT:-}" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0

cd "$(dirname "$0")/../.." 2>/dev/null || exit 0
[ -f package.json ] || exit 0

# evidence gate — hard block on NET-NEW typecheck breakage. evidence.ts exits 2
# to block the Stop and feeds the errors back to the agent.
if command -v bun >/dev/null 2>&1; then
  bun scripts/evidence.ts
  rc=$?
  [ "$rc" -eq 2 ] && exit 2
fi
exit 0
