---
name: harness-retro
description: "Mine the current Claude Code session for self-improvement signals — doom-loops (same tool call 3x+), grep-before-index, hot guards (rule unclear, fix the root), dead guards (never fire, may be noise). USE WHEN the user asks for a retro / session review, or a guard keeps misfiring. Runs scripts/retro.ts; with intent to persist, writes a memory card. Never auto-edits guards — proposes, human approves."
---

# Skill: Harness Retro

The "measure / fix-the-harness" leg of the self-improving harness. Distilled
from the principle that *every failure is a harness bug, not a code bug.*

## When to run

- End of a non-trivial session, before clearing context.
- A guard/hook fired repeatedly or misfired (false positive).
- The user asks for a retro / session review.

## How

1. `bun scripts/retro.ts` — print the report for the newest session transcript.
   - `--file=PATH.jsonl` to target a specific transcript.
   - `--write` to also write a `harness_retro_<date>.md` memory card + index line.
   - `--reset-counters` to zero `.claude/.hookstate/counters` and start fresh.
2. Read the findings:
   - **doom-loop** — the agent repeated an identical tool call 3x+. Ask: should a
     hook have caught this sooner? If yes, that is the harness bug to fix.
   - **hot-guard** — a guard fired many times. The rule is unclear or the workflow
     fights it. Fix the ROOT (the rule wording, or the ergonomics), not the symptom.
   - **dead-guard** — a guard never fired this window. Over several windows, a
     truly-dead guard is noise; propose removing it (delete what does not earn its place).
   - **grep-before-index** — the index was skipped. Reinforce index-first search.
3. Act on the highest-signal finding. If it implies a guard change, make it and
   verify both directions (real violation still blocks, false positive now passes).
4. NEVER let retro silently auto-mutate a guard. Propose the change; the human
   stays up the stack and approves.

## The doctrine

The accumulators (`.claude/.hookstate/counters`, bumped by `hook_fail` and the
grep-before-index check) are the always-on substrate. Retro turns that raw
signal into a decision. Pair with the evidence Stop-gate (`scripts/evidence.ts`):
evidence proves the turn compiled, retro proves the harness itself is improving.
