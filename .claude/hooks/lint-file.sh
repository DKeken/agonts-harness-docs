#!/usr/bin/env bash
# PostToolUse(Write|Edit) — lint the touched file. exit 2 feeds diagnostics back
# to the agent so it self-corrects immediately. Skips generated/test/d.ts.
# ── customize ── swap the linter for eslint/oxlint/etc as needed.
set -uo pipefail
HOOK_LABEL="lint"
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
[ -f "$file" ] || exit 0

command -v bunx >/dev/null 2>&1 || exit 0
out="$(bunx --bun @biomejs/biome lint "$file" 2>&1 || true)"
if printf '%s' "$out" | grep -qiE '×|error|warning'; then
  printf 'LINT findings in %s (fix before continuing):\n%s\n' \
    "$file" "$(printf '%s' "$out" | grep -iE '×|error|warning|━' | head -30)" >&2
  exit 2
fi
exit 0
