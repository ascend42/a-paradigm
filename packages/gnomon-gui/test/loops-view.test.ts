/**
 * LP8 (#gui-loops, docs/specs/gnomon-loops.md §6; Atelier 2026-10-22-gnomon-loops-ui): the Loops view's pure model
 * and the graph layout. The graph's build requirements (design-system components.loop-graph): the four spec examples
 * fit at 1024 (368px of drawing room) at 100%, no label on a box, labels 4px inside the frame, outcome labels
 * collapse (any / else), converging edges merge into one bus, type lines fit their box.
 */
import { describe, expect, it } from 'vitest';
import { layoutGraph, graphScale, textW, type GraphLayout } from '../src/core/loop-graph.js';
import { authorPhrase, loopCardHead, budgetKey, budgetRequest, cardLoopOf, loopCardTitle, middleEllipsis, detailKeys, edgeTab, keepLine, leafMeta, loopAlerts, loopGroups, loopRequest, loopRowToast, loopsOf, loopsWord, PAUSE_ALL_REQUEST, runPath, trustSections, trustSlip, type LoopNodeShape } from '../src/core/loops.js';

const N = (id: string, type: string, on: Record<string, string>, extra: Partial<LoopNodeShape> = {}): LoopNodeShape => ({ id, type, on, ...extra });
const EXAMPLES: Record<string, { start: string; nodes: LoopNodeShape[] }> = {
  'flow-health-checkout': {
    start: 'defn',
    nodes: [
      N('defn', 'check', { pass: 'gates', fail: 'why' }, { role: 'read' }),
      N('gates', 'check', { pass: 'tests', fail: 'why' }, { role: 'read' }),
      N('tests', 'check', { pass: 'drift', fail: 'why' }, { role: 'read' }),
      N('drift', 'check', { pass: '@goal', fail: 'why' }, { role: 'read' }),
      N('why', 'model', { pass: 'tell', fail: 'tell', unsure: 'tell', unavailable: 'tell' }, { role: 'summarize' }),
      N('tell', 'notify', { any: '@stop' }, { as: 'toast' }),
    ],
  },
  'green-typecheck-gnomon': {
    start: 'tsc',
    nodes: [N('tsc', 'check', { pass: '@goal', fail: 'fix' }, { role: 'read' }), N('fix', 'model', { pass: 'tsc', fail: 'tsc', unsure: 'ask', unavailable: 'ask' }, { role: 'act' }), N('ask', 'notify', { continue: 'fix', stop: '@stop', timeout: '@pause' }, { as: 'card' })],
  },
  'triage-on-commit': {
    start: 'triage',
    nodes: [N('triage', 'model', { pass: 'fix', fail: 'tell', unsure: 'tell', unavailable: 'tell' }, { role: 'judge' }), N('fix', 'call', { pass: 'tell', fail: 'tell' }, { callee: 'green-typecheck-gnomon' }), N('tell', 'notify', { any: '@stop' }, { as: 'toast' })],
  },
  'evening-tidy': {
    start: 'reindex',
    nodes: [N('reindex', 'check', { pass: 'digest', fail: 'digest' }, { role: 'write' }), N('digest', 'model', { any: 'tell' }, { role: 'summarize' }), N('tell', 'notify', { any: '@stop' }, { as: 'toast' })],
  },
};

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function labelRects(l: GraphLayout): Array<{ x: number; y: number; w: number; h: number; t: string }> {
  return l.edges.filter((e) => e.label).map((e) => {
    const w = textW(e.label);
    const x = e.anchor === 'start' ? e.lx : e.anchor === 'end' ? e.lx - w : e.lx - w / 2;
    return { x, y: e.ly - 10, w, h: 12, t: e.label };
  });
}

