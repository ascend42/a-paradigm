/**
 * #gui-offer-slip (TD-2026-10-20-812 O1): the margin slip model (core/offers.ts), its DOM (ui/offer-slip.ts) and
 * the app wiring (checked by source). Slips come ONLY from kernel offer.shown rows; live on the latest reply only;
 * two-step open (A5); not now quiets the mod (L4); voice dismisses only (L1); never key-styled.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decideRequest, foldOffers, OFFER_ARM_GAP_MS, OFFER_ARM_TTL_MS, openStep, pttDismissable, slipViews, takesLine, voiceOfferIntent, type OfferRow } from '../src/core/offers.js';
import { renderOfferSlip } from '../src/ui/offer-slip.js';
import type { MiniDoc, MiniEl } from '../src/core/render.js';
import { chatItems, GuiStore, type Row } from '../src/core/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
const SLIP_UI = readFileSync(path.join(ROOT, 'src', 'ui', 'offer-slip.ts'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');

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

const HSID = 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0';
const KERNEL = 'p:7k2m9q4x/kernel';
const VOICE = 'p:7k2m9q4x/voice';
const id = (n: number): string => `offer:01JPREV${String(n).padStart(19, '0')}`;
const line = (role: 'user' | 'assistant', text: string): string => JSON.stringify({ type: role, message: { role, content: [{ type: 'text', text }] } });
const reply = (seq: number, text = 'Here is what I found. Want a map?'): Row => ({ seq, kind: 'turn.event', session: HSID, view: 'full', payload: { type: 'assistant', line: line('assistant', text) } });
const human = (seq: number, text = 'thanks'): Row => ({ seq, kind: 'turn.event', session: HSID, view: 'full', payload: { type: 'user', line: line('user', text) } });
const shown = (seq: number, n: number, mod = 'gnomon.constellation', extra: Record<string, unknown> = {}): Row => ({ seq, kind: 'offer.shown', session: HSID, principal: KERNEL, payload: { offerId: id(n), hsid: HSID, mod, kind: 'map-the-idea', phase: 'synthesize', title: 'Map it', question: 'Map this on the board?', replyTurnId: `turn:${HSID}/1`, ...extra } });
const decided = (seq: number, n: number, decision: string): Row => ({ seq, kind: 'offer.decided', session: HSID, principal: KERNEL, payload: { offerId: id(n), hsid: HSID, decision } });
const heard = (seq: number, text: string, extra: Record<string, unknown> = {}): Row => ({ seq, kind: 'voice.turn.user', session: HSID, principal: VOICE, payload: { hsid: HSID, text, partial: false, mode: 'ptt', forwardable: true, ...extra } });

const views = (rows: Row[]) => slipViews(foldOffers(rows as OfferRow[], HSID), chatItems(rows).items);

describe('#gui-offer-slip model: folded only from kernel offer.shown rows', () => {
  it('a kernel offer.shown makes one live slip under the reply that offered', () => {
    const v = views([reply(1), shown(2, 1)]);
    expect(v).toHaveLength(1);
    expect(v[0]!.itemKey).toBe('1');
    expect(v[0]!.live).toBe(true);
    expect(v[0]!.slip.question).toBe('Map this on the board?');
  });
  it('never from reply text: an ```offer block in a reply makes no slip', () => {
    const text = 'Done.\n\n```offer\n{"mod":"gnomon.constellation","kind":"map-the-idea","question":"Map it?"}\n```';
    expect(views([reply(1, text)])).toEqual([]);
  });
  it('refuses rows not from the kernel, for another hsid, with a bad id, a bad turn id or unsafe question text', () => {
    expect(views([reply(1), { ...shown(2, 1), principal: 'p:7k2m9q4x/claude' }])).toEqual([]);
    expect(views([reply(1), shown(2, 1, 'gnomon.constellation', { hsid: 'hsid:v1:01JZZZZZZZZZZZZZZZZZZZZZZZ' })])).toEqual([]);
    expect(views([reply(1), shown(2, 1, 'gnomon.constellation', { offerId: 'offer:nope' })])).toEqual([]);
    expect(views([reply(1), shown(2, 1, 'gnomon.constellation', { replyTurnId: 'turn:hsid:v1:01JZZZZZZZZZZZZZZZZZZZZZZZ/1' })])).toEqual([]);
    expect(views([reply(1), shown(2, 1, 'gnomon.constellation', { question: 'Open?‮evil' })])).toEqual([]);
    expect(views([reply(1), shown(2, 1, 'gnomon.constellation', { question: 'x'.repeat(241) })])).toEqual([]);
    expect(views([reply(1), shown(2, 1, 'Bad Mod')])).toEqual([]);
  });
  it('inert once the human sends anything after the reply, or a newer reply lands', () => {
    expect(views([reply(1), shown(2, 1), human(3)])[0]!.live).toBe(false);
    expect(views([reply(1), shown(2, 1), reply(3, 'Something else.')])[0]!.live).toBe(false);
  });
  it('only the newest open slip is live', () => {
    const v = views([reply(1), shown(2, 1), reply(3), shown(4, 2, 'gnomon.docs')]);
    expect(v.map((x) => x.live)).toEqual([false, true]);
  });
  it('folding offer.decided closes the slip; not-now quiets that mod for the rest of the conversation (L4)', () => {
    const rows = [reply(1), shown(2, 1, 'gnomon.neurons'), decided(3, 1, 'not-now'), reply(4), shown(5, 2, 'gnomon.neurons'), reply(6), shown(7, 3, 'gnomon.docs')];
    const book = foldOffers(rows as OfferRow[], HSID);
    expect(book.slips[0]!.decided).toBe('not-now');
    expect(book.muted.has('gnomon.neurons')).toBe(true);
    expect(book.slips[1]!.quiet).toBe(true);
    expect(book.slips[2]!.quiet).toBe(false);
    const v = slipViews(book, chatItems(rows).items);
    expect(v.map((x) => x.slip.mod)).toEqual(['gnomon.neurons', 'gnomon.docs']);
    expect(v[0]!.live).toBe(false);
    expect(v[1]!.live).toBe(true);
  });
  it('stop-here quiets every later slip; a decided row from a non-kernel principal is ignored', () => {
    const book = foldOffers([reply(1), shown(2, 1), decided(3, 1, 'stop-here'), shown(4, 2, 'gnomon.docs')] as OfferRow[], HSID);
    expect(book.stopped).toBe(true);
    expect(book.slips[1]!.quiet).toBe(true);
    const forged = foldOffers([reply(1), shown(2, 1), { ...decided(3, 1, 'open'), principal: 'p:7k2m9q4x/claude' }] as OfferRow[], HSID);
    expect(forged.slips[0]!.decided).toBeNull();
  });
  it('re-review M-2: a kernel offer.retired closes the slip (never live) and leaves a "retired" trace', () => {
    const retired = (seq: number, n: number, extra: Record<string, unknown> = {}): Row => ({ seq, kind: 'offer.retired', session: HSID, principal: KERNEL, payload: { offerId: id(n), hsid: HSID, why: 'continued', ...extra } });
    const v = views([reply(1), shown(2, 1), retired(3, 1)]);
    expect(v).toHaveLength(1);
    expect(v[0]!.slip.retired).toBe(true);
    expect(v[0]!.live).toBe(false);
    const el = renderOfferSlip(fdoc, v[0]!, { armed: false, voiceHint: false, ambientHint: false, arrive: false }) as FEl;
    expect(el.className).toBe('slip gone');
    expect(el.text).toBe('⁂ retired · the reply continued · mod:constellation');
    // a non-kernel row, another hsid or an unknown reason does not retire; a decided slip stays decided
    expect(views([reply(1), shown(2, 1), { ...retired(3, 1), principal: 'p:7k2m9q4x/claude' }])[0]!.live).toBe(true);
    expect(views([reply(1), shown(2, 1), retired(3, 1, { hsid: 'hsid:v1:01JZZZZZZZZZZZZZZZZZZZZZZZ' })])[0]!.live).toBe(true);
    expect(views([reply(1), shown(2, 1), retired(3, 1, { why: 'other' })])[0]!.live).toBe(true);
    const book = foldOffers([reply(1), shown(2, 1), decided(3, 1, 'not-now'), retired(4, 1)] as OfferRow[], HSID);
    expect(book.slips[0]!.retired).toBe(false);
    // a heard "not now" never targets a retired slip
    expect(foldOffers([reply(1), shown(2, 1), retired(3, 1), heard(4, 'not now')] as OfferRow[], HSID).slips[0]!.voiceDismiss).toBeNull();
  });
  it('the store folds offer rows and names the conversation that changed', () => {
    const store = new GuiStore();
    const wire = (r: Row) => ({ seq: r.seq, view: 'full', event: { schemaVersion: 'event:v1', seq: r.seq, kind: r.kind, session: r.session, principal: r.principal ?? 'p:7k2m9q4x/claude', payload: r.payload } });
    const what = store.apply([wire(reply(1)), wire(shown(2, 1))]);
    expect(what.has(`offers:${HSID}`)).toBe(true);
    expect(store.offers(HSID).slips).toHaveLength(1);
    expect(chatItems(store.transcript(HSID)).items.map((i) => i.role)).toEqual(['assistant']); // the offer row is no chat item
  });
});

describe('#gui-offer-slip the reply hides its ```offer block only under a kernel offer.shown row', () => {
  const block = '```offer\n{"mod":"gnomon.constellation","kind":"map-the-idea","question":"Map this on the board?"}\n```';
  const text = `Here is what I found.\n\n${block}`;
  const replyText = (rows: Row[]) => chatItems(rows).items.find((i) => i.role === 'assistant')!.text;
  it('a kernel offer.shown for the reply strips the block (contracts offerBlockOf body)', () => {
    expect(replyText([reply(1, text), shown(2, 1)])).toBe('Here is what I found.');
  });
  it('no offer.shown row: the reply shows as-is, block and all', () => {
    expect(replyText([reply(1, text)])).toBe(text);
  });
  it('a non-kernel, other-hsid or mismatched offer.shown never strips', () => {
    expect(replyText([reply(1, text), { ...shown(2, 1), principal: 'p:7k2m9q4x/claude' }])).toBe(text);
    expect(replyText([reply(1, text), shown(2, 1, 'gnomon.constellation', { hsid: 'hsid:v1:01JZZZZZZZZZZZZZZZZZZZZZZZ' })])).toBe(text);
    expect(replyText([reply(1, text), shown(2, 1, 'gnomon.neurons')])).toBe(text);
  });
  it('only the reply the slip anchors to: an earlier reply keeps its block', () => {
    const items = chatItems([reply(1, text), reply(2, 'Later.'), shown(3, 1)]).items.filter((i) => i.role === 'assistant');
    expect(items.map((i) => i.text)).toEqual([text, 'Later.']);
  });
});

describe('#gui-offer-slip two-step open (A5) and the requests', () => {
  it('untrusted or not live ⇒ refused; first trusted press arms; the second sends after the gap', () => {
    const T = { isTrusted: true };
    const arm = { offerId: id(1), at: 1000 };
    expect(openStep({ isTrusted: false }, id(1), id(1), null, 1000)).toBe('refused');
    expect(openStep(T, id(1), null, null, 1000)).toBe('refused');
    expect(openStep(T, id(1), id(2), null, 1000)).toBe('refused');
    expect(openStep(T, id(1), id(1), null, 1000)).toBe('armed');
    expect(openStep(T, id(1), id(1), arm, 1000 + OFFER_ARM_GAP_MS)).toBe('send');
  });
  it('Aegis M1: a key repeat or a double-click is no gesture; a send inside the gap waits; an old arm lapses', () => {
    const arm = { offerId: id(1), at: 1000 };
    expect(openStep({ isTrusted: true, repeat: true }, id(1), id(1), arm, 5000)).toBe('refused');
    expect(openStep({ isTrusted: true, detail: 2 }, id(1), id(1), arm, 5000)).toBe('refused');
    expect(openStep({ isTrusted: true, detail: 1 }, id(1), id(1), arm, 5000)).toBe('send');
    expect(openStep({ isTrusted: true }, id(1), id(1), arm, 1000 + OFFER_ARM_GAP_MS - 1)).toBe('wait');
    expect(openStep({ isTrusted: true }, id(1), id(1), arm, 1000 + OFFER_ARM_TTL_MS + 1)).toBe('armed');
    expect(openStep({ isTrusted: true }, id(1), id(1), { offerId: id(2), at: 1000 }, 2000)).toBe('armed');
    expect(SLIP_UI).toMatch(/\.repeat === true/);
    expect(SLIP_UI).toMatch(/detail > 1/);
  });
  it('decideRequest builds log.append request.offer.decide', () => {
    expect(decideRequest(id(1), 'open')).toEqual({ kind: 'request.offer.decide', payload: { offerId: id(1), decision: 'open' } });
    expect(decideRequest(id(1), 'not-now')).toEqual({ kind: 'request.offer.decide', payload: { offerId: id(1), decision: 'not-now' } });
  });
  it('Aegis M3: the takes line is the row\'s kernel-copied contextIn; unknown tokens, +N more, missing ⇒ unknown', () => {
    expect(takesLine(['recent-messages', 'open-files'])).toBe('takes: recent messages · open files · ↵ to open');
    expect(takesLine(['recent-messages', 'made-up'])).toBe('takes: recent messages · unknown · ↵ to open');
    expect(takesLine(Array.from({ length: 10 }, () => 'recent-messages'))).toMatch(/ · \+2 more · ↵ to open$/);
    expect(takesLine(null)).toBe('takes: unknown (not reported by the kernel) · ↵ to open');
    const book = foldOffers([reply(1), shown(2, 1, 'gnomon.constellation', { contextIn: ['open-files', 'BAD TOKEN'] }), shown(3, 2, 'gnomon.docs')] as OfferRow[], HSID);
    expect(book.slips[0]!.contextIn).toEqual(['open-files', '?']);
    expect(book.slips[1]!.contextIn).toBeNull();
    expect(APP).not.toMatch(/offerSpecsOf|mods\.offers/);
  });
  it('voice dismisses only (L1): "not now" marks a dismissal, "open" only a hint', () => {
    expect(voiceOfferIntent('Not now.')).toBe('dismiss');
    expect(voiceOfferIntent('open it')).toBe('open-hint');
    expect(voiceOfferIntent('open the pull request and merge')).toBeNull();
    const book = foldOffers([reply(1), shown(2, 1), heard(3, 'open'), heard(4, 'not now')] as OfferRow[], HSID);
    expect(book.slips[0]!.openHint).toBe(true);
    expect(book.slips[0]!.voiceDismiss).toBe(4);
    expect(book.slips[0]!.decided).toBeNull(); // voice never decides by itself: the page sends one not-now request
    const fake = foldOffers([reply(1), shown(2, 1), { ...heard(3, 'not now'), principal: 'p:7k2m9q4x/claude' }] as OfferRow[], HSID);
    expect(fake.slips[0]!.voiceDismiss).toBeNull();
  });
  it('Aegis M2: only a forwardable, non-intercepted push-to-talk row dismisses; ambient only hints', () => {
    expect(pttDismissable({ mode: 'ptt', forwardable: true })).toBe(true);
    expect(pttDismissable({ mode: 'ambient', forwardable: true })).toBe(false);
    expect(pttDismissable({ forwardable: true })).toBe(false);
    expect(pttDismissable({ mode: 'ptt', forwardable: false })).toBe(false);
    expect(pttDismissable({ mode: 'ptt', forwardable: true, intercepted: 'control' })).toBe(false);
    const amb = foldOffers([reply(1), shown(2, 1), heard(3, 'not now', { mode: 'ambient' })] as OfferRow[], HSID);
    expect(amb.slips[0]!.voiceDismiss).toBeNull();
    expect(amb.slips[0]!.ambientHint).toBe(true);
    const icp = foldOffers([reply(1), shown(2, 1), heard(3, 'not now', { intercepted: 'control' })] as OfferRow[], HSID);
    expect(icp.slips[0]!.voiceDismiss).toBeNull();
  });
  it('Aegis M2: a voice row acts only on the slip live when it arrived; the page ignores backlog rows', () => {
    const afterHuman = foldOffers([reply(1), shown(2, 1), human(3), heard(4, 'not now')] as OfferRow[], HSID);
    expect(afterHuman.slips[0]!.voiceDismiss).toBeNull();
    const afterReply = foldOffers([reply(1), shown(2, 1), reply(3, 'more'), heard(4, 'not now')] as OfferRow[], HSID);
    expect(afterReply.slips[0]!.voiceDismiss).toBeNull();
    const afterDecided = foldOffers([reply(1), shown(2, 1), decided(3, 1, 'open'), heard(4, 'not now')] as OfferRow[], HSID);
    expect(afterDecided.slips[0]!.voiceDismiss).toBeNull();
    const older = foldOffers([reply(1), shown(2, 1), reply(3), shown(4, 2, 'gnomon.docs'), heard(5, 'not now')] as OfferRow[], HSID);
    expect(older.slips.map((x) => x.voiceDismiss)).toEqual([null, 5]);
    expect(APP).toMatch(/if \(r\.kind !== 'voice\.turn\.user' \|\| !\(r\.seq > offerLiveSince\)\) return;/);
  });
});

describe('#gui-offer-slip DOM: a dashed slip, never a key', () => {
  const v = views([reply(1), shown(2, 1, 'gnomon.constellation', { question: 'Map <b>this</b>?' })])[0]!;
  it('tab is glyph + offer · mod:<name>; the question is a text node; no .key, no data-decision', () => {
    const el = renderOfferSlip(fdoc, v, { armed: false, voiceHint: false, ambientHint: false, arrive: false }) as FEl;
    const all = el.all();
    expect(el.className).toContain('slip');
    expect(el.className).toContain('live');
    expect(all.some((e) => /\bkey\b/.test(e.className))).toBe(false);
    expect(all.some((e) => e.attrs.has('data-decision'))).toBe(false);
    expect(all.find((e) => e.className === 'slip-tab')!.text).toBe('⁂ offer · mod:constellation');
    const q = all.find((e) => e.className === 'slip-q')!;
    expect(q.children).toHaveLength(1);
    expect(q.children[0]).toBeInstanceOf(FText);
    expect(q.text).toBe('Map <b>this</b>?');
    expect(all.filter((e) => e.tag === 'button').map((b) => b.attrs.get('data-offer-act'))).toEqual(['open', 'not-now']);
    expect(all.some((e) => e.className === 'slip-ctx')).toBe(false); // the takes line shows once armed
  });
  it('armed shows "takes: … · ↵ to open"; a heard open shows the hint; inert buttons are disabled; decided is a trace', () => {
    const armed = renderOfferSlip(fdoc, { ...v, slip: { ...v.slip, contextIn: ['recent-messages'] } }, { armed: true, voiceHint: true, ambientHint: true, arrive: true }) as FEl;
    expect(armed.className).toContain('armed');
    expect(armed.className).toContain('arrive');
    expect(armed.all().find((e) => e.className === 'slip-ctx')!.text).toBe('takes: recent messages · ↵ to open');
    expect(armed.all().filter((e) => e.className === 'slip-hint').map((e) => e.text)).toEqual(['click or ↵ to open', 'click not now to dismiss']);
    const inert = renderOfferSlip(fdoc, { ...v, live: false }, { armed: false, voiceHint: false, ambientHint: false, arrive: false }) as FEl;
    expect(inert.all().filter((e) => e.tag === 'button').every((b) => b.attrs.has('disabled'))).toBe(true);
    const gone = renderOfferSlip(fdoc, { ...v, slip: { ...v.slip, decided: 'not-now' } }, { armed: false, voiceHint: false, ambientHint: false, arrive: false }) as FEl;
    expect(gone.className).toBe('slip gone');
    expect(gone.text).toBe('⁂ not now · mod:constellation');
  });
  it('the UI accepts trusted events only and never uses innerHTML; the app mounts it under the reply', () => {
    expect(SLIP_UI).toMatch(/if \(!e\.isTrusted\) return;/);
    expect(SLIP_UI).not.toMatch(/\.innerHTML|insertAdjacentHTML/);
    expect(APP).toMatch(/wireOfferSlips\(\$\('viewport'\), onOfferAct\)/);
    expect(APP).toMatch(/slipViews\(store\.offers\(focused\), cur\)/);
    expect(APP).toMatch(/decideRequest\(offerId, decision\)/);
  });
  it('CSS: dashed, soft shadow, -0.7deg by day and flat at night, 320ms slide-in, no hard offset', () => {
    const slip = /\n\.slip \{([^}]*)\}/.exec(CSS)![1]!;
    expect(slip).toMatch(/border: 1px dashed/);
    expect(slip).toMatch(/box-shadow: var\(--slip-shadow\)/);
    expect(slip).toMatch(/rotate\(calc\(-0\.7deg \* var\(--slip-tilt\)\)\)/);
    expect(CSS).toMatch(/--slip-tilt: 1;/);
    expect(CSS).toMatch(/--slip-tilt: 0;/);
    expect(CSS).toMatch(/--slip-shadow: none;/);
    expect(CSS).toMatch(/\.slip\.arrive \{ animation: slip-in 320ms/);
    expect(CSS).not.toMatch(/\.slip[^{]*\{[^}]*var\(--key-shadow\)/);
    expect(CSS).not.toMatch(/\.slip[^{]*\{[^}]*var\(--key-edge\)/); // Aegis L4
  });
});

describe('#gui-offer-slip Aegis L1: the preview arm is not in the served bundle', () => {
  it('build.mjs defines __GNOMON_PREVIEW__ false (preview true) and app.js carries no devArmOffer', async () => {
    expect(readFileSync(path.join(ROOT, 'scripts', 'build.mjs'), 'utf8')).toMatch(/define: \{ __GNOMON_PREVIEW__: 'false' \}/);
    expect(readFileSync(path.join(ROOT, 'scripts', 'preview.mjs'), 'utf8')).toMatch(/define: \{ __GNOMON_PREVIEW__: 'true' \}/);
    const { GUI_BUNDLE_FILES_B64 } = await import('../../gnomon/src/kernel/web/gui-bundle.js'); // check:bundle proves it is the fresh build
    const app = Buffer.from(GUI_BUNDLE_FILES_B64['app.js']!, 'base64').toString('utf8');
    expect(app).toContain('request.offer.decide');
    expect(app).not.toContain('devArmOffer');
  });
});

describe('Aegis S0b L1: the publisher display on offer chips', () => {
  const third = views([reply(1), shown(2, 1, 'acme.board')])[0]!;
  const tab = (st: Partial<{ publisher: { host: string | null; verified: boolean } | null }>) =>
    (renderOfferSlip(fdoc, third, { armed: false, voiceHint: false, ambientHint: false, arrive: false, ...st }) as FEl).all().find((e) => e.className === 'slip-tab')!.text;
  it('folder/package installs say unverified; a non-GitHub host shows "pub @ host"; a github owner shows the publisher', () => {
    expect(tab({ publisher: { host: null, verified: false } })).toMatch(/offer · mod:board \(acme, unverified\)$/);
    expect(tab({ publisher: { host: 'gitlab.com', verified: true } })).toMatch(/offer · mod:board \(acme @ gitlab\.com\)$/);
    expect(tab({ publisher: { host: null, verified: true } })).toMatch(/offer · mod:board \(acme\)$/);
    expect(tab({})).toMatch(/offer · mod:board \(acme\)$/);
  });
});
