// #ledger-mod model: the context and budget meter. A pure reducer over the
// host's NUMBERS-ONLY kernel-event feed (#mod-host projection v2) and a pure
// render to display-block:v1 (kit:v1 blocks only: Box, Text, Table, Progress).
// Inputs: turn.usage/turn.result {hsid, tokens, tokensIn?, tokensOut?,
// cacheRead?, cacheWrite?, costMicros?}, session.compacted {hsid,
// tokensBefore, tokensAfter}, session.open {hsid, backend, project},
// session.exited, budget.usage {dimension, n, of?, over?}, budget.ladder
// {dimension, scope, rung}, budget.breaker.open/close {dimension},
// permit.deny {dimension}. Unknown kinds and malformed fields are ignored;
// every number is re-clamped here (a mod never trusts a count).

export const MAX_SESSIONS = 256;
export const MAX_DIMENSIONS = 32;
export const HUES = 8;
export const WARN_RUNG = 75;
const ID = /^[A-Za-z0-9:._-]{1,128}$/;
const TOKEN = /^[a-z][a-z0-9-]{0,31}$/;

/** A finite non-negative safe integer (anything else is 0). */
export function count(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER);
}
const token = (v, d = 'unknown') => (typeof v === 'string' && TOKEN.test(v) ? v : d);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function emptyState() {
  return { sessions: new Map(), permit: null, ladder: new Map(), breakers: new Set(), denies: new Map() };
}

function session(state, hsid) {
  let s = state.sessions.get(hsid);
  if (s) return s;
  if (state.sessions.size >= MAX_SESSIONS) state.sessions.delete(state.sessions.keys().next().value);
  s = { backend: 'claude', project: 0, open: true, tokens: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, split: false, costMicros: 0, cost: false, compactions: 0, lastBefore: 0, lastAfter: 0 };
  state.sessions.set(hsid, s);
  return s;
}

const boundedSet = (m, k, v) => {
  if (!m.has(k) && m.size >= MAX_DIMENSIONS) return;
  m.set(k, v);
};

/** Apply one projected kernel event. */
export function apply(state, event) {
  if (!event || typeof event !== 'object' || typeof event.kind !== 'string') return state;
  const p = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const hsid = typeof p.hsid === 'string' && ID.test(p.hsid) ? p.hsid : null;
  switch (event.kind) {
    case 'session.open': {
      if (!hsid) break;
      const s = session(state, hsid);
      s.backend = p.backend === 'local' ? 'local' : 'claude';
      s.project = Number.isInteger(p.project) && p.project >= 0 && p.project < HUES ? p.project : 0;
      s.open = true;
      break;
    }
    case 'session.exited': {
      const s = hsid && state.sessions.get(hsid);
      if (s) s.open = false;
      break;
    }
    case 'turn.usage':
    case 'turn.result': {
      if (!hsid) break;
      const s = session(state, hsid);
      s.tokens += count(p.tokens);
      if (event.kind === 'turn.result') {
        for (const k of ['tokensIn', 'tokensOut', 'cacheRead', 'cacheWrite']) {
          if (isNum(p[k])) {
            s[k] += count(p[k]);
            s.split = true;
          }
        }
        if (isNum(p.costMicros)) {
          s.costMicros += count(p.costMicros);
          s.cost = true;
        }
      }
      break;
    }
    case 'session.compacted': {
      if (!hsid) break;
      const s = session(state, hsid);
      s.compactions++;
      s.lastBefore = count(p.tokensBefore);
      s.lastAfter = count(p.tokensAfter);
      break;
    }
    case 'budget.usage':
      if (p.over === true) state.permit = { dimension: token(p.dimension, 'tokens'), n: count(p.n), of: count(p.of) };
      break;
    case 'budget.ladder': {
      const key = `${token(p.dimension)}|${token(p.scope, 'session')}`;
      const rung = Math.min(count(p.rung), 1000);
      if (rung > (state.ladder.get(key) ?? -1)) boundedSet(state.ladder, key, rung);
      break;
    }
    case 'budget.breaker.open':
      if (state.breakers.size < MAX_DIMENSIONS) state.breakers.add(token(p.dimension));
      break;
    case 'budget.breaker.close':
      state.breakers.delete(token(p.dimension));
      break;
    case 'permit.deny': {
      const d = token(p.dimension);
      boundedSet(state.denies, d, (state.denies.get(d) ?? 0) + 1);
      break;
    }
    default:
      break;
  }
  return state;
}

