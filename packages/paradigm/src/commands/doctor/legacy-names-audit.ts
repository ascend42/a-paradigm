/**
 * Legacy tool-name audit (7.13.0 MCP surface cut, T-2026-09-26-005).
 *
 * Scans a project's agent-facing instruction surfaces for pre-7.13
 * `paradigm_<family>_<op>` tool names. Those names remain hidden server-side
 * aliases through 7.14 (removed 7.15), but agents only call LISTED tools and
 * permission allowlists naming them (`mcp__paradigm__paradigm_lore_record`)
 * no longer match anything — the host re-prompts.
 *
 * Surfaces: CLAUDE.md, AGENTS.md, .cursor/rules/**, .claude/settings.json and
 * .claude/settings.local.json `permissions.{allow,deny,ask}`.
 *
 * The legacy map is the single source of truth in paradigm-mcp.
 */
import * as fs from 'fs';
import * as path from 'path';
// Relative-path import into bundled paradigm-mcp source (same pattern as learning-stores).
import { LEGACY_TOOL_MAP, type LegacyToolTarget } from '../../../../paradigm-mcp/src/tools/legacy-tool-map.js';

export interface LegacyNameHit {
  /** Project-relative file path */
  file: string;
  /** Legacy tool name found */
  legacy: string;
  /**
   * Suggested replacement. Text surfaces: call syntax, e.g.
   * `paradigm_lore({op:'record'})`. Permission lists: the allowlist form,
   * e.g. `mcp__paradigm__paradigm_lore` (server prefix preserved from the hit).
   */
  replacement: string;
  /** Occurrences in that file */
  count: number;
  /** True when found in a settings.json permission list */
  permission: boolean;
}

export interface LegacyNameAudit {
  hits: LegacyNameHit[];
  filesScanned: number;
}

/** Map entries whose name actually changed (anchors / same-name families excluded). */
export function renamedLegacyEntries(
  map: Record<string, LegacyToolTarget> = LEGACY_TOOL_MAP,
): Record<string, LegacyToolTarget> {
  const out: Record<string, LegacyToolTarget> = {};
  for (const [k, t] of Object.entries(map)) {
    if (t.tool !== k || t.args) out[k] = t;
  }
  return out;
}

export function describeReplacement(t: LegacyToolTarget): string {
  const pairs: string[] = [];
  if (t.op) pairs.push(`op:'${t.op}'`);
  for (const [k, v] of Object.entries(t.args ?? {})) pairs.push(`${k}:'${v}'`);
  return pairs.length ? `${t.tool}({${pairs.join(', ')}})` : t.tool;
}

/** Default MCP server prefix for permission-allowlist suggestions. */
export const DEFAULT_PERMISSION_PREFIX = 'mcp__paradigm__';

/**
 * Allowlist form of a replacement: `<prefix><family tool>`. Permission entries
 * match tool NAMES, so op / fixed args are dropped — `paradigm_lore_record`
 * and `paradigm_lore_search` both become `mcp__paradigm__paradigm_lore`.
 */
export function describePermissionReplacement(t: LegacyToolTarget, prefix: string = DEFAULT_PERMISSION_PREFIX): string {
  return `${prefix}${t.tool}`;
}

function legacyRegex(keys: string[]): RegExp {
  const alt = [...keys].sort((a, b) => b.length - a.length).join('|');
  // `_` permitted before the name so `mcp__paradigm__<name>` permission strings match.
  return new RegExp(`(?<![A-Za-z0-9])(${alt})(?![A-Za-z0-9_])`, 'g');
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFilesRecursive(p));
    else if (/\.(mdc|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

function permissionStrings(settingsFile: string): string[] {
  try {
    const json = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const perms = json?.permissions ?? {};
    const out: string[] = [];
    for (const key of ['allow', 'deny', 'ask']) {
      if (Array.isArray(perms[key])) out.push(...perms[key].filter((s: unknown) => typeof s === 'string'));
    }
    return out;
  } catch {
    return [];
  }
}

export function auditLegacyToolNames(
  rootDir: string,
  map: Record<string, LegacyToolTarget> = LEGACY_TOOL_MAP,
): LegacyNameAudit {
  const entries = renamedLegacyEntries(map);
  const re = legacyRegex(Object.keys(entries));
  const hits: LegacyNameHit[] = [];
  let filesScanned = 0;

  const scan = (abs: string, text: string, permission: boolean) => {
    filesScanned++;
    const counts = new Map<string, number>();
    const prefixes = new Map<string, string>();
    for (const m of text.matchAll(re)) {
      counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
      if (permission && !prefixes.has(m[1])) {
        // Preserve the server prefix the allowlist already uses (mcp__paradigm__,
        // mcp__plugin_paradigm_paradigm__, …); fall back to the default.
        const lineStart = text.lastIndexOf('\n', (m.index ?? 0) - 1) + 1;
        const before = text.slice(lineStart, m.index);
        const pm = before.match(/(mcp__\S*__)$/);
        prefixes.set(m[1], pm ? pm[1] : DEFAULT_PERMISSION_PREFIX);
      }
    }
    for (const [legacy, count] of counts) {
      hits.push({
        file: path.relative(rootDir, abs) || abs,
        legacy,
        replacement: permission
          ? describePermissionReplacement(entries[legacy], prefixes.get(legacy))
          : describeReplacement(entries[legacy]),
        count,
        permission,
      });
    }
  };

  const textFiles = [
    path.join(rootDir, 'CLAUDE.md'),
    path.join(rootDir, 'AGENTS.md'),
    ...listFilesRecursive(path.join(rootDir, '.cursor', 'rules')),
  ];
  for (const f of textFiles) {
    if (fs.existsSync(f)) scan(f, fs.readFileSync(f, 'utf8'), false);
  }
  for (const name of ['settings.json', 'settings.local.json']) {
    const f = path.join(rootDir, '.claude', name);
    if (fs.existsSync(f)) scan(f, permissionStrings(f).join('\n'), true);
  }
  return { hits, filesScanned };
}
