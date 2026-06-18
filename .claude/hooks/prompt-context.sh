#!/usr/bin/env bash
# UserPromptSubmit — stdout is injected into the agent's context for this turn.
# Lightweight: date + branch + the non-negotiable rules + cadence nudges + the
# ONE hottest gotcha you keep hitting. Keep <100ms.
set -uo pipefail
HOOK_LABEL="prompt-context"
. "$(dirname "$0")/_lib.sh"

hook_read_input
cd "$(dirname "$0")/../.." 2>/dev/null || exit 0

branch=""
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
fi

# Cadence enforcement: nudge if the index/memory tools go unused for a while
# (track-mcp.sh stamps them). Rename "serena"/"qdrant" to whatever index +
# memory tools you wire up — or delete this block if you use none.
cadence=""
hook_stale serena 900  && cadence="${cadence}
NOTE: code-index tool unused >15min. Prefer a symbol/index lookup before grepping to ground yourself."
hook_stale qdrant 1200 && cadence="${cadence}
NOTE: memory tool unused >20min. Recall prior decisions/gotchas with this task's keywords before proceeding."

# Proactive gotcha injection (guide, don't prescribe). Surface the ONE rule you
# keep tripping — the specific landmine, not the whole rule dump — only once it
# has been hit enough to be a real pattern (>=3 blocks this window).
gotcha=""
top="$(hook_top_counter 'gotcha:')"
if [ -n "$top" ]; then
  gtext="${top% *}"; gn="${top##* }"
  if [ "${gn:-0}" -ge 3 ]; then
    gotcha="
RECURRING GOTCHA (you hit this ${gn}x — fix it at the source this time): ${gtext}"
  fi
fi

# ── customize ── replace the RULES block with your project's load-bearing,
#    non-negotiable invariants. Keep it short — this is injected every turn.
hook_inject "[harness] date $(date +%Y-%m-%d)${branch:+ · branch $branch}
RULES (non-negotiable): no any / non-null ! / @ts-ignore / nested ternary / import extensions.
Prefer index/symbol search over grep. Commit on a branch, never hide work in a stash.${cadence}${gotcha}"
exit 0
