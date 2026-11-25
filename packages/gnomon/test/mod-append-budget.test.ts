/**
 * #mod-host append clamp and budgets (M1.11 slice 2; spec §12.3). The pure,
 * platform-independent half of test/mod-daemon.test.ts: Aegis C2 clamp, the
 * F2 per-mod append budget and per-call byte budgets. Runs on every platform.
 */
import { describe, expect, it, vi } from 'vitest';
import { clampModAppend, createModKernelCall, MOD_APPEND_BUDGETS, MOD_APPEND_BYTES_PER_CALL, MOD_APPEND_MAX_BYTES, MOD_APPEND_ROWS_PER_SEC, MOD_APPEND_TOOL_ROWS_PER_SEC, MOD_APPEND_WINDOW_MS, ModRefusal, type ModCallKind } from '../src/kernel/modhost/index.js';
import { MOD_REFUSAL_CODES } from '../src/kernel/modhost/refusal.js';

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
  it(`at most ${MOD_APPEND_ROWS_PER_SEC} rows per second and ${MOD_APPEND_BYTES_PER_CALL} bytes per call; beyond ⇒ APPEND_BUDGET and no row`, async () => {
    let t = 1_000_000;
    let written = 0;
    const call = createModKernelCall({ callAs: async () => null, append: async () => ({ seq: ++written }) }, { now: () => t });
    // command rows: the whole per-mod total is theirs (the tool share is G-MOD-21, below)
    const append = (payload: Record<string, unknown>, callId?: string) => call({ name: 'probe', principal: 'p:x/mod-probe', verb: 'log.append', params: { kind: 'modns.probe.x', payload }, ...(callId ? { callId } : {}), callKind: 'command' });
    for (let i = 0; i < MOD_APPEND_ROWS_PER_SEC; i++) await append({ i });
    await expect(append({ i: 'over' })).rejects.toMatchObject({ modCode: 'APPEND_BUDGET', detail: { budget: 'rows', written: false } });
    expect(written).toBe(MOD_APPEND_ROWS_PER_SEC);
    t += 1_500;
    const big = { b: 'x'.repeat(15 * 1024) };
    for (let i = 0; i < 4; i++) {
      t += 100;
      await append(big, 'call-1');
    }
    await expect(append(big, 'call-1')).rejects.toMatchObject({ modCode: 'APPEND_BUDGET', detail: { budget: 'bytes', written: false } });
    await append(big, 'call-2'); // a new call has its own window
  });
});

describe('reviewer: per-call byte budgets survive other keys', () => {
  it("a call's 64 KiB budget still holds after 300 other keys exist; ending a call drops only its own key", async () => {
    let t = 5_000_000;
    const call = createModKernelCall({ callAs: async () => null, append: async () => ({ seq: 1 }) }, { now: () => t });
    const big = { b: 'x'.repeat(15 * 1024) };
    const append = (name: string, payload: Record<string, unknown>, callId: string) => call({ name, principal: `p:x/mod-${name}`, verb: 'log.append', params: { kind: `modns.${name}.x`, payload }, callId, callKind: 'command' });
    for (let i = 0; i < 2; i++) await append('probe', big, 'call-1');
    for (let i = 0; i < 300; i++) await append(`m${i}`, { i }, `c-${i}`);
    expect(call.budgetKeys()).toBe(301);
    for (let i = 0; i < 2; i++) await append('probe', big, 'call-1');
    await expect(append('probe', big, 'call-1')).rejects.toMatchObject({ modCode: 'APPEND_BUDGET', detail: { budget: 'bytes' } });
    call.endCall('m0', 'c-0');
    expect(call.budgetKeys()).toBe(300);
    await expect(append('probe', big, 'call-1')).rejects.toMatchObject({ detail: { budget: 'bytes' } });
  });
});

/**
 * G-MOD-21 (Dimensions S1.4 pass P1; Aegis A4; spec §12.3, §12.7.1): tool-call appends cannot take the human
 * reserve. Per mod and per 1 s window at most MOD_APPEND_TOOL_ROWS_PER_SEC rows come from a call that is not a
 * command, inside the one total of MOD_APPEND_ROWS_PER_SEC, so commands always keep 15 a second.
 */
