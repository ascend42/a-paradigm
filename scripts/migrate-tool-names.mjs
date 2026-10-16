#!/usr/bin/env node
/**
 * migrate-tool-names.mjs — 7.13.0 MCP surface cut reference codemod (T-2026-09-26-005).
 *
 * Rewrites agent-facing references to legacy `paradigm_<family>_<op>` tool
 * names into the 7.13 family/anchor form. Driven ENTIRELY by the single source
 * of truth packages/paradigm-mcp/src/tools/legacy-tool-map.ts (parsed, never
 * duplicated here).
 *
 * Forms:
 *   call      paradigm_lore_record({ a })   → paradigm_lore({op:'record', a })
 *             paradigm_lore_record()        → paradigm_lore({op:'record'})
 *   wrapped   `paradigm_lore_record`        → `paradigm_lore` (op `record`)
 *   bare      paradigm_lore_record          → paradigm_lore (op `record`)   [markdown]
 *                                           → paradigm_lore (op: record)    [code/shell]
 *   perm      mcp__paradigm__paradigm_lore_record → mcp__paradigm__paradigm_lore
 *             allowed-tools: / tools: frontmatter lines → family name (deduped)
 *
 * Map entries whose target name equals the key (anchors, `paradigm_tags`) are
 * left alone — the name is still valid. Idempotent: rewritten output contains
 * no rewritable key, so a second run is a no-op.
 *
 * Usage:
 *   node scripts/migrate-tool-names.mjs            # dry run, prints per-file counts
 *   node scripts/migrate-tool-names.mjs --write    # apply
 *   node scripts/migrate-tool-names.mjs --write path/a.md path/b.ts   # explicit files
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');
export const MAP_FILE = path.join(REPO_ROOT, 'packages/paradigm-mcp/src/tools/legacy-tool-map.ts');

/** Parse LEGACY_TOOL_MAP out of the TS source (object literal only — no TS syntax inside). */
export function loadLegacyMap(file = MAP_FILE) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/export const LEGACY_TOOL_MAP[^=]*=\s*(\{[\s\S]*?\n\});/);
  if (!m) throw new Error(`LEGACY_TOOL_MAP not found in ${file}`);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${m[1]});`)();
}

/** Entries that actually need rewriting (the name changed or args were folded in). */
export function rewritableEntries(map) {
  const out = {};
  for (const [key, t] of Object.entries(map)) {
    if (t.tool !== key || t.args) out[key] = t;
  }
  return out;
}

export function legacyTokenRegex(keys) {
  const alt = [...keys].sort((a, b) => b.length - a.length).join('|');
  // `_` allowed before the key so `mcp__paradigm__<key>` is caught; alnum is not.
  return new RegExp(`(?<![A-Za-z0-9])(${alt})(?![A-Za-z0-9_])`, 'g');
}

const MD_EXT = new Set(['.md', '.mdc', '.mdx']);

function argPairs(t) {
  const pairs = [];
  if (t.op) pairs.push(['op', t.op]);
  for (const [k, v] of Object.entries(t.args ?? {})) pairs.push([k, v]);
  return pairs;
}

/**
 * Rewrite one file's text. `ext` selects markdown vs code phrasing.
 * Returns { text, count }.
 */
export function rewriteText(text, ext, map) {
  const entries = rewritableEntries(map);
  const re = legacyTokenRegex(Object.keys(entries));
  const isMd = MD_EXT.has(ext);
  let count = 0;
  let out = '';
  let last = 0;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const t = entries[key];
    const start = m.index;
    let end = start + key.length;
    const pairs = argPairs(t);
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = text.indexOf('\n', start);
    const line = text.slice(lineStart, lineEndIdx === -1 ? text.length : lineEndIdx);
    const before = text.slice(lineStart, start);
    const after = text.slice(end);
    let rep;

    const isPerm = before.endsWith('__') || /^\s*(allowed-tools|tools)\s*:/.test(line);
    const call = after.match(/^\(\s*\{\s*\}\s*\)|^\(\s*\)|^\(\{[ \t]*(\r?\n)?/);
    if (isPerm) {
      rep = t.tool;
    } else if (call) {
      // Quote: markdown always '; code uses " when the match sits inside a '…' string.
      let q = "'";
      if (!isMd) {
        const singles = (before.match(/(?<!\\)'/g) || []).length;
        if (singles % 2 === 1) q = '"';
      }
      const obj = pairs.map(([k, v]) => `${k}:${q}${v}${q}`).join(', ');
      const tok = call[0];
      if (tok.startsWith('({') && !/\}\s*\)$/.test(tok)) {
        rep = `${t.tool}({${obj},${call[1] ? call[1] : ' '}`;
      } else {
        rep = `${t.tool}({${obj}})`;
      }
      end += tok.length;
    } else {
      // Wrapped in a code delimiter (` or an escaped \` inside a template literal)?
      let delim = null;
      for (const d of ['\\`', '`']) {
        if (before.endsWith(d) && after.startsWith(d)) { delim = d; break; }
      }
      if (delim) {
        const suffix = pairs.map(([k, v]) => `${k} ${delim}${v}${delim}`).join(', ');
        // The opening delim is already emitted; consume the closing one and re-emit it.
        rep = `${t.tool}${delim} (${suffix})`;
        end += delim.length;
      } else if (isMd) {
        rep = `${t.tool} (${pairs.map(([k, v]) => `${k} \`${v}\``).join(', ')})`;
      } else {
        rep = `${t.tool} (${pairs.map(([k, v]) => `${k}: ${v}`).join(', ')})`;
      }
    }
    out += text.slice(last, start) + rep;
    last = end;
    re.lastIndex = end;
    count++;
  }
  out += text.slice(last);
  if (count > 0) out = dedupeToolLists(out);
  return { text: out, count };
}

/** Collapse duplicate names produced on `allowed-tools:` / `tools:` single-line lists. */
function dedupeToolLists(text) {
  return text.replace(/^(\s*(?:allowed-tools|tools)\s*:[ \t]*)(.+)$/gm, (full, head, body) => {
    const bracket = body.trim().startsWith('[') && body.trim().endsWith(']');
    const inner = bracket ? body.trim().slice(1, -1) : body;
    if (!inner.includes(',')) return full;
    const seen = new Set();
    const items = inner.split(',').map(s => s.trim()).filter(s => {
      if (!s || seen.has(s)) return false;
      seen.add(s);
      return true;
    });
    return head + (bracket ? `[${items.join(', ')}]` : items.join(', '));
  });
}

// ── Target surfaces ─────────────────────────────────────────────────────────

/** Agent-facing surfaces the codemod rewrites (git-tracked files under these). */
export const TARGETS = [
  'plugins',
  'packages/paradigm/src/core/ide-adapters',
  'packages/paradigm/src/commands/hooks/scripts',
  'packages/paradigm-mcp/src/utils/role-prompts.ts',
  'packages/paradigm-mcp/src/resources/guidance.ts',
  'packages/paradigm-mcp/src/resources/context.ts',
  'packages/paradigm-mcp/src/utils/gap-narrator.ts',
  'packages/paradigm/src/utils/gap-narrator.ts',
  '.cursor',
  '.paradigm/protocols',
  '.paradigm/agents',
  'CLAUDE.md',
  'AGENTS.md',
  'docs/guides',
  'docs/commands',
  'packages/site/src/content/docs',
];

/**
 * Never rewritten even when under a target. Historical records, tests (they
 * assert on source strings and are fixed by hand), and seed-habits.json (its
 * `tools` arrays are MATCHED against toolsCalled, which records canonical
 * LEGACY names — rewriting them would break habit evaluation).
 */
export const EXCLUDE = [
  /(^|\/)CHANGELOG[^/]*$/i,
  /(^|\/)(lore|history|events|reviews)\//,
  /^docs\/(private|specs)\//,
  /\.test\.[cm]?[jt]sx?$/,
  /(^|\/)seed-habits\.json$/,
  /(^|\/)(dist|node_modules)\//,
];

const TEXT_EXT = new Set(['.md', '.mdc', '.mdx', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.sh', '.json', '.yaml', '.yml', '.agent', '.purpose', '.txt', '.swift']);

export function listTargetFiles(root = REPO_ROOT) {
  const raw = execFileSync('git', ['ls-files', '-z', '--', ...TARGETS], { cwd: root, encoding: 'utf8' });
  return raw.split('\0').filter(Boolean)
    .filter(f => TEXT_EXT.has(path.extname(f)) || path.basename(f) === 'CLAUDE.md')
    .filter(f => !EXCLUDE.some(rx => rx.test(f)))
    .filter(f => fs.existsSync(path.join(root, f)));
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const explicit = args.filter(a => !a.startsWith('--'));
  const map = loadLegacyMap();
  const files = explicit.length ? explicit : listTargetFiles();
  let total = 0;
  let changed = 0;
  for (const f of files) {
    const abs = path.resolve(REPO_ROOT, f);
    const src = fs.readFileSync(abs, 'utf8');
    const { text, count } = rewriteText(src, path.extname(f), map);
    if (count === 0) continue;
    total += count;
    changed++;
    process.stdout.write(`${String(count).padStart(5)}  ${f}\n`);
    if (write) fs.writeFileSync(abs, text, 'utf8');
  }
  process.stdout.write(`${write ? 'rewrote' : 'would rewrite'} ${total} reference(s) in ${changed} file(s)\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
