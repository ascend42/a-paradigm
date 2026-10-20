// #gui S2 desk structure (critique 2026-10-20 §2 S2): the pure helpers behind the sessions rail, the chat fold and
// the safe markdown subset. The page wiring is checked by source scans at the end.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectHue } from '@a-company/gnomon-contracts';
import { describe, expect, it } from 'vitest';
import { mdBlocks, mdInline, type MiniDoc, type MiniEl } from '../src/core/render.js';
import { activitySummary, failedExit, foldActivity, groupHue, GuiStore, isLiveState, sessionNote, sessionTitle, splitActivePast, type ChatItem, type Row } from '../src/core/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class FText {
  constructor(readonly data: string) {}
}
class FEl implements MiniEl {
  className = '';
  readonly attrs = new Map<string, string>();
  readonly children: Array<FEl | FText> = [];
  constructor(readonly tag: string) {}
  appendChild(c: unknown): unknown {
    this.children.push(c as FEl | FText);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  get text(): string {
    return this.children.map((c) => (c instanceof FText ? c.data : c.text)).join('');
  }
  get shape(): string {
    return `${this.tag}(${this.children.map((c) => (c instanceof FText ? JSON.stringify(c.data) : c.shape)).join(',')})`;
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };
const shape = (xs: Array<MiniEl | string>): string => xs.map((x) => (typeof x === 'string' ? JSON.stringify(x) : (x as FEl).shape)).join(',');

describe('S2.1 one project hue', () => {
  it('the rail hues a group by projectHue(cwd) (what the kernel feed sends the Workshop), else projectHue(repo)', () => {
    expect(groupHue('billing', [{ cwd: null }, { cwd: '/Users/matt/code/billing' }])).toBe(projectHue('/Users/matt/code/billing'));
    expect(groupHue('billing', [{}])).toBe(projectHue('billing'));
  });
  it('the kernel feed and the GUI call the same function (no private hash left in either)', () => {
    const feed = readFileSync(path.join(ROOT, '..', 'gnomon', 'src', 'kernel', 'modhost', 'feed.ts'), 'utf8');
    expect(feed).toMatch(/out\.project = typeof p\.cwd === 'string' \? projectHue\(p\.cwd\) : 0;/);
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    expect(app).not.toMatch(/function hueOf|\* 31 \+/);
    expect(app).toMatch(/groupHue\(/);
  });
});

describe('S2.2 sessions: names, notes, Active / Past, failed', () => {
  const S = (o: Record<string, unknown>) => ({ hsid: 'hsid:v1:01JM3PTPRHAFG2WJJ9DCXSCVJW', repo: 'billing', cwd: '/Users/matt/code/billing', firstUser: null, ...o });
  it('the name is the first user message cut to 28 chars, else repo basename · hsid tail 4', () => {
    expect(sessionTitle(S({ firstUser: 'Totals are off by a cent on 3-line orders. Find out why.' }))).toBe('Totals are off by a cent on…');
    expect(sessionTitle(S({ firstUser: '  fix\nthe   build ' }))).toBe('fix the build');
    expect(sessionTitle(S({}))).toBe('billing · CVJW');
    expect(sessionTitle(S({ repo: null, cwd: '/srv/code/ledgerette/' }))).toBe('ledgerette · CVJW');
    expect(sessionTitle(S({ firstUser: 'x'.repeat(28) }))).toBe('x'.repeat(28));
  });
  it('the note: KNOT and N card(s) in warn ink, failed in vermilion, else the state', () => {
    expect(sessionNote({ state: 'open', pending: 1 })).toEqual({ text: '1 card', tone: 'need' });
    expect(sessionNote({ state: 'open', pending: 2 })).toEqual({ text: '2 cards', tone: 'need' });
    expect(sessionNote({ state: 'open', pending: 1, knot: true })).toEqual({ text: 'KNOT', tone: 'need' });
    expect(sessionNote({ state: 'failed', pending: 0 })).toEqual({ text: 'failed', tone: 'fail' });
    expect(sessionNote({ state: 'streaming', pending: 0 })).toEqual({ text: 'streaming', tone: 'plain' });
  });
  it('a session.exited that is an error is "failed" (gone, not live); a requested stop is "ended"', () => {
    expect([failedExit({ reason: 'error', code: 2 }), failedExit({ code: 2 }), failedExit({ signal: 'SIGKILL', code: null }), failedExit({ reason: 'stopped', code: 0 }), failedExit({ code: 0 }), failedExit({ reason: 'stopped', code: 143 })]).toEqual([true, true, true, false, false, false]);
    expect(isLiveState('failed')).toBe(false);
    const s = new GuiStore();
    const row = (seq: number, kind: string, payload: Record<string, unknown>, session = 'hsid:v1:A'): Row => ({ seq, view: 'full', event: { kind, connId: 'k', session, at: `2026-10-20T14:0${seq}:00Z`, payload } } as unknown as Row);
    s.apply([row(1, 'session.open', { hsid: 'hsid:v1:A', cwd: '/c/billing', backend: 'claude' }), row(2, 'turn.event', { line: JSON.stringify({ type: 'user', message: { role: 'user', content: 'Find the rounding bug' } }) }), row(3, 'session.exited', { hsid: 'hsid:v1:A', reason: 'error', code: 2 })]);
    s.apply([row(4, 'session.open', { hsid: 'hsid:v1:B' }, 'hsid:v1:B'), row(5, 'session.exited', { hsid: 'hsid:v1:B', reason: 'stopped', code: 0 }, 'hsid:v1:B')]);
    const a = s.sessions.get('hsid:v1:A')!;
    expect([a.state, a.cwd, a.firstUser, a.openedAt]).toEqual(['failed', '/c/billing', 'Find the rounding bug', '2026-10-20T14:01:00Z']);
    expect(s.sessions.get('hsid:v1:B')!.state).toBe('ended');
  });
  it('Active holds the live sessions; Past the ended, failed, refused, orphaned and seen ones', () => {
    const { active, past } = splitActivePast(['open', 'streaming', 'idle', 'ended', 'failed', 'refused', 'orphaned', 'seen'].map((state) => ({ state })));
    expect(active.map((s) => s.state)).toEqual(['open', 'streaming', 'idle']);
    expect(past.map((s) => s.state)).toEqual(['ended', 'failed', 'refused', 'orphaned', 'seen']);
  });
});

describe('S2.5 chat: the activity fold and "took Ns"', () => {
  const at = (hms: string) => `2026-10-20T${hms}Z`;
  const I = (key: string, role: ChatItem['role'], text: string, hms: string): ChatItem => ({ key, seq: Number(key), role, text, at: at(hms) });
  const items = [
    I('1', 'user', 'Totals are off', '13:58:00'),
    I('2', 'tool', 'Read · src/totals.ts', '13:58:05'),
    I('3', 'tool', 'Read · src/order.ts', '13:59:00'),
    I('4', 'tool', 'Bash · pnpm test', '14:01:00'),
    I('5', 'auto', 'auto-approved edit · src/x.ts', '14:02:00'),
    I('6', 'assistant', 'I found it', '13:58:41'.replace('13:58:41', '14:06:00')),
    I('7', 'result', '$0.01', '14:06:01'),
  ];
  it('consecutive tool and auto rows become ONE collapsed activity line between the user and the reply', () => {
    const f = foldActivity(items);
    expect(f.map((x) => x.role)).toEqual(['user', 'activity', 'assistant', 'result']);
    expect(f[1]!.key).toBe('act:2');
    expect(f[1]!.text).toBe('13:58–14:06 · read 2 files · ran 1 command · 1 auto-approved · 8m 0s of work');
    expect(f[1]!.children!.map((c) => c.key)).toEqual(['2', '3', '4', '5']);
    expect(f[2]!.took).toBe(480);
  });
  it('expanding an activity line shows its rows inline after it (key-stable)', () => {
    expect(foldActivity(items, new Set(['act:2'])).map((x) => x.key)).toEqual(['1', 'act:2', '2', '3', '4', '5', '6', '7']);
  });
  it('a reply with no user message before it has no "took"; a run with no tools folds nothing', () => {
    const f = foldActivity([I('1', 'assistant', 'hi', '14:00:00'), I('2', 'user', 'q', '14:01:00'), I('3', 'assistant', 'a', '14:01:41')]);
    expect(f.map((x) => [x.role, x.took])).toEqual([['assistant', undefined], ['user', undefined], ['assistant', 41]]);
    expect(activitySummary([I('9', 'tool', 'Edit · a.ts', '10:00:00')])).toBe('10:00 · edited 1 file');
  });
});

describe('S2.5 safe markdown subset (DOM only, no HTML passthrough)', () => {
  it('inline: `code`, **bold**, *italic* / _italic_; snake_case and a lone * stay text', () => {
    expect(shape(mdInline(fdoc, 'the **applyDiscount()** call in `totals.ts` is *wrong*'))).toBe('"the ",strong("applyDiscount()")," call in ",code("totals.ts")," is ",em("wrong")');
    expect(shape(mdInline(fdoc, 'keep snake_case_name and 2 * 3 * 4'))).toBe('"keep snake_case_name and 2 * 3 * 4"');
    expect(shape(mdInline(fdoc, '**bold with `code`** and _it_'))).toBe('strong("bold with ",code("code"))," and ",em("it")');
  });
  it('blocks: fences, bullet and numbered lists, paragraphs', () => {
    const out = mdBlocks(fdoc, 'Plan:\n- read **a**\n- run `b`\n\n1. one\n2. two\n```ts\nconst x = 1;\n```\nend') as FEl[];
    expect(out.map((e) => e.shape)).toEqual(['p("Plan:")', 'ul(li("read ",strong("a")),li("run ",code("b")))', 'ol(li("one"),li("two"))', 'pre(code("const x = 1;"))', 'p("end")']);
  });
  it('markup in agent text is text, never elements (no HTML, no links, no images)', () => {
    const out = mdBlocks(fdoc, '<img src=x onerror=alert(1)> [link](https://evil.example) ![i](x.png) <script>1</script>') as FEl[];
    expect(out.map((e) => e.shape)).toEqual(['p("<img src=x onerror=alert(1)> [link](https://evil.example) ![i](x.png) <script>1</script>")']);
  });
});
