/**
 * paradigm mcp use-dev / use-prod - Switch MCP configs between dev and prod
 *
 * Dev mode: MCP configs point to local working directory's built packages
 * Prod mode: MCP configs point to the global `paradigm-mcp` binary
 *
 * This enables safe development and testing of CLI/MCP changes
 * without affecting the production install at ~/.paradigm-cli/.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  detectAllClients,
  getServersFromConfig,
  type AIClient,
} from './setup.js';

// ============================================================================
// Types
// ============================================================================

export interface SwitchOptions {
  client?: string;
  json?: boolean;
}

type McpMode = 'dev' | 'prod';

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Find the paradigm source repo root from CWD or a known path.
 * Looks for the packages/paradigm-mcp directory structure.
 */
function findParadigmSourceRoot(): string | null {
  // Try CWD first
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'packages', 'paradigm-mcp', 'dist', 'index.js'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Detect if a server entry is a paradigm MCP server
 */
function isParadigmServer(serverName: string, command: string): boolean {
  return (
    serverName.toLowerCase().includes('paradigm') ||
    command === 'paradigm-mcp' ||
    command.includes('paradigm-mcp')
  );
}

/**
 * Switch a client's paradigm MCP server config to dev or prod mode
 */
function switchClient(
  client: AIClient,
  mode: McpMode,
  devMcpPath: string
): { success: boolean; message: string; changed: boolean } {
  if (!fs.existsSync(client.configPath)) {
    return { success: false, message: 'Config file not found', changed: false };
  }

  let config: any;
  try {
    const content = fs.readFileSync(client.configPath, 'utf-8');
    config = JSON.parse(content);
  } catch {
    return { success: false, message: 'Could not parse config', changed: false };
  }

  let changed = false;

  if (client.id === 'continue') {
    // Continue format
    const servers = config?.experimental?.modelContextProtocolServers || [];
    for (const server of servers) {
      const transport = server?.transport;
      if (!transport) continue;

      const isParadigm = (transport.command === 'paradigm-mcp') ||
        (transport.command === 'node' && String(transport.args?.[0] || '').includes('paradigm-mcp'));

      if (isParadigm) {
        if (mode === 'dev') {
          transport.command = 'node';
          transport.args = [devMcpPath, '.'];
        } else {
          transport.command = 'paradigm-mcp';
          transport.args = ['.'];
        }
        changed = true;
      }
    }
  } else {
    // Standard MCP format (Cursor, Claude Desktop, Claude Code, Cline)
    const servers = config?.mcpServers || {};
    for (const [name, server] of Object.entries(servers) as [string, any][]) {
      if (!isParadigmServer(name, server?.command || '')) continue;

      if (mode === 'dev') {
        server.command = 'node';
        server.args = [devMcpPath, ...(server.args?.filter((a: string) => a !== 'paradigm-mcp') || ['.'])];
        // Ensure '.' is in args if no path argument exists
        if (!server.args.some((a: string) => a === '.' || a.startsWith('/'))) {
          server.args.push('.');
        }
        // Remove any duplicate '.'
        server.args = [...new Set(server.args)];
      } else {
        server.command = 'paradigm-mcp';
        server.args = ['.'];
      }
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(client.configPath, JSON.stringify(config, null, 2) + '\n');
  }

  return {
    success: true,
    message: changed ? `Switched to ${mode} mode` : 'No paradigm server found',
    changed,
  };
}

// ============================================================================
// Commands
// ============================================================================

/**
 * paradigm mcp use-dev
 *
 * Updates MCP configs to point to the local working directory's
 * built packages/paradigm-mcp/dist/index.js
 */
export async function mcpUseDevCommand(options: SwitchOptions): Promise<void> {
  const spinner = ora();

  // Find paradigm source root
  const sourceRoot = findParadigmSourceRoot();
  if (!sourceRoot) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Not in paradigm source repo or packages/paradigm-mcp/dist/index.js not found' }));
    } else {
      console.log(chalk.red('\nNot in paradigm source repo.'));
      console.log(chalk.gray('Run from the a-paradigm directory, or ensure packages/paradigm-mcp/dist/index.js exists.'));
      console.log(chalk.gray('You may need to run `npm run build` first.\n'));
    }
    return;
  }

  const devMcpPath = path.join(sourceRoot, 'packages', 'paradigm-mcp', 'dist', 'index.js');
  if (!fs.existsSync(devMcpPath)) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'MCP dist not built', path: devMcpPath }));
    } else {
      console.log(chalk.red('\nMCP dist not built.'));
      console.log(chalk.gray(`Expected: ${devMcpPath}`));
      console.log(chalk.gray('Run `npm run build` first.\n'));
    }
    return;
  }

  if (!options.json) {
    console.log(chalk.blue('\n🔧 Switching to DEV mode\n'));
    console.log(chalk.gray(`  Source: ${devMcpPath}\n`));
  }

  const clients = detectAllClients();
  const clientsToSwitch = options.client
    ? clients.filter(c => c.id === options.client)
    : clients;

  const results: Array<{ client: string; changed: boolean; message: string }> = [];

  for (const client of clientsToSwitch) {
    spinner.start(`Switching ${client.name}...`);
    const result = switchClient(client, 'dev', devMcpPath);

    if (result.changed) {
      spinner.succeed(`${client.name} → DEV`);
    } else if (result.success) {
      spinner.info(`${client.name}: ${result.message}`);
    } else {
      spinner.warn(`${client.name}: ${result.message}`);
    }

    results.push({ client: client.id, changed: result.changed, message: result.message });
  }

  const switched = results.filter(r => r.changed).length;

  if (!options.json) {
    console.log();
    if (switched > 0) {
      console.log(chalk.green(`✓ Switched ${switched} client(s) to DEV mode\n`));
      console.log(chalk.gray('  Restart your AI client(s) for changes to take effect.'));
      console.log(chalk.gray('  Run `paradigm mcp use-prod` to switch back.\n'));
    } else {
      console.log(chalk.yellow('No paradigm MCP servers found to switch.\n'));
      console.log(chalk.gray('Run `paradigm mcp setup` first to configure MCP.\n'));
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ mode: 'dev', devPath: devMcpPath, results }, null, 2));
  }
}

