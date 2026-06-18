#!/usr/bin/env bash
# Shared helpers for the self-improving harness. SOURCE this, don't execute.
# One python3 spawn per parse to stay <200ms. exit 2 = hard block (PreToolUse).
# shellcheck disable=SC2155

# Read all stdin once into HOOK_INPUT.
hook_read_input() { HOOK_INPUT="$(cat)"; }

# Parse a Write/Edit payload -> HOOK_FILE + HOOK_CONTENT.
# content = Write.content OR Edit.new_string.
hook_parse_write() {
  HOOK_FILE="$(printf '%s' "${HOOK_INPUT:-}" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
print((d.get("tool_input",{}) or {}).get("file_path","") or "")
' 2>/dev/null)"
  HOOK_CONTENT="$(printf '%s' "${HOOK_INPUT:-}" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
i=d.get("tool_input",{}) or {}
c=i.get("content"); c=c if c is not None else i.get("new_string","")
sys.stdout.write(c or "")
' 2>/dev/null)"
}

# Parse a Bash payload -> HOOK_CMD.
hook_parse_bash() {
  HOOK_CMD="$(printf '%s' "${HOOK_INPUT:-}" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
print((d.get("tool_input",{}) or {}).get("command","") or "")
' 2>/dev/null)"
}

# SessionStart source field (startup|resume|clear|compact).
hook_source() {
  printf '%s' "${HOOK_INPUT:-}" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(""); sys.exit(0)
print(d.get("source","") or "")
' 2>/dev/null
}

# ── index-tool cadence tracking ──────────────────────────────────────────────
# State lives in .claude/.hookstate (gitignored). Time-based so it works across
# the separate short-lived hook processes.
HOOK_STATE_DIR="$(dirname "$0")/../.hookstate"
hook_stamp() { mkdir -p "$HOOK_STATE_DIR" 2>/dev/null; date +%s > "$HOOK_STATE_DIR/$1" 2>/dev/null || true; }
# hook_stale <name> <max_age_seconds> -> 0 (true/stale) if missing or older than max.
hook_stale() {
  local f="$HOOK_STATE_DIR/$1" now last
  [ -f "$f" ] || return 0
  now="$(date +%s)"; last="$(cat "$f" 2>/dev/null || echo 0)"
  [ $((now - last)) -gt "$2" ]
}

# ── accumulators: the always-on "measure" substrate ──────────────────────────
# Counters live in .hookstate/counters/<slug> (gitignored). retro.ts + the
# proactive injector read these. Filename-safe slug: keep [A-Za-z0-9:_-], cap 80.
_hook_slug() { printf '%s' "$1" | tr -c 'A-Za-z0-9:_-' '-' | cut -c1-80; }
# hook_bump <counter-key> — +1, fire-and-forget (never breaks the calling hook).
hook_bump() {
  local dir="$HOOK_STATE_DIR/counters" f n
  mkdir -p "$dir" 2>/dev/null || return 0
  f="$dir/$(_hook_slug "$1")"
  n=0; [ -f "$f" ] && n="$(cat "$f" 2>/dev/null || echo 0)"
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
  printf '%s' "$((n + 1))" > "$f" 2>/dev/null || true
}
# hook_count <counter-key> -> current value (0 if absent).
hook_count() {
  local f="$HOOK_STATE_DIR/counters/$(_hook_slug "$1")"
  [ -f "$f" ] && cat "$f" 2>/dev/null || echo 0
}
# hook_top_counter <prefix> -> "<key-without-prefix> <count>" of the highest
# counter whose name starts with prefix; nothing if none. Feeds proactive injection.
hook_top_counter() {
  local dir="$HOOK_STATE_DIR/counters" pfx="$1" best="" bestn=0 f n base
  [ -d "$dir" ] || return 0
  for f in "$dir/$pfx"*; do
    [ -f "$f" ] || continue
    n="$(cat "$f" 2>/dev/null || echo 0)"
    case "$n" in ''|*[!0-9]*) n=0 ;; esac
    if [ "$n" -gt "$bestn" ]; then bestn="$n"; base="$(basename "$f")"; best="${base#"$pfx"}"; fi
  done
  [ -n "$best" ] && printf '%s %s' "$best" "$bestn"
}

# hook_fail <reason> — emit a PreToolUse deny (works even under bypassPermissions)
# AND exit 2 as a fallback for older Claude Code. Bumps two counters for the
# measure layer: coarse guard:<label> (retro dead/hot detection) and fine
# gotcha:<reason-head> (the proactive injector surfaces the most-hit gotcha).
hook_fail() {
  local reason="BLOCKED [${HOOK_LABEL:-hook}]: $1"
  hook_bump "guard:${HOOK_LABEL:-hook}"
  hook_bump "gotcha:$(printf '%s' "$1" | cut -c1-60)"
  printf '%s' "$reason" | python3 -c '
import json,sys
r=sys.stdin.read()
print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":r}}))
' 2>/dev/null || printf '%s\n' "$reason" >&2
  printf '%s\n' "$reason" >&2
  exit 2
}

# Non-blocking advisory to stderr; caller keeps going.
hook_warn() { printf 'WARN  [%s]: %s\n' "${HOOK_LABEL:-hook}" "$1" >&2; }

# Inject context (UserPromptSubmit/SessionStart). stdout is added to context.
hook_inject() { printf '%s\n' "$1"; }

# grep helper: returns 0 if pattern present in HOOK_CONTENT.
hook_has() { printf '%s' "${HOOK_CONTENT:-}" | grep -nE "$1" >/dev/null 2>&1; }
