/**
 * #gui M1.10 slice 1 unit tests (spec §11, §4.5). Pure functions in node; the
 * DOM renderer runs against a tiny fake document (no jsdom in the repo). The
 * end-to-end client ⇄ real #web-endpoint test is
 * packages/gnomon/test/gui-endpoint.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authServerPreimage, hex, sha256 } from '@a-company/gnomon-contracts';
import { describe, expect, it } from 'vitest';
import { GnomonClient, gnomonPost, refusalFromError } from '../src/core/client.js';
import { applyPreset, BLOCK_SAFE_COMMANDS, filterCommands, GUI_COMMANDS, paletteEntries, parseLayout, PRESETS, resolveMotion, resolveTheme, serializeLayout, togglePane } from '../src/core/commands.js';
import { applyCwdHint, clearCwdHint, cwdHintOf, CWD_DISPLAY_CAP, decidePin, hostSurface, parseLaunchFragment } from '../src/core/launch.js';
import { askDetailOf, askNote, cardContentHash, cardFlags, flagsOf, renderBlock, renderCard, type MiniDoc, type MiniEl } from '../src/core/render.js';
import { keyIdOfSpki, newClientNonce, verifyServerSig } from '../src/core/server-sig.js';
import { GuiStore, rowSummary, type Row } from '../src/core/store.js';
import { HeightIndex, visibleRange, WidthCache } from '../src/core/virtual.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..', '..');
const subtle = webcrypto.subtle as unknown as SubtleCrypto;

/* ── fake DOM: text nodes and elements only; no markup parser exists here ── */
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
  all(): FEl[] {
    return [this, ...this.children.flatMap((c) => (c instanceof FEl ? c.all() : []))];
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };

describe('§4.5 sanitizer: the ONE contracts sanitizer through the GUI render path (Aegis C1, G-GUI-07, G-GUI-11)', () => {
  const vectors = JSON.parse(readFileSync(path.join(REPO, 'packages', 'gnomon-contracts', 'conformance', 'display.v1.json'), 'utf8')) as { sanitize: Array<{ input: string; text: string; flags: string[] }> };
  it('every display.v1.json vector renders, as a kit.Text block, to exactly its text, and its flags reach the card badges', () => {
    expect(vectors.sanitize.length).toBeGreaterThan(20);
    for (const v of vectors.sanitize) {
      const el = renderBlock({ doc: fdoc }, { block: 'kit.Text', data: { text: v.input } }) as FEl;
      expect(el.text, JSON.stringify(v.input)).toBe(v.text);
      expect(flagsOf(v.input), JSON.stringify(v.input)).toEqual(new Set(v.flags));
      expect(cardFlags({ block: { type: 'Text', text: v.input } }, [])).toEqual([...v.flags].sort());
      // re-rendering the rendered text is stable (the sanitizer is text-idempotent)
      expect((renderBlock({ doc: fdoc }, { block: 'kit.Text', data: { text: el.text } }) as FEl).text).toBe(el.text);
    }
  });
  it('fence: packages/gnomon-gui/src defines no sanitizer of its own (no control-char tables, no skipString, no sanitize module)', () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const q = path.join(d, n);
        if (statSync(q).isDirectory()) walk(q);
        else files.push(q);
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(files.some((f) => /sanitize/i.test(path.basename(f)))).toBe(false);
    for (const f of files) {
      const t = readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/skipString|skipCsi|\\x1b|\\u001b|\\x9b|\\u009b|0x1b\b|0x9b\b|0x202a|0xe0000|\\u202a|\\u200b|\[\\x00-|\\p\{Cc\}/i);
      expect(t, f).not.toMatch(/function\s+sanitize/i);
    }
  });
});

