/**
 * @symbol #doctor
 *
 * MCP config portability: a project-level MCP config (.mcp.json, .cursor/mcp.json, .cline/mcp.json) is committed and
 * shared, so a server entry that names an absolute folder (`cwd`, or an absolute path in `args`) breaks every other
 * clone: on a teammate's machine the folder does not exist, the server fails to start and the agent quietly loses its
 * tools. Paradigm used to write `cwd: <projectRoot>` there; `paradigm sync` now rewrites the paradigm entry without it.
 */
import * as fs from 'fs';
import * as path from 'path';

export const PROJECT_MCP_CONFIGS: readonly string[] = Object.freeze(['.mcp.json', path.join('.cursor', 'mcp.json'), path.join('.cline', 'mcp.json')]);

export interface McpPortabilityHit {
  /** config file, relative to the project root */
  file: string;
  /** server name */
  server: string;
  /** the field that names an absolute path: 'cwd' or 'args[i]' */
  field: string;
  value: string;
}

const isAbsolutePath = (v: unknown): v is string => typeof v === 'string' && (path.posix.isAbsolute(v) || path.win32.isAbsolute(v)) && !v.includes('${');

/** Server entries in the project's MCP configs that name an absolute folder (never throws; unreadable files are skipped). */
export function auditMcpPortability(rootDir: string): McpPortabilityHit[] {
  const hits: McpPortabilityHit[] = [];
  for (const rel of PROJECT_MCP_CONFIGS) {
    let servers: Record<string, unknown>;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(rootDir, rel), 'utf8')) as { mcpServers?: unknown };
      if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') continue;
      servers = cfg.mcpServers as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const [name, raw] of Object.entries(servers)) {
      if (!raw || typeof raw !== 'object') continue;
      const s = raw as { cwd?: unknown; args?: unknown };
      if (isAbsolutePath(s.cwd)) hits.push({ file: rel, server: name, field: 'cwd', value: s.cwd });
      if (Array.isArray(s.args)) s.args.forEach((a, i) => { if (isAbsolutePath(a)) hits.push({ file: rel, server: name, field: `args[${i}]`, value: a }); });
    }
  }
  return hits;
}
