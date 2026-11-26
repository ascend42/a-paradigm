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
  writeFileSync(path.join(SHOTS, `p4b-${name}.png`), png);
};

const chrome = findChrome() as string | null;
describe.skipIf(!!process.env.CI || !chrome)('S1.4 P4b the draw key and the removed mark, in a real engine', () => {
  let p: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());
  const real = async (actions: unknown[], o: { theme?: 'day' | 'night'; width?: number; shot?: string } = {}): Promise<Record<string, unknown>> => {
    const r = (await shootLeaf({ chrome, url: leafUrl(p.url, 'open', o.theme ?? 'day', 'empty'), width: o.width ?? 1280, height: 800, timeoutMs: 90_000, actions })) as { png: Buffer; acted: Record<string, unknown> };
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
  it.todo('two agents at a 1024 window and three agents at 1440: the +<k> menu (a later S1.4 pass) keeps every key in reach');

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
