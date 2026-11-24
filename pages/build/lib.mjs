// Shared by stamp.mjs and check.mjs. Node only, no dependencies.
// A page is committed HTML. A stamped region sits between comment markers:
//   <!-- kind:arg key=value -->...<!-- /kind -->
// stamp.mjs rewrites what is between them from pages/facts.json and from files in the repo.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PAGES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(PAGES, '..');
export const KINDS = ['fact', 'bar', 'src', 'ref', 'sec', 'loc', 'standing', 'excerpt', 'capture', 'lately', 'graph', 'frame', 'rows', 'pn'];
export const REGION_RE = new RegExp(`<!-- (${KINDS.join('|')}):(\\S+)((?: [\\w-]+=\\S+)*) -->([\\s\\S]*?)<!-- /\\1 -->`, 'g');
const STRAY_RE = new RegExp(`<!-- /?(${KINDS.join('|')})[: ][^>]*-->|<!-- /(${KINDS.join('|')}) -->`, 'g');

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Escape, then set `code` spans. */
export const inl = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

export function loadManifest() {
  return JSON.parse(fs.readFileSync(path.join(PAGES, 'build', 'pages.json'), 'utf8'));
}

export function loadFacts() {
  const F = JSON.parse(fs.readFileSync(path.join(PAGES, 'facts.json'), 'utf8'));
  F.byId = Object.fromEntries(F.facts.map((f) => [f.id, f]));
  return F;
}

// ── the pinned commit ─────────────────────────────────────────────────────
const pinCache = new Map();
let pinTree = null;
export const pinState = { missing: false };

