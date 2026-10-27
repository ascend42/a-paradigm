/**
 * Slice B1 (TD-2026-10-27-833): the context ledger — slot arithmetic, native
 * vs text tools, and the old round-2 budget (0.85 × target minus the native
 * schema) preserved as messageBudget.
 */
import { describe, expect, it } from 'vitest';
import { contextLedger, contextReport, resultCapChars, TARGET_HEADROOM } from '../src/index.js';

describe('the context ledger', () => {
  it('native tools: the schema is its own slot and comes off the message budget', () => {
    const l = contextLedger({ target: 8192, systemMessageTokens: 40, toolsTokens: 510, toolsInSystem: false, replyTokens: 1024 });
    expect(TARGET_HEADROOM).toBe(0.85);
    expect(l.usable).toBe(Math.floor(8192 * 0.85));
    expect(l.slots).toEqual({ system: 40, memory: 0, tools: 510, history: 6963 - 40 - 510 - 1024, reply: 1024 });
    expect(l.messageBudget).toBe(6963 - 510);
    // the slots add up to the usable part of the target
    expect(Object.values(l.slots).reduce((a, b) => a + b, 0)).toBe(l.usable);
  });
  it('text tools: the prompt lives inside the system message, so it is split out of system and not subtracted twice', () => {
    const l = contextLedger({ target: 8192, systemMessageTokens: 540, toolsTokens: 500, toolsInSystem: true, replyTokens: 1024 });
    expect(l.slots).toEqual({ system: 40, memory: 0, tools: 500, history: 6963 - 540 - 1024, reply: 1024 });
    expect(l.messageBudget).toBe(6963);
  });
  it('native and text modes with the same tools leave the same history slot', () => {
    const native = contextLedger({ target: 4096, systemMessageTokens: 30, toolsTokens: 300, toolsInSystem: false, replyTokens: 512 });
    const text = contextLedger({ target: 4096, systemMessageTokens: 330, toolsTokens: 300, toolsInSystem: true, replyTokens: 512 });
    expect(native.slots).toEqual(text.slots);
  });
  it('the message budget is exactly "history + reply fit": messages (system included) + reply ≤ budget ⇔ history used ≤ slot', () => {
    for (const toolsInSystem of [false, true]) {
      const sys = toolsInSystem ? 340 : 40;
      const l = contextLedger({ target: 8192, systemMessageTokens: sys, toolsTokens: 300, toolsInSystem, replyTokens: 1024 });
      const history = l.slots.history;
      expect(sys + history + 1024).toBe(l.messageBudget);
    }
  });
  it('memory (slice B2) is reserved off the history and the message budget; never negative', () => {
    const l = contextLedger({ target: 2048, systemMessageTokens: 1000, toolsTokens: 700, toolsInSystem: false, replyTokens: 256, memoryTokens: 200 });
    expect(l.slots.history).toBe(0);
    expect(l.slots.memory).toBe(200);
    expect(l.messageBudget).toBe(Math.floor(2048 * 0.85) - 200 - 700);
    expect(contextLedger({ target: -5, systemMessageTokens: NaN, toolsTokens: -1, toolsInSystem: false, replyTokens: 0 }).slots).toEqual({ system: 0, memory: 0, tools: 0, history: 0, reply: 0 });
  });
  it('a result cap is min(1500 tokens, the history slot shared by the turn\'s calls), in chars, never below 512', () => {
    const l = contextLedger({ target: 8192, systemMessageTokens: 40, toolsTokens: 510, toolsInSystem: false, replyTokens: 1024 });
    expect(resultCapChars(l, 1)).toBe(6000);
    expect(resultCapChars(l, 4)).toBe(Math.floor(l.slots.history / 4) * 4);
    expect(resultCapChars(l, 0)).toBe(6000);
    const tiny = contextLedger({ target: 1024, systemMessageTokens: 400, toolsTokens: 200, toolsInSystem: false, replyTokens: 256 });
    expect(resultCapChars(tiny, 8)).toBe(512);
  });
  it('the context_report event carries the slots, target, used history and compactions', () => {
    const l = contextLedger({ target: 8192, systemMessageTokens: 40, toolsTokens: 510, toolsInSystem: false, replyTokens: 1024 });
    expect(contextReport(l, 3, 1, 1234)).toEqual({ type: 'context_report', turn: 3, target: 8192, slots: l.slots, historyUsed: 1234, compactions: 1 });
  });
});
