/**
 * Records written back to back never overwrite one another. The loaders used to
 * build an id from a timestamp plus a random 1-999 and write unconditionally:
 * journal entries in the same second, and decisions / work logs on the same
 * day, that drew the same number silently replaced an earlier record.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeUniqueRecord } from './unique-record.js';
import { recordJournalEntry, loadJournalEntries } from './journal-loader.js';
import { recordDecision } from './decision-loader.js';
import { recordWorkLog } from './work-log-loader.js';

const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let home = '';
let root = '';

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'unique-record-home-'));
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'unique-record-root-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  // One frozen instant: every record below lands in the same second and day.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(realHome)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

describe('writeUniqueRecord', () => {
  it('never overwrites: the same random draw gives the next free suffix', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // always the same first suffix
    const dir = path.join(root, 'records');
    const ids = [1, 2, 3].map((n) => writeUniqueRecord(dir, (s) => `R-${s}`, () => `body ${n}\n`));
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(['R-500', 'R-501', 'R-502']);
    expect(ids.map((id) => fs.readFileSync(path.join(dir, `${id}.yaml`), 'utf8'))).toEqual(['body 1\n', 'body 2\n', 'body 3\n']);
  });

  it('widens the suffix once all 999 short ids are taken', () => {
    const dir = path.join(root, 'full');
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 1; n <= 999; n++) fs.writeFileSync(path.join(dir, `R-${String(n).padStart(3, '0')}.yaml`), 'old\n');
    const id = writeUniqueRecord(dir, (s) => `R-${s}`, () => 'new\n');
    expect(id).toMatch(/^R-\d{6}$/);
    expect(fs.readdirSync(dir)).toHaveLength(1000);
    expect(fs.readFileSync(path.join(dir, 'R-500.yaml'), 'utf8')).toBe('old\n');
  });
});

describe('recordJournalEntry — many entries in one tick', () => {
  const entry = (n: number) => ({
    trigger: 'human_feedback' as const,
    insight: `insight ${n}`,
    confidence_before: 0.5,
    confidence_after: 0.6,
    transferable: false,
  });

  it('1200 entries in the same second are 1200 distinct files', () => {
    const ids = new Set<string>();
    for (let n = 0; n < 1200; n++) ids.add(recordJournalEntry('kit', entry(n) as never).id);
    expect(ids.size).toBe(1200);
    const dir = path.join(home, '.paradigm', 'agents', 'kit', 'journal');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'))).toHaveLength(1200);
    const insights = new Set(loadJournalEntries('kit').map((e) => e.insight));
    expect(insights.size).toBe(1200);
    for (const id of ids) expect(id).toMatch(/^LJ-2026-11-23-100000-\d{3,6}$/);
  }, 60_000);

  it('two back-to-back entries that draw the same number both survive', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const a = recordJournalEntry('kit', entry(1) as never);
    const b = recordJournalEntry('kit', entry(2) as never);
    expect(a.id).not.toBe(b.id);
    expect(loadJournalEntries('kit').map((e) => e.insight).sort()).toEqual(['insight 1', 'insight 2']);
  });
});

describe('decisions and work logs (same id scheme, a whole day wide)', () => {
  it('two decisions on the same day that draw the same number both survive', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const a = recordDecision(root, { title: 'first' } as never);
    const b = recordDecision(root, { title: 'second' } as never);
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^TD-2026-11-23-\d{3}$/);
    const dir = path.join(root, '.paradigm', 'decisions');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'))).toHaveLength(2);
    expect(fs.readFileSync(path.join(dir, `${a.id}.yaml`), 'utf8')).toContain('first');
  });

  it('two work logs by one agent on the same day that draw the same number both survive', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const a = recordWorkLog(root, { agent: 'kit', summary: 'first' } as never);
    const b = recordWorkLog(root, { agent: 'kit', summary: 'second' } as never);
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^WL-kit-2026-11-23-\d{3}$/);
    const dayDir = path.dirname(
      fs
        .readdirSync(root, { recursive: true, encoding: 'utf8' })
        .map((f) => path.join(root, f))
        .find((f) => f.endsWith(`${a.id}.yaml`))!,
    );
    expect(fs.readdirSync(dayDir).filter((f) => f.endsWith('.yaml'))).toHaveLength(2);
  });
});
