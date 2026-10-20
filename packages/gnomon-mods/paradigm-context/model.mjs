// #paradigm-context-mod model: a PURE render of the kernel's paradigm-slice:v1
// (K1, host-composed view input; granted by paradigm.read:summary) to
// display-block:v1 (kit:v1 only). Read-only: no Button, no command, no
// effect. Nothing here reads a file or a path; the slice is the only input
// and it is re-validated here (a mod never trusts a count or a string).

export const SLICE_V1 = 'paradigm-slice:v1';
export const HUES = 8;
export const TOP = 5;
export const TITLE_MAX = 80;
export const MAX_SYMBOLS = 24;
/** A slice whose newest decision or lore entry is older than this (days, against its own `at`) is shown stale. */
export const STALE_DAYS = 14;

const ID = /^[A-Za-z0-9._-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
const SYMBOL = /^[#$^!~][a-z0-9][a-z0-9-]{0,63}$/;
const PRIORITIES = ['high', 'medium', 'low'];

/** A finite non-negative safe integer (anything else is 0). */
export function count(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER);
}

/** One display line: no newline or tab, capped at `max` code points (… when cut). */
export function clip(s, max = TITLE_MAX) {
  const one = String(typeof s === 'string' ? s : '').replace(/[\n\t\r]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  const cps = [...one];
  return cps.length > max ? `${cps.slice(0, max - 1).join('').trimEnd()}…` : one;
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const items = (zone, extra) =>
  arr(obj(zone).items)
    .filter((it) => it && typeof it === 'object' && typeof it.id === 'string' && ID.test(it.id) && typeof it.title === 'string')
    .slice(0, TOP)
    .map((it) => ({ id: it.id, title: clip(it.title), ...extra(it) }));

/** The slice, re-validated and bounded; null when it is not a paradigm-slice:v1. */
export function readSlice(input) {
  const s = obj(obj(input).paradigm);
  if (s.v !== SLICE_V1) return null;
  const state = s.state === 'ok' || s.state === 'absent' ? s.state : 'unfocused';
  const project = Number.isInteger(s.project) && s.project >= 0 && s.project < HUES ? s.project : null;
  const name = typeof s.name === 'string' ? clip(s.name, 64) : '';
  const at = typeof s.at === 'string' && DATE.test(s.at) ? s.at : null;
  const newest = typeof s.newest === 'string' && DATE.test(s.newest) ? s.newest : null;
  const t = obj(s.tasks);
  const d = obj(s.decisions);
  const l = obj(s.lore);
  const sk = obj(s.skipped);
  const of = (z, n) => Math.max(count(obj(obj(z).count).of), n);
  const tasks = items(t, (it) => ({ priority: PRIORITIES.includes(it.priority) ? it.priority : 'medium' }));
  const decisions = items(d, (it) => ({ date: typeof it.date === 'string' && DATE.test(it.date) ? it.date : null }));
  const lore = items(l, (it) => ({ type: typeof it.type === 'string' && TOKEN.test(it.type) ? it.type : 'note' }));
  const open = Math.max(count(t.open), tasks.length);
  return {
    state,
    project,
    name,
    at,
    newest,
    tasks: { open, high: Math.min(count(t.high), open), items: tasks, of: of(t, open) },
    decisions: { items: decisions, of: of(d, decisions.length) },
    lore: { items: lore, of: of(l, lore.length) },
    symbols: arr(s.symbols).filter((x) => typeof x === 'string' && SYMBOL.test(x)).filter((x, i, a) => a.indexOf(x) === i).slice(0, MAX_SYMBOLS),
    skipped: { malformed: count(sk.malformed), refused: count(sk.refused), secret: count(sk.secret), truncated: sk.truncated === true },
  };
}

/** Days from `newest` to `at` (both YYYY-MM-DD), or null. */
export function ageDays(newest, at) {
  if (!newest || !at) return null;
  return Math.max(0, Math.round((Date.parse(`${at}T00:00:00Z`) - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000));
}

const text = (t, tone) => ({ type: 'Text', text: t, ...(tone ? { tone } : {}) });
/** The {n, of} count as the zone title reads it. */
const nOf = (n, of) => `${n} of ${of}`;

function head(sl) {
  // the project swatch: a hue-toned cap glyph (hues are fills only, never text colour); the name is ink
  const cap = sl && sl.project !== null ? text('●', `hue-${sl.project}`) : text('◌', 'quiet');
  return { type: 'Box', direction: 'row', children: [cap, text(sl && sl.name ? sl.name : 'paradigm')] };
}

// a zone heading is a Text (tone head): the GUI's kit renderer draws no Box title, so the {n, of} count rides the text
function zone(title, lines, empty) {
  return { type: 'Box', direction: 'column', children: [text(title, 'head'), ...(lines.length ? lines : [text(empty, 'quiet')])] };
}

/** The sheet (sidebar): the project swatch, then tasks, decisions and lore, each with its {n, of} count. */
export function renderSheet(input, prefs = {}) {
  void prefs; // the theme and motion change nothing here: no fill animates, every tone is a token
  const sl = readSlice(input);
  const base = { schemaVersion: 'display-block:v1', type: 'Box', title: 'Paradigm', direction: 'column' };
  if (!sl || sl.state === 'unfocused') return { ...base, children: [head(null), text('focus a live session to see its project context', 'quiet')] };
  if (sl.state === 'absent') return { ...base, children: [head(sl), text('no .paradigm in this repo', 'quiet')] };
  const age = ageDays(sl.newest, sl.at);
  const children = [head(sl)];
  if (sl.newest === null) children.push(text('no decisions or lore yet', 'quiet'));
  else if (age !== null && age > STALE_DAYS) children.push(text(`stale · last entry ${sl.newest} (${age} days ago)`, 'warn'));
  const t = sl.tasks;
  children.push(
    zone(`tasks · ${nOf(t.items.length, t.of)} open${t.high ? ` · ${t.high} high` : ''}`, t.items.map((it) => text(`${it.id}${it.priority === 'high' ? ' ▲' : ''} ${it.title}`)), 'no open tasks'),
    zone(`decisions · ${nOf(sl.decisions.items.length, sl.decisions.of)}`, sl.decisions.items.map((it) => text(`${it.id}${it.date ? ` ${it.date}` : ''} ${it.title}`)), 'no decisions'),
    zone(`lore · ${nOf(sl.lore.items.length, sl.lore.of)}`, sl.lore.items.map((it) => text(`${it.id} ${it.type} · ${it.title}`)), 'no lore'),
  );
  // symbol chips: mono ink text (tone chip), never a hue
  if (sl.symbols.length) children.push({ type: 'Box', direction: 'column', children: [text(`symbols · ${sl.symbols.length}`, 'head'), { type: 'Box', direction: 'row', children: sl.symbols.map((s) => text(s, 'chip')) }] });
  const sk = sl.skipped;
  const notes = [sk.malformed ? `${sk.malformed} malformed` : '', sk.refused ? `${sk.refused} refused` : '', sk.secret ? `${sk.secret} secret` : '', sk.truncated ? 'truncated' : ''].filter(Boolean);
  if (notes.length) children.push(text(`skipped · ${notes.join(' · ')}`, 'quiet'));
  return { ...base, children };
}

export const VIEWS = Object.freeze({ 'paradigm-context.sheet': renderSheet });
