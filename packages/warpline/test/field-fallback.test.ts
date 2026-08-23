/**
 * field-fallback.test — habit (iii): the git-fallback log (B7 increment 1).
 * Append + list round-trip; plain JSONL (the protocol asks a log, not custody).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import * as fs from 'node:fs';
import { recordGitFallback, listGitFallbacks, gitFallbackPathOf } from '../src/field/fallback.js';

describe('FIELD FALLBACK — habit (iii) git-fallback log', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'warpline-field-fallback-'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('append + list round-trip, optional fields only present when given', () => {
    expect(listGitFallbacks(root)).toEqual([]); // ENOENT ⇒ empty, never a throw

    const e1 = recordGitFallback(root, {
      message: 'git stash to escape a wedge after a KNOT (no abandon path)',
      actor: 'ascend',
      knotId: 'knotPayload:v1:' + 'a'.repeat(64),
      now: () => '2026-08-23T10:00:00.000Z',
    });
    const e2 = recordGitFallback(root, {
      message: 'byte-only asset work unadmittable on the native path (B-1) — committed via git',
      actor: 'agent-b',
      admitRef: 'state:v0:assets',
      now: () => '2026-08-23T11:00:00.000Z',
    });

    const listed = listGitFallbacks(root);
    expect(listed).toEqual([e1, e2]);
    expect(listed[0]).toEqual({
      ts: '2026-08-23T10:00:00.000Z',
      actor: 'ascend',
      message: 'git stash to escape a wedge after a KNOT (no abandon path)',
      knotId: 'knotPayload:v1:' + 'a'.repeat(64),
    });
    expect('admitRef' in listed[0]).toBe(false); // absent, not null — nothing invented
    expect('knotId' in listed[1]).toBe(false);
    expect(listed[1].admitRef).toBe('state:v0:assets');

    // plain JSONL on disk, one line per entry, file order preserved
    const raw = fs.readFileSync(gitFallbackPathOf(root), 'utf8').trim().split('\n');
    expect(raw).toHaveLength(2);
    expect(JSON.parse(raw[0])).toEqual(e1);
  });

  it('refuses an empty message — a silent fallback is the failure mode the log exists to catch', () => {
    expect(() => recordGitFallback(root, { message: '   ', actor: 'x' })).toThrow(/needs a message/);
    expect(listGitFallbacks(root)).toHaveLength(2); // nothing appended
  });
});
