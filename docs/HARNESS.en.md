# The AGONTS Self-Improving Harness — Full Manual (EN)

> Russian version: [`HARNESS.ru.md`](HARNESS.ru.md) · Philosophy: [`PHILOSOPHY.md`](PHILOSOPHY.md)

This is the complete walkthrough. Read it top to bottom and you will understand
every hook, every script, every piece of state, and — most importantly — *why*
each one exists.

---

## 0. What a "harness" is

A harness is the deterministic scaffolding wrapped around a non-deterministic
agent. The model proposes; the harness disposes. Every action the agent takes —
reading a prompt, writing a file, running a command, ending a turn — passes
through a hook the harness controls.

Claude Code exposes lifecycle **events**. The harness binds a small shell script
to each one in `.claude/settings.json`:

| Event | When it fires | Our hook | Can it block? |
|---|---|---|---|
| `SessionStart` | session opens / resumes / after compaction | `session-start.sh` | no (inject only) |
| `UserPromptSubmit` | every user message | `prompt-context.sh` | no (inject only) |
| `PreToolUse` | before a tool runs | `guard-write.sh`, `guard-bash.sh` | **yes** (`exit 2`) |
| `PostToolUse` | after a tool succeeds | `format-file.sh`, `lint-file.sh`, `arch-gate.sh`, `track-mcp.sh` | feed-back (`exit 2`) |
| `Stop` | agent tries to end the turn | `check-boundaries.sh` → `evidence.ts` | **yes** (`exit 2`) |
| `SessionEnd` | session closes | `session-end.sh` → `retro.ts` | no |

The exit code is the whole contract:

- `exit 0` — allow, say nothing.
- `exit 2` — **block**, and feed stdout/stderr back to the agent so it can
  self-correct. This is the lever that turns advice into physics.

---

## 1. The doctrine (three rules that shape everything)

Every piece of this harness obeys three rules, distilled from the talks in
[`PHILOSOPHY.md`](PHILOSOPHY.md):

### Rule 1 — Enforce, don't instruct
A rule in `CLAUDE.md` is followed ~80% of the time and decays hard after ~15
tool calls (attention dilution: system-prompt tokens lose weight as tool-call
history fills the window). A rule in a `PreToolUse` hook is followed 100% of the
time, because the edit physically cannot land until the hook returns `exit 0`.
So anything that *can* be a hook *is* a hook.

### Rule 2 — Guide, don't prescribe
A wall of "do this, do that" sends the model on goose chases — one over-eager
skill dropped a task from 97% to 77% correct. The harness injects the **single
most relevant landmine** at the moment it matters, not the whole rulebook. See
the proactive gotcha injection in §3.

### Rule 3 — Measure, don't assume
You cannot know which of 22 guards help versus hurt unless you count. Every
guard fire bumps a counter. Retro reads the counters and tells you which guards
are *hot* (fire constantly → the rule is unclear, fix the root) and which are
*dead* (never fire → noise, propose removal). **Every failure is a harness bug.**

---

## 2. The four legs

### Leg 1 — PREVENT (write-time hard gates)

`guard-write.sh` runs on every `Write`/`Edit`. It splits rules into two tiers:

- **Blocking (objective, unambiguous):** `any`, `as unknown as`, non-null `!`,
  `@ts-ignore`, `Function`/`Object`/`{}` weak types, `debugger`, **nested
  ternary**, import file extensions, deep imports past a package barrel, inline
  Zod outside `@agonts/contracts`, Zod `message:` instead of `error:`, `console`
  in the pure layer, secrets/credentials files. Each calls `hook_fail` → `exit 2`.
- **Advisory (stack-specific, fuzzy):** Cyrillic outside i18n, missing
  `workspaceId` on a repo method, files >400 lines, folders >5 entries, magic
  numbers, hardcoded URLs, `process.env` outside config. Each calls `hook_warn`
  → `exit 0`. The edit lands; the agent just sees a nudge.

Why the split? **A false-positive block enrages the operator.** The moment a
gate wrongly stops legitimate work, the human disables the whole harness. So the
hard line is drawn only where a rule is objectively decidable from the text.

