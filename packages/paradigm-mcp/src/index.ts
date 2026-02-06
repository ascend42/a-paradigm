/**
 * Paradigm MCP Server
 * 
 * Exposes Paradigm symbols, gates, flows, and analysis tools
 * to AI assistants via the Model Context Protocol.
 * 
 * Usage:
 *   npx @a-company/paradigm-mcp [project-dir]
 * 
 * Or in Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "paradigm": {
 *         "command": "npx",
 *         "args": ["@a-company/paradigm-mcp"],
 *         "cwd": "/path/to/project"
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadProjectContext, type ProjectContext } from './utils/index-loader.js';
import { registerResources } from './resources/index.js';
import { registerTools } from './tools/index.js';

// Get project directory from args or use cwd
const projectDir = process.argv[2] || process.cwd();

// Server state
let context: ProjectContext | null = null;

/**
 * Get current project context (lazy load)
 */
function getContext(): ProjectContext {
  if (!context) {
    throw new Error('Project context not loaded');
  }
  return context;
}

/**
 * Reload project context after writes to .purpose or portal.yaml.
 * Called by purpose-portal tools after every successful mutation.
 */
async function reloadContext(): Promise<void> {
  context = await loadProjectContext(projectDir);
}

/**
 * Main entry point
 */
async function main() {
  // Load project context
  console.error(`[paradigm-mcp] Loading project from: ${projectDir}`);
  
  try {
    context = await loadProjectContext(projectDir);
    console.error(`[paradigm-mcp] Loaded ${context.aggregation.symbols.length} symbols from ${context.projectName}`);
  } catch (error) {
    console.error(`[paradigm-mcp] Error loading project:`, error);
    process.exit(1);
  }

  // Create MCP server
  const server = new Server(
    {
      name: 'paradigm',
      version: '0.1.0',
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  // Register resources and tools
  registerResources(server, getContext);
  registerTools(server, getContext, reloadContext);

  // Handle errors
  server.onerror = (error) => {
    console.error('[paradigm-mcp] Server error:', error);
  };

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('[paradigm-mcp] Server running on stdio');
}

// Run
main().catch((error) => {
  console.error('[paradigm-mcp] Fatal error:', error);
  process.exit(1);
});
