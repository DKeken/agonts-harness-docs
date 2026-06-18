#!/usr/bin/env bash
# PostToolUse(Write|Edit) — architecture ratchet at write-time. Runs the
# repo-wide arch-gate and BLOCKS (exit 2, feeds back to the agent) only when the
# edit pushed a debt count ABOVE arch-baseline.json. Pre-existing (grandfathered)
# debt never triggers it — only NET-NEW debt blocks.
set -uo pipefail
HOOK_LABEL="arch-gate"
. "$(dirname "$0")/_lib.sh"

hook_read_input
hook_parse_write
file="${HOOK_FILE:-}"
[ -z "$file" ] && exit 0
case "$file" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac
case "$file" in
  *.generated.ts|*.generated.tsx|*.d.ts|*.test.ts|*.test.tsx) exit 0 ;;
esac

command -v bun >/dev/null 2>&1 || exit 0
root="$(dirname "$0")/../.."
out="$(cd "$root" && bun scripts/arch-gate.ts 2>&1)"
rc=$?
if [ "$rc" -ne 0 ]; then
  printf 'arch-gate: your edit added architecture debt above baseline.\n%s\n\nFix the new violation, or run `bun scripts/arch-gate.ts --list` to locate it.\n' \
    "$(printf '%s' "$out" | grep -E '✖|FAILED')" >&2
  exit 2
fi
exit 0
