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
import { cardContentHash, toolInputHash } from '../core/render.js';
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
  open?: 'settings' | 'app-menu' | 'model-switch' | 'offer-armed' | 'voice-ladder' | 'voice-settings' | 'loops-waiting' | 'loops-trust' | 'steps';
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

/** TD-2026-10-23-939 follow-up: an Edit card offering "this file" and "edits in this repo", and a Bash card offering 2- and 3-word prefixes (built as the kernel builds them). */
const ALWAYS_EDIT_INPUT = { file_path: 'src/totals.ts', old_string: '  return lines.map(round).reduce(sum, 0);', new_string: '  return round(lines.reduce(sum, 0));' };
const ALWAYS_BASH_INPUT = { command: 'paradigm lore record --type fix --title "round once at the end"' };
const ALWAYS_EDIT_DETAIL = { tool: 'Edit', path: '/Users/matt/code/billing/src/totals.ts', inputHash: toolInputHash(ALWAYS_EDIT_INPUT), editScopes: ['file', 'repo-edits'], editPath: '/Users/matt/code/billing/src/totals.ts' };
const ALWAYS_BASH_DETAIL = { tool: 'Bash', inputHash: toolInputHash(ALWAYS_BASH_INPUT), prefixOptions: [['paradigm', 'lore'], ['paradigm', 'lore', 'record']] };
const ALWAYS_CARDS: Record<string, unknown>[] = [
  cardOf({ name: 'billing edit', kind: 'permission', hsid: BILLING, lines: ['The session asks to run Edit', 'repo: /Users/matt/code/billing', 'path: /Users/matt/code/billing/src/totals.ts', 'old:', '  return lines.map(round).reduce(sum, 0);', 'new:', '  return round(lines.reduce(sum, 0));'], extra: [{ type: 'edit-scope', detail: ALWAYS_EDIT_DETAIL }], detail: ALWAYS_EDIT_DETAIL, decisions: ['allow', 'deny', 'always'], voice: { eligible: 'reversible', label: 'card 5', readback: 'allow Edit src/totals.ts', echo: 'allowing card 5' } }),
  cardOf({ name: 'billing lore', kind: 'permission', hsid: BILLING, lines: ['The session asks to run Bash', 'repo: /Users/matt/code/billing', 'command: paradigm lore record --type fix --title "round once at the end"', 'always: the rule pins this exact command text, not what it runs (a script or binary it calls can change).'], extra: [{ type: 'bash-prefix', detail: ALWAYS_BASH_DETAIL }], detail: ALWAYS_BASH_DETAIL, decisions: ['allow', 'deny', 'always'], voice: { eligible: 'reversible', label: 'card 6', readback: 'allow Bash paradigm lore record', echo: 'allowing card 6' } }),
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

function deskChain(o: { always?: boolean; extraCards?: boolean; voice?: 'armed' | 'crashed' | 'talk'; talk?: 'spoken' | 'choices'; model?: 'switched' | 'unconfirmed'; offer?: 'slip' | 'muted' } = {}): Chain {
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
  // TD-2026-10-23-939 follow-up: the scoped always choices on an Edit card and a Bash card, pinned in billing (Mika's shots)
  if (o.always)
    ALWAYS_CARDS.forEach((card, i) => c.add(T(`14:07:3${i}`), 'approval.request', { card, flags: [], ...(i === 0 ? { tool: 'Edit', tool_input: ALWAYS_EDIT_INPUT } : { tool: 'Bash', tool_input: ALWAYS_BASH_INPUT }) }, { session: BILLING, repo: 'billing' }));
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

function runModes(o: { editsByRule?: string } = {}): Record<string, unknown> {
  const live = ACTIVE.filter((a) => a.key !== 'ledgerette');
  return { sessions: live.map((a) => ({ hsid: a.hsid, repo: a.repo, chosen: a.key === 'atelier' ? 'auto-edits' : 'ask', source: 'repo', ceiling: 'auto-edits', effective: a.key === 'atelier' ? 'auto-edits' : 'ask', level: 'L1', ...(o.editsByRule && a.key === 'billing' ? { editsByRule: o.editsByRule } : {}) })) };
}

function statusOf(voice: Record<string, unknown>, o: { runModes?: boolean; editsByRule?: string } = {}): Record<string, unknown> {
  return { principalKind: 'human', version: '8.0.0', ...(o.runModes === false ? {} : { runModes: runModes(o) }), voice };
}

const VOICE_RUNNING = { attached: false, clientConnected: true, client: { phase: 'running', restarts: 0, devUnsigned: false }, enrolled: [{ name: 'matt' }], maxMode: 'conversation', ambientIdleMs: 600_000 };
const attached = (since: string): Record<string, unknown> => ({ attached: true, hsid: BILLING, ceiling: 'conversation', since, idleAt: null, voiceSessionId: `vs:${ulid('voice session')}`, turns: 2, echoTailMs: 400, ambientIdleMs: 600_000, maxMode: 'conversation', ambientConfirmed: true, enrolled: [{ name: 'matt' }] });

/**
 * Founder field report 2026-10-23 (the mic restart loop with AirPods; "a clear input selection inside gnomon"): the
 * voice app's mic as status.voice.mic reports it (kernel voice-requests.ts MicReport) and the kernel-held inputChoice.
 * Real CoreAudio UIDs and transport words (gnomon-voice-io InputDevices.swift); names up to the kernel's 80-char cap.
 */
const AIRPODS = { id: 'A8-91-3D-52-7E-10:input', name: 'Matt’s AirPods Pro (2nd generation) Hands-Free AG Audio', transport: 'bluetooth', sampleRate: 24000 };
const BUILTIN = { id: 'BuiltInMicrophoneDevice', name: 'MacBook Pro Microphone', transport: 'built-in', sampleRate: 48000 };
const MIC_INPUTS = [
  BUILTIN,
  AIRPODS,
  { id: 'AppleUSBAudioEngine:Shure Inc:Shure MV7+:2140000:1', name: 'Shure MV7+ Podcast Microphone', transport: 'usb', sampleRate: 48000 },
  { id: 'AppleUSBAudioEngine:Apple Inc.:Studio Display:9A1C:6', name: 'Studio Display Microphone', transport: 'usb', sampleRate: 48000 },
  { id: 'BlackHole2ch_UID', name: 'BlackHole 2ch', transport: 'virtual', sampleRate: 48000 },
];
const devOf = (d: { name: string; transport: string; sampleRate: number }) => ({ name: d.name, transport: d.transport, sampleRate: d.sampleRate });
const micStatus = (mic: Record<string, unknown>, choice: { id: string | null; name: string | null } = { id: null, name: null }): Record<string, unknown> =>
  statusOf({ ...attached(T('14:06:30')), clientConnected: true, client: { phase: 'running', restarts: 0, devUnsigned: false }, mic: { aec: null, fault: null, on: true, inputs: MIC_INPUTS, selected: choice.id, missing: false, at: T('14:08:00'), ...mic }, inputChoice: choice });
const MIC_FIXTURES = {
  'voice-mic-fault': fixture('voice-mic-fault', 'Dictate attached; the mic turned itself off (restart loop: the input kept changing)', deskChain({ voice: 'armed' }), micStatus({ device: null, on: false, fault: { code: 'restart-loop', text: 'The mic kept restarting because the input device kept changing, so Gnomon turned it off.' } }, { id: AIRPODS.id, name: AIRPODS.name }), BILLING),
  'voice-mic-missing': fixture('voice-mic-missing', 'Dictate attached; the chosen mic (an Elgato) is unplugged, listening on the built-in mic', deskChain({ voice: 'armed' }), micStatus({ device: devOf(BUILTIN), aec: 'vpio', missing: true, level: 0.3 }, { id: 'AppleUSBAudioEngine:Elgato:Wave:3:BA1C:1', name: 'Elgato Wave:3' }), BILLING),
  'voice-input': fixture('voice-input', 'Voice settings with the input row: AirPods chosen (a long name), headphones so no echo cancel', deskChain({ voice: 'armed' }), micStatus({ device: devOf(AIRPODS), aec: 'headphones', level: 0.55 }, { id: AIRPODS.id, name: AIRPODS.name }), BILLING, false, { open: 'voice-settings' }),
};

/** S5: the Workshop's declared view as #mod-host status reports a running mod's views. */
const WORKSHOP_VIEW = { name: 'gnomon.workshop', viewId: 'workshop.strip', slot: 'sidebar', placement: 'append', dev: false };

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


/* ── #gui-loops: the Loops view fixtures (status.loops as the human class's status, loop cards as the broker raises them) ── */

const LOOP_REPO_KEY = `sha256:${'b'.repeat(64)}`;
const LN = (id: string, type: string, on: Record<string, string>, extra: Record<string, string> = {}): Record<string, unknown> => ({ id, type, on, ...extra });
const LOOP_SHAPES: Record<string, { start: string; nodes: Record<string, unknown>[]; triggers: string[]; autonomy: string; goal?: string; land?: string[] }> = {
  'flow-health-checkout': { start: 'defn', triggers: ['daily 02:00', 'on change'], autonomy: 'observe', goal: 'drift', nodes: [LN('defn', 'check', { pass: 'gates', fail: 'why' }, { role: 'read' }), LN('gates', 'check', { pass: 'tests', fail: 'why' }, { role: 'read' }), LN('tests', 'check', { pass: 'drift', fail: 'why' }, { role: 'read' }), LN('drift', 'check', { pass: '@goal', fail: 'why' }, { role: 'read' }), LN('why', 'model', { pass: 'tell', fail: 'tell', unsure: 'tell', unavailable: 'tell' }, { role: 'summarize' }), LN('tell', 'notify', { any: '@stop' }, { as: 'toast' })] },
  'green-typecheck-gnomon': { start: 'tsc', triggers: ['on change'], autonomy: 'act', goal: 'tsc', land: ['packages/gnomon/src/**'], nodes: [LN('tsc', 'check', { pass: '@goal', fail: 'fix' }, { role: 'read' }), LN('fix', 'model', { pass: 'tsc', fail: 'tsc', unsure: 'ask', unavailable: 'ask' }, { role: 'act' }), LN('ask', 'notify', { continue: 'fix', stop: '@stop', timeout: '@pause' }, { as: 'card' })] },
  'triage-on-commit': { start: 'triage', triggers: ['git.commit'], autonomy: 'propose', nodes: [LN('triage', 'model', { pass: 'fix', fail: 'tell', unsure: 'tell', unavailable: 'tell' }, { role: 'judge' }), LN('fix', 'call', { pass: 'tell', fail: 'tell' }, { callee: 'green-typecheck-gnomon' }), LN('tell', 'notify', { any: '@stop' }, { as: 'toast' })] },
  'evening-tidy': { start: 'reindex', triggers: ['daily 18:30'], autonomy: 'act', nodes: [LN('reindex', 'check', { pass: 'digest', fail: 'digest' }, { role: 'write' }), LN('digest', 'model', { any: 'tell' }, { role: 'summarize' }), LN('tell', 'notify', { any: '@stop' }, { as: 'toast' })] },
};
const loopKey = (repo: string, id: string): string => `repo/${LOOP_REPO_KEY}/${repo}/${id}`;
const ago = (min: number): string => new Date(Date.now() - min * 60_000).toISOString();
const ahead = (min: number): string => new Date(Date.now() + min * 60_000).toISOString();
function loopEntry(id: string, repo: string, state: string, o: { reason?: string; trusted?: string; content?: string; by?: string; shapeOf?: string } = {}): Record<string, unknown> {
  const s = LOOP_SHAPES[o.shapeOf ?? id] ?? LOOP_SHAPES['evening-tidy']!;
  const content = o.content ?? `sha256:${sha256Tagged(`loop ${id}`).slice(-64)}`;
  return {
    key: loopKey(repo, id), loopId: id, scope: 'repo', repo: `/Users/matt/code/${repo}`, repoKey: LOOP_REPO_KEY, state, ...(o.reason ? { reason: o.reason } : {}), contentHash: content, ...(o.trusted ? { trustedHash: o.trusted === 'same' ? content : o.trusted } : {}), errors: [], callIssues: [], authoredBy: o.by ? { principal: `p:${PREVIEW_NS}/${o.by}`, hsid: null, basis: 'agent-key-claim' } : 'file',
    shape: { triggers: s.triggers, autonomy: s.autonomy, start: s.start, ...(s.goal ? { goal: s.goal } : {}), ...(s.land ? { land: s.land } : {}), budgets: { run: { rounds: 8, wallMin: 30, tokens: 200000, computeSec: 900 }, day: { runs: 12, tokens: 1000000, computeSec: 3600 } }, authoredBy: o.by ?? 'file', nodes: s.nodes },
  };
}
const rn = (nodeId: string, verdict: string, next: string | null, at: string, durationMs: number, round?: number): Record<string, unknown> => ({ nodeId, visit: 1, verdict, next, edge: verdict, at, durationMs, ...(round ? { round } : {}) });

function loopsStatus(kind: 'desk' | 'paused' | 'many' | 'none'): Record<string, unknown> {
  if (kind === 'none') return { loops: [], running: [], runs: [], effective: {}, uptime: { enabled: { n: 0, of: 0 }, running: { n: 0, of: 0 }, waiting: { n: 0, of: 0 }, keepingAlive: false } };
  const loops = [
    loopEntry('green-typecheck-gnomon', 'gnomon-web', 'trusted', { trusted: 'same', by: 'arky' }),
    loopEntry('flow-health-checkout', 'billing', 'trusted', { trusted: 'same' }),
    loopEntry('triage-on-commit', 'billing', 'waiting-trust', { reason: 'content-changed', trusted: `sha256:${'c'.repeat(64)}`, by: 'arky' }),
    loopEntry('evening-tidy', 'atelier', 'paused', { reason: 'budget', trusted: 'same' }),
    loopEntry('nightly-dependency-audit-for-every-workspace-package', 'ledgerette', 'untrusted', { by: 'scholar', shapeOf: 'evening-tidy' }),
    loopEntry('weekly-lore-digest', 'billing', 'untrusted', { by: 'loid', shapeOf: 'evening-tidy' }),
  ];
  const runs: Record<string, unknown>[] = [
    { runId: 'run:01JLOOPLIVE000000000000GT', loopId: 'green-typecheck-gnomon', key: loopKey('gnomon-web', 'green-typecheck-gnomon'), startedAt: ago(9), rounds: 4, computeMs: 410_000, nodes: [rn('tsc', 'fail', 'fix', ago(9), 21_000), rn('fix', 'pass', 'tsc', ago(8), 95_000, 1), rn('tsc', 'fail', 'fix', ago(6), 20_000), rn('fix', 'pass', 'tsc', ago(5), 88_000, 2), rn('tsc', 'fail', 'fix', ago(4), 19_000), rn('fix', 'unsure', 'ask', ago(2), 101_000, 3), { nodeId: 'ask', visit: 1, verdict: 'waiting', at: ago(1) }], notified: 1 },
    { runId: 'run:01JLOOPFAIL000000000000FH', loopId: 'flow-health-checkout', key: loopKey('billing', 'flow-health-checkout'), startedAt: ago(130), endedAt: ago(127), reason: 'stop', rounds: 1, computeMs: 180_000, nodes: [rn('defn', 'pass', 'gates', ago(130), 2_000), rn('gates', 'pass', 'tests', ago(130), 3_000), rn('tests', 'fail', 'why', ago(129), 120_000), rn('why', 'pass', 'tell', ago(128), 40_000), rn('tell', 'pass', '@stop', ago(127), 100)], notified: 1 },
    { runId: 'run:01JLOOPGOAL000000000000FH', loopId: 'flow-health-checkout', key: loopKey('billing', 'flow-health-checkout'), startedAt: ago(600), endedAt: ago(598), reason: 'goal', rounds: 1, computeMs: 90_000, nodes: [rn('defn', 'pass', 'gates', ago(600), 2_000), rn('gates', 'pass', 'tests', ago(600), 3_000), rn('tests', 'pass', 'drift', ago(599), 70_000), rn('drift', 'pass', '@goal', ago(598), 9_000)], notified: 0 },
    { runId: 'run:01JLOOPBUDG000000000000ET', loopId: 'evening-tidy', key: loopKey('atelier', 'evening-tidy'), startedAt: ago(45), endedAt: ago(40), reason: 'budget', rounds: 8, computeMs: 900_000, nodes: [rn('reindex', 'pass', 'digest', ago(45), 60_000), rn('digest', 'unsure', 'tell', ago(41), 240_000)], notified: 0 },
  ];
  const uptime = { enabled: { n: 2, of: 6 }, running: { n: 1, of: 6 }, waiting: { n: 0, of: 6 }, keepingAlive: true, line: 'Gnomon is staying up for loops', nextDueAt: ahead(95) };
  const effective = { [loopKey('gnomon-web', 'green-typecheck-gnomon')]: { declared: 'act', autonomy: 'propose', level: 'L2', capReason: 'L2: gnomon-web strictness' } };
  if (kind === 'paused') {
    for (const l of loops) if (l.state === 'trusted' || l.state === 'paused') Object.assign(l, { state: 'paused', reason: 'kill-switch' });
    return { loops, running: [], runs: runs.map((r) => (r.endedAt ? r : { ...r, endedAt: ago(0), reason: 'kill-switch' })), effective, uptime: { ...uptime, enabled: { n: 0, of: 6 }, running: { n: 0, of: 6 }, keepingAlive: false, line: undefined } };
  }
  if (kind === 'many') {
    const repos = ['billing', 'warpline', 'ledgerette', 'gnomon-web', 'atelier'];
    const states = ['trusted', 'trusted', 'trusted', 'paused', 'untrusted', 'waiting-trust'];
    for (let i = 0; i < 54; i++) loops.push(loopEntry(`loop-${String(i).padStart(2, '0')}-${['tidy', 'health', 'typecheck-and-lint-every-package', 'digest'][i % 4]}`, repos[i % 5]!, states[i % 6]!, { trusted: states[i % 6] === 'untrusted' ? undefined : 'same', reason: states[i % 6] === 'paused' ? 'human' : states[i % 6] === 'waiting-trust' ? 'content-changed' : undefined, shapeOf: Object.keys(LOOP_SHAPES)[i % 4] } as never));
  }
  return { loops, running: [{ key: loopKey('gnomon-web', 'green-typecheck-gnomon'), runId: 'run:01JLOOPLIVE000000000000GT', rerun: false }], runs, effective, uptime };
}

const TRIAGE_BODY = [
  'Node triage (model, judge): local profile small, min confidence 0.7; tools paradigm:ripple|navigate; inputs git.diff; classes fix, ignore; limits 6 turns, 40000 tokens; on pass → fix; fail, unsure, unavailable → tell',
  'Node fix (call): green-typecheck-gnomon → callee hash 3f9a1c22; on pass, fail → tell',
  'Node tell (notify, toast): "triage done"; on any → @stop',
  'Triggers: git.commit; manual',
  'Budgets: run 8 rounds, 30 min, 200000 tokens, 900s compute; day 12 runs, 1000000 tokens, 3600s compute; escalations 1/run, 3/day',
  'Protected (act nodes may not edit): .paradigm/**, portal.yaml',
  'Land paths: packages/billing/src/**; message "triage: fix"; max wait 30 min (gate-class paths never land without a card)',
];
function loopTrustCard(): Record<string, unknown> {
  const row = { kind: 'loop.trusted', loopId: 'triage-on-commit', scope: 'repo', repoKey: LOOP_REPO_KEY, contentHash: `sha256:${'d'.repeat(64)}`, coreHash: `sha256:${'e'.repeat(64)}`, closureDigest: `sha256:${'f'.repeat(64)}`, cardId: cardIdOf('loop trust triage'), by: 'root', requestedBy: `p:${PREVIEW_NS}/arky` };
  const detail = { loopId: 'triage-on-commit', scope: 'repo', repoKey: LOOP_REPO_KEY, repo: '/Users/matt/code/billing', loopHash: row.contentHash, lines: TRIAGE_BODY, previousHash: `sha256:${'c'.repeat(64)}`, rootRows: [row], rootDecisions: ['allow'] };
  const lines = [
    'Trust loop triage-on-commit (repo loop in /Users/matt/code/billing)',
    `Content hash ${row.contentHash.slice(0, 19)}… (definition 1a2b3c4d, closure 9e8d7c6b)`,
    'Trusting lets this exact version run unattended on its triggers; any change to it, its argv files or its config closure pauses it until you trust again',
    ...TRIAGE_BODY,
    'Claimed by agent key: arky: an agent\'s loop runs only after you trust it here',
    'Changes since the trusted version cccccccc:',
    '- Triggers: git.commit; manual',
    '+ Triggers: git.commit; daily 09:00; manual',
    '- Land paths: none',
    '+ Land paths: packages/billing/src/**; message "triage: fix"; max wait 30 min (gate-class paths never land without a card)',
    'Allow needs Touch ID and the root key; deny or no answer trusts nothing',
  ];
  const card = cardOf({ name: 'loop trust triage', kind: 'loop-trust', hsid: null, requestedBy: `p:${PREVIEW_NS}/arky`, lines, extra: [{ type: 'root-rows', rootDecisions: ['allow'], detail }], detail, decisions: ['allow', 'deny'] });
  return card;
}
function loopChoiceCard(): Record<string, unknown> {
  const detail = { loopId: 'green-typecheck-gnomon', scope: 'repo', repoKey: LOOP_REPO_KEY, repo: '/Users/matt/code/gnomon-web', runId: 'run:01JLOOPLIVE000000000000GT', nodeId: 'ask', origin: 'loop', authoredBy: 'arky' };
  return cardOf({ name: 'loop choice gt', kind: 'loop-choice', hsid: null, lines: ['Raised by loop green-typecheck-gnomon (claimed by arky)', 'Run run:01JLOOPLIVE000000000000GT', 'fix is unsure after 3 rounds: tsc still fails on src/kernel/loops/runner.ts:812 (a narrowed union). Continue for 3 more rounds?', 'Continue lets the loop go on (Touch ID); stop ends this run'], detail, decisions: ['continue', 'stop'] });
}
/* ── #gui-turn-steps: the working key, its step list and the hook-result line, from real claude 2.1.309 lines ──
 * The hook lines are the shapes `claude -p --output-format stream-json --verbose --include-hook-events` wrote in
 * three probes (2026-10-23): a PreToolUse:Bash + PostToolUse:Bash + a 2 s Stop hook (probe 1); three Stop hooks
 * at once, one blocking with exit 2, one timing out, one failing with exit 1, then Claude's synthetic "Stop hook
 * feedback" line (probe 2); a Stop hook blocking with stdout JSON {decision:'block'} (probe 3). Ids, names, outcomes,
 * exit codes and output are the probes'; the times are placed in the billing afternoon and the assistant text is the
 * billing chat's. */
/** a time with milliseconds (T takes hh:mm or hh:mm:ss) */
const Tm = (hhmmss: string, ms: number): string => T(hhmmss).replace(/\.000Z$/, `.${String(ms).padStart(3, '0')}Z`);
type StepsKind = 'hook' | 'hooks' | 'bash';
const J = (o: Record<string, unknown>): string => JSON.stringify(o);
const hookStart = (id: string, name: string): string => J({ type: 'system', subtype: 'hook_started', hook_id: id, hook_name: name, hook_event: name.split(':')[0] });
const hookResp = (id: string, name: string, r: { stdout?: string; stderr?: string; exit_code: number; outcome: 'success' | 'error' | 'cancelled' }): string =>
  J({ type: 'system', subtype: 'hook_response', hook_id: id, hook_name: name, hook_event: name.split(':')[0], output: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '', stderr: r.stderr ?? '', exit_code: r.exit_code, outcome: r.outcome });
const feedbackLine = (text: string): string => J({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, isSynthetic: true });
const toolResult = (id: string, content: string, isError = false): string => J({ type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, is_error: isError }] }, parent_tool_use_id: null });
const bashUse = (id: string, command: string, description: string): string => J({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description } }] }, parent_tool_use_id: null });
const LONG_BASH = 'pnpm -C packages/billing vitest run test/totals.test.ts test/discount.test.ts test/rounding.test.ts --reporter=verbose --coverage.enabled=true --coverage.include=src/totals.ts';

