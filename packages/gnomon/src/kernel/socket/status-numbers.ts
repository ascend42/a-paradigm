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
  'standing.maxMs': 'limit', // TD-2026-10-20-086 F6: the longest a standing grant lives (STANDING_GRANT_MAX_MS)
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
  'voice.echoTailMs': 'limit', // configured echo tail (spec §14.7 config)
  'voice.ambientIdleMs': 'limit', // configured idle auto-off of a conversation ceiling (V2a, spec §14.7 config)
  'voice.turns.n': 'gauge', // voice.turn.user rows of the current attachment
  'voice.idleEndFailures.n': 'gauge', // every failed kernel idle end since start (a counter; the timer retries)
  // V2e (#gnomon-voice): the kernel-spawned voice client and the client's relayed enrolment progress
  'voice.client.restarts': 'gauge', // crash restarts of the voice child since its last human start (a counter)
  'voice.client.downloadMb': 'gauge', // total size of the model download in progress, whole MB
  'voice.enrolment.phrase': 'ordinal', // the enrolment phrase being recorded (1-based)
  'voice.enrolment.of': 'limit', // how many phrases an enrolment records
  // T-2026-10-20-005 A2: the voice app's measured mic level (0..1 of full scale) while a segment is being heard; a
  // measurement of one signal, not a count of a set, so there is no denominator
  'voice.capture.level': 'gauge',
  'voice.dictation.holdToggles': 'gauge', // the voice app's hold-toggle presses on this voice connection (a counter; TD-2026-10-20-262)
  // T-2026-10-19-026: the human's Stop speaking presses since the kernel started (a counter; the voice app acts on a change)
  'voice.stopSpeakingSeq': 'gauge',
  // TD-2026-10-21-514: the GUI's in-app mic key count (the voice client toggles the mic on a change)
  'voice.micToggleSeq': 'gauge',
  'voice.dictation.sendNows': 'gauge', // the voice app's send-now (⌃⌥Return) presses on this voice connection (a counter)
  // 8.0:loops #loop-runner (status.loops): the configured caps, and each recent run's ledger
  'loops.caps.*': 'limit', // runs at once per repo / overall, runs and compute seconds per day (LOOP_GLOBAL_CAPS)
  'loops.runs[].rounds': 'gauge', // rounds the run walked (the whole set)
  'loops.runs[].computeMs': 'duration', // check time the run spent, summed from its node rows
  'loops.runs[].notified': 'gauge', // loop.notified rows of the run (a counter)
  'loops.runs[].nodes[].visit': 'ordinal', // the node's visit number in the run (1-based)
  'loops.runs[].nodes[].round': 'ordinal', // the round the visit was in (1-based)
  'loops.runs[].nodes[].durationMs': 'duration', // the node's check time
  // LP8 (#gui-loops): a loop's configured run and day caps, as the GUI's list and budget fields show them
  'loops.loops[].shape.budgets.*.*': 'limit',
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
