#!/usr/bin/env bun
/**
 * evidence — the Stop-time "prove it" gate.
 *
 * An agent cannot end a turn claiming success while the project does not
 * typecheck. "Done" must mean "proven done", and the proof is re-derived from
 * the actual tree so it cannot be forged by touching a marker file.
 *
 * Doctrine (a one-way ratchet):
 *   first run            -> grandfather current error count as the baseline
 *   errors  > baseline   -> BLOCK the Stop (net-new breakage from this turn)
 *   errors <= baseline   -> PASS (and if < baseline, lower the floor, lock the gain)
 *
 * Pre-existing typecheck debt is grandfathered; NET-NEW debt cannot ship. The
 * tree hash (changed .ts/.tsx content) keys the stamp, so a green result is
 * skipped on the next Stop unless code changed again — the expensive typecheck
 * only runs when it can tell you something new.
 *
 * Safety valve: if the identical broken tree blocks 3x with no edit progress,
 * downgrade to advisory so the agent is never hard-trapped.
 *
 * Configure the typecheck command via the HARNESS_TYPECHECK_CMD env var
 * (default: "bun run typecheck"). Examples: "tsc --build", "nx run-many -t
 * typecheck", "turbo run typecheck".
 *
 * Usage:
 *   bun scripts/evidence.ts            gate (Stop hook mode; exit 2 = block)
 *   bun scripts/evidence.ts --status   print the current evidence stamp
 *   bun scripts/evidence.ts --reset    re-baseline against the current tree
 *   bun scripts/evidence.ts --self-test detect changed files + hash, no typecheck
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const STAMP_PATH = `${ROOT}/.claude/.hookstate/evidence.json`;
const TYPECHECK_CMD = process.env.HARNESS_TYPECHECK_CMD ?? "bun run typecheck";
const MAX_BLOCKS = 3;
const TYPECHECK_TIMEOUT_S = 180;
const IS_TEST_OR_GEN = /\.(test|generated|gen)\.[tj]sx?$|\.d\.ts$|\/migrations\//;

interface Stamp {
  treeHash: string;
  status: "green" | "blocked";
  baselineErrors: number;
  blockCount: number;
  ts: number;
}

function sh(cmd: string): { out: string; code: number } {
  const p = Bun.spawnSync({ cmd: ["bash", "-lc", cmd], cwd: ROOT });
  const out = `${p.stdout.toString()}${p.stderr.toString()}`;
  return { out, code: p.exitCode ?? 0 };
}

function changedTsFiles(): string[] {
  const tracked = sh("git diff --name-only HEAD -- '*.ts' '*.tsx' 2>/dev/null");
  const untracked = sh("git ls-files --others --exclude-standard -- '*.ts' '*.tsx' 2>/dev/null");
  const all = `${tracked.out}\n${untracked.out}`
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !IS_TEST_OR_GEN.test(l));
  return [...new Set(all)];
}

function treeHashOf(files: string[]): string {
  const h = createHash("sha256");
  for (const rel of files.sort()) {
    h.update(rel);
    h.update("\0");
    try {
      h.update(readFileSync(`${ROOT}/${rel}`));
    } catch {
      h.update("<missing>");
    }
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

function loadStamp(): Stamp | null {
  try {
    return JSON.parse(readFileSync(STAMP_PATH, "utf8")) as Stamp;
  } catch {
    return null;
  }
}

function saveStamp(s: Stamp): void {
  mkdirSync(`${ROOT}/.claude/.hookstate`, { recursive: true });
  writeFileSync(STAMP_PATH, `${JSON.stringify(s, null, 2)}\n`);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function runTypecheck(): { errors: number; sample: string } {
  const { out } = sh(`timeout ${TYPECHECK_TIMEOUT_S} ${TYPECHECK_CMD} 2>&1`);
  const errLines = out.split("\n").filter((l) => /error TS\d|: error:/.test(l));
  return { errors: errLines.length, sample: errLines.slice(0, 12).join("\n") };
}

function emitStatus(): void {
  const s = loadStamp();
  process.stdout.write(s ? `${JSON.stringify(s, null, 2)}\n` : "no evidence stamp yet\n");
}

function emitSelfTest(): void {
  const files = changedTsFiles();
  process.stdout.write(`changed src .ts/.tsx (${files.length}):\n`);
  for (const f of files) process.stdout.write(`  ${f}\n`);
  process.stdout.write(`treeHash: ${files.length ? treeHashOf(files) : "(none)"}\n`);
}

function reset(): void {
  const files = changedTsFiles();
  const { errors } = runTypecheck();
  saveStamp({
    treeHash: files.length ? treeHashOf(files) : "clean",
    status: "green",
    baselineErrors: errors,
    blockCount: 0,
    ts: nowSec(),
  });
  process.stdout.write(
    `evidence baseline reset: ${errors} pre-existing typecheck error(s) grandfathered.\n`,
  );
}

function gate(): void {
  const files = changedTsFiles();
  if (files.length === 0) process.exit(0); // nothing changed -> nothing to prove

  const hash = treeHashOf(files);
  const prev = loadStamp();

  if (prev && prev.treeHash === hash && prev.status === "green") process.exit(0); // already proven

  const { errors, sample } = runTypecheck();
  const baseline = prev?.baselineErrors ?? errors; // first run grandfathers current state

  if (errors <= baseline) {
    saveStamp({
      treeHash: hash,
      status: "green",
      baselineErrors: errors,
      blockCount: 0,
      ts: nowSec(),
    });
    process.exit(0);
  }

  // net-new errors. safety valve: identical broken tree blocked too many times.
  const sameTreeBlocks = prev && prev.treeHash === hash ? prev.blockCount : 0;
  if (sameTreeBlocks >= MAX_BLOCKS) {
    saveStamp({
      treeHash: hash,
      status: "green",
      baselineErrors: errors,
      blockCount: 0,
      ts: nowSec(),
    });
    process.stderr.write(
      `EVIDENCE (advisory after ${MAX_BLOCKS} blocks — not trapping you): ${errors - baseline} net-new typecheck error(s) remain. Fix before merge:\n${sample}\n`,
    );
    process.exit(0);
  }

  saveStamp({
    treeHash: hash,
    status: "blocked",
    baselineErrors: baseline,
    blockCount: sameTreeBlocks + 1,
    ts: nowSec(),
  });
  process.stderr.write(
    `EVIDENCE gate: your edits added ${errors - baseline} typecheck error(s) above baseline (${baseline}). "Done" must compile — fix these or revert:\n${sample}\n`,
  );
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--status")) {
    emitStatus();
    return;
  }
  if (args.includes("--self-test")) {
    emitSelfTest();
    return;
  }
  if (args.includes("--reset")) {
    reset();
    return;
  }
  gate();
}

main();
