/**
 * cli-trace-refusal-accessor.test — soundness audit C-16, the LAST site.
 *
 * C-16 (Jinx J-12) found the daemon's PW-8 audit probe and the MCP skin's
 * isError probe both testing `'refusal' in result` on the OUTER object, so a
 * shadow-enveloped refusal (`{shadow, row, result:{refusal}}`) reported clean.
 * The fix introduced ONE accessor, `refusalOf` (refusal.ts:291), that knows
 * both depths and shape-checks with `isRefusal`.
 *
 * `src/f4/cli-trace.ts` kept its OWN local `refusalOf` reading only the outer
 * object — the identical defect, surviving on the CLI arm. That arm is one of
 * F4's two SCORED surfaces, so a refusal invisible to `cli-trace` is a row the
 * wasted-turn classifier cannot score: the row emits `refusal: undefined` and
 * the W-taxonomy has nothing to read.
 *
 * This file pins the CLI trace to the shared accessor: both depths, the shape
 * check, and the deliberate one-level bound.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { traceCli } from '../src/f4/cli-trace.js';
import { readF4Trace } from '../src/daemon/f4-trace.js';
import { refuse, RefusedError, type Refusal } from '../src/fabric/refusal.js';

const knot = (): Refusal =>
  refuse({
    code: 'KNOT',
    verdict: 'KNOT',
    next: [{ verb: 'resolve', params: {}, requires: ['resolvedRef'], principal: 'human' }],
  });

describe('#f4-trace (CLI skin) — C-16: refusals route through the SHARED accessor', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-clitrace-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a SHADOW-ENVELOPED refusal reaches the row (the C-16 defect on the CLI arm)', async () => {
    // The daemon's shadow answer shape: server.ts `return {shadow, row, result}`.
    const enveloped = { shadow: true, row: { status: 'KNOT' }, result: { decision: { status: 'KNOT' }, sealed: false, refusal: knot() } };
    await traceCli({ root, verb: 'admit', target: 'agentId=a shadow' }, () => enveloped);

    const rows = readF4Trace(root);
    expect(rows).toHaveLength(1);
    // Pre-fix: undefined — an unscorable row on a scored surface.
    expect(rows[0].refusal?.code).toBe('KNOT');
    expect(rows[0].refusal?.verdict).toBe('KNOT');
  });

  it('the DIRECT (unenveloped) depth is unchanged', async () => {
    await traceCli({ root, verb: 'admit', target: 'agentId=a' }, () => ({
      decision: { status: 'KNOT' },
      sealed: false,
      refusal: knot(),
    }));
    expect(readF4Trace(root)[0].refusal?.code).toBe('KNOT');
  });

  it('an unversioned look-alike is NOT mistaken for a verdict (the shape check the local copy lacked)', async () => {
    // The local accessor returned whatever sat under `refusal`, so a plain
    // `{refusal: {...}}` — a git-era shape, a hand-built fixture, an
    // agent-authored object — became a refusal:v1 row with no schemaVersion.
    await traceCli({ root, verb: 'admit', target: 'agentId=a' }, () => ({
      refusal: { code: 'KNOT', why: 'not a refusal:v1 object' },
    }));
    expect(readF4Trace(root)[0].refusal).toBeUndefined();
  });

  it('the descent is BOUNDED at one envelope level, exactly as refusalOf draws it', async () => {
    // Two deep is somebody else's outcome (an archived knot verdict, a tail of
    // shadow rows) — never this call's.
    await traceCli({ root, verb: 'knot.show', target: null }, () => ({
      result: { result: { refusal: knot() } },
    }));
    expect(readF4Trace(root)[0].refusal).toBeUndefined();
  });

  // ── CONTROLS (non-regression, NOT red-first cases) ──────────────────────────
  it('CONTROL: a plain ok result still emits a row with no refusal', async () => {
    const v = await traceCli({ root, verb: 'refs list', target: null }, () => ({ refs: [] }));
    expect(v).toEqual({ refs: [] });
    const rows = readF4Trace(root);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].refusal).toBeUndefined();
  });

  it('CONTROL: a thrown RefusedError still emits its refusal and re-throws', async () => {
    await expect(
      traceCli({ root, verb: 'admit', target: null }, () => {
        throw new RefusedError(knot(), 'nope');
      }),
    ).rejects.toThrow(/nope/);
    const rows = readF4Trace(root);
    expect(rows[0].ok).toBe(false);
    expect(rows[0].refusal?.code).toBe('KNOT');
  });
});
