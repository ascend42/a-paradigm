/**
 * The Claude Code plugin's MCP launch must not let npx read the project's package.json.
 *
 * npm 11 applies the nearest package.json's devEngines to npx. The plugin started paradigm-mcp from the project folder,
 * so a repo requiring pnpm (devEngines.packageManager onFail "error", e.g. a-atelier) made npx exit with
 * EBADDEVENGINES and the plugin server showed as CONNECTION_CLOSED. `--prefix=${CLAUDE_PLUGIN_ROOT}` points npm at
 * the plugin folder, which has no package.json; the project still arrives as paradigm-mcp's argument.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..', '..');
const PLUGIN = path.join(REPO, 'plugins', 'paradigm');

interface StdioServer { command: string; args: string[] }
const server = (): StdioServer =>
  JSON.parse(fs.readFileSync(path.join(PLUGIN, '.mcp.json'), 'utf8')).mcpServers.paradigm;

describe('plugin MCP launch', () => {
  it('npx runs with the plugin folder as its prefix, before the package and bin', () => {
    const { command, args } = server();
    expect(command).toBe('npx');
    const prefix = args.indexOf('--prefix=${CLAUDE_PLUGIN_ROOT}');
    expect(prefix).toBeGreaterThanOrEqual(0);
    expect(prefix).toBeLessThan(args.indexOf('paradigm-mcp'));
  });

  it('the project is still passed to paradigm-mcp as its argument', () => {
    const { args } = server();
    expect(args[args.indexOf('paradigm-mcp') + 1]).toBe('${CLAUDE_PROJECT_DIR}');
  });

  it('the plugin folder has no package.json for npm to apply devEngines from', () => {
    expect(fs.existsSync(path.join(PLUGIN, 'package.json'))).toBe(false);
  });
});
