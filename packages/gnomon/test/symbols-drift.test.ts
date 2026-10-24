/**
 * Symbol drift CI (P8-D81) — the spec's Appendix A is the symbol authority for
 * every Gnomon package.
 *
 * CONVENTION (also documented in packages/gnomon/.purpose, #gnomon-kernel):
 *   - A source module names the symbol(s) it implements in its HEADER (the
 *     first 40 lines) with one tag per line:
 *         * @symbol #kernel-log
 *     using the spec Appendix A id verbatim where the spec has one
 *     (`#kernel-log`, `$daemon-lifecycle`, `~ample-internal-logs`, …).
 *   - Every .ts file under packages/gnomon/src/kernel/** MUST carry a tag.
 *   - Elsewhere in packages/gnomon*\/src a tag is optional but, when present,
 *     is checked like any other.
 *
 * CHECKS
 *   1. Appendix A of docs/specs/gnomon.md parses to the node count its own
 *      notes state ("N symbol/flow/gate/aspect nodes").
 *   2. Every symbol DECLARED in a packages/gnomon*\/**\/.purpose file
 *      (components → #, flows → $, gates → ^, signals → !, aspects → ~) is an
 *      Appendix A node or is in test/symbol-allowlist.json with a reason.
 *   3. The allowlist holds no spec ids and no stale (undeclared) entries.
 *   4. Every `@symbol` tag in code is declared by some gnomon .purpose — code
 *      for a spec node with no .purpose entry fails.
 * The Appendix A parse mirrors .paradigm/research/paradigm-8/tools/compile71.py
 * (the `sym:` refs of the table), without re-running the compiler.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT, rel } from './helpers.js';

const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');
const PACKAGES = path.join(REPO_ROOT, 'packages');
const SPEC = path.join(REPO_ROOT, 'docs', 'specs', 'gnomon.md');
const ALLOWLIST = path.join(PKG_ROOT, 'test', 'symbol-allowlist.json');
const HEADER_LINES = 40;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.build', '.git', 'results']);

const SECTION_PREFIX: Record<string, string> = { components: '#', flows: '$', gates: '^', signals: '!', aspects: '~' };
const SYMBOL_ID = /^[#$^!~][a-z][a-z0-9-]*$/;

/** Appendix A `sym:` refs. */
export function parseAppendixA(spec: string): { nodes: Set<string>; statedCount: number | undefined } {
  const start = spec.indexOf('\n## Appendix A');
  if (start < 0) throw new Error('docs/specs/gnomon.md has no "## Appendix A" heading');
  const body = spec.slice(start);
  const nodes = new Set<string>();
  for (const m of body.matchAll(/^\|\s*`sym:([#$^!~][a-z][a-z0-9-]*)`\s*\|\s*(symbol|flow|gate|signal|aspect)\s*\|/gm)) nodes.add(m[1]!);
  const stated = /(\d+) symbol\/flow\/gate\/aspect nodes/.exec(body);
  return { nodes, statedCount: stated ? Number(stated[1]) : undefined };
}

