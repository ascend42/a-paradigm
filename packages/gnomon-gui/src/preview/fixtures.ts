/**
 * @symbol #gui-preview
 *
 * DEV ONLY (#gui-preview, scripts/preview.mjs): synthetic kernel state for the
 * fixture preview. NOT part of the kernel-served bundle (src/main.ts never
 * imports src/preview; test/preview.test.ts proves it).
 *
 * Each fixture is a chain of `log.read` rows shaped like the kernel's
 * (`LogRow` {seq, view:'full', event} with the kinds, labels and payloads of
 * @a-company/gnomon-contracts) plus the `status` result the page reads. Cards
 * are built like the broker builds them (card:v1, a display-block Box of Text
 * lines, contentHash over {kind, requestedBy, hsid, detail, flags}); their
 * `actions` carry the decision only, and the fake kernel signs them with its
 * per-page key (fake-kernel.ts), so the real GUI verifies them as it would a
 * kernel's. Sample text follows the approved comp
 * (.atelier/sessions/2026-10-15-gnomon-aesthetic/refs/direction.html).
 */
import { crockford, defaultLabelsFor, projectHue, sha256, sha256Tagged, type LogRow } from '@a-company/gnomon-contracts';
import { cardContentHash } from '../core/render.js';
import { PARADIGM_CONTEXT_STATUS } from './paradigm-context.js';

export const PREVIEW_NS = '7k2m9q4x';
export const KERNEL_PRINCIPAL = `p:${PREVIEW_NS}/kernel`;
export const HUMAN_PRINCIPAL = `p:${PREVIEW_NS}/matt`;
const SESSION_PRINCIPAL = `p:${PREVIEW_NS}/claude`;

/** A deterministic ULID from a seed (same fixture ⇒ same ids ⇒ stable screenshots). */
const ulid = (seed: string): string => `01J${crockford(sha256(seed)).toUpperCase().slice(0, 23)}`;
export const hsidOf = (name: string): string => `hsid:v1:${ulid(`hsid ${name}`)}`;
export const cardIdOf = (name: string): string => `card:${ulid(`card ${name}`)}`;
export const PREVIEW_LOG_ID = `log:${ulid('preview log')}`;

export interface Fixture {
  name: string;
  title: string;
  rows: LogRow[];
  status: Record<string, unknown>;
  /** the session the page focuses after load (null: the kernel feed) */
  focus: string | null;
  /** mount the Workshop mod's strip (packages/gnomon-mods/workshop) at the foot of the sessions pane */
  workshop: boolean;
  /** #paradigm-context-mod: the K1 slice per live hsid (the fake kernel joins the GUI's {focus:{hsid}} to it, as the host does) */
  paradigm?: Record<string, unknown>;
  /** #gui-settings: the theme CHOICE stored before load (absent: none stored, so auto follows ?theme=) */
  choice?: 'day' | 'night' | 'auto';
  /** #gui-settings: open the Settings sheet once painted; #gui-model-picker: open the model-switch confirm sheet */
  open?: 'settings' | 'model-switch' | 'offer-armed';
}

/* ── the chain builder ───────────────────────────────────────────── */

type Draft = { at: string; kind: string; payload: unknown; session?: string; repo?: string; principal: string };

class Chain {
  readonly #drafts: Draft[] = [];

  add(at: string, kind: string, payload: unknown, o: { session?: string; repo?: string; principal?: string } = {}): void {
    this.#drafts.push({ at, kind, payload, principal: o.principal ?? KERNEL_PRINCIPAL, ...(o.session ? { session: o.session } : {}), ...(o.repo ? { repo: o.repo } : {}) });
  }

  /** Rows in time order (stable), seq from 1, every kind registered in the contracts table. */
  rows(): LogRow[] {
    const sorted = this.#drafts.map((d, i) => ({ d, i })).sort((a, b) => (a.d.at < b.d.at ? -1 : a.d.at > b.d.at ? 1 : a.i - b.i));
    let prev = sha256Tagged(`${PREVIEW_LOG_ID} genesis`);
    return sorted.map(({ d }, i) => {
      const labels = defaultLabelsFor(d.kind);
      if (!labels) throw new Error(`fixture row kind ${d.kind} is not in the contracts registry`);
      const seq = i + 1;
      const hash = sha256Tagged(`${PREVIEW_LOG_ID}\n${seq}\n${d.kind}\n${d.at}`);
      const event = {
        schemaVersion: 'event:v1' as const,
        id: `ev:${ulid(`ev ${seq}`)}`,
        log: PREVIEW_LOG_ID,
        seq,
        at: d.at,
        principal: d.principal,
        ...(d.session ? { session: d.session } : {}),
        ...(d.repo ? { scope: { org: null, team: null, repo: d.repo } } : {}),
        audience: labels.audience,
        sensitivity: labels.sensitivity,
        kind: d.kind,
        payload: d.payload,
        prev,
        hash,
      };
      prev = hash;
      return { seq, view: 'full' as const, event };
    });
  }
}

