/**
 * Tests for #memory-cli (Memory Steward A2).
 *
 * NEVER touch the real ~/.claude or real .paradigm. We override HOME (which
 * os.homedir() honors on POSIX) so resolveMemoryDir points into a sandbox, and
 * build a throwaway project root with a real `.purpose` so loadLiveGraph sees
 * genuine live symbols (mirrors memory-scan.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveMemoryDir } from '@a-company/premise-core';

import {
  buildDigest,
  emitRemediations,
  reviewCommand,
  pruneCommand,
  routeCommand,
  mergeCommand,
  pinCommand,
  applyPrune,
  applyRoute,
  applyMerge,
  applyPin,
  archiveEntryFile,
  isInsideMemoryDir,
  loadPins,
  stableId,
  routeToDecisionStub,
} from './index.js';
import type { ParsedMemoryEntry } from '@a-company/premise-core';

// ── Sandbox ────────────────────────────────────────────────
let tmpRoot: string;
let tmpHome: string;
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-cli-root-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-cli-home-'));
  origHome = process.env.HOME;
  origUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  // Live graph fixture so scanNativeMemory can prove symbols dead.
  writePurpose(['real-symbol']);
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

function writeMemoryFile(filename: string, content: string): string {
  const dir = resolveMemoryDir(tmpRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

function fm(name: string, type: string, body: string, description = ''): string {
  return `---\nname: ${name}\ndescription: ${description}\ntype: ${type}\n---\n\n${body}\n`;
}

function remediationFiles(): string[] {
  const dir = path.join(tmpRoot, '.paradigm', 'remediations');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') && !f.startsWith('.'));
}

// ── security: decision-stub id collision safety ────────────

describe('routeToDecisionStub', () => {
  const stubEntry = (name: string): ParsedMemoryEntry =>
    ({
      file: path.join(resolveMemoryDir(tmpRoot), 'x.md'),
      kind: 'entry',
      name,
      description: '',
      type: 'reference',
      body: 'imported body',
      mtimeMs: Date.now(),
      symbolMentions: [],
      fileMentions: [],
      graphValidity: { deadSymbols: [], deadFiles: [], verdict: 'valid' },
    }) as ParsedMemoryEntry;

  it('never overwrites an existing same-day decision, allocates the next free id', () => {
    const dir = path.join(tmpRoot, '.paradigm', 'decisions');
    fs.mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    // A real ratified decision already occupies -001.
    const existing = path.join(dir, `TD-${date}-001.yaml`);
    fs.writeFileSync(existing, 'id: real\ndecision: DO NOT CLOBBER\n', 'utf8');

    const rel1 = routeToDecisionStub(tmpRoot, stubEntry('first'));
    const rel2 = routeToDecisionStub(tmpRoot, stubEntry('second'));

    // The pre-existing decision is untouched.
    expect(fs.readFileSync(existing, 'utf8')).toContain('DO NOT CLOBBER');
    // Two stubs land on distinct, non-colliding ids after -001.
    expect(rel1).not.toBe(rel2);
    expect(rel1).toContain(`TD-${date}-002`);
    expect(rel2).toContain(`TD-${date}-003`);
  });
});

// ── digest generation ──────────────────────────────────────

describe('buildDigest', () => {
  it('produces deterministic ids stable across re-runs', async () => {
    writeMemoryFile('feedback-note.md', fm('Feedback note', 'feedback', 'always run tests before shipping'));
    writeMemoryFile('stale.md', fm('Stale', 'project', 'this references #ghost-symbol only'));

    const a = await buildDigest(tmpRoot);
    const b = await buildDigest(tmpRoot);

    expect(a.items.length).toBeGreaterThan(0);
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
    // id must be a content-independent hash of the file path.
    for (const item of a.items) {
      expect(item.id).toBe(stableId(item.entryFile));
      expect(item.id.startsWith('mem-')).toBe(true);
    }
  });

  it('flags a provably-stale entry as prune and a feedback entry as route:habits', async () => {
    writeMemoryFile('stale.md', fm('Stale', 'project', 'only mentions #ghost-symbol'));
    writeMemoryFile('tip.md', fm('Tip', 'feedback', 'prefer small commits'));

    const digest = await buildDigest(tmpRoot);
    const byName = new Map(digest.items.map((i) => [i.name, i]));
    expect(byName.get('Stale')?.suggestion).toBe('prune');
    expect(byName.get('Stale')?.verdict).toBe('provably-stale');
    expect(byName.get('Tip')?.suggestion).toBe('route:habits');
  });

  it('never surfaces the MEMORY.md index', async () => {
    writeMemoryFile('MEMORY.md', fm('', 'unknown', 'only #ghost-symbol here'));
    const digest = await buildDigest(tmpRoot);
    expect(digest.items.find((i) => path.basename(i.entryFile) === 'MEMORY.md')).toBeUndefined();
  });
});

// ── idempotent remediation emission ────────────────────────

describe('emitRemediations', () => {
  it('is idempotent: a re-run does not duplicate remediations', async () => {
    writeMemoryFile('stale.md', fm('Stale', 'project', 'only #ghost-symbol'));
    writeMemoryFile('tip.md', fm('Tip', 'feedback', 'prefer small commits'));

    const digest = await buildDigest(tmpRoot);
    const first = await emitRemediations(tmpRoot, digest);
    const filesAfterFirst = remediationFiles().sort();
    const createdStamps = filesAfterFirst.map((f) =>
      fs.readFileSync(path.join(tmpRoot, '.paradigm', 'remediations', f), 'utf8'),
    );

    const second = await emitRemediations(tmpRoot, digest);
    const filesAfterSecond = remediationFiles().sort();

    expect(filesAfterSecond).toEqual(filesAfterFirst);
    expect(second.written).toBe(first.written);
    expect(filesAfterSecond.length).toBe(digest.items.length);
    // created stamp preserved (no churn).
    const createdStamps2 = filesAfterSecond.map((f) =>
      fs.readFileSync(path.join(tmpRoot, '.paradigm', 'remediations', f), 'utf8'),
    );
    for (let i = 0; i < createdStamps.length; i++) {
      const c1 = /created: (.*)/.exec(createdStamps[i])?.[1];
      const c2 = /created: (.*)/.exec(createdStamps2[i])?.[1];
      expect(c2).toBe(c1);
    }
  });

  it('archives remediations whose finding has resolved', async () => {
    writeMemoryFile('tip.md', fm('Tip', 'feedback', 'prefer small commits'));
    const d1 = await buildDigest(tmpRoot);
    await emitRemediations(tmpRoot, d1);
    expect(remediationFiles().length).toBe(1);

    // Empty digest → the prior remediation is archived, not left dangling.
    const cleared = await emitRemediations(tmpRoot, { root: tmpRoot, scanned: 0, pinned: 0, items: [] });
    expect(cleared.cleared).toBe(1);
    expect(remediationFiles().length).toBe(0);
  });
});

// ── apply: prune ───────────────────────────────────────────

describe('pruneCommand', () => {
  it('archives the entry and clears its remediation', async () => {
    const file = writeMemoryFile('stale.md', fm('Stale', 'project', 'only #ghost-symbol'));
    const digest = await buildDigest(tmpRoot);
    await emitRemediations(tmpRoot, digest);
    const id = stableId(file);

    await pruneCommand(id, { project: tmpRoot, json: true });

    expect(fs.existsSync(file)).toBe(false);
    const archived = path.join(resolveMemoryDir(tmpRoot), '.archived', 'stale.md');
    expect(fs.existsSync(archived)).toBe(true);
    expect(remediationFiles().length).toBe(0);
  });
});

// ── apply: route ───────────────────────────────────────────

describe('routeCommand', () => {
  it('routes to lore and archives the source', async () => {
    const file = writeMemoryFile('ref.md', fm('Durable note', 'reference', 'stable knowledge here'));
    const id = stableId(file);

    await routeCommand(id, { project: tmpRoot, to: 'lore', json: true });

    expect(fs.existsSync(file)).toBe(false);
    const loreDir = path.join(tmpRoot, '.paradigm', 'lore', 'entries');
    expect(fs.existsSync(loreDir)).toBe(true);
    const dateDirs = fs.readdirSync(loreDir);
    expect(dateDirs.length).toBeGreaterThan(0);
  });

  it('routes to task and archives the source', async () => {
    const file = writeMemoryFile('plan.md', fm('Plan X', 'project', 'do the thing'));
    const id = stableId(file);

    await routeCommand(id, { project: tmpRoot, to: 'task', json: true });

    expect(fs.existsSync(file)).toBe(false);
    const tasksDir = path.join(tmpRoot, '.paradigm', 'tasks', 'entries');
    expect(fs.existsSync(tasksDir)).toBe(true);
  });

  it('routes to habits as a disabled .habit stub', async () => {
    const file = writeMemoryFile('tip.md', fm('Tip', 'feedback', 'prefer small commits'));
    const id = stableId(file);

    await routeCommand(id, { project: tmpRoot, to: 'habits', json: true });

    expect(fs.existsSync(file)).toBe(false);
    const habitFile = path.join(tmpRoot, '.paradigm', 'habits', `${id}.habit`);
    expect(fs.existsSync(habitFile)).toBe(true);
    expect(fs.readFileSync(habitFile, 'utf8')).toContain('enabled: false');
  });

  it('routes to a decision STUB the user completes', async () => {
    const file = writeMemoryFile('why.md', fm('Why', 'reference', 'we chose approach Y'));
    const id = stableId(file);

    await routeCommand(id, { project: tmpRoot, to: 'decisions', json: true });

    expect(fs.existsSync(file)).toBe(false);
    const decDir = path.join(tmpRoot, '.paradigm', 'decisions');
    const decFiles = fs.readdirSync(decDir).filter((f) => f.endsWith('.yaml'));
    expect(decFiles.length).toBe(1);
    const content = fs.readFileSync(path.join(decDir, decFiles[0]), 'utf8');
    expect(content).toContain('status: proposed');
    expect(content).toContain('TODO');
  });

  it('rejects an unknown --to target', async () => {
    const file = writeMemoryFile('x.md', fm('X', 'feedback', 'body'));
    const id = stableId(file);
    await routeCommand(id, { project: tmpRoot, to: 'nowhere', json: true });
    // Source untouched on rejection.
    expect(fs.existsSync(file)).toBe(true);
  });
});

// ── apply: merge ───────────────────────────────────────────

describe('mergeCommand', () => {
  it('merges same-cluster near-duplicates into the primary and archives the rest', async () => {
    const a = writeMemoryFile('a.md', fm('A', 'feedback', 'always update the changelog and commit after each round'));
    const b = writeMemoryFile('b.md', fm('B', 'feedback', 'always update the changelog and commit after every round'));

    const idA = stableId(a);
    const idB = stableId(b);

    await mergeCommand([idA, idB], { project: tmpRoot, json: true });

    expect(fs.existsSync(a)).toBe(true); // primary stays
    expect(fs.existsSync(b)).toBe(false); // duplicate archived
    const merged = fs.readFileSync(a, 'utf8');
    expect(merged).toContain('merged from b.md');
  });

  it('refuses to merge ids that are not in the same cluster', async () => {
    const a = writeMemoryFile('a.md', fm('A', 'feedback', 'shared alpha beta gamma delta epsilon zeta'));
    const b = writeMemoryFile('b.md', fm('B', 'feedback', 'completely different words about oranges bananas'));
    await mergeCommand([stableId(a), stableId(b)], { project: tmpRoot, json: true });
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true); // nothing archived
  });
});

// ── apply: pin ─────────────────────────────────────────────

describe('pinCommand', () => {
  it('pins an entry and down-ranks it out of future digests', async () => {
    const file = writeMemoryFile('user-pref.md', fm('Pref', 'user', 'I like terse output'));
    const id = stableId(file);

    // Before pin: it should surface as a finding (durable+fresh → pin suggestion).
    const before = await buildDigest(tmpRoot);
    expect(before.items.find((i) => i.id === id)).toBeDefined();

    await pinCommand(id, { project: tmpRoot, json: true });
    expect(loadPins(tmpRoot).has(path.resolve(file))).toBe(true);

    const after = await buildDigest(tmpRoot);
    expect(after.items.find((i) => i.id === id)).toBeUndefined();
  });
});

// ── return-shaped appliers (C2a) ───────────────────────────
// These are the pure cores the Platform write router calls. They must report
// success/failure ONLY through their return value — no output, no exit code —
// and hold all path-safety / archive-not-delete / guards inside.

describe('applyPrune', () => {
  it('returns { ok:true, archived, file } and archives the entry on success', async () => {
    const file = writeMemoryFile('stale.md', fm('Stale', 'project', 'only #ghost-symbol'));
    const id = stableId(file);
    const result = await applyPrune(tmpRoot, id);
    expect(result.ok).toBe(true);
    expect(result.archived).toBe('stale.md');
    expect(result.file).toBe(file);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(resolveMemoryDir(tmpRoot), '.archived', 'stale.md'))).toBe(true);
  });

  it('returns { ok:false, error } on a bad id and does NOT set process.exitCode', async () => {
    const prevExit = process.exitCode;
    const result = await applyPrune(tmpRoot, 'mem-deadbeef');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No memory entry matches/);
    expect(process.exitCode).toBe(prevExit); // applier never touches exit code
  });
});

describe('applyRoute', () => {
  it('returns { ok:true, destination, archivedSource, file } routing to lore', async () => {
    const file = writeMemoryFile('ref.md', fm('Durable', 'reference', 'stable knowledge here'));
    const result = await applyRoute(tmpRoot, stableId(file), 'lore');
    expect(result.ok).toBe(true);
    expect(typeof result.destination).toBe('string');
    expect(result.archivedSource).toBe(true);
    expect(result.file).toBe(file);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('returns { ok:false, error } on an invalid target and leaves the source intact', async () => {
    const file = writeMemoryFile('x.md', fm('X', 'feedback', 'body'));
    const result = await applyRoute(tmpRoot, stableId(file), 'nowhere' as never);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/--to must be one of/);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('returns { ok:false } on a bad id', async () => {
    const result = await applyRoute(tmpRoot, 'mem-deadbeef', 'lore');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No memory entry matches/);
  });
});

describe('applyMerge', () => {
  it('returns { ok:true, primary, merged, archived[] } for same-cluster dups', async () => {
    const a = writeMemoryFile('a.md', fm('A', 'feedback', 'always update the changelog and commit after each round'));
    const b = writeMemoryFile('b.md', fm('B', 'feedback', 'always update the changelog and commit after every round'));
    const result = await applyMerge(tmpRoot, [stableId(a), stableId(b)]);
    expect(result.ok).toBe(true);
    expect(result.primary).toBe(stableId(a));
    expect(result.merged).toEqual([stableId(b)]);
    expect(result.archived).toEqual([stableId(b)]);
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(false);
  });

  it('returns { ok:false } when fewer than two ids are given', async () => {
    const result = await applyMerge(tmpRoot, ['mem-only-one']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/at least two/);
  });

  it('returns { ok:false } for a cross-cluster merge (guard held inside)', async () => {
    const a = writeMemoryFile('a.md', fm('A', 'feedback', 'shared alpha beta gamma delta epsilon zeta'));
    const b = writeMemoryFile('b.md', fm('B', 'feedback', 'completely different words about oranges bananas'));
    const result = await applyMerge(tmpRoot, [stableId(a), stableId(b)]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not all in the same/);
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
  });
});

describe('applyPin', () => {
  it('returns { ok:true, pinned, file } and records the pin', async () => {
    const file = writeMemoryFile('pref.md', fm('Pref', 'user', 'I like terse output'));
    const result = await applyPin(tmpRoot, stableId(file));
    expect(result.ok).toBe(true);
    expect(result.pinned).toBe('pref.md');
    expect(result.file).toBe(file);
    expect(loadPins(tmpRoot).has(path.resolve(file))).toBe(true);
  });

  it('returns { ok:false } on a bad id', async () => {
    const result = await applyPin(tmpRoot, 'mem-deadbeef');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No memory entry matches/);
  });
});

// ── path safety ────────────────────────────────────────────

describe('path safety', () => {
  it('isInsideMemoryDir accepts in-dir and rejects out-of-dir files', () => {
    const memoryDir = resolveMemoryDir(tmpRoot);
    expect(isInsideMemoryDir(path.join(memoryDir, 'x.md'), memoryDir)).toBe(true);
    expect(isInsideMemoryDir(path.join(tmpRoot, 'outside.md'), memoryDir)).toBe(false);
    expect(isInsideMemoryDir(path.join(memoryDir, '..', 'escape.md'), memoryDir)).toBe(false);
  });

  it('archiveEntryFile refuses to touch a file outside the memory dir', () => {
    const memoryDir = resolveMemoryDir(tmpRoot);
    const outside = path.join(tmpRoot, 'outside.md');
    fs.writeFileSync(outside, 'do not touch me', 'utf8');

    const ok = archiveEntryFile(outside, memoryDir);
    expect(ok).toBe(false);
    expect(fs.existsSync(outside)).toBe(true); // untouched
  });
});

// ── review command smoke ───────────────────────────────────

describe('reviewCommand', () => {
  it('writes the review stamp and refreshes remediations', async () => {
    writeMemoryFile('tip.md', fm('Tip', 'feedback', 'prefer small commits'));
    await reviewCommand({ project: tmpRoot, json: true });

    const stamp = path.join(tmpRoot, '.paradigm', '.memory-last-review');
    expect(fs.existsSync(stamp)).toBe(true);
    expect(remediationFiles().length).toBe(1);
  });
});