describe('G-MOD-21: the human reserve in the append budget', () => {
  function rig(start = 9_000_000) {
    const clock = { t: start };
    const landed: Array<Record<string, unknown>> = [];
    let tried = 0;
    const call = createModKernelCall({ callAs: async () => null, append: async (row) => (tried++, landed.push(row.payload), { seq: landed.length }) }, { now: () => clock.t });
    const append = (callKind: ModCallKind | undefined, tag: string, name = 'probe', callId?: string) =>
      call({ name, principal: `p:x/mod-${name}`, verb: 'log.append', params: { kind: `modns.${name}.x`, payload: { tag } }, ...(callId ? { callId } : {}), ...(callKind ? { callKind } : {}) } as Parameters<typeof call>[0]);
    return { clock, landed, append, tried: () => tried };
  }
  const RESERVE = MOD_APPEND_ROWS_PER_SEC - MOD_APPEND_TOOL_ROWS_PER_SEC;

  it('the numbers: 5 tool rows of 20, so 15 a second stay with commands', () => {
    expect([MOD_APPEND_ROWS_PER_SEC, MOD_APPEND_TOOL_ROWS_PER_SEC, RESERVE, MOD_APPEND_WINDOW_MS]).toEqual([20, 5, 15, 1_000]);
    expect([...MOD_APPEND_BUDGETS]).toEqual(['rows', 'tool-rows', 'bytes']);
    expect(MOD_REFUSAL_CODES).toContain('APPEND_BUDGET');
  });

  it('5 tool rows in the window, then 15 command rows all land, then a sixth tool row is refused APPEND_BUDGET', async () => {
    const { clock, landed, append, tried } = rig();
    for (let i = 0; i < MOD_APPEND_TOOL_ROWS_PER_SEC; i++) {
      clock.t += 10;
      await append('tool', `tool-${i}`, 'probe', 'tool-call-1');
    }
    for (let i = 0; i < RESERVE; i++) {
      clock.t += 10;
      await append('command', `command-${i}`, 'probe', `command-call-${i}`);
    }
    expect(landed).toHaveLength(MOD_APPEND_ROWS_PER_SEC);
    expect(landed.filter((p) => String(p.tag).startsWith('command-'))).toHaveLength(RESERVE);
    clock.t += 10;
    const sixth = await append('tool', 'tool-over', 'probe', 'tool-call-2').then(
      () => null,
      (e: unknown) => e,
    );
    expect(sixth).toBeInstanceOf(ModRefusal);
    expect(sixth).toMatchObject({ modCode: 'APPEND_BUDGET', detail: { name: 'probe', budget: 'tool-rows', written: false } });
    // a definite "not written": the log port was never called for it
    expect([landed.length, tried()]).toEqual([MOD_APPEND_ROWS_PER_SEC, MOD_APPEND_ROWS_PER_SEC]);
    // the route LOG had, so the socket code and the JSON-RPC number did not change; only data.modCode did
    expect((sixth as ModRefusal).refusal).toMatchObject({ code: 'BAD_REQUEST', gate: 'usage', data: { modCode: 'APPEND_BUDGET', budget: 'tool-rows', written: false } });
    // and a command row past the total is refused as `rows`, with the same code
    await expect(append('command', 'command-over')).rejects.toMatchObject({ modCode: 'APPEND_BUDGET', detail: { budget: 'rows', written: false } });
  });

  it('tool calls alone can never take more than 5: of 20 tool rows tried in one window 5 land, and 15 command rows still land after', async () => {
    const { clock, landed, append } = rig();
    const outcomes: string[] = [];
    for (let i = 0; i < MOD_APPEND_ROWS_PER_SEC; i++) {
      clock.t += 5;
      outcomes.push(await append('tool', `tool-${i}`, 'probe', `tool-call-${i}`).then(() => 'ok', (e: ModRefusal) => `${e.modCode}:${String(e.detail.budget)}`));
    }
    expect(outcomes).toEqual([...Array.from({ length: MOD_APPEND_TOOL_ROWS_PER_SEC }, () => 'ok'), ...Array.from({ length: RESERVE }, () => 'APPEND_BUDGET:tool-rows')]);
    // a refused row takes no slot: every one of the 15 reserved rows is still there
    for (let i = 0; i < RESERVE; i++) await append('command', `command-${i}`);
    expect(landed).toHaveLength(MOD_APPEND_ROWS_PER_SEC);
    await expect(append('command', 'command-over')).rejects.toMatchObject({ detail: { budget: 'rows' } });
  });

  it('the share is per window and per mod: it frees as tool rows age out, and another mod has its own', async () => {
    const { clock, landed, append } = rig();
    for (let i = 0; i < MOD_APPEND_TOOL_ROWS_PER_SEC; i++) {
      await append('tool', `tool-${i}`);
      clock.t += 100; // rows at +0 … +400; the clock ends at +500
    }
    const refused = (await append('tool', 'over').catch((e: unknown) => e)) as ModRefusal;
    expect(refused.detail).toMatchObject({ budget: 'tool-rows', written: false, retryAfterMs: 500 });
    // another mod is untouched by this one's tool rows
    await append('tool', 'other-0', 'other');
    clock.t += 499;
    await expect(append('tool', 'still-over')).rejects.toMatchObject({ detail: { budget: 'tool-rows', retryAfterMs: 1 } });
    clock.t += 1; // the first tool row is now a full window old
    await append('tool', 'after-wait');
    await expect(append('tool', 'over-again')).rejects.toMatchObject({ detail: { budget: 'tool-rows' } });
    expect(landed.map((p) => p.tag)).toEqual(['tool-0', 'tool-1', 'tool-2', 'tool-3', 'tool-4', 'other-0', 'after-wait']);
  });

  it('retryAfterMs is whole milliseconds inside the window, whatever the injected clock does (it steps back, it is fractional)', async () => {
    const { clock, append } = rig();
    for (let i = 0; i < MOD_APPEND_TOOL_ROWS_PER_SEC; i++) await append('tool', `tool-${i}`);
    clock.t -= 3_600_000; // the clock steps back an hour
    const back = (await append('tool', 'over').catch((e: unknown) => e)) as ModRefusal;
    expect(back.detail).toMatchObject({ budget: 'tool-rows', written: false, retryAfterMs: MOD_APPEND_WINDOW_MS });
    clock.t += 3_600_000 + 0.25;
    const frac = (await append('tool', 'over').catch((e: unknown) => e)) as ModRefusal;
    expect(frac.detail.retryAfterMs).toBe(MOD_APPEND_WINDOW_MS);
    clock.t += 999.5; // 0.25 ms of the window left
    expect(((await append('tool', 'over').catch((e: unknown) => e)) as ModRefusal).detail.retryAfterMs).toBe(1);
    // the row total answers the same way
    for (let i = 0; i < MOD_APPEND_ROWS_PER_SEC; i++) await append('command', `c-${i}`, 'other');
    clock.t -= 10_000;
    expect(((await append('command', 'over', 'other').catch((e: unknown) => e)) as ModRefusal).detail).toMatchObject({ budget: 'rows', retryAfterMs: MOD_APPEND_WINDOW_MS });
  });

  it('the default clock is monotonic: a wall clock that jumps does not empty or hold the window', async () => {
    const wall = vi.spyOn(Date, 'now');
    try {
      const call = createModKernelCall({ callAs: async () => null, append: async () => ({ seq: 1 }) });
      const tool = () => call({ name: 'probe', principal: 'p:x/mod-probe', verb: 'log.append', params: { kind: 'modns.probe.x', payload: {} }, callKind: 'tool' });
      const real = Date.now();
      wall.mockReturnValue(real);
      for (let i = 0; i < MOD_APPEND_TOOL_ROWS_PER_SEC; i++) await tool();
      // the wall clock jumps a minute ahead: on a wall clock the five rows would have left the window
      wall.mockReturnValue(real + 60_000);
      const refused = (await tool().catch((e: unknown) => e)) as ModRefusal;
      expect(refused).toBeInstanceOf(ModRefusal);
      expect(refused.detail.budget).toBe('tool-rows');
      expect(refused.detail.retryAfterMs).toBeGreaterThanOrEqual(1);
      expect(refused.detail.retryAfterMs).toBeLessThanOrEqual(MOD_APPEND_WINDOW_MS);
    } finally {
      wall.mockRestore();
    }
  });

  it('fails closed: only a command is outside the tool share; an idle, missing or unknown call kind counts against it', async () => {
    for (const kind of ['idle', undefined, 'view', 'COMMAND', ''] as Array<ModCallKind | undefined>) {
      const { landed, append } = rig();
      for (let i = 0; i < MOD_APPEND_TOOL_ROWS_PER_SEC; i++) await append(kind, `row-${i}`);
      await expect(append(kind, 'over')).rejects.toMatchObject({ modCode: 'APPEND_BUDGET', detail: { budget: 'tool-rows' } });
      // and it shares the one share with real tool rows
      await expect(append('tool', 'tool-over')).rejects.toMatchObject({ detail: { budget: 'tool-rows' } });
      for (let i = 0; i < RESERVE; i++) await append('command', `command-${i}`);
      expect([String(kind), landed.length]).toEqual([String(kind), MOD_APPEND_ROWS_PER_SEC]);
    }
  });

  it('a budget refusal is told apart from an append that failed: the first is APPEND_BUDGET with written false, the second is not a mod-host budget refusal at all', async () => {
    let fail = false;
    const clock = { t: 3_000_000 };
    const call = createModKernelCall({ callAs: async () => null, append: async () => (fail ? Promise.reject(new Error('disk')) : { seq: 1 }) }, { now: () => clock.t });
    const tool = () => call({ name: 'probe', principal: 'p:x/mod-probe', verb: 'log.append', params: { kind: 'modns.probe.x', payload: {} }, callKind: 'tool' });
    fail = true;
    const failed = (await tool().catch((e: unknown) => e)) as Error;
    expect(failed).not.toBeInstanceOf(ModRefusal); // the log's own failure: written or not is unknown to the mod
    fail = false;
    // the failed try still took its slot (the row may have landed), so 4 more reach the share
    for (let i = 0; i < MOD_APPEND_TOOL_ROWS_PER_SEC - 1; i++) await tool();
    const refused = (await tool().catch((e: unknown) => e)) as ModRefusal;
    expect([refused.modCode, refused.detail.written, refused.detail.budget]).toEqual(['APPEND_BUDGET', false, 'tool-rows']);
    // no other mod-host code says "budget": a payload refusal stays LOG
    await expect(call({ name: 'probe', principal: 'p', verb: 'log.append', params: { kind: 'modns.probe.x', payload: [1] }, callKind: 'command' })).rejects.toMatchObject({ modCode: 'LOG' });
  });
});