/**
 * paradigm mcp use-prod
 *
 * Reverts MCP configs to use the global paradigm-mcp binary
 */
export async function mcpUseProdCommand(options: SwitchOptions): Promise<void> {
  const spinner = ora();

  if (!options.json) {
    console.log(chalk.blue('\n🔧 Switching to PROD mode\n'));
  }

  const clients = detectAllClients();
  const clientsToSwitch = options.client
    ? clients.filter(c => c.id === options.client)
    : clients;

  const results: Array<{ client: string; changed: boolean; message: string }> = [];

  for (const client of clientsToSwitch) {
    spinner.start(`Switching ${client.name}...`);
    const result = switchClient(client, 'prod', '');

    if (result.changed) {
      spinner.succeed(`${client.name} → PROD`);
    } else if (result.success) {
      spinner.info(`${client.name}: ${result.message}`);
    } else {
      spinner.warn(`${client.name}: ${result.message}`);
    }

    results.push({ client: client.id, changed: result.changed, message: result.message });
  }

  const switched = results.filter(r => r.changed).length;

  if (!options.json) {
    console.log();
    if (switched > 0) {
      console.log(chalk.green(`✓ Switched ${switched} client(s) to PROD mode\n`));
      console.log(chalk.gray('  Restart your AI client(s) for changes to take effect.\n'));
    } else {
      console.log(chalk.yellow('No paradigm MCP servers found to switch.\n'));
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ mode: 'prod', results }, null, 2));
  }
}

/**
 * Enhanced paradigm mcp status - shows DEV/PROD mode per client
 */
export async function mcpSwitchStatusCommand(options: { json?: boolean }): Promise<void> {
  console.log(chalk.blue('\n🔌 Paradigm MCP Status\n'));

  const clients = detectAllClients();
  const results: Array<{
    client: string;
    name: string;
    detected: boolean;
    configured: boolean;
    mode: McpMode | 'unknown' | 'none';
    path?: string;
    servers: Array<{ name: string; command: string; mode: McpMode | 'unknown' }>;
  }> = [];

  for (const client of clients) {
    const servers = getServersFromConfig(client);
    const paradigmServers = servers.filter(s =>
      isParadigmServer(s.name, s.command)
    );

    let clientMode: McpMode | 'unknown' | 'none' = 'none';
    const serverDetails: Array<{ name: string; command: string; mode: McpMode | 'unknown' }> = [];

    for (const server of paradigmServers) {
      let mode: McpMode | 'unknown' = 'unknown';
      if (server.command === 'paradigm-mcp') {
        mode = 'prod';
      } else if (server.command === 'node' && server.args.some(a => a.includes('paradigm-mcp'))) {
        mode = 'dev';
      }
      serverDetails.push({ name: server.name, command: server.command, mode });
      if (clientMode === 'none') clientMode = mode;
    }

    const configured = paradigmServers.length > 0;
    const modeLabel = clientMode === 'dev' ? chalk.yellow('[DEV]') :
      clientMode === 'prod' ? chalk.green('[PROD]') :
      clientMode === 'none' ? chalk.gray('[—]') : chalk.gray('[?]');

    const icon = client.detected
      ? (configured ? chalk.green('✓') : chalk.yellow('○'))
      : chalk.gray('○');
    const status = configured
      ? `configured ${modeLabel}`
      : (client.detected ? chalk.yellow('not configured') : chalk.gray('not detected'));

    console.log(`  ${icon} ${client.name}: ${status}`);
    if (configured) {
      for (const s of serverDetails) {
        const sMode = s.mode === 'dev' ? chalk.yellow('DEV') :
          s.mode === 'prod' ? chalk.green('PROD') : chalk.gray('?');
        console.log(chalk.gray(`     ${s.name}: ${s.command} (${sMode})`));
      }
    }

    results.push({
      client: client.id,
      name: client.name,
      detected: client.detected,
      configured,
      mode: clientMode,
      path: client.configPath,
      servers: serverDetails,
    });
  }

  console.log();

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  }
}
