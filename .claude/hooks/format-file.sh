#!/usr/bin/env bash
# PostToolUse(Write|Edit) — auto-format the touched file. Never blocks (exit 0).
# ── customize ── swap the formatter for prettier/eslint/dprint/gofmt as needed.
set -uo pipefail

input="$(cat)"
file="$(printf '%s' "$input" | python3 -c 'import json,sys
try:
 d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))
except Exception: print("")')"

[ -z "${file:-}" ] && exit 0
case "$file" in
  *.ts|*.tsx|*.json|*.jsonc) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

bunx --bun @biomejs/biome format --write "$file" >/dev/null 2>&1 || true
exit 0
