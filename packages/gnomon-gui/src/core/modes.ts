/**
 * @symbol #gui
 *
 * #gui run-mode control (spec §11.4 "Strictness and run-mode control", §11.5
 * `⇧Tab`, §3.4 run modes; P8-D86/D87). PURE.
 *
 *   - The control's state comes ONLY from the kernel: `status.runModes`
 *     (per live session: chosen, source, ceiling, effective, a pending
 *     loosening card) — never from a mod or the page's own guess. The page
 *     re-reads status when an `approval.mode.set`, `request.mode.set` or
 *     `session.open` row arrives (motion-on-events: no polling).
 *   - `planChange` says what a choice does before it is sent: `same`,
 *     `tighten` (applies on the click, no presence), `loosen` (the kernel
 *     raises a strictness card the page decides in the same gesture, which
 *     takes Touch ID) or `blocked` (over the ceiling: shown disabled with its
 *     reason, `ceiling ask at L2`).
 *   - `⇧Tab` cycles manual → ask → auto-edits → manual (`nextRunMode`).
 *   - The request is `log.append{kind:'request.mode.set', payload:{hsid, to}}`
 *     (focused session) or `{repo, to}` (its repo, the palette's `mode.repo.*`).
 *   - SCOPE (TD-2026-10-20-086 F2): the switch and ⇧Tab default to the FOLDER
 *     (the repo, labelled "this folder"), so a new session in the same folder
 *     starts in the mode already chosen there (repo modes persist: the kernel
 *     folds them from kernel-signed rows). "This session only" stays as the
 *     secondary choice; a session that already has its own mode keeps
 *     session scope (`defaultScope`), so the switch always moves what the
 *     session actually runs under.
 */
import { RUN_MODES, type RunMode } from '@a-company/gnomon-contracts';

export { RUN_MODES, type RunMode };

const RANK: Readonly<Record<RunMode, number>> = Object.freeze({ manual: 0, ask: 1, 'auto-edits': 2 });

export function isRunMode(v: unknown): v is RunMode {
  return (RUN_MODES as readonly unknown[]).includes(v);
}

/** The ⇧Tab cycle, as in Claude Code: manual → ask → auto-edits → manual. */
export function nextRunMode(m: RunMode): RunMode {
  return m === 'manual' ? 'ask' : m === 'ask' ? 'auto-edits' : 'manual';
}

export interface SessionModeView {
  hsid: string;
  repo: string | null;
  chosen: RunMode;
  source: string;
  /** the folder's (repo's) mode, or the default — what a folder-scope choice changes (F2) */
  repoMode: RunMode;
  ceiling: RunMode;
  effective: RunMode;
  level: string | null;
  pendingCardId: string | null;
}

/** The focused session's mode from `status.runModes.sessions[]`, or null (unknown session, older kernel, no status). */
export function sessionModeOf(status: unknown, hsid: string | null): SessionModeView | null {
  if (!hsid || !status || typeof status !== 'object') return null;
  const rm = (status as { runModes?: unknown }).runModes;
  if (!rm || typeof rm !== 'object') return null;
  const list = (rm as { sessions?: unknown }).sessions;
  if (!Array.isArray(list)) return null;
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (o.hsid !== hsid) continue;
    // fail safe: an unknown value reads as manual (contracts failSafeRunMode), never a looser one
    const m = (v: unknown): RunMode => (isRunMode(v) ? v : 'manual');
    return {
      hsid,
      repo: typeof o.repo === 'string' ? o.repo : null,
      chosen: m(o.chosen),
      source: typeof o.source === 'string' ? o.source : '?',
      repoMode: isRunMode(o.repoMode) ? o.repoMode : m(o.chosen),
      ceiling: m(o.ceiling),
      effective: m(o.effective),
      level: typeof o.level === 'string' ? o.level : null,
      pendingCardId: typeof o.pendingCardId === 'string' ? o.pendingCardId : null,
    };
  }
  return null;
}

export type ModeChange = { kind: 'same' } | { kind: 'tighten' } | { kind: 'loosen' } | { kind: 'blocked'; reason: string };

/** What choosing `to` does from this view (the menu labels and the ⇧Tab step use it). */
export function planChange(v: Pick<SessionModeView, 'chosen' | 'ceiling' | 'level'>, to: RunMode): ModeChange {
  if (RANK[to] > RANK[v.ceiling]) return { kind: 'blocked', reason: `ceiling ${v.ceiling}${v.level ? ` at ${v.level}` : ''}` };
  if (to === v.chosen) return { kind: 'same' };
  return RANK[to] < RANK[v.chosen] ? { kind: 'tighten' } : { kind: 'loosen' };
}