describe('LP8 loop graph: the four spec examples at 1024 (368px) and 1440 (444px)', () => {
  for (const [id, ex] of Object.entries(EXAMPLES))
    for (const frame of [368, 444]) {
      it(`${id} fits at 100% in ${frame}px, no label on a box, labels inside the frame`, () => {
        const l = layoutGraph(ex, frame);
        expect(l.w).toBeLessThanOrEqual(frame);
        expect(graphScale(null, l.w, frame)).toBe(1);
        const boxes = [...l.boxes, ...l.terms];
        for (const r of labelRects(l)) {
          for (const b of boxes) expect(overlap(r, b), `${id}: label "${r.t}" on ${'id' in b ? b.id : ''}`).toBe(false);
          expect(r.x).toBeGreaterThanOrEqual(4);
          expect(r.x + r.w).toBeLessThanOrEqual(frame - 4);
        }
        for (const b of l.boxes) expect(textW(b.ty)).toBeLessThanOrEqual(b.w - 16 + 0.01);
      });
    }

  it('collapses labels: one target is "any", a long multi-outcome group is "else", back edges carry ↺', () => {
    const t = layoutGraph(EXAMPLES['triage-on-commit']!, 368);
    expect(t.edges.map((e) => e.label)).toEqual(expect.arrayContaining(['else', 'any', 'pass']));
    expect(t.edges.find((e) => e.label === 'else')!.full).toContain('fail, unsure, unavailable → tell');
    const g = layoutGraph(EXAMPLES['green-typecheck-gnomon']!, 368);
    expect(g.edges.map((e) => e.label)).toEqual(expect.arrayContaining(['pass · fail ↺', 'continue ↺', 'else', 'fail']));
  });

  it('merges the four fail edges into why as one bus with one label', () => {
    const l = layoutGraph(EXAMPLES['flow-health-checkout']!, 368);
    expect(l.edges.filter((e) => e.label === 'fail')).toHaveLength(1);
  });

  it("a call node's type line truncates its callee, the full text kept", () => {
    const fix = layoutGraph(EXAMPLES['triage-on-commit']!, 368).boxes.find((b) => b.id === 'fix')!;
    expect(fix.tyFull).toBe('call · ↗ green-typecheck-gnomon');
    expect(fix.ty.endsWith('…')).toBe(true);
    expect(fix.ty.startsWith('call · ↗ ')).toBe(true);
  });

  it('marks verdicts from the last loop run: ✕ heavy, … waiting, · not reached, solid taken edges', () => {
    const run = { runId: 'r1', loopId: 'green-typecheck-gnomon', rounds: 3, computeMs: 0, nodes: [{ nodeId: 'tsc', visit: 1, verdict: 'fail', next: 'fix' }, { nodeId: 'fix', visit: 1, verdict: 'unsure', next: 'ask' }] };
    const l = layoutGraph({ ...EXAMPLES['green-typecheck-gnomon']!, run, live: true }, 368);
    const b = Object.fromEntries(l.boxes.map((x) => [x.id, x]));
    expect([b.tsc!.mark, b.tsc!.cls]).toEqual(['✕', 'fail']);
    expect(b.fix!.mark).toBe('?');
    expect([b.ask!.mark, b.ask!.cls]).toEqual(['…', 'wait']);
    expect(l.edges.filter((e) => e.taken).map((e) => e.label)).toEqual(expect.arrayContaining(['fail', 'else']));
    const idle = layoutGraph(EXAMPLES['evening-tidy']!, 368);
    expect(idle.boxes.every((x) => x.mark === '·' && x.cls === 'never')).toBe(true);
  });

  it('lays out left to right when it fits the frame, and zoom stays inside 25–200%', () => {
    expect(layoutGraph(EXAMPLES['evening-tidy']!, 760).orient).toBe('ltr');
    expect(layoutGraph(EXAMPLES['evening-tidy']!, 368).orient).toBe('ttb');
    expect(graphScale(5, 300, 368)).toBe(2);
    expect(graphScale(null, 736, 368)).toBe(0.5);
  });
});

