/**
 * @symbol #gui-loops
 *
 * #gui-loops (docs/specs/gnomon-loops.md §6; Atelier 2026-10-22-gnomon-loops-ui, design-system loops-word, loops-leaf,
 * loop-row, loop-list, loop-detail, budget-field, alert, trust-slip, toast loop-done). PURE: everything the Loops view
 * shows is computed here from the kernel's `status.loops` (the human class's status: registry list with each loop's
 * drawable shape, the runner's running set and recent run ledger, effective autonomy, and the uptime hold) and from
 * live loop rows. The DOM is ui/loops-view.ts.
 *
 * Vocabulary (design-system content.vocabulary): "loop run" and "run mode" always both words; loops say "autonomy";
 * "waiting for trust".
 */

export interface LoopNodeShape {
  id: string;
  type: string;
  role?: string;
  as?: string;
  callee?: string;
  on: Record<string, string>;
}
export interface LoopShape {
  triggers: string[];
  autonomy: string;
  start: string;
  goal?: string;
  land?: string[];
  budgets: { run: Record<string, number | string>; day: Record<string, number | string> };
  authoredBy: string;
  nodes: LoopNodeShape[];
  tightened?: string[];
}
export interface LoopRunNode {
  nodeId: string;
  type?: string;
  visit: number;
  round?: number;
  verdict: string;
  edge?: string;
  next?: string | null;
  durationMs?: number;
  detail?: string;
  at?: string;
}
export interface LoopRun {
  runId: string;
  loopId: string;
  key?: string;
  startedAt?: string;
  endedAt?: string;
  reason?: string;
  rounds: number;
  computeMs: number;
  nodes: LoopRunNode[];
}
export interface LoopEffective {
  declared?: string;
  autonomy?: string;
  level?: string;
  mode?: string;
  paused?: boolean;
  capReason?: string;
}
export interface LoopUptime {
  enabled: { n: number; of: number };
  running: { n: number; of: number };
  waiting: { n: number; of: number };
  keepingAlive: boolean;
  line?: string;
  nextDueAt?: string;
}

/** The row states (design-system loop-row.states, plus untrusted/invalid which list under their project). */
export type LoopRowState = 'running' | 'idle' | 'paused' | 'kernel-paused' | 'kill-switch' | 'waiting-trust' | 'waiting-land' | 'parked' | 'invalid';

export interface LoopItem {
  key: string;
  loopId: string;
  scope: string;
  repo: string;
  repoKey: string;
  title?: string;
  /** the registry's state word */
  registry: string;
  reason?: string;
  state: LoopRowState;
  contentHash?: string;
  trustedHash?: string;
  trustedAt?: string;
  /** a change to a trusted loop waits (vs a new loop never trusted) */
  changed: boolean;
  shape?: LoopShape;
  /** the kernel's authoredBy basis: an agent's authorship is a claim made with its key */
  claimed: boolean;
  effective?: LoopEffective;
  runningRun?: string;
  /** newest first */
  runs: LoopRun[];
  /** TD-2026-10-22-769: its schedule or event fires are refused before any step (status.loops.startRefused) */
  startRefused?: LoopStartRefused;
}

/** A loop whose fires the kernel refuses at start for want of a local model (the kernel's closed why). */
export interface LoopStartRefused {
  code: 'no-local-model';
  why: 'none' | 'sessions-only' | 'no-runner' | 'no-profile';
  at: string;
  since: string;
  /** refused fires; 0 = nothing has fired yet, but the kernel would refuse it now (the config and its trust) */
  count: number;
  /** the refused fire's trigger type ('none' while nothing has fired) */
  trigger: string;
  modelNodes: string[];
}

const START_REFUSED_WHYS: readonly string[] = ['none', 'sessions-only', 'no-runner', 'no-profile'];
function parseStartRefused(v: unknown): LoopStartRefused | null {
  if (!isObj(v) || v.code !== 'no-local-model' || typeof v.why !== 'string' || !START_REFUSED_WHYS.includes(v.why) || typeof v.at !== 'string' || typeof v.since !== 'string') return null;
  return { code: 'no-local-model', why: v.why as LoopStartRefused['why'], at: v.at, since: v.since, count: Math.max(0, Math.floor(num(v.count, 1))), trigger: str(v.trigger) ?? 'schedule', modelNodes: Array.isArray(v.modelNodes) ? v.modelNodes.filter((x): x is string => typeof x === 'string') : [] };
}