describe('DOM-text rendering (G-GUI-07): markup in a block string is text, never code', () => {
  it('script/HTML in every kit block lands as text nodes; no element the string names is created', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const tree = { block: 'kit.Box', children: [
      { block: 'kit.Text', data: { text: evil } }, { block: 'kit.Markdown', data: { text: `# t\n${evil}` } },
      { block: 'kit.List', data: { items: [evil] } }, { block: 'kit.Table', data: { columns: [evil], rows: [[evil]] } },
      { block: 'kit.Diff', data: { text: evil } }, { block: 'kit.Image', data: { alt: evil } }, { block: 'kit.Button', data: { command: 'theme.day', label: evil } },
      { block: 'evil.Unknown', data: { text: evil } }, { type: 'Text', text: evil },
    ] };
    const el = renderBlock({ doc: fdoc }, tree) as FEl;
    const tags = new Set(el.all().map((e) => e.tag));
    expect(tags.has('img')).toBe(false);
    expect(tags.has('script')).toBe(false);
    expect(el.text.split(evil).length - 1).toBeGreaterThanOrEqual(8);
    expect(el.text).toContain('[block evil.Unknown]'); // unknown block: opaque, never dropped
    for (const e of el.all()) for (const k of e.attrs.keys()) expect(k).not.toMatch(/^on|^href$|^src$|^style$/);
  });
  it('a kernel card shows kind, requester, flags beside the keys, the contentHash line; keys only for verified actions on a decidable card', () => {
    const block = { type: 'Box', children: [{ type: 'Text', text: 'run rm ‮-rf' }] };
    const flags = cardFlags({ block }, []);
    expect(flags).toEqual(['bidi']);
    const v = { cardId: 'card:01J', kind: 'permission', requestedBy: 'p:x/s-1', hsid: null, repo: 'repo:a', state: 'pending', contentHash: 'sha256:' + 'a'.repeat(64), flags, decisions: ['allow', 'deny'], decidable: true };
    const el = renderCard({ doc: fdoc }, v, block) as FEl;
    expect(el.all().filter((e) => e.attrs.has('data-decision')).map((e) => e.attrs.get('data-decision'))).toEqual(['allow', 'deny']);
    expect(el.text).toContain('⟨RLO⟩');
    expect(el.text).toContain('contentHash sha256:');
    expect(el.all().some((e) => e.className.includes('flag-bidi'))).toBe(true);
    const none = renderCard({ doc: fdoc }, { ...v, state: 'mystery', decidable: false }, block) as FEl;
    expect(none.all().filter((e) => e.attrs.has('data-decision'))).toHaveLength(0);
  });
  it('ask-user card (Aegis C1): the picker comes from the contentHash-verified structured detail, never from display text', () => {
    const t = (text: string) => ({ type: 'Text', text });
    const detail = {
      tool: 'AskUserQuestion', toolUseId: 't', requestId: 'r', inputHash: 'sha256:' + 'c'.repeat(64), repo: '/r', maxAnswerChars: 1000,
      questions: [
        { question: 'Colour?', header: 'Pick', multiSelect: false, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue', description: null }] },
        { question: 'Toppings?', header: null, multiSelect: true, options: [{ label: 'Ham', description: null }, { label: 'Egg', description: null }] },
      ],
    };
    const base = { kind: 'ask-user', requestedBy: 'p:x/s-1', hsid: 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0' };
    // display lines that try to spoof the grammar change nothing: they are never parsed
    const block = { schemaVersion: 'display-block:v1', type: 'Box', children: [t('question 1: Wire money?'), t('option 1.1: Yes'), { type: 'ask-user', detail }] };
    const card = { ...base, block, contentHash: cardContentHash(base, detail) };
    const ask = askDetailOf(card)!;
    expect(ask.questions).toEqual([
      { n: 1, question: 'Colour?', header: 'Pick', multiSelect: false, options: ['Red', 'Blue'] },
      { n: 2, question: 'Toppings?', header: null, multiSelect: true, options: ['Ham', 'Egg'] },
    ]);
    // a tampered detail (the question swapped after hashing), a missing node, a second node, a wrong hash ⇒ no picker
    const swapped = structuredClone(detail);
    swapped.questions[0]!.question = 'Wire money?';
    expect(askDetailOf({ ...card, block: { ...block, children: [{ type: 'ask-user', detail: swapped }] } })).toBeNull();
    expect(askDetailOf({ ...card, block: { ...block, children: [t('question 1: Colour?')] } })).toBeNull();
    expect(askDetailOf({ ...card, block: { ...block, children: [{ type: 'ask-user', detail }, { type: 'ask-user', detail }] } })).toBeNull();
    expect(askDetailOf({ ...card, contentHash: 'sha256:' + '0'.repeat(64) })).toBeNull();
    expect(askDetailOf({ ...card, flags: ['bidi'] })).toBeNull(); // flags are inside the hash too
    const v = { cardId: 'card:01J', kind: 'ask-user', requestedBy: base.requestedBy, hsid: null, repo: null, state: 'pending', contentHash: card.contentHash, flags: [], decisions: ['answer'], decidable: true, ask };
    const el = renderCard({ doc: fdoc }, v, block) as FEl;
    const inputs = el.all().filter((e) => e.tag === 'input');
    expect(inputs.filter((e) => e.attrs.get('type') === 'radio')).toHaveLength(2);
    expect(inputs.filter((e) => e.attrs.get('type') === 'checkbox')).toHaveLength(2);
    const free = inputs.filter((e) => e.attrs.get('data-ask-free'));
    expect(free).toHaveLength(2);
    expect(free.map((e) => e.attrs.get('maxlength'))).toEqual(['1000', '1000']); // the kernel's ASK_MAX_ANSWER_CHARS, from detail
    expect(free[0]!.attrs.get('aria-label')).toContain('question 1: Colour?');
    expect(el.text).not.toContain('Wire money?'.repeat(2));
    expect(el.all().filter((e) => e.tag === 'legend').map((e) => e.text)).toEqual(['Pick: Colour?', 'Toppings?']);
    expect(el.all().filter((e) => e.attrs.has('data-decision')).map((e) => e.attrs.get('data-decision'))).toEqual(['answer']);
    // no verified answer key, or no verified detail ⇒ no picker
    expect((renderCard({ doc: fdoc }, { ...v, decisions: [] }, block) as FEl).all().some((e) => e.tag === 'input')).toBe(false);
    expect((renderCard({ doc: fdoc }, { ...v, ask: null }, block) as FEl).all().some((e) => e.tag === 'input')).toBe(false);
    const qs = ask.questions;
    expect(JSON.parse(askNote(qs, new Map([[1, { chosen: [1], free: '' }], [2, { chosen: [0, 1], free: '' }]]))!)).toEqual({ answers: { 'Colour?': 'Blue', 'Toppings?': 'Ham, Egg' } });
    expect(JSON.parse(askNote(qs, new Map([[1, { chosen: [0], free: 'teal' }], [2, { chosen: [0], free: '' }]]))!)).toEqual({ answers: { 'Colour?': 'teal', 'Toppings?': 'Ham' } });
    expect(askNote(qs, new Map([[1, { chosen: [0], free: '' }]]))).toBeNull(); // an unanswered question sends nothing
    expect(askNote([qs[0]!], new Map([[1, { chosen: [0], free: '' }]]))).toBe('Red'); // one question: plain text
    // Aegis L1: a question named __proto__ is an ordinary key
    const proto = [{ n: 1, question: '__proto__', header: null, multiSelect: false, options: ['x'] }, { n: 2, question: 'b', header: null, multiSelect: false, options: ['y'] }];
    expect(JSON.parse(askNote(proto, new Map([[1, { chosen: [0], free: '' }], [2, { chosen: [0], free: '' }]]))!)).toEqual(JSON.parse('{"answers":{"__proto__":"x","b":"y"}}'));
  });
  it('src/ has no HTML sinks, eval, inline handlers or remote loads (scan)', () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(path.join(ROOT, 'src'));
    walk(path.join(ROOT, 'static'));
    for (const f of files) {
      const s = readFileSync(f, 'utf8').replace(/^\s*(\*|\/\/).*$/gm, '');
      expect(s, f).not.toMatch(/\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setAttribute\(\s*['"]on/);
      expect(s, f).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    }
  });
});

describe('launch fragment and key pin (§11.2 rule 2, §4.9)', () => {
  it('parses exactly #launch=<b64url>&k=<b64url>', () => {
    expect(parseLaunchFragment('#launch=abc_-1&k=MCow')).toEqual({ launchToken: 'abc_-1', kernelPublicKey: 'MCow' });
    for (const bad of ['', '#', '#launch=a', '#k=a&launch=b&x=c', '#launch=a&launch=b&k=c', '#launch=a b&k=c', '#launch=<x>&k=c']) expect(parseLaunchFragment(bad)).toBeNull();
  });
  it('boot.js reads and clears the fragment with history.replaceState before app.js, and hands it over once', () => {
    const src = readFileSync(path.join(ROOT, 'static', 'boot.js'), 'utf8');
    const replaced: string[] = [];
    const g: Record<string, unknown> = {};
    const fn = new (Object.getPrototypeOf(function () {}).constructor)('location', 'history', 'globalThis', src);
    fn({ hash: '#launch=t&k=K', pathname: '/', search: '' }, { replaceState: (_a: unknown, _b: unknown, u: string) => replaced.push(u) }, g);
    expect(replaced).toEqual(['/']);
    const take = g.gnomonTakeLaunch as () => string;
    expect(take()).toBe('#launch=t&k=K');
    expect(g.gnomonTakeLaunch).toBeUndefined();
    expect(take()).toBe('');
    const html = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
    expect(html.indexOf('/boot.js')).toBeLessThan(html.indexOf('/app.js'));
  });
  it('pin decisions: fragment pins; a changed fragment key re-pins visibly; Reconnect verifies against the pin; no pin, no fragment ⇒ refuse', () => {
    expect(decidePin('K1', null)).toEqual({ ok: true, verifyWith: 'K1', store: 'K1', notice: null });
    expect(decidePin('K1', 'K1')).toEqual({ ok: true, verifyWith: 'K1', store: null, notice: null });
    const ch = decidePin('K2', 'K1');
    expect(ch.ok && ch.store === 'K2' && ch.notice).toBeTruthy();
    expect(decidePin(null, 'K1')).toEqual({ ok: true, verifyWith: 'K1', store: null, notice: null });
    expect(decidePin(null, null).ok).toBe(false);
  });
  it('N1 surface: wrapper only for the frozen marker the wrapper defines at document start; anything a page could set is browser', () => {
    expect(hostSurface({})).toBe('browser');
    const frozen = {};
    Object.defineProperty(frozen, 'gnomonSurface', { value: 'wrapper', writable: false, configurable: false });
    expect(hostSurface(frozen)).toBe('wrapper');
    expect(hostSurface({ gnomonSurface: 'wrapper' })).toBe('browser'); // a plain assignment (writable, configurable)
    const getter = {};
    Object.defineProperty(getter, 'gnomonSurface', { get: () => 'wrapper', configurable: false });
    expect(hostSurface(getter)).toBe('browser');
    const other = {};
    Object.defineProperty(other, 'gnomonSurface', { value: 'conductor', writable: false, configurable: false });
    expect(hostSurface(other)).toBe('browser');
    // the bundle itself never defines the marker
    expect(readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8')).not.toMatch(/defineProperty\([^)]*gnomonSurface/);
  });
});

describe('WebCrypto Ed25519 serverSig (G-GUI-03 minimum, S25-M4)', () => {
  const kp = generateKeyPairSync('ed25519');
  const spki = kp.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const pem = (kp.publicKey.export({ type: 'spki', format: 'pem' }) as string).replace(/\n+$/, '');
  const keyId = `gkey:v1:${hex(sha256(pem))}`;
  const path0 = 'ws://127.0.0.1:4000/rpc';
  const CN = newClientNonce();
  const hello = (sigOver = path0, clientNonce = CN) => {
    const nonce = 'n-1';
    const sig = sign(null, Buffer.from(authServerPreimage(nonce, clientNonce, sigOver, { clientApi: 'gnomon-rpc:v1', features: [] })), kp.privateKey).toString('base64');
    return { clientApi: 'gnomon-rpc:v1', features: [], nonce, clientNonce, serverKeyId: keyId, serverSig: sig, clientApiId: 'x', kitId: 'y' };
  };
  it('keyIdOfSpki rebuilds the kernel keyId from the SPKI', () => {
    expect(keyIdOfSpki(new Uint8Array(spki))).toBe(keyId);
  });
  it('verifies a genuine hello; refuses a signature over another endpoint, a foreign key, a missing WebCrypto', async () => {
    const k = spki.toString('base64url');
    expect(await verifyServerSig(subtle, k, hello(), path0, CN)).toEqual({ ok: true });
    expect((await verifyServerSig(subtle, k, hello('ws://127.0.0.1:4001/rpc'), path0, CN)) as { reason?: string }).toMatchObject({ ok: false, reason: 'bad-server-sig' });
    const other = (generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64url');
    expect(await verifyServerSig(subtle, other, hello(), path0, CN)).toMatchObject({ ok: false, reason: 'key-id-mismatch' });
    expect(await verifyServerSig(undefined, k, hello(), path0, CN)).toMatchObject({ ok: false, reason: 'webcrypto-ed25519-unavailable' });
  });
  it('T-2026-10-18-016: a genuine hello recorded on another connection is refused — verbatim (client-nonce-mismatch) and echo-rewritten (bad-server-sig)', async () => {
    const k = spki.toString('base64url');
    const mine = newClientNonce();
    expect(mine).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mine).not.toBe(CN);
    const recorded = hello(path0, CN);
    expect(await verifyServerSig(subtle, k, recorded, path0, mine)).toMatchObject({ ok: false, reason: 'client-nonce-mismatch' });
    expect(await verifyServerSig(subtle, k, { ...recorded, clientNonce: mine }, path0, mine)).toMatchObject({ ok: false, reason: 'bad-server-sig' });
  });
  // I2: card-action verification is driven by the KERNEL's signActions in packages/gnomon/test/gui-endpoint.test.ts
});

describe('/diag and /blob are POST, X-Gnomon-Token, referrerPolicy same-origin (P8-D89b)', () => {
  it('gnomonPost sends exactly that init', async () => {
    const seen: Array<[string, RequestInit]> = [];
    const f = (async (u: string, i: RequestInit) => (seen.push([u, i]), new Response(null, { status: 204 }))) as unknown as typeof fetch;
    await gnomonPost(f, '/diag', 'tok', 'hi');
    expect(seen[0]).toEqual(['/diag', { method: 'POST', referrerPolicy: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'X-Gnomon-Token': 'tok' }, body: 'hi' }]);
  });
  it('a refusal reads as CODE, reason, message, next', () => {
    expect(refusalFromError({ code: -32005, message: 'needs presence', data: { code: 'UNSUPPORTED', data: { reason: 'web-auth-not-implemented' }, next: [{ verb: 'approve', principal: 'human' }] } })).toEqual({ code: 'UNSUPPORTED', reason: 'web-auth-not-implemented', message: 'needs presence', next: ['approve (human)'], data: { reason: 'web-auth-not-implemented' } });
  });
});

describe('store: sessions, transcript, decision stack (G-GUI-09)', () => {
  const req = (seq: number, cardId: string, repo: string, hsid?: string): Row => ({ seq, kind: 'approval.request', scope: { repo }, ...(hsid ? { session: hsid } : {}), payload: { card: { cardId, kind: 'permission', state: 'pending', ...(hsid ? { hsid } : {}) }, flags: [] } });
  it('deciding a later card leaves earlier ones pending; per-project filtering; at-most-once per seq', () => {
    const s = new GuiStore();
    s.apply([req(1, 'c1', 'repo:a'), req(2, 'c2', 'repo:b'), req(3, 'c3', 'repo:a'), req(3, 'dup', 'repo:a')]);
    expect(s.stack().map((c) => c.cardId)).toEqual(['c1', 'c2', 'c3']);
    s.apply([{ seq: 4, kind: 'approval.decide', payload: { cardId: 'c3', decision: 'allow' } }]);
    expect(s.stack().map((c) => c.cardId)).toEqual(['c1', 'c2']);
    expect(s.stack('repo:a').map((c) => c.cardId)).toEqual(['c1']);
    s.apply([{ seq: 5, kind: 'approval.expire', payload: { cardId: 'c1' } }]);
    expect(s.stack().map((c) => c.cardId)).toEqual(['c2']);
  });
  it('sessions group by project with pending counts; transcript keeps stubs as stubs', () => {
    const s = new GuiStore();
    s.apply([{ seq: 1, kind: 'session.open', session: 'hsid:v1:A', scope: { repo: 'repo:a' }, payload: { hsid: 'hsid:v1:A', backend: 'local', state: 'open' } }, req(2, 'c1', 'repo:a', 'hsid:v1:A'), { seq: 3, kind: 'turn.event', session: 'hsid:v1:A' }]);
    expect(s.groups()).toMatchObject([{ repo: 'repo:a', sessions: [{ hsid: 'hsid:v1:A', backend: 'local', pending: 1 }] }]);
    expect(s.transcript('hsid:v1:A').map((r) => r.kind)).toEqual(['session.open', 'approval.request', 'turn.event']);
    expect(rowSummary(s.transcript('hsid:v1:A')[2]!)).toContain('withheld');
  });
});

describe('virtualized transcript (G-GUI-01 unit proxy)', () => {
  it('offsets and row lookup stay exact under measurement; widths cache separately', () => {
    const h = new HeightIndex(20);
    h.push(10);
    h.set(3, 50);
    expect(h.offsetOf(4)).toBe(110);
    expect(h.indexAt(109)).toBe(3);
    expect(h.indexAt(110)).toBe(4);
    const w = new WidthCache(20);
    w.save('hsid:A', 800, h);
    expect(w.restore('hsid:A', 800, 12).offsetOf(4)).toBe(110);
    expect(w.restore('hsid:A', 400, 12).offsetOf(4)).toBe(80);
    expect(w.restore('hsid:B', 800, 12).offsetOf(4)).toBe(80); // I1: another transcript never inherits these heights
  });
  it('property: offsetOf / indexAt equal naive prefix sums under random batched push + set, across grows and restore() (B2)', () => {
    let seed = 7;
    const rnd = (n: number): number => ((seed = (seed * 1103515245 + 12345) >>> 0) % n);
    for (let trial = 0; trial < 40; trial++) {
      const idx = new HeightIndex(20);
      const naive: number[] = [];
      for (let step = 0; step < 30; step++) {
        if (rnd(3) === 0 || naive.length === 0) {
          const k = 1 + rnd(17);
          idx.push(k);
          for (let i = 0; i < k; i++) naive.push(20);
        } else {
          const i = rnd(naive.length);
          const hgt = 1 + rnd(90);
          idx.set(i, hgt);
          naive[i] = hgt;
        }
        const check = (x: HeightIndex): void => {
          let acc = 0;
          for (let i = 0; i <= naive.length; i++) {
            expect(x.offsetOf(i)).toBe(acc);
            if (i < naive.length) {
              expect(x.indexAt(acc)).toBe(i);
              expect(x.indexAt(acc + naive[i]! - 0.5)).toBe(i);
              acc += naive[i]!;
            }
          }
          expect(x.total()).toBe(acc);
        };
        check(idx);
        if (step % 10 === 9) {
          const w = new WidthCache(20);
          w.save('t', 640, idx);
          check(w.restore('t', 640, naive.length));
        }
      }
    }
  });
  it('200k rows: visible-range work per scroll/keystroke stays far under the 50 ms budget', () => {
    const h = new HeightIndex(22);
    h.push(200_000);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const r = visibleRange(h, (i * 7919) % h.total(), 900);
      h.set(r.start, 22 + (i % 3));
    }
    const per = (performance.now() - t0) / 1000;
    expect(per).toBeLessThan(1);
  });
  it.todo('M1.10 slice 2 (G-GUI-01 falsifier): a 200k-event session in the wrapper, Chromium and Safari/Edge: keystroke-to-paint < 50 ms, attach < 2 s, method stated (G-HON-07) — needs a headless browser (no Playwright in the repo)');
});

describe('chrome: palette, presets, themes (G-GUI-08, §11.3)', () => {
  it('every GUI command id is reachable from the palette; verbs come from status.verbs', () => {
    const all = paletteEntries({ verbs: [{ verb: 'status', available: true }, { verb: 'approve', available: false, milestone: 'M1.3' }] });
    for (const c of GUI_COMMANDS) expect(filterCommands(all, c.id)[0]!.id).toBe(c.id);
    expect(all.find((c) => c.id === 'verb.approve')).toMatchObject({ available: false, why: 'lands M1.3' });
  });
  it('presets round-trip and cannot hide the transcript; the extension-risk badge is not a pane', () => {
    for (const n of Object.keys(PRESETS)) expect(parseLayout(serializeLayout(applyPreset(n)))).toEqual(applyPreset(n));
    expect(togglePane(applyPreset('desk'), 'transcript').visible.transcript).toBe(true);
    const html = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
    expect(html).toMatch(/id="risk" class="badge risk kernel-owned"/);
    expect(html.indexOf('id="risk"')).toBeLessThan(html.indexOf('<main')); // header chrome, outside every pane
  });
  it('theme auto follows the OS; reduced motion from the OS or in-app', () => {
    expect([resolveTheme('auto', true), resolveTheme('auto', false), resolveTheme('day', true)]).toEqual(['night', 'day', 'day']);
    expect([resolveMotion('system', true), resolveMotion('reduce', false), resolveMotion('system', false)]).toEqual(['reduced', 'reduced', 'full']);
  });
  it.todo('M1.10 slice 2: theme choice and layout presets round-trip through the kernel per device (config.prefs, signed by the device key); mod commands in the palette (M1.11 relays)');
});

describe('G-GUI-10 contrast: the CSS tokens are the fixtures, and the fixtures pass', () => {
  const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');
  const fx = JSON.parse(readFileSync(path.join(REPO, 'docs', 'specs', 'gnomon-fixtures', 'contrast.json'), 'utf8')) as { themes: Record<string, { surfaces: Record<string, string>; text: Record<string, string>; nonText: Record<string, string> }> };
  const tokens = (theme: string): Record<string, string> => {
    const m = new RegExp(theme === 'day' ? String.raw`:root,\s*\[data-theme="day"\]\s*\{([^}]*)\}` : String.raw`\[data-theme="night"\]\s*\{([^}]*)\}`).exec(css)!;
    return Object.fromEntries([...m[1]!.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((x) => [x[1]!, x[2]!.trim().toUpperCase()]));
  };
  const MAP: Record<string, [string, string]> = { ground: ['surfaces', 'ground'], sheet: ['surfaces', 'sheet'], ink: ['text', 'ink'], ink2: ['text', 'ink2'], sec: ['text', 'sec'], fail: ['text', 'fail'], 'warn-ink': ['text', 'warnInk'], knot: ['text', 'knot'], 'key-edge': ['nonText', 'keyEdge'], 'warn-edge': ['nonText', 'warnEdge'], 'fail-edge': ['nonText', 'failEdge'], 'knot-edge': ['nonText', 'knotEdge'] };
  it.each(['day', 'night'])('%s tokens equal contrast.json', (theme) => {
    const t = tokens(theme);
    for (const [v, [grp, key]] of Object.entries(MAP)) expect(t[v], `${theme} --${v}`).toBe((fx.themes[theme] as unknown as Record<string, Record<string, string>>)[grp]![key]!.toUpperCase());
  });
  it('`color:` only ever takes a text token (project hues are fills, never text)', () => {
    const TEXT = new Set(['ink', 'ink2', 'sec', 'fail', 'warn-ink', 'knot']);
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?<![-a-z])color:\s*([^;}]+)/g)) {
      const v = /^var\(--([a-z0-9-]+)\)$/.exec(m[1]!.trim());
      expect(v && TEXT.has(v[1]!), `color: ${m[1]}`).toBe(true);
    }
  });
  it('check-contrast.mjs passes', () => {
    expect(execFileSync(process.execPath, [path.join(REPO, 'docs', 'specs', 'gnomon-fixtures', 'check-contrast.mjs')], { encoding: 'utf8' })).toContain('all pairs pass');
  });
});