const T = (hhmm: string, day = '2026-10-20'): string => `${day}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}.000Z`;

/** A claude stream-json line, as turn.event carries it. */
const userLine = (text: string): string => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
const textLine = (text: string): string => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolLine = (...tools: Array<[name: string, input: Record<string, unknown>]>): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: tools.map(([name, input], i) => ({ type: 'tool_use', id: `toolu_${i}`, name, input })) } });

/* ── cards (built the way the broker builds them) ────────────────── */

interface CardSpec {
  name: string;
  kind: string;
  hsid: string | null;
  requestedBy?: string;
  lines: string[];
  /** block children after the Text lines (a Diff, …) */
  extra?: Record<string, unknown>[];
  detail: Record<string, unknown>;
  decisions: string[];
  flags?: string[];
  voice?: { eligible: 'none' | 'reversible' | 'gate' | 'judgment'; reason?: 'hand-only'; label: string; readback: string; echo: string };
  strictness?: { level: 'L0' | 'L1' | 'L2' | 'L3'; mode: 'manual' | 'ask' | 'auto-edits'; reason: string };
}

export function cardOf(s: CardSpec): Record<string, unknown> {
  const flags = [...(s.flags ?? [])].sort();
  const requestedBy = s.requestedBy ?? (s.hsid ? SESSION_PRINCIPAL : KERNEL_PRINCIPAL);
  const contentHash = cardContentHash({ kind: s.kind, requestedBy, hsid: s.hsid, flags }, s.detail);
  return {
    schemaVersion: 'card:v1',
    cardId: cardIdOf(s.name),
    kind: s.kind,
    requestedBy,
    ...(s.hsid ? { hsid: s.hsid } : {}),
    attended: true,
    approverPolicy: { kind: 'self' },
    block: { schemaVersion: 'display-block:v1', type: 'Box', children: [...s.lines.map((text) => ({ type: 'Text', text })), ...(s.extra ?? [])] },
    contentHash,
    ...(flags.length ? { flags } : {}),
    // the decision only: fake-kernel.ts signs each one with the preview kernel key (keyId + sig)
    actions: s.decisions.map((decision) => ({ decision })),
    state: 'pending',
    ...(s.voice ? { voice: { ...s.voice, readbackHash: sha256Tagged(s.voice.readback) } } : {}),
    ...(s.strictness ? { strictness: s.strictness } : {}),
  };
}

/* ── the desk: 5 active sessions, 12 past, the focused billing chat, 4 cards ── */

interface Active {
  key: string;
  repo: string;
  hsid: string;
  cwd: string;
}
const ACTIVE: Active[] = [
  ['billing', 'billing'],
  ['warpline', 'warpline'],
  ['ledgerette', 'ledgerette'],
  ['gnomon-web', 'gnomon-web'],
  ['atelier', 'atelier'],
].map(([key, repo]) => ({ key: key!, repo: repo!, hsid: hsidOf(`active ${key}`), cwd: `/Users/matt/code/${repo}` }));
const A = (key: string): Active => ACTIVE.find((a) => a.key === key)!;
export const BILLING = A('billing').hsid;

const PAST: Array<[label: string, repo: string, day: string]> = [
  ['neurons tend', 'neurons', '2026-10-18'],
  ['warpline seal v3', 'warpline', '2026-10-17'],
  ['constellation map', 'constellation', '2026-10-15'],
  ['paradigm 7.15', 'paradigm', '2026-10-13'],
  ['billing invoices', 'billing', '2026-10-13'],
  ['ledgerette import', 'ledgerette', '2026-10-12'],
  ['gnomon-web landing', 'gnomon-web', '2026-10-11'],
  ['atelier palette', 'atelier', '2026-10-10'],
  ['warpline guard', 'warpline', '2026-10-09'],
  ['neurons ingest', 'neurons', '2026-10-08'],
  ['paradigm docs', 'paradigm', '2026-10-07'],
  ['gnomon-web auth', 'gnomon-web', '2026-10-06'],
];

