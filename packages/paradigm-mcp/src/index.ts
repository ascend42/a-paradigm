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

// TD-2026-10-27-833 (Aegis M1): FIRST, so the staged-mode fs guard is installed before any other module evaluates
import './staged-guard-first.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadProjectContext, type ProjectContext } from './utils/index-loader.js';
import { registerResources } from './resources/index.js';
import { registerTools } from './tools/index.js';
import { SERVER_INSTRUCTIONS } from './tools/families.js';
import { rebuildStaticFiles } from './tools/reindex.js';
import { getSessionTracker } from './utils/session-tracker.js';
import { resolveProjectRoot } from './utils/global-store.js';
import { autoRegisterWithConductor } from './utils/conductor-loader.js';
import { gnomonStaged } from './utils/gnomon-staged.js';
import { log } from './utils/mcp-logger.js';
import { setUniversityCoreLogger } from '@a-company/university-core';

// Wire the university-core logger seam (extract-university-core spec §2) so the
// extracted loader routes its advisory warnings through the MCP logger. Done at
// module load (before main()) — the no-op default means a missed wire is silent,
// but wiring here covers every request-driven university tool call.
setUniversityCoreLogger({
  warn: (message, data) => log.component('#university-loader').warn(message, data),
});

// Resolve the project root robustly — NOT a bare `argv[2] || cwd()`. The plugin
// manifest passes "." with no pinned cwd, so a naive resolve hashed the wrong
// directory and scattered session state across launch contexts (see
// resolveProjectRoot). This anchors on the nearest `.paradigm/` (or an explicit
// PARADIGM_PROJECT_DIR / CLAUDE_PROJECT_DIR) so recovery is stable.
const projectDir = resolveProjectRoot(process.argv[2]);

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
 * in the background so they stay in sync — unless `rebuildStatic: false`
 * (paradigm_reindex rebuilds them itself, once, from the returned context).
 */
async function reloadContext(opts?: { rebuildStatic?: boolean }): Promise<ProjectContext> {
  const fresh = await loadProjectContext(projectDir);
  context = fresh;
  if (opts?.rebuildStatic !== false) {
    // Rebuild static files in background (non-blocking)
    rebuildStaticFiles(projectDir, fresh).catch((err) => {
      log.component('#paradigm-mcp').warn('Background reindex failed', { error: (err as Error).message });
    });
  }
  return fresh;
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

  // Auto-register with Conductor (fire-and-forget, never blocks startup). Never in the staged Gnomon mode
  // (TD-2026-10-27-833): it runs ps/osascript and writes the global dir.
  if (!gnomonStaged()) autoRegisterWithConductor(projectDir);

  // Create MCP server
  const server = new Server(
    {
      name: 'paradigm',
      version: '0.1.0',
    },
    {
      capabilities: {
        resources: {},
        // listChanged: paradigm_tool_activate sends notifications/tools/list_changed
        tools: { listChanged: true },
      },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // Register resources and tools
  const tools = registerTools(server, getContext, reloadContext);
  registerResources(server, getContext, { opAnnotations: tools.opAnnotations });

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