`guard-bash.sh` is the command wall. It blocks the globally-forbidden
operations: `git stash` (no exceptions — it hides work and is easy to lose),
`--no-verify`, `git reset --hard`, `git clean -f`, `git branch -D`, force-push,
`npm`/`yarn`/`pnpm` (the stack is locked to `bun`), `npx` (use `bunx`), and
piping a remote script straight into a shell. It also does one *measure*-only
thing: if the agent runs `grep`/`rg` while the serena index is stale, it bumps
`search:grep-before-serena` — no block, just a tally for retro.

### Leg 2 — PROVE (the evidence gate)

This is the cleverest leg. The problem: agents say "done, tests pass" after
running nothing. Nick Nisi's first fix was a `.case-tested` marker file — but an
agent can `touch` a marker. So the marker must be **un-fakeable**.

`scripts/evidence.ts`, fired on `Stop`:

1. Computes the set of changed source `.ts/.tsx` files (excludes test/generated).
2. Hashes their *content* into a 16-char tree hash (`sha256` of path + bytes).
3. If a prior green stamp has the same hash → already proven, `exit 0` instantly
   (the expensive typecheck never reruns on unchanged code).
4. Otherwise runs `bun nx run-many -t typecheck` and counts errors.
5. **Ratchet:** `errors <= baseline` → record green, `exit 0`. `errors >
   baseline` → the turn added NET-NEW breakage → **block the Stop (`exit 2`)**
   and feed back the first errors.

The hash is keyed to actual file bytes, so you cannot end a turn claiming
success while the code you touched does not compile, and you cannot forge the
proof by touching a file. Pre-existing debt is grandfathered (`baseline`); only
new debt is fatal.

**Safety valve:** if the identical broken tree blocks 3 times with no edit
progress, evidence self-downgrades to advisory (`exit 0` with a warning) so the
agent is never permanently trapped.

### Leg 3 — MEASURE (the accumulator substrate)

This is the quietest leg and the one that makes the other three smart. It lives
in `_lib.sh` and is two tiny functions:

- `hook_bump <key>` — increments `.hookstate/counters/<key>` by one. Fire and
  forget; never breaks the calling hook.
- `hook_count <key>` / `hook_top_counter <prefix>` — read counters back.

Every time `hook_fail` blocks an edit, it bumps **two** counters:

- `guard:<label>` — coarse, e.g. `guard:write`, `guard:bash`. Lets retro tell
  *hot* guards (fire constantly) from *dead* guards (never fire).
- `gotcha:<reason-head>` — fine, the first 60 chars of the block reason. Lets the
  proactive injector surface the single most-hit landmine next prompt.

The counters are gitignored runtime state in `.hookstate/counters/`. They are
the *raw signal*; the other two functions of the harness — proactive injection
and retro — are just two different readers of that same signal. This is the
cheap down-payment on Nick's "measure" leg: no eval framework, no dashboard,
just a directory of integers that the rest of the system mines.

### Leg 4 — LEARN (retro + proactive injection)

Two readers turn raw counts into behavior change.

**Proactive injection** (`prompt-context.sh`, runs on every prompt). It reads the
single hottest `gotcha:` counter, and *if it has been hit ≥3 times this window*,
injects exactly that one landmine as a targeted reminder:

```
RECURRING GOTCHA (you hit this 4x — fix it at the source this time):
nested-ternary---extract-to-an-if-switch-or-a-lookup-map-for
```

This is Rule 2 in action — guide, don't prescribe. Not the whole rulebook; the
*one* rule you keep breaking, surfaced *before* the edit instead of only blocked
after. The same hook also enforces tool cadence: if serena hasn't run in 15 min
or qdrant in 20 min (tracked by `track-mcp.sh` timestamps), it injects a nudge
to use the index before grepping.

**Retro** (`scripts/retro.ts`, runs automatically on `SessionEnd` and on demand
via the `harness-retro` skill). It mines the session transcript JSONL plus the
counters and emits findings:

| Finding | How it's detected | What it means |
|---|---|---|
| **doom-loop** | same `tool_use` (name + input) ≥3× | the agent spun its wheels — a hook should have caught it sooner |
| **hot-guard** | a `guard:*` counter ≥5 | the rule is unclear or the workflow fights it → fix the *root* |
| **dead-guard** | a known guard label never fired | maybe noise → propose removal |
| **grep-before-serena** | `search:grep-before-serena` > 0 | the index was skipped → reinforce serena-first |

It writes a `harness_retro_<date>.md` memory card and appends a line to
`MEMORY.md`, **only if there is real signal** (a clean run leaves no noise). On
`SessionEnd` it then resets the counter window so the next session measures fresh.

