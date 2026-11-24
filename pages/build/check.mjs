#!/usr/bin/env node
// The checks `atelier check` and the stamp cannot do. Node only, no dependencies.
//   node pages/build/check.mjs                    authoring: every check, pages not built yet are noted
//   node pages/build/check.mjs --release          also refuses slots, unresolved tokens and pages not built yet
//   node pages/build/check.mjs --release --allow-pending   a release check while pages are still being added
//   node pages/build/check.mjs --self-test        only the planted failures
// The planted failures always run first: a checker that cannot fail is not a check.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PAGES, REPO, REGION_RE, loadFacts, loadManifest, readPinned, listCut, isYaml, typedDigits, parseOpts, midCut } from './lib.mjs';

const args = new Set(process.argv.slice(2));
const RELEASE = args.has('--release');
const ALLOW_PENDING = args.has('--allow-pending');

// ── CSS, read without a parser library ────────────────────────────────────
/** Flat list of rules: { selector, media, decls: [[prop, value]] }. */
export function parseCss(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buf = '';
  for (const ch of src) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}') {
      const selector = stack.pop();
      if (selector !== undefined && !selector.startsWith('@media') && !selector.startsWith('@supports')) {
        const decls = buf.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
          const i = d.indexOf(':');
          return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
        });
        rules.push({ selector, media: stack.filter((s) => s.startsWith('@')).join(' '), decls });
      }
      buf = '';
    } else buf += ch;
  }
  return rules;
}