const KEY = (id: string) => `repo/sha256:${'a'.repeat(64)}/${id}`;
const shape = (id: string, auto = 'act') => ({ triggers: ['daily 02:00'], autonomy: auto, start: EXAMPLES[id]?.start ?? 'tsc', budgets: { run: { rounds: 8, wallMin: 60 }, day: { runs: 12, computeSec: 3600 } }, authoredBy: 'arky', nodes: EXAMPLES[id]?.nodes ?? [] });
const today = new Date().toISOString();
const CLAIM = { principal: 'p:abcdefgh/arky', hsid: null, basis: 'agent-key-claim' };
function status(over: Record<string, unknown> = {}) {
  return {
    loops: {
      loops: [
        { key: KEY('flow-health-checkout'), loopId: 'flow-health-checkout', scope: 'repo', repo: '/w/storefront', repoKey: 'sha256:' + 'a'.repeat(64), state: 'trusted', contentHash: 'h1', trustedHash: 'h1', errors: [], callIssues: [], authoredBy: CLAIM, shape: shape('flow-health-checkout', 'observe') },
        { key: KEY('green-typecheck-gnomon'), loopId: 'green-typecheck-gnomon', scope: 'repo', repo: '/w/a-paradigm', repoKey: 'sha256:' + 'a'.repeat(64), state: 'waiting-trust', reason: 'content-changed', contentHash: 'h3', trustedHash: 'h2', errors: [], callIssues: [], authoredBy: CLAIM, shape: shape('green-typecheck-gnomon') },
        { key: KEY('evening-tidy'), loopId: 'evening-tidy', scope: 'repo', repo: '/w/a-paradigm', repoKey: 'sha256:' + 'a'.repeat(64), state: 'paused', reason: 'budget', contentHash: 'h4', trustedHash: 'h4', errors: [], callIssues: [], authoredBy: CLAIM, shape: shape('evening-tidy') },
        { key: KEY('triage-on-commit'), loopId: 'triage-on-commit', scope: 'repo', repo: '/w/a-paradigm', repoKey: 'sha256:' + 'a'.repeat(64), state: 'untrusted', contentHash: 'h5', errors: [], callIssues: [], authoredBy: CLAIM, shape: shape('triage-on-commit') },
      ],
      running: [{ key: KEY('flow-health-checkout'), runId: 'run-live', rerun: false }],
      runs: [
        { runId: 'run-live', loopId: 'flow-health-checkout', key: KEY('flow-health-checkout'), startedAt: today, rounds: 1, computeMs: 240_000, nodes: [{ nodeId: 'defn', visit: 1, verdict: 'pass', next: 'gates' }], notified: 0 },
        { runId: 'run-old', loopId: 'flow-health-checkout', key: KEY('flow-health-checkout'), startedAt: '2026-10-01T10:00:00Z', endedAt: '2026-10-01T10:01:00Z', reason: 'stop', rounds: 1, computeMs: 1, nodes: [{ nodeId: 'tests', visit: 1, verdict: 'fail', next: 'why' }], notified: 0 },
        { runId: 'run-fail', loopId: 'evening-tidy', key: KEY('evening-tidy'), startedAt: today, endedAt: today, reason: 'budget', rounds: 1, computeMs: 900_000, nodes: [{ nodeId: 'reindex', visit: 1, verdict: 'pass', next: 'digest' }], notified: 0 },
      ],
      effective: { [KEY('green-typecheck-gnomon')]: { declared: 'act', autonomy: 'propose', level: 'L2', capReason: 'L2: a-paradigm strictness' } },
      uptime: { enabled: { n: 1, of: 4 }, running: { n: 1, of: 4 }, waiting: { n: 0, of: 4 }, keepingAlive: true, line: 'Gnomon is staying up for loops' },
      ...over,
    },
  };
}

