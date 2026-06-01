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
import { rebuildStaticFiles } from './tools/reindex.js';
import { getSessionTracker } from './utils/session-tracker.js';
import { autoRegisterWithConductor } from './utils/conductor-loader.js';
import { log } from './utils/mcp-logger.js';
import { setUniversityCoreLogger } from '@a-company/university-core';

// Wire the university-core logger seam (extract-university-core spec §2) so the
// extracted loader routes its advisory warnings through the MCP logger. Done at
// module load (before main()) — the no-op default means a missed wire is silent,
// but wiring here covers every request-driven university tool call.
setUniversityCoreLogger({
  warn: (message, data) => log.component('#university-loader').warn(message, data),
});

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
 * Also rebuilds static index files (scan-index.json, navigator.yaml, flow-index.json)
 * in the background so they stay in sync.
 */
async function reloadContext(): Promise<void> {
  context = await loadProjectContext(projectDir);
  // Rebuild static files in background (non-blocking)
  rebuildStaticFiles(projectDir, context).catch((err) => {
    log.component('#paradigm-mcp').warn('Background reindex failed', { error: (err as Error).message });
  });
}

/**
 * Main entry point
 */
async function main() {
  // Load project context
  log.component('#paradigm-mcp').info('Loading project', { projectDir });

  try {
    context = await loadProjectContext(projectDir);
    getSessionTracker().setRootDir(context.rootDir);
    log.component('#paradigm-mcp').info('Project loaded', { symbols: context.aggregation.symbols.length, project: context.projectName });
  } catch (error) {
    log.component('#paradigm-mcp').error('Error loading project', { error: (error as Error).message });
    process.exit(1);
  }

  // Auto-register with Conductor (fire-and-forget, never blocks startup)
  autoRegisterWithConductor(projectDir);

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
    log.component('#paradigm-mcp').error('Server error', { error: String(error) });
  };

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.component('#paradigm-mcp').info('Server running on stdio');
}

// Run
main().catch((error) => {
  log.component('#paradigm-mcp').error('Fatal error', { error: (error as Error).message });
  process.exit(1);
});
