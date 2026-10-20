/**
 * T-2026-10-20-001 #gui-relaunch (page side): the stale-tab channel carries two fixed shapes only, no state points
 * to a terminal as the only path, and the origin poll reports down → back and stops when told.
 */
import { describe, expect, it } from 'vitest';
import { parseStaleMsg, staleView, watchStale, type StaleState } from '../src/core/stale.js';

describe('stale-tab channel', () => {
  it('accepts exactly {t:attached} and {t:who}', () => {
    expect(parseStaleMsg({ t: 'attached' })).toEqual({ t: 'attached' });
    expect(parseStaleMsg({ t: 'who' })).toEqual({ t: 'who' });
  });
  it('falsifier: anything carrying more (a token, a key) or another shape is ignored', () => {
    for (const d of [null, 'attached', [], { t: 'attached', launchToken: 'x' }, { t: 'resume' }, { t: 'who', k: 'K' }, {}]) expect(parseStaleMsg(d)).toBeNull();
  });
});

describe('staleView', () => {
  it('every state names a non-terminal way back first; reopened offers the one click (close this tab)', () => {
    for (const s of ['down', 'answering', 'reopened'] as const) {
      const v = staleView(s);
      expect(v.text).not.toMatch(/^run `gnomon`/);
      expect(v.text).not.toMatch(/running again/i); // Aegis L3: a poll answer is never proof of Gnomon
      if (s !== 'answering') expect(v.text).not.toMatch(/reload/i);
      if (s !== 'reopened') expect(v.text).toMatch(/Gnomon\.app|by itself/);
    }
    expect(staleView('reopened').action).toBe('close');
    expect(staleView('down').action).toBe('reconnect');
    expect(staleView('answering').text).toMatch(/Do not reload/);
    expect(staleView('answering').text).toMatch(/cannot tell whether it is Gnomon/);
  });
});

describe('watchStale', () => {
  it('reports down, then answering, once each, and stops when told', async () => {
    const seen: StaleState[] = [];
    const answers = [false, false, true, true];
    let i = 0;
    let stop = false;
    await watchStale({
      origin: 'http://127.0.0.1:5',
      fetchFn: async (u) => {
        expect(u).toBe('http://127.0.0.1:5/');
        const ok = answers[i++] ?? true;
        if (i >= answers.length) stop = true;
        return { ok };
      },
      between: async () => undefined,
      onState: (s) => seen.push(s),
      stopped: () => stop,
    });
    expect(seen).toEqual(['down', 'answering']);
  });
  it('a fetch that throws is down', async () => {
    const seen: StaleState[] = [];
    let n = 0;
    await watchStale({ origin: 'o', fetchFn: async () => { n++; throw new Error('refused'); }, between: async () => undefined, onState: (s) => seen.push(s), stopped: () => n >= 3 });
    expect(seen).toEqual(['down']);
  });
});
