// #gui-turn-steps (founder 2026-10-23): the working key names what the turn does now (a tool, a hook, thinking,
// finishing), unfolds this turn's steps, and the turn leaves one quiet hook-result line under its reply. The hook lines
// below are the shapes claude 2.1.309 wrote under --include-hook-events in a scratch session (ids shortened).
import { describe, expect, it } from 'vitest';
import { itemSig, liveText, workNow, workParts } from '../src/core/live-turn.js';
import { chatItems, foldActivity, rowDetail, type Row } from '../src/core/store.js';
import { HOOK_DWELL_MS, hookCommandName, hookFactsOf, hookOutcome, hookParts, secsText, StepTracker, stepFoldKey, stepParts, stepsFoldKey, stepText, withStepFolds } from '../src/core/turn-steps.js';

const H = 'hsid:v1:01M5E2G1TRBTMST63ZAY9V0W7D';
const at = (hms: string): string => `2026-10-23T${hms}Z`;
const ev = (seq: number, hms: string, line: Record<string, unknown>, type = String(line.type)): Row => ({ seq, kind: 'turn.event', view: 'full', at: at(hms), session: H, payload: { hsid: H, type, seq, line: JSON.stringify(line) } });
const row = (seq: number, kind: string, hms: string, payload: Record<string, unknown> = {}): Row => ({ seq, kind, view: 'full', at: at(hms), session: H, payload: { hsid: H, ...payload } });
const started = (id: string, name = 'Stop') => ({ type: 'system', subtype: 'hook_started', hook_id: id, hook_name: name, hook_event: name.split(':')[0], uuid: 'u', session_id: 's' });
const response = (id: string, o: Record<string, unknown>, name = 'Stop') => ({ type: 'system', subtype: 'hook_response', hook_id: id, hook_name: name, hook_event: name.split(':')[0], output: '', stdout: '', stderr: '', exit_code: 0, outcome: 'success', uuid: 'u', session_id: 's', ...o });
const se = (event: Record<string, unknown>) => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: 's' });
const feedback = (text: string) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: 's', isSynthetic: true });
const tracker = (rows: Array<[number, string, Record<string, unknown>]>): StepTracker => {
  const t = new StepTracker();
  for (const [seq, hms, line] of rows) t.push(seq, at(hms), JSON.stringify(line));
  return t;
};

describe('#gui-turn-steps hook lines (claude 2.1.309 shapes)', () => {
  it('names a hook by its event and matcher; the command is never on the line', () => {
    expect(hookParts('PreToolUse:Bash', 'PreToolUse')).toEqual({ event: 'PreToolUse', matcher: 'Bash' });
    expect(hookParts('SessionStart:startup', 'SessionStart')).toEqual({ event: 'SessionStart', matcher: 'startup' });
    expect(hookParts('Stop', 'Stop')).toEqual({ event: 'Stop', matcher: null });
    expect(hookParts('<b>x</b>', 42)).toEqual({ event: 'hook', matcher: null });
  });
  it('reads the outcome: exit 2 or a JSON block is blocked; cancelled is a timeout; exit 1 failed', () => {
    expect(hookOutcome(response('a', { exit_code: 2, outcome: 'error', stderr: 'Please also say the word banana.\nsecond line of reason\n' }))).toEqual({ outcome: 'blocked', note: 'Please also say the word banana.' });
    expect(hookOutcome(response('a', { stdout: '{"decision":"block","reason":"JSON reason first line\\nmore"}\n' }))).toEqual({ outcome: 'blocked', note: 'JSON reason first line' });
    expect(hookOutcome(response('a', { exit_code: 1, outcome: 'cancelled' }))).toEqual({ outcome: 'timed out' });
    expect(hookOutcome(response('a', { exit_code: 1, outcome: 'error', stderr: 'fail stderr\n' }))).toEqual({ outcome: 'failed', note: 'exit 1' });
    expect(hookOutcome(response('a', { stdout: 'stop hook stdout line\n', stderr: 'stop hook stderr line\n' }))).toEqual({ outcome: 'ok' });
    // a SessionStart hook's additionalContext JSON is not a block
    expect(hookOutcome(response('a', { stdout: '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"x"}}' }))).toEqual({ outcome: 'ok' });
  });
  it("a hook command's short name is its script's basename", () => {
    expect(hookCommandName('sh .claude/block.sh')).toBe('block.sh');
    expect(hookCommandName('node "/Users/a/.atelier/hooks/ui-gate.mjs" stop')).toBe('ui-gate.mjs');
    expect(hookCommandName('bash /Users/a/.claude/plugins/cache/a-paradigm/paradigm/7.15.2/hooks/paradigm-stop.sh')).toBe('paradigm-stop.sh');
    expect(hookCommandName('echo post-done')).toBe('echo');
  });
  it('secs: one decimal under 90 s', () => {
    expect(secsText(30_100)).toBe('30.1s');
    expect(secsText(400)).toBe('0.4s');
    expect(secsText(125_000)).toBe('2m 5s');
  });
});