describe('LP8 loops model', () => {
  it('reads status.loops: states, header word, leaf meta, edge tab, keep-alive line', () => {
    const m = loopsOf(status())!;
    expect(Object.fromEntries(m.loops.map((x) => [x.loopId, x.state]))).toEqual({ 'flow-health-checkout': 'running', 'green-typecheck-gnomon': 'waiting-trust', 'evening-tidy': 'kernel-paused', 'triage-on-commit': 'waiting-trust' });
    expect(loopsWord(m)).toMatchObject({ shown: true, text: 'loops 1 · 2 waiting', narrow: 'loops 1 · 2' });
    expect(leafMeta(m)).toBe('1 running · 1 paused · 2 waiting for trust');
    expect(edgeTab(m)).toBe('loops · 1 running · 2 waiting');
    expect(keepLine(m)).toBe('Gnomon is staying up for loops · 1 enabled');
    expect(loopsOf({})).toBeNull();
    expect(loopsWord(loopsOf({ loops: { loops: [] } }))).toMatchObject({ shown: false });
  });

  it('after Pause all every surface says paused', () => {
    const s = status();
    for (const l of s.loops.loops) if (l.state !== 'untrusted' && l.state !== 'waiting-trust') Object.assign(l, { state: 'paused', reason: 'kill-switch' });
    const m = loopsOf({ loops: { ...s.loops, running: [] } })!;
    expect(m.pausedAll).toBe(true);
    expect(loopsWord(m).text).toBe('loops paused · 2');
    expect(edgeTab(m)).toBe('loops · paused · 2');
    expect(keepLine(m)).toContain('resuming needs presence');
    expect(detailKeys(m.loops[0]!).keys[0]).toMatchObject({ act: 'resume', label: 'Resume · presence' });
  });

  it('groups needs-you first (pinned, ◆), then projects; rows are two lines, name first, full text in title', () => {
    const g = loopGroups(loopsOf(status())!, Date.now());
    expect(g.map((x) => x.head)).toEqual(['needs you', 'a-paradigm', 'storefront']);
    expect(g[0]!.rows.map((r) => r.name)).toEqual(['green-typecheck-gnomon', 'evening-tidy', 'triage-on-commit']);
    expect(g[0]!.rows.every((r) => r.mark === '◆')).toBe(true);
    const run = g[2]!.rows[0]!;
    expect(run.mark).toBe('●');
    expect(run.l1).toBe('running · at defn');
    expect(run.l2).toBe('1/12 runs today · 4m/60m compute · local only · observe · claimed by arky');
    expect(run.title).toContain(run.l2);
    expect(g[0]!.rows.find((r) => r.name === 'triage-on-commit')!.l1).toBe('waiting for trust · claimed by arky · new');
    const mine = loopsOf({ loops: { loops: [{ key: 'k', loopId: 'mine', scope: 'repo', repo: '/w/a', repoKey: 'r', state: 'untrusted', authoredBy: 'file', shape: shape('evening-tidy') }] } })!;
    expect(loopGroups(mine, Date.now())[0]!.rows[0]!.l1).toBe('waiting for trust · from the loop file · new');
    expect(authorPhrase(mine.loops[0]!)).toBe('from the loop file');
    expect(authorPhrase({ claimed: true, shape: { authoredBy: 'arky' } as never })).toBe('claimed by arky');
    expect(middleEllipsis('nightly-dependency-audit-for-every-workspace-package')).toBe('nightly-dependency…workspace-package');
    expect(middleEllipsis('short')).toBe('short');
    const capped = g[1]!.rows.find((r) => r.name === 'green-typecheck-gnomon')!;
    expect(capped.l2).toContain('act → propose (L2: a-paradigm strictness)');
  });

  it('detail keys name their cost; Run now waits for trust in words', () => {
    const m = loopsOf(status())!;
    const by = Object.fromEntries(m.loops.map((x) => [x.loopId, detailKeys(x)]));
    expect(by['green-typecheck-gnomon']!.keys.map((k) => k.label)).toEqual(['Review change', 'Run now', 'Untrust', 'Delete']);
    expect(by['green-typecheck-gnomon']!.why).toBe('Run now waits for trust');
    expect(by['evening-tidy']!.keys[0]).toMatchObject({ label: 'Resume · presence', pri: true });
    expect(by['flow-health-checkout']!.keys.find((k) => k.act === 'run')!.disabled).toContain('loop run');
    expect(loopRequest(m.loops[1]!, 'trust')).toEqual({ kind: 'request.loop.trust', payload: { loopId: 'green-typecheck-gnomon', scope: 'repo', repoKey: 'sha256:' + 'a'.repeat(64), contentHash: 'h3' } });
    expect(PAUSE_ALL_REQUEST).toEqual({ kind: 'request.loop.pause', payload: { all: true } });
  });

  it('budget keys: tighter applies now, looser needs trust', () => {
    expect(budgetKey(8, '8')).toMatchObject({ label: 'Save', enabled: false, note: 'no change' });
    expect(budgetKey(8, '6')).toMatchObject({ label: 'Apply · tighter', dir: 'tighter' });
    expect(budgetKey(8, '12')).toMatchObject({ label: 'Loosen · needs trust', dir: 'looser', enabled: false });
    expect(budgetRequest({ loopId: 'x', scope: 'repo', repoKey: 'k' }, 'run.rounds', 6)).toEqual({ kind: 'request.loop.budget', payload: { loopId: 'x', scope: 'repo', repoKey: 'k', budgets: { run: { rounds: 6 } } } });
    expect(budgetKey(8, 'x').enabled).toBe(false);
  });

  it('TD-2026-10-22-769 (Mika F4): a loop refused at start for want of a local model is ONE stack alert, deduped with a count; it goes when the kernel drops the refusal', () => {
    const refused = { key: KEY('flow-health-checkout'), loopId: 'flow-health-checkout', code: 'no-local-model', why: 'none', at: '2026-10-22T18:30:00.000Z', since: '2026-10-20T18:30:00.000Z', count: 3, trigger: 'schedule', modelNodes: ['digest'] };
    const m = loopsOf(status({ startRefused: [refused, { ...refused, key: KEY('nope'), why: 'made-up' }] }))!;
    expect(m.loops[0]!.startRefused).toMatchObject({ why: 'none', count: 3, modelNodes: ['digest'] });
    const a = loopAlerts(m, new Set()).filter((x) => x.kind === 'refused-start');
    expect(a).toHaveLength(1);
    expect(a[0]!.title).toBe('■ flow-health-checkout didn’t start');
    expect(a[0]!.path).toMatch(/^no local model · scheduled \d\d:\d\d · refused before any step · ×3 since (\d\d:\d\d|[A-Z][a-z]+day)$/);
    expect(loopAlerts(loopsOf(status({ startRefused: [{ ...refused, why: 'sessions-only', count: 1 }] }))!, new Set()).find((x) => x.kind === 'refused-start')!.path).toMatch(/^the local model is for sessions only · scheduled/);
    expect(loopAlerts(m, new Set([a[0]!.id])).filter((x) => x.kind === 'refused-start')).toEqual([]);
    expect(loopAlerts(loopsOf(status({ startRefused: [] }))!, new Set()).filter((x) => x.kind === 'refused-start')).toEqual([]);
  });

  it('a loop the kernel would refuse right now, though it never fired (count 0), is the same one alert, worded as can’t start', () => {
    const now = { key: KEY('flow-health-checkout'), loopId: 'flow-health-checkout', code: 'no-local-model', why: 'none', at: '2026-10-22T18:00:00.000Z', since: '2026-10-22T18:00:00.000Z', count: 0, trigger: 'none', modelNodes: ['digest'] };
    const m = loopsOf(status({ startRefused: [now] }))!;
    expect(m.loops[0]!.startRefused).toMatchObject({ count: 0, trigger: 'none' });
    const a = loopAlerts(m, new Set()).filter((x) => x.kind === 'refused-start');
    expect(a).toHaveLength(1);
    expect(a[0]!.title).toBe('■ flow-health-checkout can’t start');
    expect(a[0]!.path).toBe('no local model · nothing has fired yet · a fire is refused before any step');
    // its first fire keeps the streak (same since): the dismissed alert stays dismissed
    const fired = loopAlerts(loopsOf(status({ startRefused: [{ ...now, count: 1, trigger: 'schedule', at: '2026-10-22T18:30:00.000Z' }] }))!, new Set([a[0]!.id])).filter((x) => x.kind === 'refused-start');
    expect(fired).toEqual([]);
  });

  it('alerts: a kernel pause; a stop by a limit; dismissed ones stay gone; the slip lists loops with no card', () => {
    const m = loopsOf(status())!;
    const a = loopAlerts(m, new Set());
    expect(a.map((x) => x.kind)).toEqual(['kernel-pause']);
    expect(a[0]!.title).toBe('‖ evening-tidy paused by the kernel: budget');
    expect(loopAlerts(m, new Set([a[0]!.id]))).toEqual([]);
    const s = status();
    s.loops.loops[2]!.state = 'trusted';
    const stop = loopAlerts(loopsOf({ loops: { ...s.loops, running: [] } })!, new Set());
    expect(stop.map((x) => [x.kind, x.loopId])).toEqual([['fail', 'flow-health-checkout'], ['stop', 'evening-tidy']]);
    expect(stop[0]!.title).toBe('✕ flow-health-checkout failed at tests');
    const slip = trustSlip(m, new Set(['green-typecheck-gnomon']))!;
    expect(slip.tab).toBe('↻ 1 loop waiting for trust · no card yet');
    expect(slip.lines[0]!.text).toBe('triage-on-commit · new · claimed by arky');
    expect(slip.more).toBe(0);
    const many = status();
    for (let i = 0; i < 6; i++) many.loops.loops.push({ ...many.loops.loops[3]!, key: KEY(`w${i}`), loopId: `w${i}` });
    const capped = trustSlip(loopsOf(many), new Set())!;
    expect([capped.lines.length, capped.more]).toEqual([3, 5]);
    expect(trustSlip(m, new Set(['green-typecheck-gnomon', 'triage-on-commit']))).toBeNull();
  });

  it('run paths fold repeats; live rows become loop-done toasts (goal, landed, notify toast), never trouble', () => {
    expect(runPath({ runId: 'r', loopId: 'x', rounds: 1, computeMs: 0, reason: 'stop', nodes: [{ nodeId: 'tsc', visit: 1, verdict: 'fail' }, { nodeId: 'fix', visit: 1, verdict: 'pass' }, { nodeId: 'fix', visit: 2, verdict: 'pass' }] })).toBe('tsc ✕ → fix ×2 → @stop');
    const m = loopsOf(status());
    expect(loopRowToast({ kind: 'loop.run.ended', payload: { loopId: 'evening-tidy', runId: 'run-fail', reason: 'goal' } }, m)).toMatchObject({ tag: '↻ loop · evening-tidy', runId: 'run-fail' });
    expect(loopRowToast({ kind: 'loop.landed', payload: { loopId: 'evening-tidy', sha: '4c1e9a2ffff', phase: 'done' } }, m)!.text).toBe('landed 4c1e9a2 on a-paradigm');
    // the intent row comes before the ref moves (a land can still be undone): no toast
    expect(loopRowToast({ kind: 'loop.landed', payload: { loopId: 'evening-tidy', sha: '4c1e9a2ffff', phase: 'intent' } }, m)).toBeNull();
    expect(loopRowToast({ kind: 'loop.notified', payload: { loopId: 'flow-health-checkout', nodeId: 'tell', as: 'toast' } }, m)!.text).toContain('tell');
    expect(loopRowToast({ kind: 'loop.notified', payload: { loopId: 'x', as: 'card' } }, m)).toBeNull();
    expect(loopRowToast({ kind: 'loop.run.ended', payload: { loopId: 'x', reason: 'budget' } }, m)).toBeNull();
  });

  it("sections the kernel's loop-trust lines: the diff first, by marks", () => {
    const s = trustSections(['Trust loop x (repo loop in /w)', 'Budgets: run 8 rounds', 'Node tsc (check, read): run tsc', '  argv0 tsc → /n/tsc', 'Changes since the trusted version 3f9a1c02:', '- Budgets: run 8 rounds', '+ Budgets: run 12 rounds', 'Allow needs Touch ID']);
    expect(s.map((x) => x.head).slice(0, 2)).toEqual(['this loop', 'what changed']);
    expect(s[0]!.lines[0]!.text).toBe('Trust loop x (repo loop in /w)');
    expect(s[1]!.lines.map((l) => l.cls)).toEqual(['fold', 'del', 'add']);
    expect(s[1]!.lines[1]!.text.startsWith('−')).toBe(true);
    const g = trustSections(['Changes since the trusted version 3f9a1c02:', '- Land paths: a', '+ Land paths: a, b']);
    expect(g[0]!.lines.filter((l) => l.cls === 'gate')).toHaveLength(1);
    expect(s.find((x) => x.head.startsWith('does'))!.lines).toHaveLength(2);
  });
});

