// #portal-compliance: rg exits 1 when nothing matches. That is an answer, so the code scan must not
// re-run the same pattern with grep (about 2 s per pattern on a large repo). A real rg error (exit 2)
// and a missing rg still fall back to grep.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const calls: string[] = [];
let rgBehaviour: 'no-match' | 'error' | 'missing' = 'no-match';

vi.mock('child_process', async (orig) => {
  const actual = await orig<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn((cmd: string) => {
      calls.push(cmd);
      if (cmd === 'rg') {
        if (rgBehaviour === 'missing') throw Object.assign(new Error('spawn rg ENOENT'), { code: 'ENOENT' });
        throw Object.assign(new Error('rg failed'), { status: rgBehaviour === 'no-match' ? 1 : 2 });
      }
      throw Object.assign(new Error('grep: no match'), { status: 1 });
    }),
  };
});

const { findGateReferences } = await import('./portal-compliance.js');

describe('code scan: rg exit status', () => {
  let root: string;
  beforeEach(() => {
    calls.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-rg-'));
  });

  it('rg exit 1 (no matches) does not fall back to grep', () => {
    rgBehaviour = 'no-match';
    findGateReferences(root);
    expect(calls).toContain('rg');
    expect(calls).not.toContain('grep');
  });

  it('a real rg error (exit 2) falls back to grep', () => {
    rgBehaviour = 'error';
    findGateReferences(root);
    expect(calls).toContain('grep');
  });

  it('a missing rg falls back to grep', () => {
    rgBehaviour = 'missing';
    findGateReferences(root);
    expect(calls).toContain('grep');
  });
});