export const DESK_CARDS: Record<string, unknown>[] = [
  cardOf({
    name: 'knot seal',
    kind: 'knot',
    hsid: A('warpline').hsid,
    lines: ['KNOT · two strands rewrite seal.ts', 'warpline-fsck · strand a3f1c2 and strand 9c0e77 both change sealHeader()', 'raised 14:00 · hand-only: resolve it in the split view, not by voice'],
    detail: { strands: ['a3f1c2', '9c0e77'], path: 'src/seal.ts' },
    decisions: ['resolve', 'deny'],
    voice: { eligible: 'none', reason: 'hand-only', label: 'KNOT', readback: '', echo: '' },
  }),
  cardOf({
    name: 'ledgerette failed',
    kind: 'incident',
    hsid: A('ledgerette').hsid,
    requestedBy: KERNEL_PRINCIPAL,
    lines: ['Failed · tsc exited 2 in packages/ledger', 'started 14:02 · ran 2m 14s · failed 14:04', "src/ledger/post.ts(41,7): error TS2322: Type 'string' is not assignable to type 'Cents'."],
    detail: { cause: 'session-exited', code: 2, cwd: '/Users/matt/code/ledgerette' },
    decisions: ['accept', 'reject'],
  }),
  cardOf({
    name: 'billing bash',
    kind: 'permission',
    hsid: BILLING,
    lines: ['The session asks to run Bash', 'repo: billing', 'command: pnpm test --filter billing', 'description: Run the billing tests to confirm the rounding fix'],
    detail: { tool: 'Bash', input: { command: 'pnpm test --filter billing', description: 'Run the billing tests to confirm the rounding fix' } },
    decisions: ['allow', 'deny', 'always'],
    voice: { eligible: 'reversible', label: 'card 3', readback: 'allow Bash pnpm test --filter billing', echo: 'allowing card 3' },
  }),
  cardOf({
    name: 'gnomon-web settings',
    kind: 'gate-class',
    hsid: A('gnomon-web').hsid,
    requestedBy: KERNEL_PRINCIPAL,
    lines: ['.claude/settings.json changed mid-session', 'repo: gnomon-web · raised 14:07 · the session is paused until you decide', 'the change adds one permission rule:'],
    extra: [{ type: 'Diff', text: '--- a/.claude/settings.json\n+++ b/.claude/settings.json\n@@ -3,3 +3,4 @@\n   "permissions": {\n-    "allow": []\n+    "allow": ["Bash(pnpm *)"]\n   }' }],
    detail: { target: 'claude-settings', path: '.claude/settings.json', before: 'sha256:0f1e', after: 'sha256:9a7c' },
    decisions: ['allow', 'deny'],
    voice: { eligible: 'gate', label: 'LANTERN', readback: 'allow the settings change in gnomon-web', echo: 'gate LANTERN' },
  }),
];

const EXTRA_CARDS: Record<string, unknown>[] = [
  cardOf({ name: 'atelier ask', kind: 'ask-user', hsid: A('atelier').hsid, lines: ['The session asks you a question', 'repo: atelier', 'Which tells file wins, repo or home?', '  1. repo (.atelier/tells.yaml)', '  2. home (~/.atelier/tells.yaml)'], detail: { questions: [{ q: 'Which tells file wins, repo or home?', options: ['repo', 'home'] }] }, decisions: ['answer'] }),
  cardOf({ name: 'gnomon-web plan', kind: 'plan', hsid: A('gnomon-web').hsid, lines: ['The session proposes a plan', 'repo: gnomon-web', '1. Move SettingsPage onto kit.Box', '2. Drop the old modal', '3. Re-run the visual fixtures', 'approve-plan: the session leaves plan mode. reject: it stays, with your note.'], detail: { plan: 'settings on kit' }, decisions: ['approve-plan', 'reject'] }),
  cardOf({ name: 'warpline verdict', kind: 'verdict', hsid: A('warpline').hsid, lines: ['Review verdict · seal v3', '2 findings · 0 blocking', 'accept: land it. reject: send it back with your note.'], detail: { findings: 2 }, decisions: ['accept', 'reject'] }),
  cardOf({ name: 'warpline merge', kind: 'merge-conflict', hsid: A('warpline').hsid, lines: ['Merge conflict · selvage', 'src/fabric.ts: both strands edit weave()'], detail: { path: 'src/fabric.ts' }, decisions: ['resolve', 'deny'] }),
  cardOf({ name: 'atelier tend', kind: 'tend', hsid: A('atelier').hsid, lines: ['Tend · 3 stale tells to prune', 'last touched 41 days ago'], detail: { stale: 3 }, decisions: ['accept', 'reject'] }),
  cardOf({ name: 'billing fallback', kind: 'fallback', hsid: BILLING, lines: ['The local model refused this turn', 'fall back to claude for this turn only?'], detail: { from: 'local', to: 'claude' }, decisions: ['fallback-cloud', 'deny'] }),
  cardOf({ name: 'workshop install', kind: 'install', hsid: null, lines: ['Install mod workshop 1.0.0', 'needs: log.read · egress: none', 'packageHash sha256:6c1d…e2 (first-party pin)'], detail: { name: 'workshop', version: '1.0.0' }, decisions: ['install', 'deny'] }),
  cardOf({ name: 'billing loosen', kind: 'strictness', hsid: BILLING, lines: ['Loosen billing to auto-edits', 'the session would edit files without a card; Bash still asks'], detail: { op: 'mode.loosen', from: 'ask', to: 'auto-edits' }, decisions: ['allow', 'deny'], strictness: { level: 'L1', mode: 'auto-edits', reason: 'requested from the GUI' } }),
];

