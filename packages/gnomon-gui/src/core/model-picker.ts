/**
 * @symbol #gui-model-picker
 *
 * #gui-model-picker (founder ask 2026-10-20: "is there no way to change the model of what claude is in the tool?").
 * PURE: what the New-session picker sends, what the page remembers, which model a session runs now and what the
 * mid-session switch asks. The DOM side is ui/model-picker.ts.
 *
 *   - Choices: the aliases the installed claude accepts (contracts CLAUDE_MODEL_ALIASES; `claude --help` 2.1.304),
 *     plus "custom" (a full id the founder types, checked with contracts claudeModelProblem before anything is sent;
 *     the kernel checks again).
 *   - session.open{model}: route `local` sends model:'local' (the local lane), `any` sends 'any'; route `claude`
 *     sends the alias / id, or 'claude' for `default` (Claude Code chooses; no --model).
 *   - Memory: the last choice per folder (localStorage `gnomon.model.byFolder`, ≤ 64 folders, oldest dropped) and
 *     the last choice overall (`gnomon.model.last`) for a new folder. A value that fails the check is never restored.
 *   - The session's model: the kernel's rows only — the last `session.model{outcome:'switched'|'reconciled'}.to`,
 *     else `session.open.model` ('claude' = the default). A `timeout` outcome leaves the model UNCONFIRMED (the
 *     kernel keeps the old one on record) until its `reconciled` row says which model actually answered: the chip
 *     reads "model: switching… (unconfirmed)" meanwhile (modelChipText) — never after the session ended (no reconcile can
 *     come then: the model on record is shown, Aegis L2).
 *   - The switch: `log.append{kind:'request.session.model', payload:{hsid, model}}` (human, first-party connection;
 *     the kernel sends Claude Code's `set_model` control request into the SAME process, so the conversation and its
 *     context continue; nothing restarts).
 */
import { CLAUDE_MODEL_ALIASES, claudeModelProblem } from '@a-company/gnomon-contracts';

export const MODEL_BY_FOLDER_KEY = 'gnomon.model.byFolder';
export const MODEL_LAST_KEY = 'gnomon.model.last';
export const MAX_FOLDERS = 64;
export const CUSTOM = 'custom' as const;
export const MODEL_REQUEST = 'request.session.model' as const;

/** The picker's options: the aliases, then "custom". `default` first (Claude Code chooses). */
export const MODEL_CHOICES: readonly string[] = Object.freeze([...CLAUDE_MODEL_ALIASES, CUSTOM]);

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Human label of a model value ('claude' and 'default' read "default"). */
export function modelLabel(m: string | null | undefined): string {
  return !m || m === 'claude' || m === 'default' ? 'default' : m;
}

/** null = valid model for the claude route; else the reason (never echoes the value). */
export function pickerProblem(choice: string, custom: string): string | null {
  if (choice !== CUSTOM) return (CLAUDE_MODEL_ALIASES as readonly string[]).includes(choice) ? null : 'pick a model';
  const v = custom.trim();
  if (!v) return 'type a model id, e.g. claude-opus-5-5';
  return claudeModelProblem(v);
}

/** The session.open `model` value for a route (claude | local | any) and the picker's choice. */
export function openModelOf(route: string, choice: string, custom: string): string {
  if (route === 'local' || route === 'any') return route;
  if (choice === CUSTOM) return custom.trim();
  return choice === 'default' ? 'claude' : choice;
}

