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


describe("loadWorkLogEntry for a hyphenated agent", () => {
  it("reads the entry from its own date folder, not from the scan of every folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-log-"));
    try {
      const written = recordWorkLog(root, { agent: "ui-builder", summary: "the real entry", outcome: "pass" });
      expect(written.id.startsWith("WL-ui-builder-")).toBe(true);
      const date = workLogDateFromId(written.id);
      expect(date).not.toBeNull();
      const base = path.join(root, ".paradigm", "work-log");
      expect(fs.existsSync(path.join(base, date as string, `${written.id}.yaml`))).toBe(true);

      // A decoy with the SAME id in every other date folder the scan could reach
      // first (one sorting before the real date, one after). The fallback scan
      // returns the first folder that holds the id, so with the old pattern this
      // lookup returned a decoy; the direct lookup can only return the real one.
      for (const decoyDate of ["0000-01-01", "9999-12-31"]) {
        fs.mkdirSync(path.join(base, decoyDate), { recursive: true });
        fs.writeFileSync(
          path.join(base, decoyDate, `${written.id}.yaml`),
          `id: ${written.id}\nagent: ui-builder\nsummary: decoy\noutcome: pass\ntimestamp: "2000-01-01T00:00:00.000Z"\n`,
        );
      }
      expect(loadWorkLogEntry(root, written.id)?.summary).toBe("the real entry");
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
});
