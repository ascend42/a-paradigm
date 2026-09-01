/**
 * Env block for the spawned paradigm-mcp server. Makes the bare `paradigm-mcp`
 * command resolve even when the process spawning the MCP server has a
 * GUI/non-login PATH that omits the global bin dir (e.g. /opt/homebrew/bin on
 * macOS). Launch-context-independence fix, same class as 7.8.1's project-root fix.
 *
 * @param expandVars target client expands ${VAR} in env values (Claude Code: yes;
 *   Claude Desktop: no; Cursor: verify). false → self-contained list, no ${VAR}.
 * @param platform  generation-time platform; value is committed, regenerated per machine.
 */
export function mcpServerEnv(
  expandVars = true,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> | undefined {
  if (platform === 'win32') {
    return expandVars ? { PATH: '${PATH};${APPDATA}\\npm' } : undefined;
  }
  if (expandVars) {
    return {
      PATH: '${PATH}:/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin',
    };
  }
  return { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' };
}
