/**
 * f4-trace-shadow-class.test — soundness audit, MEDIUM (`resultClassOf` note):
 * the shadow path answers an ENVELOPE, `{shadow, row, result}`, and
 * `resultClassOf` read the OUTER object — so every shadow verdict recorded
 * `resultClass: 'read'` instead of KNOT / CLEAN / HELD / FAST_ADMIT.
 *
 * Not a masking bug (C-16 closed the refusal half), but it made SHADOW rows
 * strictly less classifiable than direct ones — and the shadow verdict stream
 * is the evidence base for the R2 gate-promotion argument. A trace that
 * mislabels its own rows undermines the thing it exists to measure.
 *
 * The fix follows `refusalOf` (refusal.ts:291): ONE accessor that knows BOTH
 * depths, bounded at one envelope level.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { F4Tracer, readF4Trace, resultClassOf } from '../src/daemon/f4-trace.js';

/** The daemon's shadow answer shape (server.ts: `return { shadow: true, row, result }`). */
const shadowEnvelope = (status: string, extra: Record<string, unknown> = {}) => ({
  shadow: true,
  row: { schemaVersion: 'shadowVerdict:v1', status },
  result: { decision: { status }, sealed: false, ...extra },
});

describe('#f4-trace — resultClassOf reads the VERDICT, not the envelope', () => {
  it('a shadow row records the real status, not "read"', () => {
    for (const status of ['KNOT', 'CLEAN', 'HELD', 'FAST_ADMIT', 'NOOP', 'DANGLE']) {
      expect(resultClassOf(shadowEnvelope(status))).toBe(status);
    }
  });

  it('the direct (unenveloped) path is unchanged', () => {
    expect(resultClassOf({ decision: { status: 'KNOT' }, sealed: false })).toBe('KNOT');
    expect(resultClassOf({ decision: { status: 'FAST_ADMIT' }, sealed: true })).toBe('sealed');
    expect(resultClassOf({ decision: {} })).toBe('unknown');
    expect(resultClassOf({ noop: true })).toBe('noop');
    expect(resultClassOf({ strand: { pickId: 'pick:v2:abc' } })).toBe('sealed');
    expect(resultClassOf({ verdicts: [] })).toBe('read');
    expect(resultClassOf(null)).toBeNull();
    expect(resultClassOf('KNOT')).toBeNull();
  });

  it('an enveloped SEALED result reports sealed, not the status', () => {
    // `sealed` lives at the same depth as `decision`; the envelope must not
    // split them (that is what reading the outer object did).
    expect(resultClassOf({ shadow: false, result: { decision: { status: 'FAST_ADMIT' }, sealed: true } })).toBe('sealed');
  });

  it('the descent is BOUNDED at one level — a nested verdict two deep is still a read', () => {
    // A knot payload's archived verdict, or a tail of shadow rows, is not the
    // caller's own outcome. Same bound `refusalOf` draws, for the same reason.
    expect(resultClassOf({ result: { result: { decision: { status: 'KNOT' } } } })).toBe('read');
    expect(resultClassOf({ rows: [{ decision: { status: 'KNOT' } }] })).toBe('read');
  });

  it('a plain read result whose payload happens to be an object is still a read', () => {
    expect(resultClassOf({ result: { tip: 'pick:v2:abc', count: 3 } })).toBe('read');
  });
});

describe('#f4-trace — the emitted ROW carries the shadow verdict class', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-f4class-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a shadow admit and a direct admit land as distinguishable, correctly classed rows', () => {
    const tracer = new F4Tracer(root, 'mcp', 'agent:test');
    tracer.emit({ verb: 'admit', target: 'agentId=a shadow', ok: true, resultClass: resultClassOf(shadowEnvelope('KNOT')) });
    tracer.emit({ verb: 'admit', target: 'agentId=a', ok: true, resultClass: resultClassOf({ decision: { status: 'KNOT' }, sealed: false }) });

    const rows = readF4Trace(root);
    expect(rows.map((r) => r.resultClass)).toEqual(['KNOT', 'KNOT']);
    // The arm stays recoverable from the row: `shadow` rides in `target`, so the
    // class is deliberately UNPREFIXED rather than forking the vocabulary.
    expect(rows[0].target).toContain('shadow');
    expect(rows[1].target).not.toContain('shadow');
  });
});
