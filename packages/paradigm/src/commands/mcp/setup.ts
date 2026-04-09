/**
 * paradigm mcp setup - Configure MCP server for AI clients
 * 
 * Detects installed AI clients (Cursor, Claude Desktop, Continue, Cline)
 * and generates appropriate MCP configuration files.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../../utils/logger.js';

// Types
export interface AIClient {
  name: string;
  id: string;
  detected: boolean;
  configPath: string;
  configType: 'project' | 'user';
  instructions: string;
}

interface SetupOptions {
  client?: string;
  force?: boolean;
  json?: boolean;
  gitignore?: boolean;
}

// Detection functions
function detectCursor(): AIClient {
  const homeDir = os.homedir();
  const cursorDir = path.join(homeDir, '.cursor');
  const projectCursorDir = path.join(process.cwd(), '.cursor');
  
  // Check if Cursor directory exists (user has used Cursor)
  const detected = fs.existsSync(cursorDir) || fs.existsSync(projectCursorDir);
  
  return {
    name: 'Cursor',
    id: 'cursor',
    detected,
    configPath: path.join(process.cwd(), '.cursor', 'mcp.json'),
    configType: 'project',
    instructions: 'Restart Cursor to activate MCP',
  };
}

function detectClaudeDesktop(): AIClient {
  const homeDir = os.homedir();
  let configPath: string;
  let detected = false;
  
  if (process.platform === 'darwin') {
    // macOS
    const claudeDir = path.join(homeDir, 'Library', 'Application Support', 'Claude');
    detected = fs.existsSync(claudeDir);
    configPath = path.join(claudeDir, 'claude_desktop_config.json');
  } else if (process.platform === 'win32') {
    // Windows
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    const claudeDir = path.join(appData, 'Claude');
    detected = fs.existsSync(claudeDir);
    configPath = path.join(claudeDir, 'claude_desktop_config.json');
  } else {
    // Linux (not officially supported yet)
    const claudeDir = path.join(homeDir, '.config', 'Claude');
    detected = fs.existsSync(claudeDir);
    configPath = path.join(claudeDir, 'claude_desktop_config.json');
  }
  
  return {
    name: 'Claude Desktop',
    id: 'claude-desktop',
    detected,
    configPath,
    configType: 'user',
    instructions: 'Restart Claude Desktop to activate MCP',
  };
}

function detectContinue(): AIClient {
  const homeDir = os.homedir();
  const continueDir = path.join(homeDir, '.continue');
  const detected = fs.existsSync(continueDir);
  
  return {
    name: 'Continue (VS Code)',
    id: 'continue',
    detected,
    configPath: path.join(continueDir, 'config.json'),
    configType: 'user',
    instructions: 'Restart VS Code to activate MCP',
  };
}

function detectClaudeCode(): AIClient {
  // Claude Code uses .mcp.json at project root
  const projectMcpJson = path.join(process.cwd(), '.mcp.json');
  const claudeDir = path.join(process.cwd(), '.claude');

  // Detected if .mcp.json exists or .claude/ directory exists (Claude Code project)
  const detected = fs.existsSync(projectMcpJson) || fs.existsSync(claudeDir);

  return {
    name: 'Claude Code',
    id: 'claude-code',
    detected,
    configPath: projectMcpJson,
    configType: 'project',
    instructions: 'Restart Claude Code session to activate MCP',
  };
}

function detectCline(): AIClient {
  // Cline stores config in VS Code settings or project-level
  const projectClineDir = path.join(process.cwd(), '.cline');
  const detected = fs.existsSync(projectClineDir);

  return {
    name: 'Cline (VS Code)',
    id: 'cline',
    detected,
    configPath: path.join(process.cwd(), '.cline', 'mcp.json'),
    configType: 'project',
    instructions: 'Restart VS Code to activate MCP',
  };
}

export function detectAllClients(): AIClient[] {
  return [
    detectCursor(),
    detectClaudeCode(),
    detectClaudeDesktop(),
    detectContinue(),
    detectCline(),
  ];
}

// Config generation
export function generateMCPConfig(client: AIClient, projectPath: string, projectName: string): McpConfigData {
  const serverName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  
  if (client.id === 'continue') {
    // Continue has a different config format
    return {
      experimental: {
        modelContextProtocolServers: [
          {
            transport: {
              type: 'stdio',
              command: 'paradigm-mcp',
              args: ['.'],
              cwd: projectPath,
            },
          },
        ],
      },
    };
  }

  // Standard MCP format (Cursor, Claude Desktop, Cline)
  return {
    mcpServers: {
      [serverName]: {
        command: 'paradigm-mcp',
        args: ['.'],
        cwd: projectPath,
      },
    },
  };
}

/** Structure of an MCP config file (union of all client formats) */
interface McpConfigData {
  experimental?: {
    modelContextProtocolServers?: Array<{
      transport: { type: string; command: string; args: string[]; cwd?: string };
    }>;
    [key: string]: unknown;
  };
  mcpServers?: Record<string, { command: string; args: string[]; cwd?: string }>;
  [key: string]: unknown;
}

