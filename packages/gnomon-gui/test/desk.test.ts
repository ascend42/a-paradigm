// #gui S2 desk structure (critique 2026-10-20 §2 S2): the pure helpers behind the sessions rail, the chat fold and
// the safe markdown subset. The page wiring is checked by source scans at the end.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectHue } from '@a-company/gnomon-contracts';
import { describe, expect, it } from 'vitest';
import { mdBlocks, mdInline, raisedLine, renderCard, splitCardBlock, voiceTagOf, type MiniDoc, type MiniEl } from '../src/core/render.js';
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
    expect(sessionNote({ state: 'failed', pending: 1 })).toEqual({ text: 'failed', tone: 'fail' }); // a failure outranks its card
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
  it('Active holds the live sessions and the failed ones (they still need you); Past the ended, refused, orphaned and seen', () => {
    const { active, past } = splitActivePast(['open', 'streaming', 'idle', 'ended', 'failed', 'refused', 'orphaned', 'seen'].map((state) => ({ state })));
    expect(active.map((s) => s.state)).toEqual(['open', 'streaming', 'idle', 'failed']);
    expect(past.map((s) => s.state)).toEqual(['ended', 'refused', 'orphaned', 'seen']);
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

describe('S2 page wiring (source read; the preview shots show the DOM)', () => {
  const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');
  it('the kernel feed is a palette view, not a rail row or the default centre', async () => {
    const { GUI_COMMANDS } = await import('../src/core/commands.js');
    expect(GUI_COMMANDS.map((c) => c.id)).toContain('view.kernel-feed');
    const rail = app.slice(app.indexOf('function paintSessions('), app.indexOf('/* ── decision stack'));
    expect(rail).not.toMatch(/kernel feed/);
    expect(app).toMatch(/if \(!focused && !feedView\) return \{ items: \[\], hidden: 0 \};/);
    expect(html).toMatch(/<div id="empty" class="empty">[\s\S]*No session open[\s\S]*id="empty-new" class="key pri"/);
  });
  it('the header: wordmark, palette field, risk, spacer, conn, voice, ⊞ Layout; the inbox sits in the stack head', () => {
    const head = html.slice(html.indexOf('<header class="chrome">'), html.indexOf('</header>'));
    const order = ['class="wordmark"', 'id="palette-btn" class="palfield"', 'id="risk"', 'class="spacer"', 'id="conn"', 'id="voice-pill"', 'id="layout-btn"'].map((x) => head.indexOf(x));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(head).toContain('Search, run, jump… <kbd>⌘K</kbd>');
    expect(head).not.toContain('id="inbox"');
    expect(html).toMatch(/<aside id="pane-stack"[\s\S]*id="inbox"/);
  });
  it('the layout menu lists presets and panes, never kernel-owned chrome', () => {
    const menu = app.slice(app.indexOf('function openLayoutMenu('), app.indexOf('function closeLayoutMenu('));
    expect(menu).toMatch(/PRESETS/);
    expect(menu).not.toMatch(/conn|risk|voice|mode-btn|repin|dictation/);
  });
  it('pinned cards carry "Pending in this session"; the composer names the session and keeps the ⇧Tab hint in title=', () => {
    expect(app).toMatch(/if \(mine\.length\) pinned\.appendChild\(h\(doc, 'span', \{ class: 'lbl' \}, 'Pending in this session'\)/);
    expect(app).toMatch(/placeholder = s \? `Reply to \$\{t\}/);
    expect(html).toMatch(/id="composer-text"[^>]*title="[^"]*Shift\+Tab cycles the run mode/);
    expect(html).toMatch(/id="composer-send" class="key pri"/);
  });
  it('project names use the ink pair, failed notes vermilion, KNOT / cards warn ink (text tokens only)', () => {
    for (const [i, n] of ['terracotta', 'sage', 'slate', 'ochre', 'rose-clay', 'sea-grey'].entries()) expect(css).toContain(`.pink.h${i} { color: var(--p-${n}-ink); }`);
    expect(css).toMatch(/\.snote\.tone-fail \{ color: var\(--fail\);/);
    expect(css).toMatch(/\.snote\.tone-need \{ color: var\(--warn-ink\);/);
    expect(css).toMatch(/\.trow\.role-user \{ display: flex; flex-direction: column; align-items: flex-end; \}/);
  });
});

describe('S3 the card sheet and the stack pile', () => {
  const block = { schemaVersion: 'display-block:v1', type: 'Box', children: [{ type: 'Text', text: 'The session asks to run Bash' }, { type: 'Text', text: 'command: pnpm test' }] };
  const v = { cardId: 'card:01J', kind: 'permission', requestedBy: 'p:x/claude', hsid: 'hsid:v1:A', repo: 'billing', state: 'pending', contentHash: 'sha256:' + 'c'.repeat(64), flags: [] as string[], decisions: ['allow', 'deny'], decidable: true };
  it('anatomy: ■ project · kind · voice tag (requestedBy in title=), the title, the body, raised · waiting, keys, contentHash last', () => {
    const el = renderCard({ doc: fdoc }, { ...v, project: { name: 'billing', hue: 0 }, raisedAt: '2026-10-20T14:06:00Z', now: Date.parse('2026-10-20T14:09:30Z'), voice: { eligible: 'reversible', label: 'card 3' } }, block) as FEl;
    const kids = el.children.filter((c): c is FEl => c instanceof FEl);
    expect(kids.map((k) => k.className)).toEqual(['card-head k', 'card-title', 'card-body kernel-owned', 'meta card-raised', 'card-keys', 'bar', 'stamp', 'meta content-hash']);
    expect(kids[0]!.text).toBe('■ billing · permission · 🎙 reversible · card 3');
    expect(kids[0]!.attrs.get('title')).toBe('requested by p:x/claude · hsid:v1:A · billing');
    expect(kids[0]!.children.filter((c): c is FEl => c instanceof FEl)[0]!.className).toBe('card-project pink h0');
    expect(kids[1]!.text).toBe('The session asks to run Bash');
    expect(kids[2]!.text).toBe('command: pnpm test');
    expect(kids[3]!.text).toBe('raised 14:06 · waiting 3m');
    expect(kids[7]!.text).toMatch(/^contentHash sha256:c{16}/);
  });
  it('the voice tag is the kernel handle: reversible · label, gate + the handle word, else hand-only', () => {
    expect(voiceTagOf({ eligible: 'gate', label: 'LANTERN' })).toEqual({ text: '🎙 gate', handle: 'LANTERN' });
    expect(voiceTagOf({ eligible: 'none', label: 'KNOT' })).toEqual({ text: 'hand-only', handle: null });
    expect(voiceTagOf(null)).toBeNull();
    expect(raisedLine('2026-10-20T14:06:00Z', Date.parse('2026-10-20T14:06:20Z'))).toBe('raised 14:06 · waiting just now');
  });
  it('a claim-mismatch card keeps its block whole (the red first line stays the body\'s first) and is titled by its kind', () => {
    expect(splitCardBlock(block, 'gate-class', true)).toEqual({ title: 'gate-class', body: block });
    expect(splitCardBlock({ type: 'Box', children: [] }, 'knot', false).title).toBe('knot');
  });
  it('the pile: state edges, rotation by class (no inline style), fans on hover AND focus-within; pinned cards lie flat', () => {
    const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');
    expect(css).toMatch(/border-left: var\(--edge-w\) solid var\(--edge, var\(--key-edge\)\);/);
    expect(css).toMatch(/\.card\.kind-knot \{ --edge: var\(--knot-edge\); \}/);
    expect(css).toMatch(/\.card\.failed \{ --edge: var\(--fail-edge\); \}/);
    expect(css).toMatch(/\.card\.kind-gate-class, \.card\.held \{ --edge: var\(--warn-edge\); \}/);
    expect(css).toMatch(/\.card\.claim-mismatch \{ --edge: var\(--fail-edge\); \}/);
    expect(css).toMatch(/\.pile \.card \+ \.card \{ margin-top: -64px; \}/);
    expect(css).toMatch(/\.pile:hover \.card \+ \.card, \.pile:focus-within \.card \+ \.card/);
    expect(css).toMatch(/\.pinned \.card \{ --r: 0deg; margin: 0; \}/);
    expect(css).not.toMatch(/\.card[^{]*\{[^}]*border-left:[^;]*--rule/);
  });
});
