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
import { followLog, GnomonClient, GUI_FEATURES, gnomonPost, isCursorEpoch, refusalFromError, RpcError } from '../src/core/client.js';
import { applyPreset, BLOCK_SAFE_COMMANDS, filterCommands, GUI_COMMANDS, paletteEntries, parseLayout, PRESETS, resolveMotion, resolveTheme, serializeLayout, togglePane } from '../src/core/commands.js';
import { applyCwdHint, clearCwdHint, cwdHintOf, CWD_DISPLAY_CAP, decidePin, hostSurface, parseLaunchFragment } from '../src/core/launch.js';
import { approveParamsOf, askDetailOf, askNote, prefixOptionsOf, shownPrefixWords, cardContentHash, cardFlags, flagsOf, renderBlock, renderCard, type MiniDoc, type MiniEl } from '../src/core/render.js';
import { keyIdOfSpki, newClientNonce, verifyServerSig } from '../src/core/server-sig.js';
import { Follow, isAtBottom } from '../src/core/follow.js';
import { chatItems, GuiStore, rowOf, rowSummary, toolSummary, turnEventSummary, type Row } from '../src/core/store.js';
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
  it('TD-2026-10-19-063: a claim-mismatch card (an unsigned claude re-pin) marks Deny as the default key; a plain card marks none', () => {
    const block = { type: 'Box', children: [{ type: 'Text', text: 'NOT signed by the expected publisher' }] };
    const v = { cardId: 'card:01J', kind: 'gate-class', requestedBy: 'p:x/kernel', hsid: null, repo: null, state: 'pending', contentHash: 'sha256:' + 'a'.repeat(64), flags: ['claim-mismatch'], decisions: ['allow', 'deny'], decidable: true };
    const el = renderCard({ doc: fdoc }, v, block) as FEl;
    expect(el.className).toContain('claim-mismatch');
    expect(el.all().filter((e) => e.attrs.has('data-default')).map((e) => e.attrs.get('data-decision'))).toEqual(['deny']);
    const plain = renderCard({ doc: fdoc }, { ...v, flags: [] }, block) as FEl;
    expect(plain.all().filter((e) => e.attrs.has('data-default'))).toHaveLength(0);
    // S1 ink keys: a plain card fills its first non-deny key; the claim-mismatch card fills none (Deny stays default, unfilled)
    const priOf = (x: FEl): (string | undefined)[] => x.all().filter((e) => /(^| )pri( |$)/.test(e.className)).map((e) => e.attrs.get('data-decision'));
    expect(priOf(plain)).toEqual(['allow']);
    expect(priOf(el)).toEqual([]);
    expect(priOf(renderCard({ doc: fdoc }, { ...v, flags: [], decisions: ['deny', 'allow'] }, block) as FEl)).toEqual(['allow']);
    expect(priOf(renderCard({ doc: fdoc }, { ...v, flags: [], decisions: ['deny'] }, block) as FEl)).toEqual([]);
    // the contentHash line stays on every card (GUI-core security summary)
    expect(plain.all().some((e) => e.className.includes('content-hash') && e.text.startsWith('contentHash sha256:'))).toBe(true);
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
  it('Bash permission card (TD-2026-10-20-294): always offers the exact command or the verified prefix choices', () => {
    const detail = { tool: 'Bash', toolUseId: 't', requestId: 'r', inputHash: 'sha256:' + 'c'.repeat(64), repo: '/r', prefixOptions: [['git'], ['git', 'log']] };
    const base = { kind: 'permission', requestedBy: 'p:x/s-1', hsid: 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0' };
    const block = { schemaVersion: 'display-block:v1', type: 'Box', children: [{ type: 'Text', text: 'command: git log -n 5' }, { type: 'bash-prefix', detail }] };
    const card = { ...base, block, contentHash: cardContentHash(base, detail) };
    const opts = prefixOptionsOf(card)!;
    expect(opts).toEqual([['git'], ['git', 'log']]);
    // a tampered (widened) detail, a missing node, a wrong hash, a non-permission kind ⇒ exact only
    expect(prefixOptionsOf({ ...card, block: { ...block, children: [{ type: 'bash-prefix', detail: { ...detail, prefixOptions: [['rm']] } }] } })).toBeNull();
    expect(prefixOptionsOf({ ...card, block: { ...block, children: [] } })).toBeNull();
    expect(prefixOptionsOf({ ...card, contentHash: 'sha256:' + '0'.repeat(64) })).toBeNull();
    expect(prefixOptionsOf({ ...card, kind: 'ask-user' })).toBeNull();
    const v = { cardId: 'card:01J', kind: 'permission', requestedBy: base.requestedBy, hsid: null, repo: null, state: 'pending', contentHash: card.contentHash, flags: [], decisions: ['allow', 'deny', 'always'], decidable: true, prefixOptions: opts };
    const el = renderCard({ doc: fdoc }, v, block) as FEl;
    const always = el.all().filter((e) => e.attrs.get('data-decision') === 'always');
    expect(always.map((e) => e.text)).toEqual(['Always: this exact command', "Always: 'git' …", "Always: 'git' 'log' …"]);
    expect(always.map((e) => e.attrs.get('data-scope'))).toEqual(['exact', 'prefix', 'prefix']);
    expect(always.map((e) => e.attrs.get('data-prefix'))).toEqual([undefined, '["git"]', '["git","log"]']);
    // no verified prefix choices ⇒ the plain always key
    const plain = (renderCard({ doc: fdoc }, { ...v, prefixOptions: null }, block) as FEl).all().filter((e) => e.attrs.get('data-decision') === 'always');
    expect(plain.map((e) => e.text)).toEqual(['always']);
    expect(plain[0]!.attrs.has('data-scope')).toBe(false);
    // the choice SENDS its scope: the approve params come from the clicked key's data-scope / data-prefix
    const keyOf = (e: FEl): { scope?: string; prefix?: string } => ({ ...(e.attrs.has('data-scope') ? { scope: e.attrs.get('data-scope')! } : {}), ...(e.attrs.has('data-prefix') ? { prefix: e.attrs.get('data-prefix')! } : {}) });
    expect(approveParamsOf('card:01J', 'always', null, keyOf(always[2]!))).toEqual({ cardId: 'card:01J', decision: 'always', scope: { kind: 'prefix', prefix: ['git', 'log'] } });
    expect(approveParamsOf('card:01J', 'always', null, keyOf(always[1]!))).toEqual({ cardId: 'card:01J', decision: 'always', scope: { kind: 'prefix', prefix: ['git'] } });
    expect(approveParamsOf('card:01J', 'always', null, keyOf(always[0]!))).toEqual({ cardId: 'card:01J', decision: 'always', scope: { kind: 'exact' } });
    expect(approveParamsOf('card:01J', 'always', null, keyOf(plain[0]!))).toEqual({ cardId: 'card:01J', decision: 'always' });
    // only always carries a scope; a malformed prefix sends none (the kernel learns the exact rule)
    expect(approveParamsOf('card:01J', 'allow', null, { scope: 'prefix', prefix: '["git"]' })).toEqual({ cardId: 'card:01J', decision: 'allow' });
    expect(approveParamsOf('card:01J', 'always', null, { scope: 'prefix', prefix: '{bad' })).toEqual({ cardId: 'card:01J', decision: 'always' });
    expect(approveParamsOf('card:01J', 'always', null, { scope: 'prefix', prefix: '[]' })).toEqual({ cardId: 'card:01J', decision: 'always' });
  });
  it("prefix words render separately and quoted, non-ASCII escaped (Aegis M1): 'git log' x and a homoglyph argv0", () => {
    expect(shownPrefixWords(['git log', 'x'])).toBe("'git log' 'x'");
    expect(shownPrefixWords(['git', 'log', 'x'])).toBe("'git' 'log' 'x'");
    expect(shownPrefixWords(['git log', 'x'])).not.toBe(shownPrefixWords(['git', 'log', 'x']));
    // Cyrillic i (U+0456) in argv0 is visibly not git
    expect(shownPrefixWords(['gіt', 'log'])).toBe("'g\\u0456t' 'log'");
    expect(shownPrefixWords(['git​', 'log'])).toBe("'git\\u200b' 'log'");
    expect(shownPrefixWords(["it's", 'a\\b'])).toBe("'it\\u0027s' 'a\\u005cb'");
    expect(shownPrefixWords(['\u{1f600}x', 'y'])).toBe("'\\u{1f600}x' 'y'");
    // and the card keys use it
    const v = { cardId: 'card:01J', kind: 'permission', requestedBy: 'p:x/s-1', hsid: null, repo: null, state: 'pending', contentHash: 'sha256:' + 'c'.repeat(64), flags: [], decisions: ['always'], decidable: true, prefixOptions: [['git log', 'x'], ['gіt', 'log']] };
    const keys = (renderCard({ doc: fdoc }, v, { schemaVersion: 'display-block:v1', type: 'Box', children: [] }) as FEl).all().filter((e) => e.attrs.get('data-scope') === 'prefix');
    expect(keys.map((e) => e.text)).toEqual(["Always: 'git log' 'x' …", "Always: 'g\\u0456t' 'log' …"]);
  });
  it('src/ has no HTML sinks, eval, inline handlers or remote loads (scan)', () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js|mjs|html|css|svg)$/.test(n)) files.push(p); // code only: the fonts are binary, the OFL texts carry upstream URLs (test/fonts.test.ts)
      }
    };
    walk(path.join(ROOT, 'src'));
    walk(path.join(ROOT, 'static'));
    expect(files.some((f) => f.endsWith('styles.css'))).toBe(true);
    for (const f of files) {
      const s = readFileSync(f, 'utf8').replace(/^\s*(\*|\/\/).*$/gm, '');
      expect(s, f).not.toMatch(/\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setAttribute\(\s*['"]on/);
      expect(s.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '').replace(/^const SVG_NS = 'http:\/\/www\.w3\.org\/2000\/svg';$/m, ''), f).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/); // the SVG namespace is a name, not a load
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
  it('wire rows (contracts LogRow {seq, view, event | stub}) are flattened: the session is listed and its transcript filled', () => {
    // dogfood 2026-10-19: the kernel's nested rows read flat had no kind and no session ⇒ "sessions 0 live · 0 seen"
    const H = 'hsid:v1:01M5ATH1BQBCRNY5REDJ20RA7D';
    const s = new GuiStore();
    s.apply([
      { seq: 1, view: 'full', event: { seq: 1, kind: 'daemon.start', at: 'x', principal: 'p:k', payload: { pid: 1 } } },
      { seq: 2, view: 'full', event: { seq: 2, kind: 'session.open', at: 'x', principal: 'p:h', session: H, scope: { repo: 'repo:a' }, payload: { hsid: H, backend: 'claude-code', state: 'running' } } },
      { seq: 3, view: 'stub', stub: { kind: 'session.inject', hsid: H, at: 'x' } },
      { seq: 4, view: 'full', event: { seq: 4, kind: 'turn.event', at: 'x', principal: 'p:k', session: H, payload: { hsid: H, type: 'assistant', line: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }) } } },
      { seq: 5, view: 'oversize', kind: 'turn.event', bytes: 2_000_000 },
      { seq: 6, view: 'full', event: { seq: 6, kind: 'turn.result', at: 'x', principal: 'p:k', session: H, payload: { hsid: H, isError: false } } },
    ]);
    expect(s.groups()).toMatchObject([{ repo: 'repo:a', sessions: [{ hsid: H, state: 'idle', backend: 'claude-code' }] }]);
    expect(s.transcript(H).map((r) => [r.kind, r.view])).toEqual([['session.open', 'full'], ['session.inject', 'stub'], ['turn.event', 'full'], ['turn.result', 'full']]);
    expect(s.transcript(H).map(rowSummary)).toContain('assistant · hi');
    expect(rowSummary(s.transcript(H)[1]!)).toContain('withheld');
    expect(s.kernelFeed.map((r) => [r.kind, r.view])).toEqual([['daemon.start', 'full'], ['turn.event', 'oversize']]);
    // junk never throws and never lands as a session; an unknown view stays opaque
    expect(rowOf(null)).toBeNull();
    expect(rowOf({ view: 'full' })).toBeNull();
    expect(rowOf({ seq: 9, view: 'later', x: 1 })).toEqual({ seq: 9, kind: 'unknown', view: 'later' });
    expect(rowOf({ seq: 9, view: 'full', event: 'nope' })).toEqual({ seq: 9, kind: 'unknown', view: 'full' });
  });
  it('turn.event lines read as the assistant text, its tools and the result; anything else is its type', () => {
    const a = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'secret-ish' }, { type: 'text', text: 'hello' }, { type: 'tool_use', name: 'Bash' }] } });
    expect(turnEventSummary(a, 'assistant')).toBe('assistant · hello · tool Bash');
    expect(turnEventSummary(JSON.stringify({ type: 'result', subtype: 'success' }), 'result')).toBe('result · success');
    expect(turnEventSummary(JSON.stringify({ type: 'stream_event', event: {} }), 'stream_event.content_block_delta')).toBe('turn.event · stream_event.content_block_delta');
    expect(turnEventSummary('{not json', null)).toBe('turn.event · line');
    expect(turnEventSummary(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(5000) }] } }), null).length).toBeLessThanOrEqual(4000 + 'assistant · '.length);
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
  it('re-review L-4: invalidate drops a remounted row back to the estimate; the page invalidates each stale index', () => {
    const h = new HeightIndex(20);
    h.push(5);
    h.set(1, 90);
    h.invalidate(1);
    expect(h.height(1)).toBe(20);
    expect(h.offsetOf(2)).toBe(40);
    h.invalidate(9); // out of range: ignored
    expect(h.total()).toBe(100);
    expect(readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8')).toMatch(/for \(const i of stale\) if \(i < lcp\) heights\.invalidate\(i\);/);
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
  it('presets round-trip and cannot hide the transcript; the extension-risk chip is not a pane', () => {
    for (const n of Object.keys(PRESETS)) expect(parseLayout(serializeLayout(applyPreset(n)))).toEqual(applyPreset(n));
    expect(togglePane(applyPreset('desk'), 'transcript').visible.transcript).toBe(true);
    const html = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
    expect(html).toMatch(/id="risk" class="risk-chip kernel-owned"(?![^>]*\shidden)/); // board header-5b: an outlined amber chip at key height, shown before attach (Aegis)
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
  const MAP: Record<string, [string, string]> = { ground: ['surfaces', 'ground'], sheet: ['surfaces', 'sheet'], ink: ['text', 'ink'], ink2: ['text', 'ink2'], sec: ['text', 'sec'], fail: ['text', 'fail'], 'warn-ink': ['text', 'warnInk'], knot: ['text', 'knot'], slate: ['text', 'slate'], 'key-edge': ['nonText', 'keyEdge'], 'warn-edge': ['nonText', 'warnEdge'], 'fail-edge': ['nonText', 'failEdge'], 'knot-edge': ['nonText', 'knotEdge'],
    // S1: the project ink pairs (project names as text) are fixture text tokens
    'p-terracotta-ink': ['text', 'terracotta'], 'p-sage-ink': ['text', 'sage'], 'p-slate-ink': ['text', 'slate'], 'p-ochre-ink': ['text', 'ochre'], 'p-rose-clay-ink': ['text', 'rose-clay'], 'p-sea-grey-ink': ['text', 'sea-grey'] };
  it.each(['day', 'night'])('%s tokens equal contrast.json', (theme) => {
    const t = tokens(theme);
    for (const [v, [grp, key]] of Object.entries(MAP)) expect(t[v], `${theme} --${v}`).toBe((fx.themes[theme] as unknown as Record<string, Record<string, string>>)[grp]![key]!.toUpperCase());
  });
  it.each(['day', 'night'])('%s --on-ink is the fixture on-ink pair (primary key text on its --ink fill)', (theme) => {
    const t = tokens(theme);
    const pair = (fx.themes[theme] as unknown as { pairs: { fg: string; bg: string; what: string }[] }).pairs.find((p) => p.what.startsWith('on-ink'))!;
    expect([t['on-ink'], t['ink']]).toEqual([pair.fg.toUpperCase(), pair.bg.toUpperCase()]);
  });
  it('S1: the voice-armed edge on its fill is a fixture nonText pair (>= 3:1), and sage stays fill-only', () => {
    const day = fx.themes.day as unknown as { pairs: { fg: string; bg: string; kind: string; what: string }[]; fillOnly: Record<string, string> };
    expect(day.pairs.find((p) => p.what.startsWith('voice-armed indicator edge'))).toMatchObject({ fg: tokens('day')['warn-edge'], bg: tokens('day')['warn-bg'], kind: 'nonText' });
    expect(tokens('day')['p-sage-fill']).toBe(day.fillOnly.sage!.toUpperCase());
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/(?<![-a-z])(color|border(-[a-z]+)?|outline):[^;}]*--p-sage-fill/);
  });
  it('`color:` only ever takes a text token (project hues are fills, never text)', () => {
    const TEXT = new Set(['ink', 'ink2', 'sec', 'fail', 'warn-ink', 'knot', 'slate', 'on-ink', 'p-terracotta-ink', 'p-sage-ink', 'p-slate-ink', 'p-ochre-ink', 'p-rose-clay-ink', 'p-sea-grey-ink']); // slate is a fixture text token (a project ink); on-ink: the filled primary key (S1)
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?<![-a-z])color:\s*([^;}]+)/g)) {
      const v = /^var\(--([a-z0-9-]+)\)$/.exec(m[1]!.trim());
      expect(v && TEXT.has(v[1]!), `color: ${m[1]}`).toBe(true);
    }
  });
  it('S1 ink keys: hard 2px ink offset on a --key-edge ring (>= 3:1), filled primary in on-ink; none at night; no card glow', () => {
    const t = tokens('day');
    expect(t['key-shadow']).toBe('2PX 2PX 0 VAR(--KEY-EDGE)');
    expect(tokens('night')['key-shadow']).toBe('NONE');
    const key = /\n\.key \{([^}]*)\}/.exec(css)![1]!;
    expect(key).toMatch(/border: 1px solid var\(--key-edge\);/);
    expect(key).toMatch(/box-shadow: var\(--key-shadow\);/);
    expect(key).toMatch(/min-height: 28px;/);
    expect(css).toMatch(/\.key\.pri \{ background: var\(--ink\); color: var\(--on-ink\); \}/);
    expect(css).not.toMatch(/--glow\b/);
    expect(css).toMatch(/\[data-theme="night"\] \.wordmark \{[^}]*text-shadow: var\(--wm-glow\);/);
  });
  it.each(['day', 'night'])('%s field edges (board gnomon-field-border): --sec at rest is >= 3:1 on the page and the sheet', (theme) => {
    const t = tokens(theme);
    const lum = (hex: string): number => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
    const ratio = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    expect(ratio(t['sec']!, t['ground']!)).toBeGreaterThanOrEqual(5.5);
    expect(ratio(t['sec']!, t['sheet']!)).toBeGreaterThanOrEqual(5.5);
  });
  it('field edges: --sec at rest, --key-edge on hover, a 2px --key-edge focus ring; never --rule', () => {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (sel: string): string => [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.trim() === sel).map((m) => m[2]!).join(';');
    for (const sel of ['.field', '.palfield', '.composer', '.rename-input']) expect(rule(sel), sel).toMatch(/border: 1px solid var\(--sec\)/);
    for (const sel of ['.field:hover', '.palfield:hover', '.composer:hover']) expect(rule(sel), sel).toMatch(/border-color: var\(--key-edge\)/);
    expect(flat).toMatch(/\.field:focus-visible[^{]*\{ outline: 2px solid var\(--key-edge\)/);
    expect(rule('.palfield:focus-visible')).toMatch(/outline: 2px solid var\(--key-edge\)/);
    expect(rule('#session-search')).not.toMatch(/border/);
  });
  it('status is ink (board gnomon-status-colour): no project hue, --slate, --live or --stamp on a status rule', () => {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(flat).not.toMatch(/--(live|stamp)\b/);
    const STATUS = /voice-dot|voice-meter|vs-meter|link-dot|\.stamp|vs-v\.ok|vs-heard|\.said|trow\.voice/;
    for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (STATUS.test(m[1]!)) expect(m[2], m[1]!.trim()).not.toMatch(/--(slate|p-[a-z-]+-(ink|fill))\b/);
    expect(flat).toMatch(/\.vs-v\.ok \{ color: var\(--ink\); font-weight: 600; \}/);
    expect(flat).toMatch(/\.trow\.voice \.who \{ color: var\(--ink2\); \}/);
    expect(flat).toMatch(/\.trow\.role-assistant \.said \{[^}]*border-left: 3px solid var\(--ink2\)/);
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
    expect(body).toMatch(/if \(frag\) void attach\(\{ launchToken: frag\.launchToken \}, frag\.kernelPublicKey, frag\.cwd !== undefined \? cwdHintOf\(frag\.cwd\) : null\);\n\s*else if \(resumed\) void attach\(\{ resumeToken: resumed\.resumeToken \}, resumed\.kernelPublicKey\);\n\s*else showReconnect\(/);
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

/* ── journal.cursor (P8-D98, §5): the {logId, seq} cursor and cursor-epoch ── */
describe('#gui log.read cursor (journal.cursor)', () => {
  const LOG_A = 'log:01JAAAAAAAAAAAAAAAAAAAAAAA';
  const LOG_B = 'log:01JBBBBBBBBBBBBBBBBBBBBBBB';
  const epoch = () => new RpcError({ code: 'BAD_REQUEST', reason: 'cursor-epoch', message: 'the cursor names another log', next: [], data: { reason: 'cursor-epoch' } });

  it('the hello offers journal.cursor', () => {
    expect(GUI_FEATURES).toEqual(['journal.cursor', 'session.resume']);
  });

  it('every resume sends the {logId, seq} cursor, never a bare seq', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const pages = [
      { rows: [{ seq: 1, kind: 'daemon.start' }], next: 1, caughtUp: false, logId: LOG_A },
      { rows: [{ seq: 3, kind: 'config.loaded' }], next: 4, caughtUp: true, logId: LOG_A },
    ];
    const c = {
      call: async <T,>(_m: string, p?: unknown): Promise<T> => {
        calls.push(p as Record<string, unknown>);
        return ((p as { follow?: boolean }).follow ? { logId: LOG_A, subscription: 'sub:1' } : pages.shift()) as T;
      },
    };
    const store = new GuiStore();
    await followLog(c, store);
    expect(calls).toEqual([{ limit: 1000 }, { since: { logId: LOG_A, seq: 1 }, limit: 1000 }, { since: { logId: LOG_A, seq: 4 }, follow: true }]);
    for (const p of calls) expect(typeof p.since).not.toBe('number');
    expect(store.cursor()).toEqual({ logId: LOG_A, seq: 4 });
  });

  it('after cursor-epoch the store is cleared and the read starts over from the start', async () => {
    const store = new GuiStore();
    store.adopt(LOG_A);
    store.apply([{ seq: 7, kind: 'approval.request', payload: { card: { cardId: 'card:1', kind: 'tool' } } }, { seq: 8, kind: 'session.open', session: 'hsid:v1:X' }]);
    expect(store.cards.size).toBe(1);
    const changes: string[][] = [];
    store.onChange((w) => changes.push([...w]));
    const calls: Array<Record<string, unknown>> = [];
    const c = {
      call: async <T,>(_m: string, p?: unknown): Promise<T> => {
        calls.push(p as Record<string, unknown>);
        const q = p as { since?: { logId: string }; follow?: boolean };
        if (q.since?.logId === LOG_A) throw epoch();
        if (q.follow) return { logId: LOG_B, subscription: 'sub:2' } as T;
        return { rows: [{ seq: 1, kind: 'daemon.log.quarantined' }], next: 1, caughtUp: true, logId: LOG_B } as T;
      },
    };
    await followLog(c, store);
    expect(calls[0]).toEqual({ since: { logId: LOG_A, seq: 8 }, limit: 1000 });
    expect(calls[1]).toEqual({ limit: 1000 }); // from the start: no since
    expect(calls[2]).toEqual({ since: { logId: LOG_B, seq: 1 }, follow: true });
    expect(store.cards.size).toBe(0);
    expect(store.sessions.size).toBe(0);
    expect(store.head).toBe(1);
    expect(store.logId).toBe(LOG_B);
    expect(changes.some((w) => w.includes('reset'))).toBe(true);
  });

  it('a second cursor-epoch surfaces instead of looping; other refusals are not an epoch', async () => {
    const store = new GuiStore();
    store.adopt(LOG_A);
    store.apply([{ seq: 2, kind: 'x' }]);
    const c = { call: async <T,>(): Promise<T> => Promise.reject(epoch()) };
    await expect(followLog(c, store)).rejects.toSatisfy(isCursorEpoch);
    expect(isCursorEpoch(new RpcError({ code: 'BAD_REQUEST', reason: 'bad-since', message: '', next: [], data: null }))).toBe(false);
  });

  it('a page from another log than the store holds resets before applying', () => {
    const store = new GuiStore();
    store.adopt(LOG_A);
    store.apply([{ seq: 5, kind: 'x' }]);
    store.adopt(LOG_B);
    expect(store.head).toBe(0);
    expect(store.kernelFeed).toHaveLength(0);
    expect(store.cursor()).toBeUndefined();
  });
});

/* ── §2.4 rule 11 (T-2026-10-19-014 B2): an old kernel's cards are dropped on the new kernel's daemon.start ── */
describe('#gui store after an upgrade', () => {
  it('a new daemon.start drops every card raised before it, so a stale card id cannot be clicked', () => {
    const s = new GuiStore();
    const card = (seq: number, cardId: string): Row => ({ seq, kind: 'approval.request', payload: { card: { cardId, kind: 'daemon-stop' } } });
    s.apply([card(1, 'card:01JAAAAAAAAAAAAAAAAAAAAAAA')]);
    expect(s.stack().map((c) => c.cardId)).toEqual(['card:01JAAAAAAAAAAAAAAAAAAAAAAA']);
    const what = s.apply([{ seq: 2, kind: 'daemon.start', payload: { pid: 1 } }]);
    expect(what.has('card-out:card:01JAAAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(s.stack()).toEqual([]);
    s.apply([card(3, 'card:01JBBBBBBBBBBBBBBBBBBBBBBB')]); // a card of the new kernel stays
    expect(s.stack().map((c) => c.cardId)).toEqual(['card:01JBBBBBBBBBBBBBBBBBBBBBBB']);
  });
});

/* ── dogfood 2026-10-19 round 2: the chat transcript, stale sessions, stickiness, layout ── */
describe('#gui chat transcript: the conversation, not the raw rows', () => {
  const H = 'hsid:v1:01M5ATH1BQBCRNY5REDJ20RA7D';
  const ev = (seq: number, line: unknown, type: string): Row => ({ seq, kind: 'turn.event', view: 'full', session: H, payload: { hsid: H, type, seq, line: JSON.stringify(line) } });
  const turn = (): Row[] => [
    { seq: 1, kind: 'session.open', view: 'full', session: H, payload: { hsid: H, backend: 'claude-code', model: 'claude', cwd: '/r' } },
    ...Array.from({ length: 16 }, (_, i) => ev(2 + i, { type: 'system', subtype: i % 2 ? 'hook_response' : 'hook_started', hook: 'x' }, i % 2 ? 'system.hook_response' : 'system.hook_started')),
    ev(18, { type: 'system', subtype: 'init', session_id: 's' }, 'system.init'),
    { seq: 19, kind: 'session.inject', view: 'full', session: H, payload: { hsid: H, origin: 'client', hash: 'sha256:00', bytes: 5 } },
    { seq: 20, kind: 'turn.sent', view: 'full', session: H, payload: { hsid: H, turn: 't1', contentHash: 'sha256:00' } },
    ev(21, { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'fix the bug' }] }, isReplay: true }, 'user'),
    ev(22, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } }, 'stream_event.content_block_delta'),
    { seq: 23, kind: 'turn.partial', view: 'full', session: H, payload: { hsid: H, bytes: 90 } },
    ev(24, { type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Looking at it.' }] } }, 'assistant'),
    ev(25, { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm   test\n -- --run', description: 'run tests' } }] } }, 'assistant'),
    ev(26, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } }, 'user'),
    ev(27, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }, 'rate_limit_event'),
    ev(28, { type: 'system', subtype: 'status', status: 'x' }, 'system.status'),
    ev(29, { type: 'result', subtype: 'success', total_cost_usd: 0.01 }, 'result'),
    { seq: 30, kind: 'turn.result', view: 'full', session: H, payload: { hsid: H, usage: { tokens: 1234 }, cost: 0.0123, subtype: 'success', isError: false } },
  ];
  it('noise is hidden by default: hooks, partials, rate limits, status, tool results, bookkeeping rows', () => {
    const { items, hidden } = chatItems(turn());
    // fidelity 2: "session opened" is bookkeeping too (raw view only)
    expect(items.map((i) => i.role)).toEqual(['user', 'assistant', 'tool', 'result']);
    expect(hidden).toBe(turn().length - 4);
    expect(chatItems(turn(), { raw: true }).items[0]!.text).toMatch(/session\.open/);
    for (const i of items) expect(i.text).not.toMatch(/hook_|stream_event|rate_limit|thinking|hmm/);
  });
  it('the user message, the assistant text and the tool line appear in order; the result is cost and tokens', () => {
    const { items } = chatItems(turn());
    expect(items.map((i) => [i.role, i.text])).toEqual([
      ['user', 'fix the bug'],
      ['assistant', 'Looking at it.'],
      ['tool', 'Bash · npm test -- --run'],
      ['result', 'success · $0.0123 · 1,234 tokens'],
    ]);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
  it('a local-model (gnomon-local) turn shows its tool call and its reply; streamed deltas and tool results are noise', () => {
    const local: Row[] = [
      ev(40, { type: 'message_update', delta: 'The' }, 'message_update'),
      ev(41, { type: 'message_end', message: { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_file' }] }, finishReason: 'tool_calls' }, 'message_end'),
      ev(42, { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'read_file', args: { path: 'README.md' } }, 'tool_execution_start'),
      ev(43, { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'read_file', isError: false, result: '# trial' }, 'tool_execution_end'),
      ev(44, { type: 'message_end', message: { role: 'assistant', content: 'It is a trial repo.', toolCalls: [] }, finishReason: 'stop' }, 'message_end'),
      ev(45, { type: 'agent_end', stopReason: 'stop' }, 'agent_end'),
    ];
    expect(chatItems(local).items.map((i) => [i.role, i.text])).toEqual([
      ['tool', toolSummary('read_file', { path: 'README.md' })],
      ['assistant', 'It is a trial repo.'],
    ]);
  });
  it('"show raw events" shows every row; the composer echo hides the replay of the same text (shown once, list only grows)', () => {
    expect(chatItems(turn(), { raw: true }).items).toHaveLength(turn().length);
    const echo: Row = { seq: 18.5, kind: 'composer', connId: 'local', session: H, payload: 'fix the bug' };
    const rows = [...turn()].concat(echo).sort((a, b) => a.seq - b.seq);
    const users = chatItems(rows).items.filter((i) => i.role === 'user');
    expect(users.map((u) => [u.key, u.text])).toEqual([['18.5', 'fix the bug']]);
    // before the replay arrives the echo is the last item; after it, nothing before it moved
    const before = chatItems(rows.filter((r) => r.seq <= 20)).items.map((i) => i.key);
    const after = chatItems(rows).items.map((i) => i.key);
    expect(after.slice(0, before.length)).toEqual(before);
  });
  it('cards, refusals and lifecycle show inline; stubs and unparseable lines are hidden, never thrown on', () => {
    const { items } = chatItems([
      { seq: 1, kind: 'approval.request', view: 'full', session: H, payload: { card: { cardId: 'c', kind: 'permission' } } },
      { seq: 2, kind: 'approval.decide', view: 'full', session: H, payload: { cardId: 'c', decision: 'allow' } },
      { seq: 3, kind: 'session.refused', view: 'full', session: H, payload: { hsid: H, reason: 'x' } },
      { seq: 4, kind: 'turn.event', view: 'stub', session: H },
      { seq: 5, kind: 'turn.event', view: 'full', session: H, payload: { hsid: H, type: 'x', line: '{nope' } },
      { seq: 6, kind: 'session.exited', view: 'full', payload: { hsid: H, code: 0, signal: null } },
    ]);
    expect(items.map((i) => i.role)).toEqual(['card', 'card', 'error', 'system']);
    expect(items[3]!.text).toBe('session ended · exit 0');
  });
  it('a tool line names the tool and what it acts on, capped', () => {
    expect(toolSummary('Read', { file_path: '/a/b.ts' })).toBe('Read · /a/b.ts');
    expect(toolSummary('Mystery', { n: 1 })).toBe('Mystery');
    expect(toolSummary('Bash', { command: 'x'.repeat(500) }).length).toBeLessThanOrEqual('Bash · '.length + 140);
  });
});

describe('#gui stale sessions: a killed kernel\'s sessions are not live', () => {
  const open = (seq: number, h: string, extra: Record<string, unknown> = {}): Row => ({ seq, kind: 'session.open', session: h, payload: { hsid: h, backend: 'claude-code', ...extra } });
  it('after a new daemon.start, sessions with no exit and no resume are ended; a resume in the new boot is live; live matches', () => {
    const s = new GuiStore();
    s.apply([{ seq: 1, kind: 'daemon.start', payload: {} }, open(2, 'A'), open(3, 'B'), open(4, 'C'), { seq: 5, kind: 'turn.result', session: 'A', payload: { hsid: 'A' } }, { seq: 6, kind: 'session.exited', payload: { hsid: 'C', code: 0 } }]);
    expect(s.liveCount()).toBe(2);
    expect(s.sessions.get('A')!.state).toBe('idle');
    expect(s.sessions.get('C')!.state).toBe('ended');
    // Ctrl-C: no exit rows. The next boot's sweep logs B as orphaned (before daemon.start), then the start, then D opens
    s.apply([{ seq: 7, kind: 'session.orphaned', payload: { hsid: 'B', probe: 'stale-boot', action: 'none' } }, { seq: 8, kind: 'daemon.start', payload: {} }, open(9, 'D')]);
    expect(s.sessions.get('B')!.state).toBe('orphaned');
    expect(s.sessions.get('A')!.state).toBe('ended'); // no exit, not swept: gone with the old kernel
    expect(s.liveCount()).toBe(1);
    // a late row for a dead session does not bring it back; a resume (session.open in this boot) does
    s.apply([{ seq: 10, kind: 'turn.result', session: 'A', payload: { hsid: 'A' } }]);
    expect(s.sessions.get('A')!.state).toBe('ended');
    s.apply([open(11, 'A', { resume: { outcome: 'resumed' } })]);
    expect(s.sessions.get('A')!.state).toBe('open');
    expect(s.liveCount()).toBe(2);
  });
});

describe('#gui transcript stickiness (founder rule)', () => {
  it('isAtBottom allows a small slack only', () => {
    expect(isAtBottom(900, 100, 1000)).toBe(true);
    expect(isAtBottom(880, 100, 1000)).toBe(true);
    expect(isAtBottom(800, 100, 1000)).toBe(false);
    expect(isAtBottom(0, 600, 300)).toBe(true); // content shorter than the view
  });
  it('at the bottom it stays stuck through new rows and a send; scrolled up nothing moves it and the jump key counts', () => {
    const f = new Follow();
    expect(f.shouldStick).toBe(true);
    f.onAppend(3);
    expect([f.shouldStick, f.showJump, f.unseen]).toEqual([true, false, 0]);
    f.onScroll(false); // the user scrolled up to read
    f.onAppend(1); // the user's own send
    f.onAppend(2); // replies
    expect([f.shouldStick, f.showJump, f.unseen]).toEqual([false, true, 3]);
    f.onScroll(true); // back to the bottom by hand
    expect([f.shouldStick, f.showJump, f.unseen]).toEqual([true, false, 0]);
    f.onScroll(false);
    f.onAppend(5);
    f.jump(); // the "↓ latest" key
    expect([f.shouldStick, f.showJump, f.unseen]).toEqual([true, false, 0]);
  });
  it('FALSIFIER (founder dogfood: snap-back): a small step up near the bottom unsticks; wheel-up intent releases before the next paint', () => {
    const f = new Follow();
    f.onScroll(true, true); // a 10 px wheel tick up: still inside the slack, but moving up
    expect(f.shouldStick).toBe(false);
    f.onAppend(4); // streamed rows arrive: nothing snaps
    expect([f.shouldStick, f.unseen]).toEqual([false, 4]);
    f.onScroll(true, false); // back down to the bottom by hand
    expect([f.shouldStick, f.unseen]).toEqual([true, 0]);
    f.release(); // wheel up / PageUp / touch drag
    expect(f.shouldStick).toBe(false);
  });
  it('app.ts ignores its own scroll writes and releases on wheel-up, touch and keys', () => {
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    expect(app).toMatch(/const own = Math\.abs\(top - selfTop\) < 1/);
    expect(app).toMatch(/addEventListener\('wheel'/);
    expect(app).toMatch(/'PageUp'/);
  });
  it('app.ts scrolls only when stuck, never on send, and never rebuilds the feed with markup', () => {
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    const sendFn = app.slice(app.indexOf('async function send('), app.indexOf('async function openSession('));
    expect(sendFn).not.toMatch(/scrollTop|follow\.jump|paintTranscript\(/);
    expect(app).toMatch(/if \(follow\.shouldStick\) setScroll\(vp, vp\.scrollHeight\)/);
    expect(app).not.toMatch(/replaceChildren|innerHTML/);
  });
});

describe('#gui layout: the app fills the viewport (CSS sanity; the darwin Chrome smoke measures it)', () => {
  const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel: string): string => {
    const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
    return m ? m[1]! : '';
  };
  it('the shell is a full-height column and the desk grows; panes and the feed scroll inside, not the page', () => {
    expect(rule('.shell')).toMatch(/height:\s*100dvh/);
    expect(rule('.shell')).toMatch(/flex-direction:\s*column/);
    expect(rule('.shell > .desk')).toMatch(/flex:\s*1 1 auto/);
    expect(rule('html, body')).toMatch(/height:\s*100%/);
    expect(rule('.shell')).toMatch(/overflow:\s*hidden/);
    expect(rule('.desk')).toMatch(/min-height:\s*0/);
    expect(rule('.viewport')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.pile')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.sessions > .list')).toMatch(/min-height:\s*0/);
  });
  it('under 900px the side panes become drawers behind header toggles (one column, no horizontal overflow)', () => {
    expect(css).toMatch(/@media \(max-width: 900px\)/);
    const narrow = css.slice(css.indexOf('@media (max-width: 900px)'));
    expect(narrow).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
    expect(narrow).toMatch(/\.desk\.open-sessions > \.sessions/);
    const html = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
    for (const id of ['toggle-sessions', 'toggle-stack', 'jump-latest', 'raw-toggle', 'scrim']) expect(html).toContain(`id="${id}"`);
    expect(html).not.toMatch(/style=/); // CSP style-src 'self': no inline style attributes
  });
});