describe('LP8 loop card identity (card:v1 carries no top-level detail)', () => {
  it('a loop-choice card is joined to the kernel loop.notified row, else read from the kernel line', () => {
    const block = { schemaVersion: 'display-block:v1', type: 'Box', children: [{ type: 'Text', text: 'Raised by loop green-typecheck-gnomon (claimed by arky)' }, { type: 'Text', text: 'Run run-7f3a' }, { type: 'Text', text: 'fix is unsure' }] };
    const card = { schemaVersion: 'card:v1', cardId: 'card:1', kind: 'loop-choice', block };
    expect(cardLoopOf(card, new Map([['card:1', { loopId: 'green-typecheck-gnomon', runId: 'r9', nodeId: 'ask' }]]))).toMatchObject({ loopId: 'green-typecheck-gnomon', runId: 'r9', nodeId: 'ask', authoredBy: 'arky' });
    expect(cardLoopOf(card)).toMatchObject({ loopId: 'green-typecheck-gnomon', runId: 'run-7f3a', authoredBy: 'arky' });
    const resume = { cardId: 'c2', kind: 'loop-choice', block: { type: 'Box', children: [{ type: 'Text', text: 'Resume loop evening-tidy?' }] } };
    expect(cardLoopOf(resume)).toMatchObject({ loopId: 'evening-tidy', resume: true });
    expect(loopCardTitle('loop-choice', cardLoopOf(resume), null)).toBe('Resume loop evening-tidy?');
    const m = loopsOf({ loops: { loops: [{ key: 'k', loopId: 'green-typecheck-gnomon', scope: 'repo', repo: '/w/a', repoKey: 'r', state: 'trusted' }], runs: [{ runId: 'r9', loopId: 'green-typecheck-gnomon', key: 'k', rounds: 3, computeMs: 0, nodes: [{ nodeId: 'tsc', visit: 1, verdict: 'fail' }, { nodeId: 'fix', visit: 1, verdict: 'unsure' }] }] } });
    expect(loopCardTitle('loop-choice', { loopId: 'green-typecheck-gnomon', runId: 'r9', nodeId: 'ask' }, m)).toBe('green-typecheck-gnomon: fix is unsure');
    expect(cardLoopOf({ cardId: 'x', kind: 'loop-choice', block: { type: 'Box', children: [{ type: 'Text', text: 'something else' }] } })).toBeNull();
  });
});

