/**
 * T-2026-10-26-003: a local turn's result line says how the run really ended (turn.result{stopReason, runUsage,
 * replyBytes} from #local-runner) — never "done" for a run that hit the step limit with no reply — and its token
 * figure is the run's whole agent_end usage (input + output), not the meter's remainder in usage.tokens.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chatItems, resultLine, STOP_LABEL, type Row } from '../src/core/store.js';

const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZ1';
const turn = (payload: Record<string, unknown>): Row[] => [
  { seq: 1, kind: 'turn.sent', view: 'full', session: H, payload: { hsid: H, turn: `turn:${H}/1`, contentHash: 'sha256:00' } },
  { seq: 2, kind: 'turn.result', view: 'full', session: H, payload: { hsid: H, backend: 'local', turn: `turn:${H}/1`, ...payload } },
];
const resultOf = (payload: Record<string, unknown>) => chatItems(turn(payload)).items.find((i) => i.role === 'result')!;

describe('the local turn result line', () => {
  it('the 2026-10-26 run: max_steps with an empty reply reads "stopped: step limit · no answer" with the run total, in the warning tone', () => {
    const it = resultOf({ stopReason: 'max_steps', isError: false, usage: { tokens: 6041 }, runUsage: { tokens: 50712, input: 48000, output: 2712 }, replyBytes: 0 });
    expect(it.text).toBe('stopped: step limit · no answer · 50,712 tokens (in 48,000 + out 2,712)');
    expect(it.text).not.toMatch(/^done/);
    expect(it.text).not.toContain('6,041');
    expect(it.tone).toBe('warn');
  });

  it('max_steps WITH a final answer still names the step limit (warning tone), but not "no answer"', () => {
    const it = resultOf({ stopReason: 'max_steps', runUsage: { tokens: 900, input: 800, output: 100 }, replyBytes: 42 });
    expect(it.text).toBe('stopped: step limit · 900 tokens (in 800 + out 100)');
    expect(it.tone).toBe('warn');
  });

  it('error and aborted say so; an error shows its message', () => {
    const er = resultOf({ stopReason: 'error', isError: true, error: 'completion failed:\n HTTP 500', runUsage: { tokens: 10, input: 10, output: 0 }, replyBytes: 0 });
    expect(er.text).toBe('error · no answer · 10 tokens (in 10 + out 0) · completion failed: HTTP 500');
    // an error is never amber: it reads in the fail tone (DESIGN rule 1, TD-2026-10-27-833)
    expect(er.tone).toBe('fail');
    const ab = resultOf({ stopReason: 'aborted', runUsage: { tokens: 5, input: 5, output: 0 }, replyBytes: 0 });
    expect(ab.text).toBe('aborted · 5 tokens (in 5 + out 0)');
    expect(ab.tone).toBeUndefined();
    expect(resultLine({ stopReason: 'length_cut' }).text).toBe('stopped: length cut');
    expect(Object.keys(STOP_LABEL)).toEqual(['max_steps', 'aborted', 'error']);
  });

  it('a normal stop with a reply reads "done" with the run total, no tone; an empty one says "no answer"', () => {
    const ok = resultOf({ stopReason: 'stop', isError: false, usage: { tokens: 0 }, runUsage: { tokens: 240, input: 200, output: 40 }, replyBytes: 5 });
    expect(ok.text).toBe('done · 240 tokens (in 200 + out 40)');
    expect(ok.tone).toBeUndefined();
    expect(resultOf({ stopReason: 'stop', runUsage: { tokens: 240 }, replyBytes: 0 }).text).toBe('done · no answer · 240 tokens');
  });

  it('a row without the local fields (older logs, Claude) reads as before', () => {
    expect(resultLine({ usage: { tokens: 1234 }, cost: 0.0123, subtype: 'success', isError: false })).toEqual({ text: 'success · $0.0123 · 1,234 tokens', tone: null });
    expect(resultLine({ hsid: H }).text).toBe('done');
  });

  it('TD-2026-10-27-833: the step limit names its number when the row carries maxSteps; older rows without it read as before', () => {
    const it = resultOf({ stopReason: 'max_steps', maxSteps: 20, runUsage: { tokens: 900, input: 800, output: 100 }, replyBytes: 0 });
    expect(it.text).toBe('stopped: step limit 20 · no answer · 900 tokens (in 800 + out 100)');
    expect(it.tone).toBe('warn');
    expect(resultLine({ stopReason: 'max_steps', replyBytes: 7 })).toEqual({ text: 'stopped: step limit', tone: 'warn' });
    // a nonsense cap is not printed; a normal stop never mentions the cap
    expect(resultLine({ stopReason: 'max_steps', maxSteps: 'x', replyBytes: 7 }).text).toBe('stopped: step limit');
    expect(resultLine({ stopReason: 'stop', maxSteps: 20, replyBytes: 7 }).text).toBe('done');
  });

  it('TD-2026-10-27-833: a failed run reads in the fail tone, local or Claude; aborted stays quiet', () => {
    // local: stopReason error (isError true), and stopReason error alone
    expect(resultOf({ stopReason: 'error', isError: true, maxSteps: 16, replyBytes: 0 }).tone).toBe('fail');
    expect(resultLine({ stopReason: 'error' }).tone).toBe('fail');
    // Claude: is_error on the result (the kernel's turn.result{subtype, isError}), and an error_* subtype
    const claude = chatItems([
      { seq: 1, kind: 'turn.sent', view: 'full', session: H, payload: { hsid: H, turn: `turn:${H}/1`, contentHash: 'sha256:00' } },
      { seq: 2, kind: 'turn.result', view: 'full', session: H, payload: { hsid: H, turn: `turn:${H}/1`, subtype: 'error_during_execution', isError: true, cost: 0.01, usage: { tokens: 50 } } },
    ]).items.find((i) => i.role === 'result')!;
    expect(claude.text).toBe('error · $0.0100 · 50 tokens');
    expect(claude.tone).toBe('fail');
    expect(resultLine({ subtype: 'error_max_turns', isError: false }).tone).toBe('fail');
    expect(resultLine({ subtype: 'success', isError: false }).tone).toBeNull();
    // aborted: quiet, never fail or warn, even with no reply
    expect(resultOf({ stopReason: 'aborted', maxSteps: 16, replyBytes: 0 }).tone).toBeUndefined();
  });

  it('the fail tone has a style on the result row (the existing --fail token, as .trow.role-error)', () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'static', 'styles.css'), 'utf8');
    expect(css).toMatch(/\.trow\.role-result\.fail \{ color: var\(--fail\); \}/);
    expect(css).toMatch(/\.trow\.role-error \{ color: var\(--fail\); \}/);
    const app = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'app.ts'), 'utf8');
    expect(app).toContain("it.tone === 'fail' ? ' fail' : ''");
  });

  it('the warning tone has a style on the result row (the existing --warn-ink token, no new colour)', () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'static', 'styles.css'), 'utf8');
    expect(css).toMatch(/\.trow\.role-result\.warn \{ color: var\(--warn-ink\); \}/);
  });
});