function mergeConfig(existing: McpConfigData, newConfig: McpConfigData, client: AIClient): McpConfigData {
  if (client.id === 'continue') {
    // Merge Continue format
    const existingServers = existing?.experimental?.modelContextProtocolServers || [];
    const newServers = newConfig?.experimental?.modelContextProtocolServers || [];
    return {
      ...existing,
      experimental: {
        ...existing?.experimental,
        modelContextProtocolServers: [...existingServers, ...newServers],
      },
    };
  }

  // Merge standard MCP format
  return {
    ...existing,
    mcpServers: {
      ...existing?.mcpServers,
      ...newConfig?.mcpServers,
    },
  };
}

export function writeConfig(client: AIClient, config: McpConfigData, force: boolean): { success: boolean; message: string } {
  const configDir = path.dirname(client.configPath);

  // Create directory if needed
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    log.component('mcp-config').debug('Created config directory', { path: configDir });
  }

  // Check for existing config
  let finalConfig: McpConfigData = config;
  if (fs.existsSync(client.configPath) && !force) {
    try {
      const existingContent = fs.readFileSync(client.configPath, 'utf8');
      const existingConfig = JSON.parse(existingContent) as McpConfigData;
      finalConfig = mergeConfig(existingConfig, config, client);
      log.component('mcp-config').debug('Merged with existing config', { client: client.id });
    } catch {
      // If we can't parse existing, just use new config
      log.component('mcp-config').warn('Could not parse existing config, using new', { client: client.id });
    }
  }
  
  // Write config
  fs.writeFileSync(client.configPath, JSON.stringify(finalConfig, null, 2) + '\n');
  log.component('mcp-config').success('Config written', { client: client.id, path: client.configPath });
  
  return {
    success: true,
    message: `Config written to ${client.configPath}`,
  };
}

function addToGitignore(configPath: string): boolean {
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  const relativePath = path.relative(process.cwd(), configPath);
  
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
    if (content.includes(relativePath) || content.includes(path.dirname(relativePath))) {
      return false; // Already ignored
    }
  }
  
  const addition = `\n# MCP config (contains local paths)\n${relativePath}\n`;
  fs.appendFileSync(gitignorePath, addition);
  return true;
}

// Get project name from .paradigm or directory
export function getProjectName(): string {
  const paradigmPath = path.join(process.cwd(), '.paradigm', 'config.yaml');
  if (fs.existsSync(paradigmPath)) {
    const content = fs.readFileSync(paradigmPath, 'utf8');
    const match = content.match(/project:\s*["']?([^"'\n]+)["']?/);
    if (match) return match[1].trim();
  }
  return path.basename(process.cwd());
}


