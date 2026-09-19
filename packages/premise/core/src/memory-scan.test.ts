/**
 * Tests for #native-memory-scan (Memory Steward A0).
 *
 * These NEVER touch the real ~/.claude. We override HOME (which os.homedir()
 * honors on POSIX) to a temp home so resolveMemoryDir() points into a sandbox,
 * and we build a throwaway project root with real `.purpose` files so
 * loadLiveGraph() sees genuine live symbols — the same live-parse fixture style
 * as graph-slice.test.ts.
 *
 * Coverage: slug resolution, symbol/file mention extraction, index vs entry
 * kinds, valid / provably-stale / partly-stale verdicts, malformed-frontmatter
 * fail-open, and missing-dir fail-open.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  scanNativeMemory,
  resolveMemorySlug,
  resolveMemoryDir,
  extractSymbolMentions,
  extractFileMentions,
} from './memory-scan.js';

// ── Sandbox ────────────────────────────────────────────────
let tmpRoot: string; // the fake project root
let tmpHome: string; // the fake HOME (native-memory lives under here)
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-scan-root-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-scan-home-'));
  origHome = process.env.HOME;
  origUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome; // Windows parity, harmless on POSIX
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserProfile;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// ── Fixture helpers ────────────────────────────────────────

/** Write a `.purpose` declaring components so loadLiveGraph sees live symbols. */
function writePurpose(componentIds: string[]): void {
  const dir = path.join(tmpRoot, 'pkg');
  fs.mkdirSync(dir, { recursive: true });
  const lines = ['purpose: fixture', 'version: 2.0.0', ''];
  for (const id of componentIds) {
    lines.push(`#${id}:`);
    lines.push(`  description: "fixture ${id}"`);
    lines.push('');
  }
  fs.writeFileSync(path.join(dir, '.purpose'), lines.join('\n'), 'utf-8');
}