/** 182000 → 182k, 9400 → 9k, 1250000 → 1.3M, 950 → 950. */
export function short(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(Math.round(n / 100_000) / 10).toFixed(1)}M`;
}
const dollars = (micros) => `$${(micros / 1e6).toFixed(2)}`;

/** The totals of one session, or of every session when hsid is null. */
export function totals(state, hsid) {
  const list = hsid ? [state.sessions.get(hsid)].filter(Boolean) : [...state.sessions.values()];
  const t = { tokens: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, split: false, unsplit: 0, costMicros: 0, cost: false, compactions: 0, lastBefore: 0, lastAfter: 0 };
  for (const s of list) {
    for (const k of ['tokens', 'tokensIn', 'tokensOut', 'cacheRead', 'cacheWrite', 'costMicros', 'compactions']) t[k] = Math.min(t[k] + s[k], Number.MAX_SAFE_INTEGER);
    t.split ||= s.split;
    if (!s.split) t.unsplit = Math.min(t.unsplit + s.tokens, Number.MAX_SAFE_INTEGER);
    t.cost ||= s.cost;
    if (s.compactions) {
      t.lastBefore = s.lastBefore;
      t.lastAfter = s.lastAfter;
    }
  }
  return t;
}

/** `182k in · 9k out · 71% cache · $0.42 · ⇣ 2 compactions (190k → 41k)`; `in` counts every input token (fresh + cache). */
export function summaryLine(t) {
  const parts = [];
  if (t.split) {
    const input = t.tokensIn + t.cacheRead + t.cacheWrite;
    parts.push(`${short(input)} in`, `${short(t.tokensOut)} out`, `${input ? Math.round((t.cacheRead / input) * 100) : 0}% cache`);
    if (t.unsplit) parts.push(`${short(t.unsplit)} local`);
  } else parts.push(`${short(t.tokens)} tokens`);
  if (t.cost) parts.push(dollars(t.costMicros));
  if (t.compactions) parts.push(`⇣ ${t.compactions} compaction${t.compactions === 1 ? '' : 's'} (${short(t.lastBefore)} → ${short(t.lastAfter)})`);
  return parts.join(' · ');
}

/** The worst budget signal: deny (vermilion) > warn (amber) > none. */
export function budgetTone(state) {
  if (state.breakers.size || state.denies.size) return 'deny';
  if (state.permit) return 'warn';
  for (const r of state.ladder.values()) if (r >= WARN_RUNG) return 'warn';
  return 'quiet';
}

/** The budget meter: the over-permit row (n of m), else the highest ladder rung (percent of the daily cap). */
function meter(state, reduced) {
  let m = null;
  if (state.permit && state.permit.of > 0) {
    const fmt = state.permit.dimension === 'usd' ? dollars : short;
    m = { value: state.permit.n, max: state.permit.of, label: `${state.permit.dimension} ${fmt(state.permit.n)} of ${fmt(state.permit.of)} (permit)` };
  } else {
    let best = null;
    for (const [k, r] of [...state.ladder.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (!best || r > best[1]) best = [k, r];
    if (best) {
      const [dim, scope] = best[0].split('|');
      m = { value: best[1], max: 100, label: `${dim} ${best[1]} of 100% (${scope} daily cap)` };
    }
  }
  if (!m) return [];
  // reduced motion: no fill element at all (nothing can animate), the same numbers as text
  return reduced ? [{ type: 'Text', text: `▮ ${m.label}`, tone: budgetTone(state) }] : [{ type: 'Progress', value: Math.min(m.value, m.max), max: m.max, label: m.label }];
}

function alarms(state) {
  const out = [];
  for (const d of [...state.breakers].sort()) out.push({ type: 'Text', text: `✕ breaker open · ${d}`, tone: 'deny' });
  for (const [d, n] of [...state.denies.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out.push({ type: 'Text', text: `✕ permit denied · ${d}${n > 1 ? ` ×${n}` : ''}`, tone: 'deny' });
  return out;
}

/** The strip (composer.footer): the cap carries the session's project hue (never as text). */
export function renderStrip(state, prefs = {}, input = {}) {
  const reduced = prefs.motion === 'reduced';
  const hsid = input && typeof input.hsid === 'string' && ID.test(input.hsid) && state.sessions.has(input.hsid) ? input.hsid : null;
  const s = hsid ? state.sessions.get(hsid) : null;
  const t = totals(state, hsid);
  const tone = budgetTone(state);
  const cap = s ? { type: 'Text', text: s.backend === 'local' ? '○' : '●', tone: `hue-${s.project}` } : { type: 'Text', text: '◌', tone: 'quiet' };
  return {
    schemaVersion: 'display-block:v1',
    type: 'Box',
    title: hsid ? 'Ledger · this session' : `Ledger · ${state.sessions.size} session${state.sessions.size === 1 ? '' : 's'}`,
    direction: 'row',
    children: [cap, { type: 'Text', text: state.sessions.size ? summaryLine(t) : 'no usage yet', tone: tone === 'deny' ? 'deny' : tone === 'warn' ? 'warn' : 'quiet' }, ...meter(state, reduced), ...alarms(state)],
  };
}

/** The sheet (sidebar): one row per session, then the budget meter and alarms. */
export function renderSheet(state, prefs = {}) {
  const reduced = prefs.motion === 'reduced';
  const rows = [...state.sessions.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([id, s]) => {
      const input = s.tokensIn + s.cacheRead + s.cacheWrite;
      return [
        `…${id.slice(-6)}${s.open ? '' : ' (ended)'}`,
        s.split ? short(input) : short(s.tokens),
        s.split ? short(s.tokensOut) : '-',
        s.split ? `${input ? Math.round((s.cacheRead / input) * 100) : 0}%` : '-',
        s.cost ? dollars(s.costMicros) : '-',
        s.compactions ? `${s.compactions} (${short(s.lastBefore)} → ${short(s.lastAfter)})` : '0',
      ];
    });
  const t = totals(state, null);
  return {
    schemaVersion: 'display-block:v1',
    type: 'Box',
    title: 'Ledger',
    direction: 'column',
    children: [
      rows.length ? { type: 'Table', columns: ['session', 'in', 'out', 'cache', 'cost', '⇣ compactions'], rows } : { type: 'Text', text: 'no sessions metered yet', tone: 'quiet' },
      ...(rows.length ? [{ type: 'Text', text: `total · ${summaryLine(t)}`, tone: 'quiet' }] : []),
      ...meter(state, reduced),
      ...alarms(state),
    ],
  };
}

export const VIEWS = Object.freeze({ 'ledger.strip': renderStrip, 'ledger.sheet': renderSheet });