/** Top-level symbol declarations of a .purpose file (2-space keys under a known section). */
export function parsePurposeDeclarations(text: string): string[] {
  const out: string[] = [];
  let prefix: string | undefined;
  for (const line of text.split('\n')) {
    const top = /^([a-z][a-z-]*):\s*$/.exec(line);
    if (top) {
      prefix = SECTION_PREFIX[top[1]!];
      continue;
    }
    if (/^\S/.test(line)) {
      prefix = undefined;
      continue;
    }
    const key = /^ {2}([#$^!~]?[a-z][a-z0-9-]*):\s*$/.exec(line);
    if (key && prefix) out.push(SYMBOL_ID.test(key[1]!) ? key[1]! : prefix + key[1]!);
  }
  return out;
}

/** `@symbol <id>` tags in a file's header. */
export function parseSymbolTags(text: string): string[] {
  const head = text.split('\n').slice(0, HEADER_LINES).join('\n');
  return [...head.matchAll(/@symbol\s+([#$^!~][a-z][a-z0-9-]*)/g)].map((m) => m[1]!);
}

function walk(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

const gnomonPackages = readdirSync(PACKAGES)
  .filter((n) => n === 'gnomon' || n.startsWith('gnomon-'))
  .map((n) => path.join(PACKAGES, n));

describe('P8-D81 symbol drift: parsers (self-test)', () => {
  it('parses purpose sections and tags', () => {
    const purpose = ['version: "2.0"', 'components:', '  kernel-log:', '    components:', '      - "#socket"', 'flows:', '  daemon-lifecycle:', 'aspects:', '  ~ample-internal-logs:', 'gates: {}'].join('\n');
    expect(parsePurposeDeclarations(purpose)).toEqual(['#kernel-log', '$daemon-lifecycle', '~ample-internal-logs']);
    expect(parseSymbolTags('/**\n * @symbol #kernel-log\n * @symbol ~ample-internal-logs\n */')).toEqual(['#kernel-log', '~ample-internal-logs']);
  });
});

describe('P8-D81 symbol drift: spec Appendix A vs .purpose vs code', () => {
  const spec = parseAppendixA(readFileSync(SPEC, 'utf8'));
  const allow = JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as { entries: Array<{ symbol: string; reason: string }> };
  const allowed = new Map(allow.entries.map((e) => [e.symbol, e.reason]));

  const purposeFiles = gnomonPackages.flatMap((p) => walk(p, (f) => path.basename(f) === '.purpose'));
  const declared = new Map<string, string[]>(); // symbol -> purpose files
  for (const f of purposeFiles) {
    for (const s of parsePurposeDeclarations(readFileSync(f, 'utf8'))) declared.set(s, [...(declared.get(s) ?? []), path.relative(REPO_ROOT, f)]);
  }

  it('Appendix A parses to the node count its notes state', () => {
    expect(spec.statedCount).toBeDefined();
    expect(spec.nodes.size).toBe(spec.statedCount);
    expect(spec.nodes.has('#kernel-log')).toBe(true);
  });

  it('every gnomon .purpose is found and declares something', () => {
    expect(purposeFiles.length).toBeGreaterThanOrEqual(4);
    expect(declared.size).toBeGreaterThan(0);
  });

  it('every declared symbol is a spec node or allowlisted with a reason', () => {
    const drift = [...declared.entries()]
      .filter(([s]) => !spec.nodes.has(s) && !allowed.has(s))
      .map(([s, files]) => `${s} (declared in ${files.join(', ')}) is not in spec Appendix A and not in test/symbol-allowlist.json`);
    expect(drift).toEqual([]);
  });

  it('the allowlist has reasons, no spec ids and no stale entries', () => {
    const problems: string[] = [];
    for (const e of allow.entries) {
      if (!SYMBOL_ID.test(e.symbol)) problems.push(`${e.symbol}: not a symbol id`);
      if (typeof e.reason !== 'string' || e.reason.trim().length < 10) problems.push(`${e.symbol}: needs a reason`);
      if (spec.nodes.has(e.symbol)) problems.push(`${e.symbol}: is a spec node — remove it from the allowlist`);
      if (!declared.has(e.symbol)) problems.push(`${e.symbol}: stale — no gnomon .purpose declares it`);
    }
    expect(problems).toEqual([]);
  });

  it('every @symbol tag in gnomon code is declared in a gnomon .purpose', () => {
    const missing: string[] = [];
    for (const p of gnomonPackages) {
      const src = path.join(p, 'src');
      if (!existsSync(src)) continue;
      for (const f of walk(src, (x) => /\.(m|c)?tsx?$/.test(x) && !x.endsWith('.d.ts'))) {
        for (const s of parseSymbolTags(readFileSync(f, 'utf8'))) {
          if (!declared.has(s)) missing.push(`${path.relative(REPO_ROOT, f)}: @symbol ${s} has no .purpose declaration`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every module under packages/gnomon/src/kernel/** carries an @symbol header tag', () => {
    const kernel = path.join(PKG_ROOT, 'src', 'kernel');
    const untagged = walk(kernel, (x) => /\.(m|c)?tsx?$/.test(x) && !x.endsWith('.d.ts'))
      .filter((f) => parseSymbolTags(readFileSync(f, 'utf8')).length === 0)
      .map(rel);
    expect(untagged).toEqual([]);
  });
});
