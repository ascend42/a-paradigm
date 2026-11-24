/**
 * Work-log ids: the date is read correctly when the agent id has a hyphen.
 *
 * The old parse, /WL-[^-]+-(date)-/, required the agent part to hold no
 * hyphen, so `WL-ui-builder-2026-11-23-001` never matched and every lookup for
 * such an agent fell through to a scan of all date folders.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { workLogDateFromId, recordWorkLog, loadWorkLogEntry } from './work-log-loader.js';

describe('workLogDateFromId', () => {
  it('reads the date when the agent id has no hyphen', () => {
    expect(workLogDateFromId('WL-builder-2026-11-23-001')).toBe('2026-11-23');
  });

  it('reads the date when the agent id has hyphens (the old pattern returned nothing)', () => {
    const id = 'WL-ui-builder-2026-11-23-001';
    expect(/WL-[^-]+-(\d{4}-\d{2}-\d{2})-/.exec(id)).toBeNull(); // the bug, pinned
    expect(workLogDateFromId(id)).toBe('2026-11-23');
    expect(workLogDateFromId('WL-a-b-c-d-2026-01-02-000123')).toBe('2026-01-02');
  });

  it('takes the last date when the agent part looks like one too', () => {
    expect(workLogDateFromId('WL-run-2025-01-01-2026-11-23-7')).toBe('2026-11-23');
  });

  it('returns null for an id in another shape', () => {
    expect(workLogDateFromId('WL-security-001')).toBeNull();
    expect(workLogDateFromId('not-an-id')).toBeNull();
  });
});

describe('loadWorkLogEntry for a hyphenated agent', () => {
  it('finds the entry in its own date folder, with no other folder present to scan', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-log-'));
    try {
      const written = recordWorkLog(root, { agent: 'ui-builder', summary: 'built a thing', outcome: 'success' } as Parameters<typeof recordWorkLog>[1]);
      expect(written.id.startsWith('WL-ui-builder-')).toBe(true);
      const date = workLogDateFromId(written.id);
      expect(date).not.toBeNull();
      expect(fs.existsSync(path.join(root, '.paradigm', 'work-log', date as string, `${written.id}.yaml`))).toBe(true);
      expect(loadWorkLogEntry(root, written.id)?.summary).toBe('built a thing');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