// Main command
export async function mcpSetupCommand(options: SetupOptions) {
  const spinner = ora();
  const projectPath = process.cwd();
  const projectName = getProjectName();
  
  console.log(chalk.blue('\n🔌 Paradigm MCP Setup\n'));
  
  // Check if this is a Paradigm project
  const hasParadigm = fs.existsSync(path.join(projectPath, '.paradigm')) || 
                      fs.existsSync(path.join(projectPath, '.purpose'));
  
  if (!hasParadigm) {
    console.log(chalk.yellow('⚠️  No .paradigm/ or .purpose file found.'));
    console.log(chalk.gray('   MCP will work, but you should run `paradigm init` first for full functionality.\n'));
  }
  
  // Detect clients
  spinner.start('Detecting AI clients...');
  const clients = detectAllClients();
  const detectedClients = clients.filter(c => c.detected);
  spinner.stop();
  
  // Show detection results
  console.log(chalk.gray('Detected AI clients:\n'));
  for (const client of clients) {
    const icon = client.detected ? chalk.green('✓') : chalk.gray('○');
    const name = client.detected ? client.name : chalk.gray(client.name);
    const note = client.detected 
      ? chalk.gray(client.configType === 'project' ? '(project-level)' : '(user-level)')
      : chalk.gray('(not found)');
    console.log(`  ${icon} ${name} ${note}`);
  }
  console.log();
  
  // Handle no clients detected
  if (detectedClients.length === 0) {
    console.log(chalk.yellow('No supported AI clients detected.\n'));
    console.log(chalk.gray('Supported clients:'));
    console.log(chalk.gray('  - Cursor (https://cursor.sh)'));
    console.log(chalk.gray('  - Claude Desktop (https://claude.ai/download)'));
    console.log(chalk.gray('  - Continue for VS Code'));
    console.log(chalk.gray('  - Cline for VS Code\n'));
    console.log(chalk.gray('Install one of these clients and run this command again.\n'));
    return;
  }
  
  // Determine which client(s) to configure
  let clientsToSetup: AIClient[] = [];
  
  if (options.client) {
    if (options.client === 'all') {
      clientsToSetup = detectedClients;
    } else {
      const client = clients.find(c => c.id === options.client);
      if (!client) {
        console.log(chalk.red(`Unknown client: ${options.client}`));
        console.log(chalk.gray(`Available: ${clients.map(c => c.id).join(', ')}\n`));
        return;
      }
      if (!client.detected) {
        console.log(chalk.yellow(`${client.name} not detected on this system.`));
        console.log(chalk.gray('Proceeding anyway...\n'));
      }
      clientsToSetup = [client];
    }
  } else if (detectedClients.length === 1) {
    // Auto-select if only one client
    clientsToSetup = detectedClients;
  } else {
    // Multiple clients - show help
    console.log(chalk.cyan('Multiple clients detected. Specify which to configure:\n'));
    console.log(chalk.white('  paradigm mcp setup --client=cursor'));
    console.log(chalk.white('  paradigm mcp setup --client=claude-desktop'));
    console.log(chalk.white('  paradigm mcp setup --client=all'));
    console.log();
    return;
  }
  
  // Configure each selected client
  for (const client of clientsToSetup) {
    spinner.start(`Configuring ${client.name}...`);
    
    const tracker = log.operation(`mcp-setup-${client.id}`).start('Configuring MCP', { client: client.id });
    const config = generateMCPConfig(client, projectPath, projectName);
    const result = writeConfig(client, config, options.force || false);
    
    if (result.success) {
      spinner.succeed(`${client.name} configured`);
      tracker.success('MCP configured', { client: client.id, path: client.configPath });
      console.log(chalk.gray(`   → ${client.configPath}`));
      
      // Offer to add to .gitignore for project-level configs
      if (client.configType === 'project' && options.gitignore !== false) {
        const added = addToGitignore(client.configPath);
        if (added) {
          console.log(chalk.gray('   → Added to .gitignore'));
          log.component('gitignore').debug('Added MCP config to .gitignore', { path: client.configPath });
        }
      }
    } else {
      spinner.fail(`Failed to configure ${client.name}: ${result.message}`);
      console.log(chalk.gray('    Troubleshooting: .paradigm/docs/troubleshooting.md'));
      tracker.error('MCP configuration failed', { client: client.id, message: result.message });
    }
  }
  
  // Summary
  console.log(chalk.green('\n✓ MCP setup complete!\n'));
  
  console.log(chalk.cyan('Next steps:'));
  const uniqueInstructions = [...new Set(clientsToSetup.map(c => c.instructions))];
  uniqueInstructions.forEach(instruction => {
    console.log(chalk.gray(`  • ${instruction}`));
  });
  
  console.log(chalk.gray('\nThen try asking your AI:'));
  console.log(chalk.white(`  "What features are in the ${projectName} project?"`));
  console.log(chalk.white('  "What would break if I changed @feature-name?"'));
  console.log();
  
  // JSON output mode
  if (options.json) {
    const output = {
      project: projectName,
      path: projectPath,
      configured: clientsToSetup.map(c => ({
        client: c.id,
        name: c.name,
        configPath: c.configPath,
        configType: c.configType,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
  }
}

// Status subcommand - show current MCP configuration
export async function mcpStatusCommand(options: { json?: boolean }) {
  console.log(chalk.blue('\n🔌 Paradigm MCP Status\n'));
  
  const clients = detectAllClients();
  const results: Array<{ client: string; configured: boolean; path: string; servers?: string[] }> = [];
  
  for (const client of clients) {
    let configured = false;
    let servers: string[] = [];
    
    if (fs.existsSync(client.configPath)) {
      try {
        const content = fs.readFileSync(client.configPath, 'utf8');
        const config = JSON.parse(content);
        
        if (client.id === 'continue') {
          const mcpServers = config?.experimental?.modelContextProtocolServers || [];
          configured = mcpServers.length > 0;
          servers = mcpServers.map((_: unknown, i: number) => `server-${i + 1}`);
        } else {
          const mcpServers = config?.mcpServers || {};
          configured = Object.keys(mcpServers).length > 0;
          servers = Object.keys(mcpServers);
        }
      } catch {
        // Config exists but invalid
      }
    }
    
    const icon = client.detected 
      ? (configured ? chalk.green('✓') : chalk.yellow('○'))
      : chalk.gray('○');
    const status = configured 
      ? chalk.green('configured')
      : (client.detected ? chalk.yellow('not configured') : chalk.gray('not detected'));
    
    console.log(`  ${icon} ${client.name}: ${status}`);
    if (configured && servers.length > 0) {
      console.log(chalk.gray(`     Servers: ${servers.join(', ')}`));
    }
    
    results.push({
      client: client.id,
      configured,
      path: client.configPath,
      servers: configured ? servers : undefined,
    });
  }
  
  console.log();
  
  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  }
}

// Types for server info
export interface ServerInfo {
  name: string;
  cwd: string;
  command: string;
  args: string[];
}

interface ClientServers {
  client: AIClient;
  servers: ServerInfo[];
}

// Helper to get servers from a client config
export function getServersFromConfig(client: AIClient): ServerInfo[] {
  if (!fs.existsSync(client.configPath)) {
    return [];
  }
  
  try {
    const content = fs.readFileSync(client.configPath, 'utf8');
    const config = JSON.parse(content);
    
    if (client.id === 'continue') {
      const mcpServers = config?.experimental?.modelContextProtocolServers || [];
      return mcpServers.map((server: Record<string, unknown>, i: number) => {
        const transport = server?.transport as Record<string, unknown> | undefined;
        return {
          name: `server-${i + 1}`,
          cwd: (transport?.cwd as string) || 'unknown',
          command: (transport?.command as string) || 'unknown',
          args: (transport?.args as string[]) || [],
        };
      });
    } else {
      const mcpServers = config?.mcpServers || {};
      return Object.entries(mcpServers).map(([name, server]) => {
        const s = server as Record<string, unknown>;
        return {
          name,
          cwd: (s?.cwd as string) || 'unknown',
          command: (s?.command as string) || 'unknown',
          args: (s?.args as string[]) || [],
        };
      });
    }
  } catch {
    return [];
  }
}

// List all configured MCP servers across all clients
export async function mcpListCommand(options: { json?: boolean }) {
  console.log(chalk.blue('\n🔌 Configured MCP Servers\n'));

  const clients = detectAllClients();
  const currentProjectPath = process.cwd();
  const allClientServers: ClientServers[] = [];
  
  let totalServers = 0;
  
  for (const client of clients) {
    const servers = getServersFromConfig(client);
    allClientServers.push({ client, servers });
    
    if (servers.length === 0) {
      continue;
    }
    
    totalServers += servers.length;
    
    // Header for this client
    const scope = client.configType === 'project' ? 'this project' : 'user-level';
    console.log(chalk.cyan(`${client.name} (${scope}):`));
    
    // List servers
    for (const server of servers) {
      const isCurrentProject = server.cwd === currentProjectPath;
      const icon = isCurrentProject ? chalk.green('●') : chalk.gray('○');
      const nameDisplay = isCurrentProject
        ? chalk.green(server.name)
        : chalk.white(server.name);
      const cwdDisplay = isCurrentProject
        ? chalk.green('(current)')
        : chalk.gray(server.cwd);

      console.log(`  ${icon} ${nameDisplay.padEnd(20)} → ${cwdDisplay}`);
    }
    console.log();
  }
  
  if (totalServers === 0) {
    console.log(chalk.yellow('No MCP servers configured.\n'));
    console.log(chalk.gray('Run `paradigm mcp setup` to configure MCP for your AI clients.\n'));
  } else {
    console.log(chalk.gray(`Total: ${totalServers} server(s) across ${allClientServers.filter(cs => cs.servers.length > 0).length} client(s)\n`));
  }
  
  // JSON output
  if (options.json) {
    const output = allClientServers.map(cs => ({
      client: cs.client.id,
      name: cs.client.name,
      configType: cs.client.configType,
      configPath: cs.client.configPath,
      servers: cs.servers,
    }));
    console.log(JSON.stringify(output, null, 2));
  }
}

// Remove options
interface RemoveOptions {
  client?: string;
  force?: boolean;
  json?: boolean;
}

// Remove a server from MCP configuration
export async function mcpRemoveCommand(serverName: string | undefined, options: RemoveOptions) {
  const spinner = ora();
  const projectPath = process.cwd();
  const projectName = getProjectName();
  const defaultServerName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  
  // If no server name provided, use current project name
  const targetServerName = serverName || defaultServerName;
  
  console.log(chalk.blue('\n🔌 Paradigm MCP Remove\n'));
  
  const clients = detectAllClients();
  let clientsToCheck: AIClient[] = [];
  
  // Determine which clients to check
  if (options.client) {
    if (options.client === 'all') {
      clientsToCheck = clients;
    } else {
      const client = clients.find(c => c.id === options.client);
      if (!client) {
        console.log(chalk.red(`Unknown client: ${options.client}`));
        console.log(chalk.gray(`Available: ${clients.map(c => c.id).join(', ')}\n`));
        return;
      }
      clientsToCheck = [client];
    }
  } else {
    // Check all clients
    clientsToCheck = clients;
  }
  
  let removed = 0;
  let notFound = 0;
  const results: Array<{ client: string; removed: boolean; serverName: string }> = [];
  
  for (const client of clientsToCheck) {
    if (!fs.existsSync(client.configPath)) {
      continue;
    }
    
    spinner.start(`Checking ${client.name}...`);
    
    try {
      const content = fs.readFileSync(client.configPath, 'utf8');
      const config = JSON.parse(content);
      let modified = false;
      
      if (client.id === 'continue') {
        // Continue format - remove by cwd match
        const servers = config?.experimental?.modelContextProtocolServers || [];
        const originalLength = servers.length;
        const filtered = servers.filter((server: Record<string, unknown>) => {
          const transport = server?.transport as Record<string, unknown> | undefined;
          const serverCwd = (transport?.cwd as string) || '';
          // Match by cwd (project path) since Continue doesn't have named servers
          return serverCwd !== projectPath;
        });
        
        if (filtered.length < originalLength) {
          config.experimental.modelContextProtocolServers = filtered;
          modified = true;
          removed++;
          results.push({ client: client.id, removed: true, serverName: 'server (by path)' });
        } else {
          notFound++;
          results.push({ client: client.id, removed: false, serverName: targetServerName });
        }
      } else {
        // Standard MCP format - remove by name
        const servers = config?.mcpServers || {};
        
        if (servers[targetServerName]) {
          delete servers[targetServerName];
          config.mcpServers = servers;
          modified = true;
          removed++;
          results.push({ client: client.id, removed: true, serverName: targetServerName });
        } else {
          // Also try matching by cwd
          let foundByPath = false;
          for (const [name, server] of Object.entries(servers)) {
            if ((server as Record<string, unknown>)?.cwd === projectPath) {
              delete servers[name];
              config.mcpServers = servers;
              modified = true;
              removed++;
              foundByPath = true;
              results.push({ client: client.id, removed: true, serverName: name });
              break;
            }
          }
          
          if (!foundByPath) {
            notFound++;
            results.push({ client: client.id, removed: false, serverName: targetServerName });
          }
        }
      }
      
      if (modified) {
        fs.writeFileSync(client.configPath, JSON.stringify(config, null, 2) + '\n');
        spinner.succeed(`Removed from ${client.name}`);
      } else {
        spinner.info(`${client.name}: Server "${targetServerName}" not found`);
      }
    } catch (err) {
      spinner.fail(`Error reading ${client.name} config`);
    }
  }
  
  // Summary
  console.log();
  if (removed > 0) {
    console.log(chalk.green(`✓ Removed from ${removed} client(s)\n`));
    console.log(chalk.gray('Remember to restart your AI client(s) for changes to take effect.\n'));
  } else {
    console.log(chalk.yellow(`Server "${targetServerName}" not found in any client config.\n`));
    console.log(chalk.gray('Use `paradigm mcp list` to see all configured servers.\n'));
  }
  
  // JSON output
  if (options.json) {
    console.log(JSON.stringify({
      targetServer: targetServerName,
      projectPath,
      results,
    }, null, 2));
  }
}
