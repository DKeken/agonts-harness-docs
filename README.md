<div align="center">

# AGONTS Self-Improving Agent Harness

### Самообучающийся харнесс для AI-агента

**The harness, not the model, is the product.**
**Продукт — это харнесс, а не модель.**

`prevent` → `prove` → `measure` → `learn` → `prevent` …

</div>

---

> A working, production self-improving harness for an AI coding agent (Claude
> Code) inside a real TypeScript monorepo. This repo is **documentation only** —
> it explains the scaffolding around the agent: the hooks, gates, accumulators,
> and retro miner that make the agent **provably correct, measurable, and able
> to learn from its own mistakes across sessions.**
>
> Рабочий, боевой самообучающийся харнесс для AI-агента (Claude Code) внутри
> настоящего TypeScript-монорепо. Этот репозиторий — **только документация**: он
> описывает обвязку вокруг агента — хуки, гейты, аккумуляторы и retro-майнер,
> которые делают агента **доказуемо корректным, измеримым и способным учиться на
> собственных ошибках между сессиями.**

---

## Navigation · Навигация

| Doc | EN | RU |
|---|---|---|
| **Full manual** — every leg, end to end | [`docs/HARNESS.en.md`](docs/HARNESS.en.md) | [`docs/HARNESS.ru.md`](docs/HARNESS.ru.md) |
| **Philosophy** — the four talks → doctrine | [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md) | ⤴ (bilingual) |

---

## TL;DR

An LLM coding agent is a brilliant intern with no memory and a habit of lying
about whether it ran the tests. You cannot fix that by writing a longer prompt —
prompts decay after ~15 tool calls and skills fire only ~50% of the time. You
fix it by building a **harness**: deterministic shell hooks and scripts that
wrap every action the agent takes and turn soft advice into hard physics.

This harness has **four legs**, each closing a gap the previous leg can't:

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  1 PREVENT  │──▶│  2  PROVE   │──▶│  3 MEASURE  │──▶│  4  LEARN   │
│ block bad   │   │ "done" must │   │ count every │   │ mine the    │
│ writes at   │   │ compile —   │   │ fire; find  │   │ transcript, │
│ write-time  │   │ un-fakeable │   │ hot/dead    │   │ promote     │
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

---

## The one-screen lifecycle

```
┌────────────────────────── ONE TURN ──────────────────────────┐
│                                                               │
│  user prompt                                                  │
│       │                                                       │
│       ▼                                                       │
│  ╔═══════════════════╗   inject: rules + branch + date        │
│  ║ UserPromptSubmit  ║   + the ONE hottest gotcha you keep    │
│  ║ prompt-context.sh ║   hitting (proactive, guide-not-       │
│  ╚═══════════════════╝   prescribe)                           │
│       │                                                       │
│       ▼   agent proposes Write / Edit / Bash                  │
│  ╔═══════════════════╗   block any / ! / import-ext / inline  │
│  ║   PreToolUse      ║   zod / forbidden-git / npm.           │
│  ║ guard-write.sh    ║   EVERY block bumps a counter ────────┐│
│  ║ guard-bash.sh     ║   (exit 2 = hard deny)                ││
│  ╚═══════════════════╝                                       ││
│       │ allowed                                              ││
│       ▼                                                      ││
│  ╔═══════════════════╗   biome --write, then biome lint;     ││
│  ║   PostToolUse     ║   arch-gate ratchet vs baseline       ││
│  ║ format / lint /   ║   (exit 2 feeds diagnostics back)     ││
│  ║ arch-gate / track ║   serena/qdrant use → timestamp       ││
│  ╚═══════════════════╝                                       ││
│       │                                                      ││
│       ▼   agent says "done"                                  ││
│  ╔═══════════════════╗   re-derive tree hash of changed src; ││
│  ║      Stop         ║   if edits added NET-NEW typecheck     ││
│  ║ check-boundaries  ║   errors → BLOCK the turn (exit 2).    ││
│  ║ → evidence.ts     ║   "done" must compile.                ││
│  ╚═══════════════════╝                                       ││
│                                                              ││
└──────────────────────────────────────────────────────────────┘│
        │ session ends                                           │
        ▼                                                        │
  ╔═══════════════════╗   retro.ts mines transcript:            │
  ║   SessionEnd      ║   doom-loops, hot/dead guards,          │
  ║ session-end.sh    ║   grep-before-serena. Writes a memory   │
  ║ → retro.ts        ║◀──┘ card, promotes 3+-session patterns, │
  ╚═══════════════════╝     resets the counter window.          │
        │                                                        │
        └──────────────► next session boots with the lesson ─────┘
```

