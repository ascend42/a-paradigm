/**
 * #mod-host append clamp and budgets (M1.11 slice 2; spec §12.3). The pure,
 * platform-independent half of test/mod-daemon.test.ts: Aegis C2 clamp, the
 * F2 per-mod append budget and per-call byte budgets. Runs on every platform.
 */
import { describe, expect, it } from 'vitest';
import { clampModAppend, createModKernelCall, MOD_APPEND_BYTES_PER_CALL, MOD_APPEND_MAX_BYTES, MOD_APPEND_ROWS_PER_SEC, ModRefusal } from '../src/kernel/modhost/index.js';

describe('Aegis C2: a mod-supplied log.append is clamped', () => {
  it('only kind/payload/audience/sensitivity pass; scope, causes, ref, idem, principal are dropped; payload object ≤ cap; labels are enum values', () => {
    const row = clampModAppend('probe', 'p:x/mod-probe', { kind: 'modns.probe.done', payload: { a: 1 }, scope: { repo: 'r' }, causes: ['ev'], ref: 'x', idem: 'i', principal: 'p:x/kernel', sensitivity: 'sensitive' });
    expect(row).toEqual({ kind: 'modns.probe.done', principal: 'p:x/mod-probe', payload: { a: 1 }, sensitivity: 'sensitive' });
    expect(() => clampModAppend('probe', 'p', { kind: 'modns.other.x' })).toThrow(ModRefusal);
    expect(() => clampModAppend('probe', 'p', { kind: 'modns.probe.x', payload: [1] })).toThrow(/plain object/);
    expect(() => clampModAppend('probe', 'p', { kind: 'modns.probe.x', payload: { b: 'x'.repeat(MOD_APPEND_MAX_BYTES) } })).toThrow(/at most/);
    expect(() => clampModAppend('probe', 'p', { kind: 'modns.probe.x', sensitivity: 'public' })).toThrow(/sensitivity/);
  });
});

describe('Aegis F2: the per-mod append budget', () => {
  it(`at most ${MOD_APPEND_ROWS_PER_SEC} rows per second and ${MOD_APPEND_BYTES_PER_CALL} bytes per call; beyond ⇒ LOG and no row`, async () => {
    let t = 1_000_000;
    let written = 0;
    const call = createModKernelCall({ callAs: async () => null, append: async () => ({ seq: ++written }) }, { now: () => t });
    const append = (payload: Record<string, unknown>, callId?: string) => call({ name: 'probe', principal: 'p:x/mod-probe', verb: 'log.append', params: { kind: 'modns.probe.x', payload }, ...(callId ? { callId } : {}) });
    for (let i = 0; i < MOD_APPEND_ROWS_PER_SEC; i++) await append({ i });
    await expect(append({ i: 'over' })).rejects.toMatchObject({ modCode: 'LOG', detail: { budget: 'rows' } });
    expect(written).toBe(MOD_APPEND_ROWS_PER_SEC);
    t += 1_500;
    const big = { b: 'x'.repeat(15 * 1024) };
    for (let i = 0; i < 4; i++) {
      t += 100;
      await append(big, 'call-1');
    }
    await expect(append(big, 'call-1')).rejects.toMatchObject({ modCode: 'LOG', detail: { budget: 'bytes' } });
    await append(big, 'call-2'); // a new call has its own window
  });
});

describe('reviewer: per-call byte budgets survive other keys', () => {
  it("a call's 64 KiB budget still holds after 300 other keys exist; ending a call drops only its own key", async () => {
    let t = 5_000_000;
    const call = createModKernelCall({ callAs: async () => null, append: async () => ({ seq: 1 }) }, { now: () => t });
    const big = { b: 'x'.repeat(15 * 1024) };
    const append = (name: string, payload: Record<string, unknown>, callId: string) => call({ name, principal: `p:x/mod-${name}`, verb: 'log.append', params: { kind: `modns.${name}.x`, payload }, callId });
    for (let i = 0; i < 2; i++) await append('probe', big, 'call-1');
    for (let i = 0; i < 300; i++) await append(`m${i}`, { i }, `c-${i}`);
    expect(call.budgetKeys()).toBe(301);
    for (let i = 0; i < 2; i++) await append('probe', big, 'call-1');
    await expect(append('probe', big, 'call-1')).rejects.toMatchObject({ modCode: 'LOG', detail: { budget: 'bytes' } });
    call.endCall('m0', 'c-0');
    expect(call.budgetKeys()).toBe(300);
    await expect(append('probe', big, 'call-1')).rejects.toMatchObject({ detail: { budget: 'bytes' } });
  });
});