export const OFFER_ID = `offer:${ulid('offer constellation')}`;
const OFFER_MUTED_ID = `offer:${ulid('offer neurons 1')}`;
const OFFER_QUIET_ID = `offer:${ulid('offer neurons 2')}`;

function deskChain(o: { extraCards?: boolean; voice?: 'armed' | 'crashed' | 'talk'; talk?: 'spoken' | 'choices'; model?: 'switched' | 'unconfirmed'; offer?: 'slip' | 'muted' } = {}): Chain {
  const c = new Chain();
  // the previous boot: twelve past sessions
  c.add(T('08:00', '2026-10-06'), 'daemon.start', { version: '8.0.0', pid: 3110 });
  PAST.forEach(([label, repo, day], i) => {
    const hsid = hsidOf(`past ${label}`);
    const s = { session: hsid, repo };
    c.add(T(`1${i % 8}:00`, day), 'session.open', { hsid, backend: 'claude', model: 'claude', cwd: `/Users/matt/code/${repo}` }, s);
    c.add(T(`1${i % 8}:20`, day), 'turn.result', { hsid, subtype: 'success', cost: 0.31, usage: { tokens: 40213 } }, s);
    c.add(T(`1${i % 8}:21`, day), 'session.exited', { hsid, reason: 'stopped', code: 0 }, s);
  });
  // today's boot
  c.add(T('13:00'), 'daemon.start', { version: '8.0.0', pid: 4242 });
  c.add(T('13:00:01'), 'socket.web.listen', { port: 7311 });
  for (const a of ACTIVE) c.add(a.key === 'atelier' ? T('13:30') : a.key === 'warpline' ? T('13:40') : a.key === 'billing' ? T('13:58') : a.key === 'ledgerette' ? T('14:02') : T('14:03'), 'session.open', { hsid: a.hsid, backend: 'claude', model: o.model && a.key === 'billing' ? 'haiku' : 'claude', cwd: a.cwd }, { session: a.hsid, repo: a.repo });
  const on = (key: string, at: string, kind: string, payload: Record<string, unknown>, principal?: string): void => {
    const a = A(key);
    c.add(at, kind, { hsid: a.hsid, ...payload }, { session: a.hsid, repo: a.repo, ...(principal ? { principal } : {}) });
  };
  const ev = (key: string, at: string, line: string): void => on(key, at, 'turn.event', { type: (JSON.parse(line) as { type: string }).type, line }, SESSION_PRINCIPAL);
  const ask = (key: string, at: string, text: string): void => {
    on(key, at, 'turn.sent', { bytes: text.length, contentHash: sha256Tagged(text), source: 'gui' });
    ev(key, at.replace(/\.000Z$/, '.400Z'), userLine(text));
  };

  // atelier: idle
  ask('atelier', T('13:30:10'), 'Tighten the tells copy on the landing card.');
  ev('atelier', T('13:49'), textLine('Done: the landing card now reads "Your tells, kept in one place." I left the longer version in tells.md.'));
  on('atelier', T('13:50'), 'turn.result', { subtype: 'success', cost: 0.0811, usage: { tokens: 12408 } });

  // warpline: a KNOT
  ask('warpline', T('13:40:10'), 'Run fsck on the selvage and seal v3.');
  ev('warpline', T('13:41'), toolLine(['Bash', { command: 'warpline fsck --all', description: 'Check every strand' }]));
  on('warpline', T('13:59'), 'turn.result', { subtype: 'success', cost: 0.1422, usage: { tokens: 22950 } });
  on('warpline', T('14:00'), 'warpline.knot', { strands: ['a3f1c2', '9c0e77'], path: 'src/seal.ts' });

  // billing: the focused chat (user message, the activity, the agent's reply), its permission card pending
  ask('billing', T('14:05:05'), 'Totals are off by a cent on 3-line orders. Find out why.');
  ev('billing', T('14:05:12'), toolLine(['Read', { file_path: 'src/totals.ts' }]));
  ev('billing', T('14:05:18'), toolLine(['Read', { file_path: 'src/discount.ts' }], ['Read', { file_path: 'src/order.ts' }], ['Read', { file_path: 'src/line-item.ts' }], ['Read', { file_path: 'src/rounding.ts' }], ['Read', { file_path: 'test/totals.test.ts' }]));
  ev('billing', T('14:05:27'), toolLine(['Bash', { command: 'pnpm test totals', description: '12 passed, 3.1s' }]));
  ev('billing', T('14:05:35'), toolLine(['Bash', { command: 'node scripts/repro.js', description: 'Reproduce the 3-line order' }]));
  ev('billing', T('14:05:46'), textLine('I found why the totals drift: **applyDiscount()** rounds each line before summing, so a 3-line order can be off by a cent. Rounding once at the end matches the invoice PDF and is a two-line change in `totals.ts`. I’d like to run the billing tests to confirm.'));

  // #gui-offer-slip: the kernel's offer.shown under the billing reply (the #offer-router disposed its ```offer block)
  const shown = (at: string, offerId: string, mod: string, kind: string, question: string, title: string, contextIn: string[]): void => on('billing', at, 'offer.shown', { offerId, mod, kind, phase: 'synthesize', title, question, replyTurnId: `turn:${BILLING}/1`, contextIn });
  if (o.offer === 'slip') shown(T('14:05:47'), OFFER_ID, 'constellation', 'map-the-idea', 'Map the rounding paths on the Constellation board before the fix?', 'Map it', ['recent-messages', 'open-files']);
  if (o.offer === 'muted') {
    shown(T('14:05:47'), OFFER_MUTED_ID, 'neurons', 'keep-finding', 'Keep “round once at the end” in Neurons?', 'Keep it', ['recent-messages']);
    on('billing', T('14:05:55'), 'offer.decided', { offerId: OFFER_MUTED_ID, decision: 'not-now' });
    ev('billing', T('14:06:20'), textLine('The fix is staged: one rounding call at the end of `totals()`. The tests are next once you allow the run.'));
    shown(T('14:06:21'), OFFER_QUIET_ID, 'neurons', 'keep-finding', 'Keep the fix note in Neurons?', 'Keep it', ['recent-messages']);
  }

  // #gui-model-picker: billing opened on haiku, then the human switched it mid-session (8.0:model-switch)
  if (o.model) {
    const fresh = `permit:v1:${ulid('model switch permit')}`;
    on('billing', T('14:05:50'), 'request.session.model', { model: 'sonnet' });
    on('billing', T('14:05:51'), 'session.model', { from: 'haiku', to: 'sonnet', permitId: fresh, outcome: o.model === 'switched' ? 'switched' : 'timeout' });
  }

  // ledgerette: tsc failed, the session exited
  ask('ledgerette', T('14:02:10'), 'Run CI for packages/ledger.');
  ev('ledgerette', T('14:02:30'), toolLine(['Bash', { command: 'pnpm -C packages/ledger tsc --noEmit', description: 'Typecheck the ledger' }]));
  on('ledgerette', T('14:04'), 'turn.result', { subtype: 'error_during_execution', isError: true, cost: 0.0213, usage: { tokens: 5120 } });
  on('ledgerette', T('14:04:02'), 'session.exited', { reason: 'error', code: 2 });

  // gnomon-web: streaming
  ask('gnomon-web', T('14:03:10'), 'Wire the settings page to the new kit.');
  ev('gnomon-web', T('14:05'), toolLine(['Edit', { file_path: 'src/pages/settings.tsx' }]));
  on('gnomon-web', T('14:08'), 'turn.partial', { n: 1 });
  on('gnomon-web', T('14:08:02'), 'turn.partial', { n: 2 });

  // the stack: knot, failed session, permission, paused/diff (arrival order)
  const at = ['14:00:01', '14:04:03', '14:06:10', '14:07'];
  DESK_CARDS.forEach((card, i) => {
    const hsid = card.hsid as string;
    const a = ACTIVE.find((x) => x.hsid === hsid)!;
    c.add(T(at[i]!), 'approval.request', { card, flags: card.flags ?? [], ...(card.kind === 'permission' ? { tool: 'Bash', tool_input: { command: 'pnpm test --filter billing' } } : {}) }, { session: hsid, repo: a.repo });
  });
  if (o.extraCards)
    EXTRA_CARDS.forEach((card, i) => {
      const hsid = typeof card.hsid === 'string' ? card.hsid : null;
      const a = hsid ? ACTIVE.find((x) => x.hsid === hsid)! : null;
      c.add(T(`14:1${i}`), 'approval.request', { card, flags: [] }, a ? { session: a.hsid, repo: a.repo } : {});
    });

  if (o.voice) {
    const voiceSessionId = `vs:${ulid('voice session')}`;
    c.add(T('14:06:30'), 'voice.session.start', { hsid: BILLING, mode: 'conversation', voiceSessionId }, { session: BILLING, repo: 'billing', principal: HUMAN_PRINCIPAL });
    if (o.talk) {
      // table talk: the reply's speak block, the kernel's one speakable row (turnSeq set in talkFixture), then one
      // playback row per sentence from the pipelined TTS (the third cut off by a barge-in)
      const said = o.talk === 'choices' ? 'The rounding fix is in and the tests pass. Should I open the pull request now?' : 'The rounding fix is in. All twelve billing tests pass. The invoice PDF now matches the totals.';
      const body = o.talk === 'choices' ? `A  Yes, open it against main.\nB  No, wait until I have read the diff.` : 'I rounded once at the end of `totals.ts`; the three-line order now totals $41.07, as on the invoice.';
      ev('billing', T('14:09'), textLine(`\`\`\`speak\n${said}\n\`\`\`\n\n${body}`));
      on('billing', T('14:09:01'), 'voice.turn.agent', { source: 'kernel-speakable', turnSeq: 0, items: [{ kind: 'reply', text: said, from: 'block' }] });
      if (o.talk === 'spoken') {
        const sentences = said.split(/(?<=\.) /);
        sentences.forEach((sentence, i) => {
          const t0 = Date.parse(T(`14:09:0${2 + i * 2}`));
          const cut = i === sentences.length - 1;
          if (cut) on('billing', T(`14:09:0${3 + i * 2}`), 'voice.bargein', { turnId: `a${i}`, atMs: t0 + 900, heardText: 'wait' }, `p:${PREVIEW_NS}/voice`);
          on('billing', T(`14:09:0${3 + i * 2}.500`), 'voice.turn.agent', { turnId: `a${i}`, t0, t1: t0 + (cut ? 900 : 1800), textPlanned: sentence, textSpoken: cut ? '' : sentence, ...(cut ? { interrupted: true } : {}) }, `p:${PREVIEW_NS}/voice`);
        });
      }
    }
    if (o.voice === 'armed') c.add(T('14:08:05'), 'voice.turn.user', { hsid: BILLING, partial: true, turnId: `vt:${ulid('voice turn')}`, text: 'and while you are in there check the', speakerId: `spk:${PREVIEW_NS}/matt` }, { session: BILLING, repo: 'billing', principal: `p:${PREVIEW_NS}/voice` });
  }
  return c;
}

