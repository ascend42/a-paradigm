/**
 * #gui-slash-runs (slice C6'b2-1, G-GUI-20): a "/" run's row through its states (core/slash-runs.ts, PURE): running,
 * ran (data fold, isError, the policy word), refused (words and next:, the minute limit said here), carded (read once
 * after allow; gone; denied), and the kernel's tool.brokered{author:'human'} row as history.
 */
import { describe, expect, it } from 'vitest';
import { canSend, DATA_FOLD_AT, dataFoldOf, policyLine, policyWord, rateWaitSecs, sendRefusalWords, runReducer, runRefusalWords, runRowOf, runWords, settledDecisionOf, startRun, type RunView } from '../src/core/slash-runs.js';

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

describe("#gui-slash-runs: Send this one (C6'b2-2)", () => {
  const ran = (policy: 'send' | 'ask' | null) => runReducer(base({ policy, goes: policy === 'send' }), { type: 'reply', v: { status: 'ran', runId: RUN, content: 'x', isError: false } });

  it('under ask a ran row offers Send this one; under send or not chosen it does not', () => {
    expect(runWords(ran('ask'))).toMatchObject({ policy: 'kept here; not sent', sendKey: 'idle', sendNote: null });
    expect(runWords(ran('send'))).toMatchObject({ policy: 'goes with your next message', sendKey: null });
    expect(runWords(ran(null)).sendKey).toBeNull();
    expect(canSend(runReducer(base({ policy: 'ask' }), { type: 'failed', reason: null, network: true }))).toBe(false);
  });

  it('sending → sent: "sent with your next message", and no key again', () => {
    const s1 = runReducer(ran('ask'), { type: 'sending' });
    expect(runWords(s1).sendKey).toBe('busy');
    expect(runReducer(s1, { type: 'sending' })).toBe(s1);
    const s2 = runReducer(s1, { type: 'sent', v: { hsid: H, runId: RUN, policy: 'once', queued: true, tainted: true } });
    expect(runWords(s2)).toMatchObject({ policy: 'sent with your next message', sendKey: null });
    expect(policyLine(s2)).toBe('sent with your next message');
  });

  it('refusals in words: already sent, expired (not-found), changed, already sending; the network may be pressed again', () => {
    expect(sendRefusalWords('already-sent', false, 'grep')).toMatchObject({ text: 'this result was already sent', retry: false });
    expect(sendRefusalWords('not-found', false, 'grep')).toMatchObject({ text: 'held 10 min; it’s gone', next: 'run it again' });
    expect(sendRefusalWords('changed', false, 'grep').text).toBe('the tool or its server’s trust changed since it ran, so it isn’t sent');
    expect(sendRefusalWords('already-sending', false, 'grep').text).toBe('grep already sends its results; this one ran before that');
    const gone = runReducer(runReducer(ran('ask'), { type: 'sending' }), { type: 'send-failed', reason: 'not-found', network: false });
    expect(runWords(gone)).toMatchObject({ sendKey: null, sendNote: 'not sent: held 10 min; it’s gone · next: run it again', policy: 'kept here; not sent' });
    const net = runReducer(runReducer(ran('ask'), { type: 'sending' }), { type: 'send-failed', reason: null, network: true });
    expect(runWords(net).sendKey).toBe('idle');
    for (const w of Object.values(runWords(gone))) if (typeof w === 'string') expect(w).not.toMatch(/not-found|already-sent|RpcError/);
  });

  it('an answer that is not one the page reads is no "sent"', () => {
    const r = runReducer(runReducer(ran('ask'), { type: 'sending' }), { type: 'sent', v: { queued: false } });
    expect(r.send).toBe('refused');
    expect(runWords(r).policy).toBe('kept here; not sent');
  });
});

describe("#gui-slash-runs: the first-use question (C6'b2-2)", () => {
  const ran = () => runReducer(base({ policy: null }), { type: 'reply', v: { status: 'ran', runId: RUN, content: 'x', isError: false } });

  it('a ran row of a tool not chosen asks inline: "Send grep’s results to the model?"', () => {
    expect(runWords(ran()).question).toEqual({ text: 'Send grep’s results to the model?', busy: null });
    expect(runWords(base({ policy: null })).question).toBeNull(); // still running
    expect(runWords(runReducer(base({ policy: 'ask' }), { type: 'reply', v: { status: 'ran', runId: RUN, content: 'x' } })).question).toBeNull();
  });

  it('Always send: busy, then the policy with queued: the row goes; Keep to me: ask and Send this one', () => {
    const busy = runReducer(ran(), { type: 'choosing', policy: 'send' });
    expect(runWords(busy).question!.busy).toBe('send');
    expect(runReducer(busy, { type: 'choosing', policy: 'ask' })).toBe(busy);
    const sent = runReducer(busy, { type: 'policy', policy: 'send', queued: true });
    expect(runWords(sent)).toMatchObject({ question: null, policy: 'goes with your next message', sendKey: null });
    const kept = runReducer(runReducer(ran(), { type: 'choosing', policy: 'ask' }), { type: 'policy', policy: 'ask' });
    expect(runWords(kept)).toMatchObject({ question: null, policy: 'kept here; not sent', sendKey: 'idle' });
  });

  it('a refused choice reads in words and the question stays', () => {
    const r = runReducer(runReducer(ran(), { type: 'choosing', policy: 'send' }), { type: 'choose-failed', reason: 'untrusted', network: false });
    expect(runWords(r)).toMatchObject({ question: { busy: null }, questionNote: 'fs isn’t trusted, so its results are never sent · next: trust it in Settings › MCP servers' });
  });
});
