#!/usr/bin/env bun
/**
 * arch-gate — the architecture ratchet.
 *
 * Every rule that can be checked mechanically is a rule in
 * `arch-gate.rules.json`. This runner counts violations and enforces a one-way
 * ratchet against `arch-baseline.json`:
 *
 *   count > baseline  -> FAIL  (new debt — fix it or it does not merge)
 *   count < baseline  -> PASS  (+ reminder to run --update and lock the gain)
 *   count = baseline  -> PASS
 *
 * This is how a repo converges on its target architecture with no big-bang
 * rewrite: existing debt is grandfathered, NEW debt is impossible, every cleanup
 * lowers a number that can never climb back.
 *
 * Detection patterns live in the JSON (not here) on purpose: the runner stays
 * free of the very literals it hunts, so it never matches its own source and
 * the write-hook never blocks it.
 *
 * Usage:
 *   bun scripts/arch-gate.ts             gate against baseline (CI mode)
 *   bun scripts/arch-gate.ts --list      print every violation (file:line)
 *   bun scripts/arch-gate.ts --list=ID   print violations for one rule only
 *   bun scripts/arch-gate.ts --update    re-freeze baseline (after paying debt)
 *   bun scripts/arch-gate.ts --file=PATH gate a single file (hook mode)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Glob } from "bun";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const RULES_PATH = `${ROOT}/scripts/arch-gate.rules.json`;
const BASELINE_PATH = `${ROOT}/arch-baseline.json`;

const EXCLUDE_DIRS =
  /(^|\/)(node_modules|dist|build|\.next|storybook-static|coverage|\.turbo|\.nx)(\/|$)/;
const IS_GENERATED = /\.(generated|gen)\.[tj]sx?$|\/migrations\//;

interface RawRule {
  id: string;
  rule: string;
  scope: string[];
  keepPath?: string;
  skipPath?: string;
  line?: string;
  kind?: string;
}
interface RulesFile {
  scopes: Record<string, string>;
  rules: RawRule[];
}
interface Rule {
  id: string;
  rule: string;
  scopes: string[];
  keep?: RegExp;
  skip?: RegExp;
  line?: RegExp;
  kind?: string;
}
interface Violation {
  file: string;
  line: number;
  text: string;
}
interface SourceFile {
  path: string;
  lines: string[];
}

function readRulesFile(): RulesFile {
  return JSON.parse(readFileSync(RULES_PATH, "utf8"));
}

function loadRules(): Rule[] {
  const data = readRulesFile();
  return data.rules.map((r) => ({
    id: r.id,
    rule: r.rule,
    scopes: r.scope.map((s) => data.scopes[s] ?? s),
    keep: r.keepPath ? new RegExp(r.keepPath) : undefined,
    skip: r.skipPath ? new RegExp(r.skipPath) : undefined,
    line: r.line ? new RegExp(r.line) : undefined,
    kind: r.kind,
  }));
}

function collectFiles(): SourceFile[] {
  const glob = new Glob("{apps,packages,scripts,tools,src}/**/*.{ts,tsx}");
  const out: SourceFile[] = [];
  for (const rel of glob.scanSync({ cwd: ROOT, onlyFiles: true })) {
    if (EXCLUDE_DIRS.test(rel) || IS_GENERATED.test(rel)) continue;
    const content = readFileSync(`${ROOT}/${rel}`, "utf8");
    out.push({ path: rel, lines: content.split("\n") });
  }
  return out;
}

function inScope(path: string, rule: Rule): boolean {
  if (!rule.scopes.some((s) => path.startsWith(s))) return false;
  if (rule.keep && !rule.keep.test(path)) return false;
  if (rule.skip?.test(path)) return false;
  return true;
}

function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function lineViolations(files: SourceFile[], rule: Rule): Violation[] {
  const re = rule.line;
  if (!re) return [];
  const found: Violation[] = [];
  for (const f of files) {
    f.lines.forEach((l, i) => {
      if (isCommentLine(l)) return;
      if (re.test(l)) found.push({ file: f.path, line: i + 1, text: l.trim().slice(0, 120) });
    });
  }
  return found;
}

function multiClassViolations(files: SourceFile[]): Violation[] {
  const decl = /^export (default )?(abstract )?class /;
  const found: Violation[] = [];
  for (const f of files) {
    const idxs: number[] = [];
    f.lines.forEach((l, i) => {
      if (decl.test(l)) idxs.push(i);
    });
    for (const i of idxs.slice(1))
      found.push({ file: f.path, line: i + 1, text: f.lines[i].trim() });
  }
  return found;
}

