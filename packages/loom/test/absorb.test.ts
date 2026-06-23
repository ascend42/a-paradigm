/**
 * absorb.test — ABSORB on THIS repo.
 *   - absorbing a real ref yields a non-empty WarpState with a stateId
 *   - absorbing the same ref twice → identical stateId (determinism)
 *   - a symbol unchanged between two refs → zero delta for that symbol
 */

import { describe, it, expect } from 'vitest';
import { absorb, WORKTREE_REF } from '../src/absorb.js';
import { diff } from '../src/sem-delta.js';

describe('absorb', () => {
  it('absorbs the WORKTREE pseudo-ref into a WarpState', async () => {
    const state = await absorb(WORKTREE_REF);
    expect(state.objects.size).toBeGreaterThan(0);
    expect(state.stateId.startsWith('state:v0:')).toBe(true);
    // every object carries a v0 contentId
    for (const obj of state.objects.values()) {
      expect(obj.contentId.startsWith('essence:v0:')).toBe(true);
    }
  });

  it('absorbing the same ref twice → identical stateId', async () => {
    const a = await absorb('HEAD');
    const b = await absorb('HEAD');
    expect(a.stateId).toBe(b.stateId);
    expect(a.objects.size).toBe(b.objects.size);
  });

  it('diff(HEAD, HEAD) is empty (identical meaning → zero delta)', async () => {
    const a = await absorb('HEAD');
    const b = await absorb('HEAD');
    const d = diff(a, b);
    expect(d.deltas.size).toBe(0);
    expect(d.renames.length).toBe(0);
  });

  // The load-bearing determinism invariant (Loom Oracle): absorbing the SAME ref
  // twice must be byte-identical at every level — stateId, object set, and every
  // per-symbol contentId — so diff(absorb(HEAD), absorb(HEAD)) is provably ZERO.
  // This guards the file-discovery-order + filePath-normalization fixes that
  // killed the ~26 phantom semantic deltas (scan-index nondeterminism, T-2026-06-13-011).
  it('absorbing the same ref twice is byte-identical (stateId + every contentId + filePath)', async () => {
    const a = await absorb('HEAD');
    const b = await absorb('HEAD');

    // 1. Same stateId, same number of objects.
    expect(a.stateId).toBe(b.stateId);
    expect(a.objects.size).toBe(b.objects.size);

    // 2. Same symbol set, and for every symbol: identical contentId, stableKey,
    //    and (repo-relative) filePath.
    const bByKey = new Map(Array.from(b.objects.values()).map((o) => [o.stableKey, o]));
    for (const obj of a.objects.values()) {
      const other = bByKey.get(obj.stableKey);
      expect(other, `symbol ${obj.symbol} (${obj.stableKey}) missing in second absorb`).toBeDefined();
      expect(other!.contentId).toBe(obj.contentId);
      expect(other!.symbol).toBe(obj.symbol);
      expect(other!.filePath).toBe(obj.filePath);
    }

    // 3. The semantic diff is therefore perfectly empty — zero deltas, zero renames.
    const d = diff(a, b);
    expect(d.deltas.size).toBe(0);
    expect(d.renames.length).toBe(0);
  });

  it('a symbol present and unchanged across HEAD~1→HEAD produces no delta for it', async () => {
    const base = await absorb('HEAD~1');
    const head = await absorb('HEAD');
    const d = diff(base, head);
    // The two refs differ, but the vast majority of symbols are unchanged. Pick a
    // stableKey present in both with equal contentId → must NOT appear in deltas.
    const baseByKey = new Map(
      Array.from(base.objects.values()).map((o) => [o.stableKey, o]),
    );
    let checkedAnUnchanged = false;
    for (const obj of head.objects.values()) {
      const b = baseByKey.get(obj.stableKey);
      if (b && b.contentId === obj.contentId) {
        expect(d.deltas.has(obj.stableKey)).toBe(false);
        checkedAnUnchanged = true;
        break;
      }
    }
    expect(checkedAnUnchanged).toBe(true);
  });
});
