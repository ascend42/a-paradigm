#!/usr/bin/env node
// Stamps pages/facts.json, real file excerpts, captures and the shared frame into the committed HTML.
//   node pages/build/stamp.mjs            rewrite the stamped regions in place
//   node pages/build/stamp.mjs --check    exit 1 if a rewrite would change anything
//   node pages/build/stamp.mjs --release  also refuse slots, facts without a source or date,
//                                         standing rows without evidence, and excerpts that drifted
// No dependencies. See pages/README.md.
import fs from 'node:fs';
import path from 'node:path';
import {
  PAGES, REGION_RE, STATES, esc, inl, hl, fmt, linkify, blobUrl, srcLine, resolveFact, readPinned, pinState,
  loadFacts, loadManifest, listCut, isYaml, midCut, parseOpts, lineGroups, strayMarkers,
} from './lib.mjs';

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const RELEASE = args.has('--release');
const F = loadFacts();
const M = loadManifest();
const errors = [];
const notices = [];
const fail = (page, msg) => errors.push(`${page}: ${msg}`);

const prefixOf = (file) => '../'.repeat(file.split('/').length - 1);
const hrefTo = (ctx, page) => (ctx.page.id === '404' ? page.file : ctx.prefix + page.file);

// ── renderers: (ctx, arg, opts, old) -> html ──────────────────────────────
const R = {
  fact(ctx, id, o) {
    const r = resolveFact(F, id);
    if (!r) return fail(ctx.file, `fact ${id} is not in facts.json`);
    if (r.fact) ctx.used.add(r.fact.id);
    if (r.field === 'source') return linkify(F, M, r.value);
    const v = fmt(r.value, o);
    if (v === null) return fail(ctx.file, `fact ${id} is an object; name one of its keys`);
    return inl(v);
  },
  bar(ctx, id, o) {
    const a = resolveFact(F, id);
    const b = resolveFact(F, o.of || id);
    if (!a || !b || typeof a.value !== 'number' || typeof b.value !== 'number') return fail(ctx.file, `bar ${id}: needs two numeric facts`);
    [a, b].forEach((r) => r.fact && ctx.used.add(r.fact.id));
    return `<svg class="pair-bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect width="${Math.round((a.value / b.value) * 1000) / 10}" height="4"/></svg>`;
  },
  src(ctx, id) {
    const f = F.byId[id];
    if (!f) return fail(ctx.file, `src ${id} is not in facts.json`);
    ctx.used.add(id);
    return srcLine(F, M, f);
  },
  ref(ctx, id) {
    const r = F.refs?.[id];
    if (!r) return fail(ctx.file, `ref ${id} is not in facts.json refs`);
    if (!r.source) fail(ctx.file, `ref ${id} has no source`);
    return linkify(F, M, r.value);
  },
  sec(ctx, anchor) {
    const ids = [...ctx.html.matchAll(/<section class="section[^"]*"[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    const n = ids.indexOf(anchor);
    if (n < 0) return fail(ctx.file, `sec ${anchor}: no numbered section has that id`);
    return String(n + 1);
  },
  loc(ctx, id) {
    const ex = F.excerpts[id];
    if (!ex) return fail(ctx.file, `loc ${id}: no such excerpt in facts.json`);
    if (!ex.lines) return `<a href="${esc(blobUrl(F, M, ex.path))}">${esc(ex.label || ex.path)}</a>`;
    const [a, b] = ex.lines;
    const words = a === b ? `line ${a}` : `lines ${a} to ${b}`;
    return `<a href="${esc(blobUrl(F, M, ex.path, a, b))}">${esc(ex.path)}, ${words}</a>`;
  },
  rows(ctx, id) {
    const r = resolveFact(F, id);
    if (!r || !Array.isArray(r.value)) return fail(ctx.file, `rows ${id}: needs a fact whose value is a list`);
    if (r.fact) ctx.used.add(r.fact.id);
    return `\n${r.value.map((v) => `<li>${inl(v)}</li>`).join('\n')}\n`;
  },
  pn(ctx, anchor) {
    const ids = [...ctx.html.matchAll(/<li class="practice" id="([^"]+)"/g)].map((m) => m[1]);
    const n = ids.indexOf(anchor);
    if (n < 0) return fail(ctx.file, `pn ${anchor}: no practice has that id`);
    return String(n + 1);
  },
  standing(ctx, arg, o) {
    const [product, form] = arg.split('.');
    const rows = F.standing[product]?.[form];
    if (!rows) return fail(ctx.file, `standing ${arg} is not in facts.json`);
    return '\n' + rows.map((row, i) => {
      const st = STATES[row.state];
      if (!st) return fail(ctx.file, `standing ${arg}[${i}]: unknown state "${row.state}"`);
      if (!row.evidence) return fail(ctx.file, `standing ${arg}[${i}] has no evidence, so it is not shown`), '';
      (row.facts || []).forEach((id) => (F.byId[id] ? ctx.used.add(id) : fail(ctx.file, `standing ${arg}[${i}] cites unknown fact ${id}`)));
      return `<li class="ledger-row is-${st[0]}">${o.loom ? '<div class="thread" aria-hidden="true"></div>' : ''}<div class="ledger-state"><span class="mark ${st[0]}" aria-hidden="true"></span>${st[1]}</div><div class="ledger-what">${inl(row.what)}</div><div class="ledger-ev">${linkify(F, M, row.evidence)}</div></li>\n`;
    }).join('');
  },
  excerpt(ctx, id, o) {
    const ex = F.excerpts[id];
    if (!ex?.lines) return fail(ctx.file, `excerpt ${id}: no excerpt with lines in facts.json`);
    let [a, b] = ex.lines;
    if (o.lines) {
      [a, b] = o.lines.split('-').map(Number);
      if (a < ex.lines[0] || b > ex.lines[1]) return fail(ctx.file, `excerpt ${id}: lines ${a}-${b} are outside the ${ex.lines.join('-')} that facts.json records`);
    }
    const text = readPinned(F, ex.path);
    if (text === null) return fail(ctx.file, `excerpt ${id}: ${ex.path} does not exist at the pinned commit`);
    const lines = text.split('\n');
    if (b > lines.length) return fail(ctx.file, `excerpt ${id}: ${ex.path} has no line ${b} at the pinned commit`);
    if (isYaml(ex.path) && o.cut !== 'said') listCut(lines, a, b).forEach((why) => fail(ctx.file, `excerpt ${id} (${ex.path} ${a}-${b}) ${why}`));
    const cut = [];
    const body = [];
    for (let i = a; i <= b; i++) {
      let l = lines[i - 1];
      if (l.length > 84 && !o.wrap) { l = `${l.slice(0, 80)} ...`; cut.push(i); }
      body.push(`<span class="ln">${i}</span>${hl(l)}`);
    }
    const words = a === b ? `line ${a}` : `lines ${a} to ${b}`;
    return `\n<div class="proof-head"><span>${esc(ex.path)}</span><a href="${esc(blobUrl(F, M, ex.path, a, b))}">${words} ↗</a></div>\n<pre tabindex="0"${o.wrap ? ' class="wrap"' : ''}>${body.join('\n')}</pre>\n${cut.length ? `<p class="proof-cut">Line ${cut.join(', ')} is shortened here.</p>\n` : ''}`;
  },
  capture(ctx, name, o) {
    const rel = `pages/captures/${name}.txt`;
    const p = path.join(PAGES, 'captures', `${name}.txt`);
    if (!fs.existsSync(p)) return fail(ctx.file, `capture ${name}: ${rel} does not exist`);
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    const date = lines.slice(0, 6).join(' ').match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const when = /^# RECORDED/.test(lines[0]) ? `recorded ${date}, not re-run` : `captured ${date}`;
    if (!date) return fail(ctx.file, `capture ${name}: the first line does not say when it was captured`);
    if (!o.lines) return fail(ctx.file, `capture ${name}: name the lines to show`);
    const groups = lineGroups(o.lines);
    const bad = groups.flat().find((n) => !(n >= 1 && n <= lines.length));
    if (bad !== undefined) return fail(ctx.file, `capture ${name}: no line ${bad}`);
    const body = groups.map((g) => g.map((n) => hl(lines[n - 1].replace(/\s+$/, ''))).join('\n')).join('\n\n');
    const head = o.head === '0' ? '' : `<div class="proof-head"><span>${esc(rel)}</span><a href="${esc(blobUrl(F, M, rel))}">${when} ↗</a></div>\n`;
    return `\n${head}<pre tabindex="0">${body}</pre>\n`;
  },
  lately(ctx, product, o) {
    const all = F.lately[product];
    if (!Array.isArray(all)) return fail(ctx.file, `lately ${product} is not in facts.json`);
    const log = readPinned(F, F.lately.source)?.split('\n') || [];
    const rows = all.slice(0, Number(o.rows || all.length));
    return '\n' + rows.map((row) => {
      if (!(log[row.line - 1] || '').includes(`**${row.lead}`)) fail(ctx.file, `lately ${product} ${row.version}: ${F.lately.source} line ${row.line} does not lead with "${row.lead}"`);
      const rider = o.with ? F.lately[o.with]?.find((w) => w.line === row.line) : null;
      const name = `${o.name ? `${o.name} ` : ''}${row.version}`;
      const moved = row.moved?.match(/^(.*): .* -> (.*)$/);
      const st = moved && STATES[moved[2]];
      return `<li class="lately-row"><div class="lately-when">${esc(row.date)} · <a href="${esc(blobUrl(F, M, F.lately.source, row.line))}">${esc(name)}</a>${rider ? `, with ${o.with[0].toUpperCase()}${o.with.slice(1)} ${esc(rider.version.split(' ')[0])}` : ''}</div><div><p class="lately-lead">“${inl(row.lead)}”</p>${st ? `<p class="lately-moved"><span class="mark ${st[0]}" aria-hidden="true"></span>${esc(row.moved.replace(' -> ', ' to '))}</p>` : ''}</div></li>\n`;
    }).join('');
  },
  graph(ctx, id, o) {
    return graph(ctx, id, o);
  },
  frame(ctx, part) {
    const pre = ctx.page.id === '404' ? '' : ctx.prefix;
    if (part === 'head') {
      return `\n${ctx.page.id === '404' ? `<base href="${esc(M.base_path)}">\n` : ''}<script>try{var t=localStorage.getItem("pages-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
<link rel="preload" href="${pre}assets/fonts/Fraunces-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${pre}assets/pages.css">
<script src="${pre}assets/pages.js" defer></script>
`;
    }
    if (part === 'mast') {
      const nav = M.pages.filter((p) => p.nav).map((p) => `      <a href="${hrefTo(ctx, p)}"${p.id === ctx.page.id ? ' aria-current="page"' : ''}>${esc(p.nav)}</a>`).join('\n');
      return `
  <a class="key skip" href="#main">Skip to the page</a>
  <header class="mast">
    <a class="mast-name" href="${hrefTo(ctx, M.pages[0])}">Paradigm</a>
    <nav aria-label="Pages">
${nav}
    </nav>
    <div class="mast-side">
      <a href="${M.repo}">Repository ↗</a>
    </div>
  </header>
`;
    }
    if (part === 'foot') {
      return `
  <footer class="foot">
    <a href="${M.repo}">Repository ↗</a>
    <a href="${esc(blobUrl(F, M, 'CHANGELOG.md'))}">Changelog ↗</a>
    <a href="${esc(blobUrl(F, M, 'LICENSE'))}">MIT licence ↗</a>
    <span>Facts last stamped ${esc(F.as_of)}</span>
  </footer>
`;
    }
    return fail(ctx.file, `frame ${part}: unknown part`);
  },
};

// ── the symbol graph: read from the .purpose file, never typed ────────────
function graph(ctx, id, o) {
  const ex = F.excerpts[id];
  if (!ex) return fail(ctx.file, `graph ${id}: no such excerpt`);
  const text = readPinned(F, ex.path);
  if (text === null) return fail(ctx.file, `graph ${id}: ${ex.path} does not exist at the pinned commit`);
  const lines = text.split('\n');
  const KIND = { '#': 'component', $: 'flow', '^': 'gate', '!': 'signal', '~': 'aspect' };
  const CLS = { '#': 'c', $: 'f', '^': 'g', '!': 's', '~': 'a' };
  const feats = (o.features || '').split(',').map((name) => {
    const at = lines.findIndex((l) => l === `  ${name}:`);
    if (at < 0) return fail(ctx.file, `graph ${id}: ${ex.path} has no feature ${name}`), null;
    const members = [];
    for (let i = at + 1; i < lines.length && !/^ {0,2}\S/.test(lines[i]); i++) {
      const m = lines[i].match(/^ {6}- '?([#$^!~][\w-]+)'?\s*$/);
      if (m) members.push(m[1]);
    }
    return { id: `#${name}`, members };
  });
  if (feats.includes(null) || feats.length !== 2) return fail(ctx.file, `graph ${id}: needs two features`), '';
  const [A, B] = feats;
  const shared = A.members.filter((m) => B.members.includes(m));
  const rank = (m) => '$#^!~'.indexOf(m[0]);
  const only = (X) => X.members.filter((m) => !shared.includes(m)).sort((x, y) => rank(x) - rank(y));
  const right = [...only(A), ...shared, ...only(B)];
  // the picture and the captured answer must agree
  if (o.agrees) {
    const cap = fs.readFileSync(path.join(PAGES, 'captures', `${o.agrees}.txt`), 'utf8');
    const named = cap.match(/^\s*Components:\s*(.*)$/m)?.[1] || '';
    const asked = cap.match(/^\$ paradigm ripple '([^']+)'/m)?.[1];
    if (!shared.includes(asked)) fail(ctx.file, `graph ${id}: the capture asks about ${asked}, which is not the shared symbol (${shared.join(', ')})`);
    feats.forEach((f) => named.includes(f.id) || fail(ctx.file, `graph ${id}: the capture does not name ${f.id}`));
  }
  const PITCH = 20, LX = 8, RX = 256, CH = 7.8, W = 424;
  const y = (i) => 22 + i * PITCH;
  const H = y(right.length - 1) + 14;
  const mean = (X) => X.members.reduce((s, m) => s + y(right.indexOf(m)), 0) / X.members.length;
  const fy = new Map(feats.map((f) => [f.id, Math.round(mean(f))]));
  const depsOf = (m) => feats.filter((f) => f.members.includes(m)).map((f) => f.id);
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  const label = (sym) => `<tspan class="p-${CLS[sym[0]]}">${esc(sym[0])}</tspan>${esc(midCut(sym.slice(1), 19))}`;
  const node = (sym, x, yy, say, ripple, cls) => {
    const w = Math.round(midCut(sym, 20).length * CH + 12);
    return `<g class="node${cls ? ` ${cls}` : ''}" tabindex="0" role="img" aria-label="${esc(`${sym}, ${KIND[sym[0]]}. ${say}`)}" data-id="${esc(sym)}" data-ripple="${esc(ripple.join(' '))}"${cls === 'at' ? ' data-o' : cls === 'hit' ? ' data-d' : ''}><title>${esc(sym)}</title><rect x="${x - 6}" y="${yy - 13}" width="${w}" height="18"/><text x="${x}" y="${yy}">${label(sym)}</text></g>`;
  };
  const edges = [];
  const nodes = [];
  feats.forEach((f) => {
    const x1 = LX + Math.round(midCut(f.id, 20).length * CH) + 8;
    f.members.forEach((m) => {
      const y1 = fy.get(f.id) - 4, y2 = y(right.indexOf(m)) - 4, mx = Math.round((x1 + RX - 8) / 2);
      const hit = shared.includes(m);
      edges.push(`<path class="edge${hit ? ' hit' : ''}" data-a="${esc(f.id)}" data-b="${esc(m)}"${hit ? ' data-d' : ''} d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${RX - 8} ${y2}"/>`);
    });
    nodes.push(node(f.id, LX, fy.get(f.id), `It lists ${list(f.members)}. Nothing in this slice depends on it.`, [], shared.length ? 'hit' : ''));
  });
  right.forEach((m, i) => {
    const deps = depsOf(m);
    nodes.push(node(m, RX, y(i), `A change to it reaches ${list(deps)}.`, deps, shared.includes(m) ? 'at' : ''));
  });
  const title = 'A slice of this repository’s symbol graph';
  const desc = `Two commands, ${A.id} and ${B.id}, each list the flow, components and signals they are made of. ${list(shared)} is listed by both, so a change to it reaches both commands.`;
  const item = (m, other) => `<li${shared.includes(m) ? ' class="hit"' : ''}><b class="s-${CLS[m[0]]}">${esc(m[0])}</b>${esc(m.slice(1))}${shared.includes(m) ? ` <span>also in ${esc(other.id)}</span>` : ''}</li>`;
  const gl = feats.map((f, i) => `  <li><b class="s-c">#</b>${esc(f.id.slice(1))}\n    <ul>\n${f.members.map((m) => `      ${item(m, feats[1 - i])}`).join('\n')}\n    </ul>\n  </li>`).join('\n');
  return `
<svg class="graph" viewBox="0 0 ${W} ${H}" role="group" aria-labelledby="g-title g-desc">
<title id="g-title">${title}</title>
<desc id="g-desc">${esc(desc)}</desc>
<g aria-hidden="true">
${edges.join('\n')}
</g>
${nodes.join('\n')}
</svg>
<ul class="graph-list" aria-label="${title}">
${gl}
</ul>
`;
}