describe('#gui-turn-steps the working key', () => {
  it('one Stop hook running: "Stop hook", its clock from the hook start', () => {
    const t = tracker([
      [1, '16:09:06.000', se({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })],
      [2, '16:09:07.000', se({ type: 'message_stop' })],
      [3, '16:09:07.100', started('h1')],
    ]);
    expect(t.now()).toEqual({ label: 'Stop hook', since: at('16:09:07.100'), aria: 'waiting on a Stop hook', under: { label: 'finishing', since: at('16:09:06.000'), aria: 'finishing the turn' } });
    expect(liveText({ role: 'working', live: { since: at('16:08:00.000'), now: t.now()! } }, Date.parse(at('16:09:19.300')))).toBe('Stop hook · 12s');
  });
  it('Mika (flicker): a hook takes the key only after HOOK_DWELL_MS; a fast PreToolUse hook never does', () => {
    const t = tracker([
      [1, '00:00:00.000', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }] }, parent_tool_use_id: null }],
      [2, '00:00:00.100', started('p', 'PreToolUse:Bash')],
    ]);
    const live = { since: at('00:00:00.000'), now: t.now()! };
    expect(t.now()?.label).toBe('PreToolUse hook · Bash');
    expect(workNow(live, Date.parse(at('00:00:00.150')))?.label).toBe('Bash · npm test');
    expect(liveText({ role: 'working', live }, Date.parse(at('00:00:00.900')))).toBe('Bash · npm test · 0s');
    expect(workParts(live, Date.parse(at('00:00:01.200')))).toEqual({ label: 'PreToolUse hook · Bash', clock: ' · 1s', aria: 'waiting on a PreToolUse hook · Bash' });
    expect(HOOK_DWELL_MS).toBe(1000);
  });
  it('Mika: a step splits into words that may ellipsize and a tail that never does', () => {
    const t = tracker([[1, '00:00:00.0', started('a')], [2, '00:00:00.2', response('a', { exit_code: 1, outcome: 'error' })]]);
    expect(stepParts(t.steps[0]!)).toEqual({ label: 'Stop hook', tail: ' · 0.2s · failed (exit 1)' });
    expect(stepText(t.steps[0]!)).toBe('Stop hook · 0.2s · failed (exit 1)');
  });
  it('several hooks: "Stop hooks · 3 running" from the earliest; mixed events: "hooks · 2 running"', () => {
    const t = tracker([[1, '00:00:01', started('a')], [2, '00:00:02', started('b')], [3, '00:00:02', started('c')]]);
    expect(t.now()).toMatchObject({ label: 'Stop hooks · 3 running', since: at('00:00:01') });
    const u = tracker([[1, '00:00:01', started('a', 'PostToolUse:Edit')], [2, '00:00:02', started('b')]]);
    expect(u.now()?.label).toBe('hooks · 2 running');
  });
  it('the reply ended and nothing explains the wait: finishing (from the end_turn)', () => {
    const t = tracker([
      [1, '16:09:06.000', se({ type: 'message_start', message: { id: 'm1' } })],
      [2, '16:09:06.100', se({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })],
      [3, '16:09:06.900', se({ type: 'content_block_stop', index: 0 })],
      [4, '16:09:07.000', se({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })],
      [5, '16:09:07.050', se({ type: 'message_stop' })],
      [6, '16:09:07.100', started('h1')],
      [7, '16:09:37.200', response('h1', { exit_code: 1, outcome: 'cancelled' })],
    ]);
    expect(t.now()).toEqual({ label: 'finishing', since: at('16:09:07.000'), aria: 'finishing the turn' });
    // the founder's case: the 30 s Stop hook timed out
    expect(t.summary()).toEqual({ text: 'Stop hook · 30.1s · timed out', warn: true });
  });
  it('thinking, writing, a tool call (calling, then its target) until its result', () => {
    const t = tracker([
      [1, '00:00:00.0', se({ type: 'message_start', message: { id: 'm1' } })],
      [2, '00:00:00.1', se({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } })],
    ]);
    expect(t.now()?.label).toBe('thinking');
    t.push(3, at('00:00:02.0'), JSON.stringify(se({ type: 'content_block_stop', index: 0 })));
    t.push(4, at('00:00:02.1'), JSON.stringify(se({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } })));
    expect(t.now()?.label).toBe('calling Bash');
    t.push(5, at('00:00:02.3'), JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }] }, parent_tool_use_id: null }));
    t.push(6, at('00:00:02.4'), JSON.stringify(se({ type: 'content_block_stop', index: 1 })));
    expect(t.now()).toMatchObject({ label: 'Bash · npm test', since: at('00:00:02.1'), aria: 'running Bash · npm test' });
    // a PreToolUse hook names itself while it runs, then the tool again
    t.push(7, at('00:00:02.5'), JSON.stringify(started('p1', 'PreToolUse:Bash')));
    expect(t.now()?.label).toBe('PreToolUse hook · Bash');
    t.push(8, at('00:00:02.6'), JSON.stringify(response('p1', { stdout: 'pre hook says hi\n' }, 'PreToolUse:Bash')));
    expect(t.now()?.label).toBe('Bash · npm test');
    // a sub-agent's lines are not this turn's steps
    t.push(9, at('00:00:03.0'), JSON.stringify({ ...se({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }), parent_tool_use_id: 'toolu_1' }));
    expect(t.now()?.label).toBe('Bash · npm test');
    t.push(10, at('00:00:05.0'), JSON.stringify({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'boom', is_error: true }] }, parent_tool_use_id: null }));
    expect(t.now()).toBeNull();
    expect(t.steps.map(stepText)).toEqual(['thinking · 1.9s', 'Bash · npm test · 2.9s · error', 'PreToolUse hook · Bash · 0.1s · ok']);
    expect(t.steps.find((s) => s.key === 'tool:toolu_1')!.seqs).toEqual([4, 5, 10]);
    expect(t.summary()).toEqual({ text: '1 tool call failed', warn: false });
  });
  it('a status line (compacting) is a step until it clears', () => {
    const t = tracker([[1, '00:00:00', { type: 'system', subtype: 'status', status: 'compacting' }]]);
    expect(t.now()?.label).toBe('compacting');
    t.push(2, at('00:00:09'), JSON.stringify({ type: 'system', subtype: 'status', status: null }));
    expect(t.now()).toBeNull();
  });
});