describe('LP8 loop card head wording', () => {
  it('an agent-key-claim loop reads "claimed by arky", never "by arky" alone; a file loop reads "from the loop file"', () => {
    const m = loopsOf({ loops: { loops: [
      { key: 'a', loopId: 'agent-made', scope: 'repo', repo: '/w/a', repoKey: 'r', state: 'untrusted', authoredBy: { principal: 'p:abcdefgh/arky', hsid: null, basis: 'agent-key-claim' }, shape: { triggers: [], autonomy: 'act', start: 'x', budgets: { run: {}, day: {} }, authoredBy: 'arky', nodes: [] } },
      { key: 'f', loopId: 'from-file', scope: 'repo', repo: '/w/a', repoKey: 'r', state: 'untrusted', authoredBy: 'file', shape: { triggers: [], autonomy: 'act', start: 'x', budgets: { run: {}, day: {} }, authoredBy: 'file', nodes: [] } },
    ] } })!;
    const agent = loopCardHead(m.loops[0]);
    expect(agent).toBe('claimed by arky');
    expect(agent!.replace('claimed by arky', '')).not.toMatch(/\bby arky\b/);
    expect(loopCardHead(m.loops[1])).toBe('from the loop file');
    expect(loopCardHead(undefined)).toBeNull();
  });
});