/** The header control's label: `mode: ask ▾`, with the effective mode when the ceiling clamps the chosen one. */
export function modeLabel(v: SessionModeView | null): string {
  if (!v) return 'mode: —';
  const clamp = v.effective !== v.chosen ? ` → ${v.effective} (ceiling)` : '';
  // F3 (TD-2026-10-20-086): the folder runs the root-signed default because no mode was chosen for it
  const dflt = v.source === 'config' ? ' (default)' : '';
  return `mode: ${v.chosen}${dflt}${clamp}${v.pendingCardId ? ' · Touch ID pending' : ''} ▾`;
}

/**
 * fidelity 2: the compact run-mode chip in the chat header (`ask ▾`): modeLabel without its `mode: ` prefix, so a
 * clamp, a config default or a pending Touch ID still shows (kernel-owned: never shortened past what is true).
 */
export function modeChip(v: SessionModeView | null): string {
  return v ? modeLabel(v).replace(/^mode: /, '') : 'mode: —';
}

/** One line per mode for the menu: what it does, and why it is disabled when it is. */
export const MODE_HELP: Readonly<Record<RunMode, string>> = Object.freeze({
  manual: 'writes and commands wait on an approved plan',
  ask: 'every write and command raises a card',
  'auto-edits': 'file edits in this folder pass with no card; commands, network and protected files still ask',
});

export function menuEntries(v: SessionModeView, scope: ModeScope = defaultScope(v)): Array<{ mode: RunMode; current: boolean; disabled: boolean; note: string }> {
  return RUN_MODES.map((mode) => {
    const c = planFor(v, mode, scope);
    return {
      mode,
      current: c.kind === 'same',
      disabled: c.kind === 'blocked',
      note: c.kind === 'blocked' ? c.reason : c.kind === 'loosen' ? `${MODE_HELP[mode]} · needs Touch ID` : MODE_HELP[mode],
    };
  });
}

export type ModeScope = 'session' | 'repo';

/** What each scope is called in the switch (F2: the folder is the default and first). */
export const SCOPE_LABEL: Readonly<Record<ModeScope, string>> = Object.freeze({ repo: 'this folder', session: 'this session only' });

/**
 * F2 (TD-2026-10-20-086): the switch's scope. The folder (repo) unless the session has no repo, or already runs
 * under a mode of its own (then a folder choice would not move it, so the switch stays on the session).
 */
export function defaultScope(v: Pick<SessionModeView, 'repo' | 'source'> | null): ModeScope {
  return v && v.repo && v.source !== 'session' ? 'repo' : 'session';
}

/** planChange for a scope: a folder choice is measured from the folder's mode, a session one from the session's. */
export function planFor(v: Pick<SessionModeView, 'chosen' | 'repoMode' | 'ceiling' | 'level'>, to: RunMode, scope: ModeScope): ModeChange {
  return planChange(scope === 'repo' ? { ...v, chosen: v.repoMode } : v, to);
}

/** The `log.append` params of a mode request: the session's own mode, or (scope repo, the default when it has one) its folder's. */
export function modeRequest(v: Pick<SessionModeView, 'hsid' | 'repo'>, to: RunMode, scope: ModeScope = v.repo ? 'repo' : 'session'): { kind: 'request.mode.set'; payload: { hsid: string; to: RunMode } | { repo: string; to: RunMode } } | null {
  if (scope === 'repo') return v.repo ? { kind: 'request.mode.set', payload: { repo: v.repo, to } } : null;
  return { kind: 'request.mode.set', payload: { hsid: v.hsid, to } };
}

/** The menu's scope line and its secondary entry (F2): which scope the choices apply to, and the other one. */
export function scopeEntries(v: SessionModeView): { heading: string; other: { scope: ModeScope; label: string } | null } {
  const scope = defaultScope(v);
  const heading = scope === 'repo' ? `for ${SCOPE_LABEL.repo} (new sessions here start in it)` : v.repo ? `for ${SCOPE_LABEL.session} (it has its own mode)` : `for ${SCOPE_LABEL.session}`;
  const other: ModeScope | null = scope === 'repo' ? 'session' : v.repo ? 'repo' : null;
  return { heading, other: other ? { scope: other, label: `set for ${SCOPE_LABEL[other]} instead…` } : null };
}

/** Rows whose arrival changes what status.runModes says (the page re-reads status on them). */
export const MODE_ROW_KINDS: ReadonlySet<string> = new Set(['approval.mode.set', 'request.mode.set', 'session.open', 'session.exited']);