describe('#gui-turn-steps the hook-result summary', () => {
  it('three Stop hooks (measured order): one blocks (exit 2, named by Claude feedback), one fails, one times out', () => {
    const t = tracker([
      [1, '16:17:16.000', started('blk')],
      [2, '16:17:16.000', started('slow')],
      [3, '16:17:16.001', started('fail')],
      [4, '16:17:16.050', response('fail', { output: 'fail stderr\n', stderr: 'fail stderr\n', exit_code: 1, outcome: 'error' })],
      [5, '16:17:16.060', response('blk', { output: 'Please also say the word banana.\nsecond line of reason\n', stderr: 'Please also say the word banana.\nsecond line of reason\n', exit_code: 2, outcome: 'error' })],
      [6, '16:17:16.070', feedback('Stop hook feedback:\n[sh .claude/block.sh]: Please also say the word banana.\nsecond line of reason\n')],
      [7, '16:17:18.000', response('slow', { exit_code: 1, outcome: 'cancelled' })],
    ]);
    expect(t.summary()).toEqual({ text: '3 Stop hooks · 2.0s · block.sh blocked: Please also say the word banana., failed (exit 1), timed out', warn: true });
  });
  it('a JSON block on one hook: blocked with its reason first line', () => {
    const t = tracker([
      [1, '00:00:00.000', started('j')],
      [2, '00:00:00.300', response('j', { stdout: '{"decision":"block","reason":"JSON reason first line\\nmore"}\n' })],
      [3, '00:00:00.310', feedback('Stop hook feedback:\nJSON reason first line\nmore')],
    ]);
    expect(t.summary()).toEqual({ text: 'Stop hook · 0.3s · blocked: JSON reason first line', warn: true });
  });
  it('fast ok hooks show nothing; a slow ok group is one quiet line', () => {
    expect(tracker([[1, '00:00:00.0', started('a')], [2, '00:00:00.4', response('a', {})]]).summary()).toBeNull();
    expect(tracker([[1, '00:00:00.0', started('a')], [2, '00:00:00.0', started('b')], [3, '00:00:01.2', response('a', {})], [4, '00:00:03.1', response('b', {})]]).summary()).toEqual({ text: '2 Stop hooks · 3.1s · ok', warn: false });
  });
  it('a later group of the same event is its own part (the Stop hook ran again after a block)', () => {
    const t = tracker([
      [1, '00:00:00.0', started('a')],
      [2, '00:00:00.2', response('a', { exit_code: 2, outcome: 'error', stderr: 'fix it' })],
      [3, '00:00:05.0', started('b')],
      [4, '00:00:07.5', response('b', {})],
    ]);
    expect(t.summary()).toEqual({ text: 'Stop hook · 0.2s · blocked: fix it; Stop hook · 2.5s · ok', warn: true });
  });
});