describe('block buttons and the client (C6, I5)', () => {
  it('a block kit.Button is not a decision key and is live only for a safe command (never diag.send / gui.reconnect)', () => {
    const ok = renderBlock({ doc: fdoc }, { block: 'kit.Button', data: { command: 'theme.night', label: 'night' } }) as FEl;
    expect(ok.tag).toBe('button');
    expect(ok.className.split(' ')).not.toContain('key');
    for (const cmd of ['diag.send', 'gui.reconnect', 'verb.approve', 'nope']) {
      const el = renderBlock({ doc: fdoc }, { block: 'kit.Button', data: { command: cmd } }) as FEl;
      expect(el.tag, cmd).toBe('span');
      expect(el.all().some((e) => e.attrs.has('data-command')), cmd).toBe(false);
    }
    expect(BLOCK_SAFE_COMMANDS.has('diag.send') || BLOCK_SAFE_COMMANDS.has('gui.reconnect')).toBe(false);
  });
  it('an id:null error frame reaches onProtocolError; an unanswered call times out', async () => {
    const t = { send: () => undefined, close: () => undefined, onMessage: null as ((s: string) => void) | null, onClose: null as ((c: number) => void) | null };
    const c = new GnomonClient(t, { callTimeoutMs: 30 });
    const seen: string[] = [];
    c.onProtocolError((r) => seen.push(`${r.code}:${r.reason}`));
    t.onMessage!(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'unparseable', data: { code: 'BAD_REQUEST', data: { reason: 'malformed-json' } } } }));
    expect(seen).toEqual(['BAD_REQUEST:malformed-json']);
    await expect(c.call('status')).rejects.toMatchObject({ refusal: { code: 'TIMEOUT', reason: 'call-timeout' } });
  });
  it('FALSIFIER (T-2026-10-19-009 item 6): a drop after send rejects DELIVERY_UNKNOWN, a call after the drop CLOSED; never success', async () => {
    const sent: string[] = [];
    const t = { send: (s: string) => void sent.push(s), close: () => undefined, onMessage: null as ((s: string) => void) | null, onClose: null as ((c: number) => void) | null };
    const c = new GnomonClient(t, { callTimeoutMs: 5000 });
    const inFlight = c.call('approve', { cardId: 'card:x', decision: 'allow' });
    expect(sent.length).toBe(1);
    t.onClose!(1006);
    await expect(inFlight).rejects.toMatchObject({ refusal: { code: 'DELIVERY_UNKNOWN', reason: 'delivery-unknown' } });
    await expect(c.call('status')).rejects.toMatchObject({ refusal: { code: 'CLOSED', reason: 'connection-closed' } });
    expect(sent.length).toBe(1);
  });
  it('FALSIFIER: a call while the WebSocket is not OPEN (closing, before onclose) is CLOSED and sends nothing — never DELIVERY_UNKNOWN', async () => {
    const sent: string[] = [];
    let open = true;
    const t = { send: (s: string) => void sent.push(s), isOpen: () => open, close: () => undefined, onMessage: null as ((s: string) => void) | null, onClose: null as ((c: number) => void) | null };
    const c = new GnomonClient(t, { callTimeoutMs: 5000 });
    open = false; // readyState left OPEN; onclose has not fired yet
    await expect(c.call('status')).rejects.toMatchObject({ refusal: { code: 'CLOSED', reason: 'connection-closed' } });
    expect(sent.length).toBe(0);
  });
  it('T-2026-10-18-016 r2: an engine whose RNG throws fails the hello stage visibly and sends nothing (connect never throws)', async () => {
    const sent: string[] = [];
    const t = { send: (s: string) => void sent.push(s), close: () => undefined, onMessage: null as ((s: string) => void) | null, onClose: null as ((c: number) => void) | null };
    const out = await new GnomonClient(t).connect({
      surface: 'browser',
      endpointPath: 'ws://127.0.0.1:4000/rpc',
      verifyKey: 'x',
      auth: { launchToken: 'x' },
      subtle: undefined,
      rng: () => {
        throw new Error('no getRandomValues');
      },
    });
    expect(out).toMatchObject({ ok: false, stage: 'hello' });
    expect(sent).toEqual([]);
  });
});

