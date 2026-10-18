/**
 * @symbol #socket
 * @symbol #client-conformance
 *
 * Two owners on purpose: the DECLARATIONS are #socket's (status is the
 * socket's `status` verb, so whoever adds a status number declares it here, in
 * the kernel, beside the dispatcher); the CHECK serves #client-conformance's
 * honesty CI gate (test/honesty.test.ts, the live-status check in
 * test/m112-conformance.test.ts). Nothing in the kernel calls the check.
 *
 * #socket status numbers (spec §9.1 "every number ships as {n, of}; a bare
 * count in a result or block fails CI" — G-HON-03; §9.6; G-HON-07; M1.12
 * slice 3 honesty CI). Every numeric leaf `status` can carry is declared here
 * with what it IS, so a new number cannot ship without a declared meaning:
 *
 *   - `{n, of}`      a subset with its denominator in the same object;
 *   - `{n}` / `n`    a gauge: the size of the whole set (spec §9.6 `unlocks{n}`,
 *                    `linkOutbox{n}`, `modChildren{n}`) — there is no larger
 *                    set to be a fraction of;
 *   - subset         a count of part of a set whose size is a SIBLING field
 *                    (`cards.pendingForYou` of `cards.n`): the denominator is
 *                    the named path, and the count must not exceed it;
 *   - gauge        the same, under a name other than `n` (`daemon.connections`);
 *   - ordinal        an identifier that happens to be a number (seq, segment, pid, port);
 *   - limit          a configured cap or timeout, not a measurement;
 *   - duration       time elapsed on the kernel clock (uptime), not a latency;
 *   - latency        a measured latency: G-HON-07 requires sibling `method`
 *                    and `machine` strings naming how and where it was measured.
 *
 * checkStatusNumbers() walks a status result and returns every violation; the
 * honesty CI runs it on a live kernel's status (test/m112-conformance) and on
 * planted violations (test/honesty.test.ts, the falsifier).
 */

export type StatusNumberClass = 'gauge' | 'ordinal' | 'limit' | 'duration' | 'latency' | { subsetOf: string };

/** Paths are dotted from the status root; `*` matches one object key, `[]` one array element. */
export const STATUS_NUMBERS: Readonly<Record<string, StatusNumberClass>> = Object.freeze({
  'sessions.n': 'gauge',
  'cards.n': 'gauge',
  'subscriptions.n': 'gauge',
  'budget.permits.n': 'gauge', // open permits: the whole set
  'budget.quotaErrors.n': 'gauge', // every quota error since start: the whole set (a counter)
  'web.guiSessions.n': 'gauge',
  'unlocks.n': 'gauge', // spec §9.6 unlocks{n}
  'mods.running.n': 'gauge',
  'mods.paused.n': 'gauge',
  'daemon.pid': 'ordinal',
  'daemon.connections': 'gauge', // the whole set of socket connections, named in place of {n}
  'daemon.idleMs': 'limit',
  'daemon.uptimeMs': 'duration',
  'log.segment': 'ordinal',
  'log.seq': 'ordinal',
  'cards.pendingForYou': { subsetOf: 'cards.n' },
  'cards.held': { subsetOf: 'cards.n' },
  'cards.byKind.*': { subsetOf: 'cards.n' },
  'subscriptions.onThisConnection': { subsetOf: 'subscriptions.n' },
  'subscriptions.perConnectionMax': 'limit',
  'subscriptions.backlogCap': 'limit',
  'budget.subscriptionWindow.windowMs': 'limit',
  'web.port': 'ordinal',
});

export interface StatusNumberFinding {
  path: string;
  rule: 'G-HON-03' | 'G-HON-07';
  detail: string;
}

const matches = (pattern: string, p: string): boolean =>
  new RegExp(`^${pattern.replace(/[.[\]]/g, (c) => `\\${c}`).replace(/\*/g, '[^.\\[\\]]+')}$`).test(p);

function at(root: unknown, dotted: string): unknown {
  let cur: unknown = root;
  for (const k of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Every G-HON-03 / G-HON-07 violation in a status result (empty ⇒ honest). */
export function checkStatusNumbers(status: unknown, registry: Readonly<Record<string, StatusNumberClass>> = STATUS_NUMBERS): StatusNumberFinding[] {
  const out: StatusNumberFinding[] = [];
  const visit = (v: unknown, p: string, parent: Record<string, unknown> | undefined, key: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x) => visit(x, `${p}[]`, undefined, ''));
      return;
    }
    if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const [k, x] of Object.entries(o)) visit(x, p ? `${p}.${k}` : k, o, k);
      return;
    }
    if (typeof v !== 'number') return;
    if (key === 'of' && parent && typeof parent.n === 'number') return;
    if (key === 'n' && parent && typeof parent.of === 'number') {
      if (v > parent.of) out.push({ path: p, rule: 'G-HON-03', detail: `n ${v} exceeds of ${parent.of}` });
      return; // the numerator of {n, of}
    }
    const entry = Object.entries(registry).find(([pat]) => matches(pat, p));
    if (!entry) {
      out.push({ path: p, rule: 'G-HON-03', detail: key === 'n' ? 'an {n} without of must be declared a gauge in STATUS_NUMBERS' : 'a bare number: ship it as {n, of}, or declare what it is in STATUS_NUMBERS' });
      return;
    }
    const cls = entry[1];
    if (key === 'n' && cls !== 'gauge') {
      out.push({ path: p, rule: 'G-HON-03', detail: 'an {n} without of must be declared a gauge in STATUS_NUMBERS' });
    } else if (cls === 'latency') {
      if (!parent || typeof parent.method !== 'string' || !parent.method || typeof parent.machine !== 'string' || !parent.machine) {
        out.push({ path: p, rule: 'G-HON-07', detail: 'a latency number must name its measurement method and machine (sibling method, machine)' });
      }
    } else if (typeof cls === 'object') {
      const of = at(status, cls.subsetOf);
      if (typeof of !== 'number') out.push({ path: p, rule: 'G-HON-03', detail: `its denominator ${cls.subsetOf} is missing` });
      else if (v > of) out.push({ path: p, rule: 'G-HON-03', detail: `${v} exceeds its denominator ${cls.subsetOf} = ${of}` });
    }
  };
  visit(status, '', undefined, '');
  return out;
}