function readMap(st: StorageLike): Record<string, string> {
  try {
    const v = JSON.parse(st.getItem(MODEL_BY_FOLDER_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The remembered choice for a folder: {choice, custom}; a stored value that fails the check is ignored. */
export function rememberedChoice(st: StorageLike, cwd: string | null): { choice: string; custom: string } {
  const byFolder = cwd ? readMap(st)[cwd] : undefined;
  let last: string | null = null;
  try {
    last = st.getItem(MODEL_LAST_KEY);
  } catch {
    last = null;
  }
  for (const v of [byFolder, last]) {
    if (typeof v !== 'string' || claudeModelProblem(v) !== null) continue;
    return (CLAUDE_MODEL_ALIASES as readonly string[]).includes(v) ? { choice: v, custom: '' } : { choice: CUSTOM, custom: v };
  }
  return { choice: 'default', custom: '' };
}

/** Remember a valid claude-route model for the folder (and as the last overall). */
export function rememberChoice(st: StorageLike, cwd: string | null, model: string): void {
  const v = model === 'claude' ? 'default' : model;
  if (claudeModelProblem(v) !== null) return;
  try {
    st.setItem(MODEL_LAST_KEY, v);
    if (!cwd) return;
    const m = readMap(st);
    delete m[cwd];
    m[cwd] = v;
    const keys = Object.keys(m);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_FOLDERS))) delete m[k];
    st.setItem(MODEL_BY_FOLDER_KEY, JSON.stringify(m));
  } catch {
    /* storage full or blocked: the picker still works, it just forgets */
  }
}

interface RowLike {
  kind: string;
  payload?: unknown;
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The rows after which a session is over (the store's ended/failed/orphaned states). */
const SESSION_END_KINDS: ReadonlySet<string> = new Set(['session.exited', 'session.stop', 'session.exit', 'session.end', 'session.orphaned', 'session.refused']);

/** The model a session runs now, from the kernel's rows (oldest first); null when no session.open is seen. */
export interface SessionModelView {
  model: string;
  backend: string | null;
  /** a request.session.model with no session.model yet: the switch is in flight */
  pending: string | null;
  /** a timed-out switch's target, until the kernel's `reconciled` row */
  uncertain: string | null;
}
export function sessionModelOf(rows: Iterable<RowLike>): SessionModelView | null {
  let model: string | null = null;
  let backend: string | null = null;
  let pending: string | null = null;
  let uncertain: string | null = null;
  // Aegis L2: once the session ended no reconcile can come, so a timeout (before or after the exit row) is not shown
  // as an eternal "switching… (unconfirmed)"; the model on record stays. A resume's session.open starts afresh.
  let ended = false;
  for (const r of rows) {
    const p = obj(r.payload);
    if (r.kind === 'session.open') {
      model = typeof p.model === 'string' ? p.model : 'claude';
      backend = typeof p.backend === 'string' ? p.backend : null;
      pending = null;
      uncertain = null;
      ended = false;
    } else if (SESSION_END_KINDS.has(r.kind)) {
      ended = true;
      pending = null;
      uncertain = null;
    } else if (r.kind === MODEL_REQUEST && typeof p.model === 'string') pending = ended ? null : p.model;
    else if (r.kind === 'session.model') {
      if ((p.outcome === 'switched' || p.outcome === 'reconciled') && typeof p.to === 'string') model = p.to;
      uncertain = ended ? null : p.outcome === 'timeout' && typeof p.to === 'string' ? p.to : p.outcome === 'reconciled' || p.outcome === 'switched' ? null : uncertain;
      pending = null;
    }
  }
  return model === null ? null : { model, backend, pending, uncertain };
}

/** The header chip's text: the model, a switch in flight, or an unconfirmed (timed-out) switch. */
export function modelChipText(m: SessionModelView | null): string {
  if (m?.uncertain) return 'model: switching… (unconfirmed)';
  return `${modelLabel(m?.model)}${m?.pending ? ` → ${modelLabel(m.pending)}…` : ''}`;
}

/** The Settings → Session model value (read-only; the switch is the header's ▾). */
export function sessionModelText(m: SessionModelView | null): string {
  if (!m) return 'no session focused';
  if (m.backend === 'local') return 'local model (gnomon-local): no Claude model to switch';
  if (m.uncertain) return `switching to ${modelLabel(m.uncertain)}… (unconfirmed: the next reply shows which model answered; ${modelLabel(m.model)} on record)`;
  return `${modelLabel(m.model)}${m.pending ? ` → ${modelLabel(m.pending)}…` : ''}${m.backend ? ` · ${m.backend}` : ''}`;
}

/** The switch request (sent only on the human's confirmed, trusted gesture). */
export function switchRequest(hsid: string, model: string): { kind: typeof MODEL_REQUEST; payload: { hsid: string; model: string } } {
  return { kind: MODEL_REQUEST, payload: { hsid, model } };
}

/**
 * The confirm text — truthful about what a switch does: the kernel sends Claude Code's set_model into the running
 * process, so the conversation and its context carry on; the next turn starts a fresh prompt cache for the new
 * model (slower, more input billed once), and a pricier model spends the budget faster.
 */
export function switchConfirmText(from: string, to: string): string[] {
  return [
    `Switch this session from ${modelLabel(from)} to ${modelLabel(to)}?`,
    'The conversation continues in the same Claude process: the context comes with it.',
    'The prompt cache restarts for the new model, so the next turn is slower and bills its input once more.',
    'A larger model uses your plan limits faster; the budget meter keeps counting by model.',
  ];
}

/** The menu of the header switch: every alias except the current one, then "custom…". */
export function switchChoices(current: string): string[] {
  const cur = current === 'claude' ? 'default' : current;
  return MODEL_CHOICES.filter((m) => m !== cur);
}