describe('deferred to M1.10 slice 2', () => {
  it.todo('G-GUI-03 browser matrix: Safari/Chrome/Firefox (macOS), Edge/Chrome/Firefox (Windows), both WebViews render every fixture; the bundled pure-JS Ed25519 fallback verifier');
  it.todo('G-GUI-02: 60 s socket+input silence ⇒ zero DOM mutations, no running animation (MutationObserver in a real engine)');
  it.todo('G-GUI-04: no write verb without a user gesture — browser harness (slice 1 gates approve/send/open on trusted DOM events only)');
  it.todo('G-GUI-05: close mid-turn, reopen, Reconnect, no event lost (needs #identity M1.3 presence for Reconnect)');
  it.todo('G-GUI-06: cached unlock 15 min idle expiry per connection (M1.3)');
  it.todo('swap the in-bundle client for the published @a-company/gnomon-client (#client-ts, M1.12)');
  it.todo('bundled JetBrains Mono / Fraunces font files (law 6); streaming Markdown renderer with raw HTML disabled; kit.Diff per-hunk; kit.Image via POST /blob + blob: URL');
  it.todo('React renderer (spec §11.1) when the Doodle canvas lands (§12.7); composer history, kill ring, undo, paste collapse, ⇧Tab run mode, Esc interrupt');
  it.todo('strictness/run-mode header control (G-STR-09), voice-arm indicator (G-GUI-13), wrapper surface detection');
});