/** The values the design system's foundations allow, read out of the YAML with regular expressions. */
export function foundations(yaml) {
  const sec = yaml.slice(yaml.indexOf('\nfoundations:'), yaml.indexOf('\ncomponents:'));
  const nums = (key) => (sec.match(new RegExp(`\\n\\s+${key}: \\[([^\\]]*)\\]`)) || [, ''])[1].split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  const radius = sec.slice(sec.indexOf('\n  radius:'), sec.indexOf('\n  shadow:'));
  const stacks = sec.slice(sec.indexOf('\n    stacks:'), sec.indexOf('\n    hosting:'));
  return {
    hex: new Set((sec.match(/#[0-9A-Fa-f]{6}\b/g) || []).map((h) => h.toUpperCase())),
    px: new Set([...nums('sizes'), ...nums('scale'), ...nums('layout'), ...[...radius.matchAll(/^\s+[\w-]+: (\d+)\b/gm)].map((m) => Number(m[1]))]),
    stacks: [...stacks.matchAll(/^\s+\w+: '([^']+)'/gm)].map((m) => m[1]),
    motion: [...sec.matchAll(/^\s+(?:trace|stamp): "([^"]+)"/gm)].map((m) => m[1]),
  };
}

const norm = (s) => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim();
const HUE_OK = /\.sig\b|\.s-[cfgsa]\b|\.p-[cfgsa]\b/;

/** Every reason this CSS is off the system. `declared` collects custom-property names. */
export function checkCss(css, found, where, declared = new Set()) {
  const out = [];
  const rules = parseCss(css);
  const stackOk = (v) => found.stacks.some((s) => norm(s) === norm(v.replace(/"[^"]+ Fallback"\s*,\s*/g, '')));
  for (const r of rules) {
    for (const [prop, value] of r.decls) {
      if (prop.startsWith('--')) {
        declared.add(prop);
        for (const h of value.match(/#[0-9A-Fa-f]{3,8}\b/g) || []) if (!found.hex.has(h.toUpperCase())) out.push(`${where}: ${prop}: ${h} is not a foundation colour`);
        if (/\b(rgb|hsl|oklch|oklab|lab|lch|color)a?\(/.test(value)) out.push(`${where}: ${prop} uses a colour function; foundations are hex`);
        for (const m of value.matchAll(/(-?\d*\.?\d+)px\b/g)) if (!found.px.has(Math.abs(Number(m[1])))) out.push(`${where}: ${prop}: ${m[0]} is not on the foundation scales`);
        if (/\d+ms\b/.test(value) && !found.motion.includes(value)) out.push(`${where}: ${prop}: "${value}" is not a motion token`);
        if (/serif|monospace/.test(value) && !stackOk(value)) out.push(`${where}: ${prop} is not a foundation font stack`);
      } else {
        if (/#[0-9A-Fa-f]{3,8}\b/.test(value)) out.push(`${where}: ${r.selector} { ${prop} } holds a colour literal; colours live in tokens`);
      }
      if (/var\(--sym-/.test(value) && !r.selector.split(',').every((s) => HUE_OK.test(s))) out.push(`${where}: ${r.selector} uses a symbol hue outside a sigil, a graph prefix or an excerpt prefix`);
    }
  }
  // the theme tokens are declared twice and must agree
  const theme = (pred) => rules.filter((r) => r.decls.some(([p]) => p === '--ground') && pred(r));
  const sets = {
    'light by default': theme((r) => !r.media && norm(r.selector) === ':root'),
    'dark by prefers-color-scheme': theme((r) => /prefers-color-scheme:\s*dark/.test(r.media)),
    'light by data-theme': theme((r) => /data-theme="?light/.test(r.selector)),
    'dark by data-theme': theme((r) => /data-theme="?dark/.test(r.selector)),
  };
  if (Object.values(sets).some((s) => s.length)) {
    const flat = (name) => {
      if (sets[name].length !== 1) { out.push(`${where}: the theme tokens for "${name}" are declared ${sets[name].length} times, not once`); return null; }
      return JSON.stringify(sets[name][0].decls.map(([p, v]) => [p, norm(v).toUpperCase()]).sort());
    };
    for (const [a, b] of [['light by default', 'light by data-theme'], ['dark by prefers-color-scheme', 'dark by data-theme']]) {
      const x = flat(a), y = flat(b);
      if (x && y && x !== y) out.push(`${where}: the theme tokens differ between "${a}" and "${b}"`);
    }
    const names = (name) => (sets[name][0]?.decls || []).map(([p]) => p).sort().join(' ');
    if (names('light by default') !== names('dark by data-theme')) out.push(`${where}: the light and dark sets do not declare the same tokens`);
  }
  return out;
}

export function undeclaredVars(text, declared, where) {
  return [...new Set([...text.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))].filter((v) => !declared.has(v)).map((v) => `${where}: var(${v}) is used and never declared`);
}

/** Checks on one page's HTML. */
export function checkHtml(html, where, { release = false } = {}) {
  const out = [];
  typedDigits(html).forEach((t) => out.push(`${where}: a digit that was not stamped from facts.json: "${t}"`));
  if (release) {
    if (/\{\{[^}]*\}\}/.test(html)) out.push(`${where}: an unresolved {{fact-id}}`);
    if (/\[\[[^\]]*\]\]/.test(html)) out.push(`${where}: an unresolved [[marker]]`);
    if (/class="[^"]*\bslot\b/.test(html)) out.push(`${where}: an unfilled slot is visible; slots never ship`);
  }
  const bare = html.replace(/<!--[\s\S]*?-->/g, '');
  const h1 = (bare.match(/<h1\b/g) || []).length;
  if (h1 !== 1) out.push(`${where}: ${h1} h1 elements; a page has one`);
  let level = 0;
  for (const m of bare.matchAll(/<h([1-6])\b/g)) {
    const n = Number(m[1]);
    if (n > level + 1) out.push(`${where}: an h${n} follows an h${level}; headings go in order`);
    level = n;
  }
  const ids = [...bare.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].forEach((id) => out.push(`${where}: duplicate id "${id}"`));
  if (/\sstyle="/.test(bare)) out.push(`${where}: a style attribute; styles live in assets/pages.css`);
  if (/<style\b/.test(bare)) out.push(`${where}: a style block; styles live in assets/pages.css`);
  if (!/<a class="key skip" href="#main">/.test(bare) || !/\sid="main"/.test(bare)) out.push(`${where}: no skip link to #main`);
  else if (bare.indexOf('class="key skip"') > (bare.search(/<(a|button|input|summary)\b(?![^>]*class="key skip")/) >>> 0)) out.push(`${where}: the skip link is not the first focusable thing`);
  // nothing may load from another origin
  for (const m of bare.matchAll(/<(?:link|script|img|source|iframe|video|audio|use|image)\b[^>]*?\s(?:src|href|xlink:href|srcset|poster)="([^"]+)"/g)) {
    if (/^(?:[a-z]+:)?\/\//i.test(m[1]) || /^data:/i.test(m[1])) out.push(`${where}: loads ${m[1]}; no request may leave the pages`);
  }
  return out;
}

export function externalLoads(text, where) {
  const out = [];
  for (const m of text.matchAll(/url\(\s*["']?((?:[a-z]+:)?\/\/[^)"']+)/gi)) out.push(`${where}: loads ${m[1]}`);
  if (/@import\b/.test(text)) out.push(`${where}: @import`);
  if (/\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|EventSource|importScripts|import\s*\(/.test(text)) out.push(`${where}: makes a request at runtime`);
  return out;
}

// ── planted failures ──────────────────────────────────────────────────────
function selfTest(found) {
  const light = '--ground:#F4F4F1;--ink:#17181C;';
  const dark = '--ground:#0E0F13;--ink:#ECEBE6;';
  const themed = (l1, d1, l2, d2) => `:root{${l1}}@media (prefers-color-scheme: dark){:root{${d1}}}:root[data-theme="light"]{${l2}}:root[data-theme="dark"]{${d2}}`;
  const page = (body) => `<!doctype html><html lang="en"><head><title>t</title></head><body><a class="key skip" href="#main">Skip</a><main id="main"><h1>One</h1>${body}</main></body></html>`;
  const yaml = ['a:', '  - one', '  - two', '  - three', 'b: x'];
  const cases = [
    ['a custom property off the foundations', () => checkCss(':root{--ground:#FF00AA}', found, 't'), true],
    ['a size off the scales in a custom property', () => checkCss(':root{--gap:13.5px}', found, 't'), true],
    ['a font stack off the system', () => checkCss(':root{--display:"Inter",serif}', found, 't'), true],
    ['light and dark sets that differ between the media query and data-theme', () => checkCss(themed(light, dark, light, dark.replace('#ECEBE6', '#FBFBF9')), found, 't'), true],
    ['a theme set missing a token', () => checkCss(themed(light, dark, light, '--ground:#0E0F13;'), found, 't'), true],
    ['an undeclared var()', () => undeclaredVars('a{color:var(--nope)}', new Set(['--ink']), 't'), true],
    ['a symbol hue outside a sigil', () => checkCss('.key{color:var(--sym-gate)}', found, 't'), true],
    ['a colour literal outside the tokens', () => checkCss('.key{color:#17181C}', found, 't'), true],
    ['a typed digit in prose', () => checkHtml(page('<p>We have 42 users.</p>'), 't'), true],
    ['a typed digit in a spoken attribute', () => checkHtml(page('<p aria-label="Version 9">x</p>'), 't'), true],
    ['an unresolved {{fact-id}} in a release', () => checkHtml(page('<p>{{paradigm.version}} on npm</p>'), 't', { release: true }), true],
    ['an unfilled slot in a release', () => checkHtml(page('<p class="slot inline">waits</p>'), 't', { release: true }), true],
    ['an excerpt that ends inside a list', () => listCut(yaml, 1, 3), true],
    ['an excerpt that begins inside a list', () => listCut(yaml, 3, 4), true],
    ['an excerpt that ends on an open key', () => listCut(yaml, 1, 1), true],
    ['two h1', () => checkHtml(page('<h1>Two</h1>'), 't'), true],
    ['a skipped heading level', () => checkHtml(page('<h3>Three</h3>'), 't'), true],
    ['a duplicate id', () => checkHtml(page('<p id="x"></p><p id="x"></p>'), 't'), true],
    ['a request to another origin', () => checkHtml(page('<script src="https://cdn.example/x.js"></script>'), 't'), true],
    ['a font from another origin', () => externalLoads('@font-face{src:url("https://fonts.example/f.woff2")}', 't'), true],
    ['a runtime fetch', () => externalLoads('fetch("facts.json")', 't'), true],
    ['a long id is not cut in the drawing', () => (midCut('x'.repeat(60)).length <= 20 ? ['cut'] : []), true],
    // and the same checks stay quiet on clean input
    ['clean tokens', () => checkCss(`${themed(light, dark, light, dark)}:root{--display:"Fraunces", "Fraunces Fallback", Georgia, serif;--trace:120ms linear}.s-c{color:var(--sym-component)}`, found, 't'), false],
    ['a clean page with a stamped number', () => checkHtml(page('<p><!-- fact:x -->42<!-- /fact --> tools</p><h2>Two</h2>'), 't', { release: true }), false],
    ['an excerpt that ends where its list ends', () => listCut(yaml, 1, 4), false],
  ];
  const bad = [];
  for (const [name, run, shouldFail] of cases) {
    const got = run().length > 0;
    if (got !== shouldFail) bad.push(shouldFail ? `the checker missed: ${name}` : `the checker flagged clean input: ${name}`);
  }
  return { ran: cases.length, bad };
}

// ── run ───────────────────────────────────────────────────────────────────
const say = (s) => process.stdout.write(`${s}\n`);
const found = foundations(fs.readFileSync(path.join(REPO, '.atelier/systems/pages/design-system.yaml'), 'utf8'));
const st = selfTest(found);
if (st.bad.length) {
  st.bad.forEach((b) => say(`FAIL  self-test: ${b}`));
  process.exit(1);
}
say(`check: self-test, ${st.ran} planted cases behave`);
if (args.has('--self-test')) process.exit(0);

const F = loadFacts();
const M = loadManifest();
const errors = [];
const notices = [];
const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const cssPath = path.join(PAGES, 'assets/pages.css');
const jsPath = path.join(PAGES, 'assets/pages.js');
const css = fs.readFileSync(cssPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');
const declared = new Set();
errors.push(...checkCss(css, found, 'assets/pages.css', declared));
errors.push(...undeclaredVars(css, declared, 'assets/pages.css'));
errors.push(...externalLoads(css, 'assets/pages.css'), ...externalLoads(js, 'assets/pages.js'));
for (const m of css.matchAll(/url\(\s*["']?([^)"']+)/g)) {
  if (!fs.existsSync(path.resolve(PAGES, 'assets', m[1]))) errors.push(`assets/pages.css: ${m[1]} does not exist`);
}
const budget = (what, n, max) => (n > max ? errors : notices).push(`${what}: ${kb(n)} gzipped${n > max ? `, over the ${kb(max)} budget` : ` of ${kb(max)}`}`);
budget('assets/pages.css', gz(Buffer.from(css)), 12 * 1024);
budget('assets/pages.js', gz(Buffer.from(js)), 4 * 1024);
const fonts = [...new Set([...css.matchAll(/url\(\s*["']?(fonts\/[^)"']+)/g)].map((m) => m[1]))];
const fontBytes = fonts.reduce((s, f) => s + fs.statSync(path.join(PAGES, 'assets', f)).size, 0);
(fontBytes > 90 * 1024 ? errors : notices).push(`fonts: ${kb(fontBytes)} in ${fonts.length} files${fontBytes > 90 * 1024 ? ', over the 90 KB budget' : ' of 90 KB'}`);
if (!fs.readdirSync(path.join(PAGES, 'assets/fonts')).some((f) => /^OFL/.test(f))) errors.push('assets/fonts: the licence files did not travel with the fonts');

const built = M.pages.filter((p) => p.built);
const pending = M.pages.filter((p) => !p.built);
for (const page of built) {
  const file = path.join(PAGES, page.file);
  if (!fs.existsSync(file)) { errors.push(`${page.file}: marked built and missing`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  errors.push(...checkHtml(html, page.file, { release: RELEASE }));
  errors.push(...undeclaredVars(html, declared, page.file));
  budget(page.file, gz(Buffer.from(html)), 30 * 1024);
  // excerpts must not stop inside a list
  for (const m of html.matchAll(REGION_RE)) {
    if (m[1] !== 'excerpt') continue;
    const ex = F.excerpts[m[2]];
    const o = parseOpts(m[3]);
    if (!ex?.lines || !isYaml(ex.path) || o.cut === 'said') continue;
    const [a, b] = o.lines ? o.lines.split('-').map(Number) : ex.lines;
    const text = readPinned(F, ex.path);
    if (text === null) { errors.push(`${page.file}: excerpt ${m[2]}: ${ex.path} is missing`); continue; }
    listCut(text.split('\n'), a, b).forEach((why) => errors.push(`${page.file}: excerpt ${m[2]} (${ex.path} ${a}-${b}) ${why}`));
  }
  // internal links resolve
  const dir = path.dirname(file);
  const base = page.id === '404' ? PAGES : dir;
  for (const m of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:|mailto:)/.test(url)) continue;
    if (url.startsWith('/')) { if (!(page.id === '404' && url === M.base_path)) errors.push(`${page.file}: root-relative link ${url}`); continue; }
    const [rel, hash] = url.split('#');
    const target = rel ? path.resolve(base, rel) : file;
    const isPending = pending.some((p) => path.join(PAGES, p.file) === target);
    if (isPending) continue;
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) { errors.push(`${page.file}: link ${url} does not resolve to a file`); continue; }
    if (hash && target.endsWith('.html') && !new RegExp(`\\sid="${hash}"`).test(fs.readFileSync(target, 'utf8'))) errors.push(`${page.file}: link ${url} has no such anchor`);
  }
}
if (pending.length) {
  const msg = `not built yet, and linked from the nav: ${pending.map((p) => p.file).join(', ')}`;
  if (RELEASE && !ALLOW_PENDING) errors.push(`pages ${msg}. A release does not ship dead links`);
  else notices.push(`pages ${msg}`);
}

notices.forEach((n) => say(`note  ${n}`));
if (errors.length) {
  errors.forEach((e) => say(`FAIL  ${e}`));
  say(`check: ${errors.length} problem(s)`);
  process.exit(1);
}
say(`check: ${built.length} pages, 0 problems${RELEASE ? ' (release rules)' : ''}`);
