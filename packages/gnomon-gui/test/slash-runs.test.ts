/**
 * #gui-slash-runs (slice C6'b2-1, G-GUI-20): a "/" run's row through its states (core/slash-runs.ts, PURE): running,
 * ran (data fold, isError, the policy word), refused (words and next:, the minute limit said here), carded (read once
 * after allow; gone; denied), and the kernel's tool.brokered{author:'human'} row as history.
 */
import { describe, expect, it } from 'vitest';
import { DATA_FOLD_AT, dataFoldOf, policyWord, rateWaitSecs, runReducer, runRefusalWords, runRowOf, runWords, settledDecisionOf, startRun, type RunView } from '../src/core/slash-runs.js';

const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const RUN = `run-${'a'.repeat(24)}`;
const base = (o: Partial<RunView> = {}): RunView => ({ ...startRun({ key: 'lr-1', hsid: H, tool: 'grep', server: 'fs', toolId: 'fs/grep@0123abcd', cls: 'read', policy: null, at: '2026-10-28T12:00:00.000Z' }), ...o });

describe('#gui-slash-runs: the reducer', () => {
  it('running → ran: the result held, the policy word, a data fold', () => {
    const r = runReducer(base(), { type: 'reply', v: { hsid: H, status: 'ran', runId: RUN, content: 'a\nb', isError: false } });
    expect(r).toMatchObject({ phase: 'ran', runId: RUN, content: 'a\nb', isError: false });
    const w = runWords(r);
    expect(w).toMatchObject({ head: 'you ran grep on fs', state: 'ran', policy: 'kept here; not sent', tone: null });
    expect(w.data!.lines).toEqual(['a', 'b']);
  });

  it('an isError result says so', () => {
    const r = runReducer(base(), { type: 'reply', v: { status: 'ran', runId: RUN, content: 'boom', isError: true } });
    expect(runWords(r)).toMatchObject({ state: '✕ the tool returned an error', tone: 'fail' });
  });

  it('refused: words and next:, never the code; the tool’s own text stays in the data fold', () => {
    const r = runReducer(base(), { type: 'reply', v: { status: 'refused', runId: RUN, why: 'bad-args', content: 'grep: pattern must be a string', isError: true } });
    const w = runWords(r);
    expect(w.state).toBe('not run: its arguments don’t fit the tool');
    expect(w.next).toBe('fix them and run it again');
    expect(w.data!.lines).toEqual(['grep: pattern must be a string']);
    expect(w.state).not.toContain('bad-args');
    for (const why of ['servers-off', 'unknown-tool', 'untrusted', 'no-approval-surface', 'not-running', 'loop-session', 'allowed-cancelled', 'xyz']) {
      const t = runRefusalWords(why, { server: 'fs' });
      expect(t.text).not.toContain(why);
      expect(t.text.length).toBeGreaterThan(8);
    }
  });

  it('the human limit: "10 runs a minute from /; try again in Ns"', () => {
    const r = runReducer(base(), { type: 'reply', v: { status: 'refused', runId: RUN, why: 'busy', content: 'At most 10 "/" runs per minute: wait a moment.' }, waitSecs: 23 });
    expect(runWords(r).state).toBe('not run: 10 runs a minute from /; try again in 23s');
    const other = runReducer(base(), { type: 'reply', v: { status: 'refused', why: 'busy', content: 'Another call that needs the human is already waiting: wait for it.' } });
    expect(runWords(other).state).toBe('not run: another call is waiting for you');
    const now = 100_000;
    expect(rateWaitSecs(Array.from({ length: 10 }, (_, i) => now - 50_000 + i * 1000), now)).toBe(10);
    expect(rateWaitSecs([], now)).toBe(1);
  });

  it('carded → settled allowed → read once → ran; a second read event changes nothing', () => {
    let r = runReducer(base({ cls: 'mutate' }), { type: 'reply', v: { status: 'carded', runId: RUN, cardId: 'card:1', isError: false } });
    expect(runWords(r)).toMatchObject({ state: 'waiting for your card', key: 'decide' });
    r = runReducer(r, { type: 'settled', decision: 'approved' });
    expect(r.phase).toBe('carded');
    r = runReducer(r, { type: 'read' });
    expect(r).toMatchObject({ phase: 'reading', read: true });
    expect(runReducer(r, { type: 'read' })).toBe(r);
    const still = runReducer(r, { type: 'result', v: { status: 'carded', pending: true } });
    expect(still.phase).toBe('reading');
    r = runReducer(r, { type: 'result', v: { status: 'ran', runId: RUN, content: 'done', isError: false } });
    expect(r).toMatchObject({ phase: 'ran', content: 'done' });
  });

  it('carded → gone (held 10 min) and denied', () => {
    const carded = runReducer(base(), { type: 'reply', v: { status: 'carded', runId: RUN, cardId: 'card:1' } });
    const gone = runReducer(runReducer(carded, { type: 'read' }), { type: 'result-failed', reason: 'not-found', network: false });
    expect(runWords(gone)).toMatchObject({ state: 'held 10 min; it’s gone', next: 'run it again' });
    expect(runWords(runReducer(carded, { type: 'settled', decision: 'denied' })).state).toBe('you denied it; nothing ran');
    expect(runWords(runReducer(carded, { type: 'settled', decision: 'expired' })).state).toBe('not run: its card expired; nothing ran');
  });

  it('a request that failed: words, never the code; the network is "not known"', () => {
    expect(runWords(runReducer(base(), { type: 'failed', reason: 'not-found', network: false })).state).toBe('not run: this session isn’t running any more');
    expect(runWords(runReducer(base(), { type: 'failed', reason: null, network: true })).state).toMatch(/not known whether it ran/);
  });

  it('an answer that is not one the page reads', () => {
    expect(runWords(runReducer(base(), { type: 'reply', v: 'x' })).state).toMatch(/not one this page reads/);
    expect(runReducer(base(), { type: 'reply', v: { status: 'carded', runId: 'bad' } }).phase).toBe('refused');
  });

  it('settledDecisionOf matches only our card’s human row', () => {
    const row = { kind: 'tool.brokered', payload: { hsid: H, author: 'human', cardId: 'card:1', decision: 'approved' } };
    expect(settledDecisionOf(row, 'card:1')).toBe('approved');
    expect(settledDecisionOf(row, 'card:2')).toBeNull();
    expect(settledDecisionOf({ kind: 'tool.brokered', payload: { cardId: 'card:1', decision: 'approved' } }, 'card:1')).toBeNull();
  });
});