describe('#bare-entry folder hint (spec §2.4 rule 8): prefilled and shown as text, never acted on', () => {
  const b64 = (s: string | Uint8Array): string => Buffer.from(s as never).toString('base64url');
  const target = () => {
    const submits: string[] = [];
    return { input: { value: '' }, note: { textContent: null as string | null, hidden: true }, dialog: { hidden: true }, requestSubmit: () => submits.push('requestSubmit'), submit: () => submits.push('submit'), submits };
  };
  const CTRL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069\\ufffd]');
  it('the fragment carries an optional cwd; a malformed hint drops the hint, never the launch; any other key is still refused', () => {
    const c = b64('/Users/matt/repo');
    expect(parseLaunchFragment(`#launch=t&k=K&cwd=${c}`)).toEqual({ launchToken: 't', kernelPublicKey: 'K', cwd: c });
    expect(parseLaunchFragment('#launch=t&k=K&cwd=%2Fetc')).toEqual({ launchToken: 't', kernelPublicKey: 'K' });
    expect(parseLaunchFragment(`#launch=t&k=K&cwd=${'A'.repeat(2000)}`)).toEqual({ launchToken: 't', kernelPublicKey: 'K' });
    for (const bad of [`#launch=t&k=K&cwd=${c}&x=1`, `#launch=t&k=K&cwd=${c}&cwd=${c}`, `#launch=t&cwd=${c}`]) expect(parseLaunchFragment(bad)).toBeNull();
  });
  it('a clean absolute path is prefilled and named as an unverified suggestion; the form opens and is NOT submitted', () => {
    const t = target();
    applyCwdHint(t, cwdHintOf(b64('/Users/matt/my "repo"'))!);
    expect(t.input.value).toBe('/Users/matt/my "repo"');
    expect(t.note.textContent).toContain('not verified');
    expect(t.note.textContent).toContain('/Users/matt/my "repo"');
    expect(t.note.hidden).toBe(false);
    expect(t.dialog.hidden).toBe(false);
    expect(t.submits).toEqual([]);
  });
  it('FALSIFIER: hostile paths (newline, ESC, bidi override, NUL, invalid UTF-8, backslash) are shown escaped and never prefilled', () => {
    const cases: Array<[string | Uint8Array, string]> = [
      ['/tmp/a' + String.fromCodePoint(0x0a) + 'b', '\\u{a}'],
      ['/tmp/' + String.fromCodePoint(0x1b) + '[31mred', '\\u{1b}'],
      ['/tmp/' + String.fromCodePoint(0x202e) + 'gnp.exe', '\\u{202e}'],
      ['/tmp/a' + String.fromCodePoint(0) + 'b', '\\u{0}'],
      [Uint8Array.from([0x2f, 0x74, 0xff, 0xfe, 0x78]), '\\u{fffd}'],
      ['/tmp/a\\b', '\\\\'],
    ];
    for (const [raw, frag] of cases) {
      const h = cwdHintOf(b64(raw))!;
      expect(h.prefill, JSON.stringify(String(raw))).toBeNull();
      expect(h.display).toContain(frag);
      expect(h.display).not.toMatch(CTRL);
      const t = target();
      applyCwdHint(t, h);
      expect(t.input.value).toBe('');
      expect(t.note.textContent).toContain('not prefilled');
      expect(t.submits).toEqual([]);
    }
    expect(cwdHintOf(b64('relative/dir'))!.prefill).toBeNull();
  });
  it('FALSIFIER: a very long path is capped for display; over the byte cap it is not a hint at all', () => {
    const long = `/${'a'.repeat(900)}`;
    const h = cwdHintOf(b64(long))!;
    expect([...h.display].length).toBeLessThan(CWD_DISPLAY_CAP + 20);
    expect(h.display).toContain('(+661 chars)');
    expect(h.prefill).toBe(long); // clean: the field holds the whole path, the note shows the capped one
    expect(cwdHintOf(b64(`/${'a'.repeat(1100)}`))).toBeNull();
  });
  it('app.ts applies the hint through applyCwdHint only: the hint path never calls openSession, session.open or a submit', () => {
    const src = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    const i = src.indexOf('#bare-entry (Aegis M1): the folder hint is shown ONLY');
    expect(i).toBeGreaterThan(0);
    const block = src.slice(i, src.indexOf('applyCwdHint(', i) + 60);
    expect(block).toContain('applyCwdHint(');
    expect(block).not.toMatch(/openSession|session\.open|requestSubmit|\.submit\(|attended/);
    const lib = readFileSync(path.join(ROOT, 'src', 'core', 'launch.ts'), 'utf8');
    expect(lib.slice(lib.indexOf('export function applyCwdHint'))).not.toMatch(/requestSubmit|\.submit\(|innerHTML|session\.open/);
    expect(readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8')).toContain('<p id="ns-hint" class="meta" hidden></p>');
  });
});

describe('#bare-entry hint after Aegis review (M1, L1, L2, L3)', () => {
  const vectors = JSON.parse(readFileSync(path.join(REPO, 'packages', 'gnomon', 'test', 'fixtures', 'cwd-hint.v1.json'), 'utf8')) as { cases: Array<{ name: string; cps: number[]; prefill: boolean; escaped: string[] }> };
  const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
  it('L3: the shared vectors (U+034F, U+115F, U+3164, U+FE0F, U+FFF9, U+E0001, …) prefill exactly when every code point is shown as itself', () => {
    expect(vectors.cases.length).toBeGreaterThan(20);
    for (const v of vectors.cases) {
      const p = String.fromCodePoint(...v.cps);
      const h = cwdHintOf(Buffer.from(p, 'utf8').toString('base64url'))!;
      expect(h.prefill !== null, v.name).toBe(v.prefill);
      if (v.prefill) expect(Buffer.from(h.prefill!, 'utf8').equals(Buffer.from(p, 'utf8')), v.name).toBe(true); // the ORIGINAL bytes, not NFC
      for (const e of v.escaped) expect(h.display, v.name).toContain(e);
    }
  });
  it('M1 FALSIFIER: the hint is applied only inside attach after the token verified; a failed attach or Reconnect carries none', () => {
    const calls = app.split('applyCwdHint(').length - 1;
    expect(calls).toBe(1);
    const start = app.indexOf('async function attach(');
    const ok = app.indexOf('session = out.session;', start);
    const failed = app.indexOf('if (!out.ok) {', start);
    const apply = app.indexOf('applyCwdHint(');
    expect(failed).toBeGreaterThan(start);
    expect(ok).toBeGreaterThan(failed);
    expect(apply).toBeGreaterThan(ok); // after the failure returns: a bad token leaves ns-cwd empty and ns-hint hidden
    expect(app).toContain('hint: CwdHint | null = null'); // Reconnect calls attach without a hint
    for (const l of app.split('\n').filter((x) => x.includes('attach({ reconnect: true }'))) expect(l).not.toMatch(/cwdHintOf|hint/);
  });
  it('L1: a valid launch attaches; only a page without a fragment shows Reconnect', () => {
    const i = app.indexOf('export function main(raw?: string)');
    const body = app.slice(i, app.indexOf('\n}', i));
    expect(body).toMatch(/if \(frag\) void attach\(\{ launchToken: frag\.launchToken \}, frag\.kernelPublicKey, frag\.cwd !== undefined \? cwdHintOf\(frag\.cwd\) : null\);\n\s*else showReconnect\(/);
  });
  it('L2: the note is cleared on cancel, submit and a later "+ new"; the submit handler requires a trusted event', () => {
    const t = { input: { value: '' }, note: { textContent: null as string | null, hidden: true }, dialog: { hidden: true } };
    applyCwdHint(t, cwdHintOf(Buffer.from('/Users/matt/repo').toString('base64url'))!);
    clearCwdHint(t);
    expect(t.note).toEqual({ textContent: '', hidden: true });
    const cancel = app.slice(app.indexOf("$('ns-cancel')"), app.indexOf("$('new-session-form')"));
    expect(cancel).toContain('clearCwdHint(hintTarget())');
    const submit = app.slice(app.indexOf("$('new-session-form')"), app.indexOf("$('reconnect-btn')"));
    expect(submit).toMatch(/if \(!e\.isTrusted\) return;[\s\S]*clearCwdHint\(hintTarget\(\)\)[\s\S]*openSession\(/);
    const neu = app.slice(app.indexOf("id === 'session.new'"), app.indexOf("id === 'composer.focus'"));
    expect(neu).toContain('clearCwdHint(hintTarget())');
  });
});

describe('#gui messages name a command that exists (round 3)', () => {
  it('no page text tells the user to run `gnomon open` (it has no verb yet); NFD input is shown composed and prefilled as is', () => {
    for (const f of [path.join(ROOT, 'src', 'core', 'launch.ts'), path.join(ROOT, 'src', 'ui', 'app.ts')]) expect(readFileSync(f, 'utf8')).not.toMatch(/run `gnomon open`|came (from|through) \\?`gnomon open/);
    expect(decidePin(null, null)).toMatchObject({ ok: false, message: expect.stringContaining('run `gnomon` (or `gnomon up`) in a terminal') });
    const nfd = '/r/cafe' + String.fromCodePoint(0x301);
    const h = cwdHintOf(Buffer.from(nfd, 'utf8').toString('base64url'))!;
    expect(h.display).toBe('/r/caf' + String.fromCodePoint(0xe9));
    expect(h.prefill).toBe(nfd);
  });
});