function git(args) {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

/** A repo file as it is at the pinned commit. Falls back to the working tree when the commit is not in this clone. */
export function readPinned(F, rel) {
  const key = rel;
  if (pinCache.has(key)) return pinCache.get(key);
  let text;
  try {
    text = git(['show', `${F.excerpts_pinned_to.commit}:${rel}`]);
  } catch {
    pinState.missing = true;
    const p = path.join(REPO, rel);
    text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  pinCache.set(key, text);
  return text;
}

function inRepo(F, rel) {
  if (pinTree === null) {
    try {
      pinTree = new Set(git(['ls-tree', '-r', '--name-only', F.excerpts_pinned_to.commit]).split('\n'));
    } catch {
      pinState.missing = true;
      pinTree = false;
    }
  }
  return pinTree ? pinTree.has(rel) : fs.existsSync(path.join(REPO, rel));
}

export function blobUrl(F, M, rel, a, b) {
  const frag = a ? `#L${a}${b && b !== a ? `-L${b}` : ''}` : '';
  return `${M.repo}/blob/${F.excerpts_pinned_to.commit}/${rel}${frag}`;
}

/** Escape a source string and link every repo path in it (with its :line or :a-b) to the pinned commit. */
export function linkify(F, M, s) {
  const re = /(?<![\w/.@-])((?:\.?[\w@-]+\/)+\.?[\w@.-]+|[\w@-]+(?:\.[A-Za-z]\w*)+)(?::(\d+)(?:-(\d+))?)?/g;
  let out = '';
  let last = 0;
  for (const m of s.matchAll(re)) {
    const rel = m[1].replace(/[.,;]+$/, '');
    if (!inRepo(F, rel)) continue;
    out += inl(s.slice(last, m.index));
    out += `<a href="${esc(blobUrl(F, M, rel, m[2], m[3]))}">${esc(rel)}${m[2] ? `:${m[2]}${m[3] ? `-${m[3]}` : ''}` : ''}</a>`;
    last = m[2] ? m.index + m[0].length : m.index + rel.length;
  }
  return out + inl(s.slice(last));
}

// ── facts ─────────────────────────────────────────────────────────────────
export function resolveFact(F, id) {
  if (id === 'as_of') return { value: F.as_of };
  const lm = id.match(/^lately\.(\w+)\[(\d+)\]\.(\w+)$/);
  if (lm) {
    const row = F.lately[lm[1]]?.[Number(lm[2])];
    return row && lm[3] in row ? { value: row[lm[3]] } : null;
  }
  const parts = id.split('.');
  for (let n = parts.length; n >= 1; n--) {
    const f = F.byId[parts.slice(0, n).join('.')];
    if (!f) continue;
    const rest = parts.slice(n);
    if (!rest.length) return { fact: f, value: f.value };
    if (rest.length > 1) return null;
    const k = rest[0];
    if (f.value && typeof f.value === 'object' && !Array.isArray(f.value) && k in f.value) return { fact: f, value: f.value[k] };
    if (['measured', 'claim', 'unit', 'source'].includes(k) && k in f) return { fact: f, value: f[k], field: k };
    return null;
  }
  return null;
}

export function fmt(v, o = {}) {
  if (typeof v === 'number') {
    const r = o.round ? Number(o.round) : 0;
    return (r ? Math.round(v / r) * r : v).toLocaleString('en-US');
  }
  if (Array.isArray(v)) return v.join(', ');
  if (v && typeof v === 'object') return null;
  return String(v);
}

const DAY = 86400000;
export function isStale(F, f) {
  return (Date.parse(F.as_of) - Date.parse(f.measured)) / DAY > F.stale_after_days;
}

/** The source line under a fact: how it is known, where, when. */
export function srcLine(F, M, f) {
  const where = linkify(F, M, f.source);
  if (f.kind === 'recorded earlier') return `recorded ${esc(f.measured)}, not re-run · ${where}`;
  if (f.kind === 'design, not measured') return `an estimate, not measured · ${where} · ${esc(f.measured)}`;
  const when = isStale(F, f) ? `<b>measured ${esc(f.measured)}</b>` : `run ${esc(f.measured)}`;
  return `real · ${where} · ${when}`;
}

export const STATES = {
  built: ['built', 'Built'],
  'did-not-hold': ['nothold', 'Did not hold'],
  'did not hold': ['nothold', 'Did not hold'],
  'in-progress': ['progress', 'In progress'],
  'in progress': ['progress', 'In progress'],
  untested: ['untested', 'Untested'],
  'untested or not built': ['untested', 'Untested'],
  // the thing does not exist yet: the untested mark, and the true word
  'not built': ['untested', 'Not built'],
  'not-built': ['untested', 'Not built'],
};

// ── excerpts ──────────────────────────────────────────────────────────────
const SIGIL = { '#': 'c', $: 'f', '^': 'g', '!': 's', '~': 'a' };
/** Escape a line of a real file and set each symbol prefix in its hue class. */
export function hl(line) {
  return esc(line).replace(/(^|[\s'"(,:\[]|&quot;)([#$^!~])(?=[a-z][a-z0-9]*-[a-z0-9-]*)/g, (m, pre, g) => `${pre}<b class="s-${SIGIL[g]}">${g}</b>`);
}

const isItem = (l) => /^\s*- /.test(l ?? '');
const indent = (l) => (l ?? '').match(/^\s*/)[0].length;

/** Does a YAML excerpt of lines a..b (1-based) begin or end inside a list or a block? Returns the reasons. */
export function listCut(lines, a, b) {
  const out = [];
  const first = lines[a - 1];
  const last = lines[b - 1];
  const before = lines[a - 2];
  const after = lines[b];
  if (isItem(first) && isItem(before) && indent(before) === indent(first)) out.push(`begins inside a list (line ${a - 1} is an item of the same list)`);
  if (isItem(last) && isItem(after) && indent(after) === indent(last)) out.push(`ends inside a list (line ${b + 1} is an item of the same list)`);
  if (after !== undefined && after.trim() !== '' && !isItem(last) && indent(after) > indent(last)) out.push(`ends on a key whose block goes on (line ${b + 1})`);
  return out;
}

export const isYaml = (rel) => /(\.purpose|\.ya?ml)$/.test(rel);

/** Cut a long id in the middle for a drawing; the whole id is written in the title and the list. */
export function midCut(id, max = 20) {
  if (id.length <= max) return id;
  const keep = max - 1;
  return `${id.slice(0, Math.ceil(keep / 2))}…${id.slice(-Math.floor(keep / 2))}`;
}

// ── page text, for the digit check ────────────────────────────────────────
/** Every run of page text or spoken attribute that holds a digit and is not inside a stamped region. */
export function typedDigits(html) {
  const s = html
    .replace(REGION_RE, '\u0001')
    .replace(/<!--[\s\S]*?-->/g, '\u0001')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '\u0001');
  const out = [];
  for (const m of s.matchAll(/\s(aria-label|title|alt|content|placeholder)="([^"]*)"/g)) {
    if (/\d/.test(m[2]) && !/^width=device-width/.test(m[2])) out.push(`${m[1]}="${m[2].slice(0, 70)}"`);
  }
  for (const seg of s.replace(/<[^>]*>/g, '\u0001').split('\u0001')) {
    if (/\d/.test(seg)) out.push(seg.trim().replace(/\s+/g, ' ').slice(0, 90));
  }
  return out;
}

export function strayMarkers(html) {
  return [...html.replace(REGION_RE, '').matchAll(STRAY_RE)].map((m) => m[0]);
}

export function parseOpts(s) {
  const o = {};
  for (const m of (s || '').matchAll(/([\w-]+)=(\S+)/g)) o[m[1]] = m[2];
  return o;
}

/** "5|15,17|29-30" to groups of line numbers; a bar is a blank line in the output. */
export function lineGroups(spec) {
  return spec.split('|').map((g) =>
    g.split(',').flatMap((r) => {
      const [a, b] = r.split('-').map(Number);
      return Array.from({ length: (b || a) - a + 1 }, (_, i) => a + i);
    }),
  );
}
