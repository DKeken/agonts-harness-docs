<div align="center">

# Self-Improving Agent Harness

### A drop-in harness that makes an AI coding agent provably correct, measurable, and able to learn from its own mistakes.

**The harness, not the model, is the product.**

`prevent` → `prove` → `measure` → `learn` → `prevent` …

[**English**](README.md) · [**Русский**](README.ru.md) · [Full manual](docs/HARNESS.en.md) · [Philosophy](docs/PHILOSOPHY.md)

</div>

---

An LLM coding agent is a brilliant intern with three flaws: it forgets
everything between sessions, it follows written instructions inconsistently, and
it will confidently claim work is done when it isn't. You cannot patch those with
a longer prompt — a `CLAUDE.md` rule is followed ~80% of the time and decays hard
after ~15 tool calls; skills fire roughly at a coin flip.

So you stop instructing and start **enforcing**. This repo is a working harness —
deterministic shell hooks + small scripts wrapped around every action a
[Claude Code](https://claude.com/claude-code) agent takes. It turns soft advice
into hard physics, and it gets smarter every session.

It is **not** the agent and not your product code. It is the scaffolding around
them. Copy `.claude/` and `scripts/` into any repo, adapt a handful of rules to
your stack, and you have it.

---

## TL;DR — four legs

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  1 PREVENT  │──▶│  2  PROVE   │──▶│  3 MEASURE  │──▶│  4  LEARN   │
│ block bad   │   │ "done" must │   │ count every │   │ mine the    │
│ writes at   │   │ compile —   │   │ fire; find  │   │ transcript, │
│ write-time  │   │ un-fakeable │   │ hot vs dead │   │ promote     │
│ (hard gate) │   │ tree hash   │   │ guards      │   │ patterns    │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
      ▲                                                        │
      └────────────── the loop feeds itself ───────────────────┘
```

| | Leg | One line | Mechanism |
|---|---|---|---|
| 1 | **Prevent** | Block objective violations before the edit lands | `PreToolUse` hard gates, `exit 2` |
| 2 | **Prove** | "Done" cannot mean "broken" | `Stop` gate re-derives a SHA of changed source + typecheck |
| 3 | **Measure** | Know which rules help vs. hurt | Always-on counters bumped by every gate fire |
| 4 | **Learn** | Each session starts smarter | Transcript miner + cross-session promotion ledger |

The exit code is the whole contract: `exit 0` allows silently; `exit 2` blocks
and feeds the reason back to the agent so it self-corrects. That is the lever
that turns advice into physics.

---

## The lifecycle, one screen

```
┌────────────────────────── ONE TURN ──────────────────────────┐
│  user prompt                                                  │
│       │                                                       │
│       ▼                                                       │
│  ╔═══════════════════╗   inject: rules + branch + date        │
│  ║ UserPromptSubmit  ║   + the ONE hottest gotcha you keep    │
│  ║ prompt-context.sh ║   hitting (guide, not prescribe)       │
│  ╚═══════════════════╝                                        │
│       │ agent proposes Write / Edit / Bash                    │
│       ▼                                                       │
│  ╔═══════════════════╗   block any / ! / import-ext / inline  │
│  ║   PreToolUse      ║   schema / forbidden-git / wrong-pm.   │
│  ║ guard-write.sh    ║   EVERY block bumps a counter.         │
│  ║ guard-bash.sh     ║   (exit 2 = hard deny)                 │
│  ╚═══════════════════╝                                        │
│       │ allowed                                               │
│       ▼                                                       │
│  ╔═══════════════════╗   format --write, then lint;           │
│  ║   PostToolUse     ║   arch-gate ratchet vs baseline        │
│  ║ format/lint/arch  ║   (exit 2 feeds diagnostics back);     │
│  ║ track-mcp         ║   stamp index-tool usage               │
│  ╚═══════════════════╝                                        │
│       │ agent says "done"                                     │
│       ▼                                                       │
│  ╔═══════════════════╗   re-derive tree hash of changed src;  │
│  ║      Stop         ║   if edits added NET-NEW typecheck      │
│  ║ check-boundaries  ║   errors → BLOCK the turn (exit 2).     │
│  ║ → evidence.ts     ║   "done" must compile.                 │
│  ╚═══════════════════╝                                        │
└───────────────────────────────────────────────────────────────┘
        │ session ends
        ▼
  ╔═══════════════════╗   retro.ts mines the transcript:
  ║   SessionEnd      ║   doom-loops, hot/dead guards,
  ║ session-end.sh    ║   index-skips. Writes a memory card,
  ║ → retro.ts        ║   promotes 3+-session patterns,
  ╚═══════════════════╝   resets the counter window.
        │
        └──────────────► next session boots with the lesson
```

---

## Why (the 30-second version)

Four talks, one thesis — full mapping in [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md).

- **Nick Nisi (WorkOS)** — *Enforce, don't instruct. Guide, don't prescribe.
  Measure, don't assume.* Agents lie; make truth cheaper to produce than the
  lie. He deleted 95% of his skills and the pass rate went **up**. *Every failure
  is a harness bug, not a code bug.*
- **Luke Alvoeiro (Factory)** — the validation contract is written *before* the
  code; exit codes at milestone boundaries make handoffs self-healing.
- **Michael Grinich (WorkOS)** — the harness is the product; every model release
  forces a harness rebuild. The human moves up the stack to reviewing intent.
- **Chase (graphify)** — structure-first navigation beats grep: cheaper, more
  accurate.

---

## Design principles (the invariants)

1. **Ratchet, never big-bang.** Gates grandfather existing debt and block only
   NET-NEW debt. A repo converges on its target architecture with zero rewrites —
   every cleanup lowers a number that can never climb back.
2. **Data out of the runner.** Detection patterns live in JSON, never in the
   script that hunts them, so a gate never matches its own source code.
3. **Fail-open on ambiguity.** Hard-block only objective, unambiguous rules.
   Everything stack-specific is advisory — a single false-positive block destroys
   operator trust.
4. **Propose, don't auto-mutate.** The learning leg never silently rewrites a
   guard. It proposes; the human approves. Review stays up the stack.
5. **Safety valves everywhere.** Evidence self-downgrades to advisory after 3
   identical blocks so the agent is never trapped; Stop hooks honor the
   `stop_hook_active` re-entry flag.
6. **Cheap and local.** Pure Bash + Bun. No daemon, no service, no API key, no
   network. Each hook is `<200ms` and fails open on any error.

---

## Repo layout

```
README.md / README.ru.md     this overview (EN / RU)
docs/
  HARNESS.en.md  HARNESS.ru.md   full walkthrough of every leg
  PHILOSOPHY.md                  the four talks → doctrine (bilingual)
.claude/
  settings.json                  wires every hook to its lifecycle event
  hooks/
    _lib.sh                      shared helpers + the accumulator substrate
    prompt-context.sh            UserPromptSubmit: inject rules + hot gotcha
    session-start.sh             SessionStart: repo context after compaction
    guard-write.sh               PreToolUse(Write|Edit): the write wall
    guard-bash.sh                PreToolUse(Bash): destructive-command wall
    format-file.sh               PostToolUse: auto-format
    lint-file.sh                 PostToolUse: lint, feed diagnostics back
    arch-gate.sh                 PostToolUse: architecture debt ratchet
    track-mcp.sh                 PostToolUse: stamp index-tool usage
    check-boundaries.sh          Stop: dep-boundary + evidence gate
    session-end.sh               SessionEnd: auto-retro + window reset
  skills/harness-retro/          the human-invoked retro skill
scripts/
  arch-gate.ts  arch-gate.rules.json   debt counter + one-way ratchet
  evidence.ts                          un-fakeable "done must compile" gate
  retro.ts                             the transcript miner + ledger
```

---

## Quickstart

1. **Copy** `.claude/hooks/`, `.claude/settings.json`, and `scripts/` into your
   repo (this harness targets [Claude Code](https://claude.com/claude-code)).
2. **Adapt the rules.** `guard-write.sh` ships universal TypeScript-safety blocks
   (`any`, non-null `!`, `@ts-ignore`, nested ternary, import extensions,
   secrets) that apply anywhere, plus an example block of stack-specific rules
   marked `# ── customize ──`. Edit those to match your conventions.
3. **Set your typecheck command.** Evidence runs `${HARNESS_TYPECHECK_CMD}` and
   defaults to `bun run typecheck` — override it in `settings.json` env if you
   use `tsc`, `nx`, `turbo`, etc.
4. **Baseline the ratchets.** Run `bun scripts/arch-gate.ts --update` and
   `bun scripts/evidence.ts --reset` once to grandfather existing debt.
5. **Go.** Open a session. The hooks fire automatically; `retro.ts` writes its
   first memory card when the session ends.

> Requires [Bun](https://bun.sh) for the `.ts` scripts and `bash` + `python3` for
> the hooks. No other dependencies, no network calls.

---

## Operating it

```bash
bun scripts/evidence.ts --status        # current evidence stamp
bun scripts/evidence.ts --self-test     # changed files + tree hash, no typecheck
bun scripts/evidence.ts --reset         # re-baseline (grandfather current debt)

bun scripts/arch-gate.ts --list         # the architecture debt worklist
bun scripts/arch-gate.ts --list=<id>    # one rule's violations
bun scripts/arch-gate.ts --update       # lock a debt reduction

bun scripts/retro.ts                    # mine newest transcript, print report
bun scripts/retro.ts --write            # also write a memory card
bun scripts/retro.ts --reset-counters   # start a fresh measurement window
```

---

<div align="center">

MIT licensed · Read the [full manual →](docs/HARNESS.en.md) · [Русская версия →](README.ru.md)

</div>