describe('loops off in this build (TD-2026-10-24-447)', () => {
  const OFF = { loops: { enabled: false, reason: 'not-in-this-build', loops: [], running: 0, queued: 0, recent: [], startRefused: [], effective: {}, landing: [] } };
  it('loopsOf carries enabled:false and an empty model; an absent key reads as on', () => {
    expect(loopsOf(OFF)).toMatchObject({ enabled: false, reason: 'not-in-this-build', loops: [], running: 0, waitingTrust: 0, pausedAll: false });
    expect(loopsOf({ loops: { loops: [] } })?.enabled).toBe(true);
    expect(loopsOf({ loops: { enabled: true, loops: [] } })?.enabled).toBe(true);
  });
  it('hides the header word, the alerts, the trust slip and the toasts', () => {
    const m = loopsOf(OFF);
    expect(loopsWord(m)).toMatchObject({ shown: false, text: '' });
    expect(loopAlerts(m, new Set())).toEqual([]);
    expect(trustSlip(m, new Set())).toBeNull();
    expect(loopRowToast({ kind: 'loop.run.ended', payload: { loopId: 'x', reason: 'goal' } }, m)).toBeNull();
  });
  it('the view paints one empty state with the build copy and no Pause all', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('../src/ui/loops-view.ts', import.meta.url)), 'utf8');
    const { LOOPS_OFF_TEXT } = await import('../src/core/loops.js');
    expect(LOOPS_OFF_TEXT).toBe('Loops are off in this release while they are finished.');
    const list = src.slice(src.indexOf('function paintList('), src.indexOf('if (!m.loops.length) body'));
    expect(list).toContain('loopsOff(m)');
    expect(list).toContain('LOOPS_OFF_TEXT');
    const head = src.slice(src.indexOf('function paintHead('), src.indexOf('const kill ='));
    expect(head).toContain('loopsOff(m)');
    expect(head).not.toContain('pause-all');
  });
  it('the palette drops loops.pause-all (keeps loops.open) and the Gnomon menu drops Pause all loops', async () => {
    const { paletteEntries } = await import('../src/core/commands.js');
    const { appMenuModel } = await import('../src/core/header.js');
    const { applyPreset } = await import('../src/core/commands.js');
    const ids = (s: unknown) => paletteEntries(s as never).map((c) => c.id);
    expect(ids(OFF)).not.toContain('loops.pause-all');
    expect(ids(OFF)).toContain('loops.open');
    expect(ids({ loops: { loops: [] } })).toContain('loops.pause-all');
    expect(ids(null)).toContain('loops.pause-all');
    const rows = appMenuModel({ layout: applyPreset('desk'), panesOpen: false, theme: [], who: '', loops: { note: 'off in this build', paused: false, off: true } });
    const runs = rows.flatMap((r) => (r.kind === 'item' ? [r.run] : []));
    expect(runs).toContain('loops.open');
    expect(runs).not.toContain('loops.pause-all');
  });
});

