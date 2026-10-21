import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadTask, isPathSafeTaskId } from './task-loader.js';

describe('task-loader: an id never builds a path outside the task store', () => {
  it('isPathSafeTaskId accepts real ids and refuses separators and dots', () => {
    expect(isPathSafeTaskId('T-2026-10-21-001')).toBe(true);
    for (const bad of ['T-2026-10-21-/../x', 'T-2026-10-21-..', 'a/b', 'a\\b', '', 'x.yaml']) {
      expect(isPathSafeTaskId(bad)).toBe(false);
    }
  });

  it('loadTask with a traversal id does not read the planted file', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ids-'));
    try {
      const root = path.join(base, 'proj');
      fs.mkdirSync(path.join(root, '.paradigm', 'tasks', 'entries', '2026-10-21'), { recursive: true });
      fs.writeFileSync(path.join(base, 'planted.yaml'), 'id: T-x\nblurb: PLANTED\nstatus: open\npriority: low\ncreated: "2026-10-21T00:00:00.000Z"\n');
      expect(await loadTask(root, 'T-2026-10-21-/../../../../../../planted')).toBeNull();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
