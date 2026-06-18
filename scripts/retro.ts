#!/usr/bin/env bun
/**
 * retro — the self-improving loop. "Every failure is a harness bug."
 *
 * Mines the session transcript JSONL + the .hookstate/counters accumulators and
 * writes a retrospective the next session can learn from. It never auto-edits a
 * guard — it PROPOSES, the human approves (review stays up the stack).
 *
 * Signals:
 *   doom-loop          same tool_use (name + input) >= 3x -> the agent spun its
 *                      wheels; the harness should have caught it sooner.
 *   grep-before-serena Bash grep/rg fired while the index was stale (counter
 *                      from guard-bash.sh) -> the index was skipped.
 *   hot guard          a guard:* counter fired a lot -> the rule is unclear or
 *                      the workflow fights it; fix the ROOT, not the symptom.
 *   dead guard         a known guard label that never fires -> may be noise;
 *                      propose review (delete what doesn't earn its place).
 *
 * Usage:
 *   bun scripts/retro.ts                   mine newest transcript, print report
 *   bun scripts/retro.ts --write           also write a memory card + MEMORY.md line
 *   bun scripts/retro.ts --file=PATH.jsonl mine a specific transcript
 *   bun scripts/retro.ts --reset-counters  zero the accumulators (fresh window)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const HOME = process.env.HOME ?? "";
// Claude Code encodes a session's starting cwd into the transcript dir name by
// turning every non-alphanumeric char into "-". Derive it from ROOT so this
// works in any repo without a hardcoded path.
const PROJECT_SLUG = ROOT.replace(/[^A-Za-z0-9]/g, "-");
const TRANSCRIPT_DIR = `${HOME}/.claude/projects/${PROJECT_SLUG}`;
const MEMORY_DIR = `${TRANSCRIPT_DIR}/memory`;
const COUNTERS_DIR = `${ROOT}/.claude/.hookstate/counters`;
const LEDGER_PATH = `${ROOT}/.claude/.hookstate/harness-patterns.jsonl`;
const DOOM_THRESHOLD = 3;
const HOT_GUARD_THRESHOLD = 5;
const PROMOTE_THRESHOLD = 3;

interface ToolCall {
  name: string;
  inputKey: string;
}
interface Finding {
  kind: string;
  detail: string;
}
interface RawPart {
  type?: string;
  name?: string;
  input?: unknown;
}
interface RawMessage {
  content?: unknown;
}
interface RawLine {
  message?: RawMessage;
}

function newestTranscript(): string | null {
  let files: string[];
  try {
    files = readdirSync(TRANSCRIPT_DIR).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  let best: { path: string; mtime: number } | null = null;
  for (const f of files) {
    const path = `${TRANSCRIPT_DIR}/${f}`;
    const mtime = Bun.file(path).lastModified;
    if (!best || mtime > best.mtime) best = { path, mtime };
  }
  return best === null ? null : best.path;
}

function parseToolCalls(transcript: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const line of readFileSync(transcript, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let obj: RawLine;
    try {
      obj = JSON.parse(line) as RawLine;
    } catch {
      continue;
    }
    const content = obj.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as RawPart[]) {
      if (part.type !== "tool_use" || !part.name) continue;
      const inputKey = JSON.stringify(part.input ?? {}).slice(0, 200);
      calls.push({ name: part.name, inputKey });
    }
  }
  return calls;
}

function detectDoomLoops(calls: ToolCall[]): Finding[] {
  const seen = new Map<string, number>();
  for (const c of calls) {
    const key = `${c.name}::${c.inputKey}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const out: Finding[] = [];
  for (const [key, n] of seen) {
    if (n < DOOM_THRESHOLD) continue;
    const parts = key.split("::");
    const arg = (parts[1] ?? "").slice(0, 80);
    out.push({
      kind: "doom-loop",
      detail: `${n}x identical call: ${parts[0]} ${arg}`,
    });
  }
  return out;
}

function readCounters(): Map<string, number> {
  const m = new Map<string, number>();
  if (!existsSync(COUNTERS_DIR)) return m;
  for (const f of readdirSync(COUNTERS_DIR)) {
    const raw = readFileSync(`${COUNTERS_DIR}/${f}`, "utf8").trim();
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) m.set(f, n);
  }
  return m;
}

function knownGuardLabels(): string[] {
  // hook labels that call hook_fail -> the guards we can measure dead/hot on.
  return ["write", "bash", "arch-gate"];
}

function detectGuardSignals(counters: Map<string, number>): Finding[] {
  const out: Finding[] = [];
  for (const [key, n] of counters) {
    if (key.startsWith("guard:") && n >= HOT_GUARD_THRESHOLD) {
      out.push({
        kind: "hot-guard",
        detail: `${key} fired ${n}x — rule unclear or workflow fights it; fix the root, not the symptom.`,
      });
    }
    if (key === "search:grep-before-serena" && n > 0) {
      out.push({
        kind: "grep-before-serena",
        detail: `grep/rg used ${n}x while the index was stale — index skipped.`,
      });
    }
  }
  for (const label of knownGuardLabels()) {
    const fired = [...counters].some(([k, n]) => k.startsWith(`guard:${label}`) && n > 0);
    if (!fired) {
      out.push({
        kind: "dead-guard",
        detail: `guard '${label}' never fired this window — confirm it still earns its place.`,
      });
    }
  }
  return out;
}

interface Promotion {
  pattern: string;
  sessions: number;
}

// Cross-session promotion ledger. Counters reset every session; this JSONL does
// NOT — it tracks how many DISTINCT sessions each finding recurred in. At
// PROMOTE_THRESHOLD it flags the pattern for elevation to a rule card. Proposes
// only — never edits rules itself. Returns patterns that crossed the threshold.
function updateLedger(findings: Finding[]): Promotion[] {
  interface Row {
    pattern: string;
    sessions: number;
    promoted: boolean;
  }
  const rows = new Map<string, Row>();
  if (existsSync(LEDGER_PATH)) {
    for (const line of readFileSync(LEDGER_PATH, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as Row;
        rows.set(r.pattern, r);
      } catch {
        // skip malformed ledger line
      }
    }
  }
  const seenThisRun = new Set<string>();
  const fresh: Promotion[] = [];
  for (const f of findings) {
    const pattern = `${f.kind}: ${f.detail}`;
    if (seenThisRun.has(pattern)) continue;
    seenThisRun.add(pattern);
    const row = rows.get(pattern) ?? { pattern, sessions: 0, promoted: false };
    row.sessions += 1;
    if (row.sessions >= PROMOTE_THRESHOLD && !row.promoted) {
      row.promoted = true;
      fresh.push({ pattern, sessions: row.sessions });
    }
    rows.set(pattern, row);
  }
  const body = [...rows.values()].map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(LEDGER_PATH, body === "" ? "" : `${body}\n`);
  return fresh;
}

function render(
  findings: Finding[],
  counters: Map<string, number>,
  transcript: string,
  promotions: Promotion[],
): string {
  const date = new Date(Date.now()).toISOString().slice(0, 10);
  const byKind = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = byKind.get(f.kind) ?? [];
    arr.push(f);
    byKind.set(f.kind, arr);
  }
  const lines: string[] = [
    `harness retro ${date}`,
    `transcript: ${transcript.replace(`${HOME}/`, "~/")}`,
    "",
  ];
  if (findings.length === 0) {
    lines.push("no doom-loops, hot/dead guards, or grep-before-serena this window. clean run.");
  }
  for (const [kind, items] of byKind) {
    lines.push(`## ${kind} (${items.length})`);
    for (const it of items) lines.push(`  - ${it.detail}`);
    lines.push("");
  }
  const top = [...counters].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) {
    lines.push("## accumulator counters (top)");
    for (const [k, n] of top) lines.push(`  ${String(n).padStart(4)}  ${k}`);
  }
  if (promotions.length) {
    lines.push("");
    lines.push(`## PROMOTE (recurred across ${PROMOTE_THRESHOLD}+ sessions)`);
    for (const p of promotions) {
      lines.push(`  - [${p.sessions}x] ${p.pattern}`);
    }
    lines.push("  -> elevate to a rule card or fix the root. Proposed, not auto-applied.");
  }
  return lines.join("\n");
}

function writeMemoryCard(report: string): void {
  const date = new Date(Date.now()).toISOString().slice(0, 10);
  const name = `harness_retro_${date}`;
  const file = `${MEMORY_DIR}/${name}.md`;
  mkdirSync(MEMORY_DIR, { recursive: true });
  const card = `---
name: ${name}
description: harness retro ${date} — doom-loops, hot/dead guards, grep-before-serena from session mining
metadata:
  type: feedback
---

${report}
`;
  writeFileSync(file, card);
  const indexPath = `${MEMORY_DIR}/MEMORY.md`;
  const indexLine = `- [Harness retro ${date}](${name}.md) — self-mined doom-loops + guard heat from the session transcript`;
  const idx = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  if (!idx.includes(`${name}.md`)) {
    let next = idx;
    if (next !== "" && !next.endsWith("\n")) next += "\n";
    next += `${indexLine}\n`;
    writeFileSync(indexPath, next);
  }
  process.stdout.write(`\nwrote ${file.replace(`${HOME}/`, "~/")} + MEMORY.md line.\n`);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--reset-counters")) {
    rmSync(COUNTERS_DIR, { recursive: true, force: true });
    process.stdout.write("accumulator counters reset.\n");
    return;
  }
  const fileArg = args.find((a) => a.startsWith("--file="));
  const transcript = fileArg ? fileArg.split("=")[1] : newestTranscript();
  if (!transcript || !existsSync(transcript)) {
    process.stderr.write("no transcript found.\n");
    process.exit(1);
  }
  const calls = parseToolCalls(transcript);
  const counters = readCounters();
  const findings = [...detectDoomLoops(calls), ...detectGuardSignals(counters)];
  const promotions = updateLedger(findings);
  const report = render(findings, counters, transcript, promotions);
  process.stdout.write(`${report}\n`);
  // skip empty cards: only persist when there is real signal.
  if (args.includes("--write") && (findings.length > 0 || promotions.length > 0))
    writeMemoryCard(report);
}

main();