**Cross-session promotion ledger.** Counters reset each session; the ledger
(`.hookstate/harness-patterns.jsonl`) does not. It tracks how many *distinct*
sessions each finding recurred in. At 3+ sessions, the pattern is flagged for
**promotion** — elevate it to `CLAUDE.md` or a rule card. This is the bridge
from "I hit this once" to "this is a systemic harness gap worth a permanent
rule." Critically: retro **proposes** the promotion. It never edits `CLAUDE.md`
itself. The human stays up the stack and approves (Rule from §1: review stays up
the stack).

---

## 3. The supporting cast

Not every hook is a leg. Three more keep the loop smooth:

- **`session-start.sh`** — on open/resume/compaction, injects repo orientation:
  branch, uncommitted count, recent commits, the package/app map, and the
  load-bearing architecture invariants. Most valuable right after a context
  compaction, when the agent has lost its bearings.
- **`format-file.sh`** — after every write, runs `biome format --write` on the
  touched file. Never blocks. The agent never wastes a turn on formatting.
- **`lint-file.sh`** — after every write, runs `biome lint`. If there are real
  diagnostics, `exit 2` feeds them back so the agent self-corrects immediately
  rather than discovering them at CI.
- **`arch-gate.sh`** + **`arch-gate.ts`** — the architecture debt ratchet. This
  is the *template* the whole harness copies. Detection patterns live in
  `arch-gate.rules.json` (data), the runner counts and compares against
  `arch-baseline.json`. `count > baseline` → block; `count < baseline` → pass +
  "run `--update` to lock the gain." The runner is kept free of the literals it
  hunts, so it never matches its own source.

---

## 4. How the legs compose into a self-improving loop

Read the legs as a feedback cycle, not a checklist:

1. **Prevent** stops the obvious mistakes at write-time. But it can only catch
   what is objectively decidable from one file's text.
2. **Prove** catches what prevent can't — cross-file type breakage only visible
   after the whole edit. It guarantees the floor: the turn compiles.
3. **Measure** observes *everything* — which prevents fire, which never do, where
   the agent loops. Without it you are guessing which of 22 rules earn their place.
4. **Learn** turns that observation into change: it warns you *before* the edit
   about the landmine you keep hitting, and proposes permanent rules for systemic
   gaps. The output of learn becomes a better prevent.

The loop tightens every session. The harness doesn't just stop bad code — it
discovers *which* rules matter, surfaces them at the right moment, and asks the
human to promote the ones that recur. That is what "self-improving" means here:
not the model getting smarter, but the **scaffolding** getting smarter about the
model.

---

## 5. Operating it

```bash
# see the current evidence stamp
bun scripts/evidence.ts --status

# what changed + the tree hash, without running typecheck
bun scripts/evidence.ts --self-test

# re-baseline evidence against the current tree (grandfather current debt)
bun scripts/evidence.ts --reset

# the architecture debt worklist
bun scripts/arch-gate.ts --list
bun scripts/arch-gate.ts --list=<rule-id>

# lock a debt reduction after paying it down
bun scripts/arch-gate.ts --update

# run a retro on the newest transcript (print only)
bun scripts/retro.ts

# run a retro and write a memory card
bun scripts/retro.ts --write

# mine a specific transcript
bun scripts/retro.ts --file=~/.claude/projects/<slug>/<id>.jsonl

# start a fresh measurement window
bun scripts/retro.ts --reset-counters
```

---

## 6. Extending it

To add a new prevent rule:

- **Objective + decidable from one file?** Add a `hook_has` check to
  `guard-write.sh` calling `hook_fail` (block) or `hook_warn` (advisory).
- **Repo-wide, ratchet-style?** Add an entry to `arch-gate.rules.json` and run
  `bun scripts/arch-gate.ts --update` to baseline it. No runner code changes.
- **A command to forbid?** Add a `grep -qE … && hook_fail` line to
  `guard-bash.sh`.

Every new block automatically participates in measure (it bumps a counter) and
learn (retro will report it hot or dead). You never wire that up by hand — it
falls out of calling `hook_fail`.

---

## 7. Provenance

Distilled from a working harness running against a production TypeScript
monorepo (Nx + Bun + ElysiaJS + Drizzle + Next.js). The philosophy is mapped in
[`PHILOSOPHY.md`](PHILOSOPHY.md).