function stepsChain(kind: StepsKind): Chain {
  const c = deskChain();
  const a = A('billing');
  const ev = (at: string, line: string): void => c.add(at, 'turn.event', { hsid: a.hsid, type: (JSON.parse(line) as { type: string }).type, line }, { session: a.hsid, repo: a.repo, principal: SESSION_PRINCIPAL });
  const on = (at: string, k: string, payload: Record<string, unknown>): void => c.add(at, k, { hsid: a.hsid, ...payload }, { session: a.hsid, repo: a.repo });
  // turn 1 (the reply above, 14:05:46) ends through its Stop hooks
  if (kind === 'bash') {
    // probe 3: a JSON block, the reply again, then the hook passes
    ev(T('14:05:47'), hookStart('7f0dc5ae-a2ec-4540-8801-4cff8987990e', 'Stop'));
    ev(Tm('14:05:48', 300), hookResp('7f0dc5ae-a2ec-4540-8801-4cff8987990e', 'Stop', { stdout: '{"decision":"block","reason":"JSON reason first line\\nmore"}\n', exit_code: 0, outcome: 'success' }));
    ev(Tm('14:05:48', 310), feedbackLine('Stop hook feedback:\nJSON reason first line\nmore'));
    ev(T('14:05:52'), textLine('The stop hook asked for the test plan: I will run the three totals suites once you allow the run.'));
    ev(Tm('14:05:52', 500), hookStart('5ac214ce-439a-41a6-a183-16f4dd7b3d98', 'Stop'));
    ev(Tm('14:05:52', 700), hookResp('5ac214ce-439a-41a6-a183-16f4dd7b3d98', 'Stop', { exit_code: 0, outcome: 'success' }));
  } else if (kind === 'hooks') {
    // probe 1: the 2 s Stop hook that passes (the quiet line)
    ev(T('14:05:47'), hookStart('7dd63f79-87a8-4b0d-8e0e-999f654a02f6', 'Stop'));
    ev(Tm('14:05:49', 100), hookResp('7dd63f79-87a8-4b0d-8e0e-999f654a02f6', 'Stop', { stdout: 'stop hook stdout line\n', stderr: 'stop hook stderr line\n', exit_code: 0, outcome: 'success' }));
  } else {
    // probe 2, round 1: three Stop hooks at once; exit 1, exit 2 (the block, fed back), the 2 s timeout
    for (const id of ['da043192-5357-4ee4-b1bc-6d1fb70e4d3c', '8cf8128b-13b9-478b-8417-7f47a66e2f57', '4b5d6c2f-43c4-44c0-a032-eb577585b17b']) ev(T('14:05:47'), hookStart(id, 'Stop'));
    ev(Tm('14:05:47', 50), hookResp('4b5d6c2f-43c4-44c0-a032-eb577585b17b', 'Stop', { stderr: 'fail stderr\n', exit_code: 1, outcome: 'error' }));
    ev(Tm('14:05:47', 60), hookResp('da043192-5357-4ee4-b1bc-6d1fb70e4d3c', 'Stop', { stderr: 'Please also say the word banana.\nsecond line of reason\n', exit_code: 2, outcome: 'error' }));
    ev(Tm('14:05:47', 70), feedbackLine('Stop hook feedback:\n[sh .claude/block.sh]: Please also say the word banana.\nsecond line of reason\n'));
    ev(Tm('14:05:49', 50), hookResp('8cf8128b-13b9-478b-8417-7f47a66e2f57', 'Stop', { exit_code: 1, outcome: 'cancelled' }));
    ev(T('14:05:51'), textLine('Banana, as the hook asked. The rounding fix is still waiting on the test run.'));
    // round 2: the block has passed; the failing and the slow hook again
    for (const id of ['f341e547-6a0a-4064-a797-8109eba516ff', '6d6ce571-7669-4247-88a5-c6929b9ae671', 'c986518d-47f1-4c01-afaa-33185aeae3ca']) ev(Tm('14:05:51', 200), hookStart(id, 'Stop'));
    ev(Tm('14:05:51', 250), hookResp('f341e547-6a0a-4064-a797-8109eba516ff', 'Stop', { exit_code: 0, outcome: 'success' }));
    ev(Tm('14:05:51', 260), hookResp('c986518d-47f1-4c01-afaa-33185aeae3ca', 'Stop', { stderr: 'fail stderr\n', exit_code: 1, outcome: 'error' }));
    ev(Tm('14:05:53', 250), hookResp('6d6ce571-7669-4247-88a5-c6929b9ae671', 'Stop', { exit_code: 1, outcome: 'cancelled' }));
  }
  on(T('14:05:54'), 'turn.result', { subtype: 'success', cost: 0.0412, usage: { tokens: 9310 } });
  // turn 2: running now (the preview clock reads 14:07:10)
  const ask = 'Run the totals tests and tell me what fails.';
  on(T('14:06:30'), 'turn.sent', { bytes: ask.length, contentHash: sha256Tagged(ask), source: 'gui' });
  ev(Tm('14:06:30', 400), userLine(ask));
  if (kind === 'bash') {
    // fifty earlier steps (the list must scroll inside itself), then the long command still running
    for (let i = 0; i < 48; i++) {
      const id = `toolu_r${i}`;
      ev(Tm(`14:06:${String(31 + Math.floor(i / 4)).padStart(2, '0')}`, (i % 4) * 200 + 100), J({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: `src/billing/very/deeply/nested/module-${i}/a-file-name-that-is-long-${i}.ts` } }] }, parent_tool_use_id: null }));
      ev(Tm(`14:06:${String(31 + Math.floor(i / 4)).padStart(2, '0')}`, (i % 4) * 200 + 180), toolResult(id, `file ${i}`, i === 7));
    }
    ev(T('14:06:50'), bashUse('toolu_01W8iN7i7pVVh1YQQBT4NEY6', LONG_BASH, 'Run the totals suites with coverage'));
    ev(Tm('14:06:50', 100), hookStart('7d498be5-bd2c-46c4-868a-b0cc593b6b3d', 'PreToolUse:Bash'));
    ev(Tm('14:06:50', 180), hookResp('7d498be5-bd2c-46c4-868a-b0cc593b6b3d', 'PreToolUse:Bash', { stdout: 'pre hook says hi\n', exit_code: 0, outcome: 'success' }));
    return c;
  }
  // probe 1: Bash with its Pre and Post hooks, the reply, then the Stop hook(s)
  ev(T('14:06:40'), bashUse('toolu_01W8iN7i7pVVh1YQQBT4NEY6', 'pnpm test totals', 'Run the totals tests'));
  ev(Tm('14:06:40', 100), hookStart('7d498be5-bd2c-46c4-868a-b0cc593b6b3d', 'PreToolUse:Bash'));
  ev(Tm('14:06:40', 180), hookResp('7d498be5-bd2c-46c4-868a-b0cc593b6b3d', 'PreToolUse:Bash', { stdout: 'pre hook says hi\n', exit_code: 0, outcome: 'success' }));
  ev(Tm('14:06:52', 300), hookStart('6d22a08e-042b-4775-9684-ffff288d8597', 'PostToolUse:Bash'));
  ev(Tm('14:06:52', 340), hookResp('6d22a08e-042b-4775-9684-ffff288d8597', 'PostToolUse:Bash', { stdout: 'post-done\n', exit_code: 0, outcome: 'success' }));
  ev(Tm('14:06:52', 400), toolResult('toolu_01W8iN7i7pVVh1YQQBT4NEY6', '12 passed (3.1s)'));
  ev(T('14:06:57'), J({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All twelve totals tests pass with the rounding fix.' }], stop_reason: 'end_turn' }, parent_tool_use_id: null }));
  if (kind === 'hook') ev(T('14:06:58'), hookStart('7dd63f79-87a8-4b0d-8e0e-999f654a02f6', 'Stop'));
  else for (const id of ['da043192-5357-4ee4-b1bc-6d1fb70e4d3c', '8cf8128b-13b9-478b-8417-7f47a66e2f57', '4b5d6c2f-43c4-44c0-a032-eb577585b17b']) ev(T('14:06:58'), hookStart(id, 'Stop'));
  return c;
}

function loopsChain(cards: boolean): Chain {
  const c = deskChain();
  if (cards) {
    c.add(T('14:07:30'), 'approval.request', { card: loopChoiceCard(), flags: [] }, { repo: 'gnomon-web' });
    c.add(T('14:07:40'), 'approval.request', { card: loopTrustCard(), flags: [] }, { repo: 'billing' });
  }
  return c;
}
/** #git-verbs (Mika's review): the kernel git verb cards, with the kernel's own lines (git/verbs.ts pushCard, createCard, initCard, worktreeCard), pinned in billing. */
const gitCard = (name: string, lines: string[], detail: Record<string, unknown>, decisions: string[], flags: string[]): Record<string, unknown> => cardOf({ name, kind: 'permission', hsid: BILLING, lines, extra: [{ type: 'git-verb', detail }], detail, decisions, flags });
const GIT_CARDS: Record<string, unknown>[] = [
  gitCard("billing push", ["Push main to git@github.com:ascend42/a-platform-fighter.git (github.com/ascend42/a-platform-fighter)", "host: github.com", "remote: origin → git@github.com:ascend42/a-platform-fighter.git (read by Gnomon from this repo's git config)", "branch: main (refs/heads/main → refs/heads/main)", "repo: /Users/matt/code/billing", "Runs with your own git credentials, outside the session sandbox. Never tags, never a mirror, never a force push.", "always: pushes to github.com/ascend42/a-platform-fighter from this repo with no card next time (any branch, never a force push)."], {"verb": "git.push", "tool": "gnomon_git_push", "host": "github.com", "owner": "ascend42", "repo": "a-platform-fighter", "slug": "github.com/ascend42/a-platform-fighter", "url": "git@github.com:ascend42/a-platform-fighter.git", "remote": "origin", "branch": "main", "force": false, "root": "/Users/matt/code/billing", "inputHash": "sha256:1111111111111111111111111111111111111111111111111111111111111111"}, ["allow", "deny", "always"], []),
  gitCard("billing create private", ["Create github.com/ascend42/a-platform-fighter (private), then push main to it", "host: github.com", "visibility: private (only you and people you add can see it)", "remote: origin → git@github.com:ascend42/a-platform-fighter.git (added by Gnomon)", "branch: main (refs/heads/main → refs/heads/main, tracked)", "repo: /Users/matt/code/billing", "Runs gh with your own GitHub sign-in and git with your own credentials, outside the session sandbox. Never tags, never a mirror, never a force push."], {"verb": "repo.create", "tool": "gnomon_repo_create", "host": "github.com", "owner": "ascend42", "repo": "a-platform-fighter", "slug": "github.com/ascend42/a-platform-fighter", "url": "git@github.com:ascend42/a-platform-fighter.git", "remote": "origin", "branch": "main", "visibility": "private", "root": "/Users/matt/code/billing", "inputHash": "sha256:2222222222222222222222222222222222222222222222222222222222222222"}, ["allow", "deny"], []),
  gitCard("billing create public", ["Create github.com/ascend42/a-platform-fighter (public), then push main to it", "host: github.com", "visibility: public (anyone can see this repo and its history)", "remote: origin → git@github.com:ascend42/a-platform-fighter.git (added by Gnomon)", "branch: main (refs/heads/main → refs/heads/main, tracked)", "repo: /Users/matt/code/billing", "Runs gh with your own GitHub sign-in and git with your own credentials, outside the session sandbox. Never tags, never a mirror, never a force push."], {"verb": "repo.create", "tool": "gnomon_repo_create", "host": "github.com", "owner": "ascend42", "repo": "a-platform-fighter", "slug": "github.com/ascend42/a-platform-fighter", "url": "git@github.com:ascend42/a-platform-fighter.git", "remote": "origin", "branch": "main", "visibility": "public", "root": "/Users/matt/code/billing", "inputHash": "sha256:3333333333333333333333333333333333333333333333333333333333333333"}, ["allow", "deny"], ["irreversible"]),
  gitCard("billing force push", ["Push main to git@github.com:ascend42/a-platform-fighter.git (github.com/ascend42/a-platform-fighter)", "host: github.com", "remote: origin → git@github.com:ascend42/a-platform-fighter.git (read by Gnomon from this repo's git config)", "branch: main (refs/heads/main → refs/heads/main)", "repo: /Users/matt/code/billing", "Warning: FORCE push (with lease): it can overwrite commits on the remote that your branch does not have.", "Runs with your own git credentials, outside the session sandbox. Never tags, never a mirror."], {"verb": "git.push", "tool": "gnomon_git_push", "host": "github.com", "owner": "ascend42", "repo": "a-platform-fighter", "slug": "github.com/ascend42/a-platform-fighter", "url": "git@github.com:ascend42/a-platform-fighter.git", "remote": "origin", "branch": "main", "force": true, "root": "/Users/matt/code/billing", "inputHash": "sha256:4444444444444444444444444444444444444444444444444444444444444444"}, ["allow", "deny"], ["irreversible"]),
  gitCard("billing lookalike push", ["Warning: the host githuh.com looks like github.com but is a different host. Deny unless you meant this host.", "Push main to git@githuh.com:ascend42/a-platform-fighter.git (githuh.com/ascend42/a-platform-fighter)", "host: githuh.com", "remote: origin → git@githuh.com:ascend42/a-platform-fighter.git (read by Gnomon from this repo's git config)", "branch: main (refs/heads/main → refs/heads/main)", "repo: /Users/matt/code/billing", "Runs with your own git credentials, outside the session sandbox. Never tags, never a mirror, never a force push."], {"verb": "git.push", "tool": "gnomon_git_push", "host": "githuh.com", "owner": "ascend42", "repo": "a-platform-fighter", "slug": "githuh.com/ascend42/a-platform-fighter", "url": "git@githuh.com:ascend42/a-platform-fighter.git", "remote": "origin", "branch": "main", "force": false, "root": "/Users/matt/code/billing", "hostWarning": "the host githuh.com looks like github.com but is a different host", "inputHash": "sha256:5555555555555555555555555555555555555555555555555555555555555555"}, ["allow", "deny"], ["claim-mismatch"]),
  gitCard("billing init", ["Make a git repo in /Users/matt/code/billing", "repo: /Users/matt/code/billing", "branch: main; a minimal config (no hooks, no helpers, no includes) and an empty hooks folder", "Runs git init outside the session sandbox."], {"verb": "git.init", "tool": "gnomon_git_init", "root": "/Users/matt/code/billing", "branch": "main", "remnant": false, "inputHash": "sha256:6666666666666666666666666666666666666666666666666666666666666666"}, ["allow", "deny"], []),
  gitCard("billing worktree add", ["Make a worktree fix-rounding on a new branch gnomon/fix-rounding", "worktree: /Users/matt/code/billing/.gnomon/worktrees/fix-rounding", "branch: gnomon/fix-rounding from main", "repo: /Users/matt/code/billing", "Runs git worktree add outside the session sandbox (no hooks). The session can edit its files; its CLAUDE.md, .claude, .mcp.json and .git pointer stay as checked out."], {"verb": "git.worktree.add", "tool": "gnomon_worktree_add", "root": "/Users/matt/code/billing", "name": "fix-rounding", "dir": "/Users/matt/code/billing/.gnomon/worktrees/fix-rounding", "branch": "gnomon/fix-rounding", "base": "main", "force": false, "inputHash": "sha256:7777777777777777777777777777777777777777777777777777777777777777"}, ["allow", "deny"], []),
  gitCard("billing worktree remove", ["Remove the worktree fix-rounding", "worktree: /Users/matt/code/billing/.gnomon/worktrees/fix-rounding", "repo: /Users/matt/code/billing", "Refused by git if the worktree has uncommitted changes. Its branch stays.", "Runs git worktree remove outside the session sandbox."], {"verb": "git.worktree.remove", "tool": "gnomon_worktree_remove", "root": "/Users/matt/code/billing", "name": "fix-rounding", "dir": "/Users/matt/code/billing/.gnomon/worktrees/fix-rounding", "branch": "gnomon/fix-rounding", "base": "main", "force": false, "inputHash": "sha256:8888888888888888888888888888888888888888888888888888888888888888"}, ["allow", "deny"], []),
  gitCard("billing worktree force remove", ["Remove the worktree fix-rounding", "worktree: /Users/matt/code/billing/.gnomon/worktrees/fix-rounding", "repo: /Users/matt/code/billing", "Warning: FORCE remove: uncommitted changes in this worktree are lost.", "Runs git worktree remove outside the session sandbox."], {"verb": "git.worktree.remove", "tool": "gnomon_worktree_remove", "root": "/Users/matt/code/billing", "name": "fix-rounding", "dir": "/Users/matt/code/billing/.gnomon/worktrees/fix-rounding", "branch": "gnomon/fix-rounding", "base": "main", "force": true, "inputHash": "sha256:9999999999999999999999999999999999999999999999999999999999999999"}, ["allow", "deny"], ["irreversible"]),
];
function gitChain(): Chain {
  const c = deskChain();
  GIT_CARDS.forEach((card, i) => {
    const d = ((card.block as { children: Array<{ type: string; detail?: Record<string, unknown> }> }).children.find((k) => k.type === 'git-verb')!.detail)!;
    c.add(T(`14:07:${String(10 + i)}`), 'approval.request', { card, flags: (card.flags as string[] | undefined) ?? [], tool: d.tool, tool_input: { root: d.root } }, { session: BILLING, repo: 'billing' });
  });
  return c;
}

const loopsFx = (name: string, title: string, kind: 'desk' | 'paused' | 'many' | 'none', cards = true): Fixture => fixture(name, title, loopsChain(cards), { ...statusOf(VOICE_RUNNING), loops: loopsStatus(kind) }, BILLING);

export const FIXTURES: Readonly<Record<string, Fixture>> = Object.freeze({
  desk: fixture('desk', 'Desk: 5 active, 12 past, the billing chat, 4 cards', deskChain(), statusOf(VOICE_RUNNING), BILLING),
  empty: fixture('empty', 'Fresh install: no sessions, voice app not started', emptyChain(), statusOf({ attached: false, clientConnected: false, client: { phase: 'stopped', restarts: 0, devUnsigned: false }, enrolled: [] }, { runModes: false }), null),
  'voice-armed': fixture('voice-armed', 'Dictate attached to billing, hearing', deskChain({ voice: 'armed' }), statusOf({ ...attached(T('14:06:30')), clientConnected: true, client: { phase: 'running', restarts: 0, devUnsigned: false }, level: 0.62, dictation: { activity: 'speaking', holdToggles: 0, at: T('14:08:05') } }), BILLING),
  'voice-crashed': fixture('voice-crashed', 'Dictate attached, the voice app crashed (backoff)', deskChain({ voice: 'crashed' }), statusOf({ ...attached(T('14:06:30')), clientConnected: false, client: { phase: 'backoff', restarts: 2, devUnsigned: false, lastError: 'gnomon-voice-io exited (SIGABRT): the input device went away' } }), BILLING),
  'voice-ladder': fixture('voice-ladder', 'The voice pill open: the trust ladder (Dictate live, Send word not set up)', deskChain({ voice: 'armed' }), statusOf({ ...attached(T('14:06:30')), clientConnected: true, client: { phase: 'running', restarts: 0, devUnsigned: false } }), BILLING, false, { open: 'voice-ladder' }),
  'voice-settings': fixture('voice-settings', 'The Voice settings sheet (your voice, send word, keys, listen, timing, risk)', deskChain({ voice: 'armed' }), statusOf({ ...attached(T('14:06:30')), clientConnected: true, client: { phase: 'running', restarts: 0, devUnsigned: false } }), BILLING, false, { open: 'voice-settings' }),
  ...MIC_FIXTURES,
  'always-scopes': fixture('always-scopes', 'Billing: an Edit card offering Always for the file or the repo, and a Bash card offering 2- and 3-word prefixes', deskChain({ always: true }), statusOf(VOICE_RUNNING), BILLING),
  'edits-by-rule': fixture('edits-by-rule', 'Billing in ask with an "edits in this repo" rule standing: the run mode chip and its revoke entry', deskChain(), statusOf(VOICE_RUNNING, { editsByRule: 'card:01JPREVIEWEDITSRULE00000001' }), BILLING),
  'stack-heavy': fixture('stack-heavy', 'Twelve cards waiting', deskChain({ extraCards: true }), statusOf(VOICE_RUNNING), BILLING),
  workshop: fixture('workshop', 'Desk with the Workshop mod strip (needs you / working)', deskChain(), { ...statusOf(VOICE_RUNNING), mods: { views: [WORKSHOP_VIEW], paused: [] } }, BILLING, true),
  'workshop-paused': fixture('workshop-paused', 'Desk with the Workshop paused (one quiet line)', deskChain(), { ...statusOf(VOICE_RUNNING), mods: { views: [], paused: [{ name: 'gnomon.workshop', why: 'user', cardId: null }] } }, BILLING, true),
  'app-menu': fixture('app-menu', 'The Gnomon menu open: layout, theme, mods, voice settings, settings, who is connected', deskChain(), { ...statusOf(VOICE_RUNNING), ...SETTINGS_STATUS }, BILLING, false, { open: 'app-menu' }),
  settings: fixture('settings', 'The Settings sheet open (theme auto, today\'s grant on)', deskChain(), { ...statusOf(VOICE_RUNNING), ...SETTINGS_STATUS }, BILLING, false, { open: 'settings' }),
  'settings-day': fixture('settings-day', 'Day chosen in Settings: papercraft even when the Mac is dark', deskChain(), { ...statusOf(VOICE_RUNNING), ...SETTINGS_STATUS }, BILLING, false, { open: 'settings', choice: 'day' }),
  spoken: talkFixture('spoken', 'Table talk: one reply spoken sentence by sentence, the last cut off (one spoken-aloud marker)', 'spoken'),
  choices: talkFixture('choices', 'Table talk: a reply that ends with lettered options (clickable choices)', 'choices'),
  'model-switch': fixture('model-switch', 'Billing switched haiku → sonnet mid-session; the ▾ confirm sheet open (opus)', deskChain({ model: 'switched' }), statusOf(VOICE_RUNNING), BILLING, false, { open: 'model-switch' }),
  'model-unconfirmed': fixture('model-unconfirmed', 'A model switch Claude did not confirm: "model: switching… (unconfirmed)"', deskChain({ model: 'unconfirmed' }), statusOf(VOICE_RUNNING), BILLING),
  'offer-slip': fixture('offer-slip', 'The Desk: a margin slip from mod:constellation under the billing reply', deskChain({ offer: 'slip' }), statusOf(VOICE_RUNNING), BILLING),
  'offer-armed': fixture('offer-armed', 'The slip armed by a first press: "takes: … · ↵ to open"', deskChain({ offer: 'slip' }), statusOf(VOICE_RUNNING), BILLING, false, { open: 'offer-armed' }),
  'offer-muted': fixture('offer-muted', '"not now" on mod:neurons: a trace, and its next offer stays quiet (L4)', deskChain({ offer: 'muted' }), statusOf(VOICE_RUNNING), BILLING),
  'workshop-absent': fixture('workshop-absent', 'Desk without the Workshop installed (one quiet line)', deskChain(), statusOf(VOICE_RUNNING), BILLING, true),
  'paradigm-context': { ...fixture('paradigm-context', 'Desk with the Paradigm Context mod in the sidebar (billing focused)', deskChain(), { ...statusOf(VOICE_RUNNING), mods: { modAbiId: 'preview', running: [{ name: 'paradigm-context', packageHash: 'preview', dev: false, sandbox: 'full' }], paused: [], ...PARADIGM_CONTEXT_STATUS } }, BILLING), paradigm: paradigmSlices() },
  loops: loopsFx('loops', 'Loops: 6 loops, one running at ask, a loop-choice and a loop-trust card, a failure, a kernel pause, two waiting', 'desk'),
  'loops-waiting': { ...loopsFx('loops-waiting', 'Loops leaf on the loops waiting for trust (Review all)', 'desk'), open: 'loops-waiting' },
  'loops-trust': { ...loopsFx('loops-trust', 'A loop-trust card unfolded over the centre (Read)', 'desk'), open: 'loops-trust' },
  'loops-paused': loopsFx('loops-paused', 'Loops after Pause all (kill switch)', 'paused', false),
  'loops-many': loopsFx('loops-many', 'Loops: 60 loops across five projects', 'many', false),
  'turn-hook': fixture('turn-hook', 'Billing running: one Stop hook (Stop hook · 12s); the turn before blocked, failed and timed out (hook-result, warn)', stepsChain('hook'), statusOf(VOICE_RUNNING), BILLING),
  'turn-hooks': fixture('turn-hooks', 'Billing running: three Stop hooks at once; the turn before had one slow OK hook (hook-result, quiet)', stepsChain('hooks'), statusOf(VOICE_RUNNING), BILLING),
  'turn-steps': fixture('turn-steps', 'Billing running a long Bash command, its step list unfolded (fifty steps, scrolls inside); a JSON-blocked Stop hook before', stepsChain('bash'), statusOf(VOICE_RUNNING), BILLING, false, { open: 'steps' }),
  'loops-none': loopsFx('loops-none', 'Loops served, none written yet', 'none', false),
  'git-verbs': fixture('git-verbs', 'Billing: the kernel git verb cards (push with its Always, create private and public, force push, a lookalike host, init, worktree add, remove and force remove)', gitChain(), statusOf(VOICE_RUNNING), BILLING),
});

export const FIXTURE_NAMES: readonly string[] = Object.freeze(Object.keys(FIXTURES));
export const PREVIEW_THEMES = Object.freeze(['day', 'night'] as const);