---

## Why it exists (the 30-second version)

Four talks, one thesis. Full mapping in [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md).

- **Nick Nisi (WorkOS)** — *Enforce, don't instruct. Guide, don't prescribe.
  Measure, don't assume.* Agents lie; make the truth cheaper to produce than the
  lie. He deleted 95% of his skills (10k → 553 lines) and the pass rate went
  **up** — comprehensive docs send the model on goose chases. He only knew
  because he **measured**. **Every failure is a harness bug, not a code bug.**
- **Luke Alvoeiro (Factory)** — the validation contract is written *before* the
  code; validators never see the implementation (adversarial by design).
  Structured handoffs with exit codes = self-healing at milestone boundaries.
- **Michael Grinich (WorkOS)** — the harness is the product; every model release
  forces a harness rebuild. The human moves up the stack: from writing lines to
  reviewing intent.
- **Chase (graphify)** — structure-first navigation beats grep: cheaper and more
  accurate.

---

## Design principles (the invariants)

1. **Ratchet, never big-bang.** Gates grandfather existing debt and block only
   NET-NEW debt. The repo converges on its target architecture with zero
   rewrites — every cleanup lowers a number that can never climb back.
2. **Data out of the runner.** Detection patterns live in JSON, never in the
   script that hunts them, so a gate never matches its own source code.
3. **Fail-open on ambiguity.** Hard-block only objective, unambiguous rules.
   Everything stack-specific is advisory — a single false-positive block
   destroys operator trust.
4. **Propose, don't auto-mutate.** The learning leg never silently rewrites a
   guard or `CLAUDE.md`. It proposes; the human approves. Review stays up the
   stack.
5. **Safety valves everywhere.** Evidence self-downgrades to advisory after 3
   identical blocks so the agent is never trapped; every Stop hook honors the
   `stop_hook_active` re-entry flag.
6. **Cheap and local.** Pure Bash + Bun. No daemon, no service, no API key, no
   network. Each hook is `<200ms` and fails open on any error.

---

## At a glance — the moving parts

```
.claude/
├── settings.json              ← wires every hook to its event
├── hooks/
│   ├── _lib.sh                ← shared helpers + the accumulator substrate
│   ├── prompt-context.sh      ← UserPromptSubmit: inject rules + hot gotcha
│   ├── session-start.sh       ← SessionStart: repo context after compaction
│   ├── guard-write.sh         ← PreToolUse(Write|Edit): the write wall
│   ├── guard-bash.sh          ← PreToolUse(Bash): destructive-command wall
│   ├── format-file.sh         ← PostToolUse: biome --write
│   ├── lint-file.sh           ← PostToolUse: biome lint, feed back
│   ├── arch-gate.sh           ← PostToolUse: architecture debt ratchet
│   ├── track-mcp.sh           ← PostToolUse(mcp__*): stamp serena/qdrant use
│   ├── check-boundaries.sh    ← Stop: dep-boundary + evidence gate
│   └── session-end.sh         ← SessionEnd: auto-retro + window reset
├── .hookstate/                ← gitignored runtime state
│   ├── counters/              ← the measure substrate
│   ├── evidence.json          ← the green-tree stamp
│   ├── harness-patterns.jsonl ← cross-session promotion ledger
│   ├── serena / qdrant        ← last-use timestamps (cadence)
│   └── harness-patterns…      ←
└── skills/harness-retro/      ← the human-invoked retro skill

scripts/
├── arch-gate.ts               ← debt counter + one-way ratchet
├── arch-gate.rules.json       ← detection patterns (data, not code)
├── evidence.ts                ← un-fakeable "done must compile" gate
└── retro.ts                   ← the transcript miner + ledger
```

---

<div align="center">

**Built by [@DKeken](https://github.com/DKeken) · AGONTS**

*Read the [full manual →](docs/HARNESS.en.md) · Полное руководство → [`docs/HARNESS.ru.md`](docs/HARNESS.ru.md)*

</div>
