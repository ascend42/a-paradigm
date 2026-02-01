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

// Types
interface AIClient {
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

function detectAllClients(): AIClient[] {
  return [
    detectCursor(),
    detectClaudeDesktop(),
    detectContinue(),
    detectCline(),
  ];
}

// Config generation
function generateMCPConfig(client: AIClient, projectPath: string, projectName: string): object {
  const serverName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  
  if (client.id === 'continue') {
    // Continue has a different config format
    return {
      experimental: {
        modelContextProtocolServers: [
          {
            transport: {
              type: 'stdio',
              command: 'npx',
              args: ['@a-company/paradigm-mcp'],
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
        command: 'npx',
        args: ['@a-company/paradigm-mcp'],
        cwd: projectPath,
      },
    },
  };
}

function mergeConfig(existing: object, newConfig: object, client: AIClient): object {
  if (client.id === 'continue') {
    // Merge Continue format
    const existingServers = (existing as any)?.experimental?.modelContextProtocolServers || [];
    const newServers = (newConfig as any)?.experimental?.modelContextProtocolServers || [];
    return {
      ...existing,
      experimental: {
        ...(existing as any)?.experimental,
        modelContextProtocolServers: [...existingServers, ...newServers],
      },
    };
  }
  
  // Merge standard MCP format
  return {
    ...existing,
    mcpServers: {
      ...(existing as any)?.mcpServers,
      ...(newConfig as any)?.mcpServers,
    },
  };
}

function writeConfig(client: AIClient, config: object, force: boolean): { success: boolean; message: string } {
  const configDir = path.dirname(client.configPath);
  
  // Create directory if needed
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  // Check for existing config
  let finalConfig = config;
  if (fs.existsSync(client.configPath) && !force) {
    try {
      const existingContent = fs.readFileSync(client.configPath, 'utf8');
      const existingConfig = JSON.parse(existingContent);
      finalConfig = mergeConfig(existingConfig, config, client);
    } catch {
      // If we can't parse existing, just use new config
    }
  }
  
  // Write config
  fs.writeFileSync(client.configPath, JSON.stringify(finalConfig, null, 2) + '\n');
  
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
function getProjectName(): string {
  const paradigmPath = path.join(process.cwd(), '.paradigm', 'config.yaml');
  if (fs.existsSync(paradigmPath)) {
    const content = fs.readFileSync(paradigmPath, 'utf8');
    const match = content.match(/project:\s*["']?([^"'\n]+)["']?/);
    if (match) return match[1].trim();
  }
  return path.basename(process.cwd());
}

// Interactive selection (simple version without inquirer)
async function selectClient(clients: AIClient[]): Promise<AIClient | null> {
  const detectedClients = clients.filter(c => c.detected);
  
  if (detectedClients.length === 0) {
    return null;
  }
  
  if (detectedClients.length === 1) {
    return detectedClients[0];
  }
  
  // Show options and let user choose
  console.log(chalk.cyan('\nMultiple AI clients detected. Select one:\n'));
  detectedClients.forEach((client, i) => {
    const scope = client.configType === 'project' ? '(project-level)' : '(user-level)';
    console.log(`  ${chalk.yellow(`[${i + 1}]`)} ${client.name} ${chalk.gray(scope)}`);
  });
  console.log(`  ${chalk.yellow(`[${detectedClients.length + 1}]`)} All detected clients`);
  console.log();
  
  // For non-interactive, default to first detected
  console.log(chalk.gray('  (Use --client=<id> to specify, or configure manually)'));
  console.log(chalk.gray(`  Available IDs: ${detectedClients.map(c => c.id).join(', ')}\n`));
  
  return null; // Return null to indicate manual selection needed
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
    
    const config = generateMCPConfig(client, projectPath, projectName);
    const result = writeConfig(client, config, options.force || false);
    
    if (result.success) {
      spinner.succeed(`${client.name} configured`);
      console.log(chalk.gray(`   → ${client.configPath}`));
      
      // Offer to add to .gitignore for project-level configs
      if (client.configType === 'project' && options.gitignore !== false) {
        const added = addToGitignore(client.configPath);
        if (added) {
          console.log(chalk.gray('   → Added to .gitignore'));
        }
      }
    } else {
      spinner.fail(`Failed to configure ${client.name}: ${result.message}`);
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
          servers = mcpServers.map((_: any, i: number) => `server-${i + 1}`);
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