describe('stale 8.0.0 loop cards while loops are off (TD-2026-10-24-447)', () => {
  it('the stack, inbox count, empty-state count and session note all agree', async () => {
    const { GuiStore, sessionNote } = await import('../src/core/store.js');
    const store = new GuiStore();
    const mk = (cardId: string, kind: string) => ({ cardId, kind, hsid: 's1', repo: 'r', card: {}, arrivedSeq: store.cards.size }) as never;
    store.sessions.set('s1', { hsid: 's1', repo: 'r', state: 'running', lastSeq: 1 } as never);
    store.cards.set('a', mk('a', 'loop-trust'));
    store.cards.set('b', mk('b', 'loop-choice'));
    store.cards.set('c', mk('c', 'permission'));
    let off = false;
    store.loopCardsHidden = () => off;
    expect(store.visibleCardCount()).toBe(3);
    off = true;
    expect(store.visibleCardCount()).toBe(1);
    expect(store.stack().map((c) => c.cardId)).toEqual(['c']);
    expect(store.stack('r').map((c) => c.cardId)).toEqual(['c']);
    const pending = store.groups()[0]!.sessions[0]!.pending;
    expect(pending).toBe(1);
    expect(sessionNote({ state: 'running', pending }).text).toBe('1 card');
    store.cards.delete('c');
    expect(store.visibleCardCount()).toBe(0);
    expect(sessionNote({ state: 'running', pending: store.groups()[0]!.sessions[0]!.pending }).text).toBe('running');
  });
});
