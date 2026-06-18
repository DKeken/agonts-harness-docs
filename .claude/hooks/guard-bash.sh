#!/usr/bin/env bash
# PreToolUse(Bash) — hard gate on destructive/forbidden commands. exit 2 = BLOCK.
# Enforces safety rules: no work-hiding stash, no force-push, no skipping hooks,
# no destructive resets/cleans, redirect the wrong package manager to the right
# one, and refuse piping a remote script straight into a shell.
set -uo pipefail
HOOK_LABEL="bash"
. "$(dirname "$0")/_lib.sh"

hook_read_input
hook_parse_bash
cmd="${HOOK_CMD:-}"
[ -z "$cmd" ] && exit 0

# strip leading whitespace / newlines for matching
c="$(printf '%s' "$cmd" | tr '\n' ' ')"

# 1. stashing hides work and is easy to lose — forbid it; commit on a branch.
printf '%s' "$c" | grep -qE '\bgit\s+stash\b' && \
  hook_fail "git stash hides work and is easy to lose. Commit on a branch or copy files aside instead."

# 2. skip hooks / signing.
printf '%s' "$c" | grep -qE '\-\-no-verify\b' && \
  hook_fail "--no-verify strips git hooks. Fix the underlying failure instead."

# 3. destructive git.
printf '%s' "$c" | grep -qE '\bgit\s+reset\s+--hard\b' && \
  hook_fail "git reset --hard discards work. Confirm with the user; prefer a safe reset."
printf '%s' "$c" | grep -qE '\bgit\s+clean\s+-[a-z]*f' && \
  hook_fail "git clean -f deletes untracked files. Confirm with the user first."
printf '%s' "$c" | grep -qE '\bgit\s+branch\s+-D\b' && \
  hook_fail "git branch -D force-deletes a branch. Use -d or confirm with the user."
printf '%s' "$c" | grep -qE '\bgit\s+push\b.*(--force\b|-f\b)' && \
  hook_fail "force push. If truly needed use --force-with-lease and confirm with the user."

# 4. piping a remote script straight into a shell.
printf '%s' "$c" | grep -qE '(curl|wget)\b.*\|\s*(sh|bash|zsh)\b' && \
  hook_fail "piping a remote script into a shell is unsafe. Download, inspect, then run."

# 5. world-writable chmod.
printf '%s' "$c" | grep -qE '\bchmod\s+(-R\s+)?0?777\b' && \
  hook_fail "chmod 777 is world-writable. Use least-privilege perms."

# ── customize ── wrong package manager. This harness assumes Bun; edit or drop
#    these two lines if your project uses npm/yarn/pnpm.
printf '%s' "$c" | grep -qE '\b(npm|yarn|pnpm)\s+(i|install|add|run|exec|create|ci)\b' && \
  hook_fail "use bun, not npm/yarn/pnpm (stack is locked to bun + bun workspaces)."
printf '%s' "$c" | grep -qE '\bnpx\s' && \
  hook_fail "use bunx, not npx."

# ── measure (non-blocking): grep/rg/find over code while the index tool is
#    stale = "skipped the index" smell. Bump a counter for retro; do NOT block
#    (grep is a legit last resort — we just want the index tried first). ───────
if printf '%s' "$c" | grep -qE '\b(grep|rg|ag)\b' && hook_stale serena 900; then
  hook_bump "search:grep-before-serena"
fi
exit 0