/** Write a native-memory file (index or entry) into the sandboxed HOME. */
function writeMemoryFile(filename: string, content: string): string {
  const dir = resolveMemoryDir(tmpRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

function frontmatter(name: string, description: string, type: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\ntype: ${type}\n---\n\n${body}\n`;
}

// ── Slug / path resolution ─────────────────────────────────

describe('resolveMemorySlug', () => {
  it('replaces every path separator with a dash', () => {
    expect(resolveMemorySlug('/Users/ascend/Documents/GitHub/a-paradigm')).toBe(
      '-Users-ascend-Documents-GitHub-a-paradigm',
    );
  });

  it('resolves a relative path to absolute before slugifying', () => {
    const slug = resolveMemorySlug('.');
    expect(slug.startsWith('-')).toBe(true);
    expect(slug).not.toContain('/');
  });
});

describe('resolveMemoryDir', () => {
  it('points under HOME/.claude/projects/<slug>/memory', () => {
    const dir = resolveMemoryDir(tmpRoot);
    expect(dir).toBe(
      path.join(tmpHome, '.claude', 'projects', resolveMemorySlug(tmpRoot), 'memory'),
    );
  });
});

// ── Mention extraction (pure) ──────────────────────────────

describe('extractSymbolMentions', () => {
  it('captures validated symbols and dedupes, ignoring markdown headings', () => {
    const text = '## Heading here\nUses #login-handler and ^authenticated and #login-handler again. $$checkout-flow too.';
    const mentions = extractSymbolMentions(text);
    expect(mentions).toContain('#login-handler');
    expect(mentions).toContain('^authenticated');
    // deduped
    expect(mentions.filter((m) => m === '#login-handler')).toHaveLength(1);
    // "## Heading" must not produce a "#" symbol
    expect(mentions).not.toContain('#');
  });
});

describe('extractFileMentions', () => {
  it('captures backtick-wrapped and bare paths, skips URLs', () => {
    const text =
      'See `packages/paradigm/src/index.ts` and src/core/memory/score.ts but not https://example.com/x.html';
    const mentions = extractFileMentions(text);
    expect(mentions).toContain('packages/paradigm/src/index.ts');
    expect(mentions).toContain('src/core/memory/score.ts');
    expect(mentions.some((m) => m.includes('example.com'))).toBe(false);
  });
});

// ── Scan: kinds + verdicts + fail-open ─────────────────────

describe('scanNativeMemory', () => {
  it('returns [] when the memory dir is missing (fail-open)', async () => {
    const entries = await scanNativeMemory(tmpRoot);
    expect(entries).toEqual([]);
  });

  it('distinguishes index (MEMORY.md) from entry kinds, index first', async () => {
    writePurpose(['live-comp']);
    writeMemoryFile('MEMORY.md', '# Project Memory\n\nSome overview.\n');
    writeMemoryFile(
      'feedback_tip.md',
      frontmatter('A tip', 'do the thing', 'feedback', 'body text'),
    );

    const entries = await scanNativeMemory(tmpRoot);
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe('index');
    expect(path.basename(entries[0].file)).toBe('MEMORY.md');
    expect(entries[1].kind).toBe('entry');
    expect(entries[1].type).toBe('feedback');
    expect(entries[1].name).toBe('A tip');
    expect(entries[1].mtimeMs).toBeGreaterThan(0);
  });

  it('classifies a valid entry (all mentions resolve)', async () => {
    writePurpose(['live-comp']);
    // create a file the entry cites so it is NOT dead
    const cited = 'docs/note.md';
    fs.mkdirSync(path.join(tmpRoot, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, cited), '# note', 'utf-8');

    writeMemoryFile(
      'ref_live.md',
      frontmatter('Live ref', 'points at real things', 'reference', `Look at #live-comp and \`${cited}\`.`),
    );

    const entries = await scanNativeMemory(tmpRoot);
    const e = entries.find((x) => path.basename(x.file) === 'ref_live.md')!;
    expect(e.symbolMentions).toContain('#live-comp');
    expect(e.fileMentions).toContain(cited);
    expect(e.graphValidity.deadSymbols).toEqual([]);
    expect(e.graphValidity.deadFiles).toEqual([]);
    expect(e.graphValidity.verdict).toBe('valid');
  });

  it('classifies a provably-stale entry (dead symbol + dead file)', async () => {
    writePurpose(['live-comp']);
    writeMemoryFile(
      'proj_stale.md',
      frontmatter('Stale', 'points at gone things', 'project', 'Ref #ghost-comp and `src/gone/missing.ts`.'),
    );

    const entries = await scanNativeMemory(tmpRoot);
    const e = entries.find((x) => path.basename(x.file) === 'proj_stale.md')!;
    expect(e.graphValidity.deadSymbols).toContain('#ghost-comp');
    expect(e.graphValidity.deadFiles).toContain('src/gone/missing.ts');
    expect(e.graphValidity.verdict).toBe('provably-stale');
  });

  it('classifies a partly-stale entry (one live, one dead)', async () => {
    writePurpose(['live-comp']);
    writeMemoryFile(
      'proj_partly.md',
      frontmatter('Partly', 'mix', 'project', 'Ref #live-comp AND #ghost-comp.'),
    );

    const entries = await scanNativeMemory(tmpRoot);
    const e = entries.find((x) => path.basename(x.file) === 'proj_partly.md')!;
    expect(e.graphValidity.deadSymbols).toEqual(['#ghost-comp']);
    expect(e.graphValidity.verdict).toBe('partly-stale');
  });

  // Regression: real-world false-positive. A current, valuable feedback entry
  // that cites only glob patterns and a prose-relative path (no symbols) must
  // NOT be judged provably-stale — files from prose are a soft signal only, and
  // an unresolvable file must never, on its own, mark an entry for prune.
  it('never marks a symbol-free entry provably-stale on file mentions alone', async () => {
    writePurpose(['live-comp']);
    writeMemoryFile(
      'feedback_hook_sources.md',
      frontmatter(
        'Hook scripts source of truth',
        'edit .sh then regenerate',
        'feedback',
        'Edit `packages/paradigm/src/commands/hooks/scripts/*.sh` then run `scripts/generate-hooks.mjs`; outputs land in `plugins/*/scripts/*.sh`.',
      ),
    );

    const entries = await scanNativeMemory(tmpRoot);
    const e = entries.find((x) => path.basename(x.file) === 'feedback_hook_sources.md')!;
    expect(e.symbolMentions).toEqual([]);
    expect(e.graphValidity.verdict).not.toBe('provably-stale');
  });

  it('excludes glob patterns from file mentions (cannot be existence-checked)', () => {
    const mentions = extractFileMentions('build `src/**/*.ts` and `packages/*/dist/index.js`');
    expect(mentions.some((m) => m.includes('*'))).toBe(false);
  });

  it('fails open on malformed frontmatter (keeps body, empty fields)', async () => {
    writePurpose(['live-comp']);
    const broken = '---\nname: [unterminated\n  bad: : yaml\n---\n\nreal body survives\n';
    writeMemoryFile('broken.md', broken);

    const entries = await scanNativeMemory(tmpRoot);
    const e = entries.find((x) => path.basename(x.file) === 'broken.md')!;
    expect(e).toBeDefined();
    expect(e.name).toBe(''); // frontmatter dropped
    expect(e.type).toBe('unknown');
    expect(e.body).toContain('real body survives');
  });

  it('normalizes an unrecognized type to unknown', async () => {
    writePurpose(['live-comp']);
    writeMemoryFile('weird.md', frontmatter('W', 'd', 'banana', 'body'));
    const entries = await scanNativeMemory(tmpRoot);
    const e = entries.find((x) => path.basename(x.file) === 'weird.md')!;
    expect(e.type).toBe('unknown');
  });
});
