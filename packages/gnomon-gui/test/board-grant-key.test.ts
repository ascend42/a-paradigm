/**
 * S1.4 P4b in a REAL engine and a real Chrome (skipped on CI; run locally, alone, with a Chrome installed): the draw
 * key's DOM conditions (Aegis P4-design ruling 1: a count going from 9 to 1,000 moves no key's box; nothing focuses
 * a draw key except its own press; a press is trusted only) and the removed-mid-drag report through the real engine
 * (the handle's {what: 'gone', id}: the held mark another hand removed yields no op). The session-side conditions are
 * in test/dim-grant.test.ts. With GNOMON_SHOTS_DIR set it also saves the new states, day and night, at 1280 and in
 * a narrow leaf, for Mika.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, leafUrl, shootLeaf } from '../scripts/board-leaf-shots.mjs';
// @ts-expect-error plain .mjs dev script (no types)
import { startPreview } from '../scripts/preview.mjs';

const B = 'globalThis.gnomonPreviewBoard';
const LEAF = 'globalThis.gnomonPreviewLeaf';
const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B2 = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const key = (hsid: string): string => `#preview-board [data-grant="${hsid}"], .bd-foot [data-grant="${hsid}"]`;
const grants = (list: unknown[]): string => `(globalThis.gnomonPreviewGrants = ${JSON.stringify(list)}, ${LEAF}.drawFoot(), 1)`;
const one = (write: boolean, state = 'live', extra: Record<string, unknown> = {}) => ({ hsid: A, write, state, since: null, name: 'Claude', ...extra });
const box = (hsid: string): string => `(() => { const k = document.querySelector('.bd-foot [data-grant="${hsid}"]'); if (!k) return null; const b = k.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; })()`;
const active = `(() => { const a = document.activeElement; return a ? (a.dataset && a.dataset.grant ? 'key:' + a.dataset.grant : a.tagName + '.' + (a.className || '')) : null; })()`;
const presses = '(globalThis.gnomonPreviewGrantPresses ?? [])';
const marks = (n: number): string => `globalThis.gnomonPreviewState([{ hand: 'you', marks: Array.from({ length: ${n} }, (_, i) => ({ kind: 'rect', x: 20 + (i % 40) * 22, y: 20 + Math.floor(i / 40) * 14, w: 16, h: 10 })) }])`;
const SHOTS = process.env.GNOMON_SHOTS_DIR ?? '';
const keep = (name: string, png: Buffer): void => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(path.dirname(path.join(SHOTS, `p4b-${name}.png`)), { recursive: true });
  writeFileSync(path.join(SHOTS, `p4b-${name}.png`), png);
};

const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('S1.4 P4b the draw key and the removed mark, in a real engine', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());
  const real = async (actions: unknown[], o: { theme?: 'day' | 'night'; width?: number; shot?: string; board?: string } = {}): Promise<Record<string, unknown>> => {
    const r = (await shootLeaf({ chrome, url: leafUrl(p.url, o.board ?? 'open', o.theme ?? 'day', 'empty'), width: o.width ?? 1280, height: 800, timeoutMs: 90_000, actions })) as { png: Buffer; acted: Record<string, unknown> };
    if (o.shot) keep(o.shot, r.png);
    return r.acted;
  };

  it('Aegis 1: a count going from 9 to 1,000 leaves every key\'s box where it was (the fixed 4-character slot)', async () => {
    const a = await real([
      { read: grants([one(true), { ...one(false), hsid: B2 }]), as: 'set' },
      { read: `(${B}.render(${marks(9)}), 1)`, as: 'nine' }, { wait: 600 }, { read: box(A), as: 'a9' }, { read: box(B2), as: 'b9' },
      { read: `(${B}.render(${marks(1000)}), 1)`, as: 'many' }, { wait: 2500 }, { read: box(A), as: 'a1000' }, { read: box(B2), as: 'b1000' },
      { read: `[...document.querySelectorAll('.bd-foot .bd-count')].map((e) => e.textContent)`, as: 'counts' },
    ]);
    expect(a.a9).not.toBeNull();
    expect((a.counts as string[])[0]).toBe('999+');
    expect(a.a1000).toEqual(a.a9);
    expect(a.b1000).toEqual(a.b9);
  }, 180_000);

  it('Aegis 1: nothing focuses a draw key but its own press; a render, an arrival line and an attach leave focus where it was', async () => {
    const a = await real([
      { read: grants([one(true)]), as: 'set' },
      { at: [300, 300], press: true }, { wait: 200 }, { read: active, as: 'start' },
      // a render, an arrival line (spoken), a second session attaching: focus does not move to any key
      { read: `(${B}.render(${marks(3)}), ${LEAF}.speak('Claude added 3 marks'), 1)`, as: 'r1' }, { wait: 300 },
      { read: grants([one(true), { ...one(false), hsid: B2 }]), as: 'attach' }, { wait: 300 }, { read: active, as: 'after' },
      // the key's own press focuses it; a repaint that changes its words and adds a hand keeps it focused, on the same key
      { press: key(A) }, { wait: 200 }, { read: active, as: 'pressed' },
      { read: grants([one(false), { ...one(false), hsid: B2 }]), as: 'flip' }, { read: `(${B}.render(${marks(5)}), 1)`, as: 'r2' }, { wait: 300 }, { read: active, as: 'kept' },
      { read: `document.querySelector('.bd-foot [data-grant="${A}"] .bd-grant-w').textContent`, as: 'words' },
    ]);
    expect(String(a.start)).not.toMatch(/^key:/);
    expect(String(a.after)).not.toMatch(/^key:/);
    expect(a.pressed).toBe(`key:${A}`);
    expect(a.kept).toBe(`key:${A}`);
    expect(a.words).toBe('may not edit');
  }, 180_000);

  it('a press is TRUSTED only: a script\'s click and a letter key send nothing; the pointer and Space on the key itself do; a disabled key takes none', async () => {
    const a = await real([
      { read: grants([one(true)]), as: 'set' },
      { read: `(document.querySelector('.bd-foot [data-grant="${A}"]').click(), document.querySelector('.bd-foot [data-grant="${A}"]').dispatchEvent(new MouseEvent('click', { bubbles: true })), ${presses}.length)`, as: 'synthetic' },
      { press: key(A) }, { wait: 150 }, { read: `${presses}.length`, as: 'pointer' },
      { key: 'd' }, { wait: 100 }, { read: `${presses}.length`, as: 'letter' },
      { key: ' ' }, { wait: 150 }, { read: `${presses}.length`, as: 'space' },
      { read: grants([one(true, 'down')]), as: 'down' }, { press: key(A) }, { wait: 150 }, { read: `${presses}.length`, as: 'whileDown' },
      { read: `document.querySelector('.bd-foot [data-grant="${A}"]').getAttribute('aria-label')`, as: 'downName' },
      { read: grants([one(true, 'idle')]), as: 'idle' }, { press: key(A) }, { wait: 150 }, { read: `${presses}.length`, as: 'whileIdle' },
      { read: presses, as: 'all' },
    ]);
    expect(a.synthetic).toBe(0);
    expect(a.pointer).toBe(1);
    expect(a.letter).toBe(1);
    expect(a.space).toBe(2);
    expect(a.whileDown).toBe(2);
    expect(a.whileIdle).toBe(2);
    expect(a.downName).toBe('Not connected · this can’t be changed until the board is back');
    for (const x of a.all as Array<{ trusted: boolean }>) expect(x.trusted).toBe(true);
  }, 180_000);

  it('removed mid-drag: the mark another hand deleted during the drag yields NO op at the drop (never added back as yours); the handle reports {what: gone, id}', async () => {
    const STATE = `globalThis.gnomonPreviewState([{ hand: 'arky', marks: [{ kind: 'rect', x: 200, y: 160, w: 160, h: 100 }] }])`;
    const a = await real([
      { read: `(globalThis.__gone = [], ${B}.onGone((r) => globalThis.__gone.push(r)), globalThis.gnomonPreviewDim.held = true, ${B}.render(${STATE}), 1)`, as: 'set' }, { wait: 500 },
      { read: `${B}.marks().filter((m) => !m.labelOf).map((m) => m.node)`, as: 'nodes' },
      { hold: [[201, 210], [220, 220], [250, 240], [280, 260]] },
      // the agent deletes it while it is in the person's hand: the fold no longer holds it
      { read: `(${B}.render(globalThis.gnomonPreviewState([])), 1)`, as: 'deleted' }, { wait: 150 },
      { release: [300, 270] }, { wait: 600 },
      { read: 'globalThis.__gone', as: 'gone' },
      { read: 'globalThis.gnomonPreviewDim.edits.map((e) => e.ops.map((o) => o.type))', as: 'edits' },
      { read: `${B}.count()`, as: 'count' },
    ]);
    const node = (a.nodes as string[])[0]!;
    expect(node).toBeTruthy();
    expect(a.gone).toEqual([{ what: 'gone', id: node, change: 'moving' }]);
    expect(a.edits).toEqual([]);
    expect(a.count).toBe(0);
  }, 180_000);

  const footFit = `(() => { const f = document.querySelector('.bd-foot').getBoundingClientRect(); return [...document.querySelectorAll('.bd-foot .bd-grant')].map((k) => { const b = k.getBoundingClientRect(); return { right: Math.round(b.right * 10) / 10, height: b.height, inside: b.right <= f.right - 14 + 0.5 }; }); })()`;
  const named = (a: string, b: string) => [one(true, 'live', { session: a }), { ...one(false, 'live', { session: b }), hsid: B2 }];

  it('aegis I-1: a HELD Enter on a draw key presses it once, not once per auto-repeat', async () => {
    const a = await real([
      { read: grants([one(true)]), as: 'set' },
      { press: key(A) }, { wait: 150 }, { read: `${presses}.length`, as: 'one' },
      { key: 'Enter', text: '\r', held: 6 }, { wait: 200 }, { read: `${presses}.length`, as: 'held' },
    ]);
    expect(a.one).toBe(1);
    expect(a.held).toBe(2);
  }, 180_000);

  it('mika F1 / aegis I-5: no key is clipped: at 1280 and at 560 with two named hands every key ends inside the foot; mika F2: the key is 28px', async () => {
    for (const width of [1280, 560]) {
      const a = await real([{ read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(named('Totals are off by a cent', 'billing-ui follow-up')), as: 'set' }, { wait: 400 }, { read: footFit, as: 'fit' }, { read: `[...document.querySelectorAll('.bd-foot .bd-hand-keyed bdi')].map((b) => b.hidden ? null : b.textContent)`, as: 'names' }], { width, shot: `giveway-${width}` });
      const fit = a.fit as Array<{ right: number; height: number; inside: boolean }>;
      expect(fit).toHaveLength(2);
      for (const k of fit) {
        expect(k.inside, `${width}: a key past the foot's edge (${JSON.stringify(a.fit)}, names ${JSON.stringify(a.names)})`).toBe(true);
        expect(k.height).toBe(28);
      }
    }
  }, 240_000);
  it('mika F3, F4, F7, F8, F10: count to key is 8px; a not-running key says so; the no-key line has no leading space; the same line spoken twice is announced twice; a busy key keeps its own sentence', async () => {
    const a = await real([
      { read: `(${B}.render(${marks(1)}), 1)`, as: 'r' },
      { read: grants([one(true, 'busy'), { ...one(false, 'idle'), hsid: B2 }, { ...one(false), hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZC', name: 'local model', local: true }]), as: 'set' }, { wait: 300 },
      { read: `document.querySelector('.bd-foot [data-grant="${A}"]').getAttribute('aria-label')`, as: 'busyName' },
      { read: `(() => { const h = document.querySelector('.bd-foot [data-hand="${A}"]'); const c = h.querySelector('.bd-count'); const k = h.querySelector('.bd-grant'); const r = document.createRange(); r.selectNodeContents(c); return Math.round(k.getBoundingClientRect().left - r.getBoundingClientRect().right); })()`, as: 'gap' },
      { read: `[...document.querySelectorAll('.bd-foot .bd-hand-note')].filter((n) => !n.hidden).map((n) => n.textContent)`, as: 'notes' },
      { read: `(globalThis.__said = [], new MutationObserver(() => { const t = document.querySelector('.bd-leaf .sr-only[role=status]').textContent; globalThis.__said.push(t); }).observe(document.querySelector('.bd-leaf .sr-only[role=status]'), { childList: true, characterData: true, subtree: true }), ${LEAF}.speak('Claude added 3 marks'), 1)`, as: 's1' }, { wait: 200 },
      { read: `(${LEAF}.speak('Claude added 3 marks'), 1)`, as: 's2' }, { wait: 200 }, { read: 'globalThis.__said', as: 'said' },
    ], { width: 2000 });
    expect(a.busyName).toBe('Claude may draw on this board and change or remove any mark, yours included · press to stop it');
    expect(a.gap).toBe(8);
    expect(a.notes).toEqual(['· not running', '· can’t draw on a board yet']);
    // cleared, then set on the next frame: a live region hears the same words a second time
    expect(a.said).toEqual(['Claude added 3 marks', '', 'Claude added 3 marks']);
  }, 180_000);
  const handsRead = `[...document.querySelectorAll('.bd-foot .bd-hand-keyed')].map((h) => { const [name, sess] = h.querySelectorAll('bdi'); return { name: name.hidden ? null : name.textContent, session: sess.closest('.bd-hand-s').hidden ? null : sess.textContent, note: (() => { const n = h.querySelector('.bd-hand-note'); return n && !n.hidden ? n.textContent : null; })(), title: h.title || null }; })`;
  it('mika F1-a: the shared name goes before any session (all hands at once), and a hand whose words went has them in title=; F1-b: a not-running note goes first', async () => {
    for (const width of [1280, 560]) {
      const a = await real([{ read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(named('Totals are off by a cent', 'billing-ui follow-up')), as: 'set' }, { wait: 400 }, { read: handsRead, as: 'hands' }, { read: footFit, as: 'fit' }], { width, shot: `r2-giveway-named-${width}` });
      const hands = a.hands as Array<{ name: string | null; session: string | null; title: string | null }>;
      // the shared 'Claude' has gone from BOTH before any session goes
      if (hands.some((h) => h.session === null)) expect(hands.map((h) => h.name), `${width}`).toEqual([null, null]);
      if (width === 1280) {
        expect(hands.map((h) => h.name)).toEqual([null, null]);
        expect(hands.map((h) => h.session !== null)).toEqual([true, true]);
      }
      for (const h of hands) if (h.name === null) expect(h.title, `${width}`).toMatch(/^Claude, /);
      for (const k of a.fit as Array<{ inside: boolean }>) expect(k.inside, `${width}`).toBe(true);
    }
    const b = await real([{ read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants([one(true, 'live'), { ...one(false, 'idle'), hsid: B2 }]), as: 'set' }, { wait: 400 }, { read: handsRead, as: 'hands' }, { read: footFit, as: 'fit' }], { width: 560, shot: 'r2-giveway-idle-560' });
    for (const k of b.fit as Array<{ inside: boolean }>) expect(k.inside, JSON.stringify(b.hands)).toBe(true);
    // the note went first: the names it would otherwise have cost are still there
    const bh = b.hands as Array<{ name: string | null; note: string | null }>;
    expect(bh.map((h) => h.note)).toEqual([null, null]);
    expect(bh.some((h) => h.name !== null)).toBe(true);
  }, 240_000);
  // T-2026-11-26-004 (design hands_foot.overflow; draw-grant.never 'hidden behind an overflow with no way to press it')
  const C = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZC';
  const D = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZD';
  const E = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZE';
  const agents = (n: number) => [A, B2, C, D, E].slice(0, n).map((hsid, i) => ({ ...one(i === 0, 'live', { session: ['billing-ui follow-up', 'Totals are off by a cent', 'auth handoff review', 'release notes', 'the paging fix'][i] }), hsid }));
  const reach = `(() => { const f = document.querySelector('.bd-foot').getBoundingClientRect(); const leaf = document.querySelector('.bd-leaf').getBoundingClientRect(); const m = document.querySelector('.bd-hands-menu'); const mb = m && m.isConnected ? m.getBoundingClientRect() : null; return { foot: [...document.querySelectorAll('.bd-foot > .bd-hand .bd-grant')].map((k) => { const b = k.getBoundingClientRect(); return { hsid: k.dataset.grant, inside: b.left >= f.left + 14 - 0.5 && b.right <= f.right - 14 + 0.5 }; }), menu: m && m.isConnected ? [...m.querySelectorAll('.bd-grant')].map((k) => { const b = k.getBoundingClientRect(); return { hsid: k.dataset.grant, inside: b.width > 0 && b.left >= mb.left - 0.5 && b.right <= mb.right + 0.5 && b.top >= mb.top - 0.5 && b.bottom <= mb.bottom + 0.5 && b.left >= leaf.left - 0.5 && b.right <= leaf.right + 0.5 }; }) : null, more: document.querySelector('.bd-hands-more') ? { text: document.querySelector('.bd-hands-more').textContent, label: document.querySelector('.bd-hands-more').getAttribute('aria-label'), expanded: document.querySelector('.bd-hands-more').getAttribute('aria-expanded'), controls: document.querySelector('.bd-hands-more').getAttribute('aria-controls') === (m && m.id) } : null, menuBottom: mb ? mb.bottom : null, footTop: f.top, rows: m && m.isConnected ? [...m.querySelectorAll('.bd-hands-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()) : null, role: m ? m.getAttribute('role') : null }; })()`;
  it('the +<k> ▾ menu: two agents at a 1024 window and three at 1440 (and 2 and 3 in a 560 leaf): every draw key is whole in the foot or reachable in the menu, none clipped, and the menu never covers the foot', async () => {
    // (where the hands fit with their words cut there is no menu: a 1440 window holds three; then a second run opens it)
    for (const width of [1024, 1280, 1440, 560]) for (const n of [2, 3, 4]) {
      for (const theme of ['day', 'night'] as const) {
        const set = [{ read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(agents(n)), as: 'set' }, { wait: 400 }, { read: reach, as: 'closed' }];
        const first = await real(set, { width, theme, shot: `dl-hands-foot-${n}-${theme}-${width}` });
        const has = !!(first.closed as { more: unknown }).more;
        const a = has ? await real([...set, { press: '.bd-hands-more' }, { wait: 300 }, { read: reach, as: 'open' }, { read: active, as: 'focus' }], { width, theme, shot: `dl-hands-menu-${n}-${theme}-${width}` }) : first;
        const closed = a.closed as { foot: Array<{ hsid: string; inside: boolean }>; more: { text: string; label: string } | null };
        const open = a.open as { foot: Array<{ hsid: string; inside: boolean }>; menu: Array<{ hsid: string; inside: boolean }> | null; more: { expanded: string; controls: boolean } | null; menuBottom: number | null; footTop: number; rows: string[] | null; role: string | null };
        const tag = `${n} agents at ${width} ${theme}`;
        for (const k of closed.foot) expect(k.inside, `${tag}: a key clipped off the foot`).toBe(true);
        if (!has) {
          // every hand fits: every key whole in the foot
          expect(closed.foot.length, tag).toBe(n);
          continue;
        }
        // the hands that do not fit went behind the key; a 1024 window with two, and a 560 leaf, need it
        if ((width === 1024 || width === 560) && n >= 2) expect(closed.foot.length, tag).toBeLessThan(n);
        expect(closed.more!.label, tag).toBe(`${n - closed.foot.length} more ${n - closed.foot.length === 1 ? 'hand' : 'hands'}`);
        expect(closed.more!.text, tag).toBe(`+${n - closed.foot.length} ▾`);
        // open: every key is in the foot or the menu, once, and whole
        const all = [...open.foot, ...(open.menu ?? [])];
        expect(all.map((k) => k.hsid).sort(), tag).toEqual([A, B2, C, D, E].slice(0, n).sort());
        for (const k of all) expect(k.inside, `${tag}: ${k.hsid} out of reach`).toBe(true);
        expect(open.foot, `${tag}: the foot's keys stay where they were`).toEqual(closed.foot);
        expect(open.menuBottom! <= open.footTop - 3.5, `${tag}: the menu covers the foot`).toBe(true);
        expect(open.more, tag).toEqual({ text: expect.any(String), label: expect.any(String), expanded: 'true', controls: true });
        expect(open.role, tag).toBeNull();
        // each row whole: its name and its session (the foot's own cut never applies in the menu)
        for (const r of open.rows!) expect(r, tag).toMatch(/Claude\s*◇\s*\S/);
        expect(a.focus, `${tag}: opening leaves focus on the key`).toBe('BUTTON.key quiet bd-hands-more');
      }
    }
  }, 600_000);
  it('the +<k> ▾ menu: a press on a key in it sends exactly one dim.grant, for that hand, trusted; the menu stays open; an untrusted press opens nothing and sends nothing', async () => {
    const a = await real([
      { read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(agents(3)), as: 'set' }, { wait: 400 },
      { read: `(document.querySelector('.bd-hands-more').click(), document.querySelector('.bd-hands-more').getAttribute('aria-expanded'))`, as: 'synthetic' },
      { press: '.bd-hands-more' }, { wait: 250 },
      { read: `(document.querySelector('.bd-hands-menu .bd-grant').click(), ${presses}.length)`, as: 'syntheticKey' },
      { read: `document.querySelector('.bd-hands-menu .bd-grant').dataset.grant`, as: 'target' },
      { press: '.bd-hands-menu .bd-grant' }, { wait: 250 },
      { read: presses, as: 'presses' }, { read: `document.querySelector('.bd-hands-more').getAttribute('aria-expanded')`, as: 'still' },
    ], { width: 1024 });
    expect(a.synthetic).toBe('false');
    expect(a.syntheticKey).toBe(0);
    expect(a.presses).toEqual([{ hsid: a.target, type: 'click', trusted: true }]);
    expect(a.still).toBe('true');
  }, 180_000);
  it('the +<k> ▾ menu: a menu key is dropped while pending, down or unknown, with the foot key\'s titles; ↓ goes in, Esc closes it ONLY and returns to the key; focus leaving and an outside press close it', async () => {
    const st = (state: string) => grants(agents(3).map((g, i) => (i === 2 ? { ...g, state, since: state === 'pending' ? 0 : null } : g)));
    const a = await real([
      { read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(agents(3)), as: 'set' }, { wait: 400 },
      { press: '.bd-hands-more' }, { wait: 250 },
      { read: st('down'), as: 'd' }, { wait: 100 }, { press: `.bd-hands-menu [data-grant="${C}"]` }, { wait: 100 },
      { read: `document.querySelector('.bd-hands-menu [data-grant="${C}"]').getAttribute('aria-label')`, as: 'downTitle' },
      { read: st('unknown'), as: 'u' }, { wait: 100 }, { press: `.bd-hands-menu [data-grant="${C}"]` }, { wait: 100 },
      { read: st('pending'), as: 'p' }, { wait: 400 }, { press: `.bd-hands-menu [data-grant="${C}"]` }, { wait: 100 },
      { read: presses, as: 'dropped' },
      { read: grants(agents(3)), as: 'back' }, { wait: 100 },
      { read: `(document.querySelector('.bd-hands-more').focus(), [document.querySelector('.bd-hands-more').getAttribute('aria-expanded'), document.querySelectorAll('.bd-hands-menu .bd-grant').length, document.activeElement.className])`, as: 'f' }, { key: 'ArrowDown' }, { wait: 100 }, { read: active, as: 'down' },
      { key: 'Escape' }, { wait: 150 }, { read: active, as: 'esc' }, { read: `document.querySelector('.bd-hands-more').getAttribute('aria-expanded')`, as: 'escOpen' }, { read: `!!document.querySelector('.bd-leaf')`, as: 'leaf' }, { read: `globalThis.gnomonPreviewFolds ?? 0`, as: 'folds' },
      { press: '.bd-hands-more' }, { wait: 200 }, { key: 'Tab' }, { key: 'Tab' }, { key: 'Tab' }, { key: 'Tab' }, { wait: 150 }, { read: `document.querySelector('.bd-hands-more').getAttribute('aria-expanded')`, as: 'tabbed' },
      { read: `(document.querySelector('.bd-hands-more').focus(), 1)`, as: 'f2' }, { press: '.bd-hands-more' }, { wait: 200 }, { at: [300, 200], press: true }, { wait: 150 }, { read: `document.querySelector('.bd-hands-more').getAttribute('aria-expanded')`, as: 'outside' },
    ], { width: 1024 });
    expect(a.dropped).toEqual([]);
    expect(a.downTitle).toMatch(/^Not connected|connect/i);
    expect(a.f).toEqual(['true', 2, 'key quiet bd-hands-more']);
    expect(a.down).toMatch(/^key:/);
    expect(a.esc).toBe('BUTTON.key quiet bd-hands-more');
    expect(a.escOpen).toBe('false');
    expect(a.folds).toBe(0);
    expect(a.tabbed).toBe('false');
    expect(a.outside).toBe('false');
  }, 180_000);
  const bare = (n: number) => [A, B2, C, D, E].slice(0, n).map((hsid, i) => ({ ...one(i === 0, 'live', { name: '' }), hsid }));
  const WIDTH = (w: string) => ({ read: `(Object.assign(document.getElementById('preview-board').style, { right: 'auto', width: ${w} }), 1)`, as: 'w' });
  // the width that holds 'you' and the keyed hands as they stand, plus `extra` px (the foot's padding is 14 each side)
  const snug = (extra: number) => WIDTH(`(() => { const f = document.querySelector('.bd-foot'); const keys = [...f.querySelectorAll(':scope > .bd-hand')]; const last = keys[keys.length - 1].getBoundingClientRect().right; const host = document.getElementById('preview-board').getBoundingClientRect(); return Math.ceil(last - host.left + 14 + ${extra}) + 'px'; })()`);
  it('aegis I4a: the split is frozen while focus is in the foot: the LAST shown key keeps its place and its focus when a hand arrives that would put it behind \'+<k> ▾\'', async () => {
    const a = await real([
      // hands with no words to give way (no name, no session): only '+<k> ▾' can make room
      { read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(bare(3)), as: 'set' }, { wait: 400 },
      // the three keyed hands fit with 20px to spare: '+1 ▾' and its gap (62px) do not
      snug(20), { wait: 400 }, { read: `document.querySelectorAll('.bd-foot > .bd-hand-keyed').length`, as: 'three' },
      { read: `(document.querySelector('.bd-foot > .bd-hand [data-grant="${C}"]').focus(), 1)`, as: 'f' }, { read: active, as: 'f0' },
      { read: grants(bare(4)), as: 'more' }, { wait: 200 },
      { read: active, as: 'f1' }, { read: `!!document.querySelector('.bd-foot > .bd-hand [data-grant="${C}"]')`, as: 'inFoot' },
    ], { width: 1440 });
    expect(a.three).toBe(3);
    expect(a.f0).toBe(`key:${C}`);
    expect(a.inFoot, 'the focused key went behind the menu').toBe(true);
    expect(a.f1).toBe(`key:${C}`);
  }, 180_000);
  it('aegis I4b: a split frozen by focus is drawn again when focus leaves the foot: after a resize nothing stays clipped', async () => {
    const a = await real([
      { read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(agents(3)), as: 'set' }, { wait: 400 },
      { read: `(document.querySelector('.bd-foot > .bd-hand [data-grant="${C}"]').focus(), 1)`, as: 'f' },
      WIDTH(`'422px'`), { wait: 400 }, { key: 'Tab' }, { wait: 300 }, { read: active, as: 'away' },
      { read: `(() => { const f = document.querySelector('.bd-foot').getBoundingClientRect(); return [...document.querySelectorAll('.bd-foot > .bd-hand .bd-grant, .bd-foot > .bd-hands-more')].map((k) => k.getBoundingClientRect().right <= f.right - 14 + 0.5); })()`, as: 'inside' },
      { read: `document.querySelectorAll('.bd-foot > .bd-hand .bd-grant').length + (document.querySelector('.bd-hands-more') ? Number(document.querySelector('.bd-hands-more').textContent.match(/[0-9]+/)[0]) : 0)`, as: 'all' },
    ], { width: 1440 });
    expect(String(a.away)).not.toMatch(/^key:/);
    expect((a.inside as boolean[]).every(Boolean), JSON.stringify(a.inside)).toBe(true);
    expect(a.all).toBe(3);
  }, 180_000);
  it('aegis I5: an unkeyed hand arriving (a mark of an unattached agent) moves no key: two keyed hands that just fit stay where they were, and the hand goes behind \'+<k> ▾\'', async () => {
    const other = `globalThis.gnomonPreviewState([{ hand: 'you', marks: Array.from({ length: 9 }, (_, i) => ({ kind: 'rect', x: 20 + i * 22, y: 20, w: 16, h: 10 })) }, { hand: 'arky', marks: [{ kind: 'rect', x: 300, y: 200, w: 60, h: 40 }] }, { hand: 'luna', marks: [{ kind: 'rect', x: 400, y: 200, w: 60, h: 40 }] }])`;
    const a = await real([
      { read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(agents(2)), as: 'set' }, { wait: 400 },
      // whole, with room for '+<k> ▾' and its gap (62px) but not for the two unkeyed hands
      snug(64), { wait: 400 }, { read: handsRead, as: 'whole' }, { read: box(A), as: 'a0' }, { read: box(B2), as: 'b0' },
      { read: `(${B}.render(${other}), 1)`, as: 'arky' }, { wait: 600 },
      { read: box(A), as: 'a1' }, { read: box(B2), as: 'b1' }, { read: `document.querySelector('.bd-hands-more')?.textContent ?? null`, as: 'more' }, { read: `[...document.querySelector('.bd-foot').children].map((c) => c.className + ':' + c.textContent).join(' | ')`, as: 'foot' },
    ], { width: 1440 });
    expect((a.whole as Array<{ name: string | null }>).every((h) => h.name !== null)).toBe(true);
    expect(a.a1, 'a key moved').toEqual(a.a0);
    expect(a.b1, 'a key moved').toEqual(a.b0);
    expect(String(a.more), String(a.foot)).toMatch(/^\+[12] ▾$/);
  }, 180_000);
  it('aegis I6: too short (the tiny board at 1024, 3 agents), the menu lists EVERY hand and each key lies inside its visible box', async () => {
    const a = await real([
      { read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(agents(3)), as: 'set' }, { wait: 400 },
      { read: `(document.getElementById('preview-board').style.height = '120px', 1)`, as: 'h' }, { wait: 400 },
      { read: `(() => { const f = document.querySelector('.bd-foot').getBoundingClientRect(); const hd = document.querySelector('.bd-head').getBoundingClientRect(); return Math.round(f.top - 4 - (hd.bottom + 4)); })()`, as: 'room' },
      { press: '.bd-hands-more' }, { wait: 300 }, { read: reach, as: 'open' },
    ], { width: 1024, board: 'tiny', shot: 'r2/hands-tiny-3-day-1024' });
    expect(a.room as number).toBeLessThan(38);
    const open = a.open as { menu: Array<{ hsid: string; inside: boolean }> | null };
    expect(open.menu!.map((k) => k.hsid).sort()).toEqual([A, B2, C].sort());
    for (const k of open.menu!) expect(k.inside, k.hsid).toBe(true);
  }, 180_000);
  it('mika F1: in a 303px leaf with three Claudes the menu rows show distinct sessions (the shared name goes first, whole in title=); mika 8: ↑ from the first row returns to \'+<k> ▾\'', async () => {
    const a = await real([
      { read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(agents(3)), as: 'set' }, WIDTH(`'303px'`), { wait: 500 },
      { press: '.bd-hands-more' }, { wait: 300 },
      { read: `[...document.querySelectorAll('.bd-hands-menu .bd-hands-row')].map((r) => { const h = r.firstElementChild; const s = h.querySelector(':scope > .bd-hand-s:not(.bd-hand-note)'); const n = h.querySelector(':scope > bdi'); const sr = s.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(s); const visible = Math.min(sr.right, range.getBoundingClientRect().right) - sr.left; return { session: s.textContent, visible: Math.round(visible), name: n.hidden ? null : n.textContent, title: h.title || null }; })`, as: 'rows' },
      { key: 'ArrowDown' }, { wait: 100 }, { key: 'ArrowUp' }, { wait: 100 }, { read: active, as: 'up' },
    ], { width: 1024, shot: 'r2/hands-303-3-day' });
    const rows = a.rows as Array<{ session: string; visible: number; name: string | null; title: string | null }>;
    expect(rows.length).toBeGreaterThan(0);
    // what can be seen of each session tells the rows apart (at least 10 characters' worth of it)
    for (const r of rows) expect(r.visible, JSON.stringify(r)).toBeGreaterThan(40);
    expect(new Set(rows.map((r) => r.session)).size).toBe(rows.length);
    expect(rows.some((r) => r.name === null), 'the shared name never went').toBe(true);
    for (const r of rows) if (r.name === null) expect(r.title, JSON.stringify(r)).toMatch(/^Claude, /);
    expect(a.up).toBe('BUTTON.key quiet bd-hands-more');
  }, 180_000);
  it('the +<k> ▾ menu: order is fixed and frozen while it is open: an agent\'s state change moves no key and takes no focus; a hand that attaches joins the END of the menu', async () => {
    const a = await real([
      { read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(agents(3)), as: 'set' }, { wait: 400 },
      { press: '.bd-hands-more' }, { wait: 250 }, { key: 'ArrowDown' }, { wait: 100 },
      { read: reach, as: 'before' }, { read: active, as: 'f0' },
      { read: grants(agents(3).map((g) => ({ ...g, write: !g.write }))), as: 'flip' }, { wait: 150 },
      { read: `(globalThis.gnomonPreviewGrants = ${JSON.stringify([])}.concat(globalThis.gnomonPreviewGrants, [{ hsid: '${D}', write: false, state: 'live', since: null, name: 'Claude', session: 'release notes' }]), ${LEAF}.drawFoot(), 1)`, as: 'add' }, { wait: 150 },
      { read: reach, as: 'after' }, { read: active, as: 'f1' },
    ], { width: 1024 });
    const before = a.before as { foot: Array<{ hsid: string }>; menu: Array<{ hsid: string }> };
    const after = a.after as { foot: Array<{ hsid: string }>; menu: Array<{ hsid: string }> };
    expect(after.foot.map((k) => k.hsid)).toEqual(before.foot.map((k) => k.hsid));
    expect(after.menu.map((k) => k.hsid)).toEqual([...before.menu.map((k) => k.hsid), D]);
    expect(a.f1).toBe(a.f0);
  }, 180_000);

  it('aegis I-4: a first mark of the session (another label) moves no key and drops no focus; a second Claude attaching keeps focus on the key', async () => {
    const mark = `globalThis.gnomonPreviewState([{ hand: 'arky', hsid: '${A}', marks: [{ kind: 'rect', x: 300, y: 200, w: 60, h: 40 }] }])`;
    const a = await real([
      { read: grants([one(true)]), as: 'set' }, { wait: 200 },
      { press: key(A) }, { wait: 150 }, { read: box(A), as: 'before' },
      { read: `(${B}.render(${mark}), 1)`, as: 'landed' }, { wait: 500 }, { read: box(A), as: 'after' }, { read: active, as: 'focus1' },
      { read: `document.querySelector('.bd-foot [data-hand="${A}"] .bd-count').textContent`, as: 'count' },
      { read: grants([one(true, 'live', { session: 'one' }), { ...one(false, 'live', { session: 'two' }), hsid: B2 }]), as: 'attach' }, { wait: 300 }, { read: active, as: 'focus2' },
    ]);
    expect(a.count).toBe('1');
    expect(a.after).toEqual(a.before);
    expect(a.focus1).toBe(`key:${A}`);
    expect(a.focus2).toBe(`key:${A}`);
  }, 180_000);

  it('mika F5: a mark another hand removes while it is being RESIZED is said as "changing"', async () => {
    const STATE = `globalThis.gnomonPreviewState([{ hand: 'arky', marks: [{ kind: 'rect', x: 200, y: 160, w: 160, h: 100 }] }])`;
    const a = await real([
      { read: `(globalThis.__gone = [], ${B}.onGone((r) => globalThis.__gone.push(r)), globalThis.gnomonPreviewDim.held = true, ${B}.render(${STATE}), 1)`, as: 'set' }, { wait: 500 },
      { at: [201, 210], press: true }, { wait: 200 },
      { hold: [[365, 265], [380, 280], [400, 300]] },
      { read: `(${B}.render(globalThis.gnomonPreviewState([])), 1)`, as: 'deleted' }, { wait: 150 },
      { release: [410, 310] }, { wait: 600 },
      { read: 'globalThis.__gone.map((r) => r.change)', as: 'gone' },
      { read: `document.querySelector('.bd-keep').textContent`, as: 'line' },
    ]);
    expect(a.gone).toEqual(['changing']);
    expect(a.line).toContain('removed the mark you were changing');
  }, 180_000);

  it.skipIf(!SHOTS)('shots for Mika: the draw key\'s states, day and night, at 1280 and in a narrow leaf', async () => {
    const S1 = { session: 'Totals are off…' };
    const S2 = { session: 'billing-ui' };
    const states: Array<[string, unknown[]]> = [
      ['on-off', [one(true, 'live', S1), { ...one(false, 'live', S2), hsid: B2 }]],
      ['pending', [{ ...one(true, 'pending', S1), since: 0 }, { ...one(false, 'busy', S2), hsid: B2, since: 0 }]],
      ['link-down', [one(true, 'down', S1), { ...one(false, 'down', S2), hsid: B2 }]],
      ['idle-unknown', [one(true, 'idle', S1), { ...one(false, 'unknown', S2), hsid: B2 }]],
      ['two-claudes', [one(true, 'live', S1), { ...one(false, 'live', S2), hsid: B2 }]],
      ['one-local', [one(true), { ...one(false), hsid: B2, name: 'local model', local: true }]],
    ];
    for (const theme of ['day', 'night'] as const)
      for (const width of [1024, 1280, 560])
        for (const [name, list] of states)
          await real([{ read: `(${B}.render(${marks(9)}), 1)`, as: 'r' }, { read: grants(list), as: 'set' }, { wait: 500 }], { theme, width, shot: `${name}-${theme}-${width}` });
    // the removed line in the leaf (the preview says the handle's gone report as the dock does)
    const STATE = `globalThis.gnomonPreviewState([{ hand: 'arky', marks: [{ kind: 'rect', x: 200, y: 160, w: 160, h: 100 }] }])`;
    for (const theme of ['day', 'night'] as const)
      await real([{ read: `(globalThis.gnomonPreviewDim.held = true, ${B}.render(${STATE}), 1)`, as: 'set' }, { read: grants([one(true, 'live', S1)]), as: 'g' }, { wait: 400 }, { hold: [[201, 210], [240, 240]] }, { read: `(${B}.render(globalThis.gnomonPreviewState([])), 1)`, as: 'd' }, { wait: 150 }, { release: [260, 250] }, { wait: 500 }], { theme, shot: `removed-line-${theme}-1280` });
  }, 600_000);
});