// ── run ───────────────────────────────────────────────────────────────────
let changed = 0;
const tbd = new Set();
for (const page of M.pages.filter((p) => p.built)) {
  const file = path.join(PAGES, page.file);
  if (!fs.existsSync(file)) { fail(page.file, 'is marked built in build/pages.json and does not exist'); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const ctx = { page, file: page.file, html, prefix: prefixOf(page.file), used: new Set() };
  const out = html.replace(REGION_RE, (whole, kind, arg, opts, old) => {
    const made = R[kind](ctx, arg, parseOpts(opts), old);
    return `<!-- ${kind}:${arg}${opts} -->${typeof made === 'string' ? made : old}<!-- /${kind} -->`;
  });
  strayMarkers(out).forEach((m) => fail(page.file, `unbalanced marker ${m}`));
  for (const m of out.matchAll(/<!-- TBD-FOUNDER: ([\w-]+)/g)) {
    if (!F.tbd_founder[m[1]]) fail(page.file, `TBD-FOUNDER: ${m[1]} is not in facts.json tbd_founder`);
    tbd.add(`${m[1]} (${page.file})`);
  }
  if (RELEASE) {
    if (/\{\{[^}]*\}\}|\[\[[^\]]*\]\]/.test(out)) fail(page.file, 'an unresolved {{fact-id}} or [[marker]] is still in the page');
    if (/class="[^"]*\bslot\b/.test(out)) fail(page.file, 'a visible slot is still in the page; slots never ship');
    for (const id of ctx.used) {
      const f = F.byId[id];
      if (f.status === 'slot') fail(page.file, `fact ${id} is a slot`);
      if (!f.source) fail(page.file, `fact ${id} has no source`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.measured || '')) fail(page.file, `fact ${id} has no date`);
    }
  }
  if (out !== html) {
    changed++;
    if (CHECK) fail(page.file, 'is not up to date with facts.json; run node pages/build/stamp.mjs');
    else fs.writeFileSync(file, out);
  }
}

if (RELEASE) {
  const newest = (fs.readFileSync(path.join(PAGES, '..', F.lately.source), 'utf8').match(/^## \[([^\]]+)\]/m) || [])[1];
  if (newest && newest !== F.lately.paradigm[0].version) fail(F.lately.source, `has a newer release (${newest}) than facts.json lately.paradigm[0] (${F.lately.paradigm[0].version})`);
  if (pinState.missing) notices.push(`the pinned commit ${F.excerpts_pinned_to.commit.slice(0, 8)} is not in this clone; excerpts were checked against the working tree`);
  if (tbd.size) notices.push(`deferred founder decisions shown with their working default: ${[...tbd].join(', ')}`);
}

const say = (s) => process.stdout.write(`${s}\n`);
notices.forEach((n) => say(`note  ${n}`));
if (errors.length) {
  errors.forEach((e) => say(`FAIL  ${e}`));
  say(`stamp: ${errors.length} problem(s)`);
  process.exit(1);
}
say(`stamp: ${M.pages.filter((p) => p.built).length} pages ${CHECK ? 'up to date' : `stamped, ${changed} changed`}${RELEASE ? ', release rules hold' : ''}`);