/* ── status (the kernel's `status` result, as the page reads it) ─── */

function runModes(): Record<string, unknown> {
  const live = ACTIVE.filter((a) => a.key !== 'ledgerette');
  return { sessions: live.map((a) => ({ hsid: a.hsid, repo: a.repo, chosen: a.key === 'atelier' ? 'auto-edits' : 'ask', source: 'repo', ceiling: 'auto-edits', effective: a.key === 'atelier' ? 'auto-edits' : 'ask', level: 'L1' })) };
}

function statusOf(voice: Record<string, unknown>, o: { runModes?: boolean } = {}): Record<string, unknown> {
  return { principalKind: 'human', version: '8.0.0', ...(o.runModes === false ? {} : { runModes: runModes() }), voice };
}

const VOICE_RUNNING = { attached: false, clientConnected: true, client: { phase: 'running', restarts: 0, devUnsigned: false }, enrolled: [{ name: 'matt' }], maxMode: 'conversation', ambientIdleMs: 600_000 };
const attached = (since: string): Record<string, unknown> => ({ attached: true, hsid: BILLING, ceiling: 'conversation', since, idleAt: null, voiceSessionId: `vs:${ulid('voice session')}`, turns: 2, echoTailMs: 400, ambientIdleMs: 600_000, maxMode: 'conversation', ambientConfirmed: true, enrolled: [{ name: 'matt' }] });

