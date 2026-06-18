#!/usr/bin/env bash
# PreToolUse(Write|Edit) — hard gate. exit 2 = BLOCK (exit 0 = allow/warn).
# FAIL-CLOSED only on objective, unambiguous rules (any / ! / import ext / weak
# types). Everything stack-specific is ADVISORY (warn, exit 0) — a false-positive
# block enrages the operator and erodes trust in the whole harness.
set -uo pipefail
HOOK_LABEL="write"
. "$(dirname "$0")/_lib.sh"

hook_read_input
hook_parse_write
file="${HOOK_FILE:-}"
[ -z "$file" ] && exit 0

# protected secret files — never silently overwritten.
case "$file" in
  *credentials*|*secrets*|*.pem|*.key)
    hook_fail "refusing to write a secrets/credentials file ($file). Confirm with the user." ;;
esac

case "$file" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac
case "$file" in
  *.generated.ts|*.generated.tsx|*.test.ts|*.test.tsx) exit 0 ;;
esac

content="${HOOK_CONTENT:-}"
[ -z "$content" ] && exit 0
HOOK_CONTENT="$content"

# ── ADVISORY: file size nudge (god-file smell, not a hard cap) ───────────────
lines="$(printf '%s\n' "$content" | wc -l | tr -d ' ')"
[ "$lines" -gt 400 ] && hook_warn "file > 400 lines ($lines) — confirm it's one cohesive unit, not a god-file."

# ── BLOCKING: type-safety / escape hatches (universal, objective) ────────────
hook_has '(:[[:space:]]*any\b|<any>|\bas any\b)' && \
  hook_fail "uses 'any' — use discriminated unions + type guards."
hook_has '\bas\s+unknown\s+as\b' && \
  hook_fail "'as unknown as' double-cast defeats the type system — model the type properly."
# non-null assertion: ident/`)`/`]` then `!` then `.;,)[` (skips != and "str!").
hook_has '[]A-Za-z0-9_)]![.;,)[]' && \
  hook_fail "non-null '!' assertion — narrow with a type guard instead."
hook_has '@ts-(ignore|expect-error|nocheck)' && \
  hook_fail "@ts-ignore/@ts-expect-error/@ts-nocheck suppresses the compiler — fix the type."
hook_has '(biome-ignore|eslint-disable)' && \
  hook_fail "lint suppression comment — fix the underlying issue instead."
hook_has ':[[:space:]]*(Function|Object)\b|:[[:space:]]*\{\}([^a-zA-Z]|$)' && \
  hook_fail "weak type (Function/Object/{}) — use a precise signature or interface."

# ── BLOCKING: debugger + nested ternary (universal, objective) ───────────────
hook_has '\bdebugger\b' && \
  hook_fail "'debugger' statement left in source."
# nested value-ternary: a ? b : c ? d : e — exclude TS conditional types (extends)
# and TS optional markers (?: optional property, ?. optional chain).
if ! printf '%s' "$content" | grep -qE '\bextends\b.*\?'; then
  deopt="$(printf '%s' "$content" | sed 's/?:/_OPT_/g; s/?\./_OCH_/g')"
  printf '%s' "$deopt" | grep -qE '\?[^?:]*:[^?:]*\?[^?:]*:' && \
    hook_fail "nested ternary — extract to an if/switch or a lookup map for readability."
fi

# ── BLOCKING: import hygiene (objective) ─────────────────────────────────────
# extension ban applies to relative imports; external ESM packages may publish
# .js-only subpaths legitimately.
hook_has "from[[:space:]]+['\"](\.{1,2}/)[^'\"]*\.(js|ts|jsx|tsx)['\"]" && \
  hook_fail "import file extension (.js/.ts/.jsx/.tsx) forbidden in relative imports — use moduleResolution=bundler."

# ─────────────────────────────────────────────────────────────────────────────
# ── customize ── everything below is STACK-SPECIFIC. These are examples from
#    a contracts-first hexagonal TS monorepo. Edit the package names, layer
#    boundaries, and i18n paths to match YOUR conventions — or delete them.
# ─────────────────────────────────────────────────────────────────────────────

# example: schema library confined to one package (here a "contracts" package).
case "$file" in
  *packages/contracts/*) ;;
  *)
    hook_has "\bz\.(object|string|number|enum|union|discriminatedUnion|array|record)\(" && \
      hook_fail "inline schema outside the contracts package. Define it where schemas live."
  ;;
esac

# example: console banned in the pure/leaf layer.
case "$file" in
  *packages/contracts/src/*)
    hook_has '\bconsole\.(log|debug|info|warn|error|trace)\b' && \
      hook_fail "console.* in the pure layer — keep it dependency-free + side-effect-free."
  ;;
esac

# example: ADVISORY non-Latin text outside i18n homes — WARN, not block.
case "$file" in
  *i18n*|*dictionary*|*dict*|*messages*|*locales*) ;;
  *)
    stripped="$(printf '%s' "$content" | perl -0777 -pe 's{//[^\n]*}{}g; s{/\*.*?\*/}{}gs' 2>/dev/null || printf '%s' "$content")"
    printf '%s' "$stripped" | grep -qP '[^\x00-\x7F]' && \
      hook_warn "non-ASCII literal in code — prefer i18n keys for user-facing copy."
  ;;
esac

# example: ADVISORY tenant isolation — repo methods should take a tenant id.
case "$file" in
  *.repo.ts|*.port.ts)
    if hook_has "(findById|findMany|list|update|delete|create)\s*\(" && \
       ! printf '%s' "$content" | grep -qE 'workspaceId|tenantId|orgId'; then
      hook_warn "repo/port query methods but no tenant id seen — confirm tenant isolation."
    fi
  ;;
esac

# ── ADVISORY: misc universal smells (non-blocking) ───────────────────────────
printf '%s' "$content" | grep -nE '\b(TODO|FIXME|HACK|XXX)\b' >/dev/null 2>&1 && \
  hook_warn "TODO/FIXME/HACK left in source — resolve or file a ticket before merge."
case "$file" in
  *config*|*env*) ;;
  *) hook_has "['\"]https?://" && hook_warn "hardcoded URL — move to config/env." ;;
esac
case "$file" in
  *config*|*env*) ;;
  *) hook_has '\bprocess\.env\b' && hook_warn "process.env outside a config module — read env once and inject." ;;
esac
exit 0
