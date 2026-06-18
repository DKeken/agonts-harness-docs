#!/usr/bin/env bash
# SessionStart — inject repo context the agent sees on startup/resume/compact.
# stdout IS added to context for this event. Keep fast, read-only.
set -uo pipefail
HOOK_LABEL="session-start"
. "$(dirname "$0")/_lib.sh"

hook_read_input
src="$(hook_source)"
cd "$(dirname "$0")/../.." 2>/dev/null || exit 0

echo "=== session context (${src:-startup}) ==="

if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  echo "branch: $branch"
  changed="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  echo "uncommitted files: $changed"
  echo "recent commits:"
  git log --oneline -3 2>/dev/null | sed 's/^/  /'
fi

# package/app map (only dirs that exist) — orients the agent on the layout.
[ -d packages ] && echo "packages: $(ls packages 2>/dev/null | tr '\n' ' ')"
[ -d apps ] && echo "apps: $(ls apps 2>/dev/null | tr '\n' ' ')"

# ── customize ── re-assert the load-bearing invariants — most valuable right
#    after a context compaction, when the agent has lost its bearings.
cat <<'RULES'
load-bearing rules: no any / non-null ! / @ts-ignore / import extensions.
prefer index/symbol search over grep. commit on a branch, never hide work in a stash.
"done" must compile — the Stop gate will block a turn that adds typecheck errors.
RULES
exit 0