/** S5: the Workshop's declared view as #mod-host status reports a running mod's views. */
const WORKSHOP_VIEW = { name: 'workshop', viewId: 'workshop.strip', slot: 'sidebar', placement: 'append', dev: false };

function fixture(name: string, title: string, c: Chain, status: Record<string, unknown>, focus: string | null, workshop = false, extra: Pick<Fixture, 'choice' | 'open'> = {}): Fixture {
  return { name, title, rows: c.rows(), status, focus, workshop, ...extra };
}

/** #gui-settings: what the sheet reads beyond the desk (today's grant, the served bundle, the kernel key). */
const SETTINGS_STATUS = {
  standing: { built: true, tuples: ['mode.loosen:auto-edits', 'permission:always', 'voice.widen', 'voice-arm:allow', 'daemon-stop:restart'], active: [{ grantId: 'sg:01JPREVIEWGRANT0000000001', tuples: ['mode.loosen:auto-edits', 'permission:always', 'voice.widen'], repos: ['billing'], expiresAt: '2026-10-20T22:00:00.000Z', uses: 3 }] },
  web: { listening: true, port: 7311, bundleHash: 'sha256:53b2cd7a8d74c94306f388e48249f176d37de86a1246995c905d3486db63fc81' },
  kernelKeyId: 'kk:7k2m9q4xa1b2c3d4',
};
/** The talk fixtures: the kernel's speakable row cites its reply's seq (known once the chain is ordered). */
function talkFixture(name: string, title: string, talk: 'spoken' | 'choices'): Fixture {
  const fx = fixture(name, title, deskChain({ voice: 'talk', talk }), statusOf({ ...attached(T('14:06:30')), clientConnected: true, client: { phase: 'running', restarts: 0, devUnsigned: false } }), BILLING);
  const ev = (r: LogRow): { kind: string; payload: Record<string, unknown> } => (r as unknown as { event: { kind: string; payload: Record<string, unknown> } }).event;
  const reply = fx.rows.find((r) => ev(r).kind === 'turn.event' && String(ev(r).payload.line).includes('```speak'));
  for (const r of fx.rows) if (ev(r).payload?.source === 'kernel-speakable') ev(r).payload.turnSeq = reply!.seq;
  return fx;
}

