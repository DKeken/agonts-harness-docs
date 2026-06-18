#!/usr/bin/env bash
# PostToolUse(mcp__*) — stamp last-use time for cadence tracking. Never blocks.
# prompt-context.sh reads these stamps to nudge when index/memory tools go stale.
#
# ── customize ── match the tool-name prefixes of YOUR index + memory tools.
#    Here: a code-index tool (-> "serena" stamp) and a memory tool (-> "qdrant").
set -uo pipefail
HOOK_LABEL="track-mcp"
. "$(dirname "$0")/_lib.sh"

hook_read_input
tool="$(printf '%s' "${HOOK_INPUT:-}" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(""); sys.exit(0)
print(d.get("tool_name","") or "")
' 2>/dev/null)"

case "$tool" in
  mcp__serena__*) hook_stamp serena ;;
  mcp__qdrant__*) hook_stamp qdrant ;;
esac
exit 0