export interface LoopsModel {
  loops: LoopItem[];
  uptime: LoopUptime | null;
  running: number;
  waitingTrust: number;
  pausedAll: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The pause reasons the kernel itself writes (a kernel pause: an alert, and resuming needs presence). */
export const KERNEL_PAUSE_REASONS: ReadonlySet<string> = new Set(['budget', 'node-exit', 'thrash', 'strictness', 'unavailable', 'timeout']);
/** Run ends that are not an outcome the human needs to hear about as trouble. */
const QUIET_ENDS: ReadonlySet<string> = new Set(['goal', 'paused', 'kill-switch', 'daemon-restart', 'content-changed', 'closure-changed', 'untrusted']);
const STOP_ENDS: ReadonlySet<string> = new Set(['budget', 'thrash', 'node-exit', 'strictness']);

function parseShape(v: unknown): LoopShape | undefined {
  if (!isObj(v) || !Array.isArray(v.nodes)) return undefined;
  const b = isObj(v.budgets) ? v.budgets : {};
  const rec = (o: unknown): Record<string, number | string> => {
    const out: Record<string, number | string> = {};
    if (isObj(o)) for (const [k, x] of Object.entries(o)) if (typeof x === 'number' || typeof x === 'string') out[k] = x;
    return out;
  };
  return {
    triggers: Array.isArray(v.triggers) ? v.triggers.filter((t): t is string => typeof t === 'string') : [],
    autonomy: str(v.autonomy) ?? 'observe',
    start: str(v.start) ?? '',
    ...(str(v.goal) ? { goal: str(v.goal) } : {}),
    ...(Array.isArray(v.land) ? { land: v.land.filter((t): t is string => typeof t === 'string') } : {}),
    budgets: { run: rec(b.run), day: rec(b.day) },
    authoredBy: str(v.authoredBy) ?? 'file',
    nodes: v.nodes.filter(isObj).map((n) => ({
      id: str(n.id) ?? '?',
      type: str(n.type) ?? '?',
      ...(str(n.role) ? { role: str(n.role) } : {}),
      ...(str(n.as) ? { as: str(n.as) } : {}),
      ...(str(n.callee) ? { callee: str(n.callee) } : {}),
      on: Object.fromEntries(Object.entries(isObj(n.on) ? n.on : {}).filter((e): e is [string, string] => typeof e[1] === 'string')),
    })),
  };
}

function parseRun(v: unknown): LoopRun | null {
  if (!isObj(v) || typeof v.runId !== 'string' || typeof v.loopId !== 'string') return null;
  return {
    runId: v.runId,
    loopId: v.loopId,
    ...(str(v.key) ? { key: str(v.key) } : {}),
    ...(str(v.startedAt) ? { startedAt: str(v.startedAt) } : {}),
    ...(str(v.endedAt) ? { endedAt: str(v.endedAt) } : {}),
    ...(str(v.reason) ? { reason: str(v.reason) } : {}),
    rounds: num(v.rounds),
    computeMs: num(v.computeMs),
    nodes: (Array.isArray(v.nodes) ? v.nodes : []).filter(isObj).map((n) => ({
      nodeId: str(n.nodeId) ?? '?',
      ...(str(n.type) ? { type: str(n.type) } : {}),
      visit: num(n.visit, 1),
      ...(typeof n.round === 'number' ? { round: n.round } : {}),
      verdict: str(n.verdict) ?? '',
      ...(str(n.edge) ? { edge: str(n.edge) } : {}),
      ...(typeof n.next === 'string' || n.next === null ? { next: n.next as string | null } : {}),
      ...(typeof n.durationMs === 'number' ? { durationMs: n.durationMs } : {}),
      ...(str(n.detail) ? { detail: str(n.detail) } : {}),
      ...(str(n.at) ? { at: str(n.at) } : {}),
    })),
  };
}

function parseUptime(v: unknown): LoopUptime | null {
  if (!isObj(v)) return null;
  const nOf = (x: unknown): { n: number; of: number } => (isObj(x) ? { n: num(x.n), of: num(x.of) } : { n: 0, of: 0 });
  return { enabled: nOf(v.enabled), running: nOf(v.running), waiting: nOf(v.waiting), keepingAlive: v.keepingAlive === true, ...(str(v.line) ? { line: str(v.line) } : {}), ...(str(v.nextDueAt) ? { nextDueAt: str(v.nextDueAt) } : {}) };
}

function stateOf(registry: string, reason: string | undefined, running: boolean): LoopRowState {
  if (running) return 'running';
  if (registry === 'waiting-trust' || registry === 'untrusted') return 'waiting-trust';
  if (registry === 'invalid') return 'invalid';
  if (registry === 'paused') {
    if (reason === 'kill-switch') return 'kill-switch';
    if (reason && KERNEL_PAUSE_REASONS.has(reason)) return 'kernel-paused';
    if (reason === 'content-changed' || reason === 'closure-changed') return 'waiting-trust';
    return 'paused';
  }
  return 'idle';
}

/** The Loops model from a kernel status (null when the kernel serves no loops to this connection). */
export function loopsOf(status: unknown): LoopsModel | null {
  const l = isObj(status) && isObj(status.loops) ? status.loops : null;
  if (!l) return null;
  const runs = (Array.isArray(l.runs) ? l.runs : []).map(parseRun).filter((r): r is LoopRun => r !== null);
  const runningBy = new Map<string, string>();
  for (const r of Array.isArray(l.running) ? l.running : []) if (isObj(r) && typeof r.key === 'string') runningBy.set(r.key, str(r.runId) ?? '');
  const eff = isObj(l.effective) ? l.effective : {};
  const refusedBy = new Map<string, LoopStartRefused>();
  for (const r of Array.isArray(l.startRefused) ? l.startRefused : []) {
    const p = isObj(r) && typeof r.key === 'string' ? parseStartRefused(r) : null;
    if (p) refusedBy.set((r as { key: string }).key, p);
  }
  const loops: LoopItem[] = (Array.isArray(l.loops) ? l.loops : []).filter(isObj).map((v) => {
    const key = str(v.key) ?? `${str(v.scope)}/${str(v.repoKey)}/${str(v.loopId)}`;
    const registry = str(v.state) ?? 'untrusted';
    const reason = str(v.reason);
    const mine = runs.filter((r) => (r.key ? r.key === key : r.loopId === v.loopId)).sort((a, b) => ((b.startedAt ?? '') > (a.startedAt ?? '') ? 1 : -1));
    const e = eff[key];
    return {
      key,
      loopId: str(v.loopId) ?? '?',
      scope: str(v.scope) ?? 'repo',
      repo: str(v.repo) ?? '',
      repoKey: str(v.repoKey) ?? '',
      ...(str(v.title) ? { title: str(v.title) } : {}),
      registry,
      ...(reason ? { reason } : {}),
      state: stateOf(registry, reason, runningBy.has(key)),
      ...(str(v.contentHash) ? { contentHash: str(v.contentHash) } : {}),
      ...(str(v.trustedHash) ? { trustedHash: str(v.trustedHash) } : {}),
      ...(str(v.trustedAt) ? { trustedAt: str(v.trustedAt) } : {}),
      changed: !!str(v.trustedHash) && str(v.trustedHash) !== str(v.contentHash),
      ...(parseShape(v.shape) ? { shape: parseShape(v.shape) } : {}),
      claimed: isObj(v.authoredBy) && v.authoredBy.basis === 'agent-key-claim',
      ...(isObj(e) ? { effective: { declared: str(e.declared), autonomy: str(e.autonomy), level: str(e.level), mode: str(e.mode), paused: e.paused === true, capReason: str(e.capReason) } } : {}),
      ...(runningBy.get(key) ? { runningRun: runningBy.get(key) } : {}),
      ...(refusedBy.get(key) ? { startRefused: refusedBy.get(key) } : {}),
      runs: mine,
    };
  });
  const pausedAll = loops.length > 0 && loops.every((x) => x.state === 'kill-switch' || x.state === 'waiting-trust' || x.state === 'invalid') && loops.some((x) => x.state === 'kill-switch');
  return { loops, uptime: parseUptime(l.uptime), running: loops.filter((x) => x.state === 'running').length, waitingTrust: loops.filter((x) => x.state === 'waiting-trust').length, pausedAll };
}

/** hh:mm of an ISO instant in local time ('' when absent or bad). */
export function hhmm(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** "claimed by arky" (an agent key's claim, registry basis agent-key-claim), else "from the loop file". */
export const authorPhrase = (x: Pick<LoopItem, 'claimed' | 'shape'>): string => (x.claimed && x.shape ? `claimed by ${x.shape.authoredBy}` : 'from the loop file');
/** A loop card's head requester words: the authorship claim or the file, never "by <agent>" as fact; null when unknown. */
export const loopCardHead = (x: Pick<LoopItem, 'claimed' | 'shape'> | undefined): string | null => (x?.shape ? authorPhrase(x) : null);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
export function durText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
const enabledOf = (m: LoopsModel): number => m.uptime?.enabled.n ?? m.loops.filter((x) => x.state === 'idle' || x.state === 'running').length;

// ── the header word (loops-word) and keep-alive line ─────────────────────────────────────────────────────────────

export interface LoopsWord {
  shown: boolean;
  text: string;
  /** the narrow form ('waiting' drops first) */
  narrow: string;
  title: string;
}
export function loopsWord(m: LoopsModel | null): LoopsWord {
  if (!m || m.loops.length === 0) return { shown: false, text: '', narrow: '', title: '' };
  const enabled = enabledOf(m);
  if (m.pausedAll) {
    const n = m.loops.filter((x) => x.state === 'kill-switch').length;
    return { shown: true, text: `loops paused · ${n}`, narrow: `loops paused · ${n}`, title: 'Loops are paused; Gnomon can idle-exit. Resuming needs presence.' };
  }
  if (enabled === 0 && m.waitingTrust === 0) return { shown: false, text: '', narrow: '', title: '' };
  const w = m.waitingTrust;
  const lead = m.running > 0 ? `loops ${m.running}` : `loops idle · ${enabled}`;
  const text = w ? `${lead} · ${w} waiting` : lead;
  const narrow = w ? `${lead} · ${w}` : lead;
  const title = `${m.uptime?.keepingAlive ? `${m.uptime.line ?? 'Gnomon is staying up for loops'} (${enabled} enabled). ` : ''}${text}${w ? ' for trust' : ''}. Click: open Loops.${m.running ? ' Pause all: ⌘K loops: pause all.' : ''}`;
  return { shown: true, text, narrow, title };
}

/** The leaf head's meta ("1 running · 2 waiting for trust"). */
export function leafMeta(m: LoopsModel): string {
  const paused = m.loops.filter((x) => x.state === 'kill-switch' || x.state === 'paused' || x.state === 'kernel-paused').length;
  return [`${m.running} running`, ...(m.pausedAll || paused ? [`${paused} paused`] : []), ...(m.waitingTrust ? [`${m.waitingTrust} waiting for trust`] : [])].join(' · ');
}

/** The keep-alive line under the leaf head, from status.loops.uptime. */
export function keepLine(m: LoopsModel): string {
  if (m.pausedAll) return 'Loops are paused; Gnomon can idle-exit · resuming needs presence';
  const u = m.uptime;
  if (!u || !u.keepingAlive) return 'No loop is keeping Gnomon up; it can idle-exit';
  const next = u.nextDueAt ? ` · next fire ${hhmm(u.nextDueAt)}` : '';
  // the kernel's own words (status.loops.uptime.line), then the counts
  return `${u.line ?? 'Gnomon is staying up for loops'} · ${u.enabled.n} enabled${next}`;
}

/** The folded leaf's edge tab ("loops · 1 running · 2 waiting"). */
export function edgeTab(m: LoopsModel): string {
  if (m.pausedAll) return `loops · paused · ${m.loops.filter((x) => x.state === 'kill-switch').length}`;
  return ['loops', `${m.running} running`, ...(m.waitingTrust ? [`${m.waitingTrust} waiting`] : [])].join(' · ');
}

// ── the list (loop-list, loop-row) ──────────────────────────────────────────────────────────────────────────────

const NEEDS_YOU: ReadonlySet<LoopRowState> = new Set(['waiting-trust', 'kernel-paused', 'waiting-land', 'parked']);
/** A loop needs you when it waits on you, or (TD-2026-10-22-769) when the kernel refuses its start for want of a local model. */
export const needsYou = (x: LoopItem): boolean => NEEDS_YOU.has(x.state) || cantStart(x);
/** The kernel refused this loop's start (status.loops.startRefused, or a Run now refused no-local-model). */
export const cantStart = (x: LoopItem): boolean => !!x.startRefused && x.state !== 'running' && x.state !== 'waiting-trust' && x.state !== 'invalid';

/** The local model words of a start refusal (design-system loop-detail.cant_start; the kernel's why, never inferred). */
export interface StartLine {
  head: string;
  text: string;
  /** the key to the fix: Settings at the Local model section */
  key: string;
  /** Run now's reason, beside the disabled key */
  runWhy: string;
  /** the refused-start alert's path start */
  what: string;
}
const nodesText = (nodes: readonly string[]): string => (nodes.length ? nodes.join(', ') : 'a model step');
export function startLine(sr: LoopStartRefused, model: string | null): StartLine {
  const head = `✕ can’t start · ${sr.code}`;
  switch (sr.why) {
    case 'sessions-only':
      return { head, text: `${model ?? 'The local model'} is set up for sessions only. Let loops use it in Settings.`, key: 'Local model settings…', runWhy: 'Run now needs a local model loops may use', what: 'the local model is for sessions only' };
    case 'no-runner':
      return { head, text: 'The local model has no runner pinned. Change it in Settings and Save to pin the bundled one.', key: 'Local model settings…', runWhy: 'Run now needs the local model’s runner pinned', what: 'the local model has no runner pinned' };
    case 'no-profile':
      return { head, text: `This loop’s model step (${nodesText(sr.modelNodes)}) names a local endpoint that loops can’t use. Check its name in Settings.`, key: 'Local model settings…', runWhy: 'Run now needs the local endpoint its model step names', what: 'no local endpoint matches its model step' };
    default:
      return { head, text: `No local model is set up, and this loop has a model step (${nodesText(sr.modelNodes)}).`, key: 'Set up local model…', runWhy: 'Run now needs a local model', what: 'no local model' };
  }
}

/** A Run now the kernel refused for want of a local model (ENGINE no-local-model {why}), as a start refusal; else null. */
export function runRefusalOf(r: { code: string; reason: string | null; data: Record<string, unknown> | null }, x: Pick<LoopItem, 'shape'>, at: string): LoopStartRefused | null {
  const why = r.data?.why;
  if (r.reason !== 'no-local-model' || typeof why !== 'string' || !START_REFUSED_WHYS.includes(why)) return null;
  return { code: 'no-local-model', why: why as LoopStartRefused['why'], at, since: at, count: 1, trigger: 'manual', modelNodes: (x.shape?.nodes ?? []).filter((n) => n.type === 'model').map((n) => n.id) };
}

/** "18:30" today, else the weekday ("Monday"), for "×3 since Monday". */
export function sinceText(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toDateString() === new Date(now).toDateString() ? hhmm(iso) : d.toLocaleDateString('en-GB', { weekday: 'long' });
}

export const projectOf = (x: Pick<LoopItem, 'repo' | 'scope'>): string => (x.repo ? x.repo.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || x.repo : x.scope === 'personal' ? 'personal' : 'unknown');

const STATE_WORD: Readonly<Record<LoopRowState, string>> = {
  running: 'running',
  idle: 'idle',
  paused: 'paused',
  'kernel-paused': 'kernel-paused',
  'kill-switch': 'paused',
  'waiting-trust': 'waiting for trust',
  'waiting-land': 'waiting to land',
  parked: 'parked',
  invalid: 'invalid',
};
const MARK: Readonly<Record<LoopRowState, string>> = { running: '●', idle: '○', paused: '‖', 'kernel-paused': '‖', 'kill-switch': '‖', 'waiting-trust': '‖', 'waiting-land': '…', parked: '‖', invalid: '✕' };

export const verdictMark = (v: string): string => (v === 'pass' ? '✓' : v === 'fail' || v === 'error' ? '✕' : v === 'unsure' || v === 'unavailable' ? '?' : v === 'waiting' ? '…' : '·');

/** "act", or "act → propose (L2: a-paradigm strictness)" when a cap applies. */
export function autonomyText(x: LoopItem): string {
  const e = x.effective;
  const declared = e?.declared ?? x.shape?.autonomy ?? '';
  if (!e?.autonomy || e.autonomy === declared) return declared;
  return `${declared} → ${e.autonomy}${e.capReason ? ` (${e.capReason})` : e.level ? ` (${e.level})` : ''}`;
}

/** Today's spend against the day caps ("5/12 runs today · 4m/60m compute"). */
export function spendText(x: LoopItem, now: number): string {
  const day = new Date(now).toDateString();
  const today = x.runs.filter((r) => r.startedAt && new Date(r.startedAt).toDateString() === day);
  const caps = x.shape?.budgets.day ?? {};
  const runsCap = typeof caps.runs === 'number' ? caps.runs : null;
  const secCap = typeof caps.computeSec === 'number' ? caps.computeSec : null;
  const usedMin = Math.round(today.reduce((a, r) => a + r.computeMs, 0) / 60_000);
  return `${today.length}${runsCap !== null ? `/${runsCap}` : ''} runs today · ${usedMin}m${secCap !== null ? `/${Math.round(secCap / 60)}m` : ''} compute`;
}

/** The last ended run's outcome ("last ✓ goal", "last ✕ at tests"), or where a running loop is. */
export function lastOutcome(x: LoopItem): string {
  if (x.state === 'running') {
    const r = x.runs[0];
    const at = r?.nodes[r.nodes.length - 1]?.nodeId;
    return at ? `at ${at}` : 'starting';
  }
  const r = x.runs.find((y) => y.endedAt);
  if (!r) return x.state === 'waiting-trust' ? (x.changed ? 'changed' : 'new') : 'no loop run yet';
  if (r.reason === 'goal') return 'last ✓ goal';
  const failed = r.nodes.find((n) => n.verdict === 'fail' || n.verdict === 'error');
  if (failed) return `last ✕ at ${failed.nodeId}`;
  return `last ■ ${r.reason ?? 'ended'}`;
}

/** The right-hand fact: started / since / the trigger words. */
export function nextText(x: LoopItem): string {
  if (x.state === 'running') return `started ${hhmm(x.runs[0]?.startedAt)}`;
  if (x.state === 'waiting-trust') return '';
  return x.shape?.triggers.join(' + ') || 'manual';
}

/** A long loop id keeps its head and tail ("nightly-depen…eve-audit"); the full id goes in title=. */
export function middleEllipsis(s: string, max = 36): string {
  const c = [...s];
  if (c.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  return `${c.slice(0, head).join('')}…${c.slice(c.length - (max - 1 - head)).join('')}`;
}

export interface LoopRowView {
  key: string;
  mark: string;
  name: string;
  l1: string;
  nx: string;
  l2: string;
  title: string;
  swatch: boolean;
  project: string;
}
export function loopRow(x: LoopItem, pinned: boolean, now: number): LoopRowView {
  const state = x.state === 'kill-switch' ? 'paused · kill switch' : x.state === 'kernel-paused' ? `kernel-paused · ${x.reason ?? ''}`.replace(/ · $/, '') : x.state === 'paused' && x.reason ? `paused · ${x.reason}` : STATE_WORD[x.state];
  if (cantStart(x)) {
    const sr = x.startRefused!;
    const project = projectOf(x);
    const l1c = 'can’t start';
    const l2c = `${pinned ? `${project} · ` : ''}needs a local model (${nodesText(sr.modelNodes)}) · ${autonomyText(x)} · ${x.shape ? authorPhrase(x) : 'from the loop file'}`;
    const nxc = `since ${hhmm(sr.since)}`;
    return { key: x.key, mark: pinned ? '◆' : '✕', name: middleEllipsis(x.loopId), l1: l1c, nx: nxc, l2: l2c, title: `${x.loopId} · ${l1c} · ${startLine(sr, null).what} · ${nxc}\n${l2c}`, swatch: pinned, project };
  }
  const l1 = x.state === 'waiting-trust' ? `waiting for trust${x.shape ? ` · ${authorPhrase(x)}` : ''} · ${x.changed ? 'changed' : 'new'}` : `${state} · ${lastOutcome(x)}`;
  const facts: string[] = [];
  if (x.state === 'waiting-trust') facts.push(x.changed ? 'change waits for trust' : 'new · inert until trusted');
  else if (x.state === 'kernel-paused' || x.state === 'kill-switch') facts.push('resume needs presence');
  else facts.push(spendText(x, now));
  facts.push('local only');
  const auto = autonomyText(x);
  if (auto) facts.push(auto);
  if (x.shape?.land?.length) facts.push(`lands ${x.shape.land.join(', ')}`);
  if (x.shape && x.state !== 'waiting-trust') facts.push(authorPhrase(x));
  const project = projectOf(x);
  const l2 = `${pinned ? `${project} · ` : ''}${facts.join(' · ')}`;
  const nx = nextText(x);
  return { key: x.key, mark: pinned ? '◆' : MARK[x.state], name: middleEllipsis(x.loopId), l1, nx, l2, title: `${x.loopId} · ${l1}${nx ? ` · ${nx}` : ''}\n${l2}`, swatch: pinned, project };
}

export interface LoopGroup {
  head: string;
  /** the project's repo (for the swatch hue); null for the pinned group */
  repo: string | null;
  rows: LoopRowView[];
}
/** The pinned "needs you" group, then one group per project (a loop may show twice). */
export function loopGroups(m: LoopsModel, now: number): LoopGroup[] {
  const out: LoopGroup[] = [];
  const pinned = m.loops.filter(needsYou);
  if (pinned.length) out.push({ head: 'needs you', repo: null, rows: pinned.map((x) => loopRow(x, true, now)) });
  const by = new Map<string, LoopItem[]>();
  for (const x of m.loops) {
    const k = x.repo || x.scope;
    by.set(k, [...(by.get(k) ?? []), x]);
  }
  for (const [repo, xs] of [...by.entries()].sort((a, b) => projectOf({ repo: a[0], scope: '' }).localeCompare(projectOf({ repo: b[0], scope: '' })))) {
    out.push({ head: projectOf(xs[0]!), repo, rows: xs.map((x) => loopRow(x, false, now)) });
  }
  return out;
}

// ── the detail head (loop-detail, steer-stop) ──────────────────────────────────────────────────────────────────

export type LoopAct = 'trust' | 'run' | 'pause' | 'resume' | 'untrust' | 'delete';
export interface LoopKey {
  act: LoopAct;
  label: string;
  pri?: boolean;
  quiet?: boolean;
  disabled?: string;
  /** behind ⋯ */
  more?: boolean;
}
export function detailKeys(x: LoopItem): { chip: string; keys: LoopKey[]; why: string | null } {
  const keys: LoopKey[] = [];
  let why: string | null = null;
  const trusted = !!x.trustedHash;
  if (x.state === 'waiting-trust') {
    keys.push({ act: 'trust', label: x.changed ? 'Review change' : 'Review', pri: true });
    keys.push({ act: 'run', label: 'Run now', disabled: 'Run now waits for trust' });
    why = 'Run now waits for trust';
  } else if (x.state === 'running') {
    keys.push({ act: 'run', label: 'Run now', disabled: 'Run now waits for this loop run to end' }, { act: 'pause', label: 'Pause' });
    why = 'Run now waits for this loop run to end';
  } else if (x.state === 'kernel-paused' || x.state === 'kill-switch') {
    keys.push({ act: 'resume', label: 'Resume · presence', pri: x.state === 'kernel-paused' });
  } else if (x.state === 'paused') {
    keys.push({ act: 'resume', label: 'Resume' });
  } else if (x.state === 'invalid') {
    why = 'this loop does not compile: paradigm loop validate';
  } else if (cantStart(x)) {
    // TD-2026-10-22-769: Run now says why in words (the kernel's why), and the can't-start line holds the fix
    why = startLine(x.startRefused!, null).runWhy;
    keys.push({ act: 'run', label: 'Run now', pri: true, disabled: why }, { act: 'pause', label: 'Pause' });
  } else {
    keys.push({ act: 'run', label: 'Run now', pri: true }, { act: 'pause', label: 'Pause' });
  }
  if (trusted) keys.push({ act: 'untrust', label: 'Untrust', quiet: true });
  keys.push({ act: 'delete', label: 'Delete', quiet: true, more: true });
  const chip = cantStart(x) && x.state === 'idle' ? 'idle · can’t start' : x.state === 'running' ? `running · ${lastOutcome(x)}` : x.state === 'waiting-trust' ? (x.changed ? 'waiting for trust · change' : 'waiting for trust · new') : loopRow(x, false, Date.now()).l1.split(' · ').slice(0, 2).join(' · ');
  return { chip, keys, why };
}

/** The request a detail key sends (log.append; the kernel stamps the human asker and asks presence where needed). */
export function loopRequest(x: Pick<LoopItem, 'loopId' | 'scope' | 'repoKey' | 'contentHash'>, act: LoopAct): { kind: string; payload: Record<string, unknown> } {
  const target = { loopId: x.loopId, scope: x.scope, repoKey: x.repoKey };
  return { kind: `request.loop.${act}`, payload: act === 'trust' ? { ...target, contentHash: x.contentHash } : target };
}
/** The kill switch (CLIENT_API loops.killSwitch). */
export const PAUSE_ALL_REQUEST = Object.freeze({ kind: 'request.loop.pause', payload: Object.freeze({ all: true }) });

// ── budgets (budget-field) ──────────────────────────────────────────────────────────────────────────────────────

export interface BudgetField {
  path: string;
  label: string;
  value: number;
}
export function budgetFields(x: LoopItem): BudgetField[] {
  const b = x.shape?.budgets;
  if (!b) return [];
  const out: BudgetField[] = [];
  const add = (scope: 'run' | 'day', k: string, label: string): void => {
    const v = b[scope][k];
    if (typeof v === 'number') out.push({ path: `${scope}.${k}`, label, value: v });
  };
  add('run', 'rounds', 'run · rounds');
  add('run', 'wallMin', 'run · minutes');
  add('run', 'computeSec', 'run · compute s');
  add('day', 'runs', 'day · runs');
  add('day', 'computeSec', 'day · compute s');
  return out;
}
/** The request a tightened budget sends (request.loop.budget, narrowing only). */
export function budgetRequest(x: Pick<LoopItem, 'loopId' | 'scope' | 'repoKey'>, path: string, value: number): { kind: string; payload: Record<string, unknown> } {
  const [scope, field] = path.split('.') as [string, string];
  return { kind: 'request.loop.budget', payload: { loopId: x.loopId, scope: x.scope, repoKey: x.repoKey, budgets: { [scope]: { [field]: value } } } };
}
export function budgetKey(old: number, typed: string): { label: string; enabled: boolean; note: string; dir: 'same' | 'tighter' | 'looser' | 'bad' } {
  const v = Number(typed);
  if (!/^\d+$/.test(typed.trim()) || !Number.isFinite(v) || v <= 0) return { label: 'Save', enabled: false, note: 'a whole number above 0', dir: 'bad' };
  if (v === old) return { label: 'Save', enabled: false, note: 'no change', dir: 'same' };
  if (v < old) return { label: 'Apply · tighter', enabled: true, note: 'applies now, no card', dir: 'tighter' };
  return { label: 'Loosen · needs trust', enabled: false, note: 'a higher cap is a change to the loop file: it raises a loop-trust card, and the old cap holds until you trust it', dir: 'looser' };
}

// ── the last loop run (run-trace) and run paths ─────────────────────────────────────────────────────────────────

export interface TraceLine {
  tm: string;
  mark: string;
  cls: '' | 'fail' | 'unsure';
  node: string;
  what: string;
  dur: string;
}
export function runTrace(r: LoopRun | undefined): TraceLine[] {
  if (!r) return [];
  return r.nodes.map((n) => {
    const at = n.at ? new Date(n.at) : null;
    const tm = at && !Number.isNaN(at.getTime()) ? `${hhmm(n.at)}:${String(at.getSeconds()).padStart(2, '0')}` : '';
    const mark = verdictMark(n.verdict);
    return { tm, mark, cls: mark === '✕' ? 'fail' : mark === '?' ? 'unsure' : '', node: n.nodeId, what: [n.verdict || 'waiting', n.round ? `round ${n.round}` : '', n.edge ? `→ ${n.next ?? n.edge}` : ''].filter(Boolean).join(' · '), dur: n.durationMs !== undefined ? durText(n.durationMs) : '' };
  });
}

/** A run's path with marks: "tsc ✕ → fix ×3 → tsc ✕ → @stop" (consecutive repeats fold; long paths keep the ends). */
export function runPath(r: LoopRun | undefined): string {
  if (!r || !r.nodes.length) return '';
  const steps: Array<{ id: string; mark: string; n: number }> = [];
  for (const n of r.nodes) {
    const m = verdictMark(n.verdict);
    const last = steps[steps.length - 1];
    if (last && last.id === n.nodeId && last.mark === m) last.n++;
    else steps.push({ id: n.nodeId, mark: m, n: 1 });
  }
  const parts = steps.map((s) => (s.n > 1 ? `${s.id} ×${s.n}` : `${s.id} ${s.mark}`));
  const end = r.reason && r.reason !== 'goal' ? `@${r.reason === 'stop' ? 'stop' : r.reason}` : r.reason === 'goal' ? '@goal' : '';
  const all = end ? [...parts, end] : parts;
  return (all.length > 7 ? [...all.slice(0, 2), '…', ...all.slice(-4)] : all).join(' → ');
}

// ── stack alerts (alert) and the trust slip (trust-slip) ────────────────────────────────────────────────────────

export interface LoopAlert {
  id: string;
  kind: 'fail' | 'stop' | 'kernel-pause' | 'refused-start';
  key: string;
  loopId: string;
  project: string;
  repo: string;
  at: string;
  title: string;
  path: string;
  runId?: string;
  /** refused-start: the key to the fix (Settings at the Local model section) instead of Open run */
  fix?: string;
}
/** Loops stuck and still needing you: the latest loop run failed or was stopped by a limit, or the kernel paused it. */
export function loopAlerts(m: LoopsModel | null, dismissed: ReadonlySet<string>, now: number = Date.now()): LoopAlert[] {
  if (!m) return [];
  const out: LoopAlert[] = [];
  for (const x of m.loops) {
    const project = projectOf(x);
    // TD-2026-10-22-769 (Mika F4): one alert per loop whose fires are refused for want of a local model; it clears
    // when the kernel drops the refusal (a config that serves it applied). Dismissing keys on the streak's start.
    const sr = x.startRefused;
    if (sr) {
      const id = `refused:${x.key}:${sr.since}`;
      if (!dismissed.has(id)) {
        const sl = startLine(sr, null);
        const when = sr.trigger === 'schedule' ? `scheduled ${hhmm(sr.at)}` : `${sr.trigger} ${hhmm(sr.at)}`;
        // count 0: nothing has fired yet, but the kernel would refuse it now
        if (sr.count === 0) out.push({ id, kind: 'refused-start', key: x.key, loopId: x.loopId, project, repo: x.repo, at: hhmm(sr.since), title: `■ ${x.loopId} can’t start`, path: `${sl.what} · nothing has fired yet · a fire is refused before any step`, fix: sl.key });
        else out.push({ id, kind: 'refused-start', key: x.key, loopId: x.loopId, project, repo: x.repo, at: hhmm(sr.at), title: `■ ${x.loopId} didn’t start`, path: `${sl.what} · ${when} · refused before any step${sr.count > 1 ? ` · ×${sr.count} since ${sinceText(sr.since, now)}` : ''}`, fix: sl.key });
      }
    }
    if (x.state === 'kernel-paused') {
      const id = `pause:${x.key}:${x.reason ?? ''}`;
      if (!dismissed.has(id)) out.push({ id, kind: 'kernel-pause', key: x.key, loopId: x.loopId, project, repo: x.repo, at: hhmm(x.runs[0]?.endedAt), title: `‖ ${x.loopId} paused by the kernel: ${x.reason ?? 'paused'}`, path: runPath(x.runs[0]), ...(x.runs[0] ? { runId: x.runs[0].runId } : {}) });
      continue;
    }
    if (x.state === 'running') continue;
    const r = x.runs.find((y) => y.endedAt);
    if (!r || dismissed.has(r.runId) || QUIET_ENDS.has(r.reason ?? '')) continue;
    const failed = r.nodes.find((n) => n.verdict === 'fail' || n.verdict === 'error');
    if (failed && !STOP_ENDS.has(r.reason ?? '')) out.push({ id: r.runId, kind: 'fail', key: x.key, loopId: x.loopId, project, repo: x.repo, at: hhmm(r.endedAt), title: `✕ ${x.loopId} failed at ${failed.nodeId}`, path: runPath(r), runId: r.runId });
    else if (STOP_ENDS.has(r.reason ?? '')) out.push({ id: r.runId, kind: 'stop', key: x.key, loopId: x.loopId, project, repo: x.repo, at: hhmm(r.endedAt), title: `■ ${x.loopId} stopped: ${r.reason === 'budget' ? `${plural(r.rounds, 'round')} used, a budget cap reached` : r.reason}`, path: runPath(r), runId: r.runId });
  }
  return out;
}

export interface SlipLine {
  key: string;
  loopId: string;
  text: string;
}
/** Loops waiting for trust with no loop-trust card yet (the slip at the stack's foot; hidden at 0). */
export const SLIP_MAX = 3;
export function trustSlip(m: LoopsModel | null, cardLoopIds: ReadonlySet<string>): { tab: string; lines: SlipLine[]; more: number } | null {
  if (!m) return null;
  const lines = m.loops
    .filter((x) => x.state === 'waiting-trust' && !cardLoopIds.has(x.loopId))
    .map((x) => ({ key: x.key, loopId: x.loopId, text: `${x.loopId} · ${x.changed ? 'changed' : 'new'}${x.shape ? ` · ${authorPhrase(x)}` : ''}` }));
  if (!lines.length) return null;
  return { tab: `↻ ${plural(lines.length, 'loop')} waiting for trust · no card yet`, lines: lines.slice(0, SLIP_MAX), more: Math.max(0, lines.length - SLIP_MAX) };
}

// ── toasts (toast loop-done) and live rows ──────────────────────────────────────────────────────────────────────

export interface LoopToast {
  tag: string;
  text: string;
  runId?: string;
  key?: string;
}
/**
 * A live loop row as a toast, or null: goal reached and landed (loop-done, 6 s), and a notify node's toast
 * (`loop.notified{as:'toast'}`). A notify `as:'card'` raises a card (the stack shows it); trouble is a stack alert.
 */
export function loopRowToast(row: { kind?: string; payload?: unknown }, m: LoopsModel | null): LoopToast | null {
  const p = isObj(row.payload) ? row.payload : {};
  const loopId = str(p.loopId);
  if (!loopId) return null;
  const x = m?.loops.find((y) => y.loopId === loopId);
  const project = x ? projectOf(x) : '';
  const runId = str(p.runId);
  const run = x?.runs.find((r) => r.runId === runId);
  const base = { tag: `↻ loop · ${loopId}`, ...(runId ? { runId } : {}), ...(x ? { key: x.key } : {}) };
  if (row.kind === 'loop.run.ended' && p.reason === 'goal') return { ...base, text: `reached its goal${project ? ` on ${project}` : ''}${run?.startedAt && run.endedAt ? ` · ${durText(Date.parse(run.endedAt) - Date.parse(run.startedAt))}` : ''}` };
  // step 11: a land writes loop.landed{phase:'intent'} BEFORE it moves the ref and {phase:'done'} after; only done landed
  if (row.kind === 'loop.landed' && p.phase === 'done') return { ...base, text: `landed ${String(str(p.sha) ?? '').slice(0, 7)}${project ? ` on ${project}` : ''}` };
  if (row.kind === 'loop.notified' && p.as !== 'card') return { ...base, text: `${str(p.nodeId) ?? 'notify'}: the loop run has news${project ? ` on ${project}` : ''}` };
  return null;
}

/** The pause-all confirmation (toast loop-pause-all). */
export function pauseAllText(stopped: number): string {
  return `paused ${plural(stopped, 'loop')}${stopped ? ' · a running check was stopped and its scratch work parked' : ''} · resuming needs presence`;
}

// ── the unfolded trust card (loop-trust-unfolded, loop-diff, loop-listing) ──────────────────────────────────────

export interface TrustSection {
  head: string;
  lines: Array<{ cls: 'add' | 'del' | 'ctx' | 'fold' | 'gate'; text: string }>;
}
/** The kernel's loop-trust lines, sectioned in the card's reading order (what changed first, then the listing). */
export function trustSections(lines: readonly string[]): TrustSection[] {
  const changed: TrustSection = { head: 'what changed', lines: [] };
  const does: TrustSection = { head: 'does · the ordered listing', lines: [] };
  const when: TrustSection = { head: 'runs when', lines: [] };
  const spends: TrustSection = { head: 'spends at most', lines: [] };
  const lands: TrustSection = { head: 'lands and protects', lines: [] };
  const about: TrustSection = { head: 'this loop', lines: [] };
  let gateNoted = false;
  let inDiff = false;
  let inNode = false;
  for (const l of lines) {
    if (/^Change[sd] since the trusted version/.test(l)) {
      inDiff = true;
      changed.lines.push({ cls: 'fold', text: l });
      continue;
    }
    if (inDiff && /^[-+] /.test(l)) {
      changed.lines.push({ cls: l.startsWith('+') ? 'add' : 'del', text: `${l.startsWith('+') ? '+' : '−'} ${l.slice(2)}` });
      if (/Land paths|Protected/.test(l) && !gateNoted) {
        gateNoted = true;
        changed.lines.push({ cls: 'gate', text: 'a land path or protected input changed: gate-class paths still land only through a card' });
      }
      continue;
    }
    inDiff = false;
    if (/^Node /.test(l)) {
      inNode = true;
      does.lines.push({ cls: 'ctx', text: l });
    } else if (inNode && /^ {2}/.test(l)) does.lines.push({ cls: 'ctx', text: l });
    else if (/^Triggers:/.test(l)) when.lines.push({ cls: 'ctx', text: l });
    else if (/^Budgets:|^Model:/.test(l)) spends.lines.push({ cls: 'ctx', text: l });
    else if (/^Land|^Protected|^Goal:/.test(l)) lands.lines.push({ cls: /gate-class/.test(l) ? 'gate' : 'ctx', text: l });
    else {
      inNode = false;
      about.lines.push({ cls: 'ctx', text: l });
    }
  }
  return [about, changed, does, when, spends, lands].filter((s) => s.lines.length);
}

export interface CardLoop {
  loopId: string;
  scope?: string;
  repoKey?: string;
  authoredBy?: string;
  runId?: string;
  nodeId?: string;
  /** a loop-trust card for a change (the kernel's root-rows detail names the previous hash) */
  changed?: boolean;
  /** a loop-choice card asking to resume after a kernel pause */
  resume?: boolean;
  /** the kernel's first line (the card's own title) */
  kernelLine?: string;
}

const LOOP_ID = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
// the kernel's loopClampLine: "(claimed by <agent>)" or "(from the loop file)" (older builds: "(authored by …)")
const RAISED_RE = new RegExp(`^Raised by loop (${LOOP_ID}) \\((?:(?:authored|claimed) by ([^)]{1,80})|from the loop file)\\)$`);
const RESUME_RE = new RegExp(`^Resume loop (${LOOP_ID})\\?$`);
const TRUST_RE = new RegExp(`^Trust loop (${LOOP_ID}) \\(`);

/** The kernel's Text lines of a card block, in order. */
export function blockTextLines(block: unknown): string[] {
  const out: string[] = [];
  const kids = isObj(block) && Array.isArray(block.children) ? block.children : [];
  for (const k of kids) if (isObj(k) && k.type === 'Text' && typeof k.text === 'string') out.push(...k.text.split('\n'));
  return out;
}

/**
 * Which loop a card:v1 loop card is about. card:v1 carries no top-level detail (broker.ts raise): a loop-trust card's
 * root-rows node carries the kernel's hashed detail (loopId, scope, repoKey, previousHash); a loop-choice card is
 * joined to the kernel's loop.notified{cardId} row, else read from the kernel's own first line (loopClampLine, or the
 * resume card's "Resume loop <id>?").
 */
export function cardLoopOf(card: Record<string, unknown>, notified?: ReadonlyMap<string, { loopId: string; runId?: string; nodeId?: string }>): CardLoop | null {
  const block = card.block;
  const kids = isObj(block) && Array.isArray(block.children) ? block.children : [];
  const lines = blockTextLines(block);
  const kernelLine = lines[0];
  const rr = kids.find((k): k is Record<string, unknown> => isObj(k) && k.type === 'root-rows' && isObj(k.detail));
  const d = rr && isObj(rr.detail) ? rr.detail : null;
  if (d && typeof d.loopId === 'string') return { loopId: d.loopId, ...(str(d.scope) ? { scope: str(d.scope) } : {}), ...(str(d.repoKey) ? { repoKey: str(d.repoKey) } : {}), changed: typeof d.previousHash === 'string', ...(kernelLine ? { kernelLine } : {}) };
  const n = typeof card.cardId === 'string' ? notified?.get(card.cardId) : undefined;
  const raised = kernelLine ? RAISED_RE.exec(kernelLine) : null;
  if (n) return { loopId: n.loopId, ...(n.runId ? { runId: n.runId } : {}), ...(n.nodeId ? { nodeId: n.nodeId } : {}), ...(raised ? { authoredBy: (raised[2] ?? 'file') } : {}), ...(kernelLine ? { kernelLine } : {}) };
  if (raised) {
    const run = lines.find((l) => /^Run \S+$/.test(l));
    return { loopId: raised[1]!, authoredBy: (raised[2] ?? 'file')!, ...(run ? { runId: run.slice(4) } : {}), kernelLine: kernelLine! };
  }
  const resume = kernelLine ? RESUME_RE.exec(kernelLine) : null;
  if (resume) return { loopId: resume[1]!, resume: true, kernelLine: kernelLine! };
  const trust = kernelLine ? TRUST_RE.exec(kernelLine) : null;
  return trust ? { loopId: trust[1]!, kernelLine: kernelLine! } : null;
}

/** A loop card's title sentence (design-system card variants): never the kind word. */
export function loopCardTitle(kind: string, cl: CardLoop | null, m: LoopsModel | null): string | null {
  if (!cl) return null;
  if (kind === 'loop-trust') return cl.changed ? `Trust the change to ${cl.loopId}` : `Trust ${cl.loopId}`;
  if (cl.resume) return cl.kernelLine ?? `Resume loop ${cl.loopId}?`;
  const run = m?.loops.find((x) => x.loopId === cl.loopId)?.runs.find((r) => r.runId === cl.runId);
  const prev = run?.nodes.filter((n) => n.nodeId !== cl.nodeId).at(-1);
  if (prev?.verdict) return `${cl.loopId}: ${prev.nodeId} is ${prev.verdict === 'unavailable' ? 'unavailable' : prev.verdict === 'pass' ? 'passing' : prev.verdict === 'fail' ? 'failing' : prev.verdict}`;
  return `${cl.loopId}: ${cl.nodeId ?? 'a decide node'} asks you to continue or stop`;
}

/** A loop-choice card's run path, ending at the node that asks. */
export function choicePath(cl: CardLoop | null, m: LoopsModel | null): string {
  if (!cl || cl.resume) return '';
  const run = m?.loops.find((x) => x.loopId === cl.loopId)?.runs.find((r) => r.runId === cl.runId);
  if (!run) return '';
  const p = runPath({ ...run, reason: undefined } as LoopRun);
  return cl.nodeId ? `${p}${p ? ' → ' : ''}${cl.nodeId} …` : p;
}