describe('#gui-slash-runs: the data fold and the policy word', () => {
  it('folds past 12 lines; open shows all; text is sanitized', () => {
    const long = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
    const f = dataFoldOf(long, false);
    expect(f).toMatchObject({ total: 30, folded: true, key: 'show all 30 lines' });
    expect(f.lines).toHaveLength(DATA_FOLD_AT);
    expect(dataFoldOf(long, true)).toMatchObject({ folded: false, key: 'fold it' });
    expect(dataFoldOf('x‮y', false).lines[0]).not.toContain('‮');
    expect(dataFoldOf('short', false).key).toBeNull();
  });
  it('send: goes with your next message; ask and not chosen: kept here', () => {
    expect(policyWord('send')).toBe('goes with your next message');
    expect(policyWord('ask')).toBe('kept here; not sent');
    expect(policyWord(null)).toBe('kept here; not sent');
  });
});

describe('#gui-slash-runs: history (runRowOf)', () => {
  it('a human tool.brokered row reads as a run row with no result; others are null', () => {
    expect(runRowOf({ kind: 'tool.brokered', payload: { hsid: H, server: 'fs', tool: 'grep', decision: 'ran', author: 'human', isError: false } })!.words.state).toMatch(/^ran · /);
    expect(runRowOf({ kind: 'tool.brokered', payload: { server: 'fs', tool: 'rm', decision: 'denied', author: 'human' } })!.words.state).toBe('you denied it; nothing ran');
    expect(runRowOf({ kind: 'tool.brokered', payload: { server: 'gnomon', decision: 'unknown-tool', author: 'human' } })!.words.head).toBe('you ran a tool on gnomon');
    expect(runRowOf({ kind: 'tool.brokered', payload: { server: 'fs', decision: 'busy', author: 'human' } })!.words.state).toBe('not run: too many at once');
    expect(runRowOf({ kind: 'tool.brokered', payload: { server: 'fs', tool: 'grep', decision: 'ran' } })).toBeNull();
    expect(runRowOf({ kind: 'turn.sent', payload: {} })).toBeNull();
  });
});