describe('#gui-turn-steps in the transcript', () => {
  const turn = (): Row[] => [
    row(10, 'turn.sent', '16:08:50.000', { turn: `turn:${H}/1` }),
    ev(11, '16:08:51.000', { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'say hi' }] }, isReplay: true }),
    ev(12, '16:09:06.500', { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hi!' }] }, parent_tool_use_id: null }),
    ev(13, '16:09:07.000', se({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })),
    ev(14, '16:09:07.010', se({ type: 'message_stop' })),
    ev(15, '16:09:07.100', started('h1'), 'system.hook_started'),
  ];
  it('while the Stop hook runs the working key names it; the hook lines stay out of the chat', () => {
    const { items } = chatItems(turn(), { live: true });
    const w = items.find((x) => x.role === 'working')!;
    expect(w.live?.now).toMatchObject({ label: 'Stop hook', since: at('16:09:07.100'), aria: 'waiting on a Stop hook', under: { label: 'finishing' } });
    expect(w.steps?.map((s) => s.key)).toEqual(['hook:h1']);
    expect(items.map((x) => x.role)).toEqual(['user', 'assistant', 'working']);
  });
  it('the result: one warn hook line under the reply, before the result; Claude feedback is not a user message', () => {
    const rows = [
      ...turn(),
      ev(16, '16:09:07.200', response('h1', { exit_code: 2, outcome: 'error', stderr: 'Update the .purpose file first.\n' }), 'system.hook_response'),
      ev(17, '16:09:07.210', feedback('Stop hook feedback:\n[bash /x/hooks/paradigm-stop.sh]: Update the .purpose file first.\n'), 'user'),
      ev(18, '16:09:09.000', { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Updated.' }] }, parent_tool_use_id: null }),
      ev(19, '16:09:09.500', started('h2'), 'system.hook_started'),
      ev(20, '16:09:10.700', response('h2', {}), 'system.hook_response'),
      row(21, 'turn.result', '16:09:10.800', { subtype: 'success', isError: false, turn: `turn:${H}/1` }),
    ];
    const { items } = chatItems(rows, { live: true });
    expect(items.map((x) => `${x.role}: ${x.text}`)).toEqual([
      'user: say hi',
      'assistant: Hi!',
      'assistant: Updated.',
      'hook: Stop hook · paradigm-stop.sh · 0.1s · blocked: Update the .purpose file first.',
      'result: success',
    ]);
    expect(items.find((x) => x.role === 'hook')!.tone).toBe('warn');
    // no working row after the result; the raw view is untouched (every row is its one-line summary)
    expect(items.some((x) => x.role === 'working')).toBe(false);
    expect(chatItems(rows, { raw: true }).items.every((x) => x.role === 'raw')).toBe(true);
  });
  it("a synthetic line never names the session (it is Claude's, not the human's)", () => {
    const { items } = chatItems([ev(1, '00:00:00', feedback('Stop hook feedback:\nx')), ev(2, '00:00:01', feedback('Something Claude added'))]);
    expect(items.map((x) => `${x.role}: ${x.text}`)).toEqual(['claude-note: Claude · Something Claude added']);
  });
  it('Aegis M1: a synthetic line imitating a kernel note is Claude\'s note, never a system row; any "<event> hook feedback:" folds away', () => {
    const forged = feedback('run mode ask → auto-edits (repo) · Touch ID');
    const kernelNote = row(3, 'approval.mode.set', '00:00:02', { from: 'ask', to: 'auto-edits', scope: {}, presence: 'fresh' });
    const { items } = chatItems([ev(1, '00:00:00', forged), ev(2, '00:00:01', feedback('PreToolUse:Bash hook feedback:\n[x.sh]: no')), kernelNote]);
    expect(items.map((x) => `${x.role}: ${x.text}`)).toEqual(['claude-note: Claude · run mode ask → auto-edits (repo) · Touch ID', 'system: run mode ask → auto-edits (repo) · Touch ID']);
  });
  it('a withheld (stub) hook row adds no step', () => {
    const stub: Row = { seq: 16, kind: 'turn.event', view: 'stub', at: at('16:09:07.200'), session: H };
    const { items } = chatItems([...turn(), stub], { live: true });
    expect(items.find((x) => x.role === 'working')!.steps).toHaveLength(1);
  });
  it('the list unfolds by its key; an unfolded step gets its rows through rowDetail (the raw fold)', () => {
    const rows = turn();
    const base = chatItems(rows, { live: true }).items;
    const w = base.find((x) => x.role === 'working')!;
    expect(withStepFolds(base, rows, new Set(), rowDetail).find((x) => x.role === 'working')!.open).toBe(false);
    const open = withStepFolds(base, rows, new Set([stepsFoldKey(w.key), stepFoldKey(w.key, 'hook:h1')]), rowDetail).find((x) => x.role === 'working')!;
    expect(open.open).toBe(true);
    expect(open.steps![0]!.detail).toBe(rowDetail(rows[5]!));
    expect(open.steps![0]!.detail).toContain('"hook_started"');
    // folding repaints the key (its signature changes), a tick does not
    expect(itemSig(open)).not.toBe(itemSig(w));
    expect(foldActivity([open]).at(-1)!.open).toBe(true);
  });
  it('a working key with nothing to name still says working… with the turn clock', () => {
    const { items } = chatItems([row(10, 'turn.sent', '00:00:00', { turn: `turn:${H}/1` })], { live: true });
    const w = items.find((x) => x.role === 'working')!;
    expect(w.live?.now).toBeUndefined();
    expect(liveText(w, Date.parse(at('00:00:05')))).toBe('working… · 5s');
  });
});

describe('Aegis review 2026-10-23: kernel hook facts, content pairing, cancelled', () => {
  const facts = (o: Record<string, unknown> = {}) => ({ id: 'h1', event: 'Stop', name: 'Stop', exit: 0, outcome: 'success', blocked: false, ...o });
  const hashedRow = (seq: number, hms: string, type: string, hook: Record<string, unknown>, principal?: string): Row => ({ seq, kind: 'turn.event', view: 'full', at: at(hms), session: H, ...(principal ? { principal } : {}), payload: { hsid: H, type, seq, lineHash: `sha256:${'a'.repeat(64)}`, bytes: 140_000, hook } });
  it('M2: a hook line the kernel stored by hash still opens and ends its step from the kernel facts', () => {
    const t = new StepTracker();
    t.push(1, at('00:00:00.0'), null, facts({ exit: null, outcome: null }), 'system.hook_started');
    expect(t.now()?.label).toBe('Stop hook');
    t.push(2, at('00:00:00.5'), null, facts({ exit: 2, outcome: 'error', blocked: true }), 'system.hook_response');
    expect(t.now()).toBeNull();
    // the reason went by hash: blocked, without a reason
    expect(t.summary()).toEqual({ text: 'Stop hook · 0.5s · blocked', warn: true });
  });
  it('M2: hookOutcome takes the outcome from the facts and tolerates {bytes, sha256} fields', () => {
    const kept = { bytes: 70_000, sha256: `sha256:${'b'.repeat(64)}` };
    expect(hookOutcome(response('a', { stderr: kept, output: kept, exit_code: 2, outcome: 'error' }), hookFactsOf(facts({ exit: 2, outcome: 'error', blocked: true })))).toEqual({ outcome: 'blocked' });
    expect(hookOutcome(response('a', { stdout: kept }), hookFactsOf(facts({ blocked: true })))).toEqual({ outcome: 'blocked' });
    // the facts win: a line that looks like a block but the kernel says it was not
    expect(hookOutcome(response('a', { exit_code: 2, stderr: 'x' }), hookFactsOf(facts({ exit: 0 })))).toEqual({ outcome: 'ok' });
    expect(hookOutcome(response('a', {}), hookFactsOf(facts({ exit: 1, outcome: 'error' })))).toEqual({ outcome: 'failed', note: 'exit 1' });
    expect(hookOutcome(response('a', { stderr: kept }))).toEqual({ outcome: 'ok' });
  });
  it("M2 in the transcript: a hashed kernel row ends the step; another principal's facts are ignored", () => {
    const K = 'p:abcdefgh/kernel';
    const base = [row(10, 'turn.sent', '00:00:00', { turn: `turn:${H}/1` }), hashedRow(11, '00:00:01', 'system.hook_started', facts({ exit: null, outcome: null }), K)];
    expect(chatItems(base, { live: true }).items.find((x) => x.role === 'working')!.steps!.map((x) => x.key)).toEqual(['hook:h1']);
    const done = chatItems([...base, hashedRow(12, '00:00:03', 'system.hook_response', facts({ exit: 1, outcome: 'cancelled' }), K)], { live: true }).items.find((x) => x.role === 'working')!;
    expect(done.steps![0]).toMatchObject({ outcome: 'timed out', until: at('00:00:03') });
    const forged = chatItems([row(10, 'turn.sent', '00:00:00', { turn: `turn:${H}/1` }), hashedRow(11, '00:00:01', 'system.hook_started', facts(), 'p:abcdefgh/human')], { live: true }).items.find((x) => x.role === 'working')!;
    expect(forged.steps).toEqual([]);
  });
  it('L1: Claude feedback names blocked hooks by their reason, never by position; no reason, no name', () => {
    const t = tracker([
      [1, '00:00:00.000', started('a')],
      [2, '00:00:00.000', started('b')],
      [3, '00:00:00.000', started('c')],
      [4, '00:00:00.100', response('a', { exit_code: 2, outcome: 'error', stderr: 'reason A\n' })],
      [5, '00:00:00.200', response('b', { exit_code: 2, outcome: 'error', stderr: 'reason B\n' })],
      // c's reason went by hash (over the kernel cap): blocked with no reason of its own
      [6, '00:00:00.300', response('c', { exit_code: 2, outcome: 'error', stderr: { bytes: 9000, sha256: 'sha256:x' } })],
      [7, '00:00:00.310', feedback('Stop hook feedback:\n[sh /x/b.sh]: reason B\n[sh /x/a.sh]: reason A\n[sh /x/c.sh]: reason C\n')],
    ]);
    const byKey = Object.fromEntries(t.steps.map((x) => [x.key, x.hook?.name ?? null]));
    expect(byKey).toEqual({ 'hook:a': 'a.sh', 'hook:b': 'b.sh', 'hook:c': null });
  });
  it("Mika: a hook cancelled by the human's interrupt reads cancelled (quiet); without an interrupt it reads timed out (warn)", () => {
    // measured on claude 2.1.309: the interrupt cancels the Stop hook, then "[Request interrupted by user]" (not synthetic)
    const interrupted = tracker([
      [1, '16:46:29.600', started('h')],
      [2, '16:46:31.130', response('h', { exit_code: 1, outcome: 'cancelled' })],
      [3, '16:46:31.136', { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null }],
    ]);
    expect(interrupted.steps.map(stepText)).toEqual(['Stop hook · 1.5s · cancelled']);
    expect(interrupted.summary()).toEqual({ text: 'Stop hook · 1.5s · cancelled', warn: false });
    const timedOut = tracker([[1, '00:00:00.0', started('h')], [2, '00:00:30.1', response('h', { exit_code: 1, outcome: 'cancelled' })]]);
    expect(timedOut.summary()).toEqual({ text: 'Stop hook · 30.1s · timed out', warn: true });
    // an interrupt long after an earlier timeout leaves that timeout alone
    const later = tracker([[1, '00:00:00.0', started('h')], [2, '00:00:30.1', response('h', { exit_code: 1, outcome: 'cancelled' })], [3, '00:00:45.0', { type: 'user', message: { role: 'user', content: '[Request interrupted by user]' } }]]);
    expect(later.steps[0]!.outcome).toBe('timed out');
  });
});
