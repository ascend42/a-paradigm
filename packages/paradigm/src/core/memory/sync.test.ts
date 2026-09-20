/**
 * Tests for #memory-steward-sync (Memory Steward B2).
 *
 * SAFETY: never touch the real ~/.claude or a real MEMORY.md. We override HOME
 * (os.homedir honors it on POSIX) so resolveMemoryDir points into a sandbox, and
 * build a throwaway project root with a real `.purpose` so loadLiveGraph sees
 * genuine live symbols (mirrors index.test.ts / memory-scan.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveMemoryDir } from '@a-company/premise-core';

import {
  computeSync,
  writeSyncResult,
  MANAGED_BEGIN,
  MANAGED_END,
  ARCHIVE_HEADING,
} from './sync.js';
import { recordLore } from '../lore/storage.js';
import type { LoreEntry } from '../lore/types.js';

// ── Sandbox ────────────────────────────────────────────────
let tmpRoot: string;
let tmpHome: string;
let origHome: string | undefined;
let origUserProfile: string | undefined;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-sync-root-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-sync-home-'));
  origHome = process.env.HOME;
  origUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  writePurpose(['real-symbol']);
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserProfile;
  // Restore any perms so cleanup succeeds.
  try {
    fs.chmodSync(resolveMemoryDir(tmpRoot), 0o755);
  } catch {
    /* ignore */
  }
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

