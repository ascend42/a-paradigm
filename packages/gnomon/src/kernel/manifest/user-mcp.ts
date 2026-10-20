/**
 * @symbol #manifest-loader
 *
 * The MCP server names the user already has (Aegis S0b M1): a mod's derived server name (gm_/gx_) must not collide
 * with one of them (COLLISION, at stage, decide and load). Reads only the server KEYS, never their launch or env:
 *   - user scope:    <userHome>/.claude.json  mcpServers
 *   - local scope:   <userHome>/.claude.json  projects[*].mcpServers
 *   - project scope: <repo>/.mcp.json          mcpServers (when a repo is given)
 * Fail-soft: a missing or malformed file contributes nothing (the load-time re-check covers later edits).
 */
import * as fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 8 * 1024 * 1024;

function readJson(file: string): unknown {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const keysOf = (v: unknown): string[] => (isObj(v) && isObj(v.mcpServers) ? Object.keys(v.mcpServers) : []);

/** The user's MCP server names (sorted, unique) from user, local and (optionally) project scope. */
export function userMcpServerNames(opts: { userHome?: string; repo?: string }): string[] {
  const out = new Set<string>();
  if (opts.userHome) {
    const cfg = readJson(path.join(opts.userHome, '.claude.json'));
    for (const k of keysOf(cfg)) out.add(k);
    if (isObj(cfg) && isObj(cfg.projects)) for (const p of Object.values(cfg.projects)) for (const k of keysOf(p)) out.add(k);
  }
  if (opts.repo) for (const k of keysOf(readJson(path.join(opts.repo, '.mcp.json')))) out.add(k);
  return [...out].sort();
}