function dupSymbolViolations(files: SourceFile[]): Violation[] {
  // Distinctive names only (>=6 chars) — generic locals like row/now/hit are
  // not the DRY target; a copied joinUrl/extractPdfText/assertUrl is.
  const def = /^(export )?(async )?function ([a-zA-Z_]\w{5,})/;
  const byName = new Map<string, { file: string; line: number }[]>();
  for (const f of files) {
    f.lines.forEach((l, i) => {
      const m = def.exec(l);
      if (!m) return;
      const arr = byName.get(m[3]) ?? [];
      arr.push({ file: f.path, line: i + 1 });
      byName.set(m[3], arr);
    });
  }
  const found: Violation[] = [];
  for (const [name, defs] of byName) {
    if (new Set(defs.map((d) => d.file)).size < 2) continue;
    for (const d of defs) found.push({ file: d.file, line: d.line, text: `function ${name}` });
  }
  return found;
}

function violationsFor(rule: Rule, scoped: SourceFile[]): Violation[] {
  if (rule.kind === "multi-class") return multiClassViolations(scoped);
  if (rule.kind === "dup-symbol") return dupSymbolViolations(scoped);
  return lineViolations(scoped, rule);
}

function runAll(): Map<string, Violation[]> {
  const rules = loadRules();
  const allFiles = collectFiles();
  const results = new Map<string, Violation[]>();
  for (const rule of rules) {
    const scoped = allFiles.filter((f) => inScope(f.path, rule));
    results.set(rule.id, violationsFor(rule, scoped));
  }
  return results;
}

function ruleStatements(): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of readRulesFile().rules) m.set(r.id, r.rule);
  return m;
}

function loadBaseline(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function pad(n: number): string {
  return n.toString().padStart(5);
}

function trendMark(now: number, base: number): string {
  if (now > base) return "✖";
  if (now < base) return "↓";
  return "·";
}

function runUpdate(results: Map<string, Violation[]>): void {
  const baseline: Record<string, number> = {};
  for (const [id, v] of results) baseline[id] = v.length;
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  process.stdout.write("arch-baseline.json updated:\n");
  for (const [id, count] of Object.entries(baseline)) {
    process.stdout.write(`  ${pad(count)}  ${id}\n`);
  }
}

function runList(results: Map<string, Violation[]>, only: string | null): void {
  const statements = ruleStatements();
  for (const [id, v] of results) {
    if (only && id !== only) continue;
    process.stdout.write(`\n━━ ${id} (${v.length}) ━━\n${statements.get(id) ?? ""}\n`);
    const cap = only ? v.length : 25;
    for (const item of v.slice(0, cap)) {
      process.stdout.write(`  ${item.file}:${item.line}  ${item.text}\n`);
    }
    if (!only && v.length > 25)
      process.stdout.write(`  … ${v.length - 25} more (run --list=${id})\n`);
  }
}

function runFileGate(results: Map<string, Violation[]>, target: string): void {
  const rel = target.replace(`${ROOT}/`, "");
  const statements = ruleStatements();
  let failed = false;
  for (const [id, v] of results) {
    const hits = v.filter((x) => x.file === rel || rel.endsWith(x.file));
    if (hits.length === 0) continue;
    failed = true;
    for (const item of hits) {
      process.stderr.write(`✖ ${id}: ${item.file}:${item.line}  ${item.text}\n`);
    }
    process.stderr.write(`  rule: ${statements.get(id) ?? ""}\n\n`);
  }
  if (failed) {
    process.stderr.write("arch-gate: this file introduces architecture debt (see above).\n");
    process.exit(2);
  }
}

function runGate(results: Map<string, Violation[]>): void {
  const baseline = loadBaseline();
  let failed = false;
  let improved = false;
  const rows: string[] = [];
  for (const [id, v] of results) {
    const base = baseline[id] ?? 0;
    const now = v.length;
    if (now > base) failed = true;
    if (now < base) improved = true;
    rows.push(`  ${trendMark(now, base)} ${pad(now)} / ${pad(base)}  ${id}`);
  }
  process.stdout.write("arch-gate  (now / baseline)\n");
  process.stdout.write(`${rows.join("\n")}\n`);
  if (failed) {
    process.stderr.write(
      "\n✖ arch-gate FAILED — a debt count rose above baseline. Fix it, or it does not merge.\n",
    );
    process.stderr.write("  Run `bun scripts/arch-gate.ts --list` to see exactly what.\n");
    process.exit(1);
  }
  const ok = "\n· arch-gate OK — no new debt.\n";
  const paid =
    "\n↓ debt fell below baseline — run `bun scripts/arch-gate.ts --update` to lock the gain.\n";
  process.stdout.write(improved ? paid : ok);
}

function main(): void {
  const args = process.argv.slice(2);
  const listArg = args.find((a) => a.startsWith("--list"));
  const fileArg = args.find((a) => a.startsWith("--file="));
  const results = runAll();

  if (args.includes("--update")) {
    runUpdate(results);
    return;
  }
  if (listArg) {
    runList(results, listArg.includes("=") ? listArg.split("=")[1] : null);
    return;
  }
  if (fileArg) {
    runFileGate(results, fileArg.split("=")[1]);
    return;
  }
  runGate(results);
}

main();