function writeMemoryMd(content: string): string {
  const dir = resolveMemoryDir(tmpRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'MEMORY.md');
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

/** Seed a durable lore entry so the projection has something to draw from. */
async function seedLore(title: string): Promise<void> {
  const entry: LoreEntry = {
    id: '',
    type: 'human-note',
    timestamp: new Date().toISOString(),
    author: 'tester',
    title,
    summary: `${title} summary.`,
    symbols_touched: [],
    body: `${title} body.`,
    tags: ['test'],
  };
  await recordLore(tmpRoot, entry);
}

// A realistic-ish MEMORY.md: title, a durable feedback section, a live plan, and
// a provably-stale sub-arc (references only a dead symbol).
const HUMAN_FEEDBACK_BODY =
  'Always run the full team analysis before proposing options. This is a hand-written rule.';

function baseMemory(): string {
  return [
    '# Paradigm Project Memory',
    '',
    'Top-of-file preamble the user wrote.',
    '',
    '## Critical Feedback',
    '',
    HUMAN_FEEDBACK_BODY,
    '',
    '## Project Plans',
    '',
    'Intro to plans, mentions #real-symbol so this stays valid.',
    '',
    '### Live Arc',
    '',
    'This arc references #real-symbol and is current.',
    '',
    '### Dead Arc',
    '',
    'This arc only references #dead-symbol which no longer exists.',
    '',
  ].join('\n');
}

// ── Tests ──────────────────────────────────────────────────

describe('computeSync — projection (opt-in only)', () => {
  it('injects NO projection block WITHOUT project:true (default = leaning only)', async () => {
    await seedLore('Durable insight zero');
    writeMemoryMd(baseMemory());

    const r = await computeSync(tmpRoot); // no project flag
    expect(count(r.after, MANAGED_BEGIN)).toBe(0);
    expect(count(r.after, MANAGED_END)).toBe(0);
    expect(r.projectionItems.length).toBe(0);
  });

  it('WITH project:true injects a compact, capped block right after the title (no stacking)', async () => {
    // Seed 9 unique lore entries — cap must clamp to 8.
    for (let i = 0; i < 9; i++) await seedLore(`Durable insight ${String(i).padStart(2, '0')}`);
    writeMemoryMd(baseMemory());

    const r1 = await computeSync(tmpRoot, { project: true });
    expect(r1.existed).toBe(true);
    expect(count(r1.after, MANAGED_BEGIN)).toBe(1);
    expect(count(r1.after, MANAGED_END)).toBe(1);

    // Capped at 8.
    expect(r1.projectionItems.length).toBe(8);

    // managed block sits after the title line
    const titleIdx = r1.after.indexOf('# Paradigm Project Memory');
    const beginIdx = r1.after.indexOf(MANAGED_BEGIN);
    expect(beginIdx).toBeGreaterThan(titleIdx);

    // COMPACT: every projection line is `- [kind] ...` and ≤ 80 chars.
    const projLines = r1.after
      .split('\n')
      .filter((l) => l.startsWith('- ['));
    expect(projLines.length).toBe(8);
    for (const l of projLines) {
      expect(l.length).toBeLessThanOrEqual(80);
      expect(l).toMatch(/^- \[lore\] /);
    }

    // Feed the OUTPUT back in — a second compute must not stack a 2nd block.
    writeMemoryMd(r1.after);
    const r2 = await computeSync(tmpRoot, { project: true });
    expect(count(r2.after, MANAGED_BEGIN)).toBe(1);
    expect(count(r2.after, MANAGED_END)).toBe(1);
  });

  it('DEDUPES a projection item whose title already appears in the file', async () => {
    await seedLore('Alpha durable rule');
    await seedLore('Beta durable rule');
    // The file already talks about "Alpha durable rule" by hand.
    writeMemoryMd(
      ['# Title', '', '## Notes', '', 'We already wrote about Alpha durable rule here.', ''].join('\n'),
    );

    const r = await computeSync(tmpRoot, { project: true });
    const titles = r.projectionItems.map((it) => it.title);
    expect(titles).not.toContain('Alpha durable rule'); // deduped out
    expect(titles).toContain('Beta durable rule'); // still projected
  });
});

describe('computeSync — verbatim preservation', () => {
  it('preserves hand-written section bodies byte-for-byte', async () => {
    writeMemoryMd(baseMemory());
    const r = await computeSync(tmpRoot);
    expect(r.after).toContain(HUMAN_FEEDBACK_BODY);
    // Title + curated headings survive.
    expect(r.after).toContain('# Paradigm Project Memory');
    expect(r.after).toContain('## Critical Feedback');
    expect(r.after).toContain('Top-of-file preamble the user wrote.');
  });
});

describe('computeSync — dedup', () => {
  it('removes an exact-duplicate leaf block, keeping the first', async () => {
    const dup = ['## Note', '', 'A note that references #real-symbol.', ''].join('\n');
    const content = ['# Title', '', dup, dup, '## Other', '', 'Distinct #real-symbol body.', ''].join(
      '\n',
    );
    writeMemoryMd(content);

    const r = await computeSync(tmpRoot);
    expect(r.deduped.length).toBe(1);
    // Only ONE "## Note" heading remains, and its body is still present.
    expect(count(r.after, '## Note')).toBe(1);
    expect(r.after).toContain('A note that references #real-symbol.');
  });
});

describe('computeSync — demote (never delete)', () => {
  it('moves a provably-stale block into the Archive section, preserving its content', async () => {
    writeMemoryMd(baseMemory());
    const r = await computeSync(tmpRoot);

    expect(r.demoted.length).toBeGreaterThanOrEqual(1);
    expect(r.after).toContain(ARCHIVE_HEADING);

    // The dead arc's body is NOT deleted — it is present, below the Archive heading.
    const archiveIdx = r.after.indexOf(ARCHIVE_HEADING);
    const deadBodyIdx = r.after.indexOf('This arc only references #dead-symbol');
    expect(deadBodyIdx).toBeGreaterThan(archiveIdx);

    // The live arc stays ABOVE the archive.
    const liveIdx = r.after.indexOf('This arc references #real-symbol and is current.');
    expect(liveIdx).toBeGreaterThan(-1);
    expect(liveIdx).toBeLessThan(archiveIdx);

    // A structural parent (## Project Plans, which has children) is NOT demoted.
    const plansIdx = r.after.indexOf('## Project Plans');
    expect(plansIdx).toBeLessThan(archiveIdx);
  });
});

describe('computeSync — demotion is strictly guarded', () => {
  it('NEVER demotes a level-2 (##) section, even when its body cites only dead symbols', async () => {
    const content = [
      '# Title',
      '',
      '## Release & Versioning Conventions',
      '',
      'This section cites only #dead-symbol which is gone from the graph.',
      '',
    ].join('\n');
    writeMemoryMd(content);

    const r = await computeSync(tmpRoot);
    expect(r.demoted.length).toBe(0);
    expect(r.after).not.toContain(ARCHIVE_HEADING);
    expect(r.after).toContain('## Release & Versioning Conventions');
  });

  it('NEVER demotes an active-marked ### (⭐ / START HERE) even if graph-stale', async () => {
    const content = [
      '# Title',
      '',
      '## Active Plans',
      '',
      'Plans intro.',
      '',
      '### ⭐ ACTIVE ARC — START HERE',
      '',
      'This arc cites only #dead-symbol, but it is the load-bearing current focus.',
      '',
    ].join('\n');
    writeMemoryMd(content);

    const r = await computeSync(tmpRoot);
    expect(r.demoted.length).toBe(0);
    expect(r.after).not.toContain(ARCHIVE_HEADING);
    expect(r.after).toContain('### ⭐ ACTIVE ARC — START HERE');
  });

  it('DOES demote a genuinely-dead leaf ### (no markers, no recent dates, all symbols dead)', async () => {
    const content = [
      '# Title',
      '',
      '## Plans',
      '',
      'Intro.',
      '',
      '### Old sub-arc',
      '',
      'This sub-arc references only #dead-symbol and nothing else.',
      '',
    ].join('\n');
    writeMemoryMd(content);

    const r = await computeSync(tmpRoot);
    expect(r.demoted.length).toBe(1);
    expect(r.demoted[0].heading).toContain('Old sub-arc');
    // Preserved, not deleted: body sits below the Archive heading.
    const archiveIdx = r.after.indexOf(ARCHIVE_HEADING);
    expect(archiveIdx).toBeGreaterThan(-1);
    expect(r.after.indexOf('This sub-arc references only #dead-symbol')).toBeGreaterThan(archiveIdx);
    // The structural parent (## Plans) is untouched.
    expect(r.after.indexOf('## Plans')).toBeLessThan(archiveIdx);
  });
});

describe('computeSync — idempotency', () => {
  it('two syncs over unchanged inputs produce identical output', async () => {
    writeMemoryMd(baseMemory());
    const r1 = await computeSync(tmpRoot);
    writeMemoryMd(r1.after);
    const r2 = await computeSync(tmpRoot);
    expect(r2.after).toBe(r1.after);
    expect(r2.changed).toBe(false);
  });
});

describe('writeSyncResult — backup + atomic + fail-open', () => {
  it('dry-run compute writes nothing to disk', async () => {
    const file = writeMemoryMd(baseMemory());
    const original = fs.readFileSync(file, 'utf8');
    await computeSync(tmpRoot); // no write call
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    // no backups created
    const dir = resolveMemoryDir(tmpRoot);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('MEMORY.md.bak-')).length).toBe(0);
  });

  it('--write path backs up first, then updates atomically', async () => {
    const file = writeMemoryMd(baseMemory());
    const original = fs.readFileSync(file, 'utf8');
    const r = await computeSync(tmpRoot);

    const { backupPath } = writeSyncResult(r);
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, 'utf8')).toBe(original); // backup = pre-image
    expect(fs.readFileSync(file, 'utf8')).toBe(r.after); // file = lean rewrite
    // No temp file left behind.
    const dir = resolveMemoryDir(tmpRoot);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('.MEMORY.md.tmp-'))).toBe(false);
  });

  it('error path leaves the original intact (no partial write)', async () => {
    const file = writeMemoryMd(baseMemory());
    const original = fs.readFileSync(file, 'utf8');
    const r = await computeSync(tmpRoot);

    // Make the memory dir read-only so the backup copy fails before any write.
    const dir = resolveMemoryDir(tmpRoot);
    fs.chmodSync(dir, 0o555);
    let threw = false;
    try {
      writeSyncResult(r);
    } catch {
      threw = true;
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    expect(threw).toBe(true);
    // Original untouched, no backup, no temp.
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    const listing = fs.readdirSync(dir);
    expect(listing.some((f) => f.startsWith('MEMORY.md.bak-'))).toBe(false);
    expect(listing.some((f) => f.startsWith('.MEMORY.md.tmp-'))).toBe(false);
  });
});

describe('computeSync — missing file', () => {
  it('fail-open when there is no MEMORY.md', async () => {
    const r = await computeSync(tmpRoot);
    expect(r.existed).toBe(false);
    expect(r.changed).toBe(false);
    expect(r.after).toBe('');
  });
});

// ── util ───────────────────────────────────────────────────

function count(hay: string, needle: string): number {
  let n = 0;
  let i = 0;
  for (;;) {
    const idx = hay.indexOf(needle, i);
    if (idx === -1) break;
    n++;
    i = idx + needle.length;
  }
  return n;
}
