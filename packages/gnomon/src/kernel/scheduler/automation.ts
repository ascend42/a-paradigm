/**
 * @symbol #scheduler
 *
 * #scheduler (spec §3.5, §10 law 5, §13.3) — the `automation:v1` record.
 *
 *   automation:v1 { id, trigger, model: local|claude|any, attended }
 *
 * An automation is ATTENDED. Law 5 lets a local automation spend compute only
 * after a human marks it `attended:false` + `model`; that mark must be an
 * #approval-broker decision (M1.6), and the run step it unlocks is
 * #session-runner / #local-runner (M1.7 / M1.8). Neither is wired yet, so
 * `attended:false` is REFUSED at registration (`unattended-unavailable`) —
 * never accepted on the strength of a principal string, never silently
 * downgraded. The scheduler's run step stays hard-wired to refuse.
 *
 * Triggers are log-derivable on purpose: `at` is one instant; `every` is a
 * period counted from a fixed `anchor`, so the due instants are a pure
 * function of the record and the log's `schedule.automation.due` rows — a
 * restart rebuilds the same timers (G-SCH-01), never "now + period". Instants
 * are strict ISO-8601 with `Z` or `±hh:mm`, years 0001–9999; `every` is 1 min
 * to 10 years, so every derived instant stays inside the Date range.
 *
 * LOCAL SHAPE: `automation:v1` / `timer:v1` are not wire objects yet (no verb
 * carries them), so they live here, not in @a-company/gnomon-contracts —
 * moving them there would move clientApiId (reported as a candidate).
 */

export const AUTOMATION_MODELS = ['local', 'claude', 'any'] as const;
export type AutomationModel = (typeof AUTOMATION_MODELS)[number];

/** Smallest period an `every` trigger may have (a tighter loop is a mod's business, not a timer's). */
export const MIN_AUTOMATION_PERIOD_MS = 60_000;
/** Largest period: 10 Julian years. */
export const MAX_AUTOMATION_PERIOD_MS = 10 * 365.25 * 86_400_000;

export type AutomationTrigger = { at: string } | { every: number; anchor: string };

export interface AutomationV1 {
  id: string;
  trigger: AutomationTrigger;
  model: AutomationModel;
  /** Always true until the M1.6 decision + M1.7/M1.8 run step land. */
  attended: true;
}

export class AutomationRefusal extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(`automation:v1: ${message}`);
    this.name = 'AutomationRefusal';
    this.reason = reason;
  }
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STRICT_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** Strict ISO-8601 instant with a zone, years 0001–9999. */
export function strictIsoMs(v: unknown, field: string): number {
  if (typeof v !== 'string') throw new AutomationRefusal('bad-trigger', `${field} must be an ISO-8601 string`);
  const m = STRICT_ISO.exec(v);
  if (!m || m[1] === '0000') throw new AutomationRefusal('bad-trigger', `${field} must be YYYY-MM-DDTHH:MM:SS[.fff](Z|±hh:mm)`);
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) throw new AutomationRefusal('bad-trigger', `${field} is not a valid instant`);
  return ms;
}

/** Validate a raw record. Unknown fields refuse (closed shape, additive only by a spec change). */
export function parseAutomation(raw: unknown): AutomationV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AutomationRefusal('bad-shape', 'not an object');
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (!['id', 'trigger', 'model', 'attended'].includes(k)) throw new AutomationRefusal('bad-shape', `unknown field ${k}`);
  }
  if (typeof r.id !== 'string' || !ID.test(r.id)) throw new AutomationRefusal('bad-id', 'id must be kebab-case, ≤ 64 chars');
  if (typeof r.model !== 'string' || !(AUTOMATION_MODELS as readonly string[]).includes(r.model)) {
    throw new AutomationRefusal('bad-model', `model must be one of ${AUTOMATION_MODELS.join('|')}`);
  }
  const t = r.trigger;
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new AutomationRefusal('bad-trigger', 'trigger must be {at} or {every, anchor}');
  const tr = t as Record<string, unknown>;
  let trigger: AutomationTrigger;
  if ('at' in tr && Object.keys(tr).length === 1) {
    strictIsoMs(tr.at, 'trigger.at');
    trigger = { at: tr.at as string };
  } else if ('every' in tr && 'anchor' in tr && Object.keys(tr).length === 2) {
    if (typeof tr.every !== 'number' || !Number.isInteger(tr.every) || tr.every < MIN_AUTOMATION_PERIOD_MS || tr.every > MAX_AUTOMATION_PERIOD_MS) {
      throw new AutomationRefusal('bad-trigger', `trigger.every must be an integer in [${MIN_AUTOMATION_PERIOD_MS}, ${MAX_AUTOMATION_PERIOD_MS}] ms`);
    }
    strictIsoMs(tr.anchor, 'trigger.anchor');
    trigger = { every: tr.every, anchor: tr.anchor as string };
  } else {
    throw new AutomationRefusal('bad-trigger', 'trigger must be exactly {at} or {every, anchor}');
  }
  const attended = r.attended === undefined ? true : r.attended;
  if (typeof attended !== 'boolean') throw new AutomationRefusal('bad-shape', 'attended must be a boolean');
  if (!attended) {
    throw new AutomationRefusal(
      'unattended-unavailable',
      'attended:false needs an #approval-broker decision (M1.6) and the unattended run step (#session-runner M1.7 / #local-runner M1.8); refused until both land (law 5)',
    );
  }
  return { id: r.id, trigger, model: r.model as AutomationModel, attended: true };
}

/** The timer key of an automation (one daemon ⇒ one timer per key). */
export function automationKey(id: string): string {
  return `automation:${id}`;
}

/**
 * The due instants of `trigger` in (afterMs, uptoMs]: how many, the last one,
 * and the first one after `uptoMs` (`next`, null when the trigger is spent).
 * `afterMs` is the last fired due instant from the log (-Infinity when none).
 */
export function dueWindow(trigger: AutomationTrigger, afterMs: number, uptoMs: number): { count: number; last: number | null; next: number | null } {
  if ('at' in trigger) {
    const at = Date.parse(trigger.at);
    if (at <= afterMs) return { count: 0, last: null, next: null };
    return at <= uptoMs ? { count: 1, last: at, next: null } : { count: 0, last: null, next: at };
  }
  const anchor = Date.parse(trigger.anchor);
  const k0 = afterMs < anchor ? 0 : Math.floor((afterMs - anchor) / trigger.every) + 1;
  const first = anchor + k0 * trigger.every;
  if (first > uptoMs) return { count: 0, last: null, next: first };
  const kLast = Math.floor((uptoMs - anchor) / trigger.every);
  return { count: kLast - k0 + 1, last: anchor + kLast * trigger.every, next: anchor + (kLast + 1) * trigger.every };
}