/* ── #paradigm-context-mod: the K1 slices the kernel would compute for the live sessions' repos ── */

function slice(key: string, o: { newest: string; tasks: Array<[string, string, string]>; open: number; high: number; decisions: Array<[string, string, string]>; decisionsOf: number; lore: Array<[string, string, string]>; loreOf: number; symbols: string[]; skipped?: Record<string, unknown> }): Record<string, unknown> {
  const a = A(key);
  return {
    v: 'paradigm-slice:v1',
    state: 'ok',
    project: projectHue(a.cwd),
    name: a.repo,
    at: '2026-10-20',
    newest: o.newest,
    tasks: { open: o.open, high: o.high, items: o.tasks.map(([id, title, priority]) => ({ id, title, priority })), count: { n: o.tasks.length, of: o.open } },
    decisions: { items: o.decisions.map(([id, date, title]) => ({ id, title, date })), count: { n: o.decisions.length, of: o.decisionsOf } },
    lore: { items: o.lore.map(([id, type, title]) => ({ id, title, type })), count: { n: o.lore.length, of: o.loreOf } },
    symbols: o.symbols,
    skipped: { malformed: 0, refused: 0, secret: 0, truncated: false, ...o.skipped },
  };
}

function paradigmSlices(): Record<string, unknown> {
  return {
    [A('billing').hsid]: slice('billing', {
      newest: '2026-10-20',
      open: 9,
      high: 2,
      tasks: [
        ['T-2026-10-20-004', 'Proration: credit the unused days when a plan is downgraded mid-cycle', 'high'],
        ['T-2026-10-19-012', 'Webhook retries must be idempotent on the invoice id', 'high'],
        ['T-2026-10-20-002', 'Move the tax table to the shared config', 'medium'],
        ['T-2026-10-18-007', 'Dunning emails: one template per locale', 'medium'],
        ['T-2026-10-15-003', 'Delete the v1 invoice exporter', 'low'],
      ],
      decisions: [
        ['TD-2026-10-20-311', '2026-10-20', 'Money is integer cents end to end, never floats'],
        ['TD-2026-10-19-208', '2026-10-19', 'Stripe is the source of truth for subscription state'],
        ['TD-2026-10-17-140', '2026-10-17', 'Invoices are immutable once finalised; corrections are credit notes'],
        ['TD-2026-10-14-077', '2026-10-14', 'Proration happens server side only'],
        ['TD-2026-10-09-019', '2026-10-09', 'One webhook endpoint per environment'],
      ],
      decisionsOf: 23,
      lore: [
        ['L-2026-10-20-matt-101500-001', 'milestone', 'Downgrade proration lands behind a flag'],
        ['L-2026-10-19-matt-170212-002', 'insight', 'Webhook storms come from the retry schedule, not Stripe'],
        ['L-2026-10-18-matt-093001-001', 'decision', 'Decision TD-2026-10-17-140 recorded'],
        ['L-2026-10-16-matt-142233-004', 'incident', 'Double charge on the 15th: replayed webhook'],
        ['L-2026-10-14-matt-110000-001', 'insight', 'Cents everywhere removed four rounding bugs'],
      ],
      loreOf: 61,
      symbols: ['#invoice-service', '$checkout-flow', '!payment-captured', '^billing-admin', '#proration', '~audit-required'],
      skipped: { malformed: 1 },
    }),
    [A('warpline').hsid]: slice('warpline', {
      newest: '2026-09-02',
      open: 2,
      high: 0,
      tasks: [['T-2026-08-23-001', 'Founder gates for the field test', 'medium']],
      decisions: [['TD-2026-09-02-913', '2026-09-02', 'M3-lite first: agent-key attribution before signing']],
      decisionsOf: 40,
      lore: [['L-2026-09-02-ascend-120000-001', 'milestone', 'M3-lite complete']],
      loreOf: 88,
      symbols: ['#warpline'],
    }),
  };
}

function emptyChain(): Chain {
  const c = new Chain();
  c.add(T('09:00'), 'daemon.start', { version: '8.0.0', pid: 501 });
  c.add(T('09:00:01'), 'socket.web.listen', { port: 7311 });
  return c;
}

export const FIXTURES: Readonly<Record<string, Fixture>> = Object.freeze({
  desk: fixture('desk', 'Desk: 5 active, 12 past, the billing chat, 4 cards', deskChain(), statusOf(VOICE_RUNNING), BILLING),
  empty: fixture('empty', 'Fresh install: no sessions, voice app not started', emptyChain(), statusOf({ attached: false, clientConnected: false, client: { phase: 'stopped', restarts: 0, devUnsigned: false }, enrolled: [] }, { runModes: false }), null),
  'voice-armed': fixture('voice-armed', 'Ambient voice attached to billing, hearing', deskChain({ voice: 'armed' }), statusOf({ ...attached(T('14:06:30')), clientConnected: true, client: { phase: 'running', restarts: 0, devUnsigned: false }, level: 0.62, dictation: { activity: 'speaking', holdToggles: 0, at: T('14:08:05') } }), BILLING),
  'voice-crashed': fixture('voice-crashed', 'Ambient attached, the voice app crashed (backoff)', deskChain({ voice: 'crashed' }), statusOf({ ...attached(T('14:06:30')), clientConnected: false, client: { phase: 'backoff', restarts: 2, devUnsigned: false, lastError: 'gnomon-voice-io exited (SIGABRT): the input device went away' } }), BILLING),
  'stack-heavy': fixture('stack-heavy', 'Twelve cards waiting', deskChain({ extraCards: true }), statusOf(VOICE_RUNNING), BILLING),
  workshop: fixture('workshop', 'Desk with the Workshop mod strip (needs you / working)', deskChain(), { ...statusOf(VOICE_RUNNING), mods: { views: [WORKSHOP_VIEW], paused: [] } }, BILLING, true),
  'workshop-paused': fixture('workshop-paused', 'Desk with the Workshop paused (one quiet line)', deskChain(), { ...statusOf(VOICE_RUNNING), mods: { views: [], paused: [{ name: 'workshop', why: 'user', cardId: null }] } }, BILLING, true),
  settings: fixture('settings', 'The Settings sheet open (theme auto, today\'s grant on)', deskChain(), { ...statusOf(VOICE_RUNNING), ...SETTINGS_STATUS }, BILLING, false, { open: 'settings' }),
  'settings-day': fixture('settings-day', 'Day chosen in Settings: papercraft even when the Mac is dark', deskChain(), { ...statusOf(VOICE_RUNNING), ...SETTINGS_STATUS }, BILLING, false, { open: 'settings', choice: 'day' }),
  spoken: talkFixture('spoken', 'Table talk: one reply spoken sentence by sentence, the last cut off (one 🔊 marker)', 'spoken'),
  choices: talkFixture('choices', 'Table talk: a reply that ends with lettered options (clickable choices)', 'choices'),
  'model-switch': fixture('model-switch', 'Billing switched haiku → sonnet mid-session; the ▾ confirm sheet open (opus)', deskChain({ model: 'switched' }), statusOf(VOICE_RUNNING), BILLING, false, { open: 'model-switch' }),
  'model-unconfirmed': fixture('model-unconfirmed', 'A model switch Claude did not confirm: "model: switching… (unconfirmed)"', deskChain({ model: 'unconfirmed' }), statusOf(VOICE_RUNNING), BILLING),
  'offer-slip': fixture('offer-slip', 'The Desk: a margin slip from mod:constellation under the billing reply', deskChain({ offer: 'slip' }), statusOf(VOICE_RUNNING), BILLING),
  'offer-armed': fixture('offer-armed', 'The slip armed by a first press: "takes: … · ↵ to open"', deskChain({ offer: 'slip' }), statusOf(VOICE_RUNNING), BILLING, false, { open: 'offer-armed' }),
  'offer-muted': fixture('offer-muted', '"not now" on mod:neurons: a trace, and its next offer stays quiet (L4)', deskChain({ offer: 'muted' }), statusOf(VOICE_RUNNING), BILLING),
  'workshop-absent': fixture('workshop-absent', 'Desk without the Workshop installed (one quiet line)', deskChain(), statusOf(VOICE_RUNNING), BILLING, true),
  'paradigm-context': { ...fixture('paradigm-context', 'Desk with the Paradigm Context mod in the sidebar (billing focused)', deskChain(), { ...statusOf(VOICE_RUNNING), mods: { modAbiId: 'preview', running: [{ name: 'paradigm-context', packageHash: 'preview', dev: false, sandbox: 'full' }], paused: [], ...PARADIGM_CONTEXT_STATUS } }, BILLING), paradigm: paradigmSlices() },
});

export const FIXTURE_NAMES: readonly string[] = Object.freeze(Object.keys(FIXTURES));
export const PREVIEW_THEMES = Object.freeze(['day', 'night'] as const);
