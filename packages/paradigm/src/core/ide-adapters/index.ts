/**
 * IDE Adapters
 * Registry and utilities for IDE-specific instruction file generation
 */

import * as fs from 'fs';
import * as path from 'path';
import type { 
  IDEAdapter, 
  IDEAdapterRegistry, 
  IDEDetectionResult,
  ParadigmFiles,
  SpecFiles,
  DocFiles,
  SyncResult,
} from './types.js';
import { cursorAdapter } from './cursor.js';
import { copilotAdapter } from './copilot.js';
import { windsurfAdapter } from './windsurf.js';
import { claudeAdapter } from './claude.js';
import { agentsAdapter } from './agents.js';
import * as yaml from 'js-yaml';
import { parseParadigmConfig, type ParadigmConfig } from '../paradigm-config.js';

// Export types
export type { 
  IDEAdapter, 
  IDEAdapterRegistry, 
  IDEDetectionResult,
  ParadigmFiles,
  SpecFiles,
  DocFiles,
  SyncResult,
  GeneratedFile,
} from './types.js';

// Export adapters
export { cursorAdapter } from './cursor.js';
export { copilotAdapter } from './copilot.js';
export { windsurfAdapter } from './windsurf.js';
export { claudeAdapter } from './claude.js';
export { agentsAdapter } from './agents.js';

/**
 * Registry of all available IDE adapters
 */
export const adapters: IDEAdapterRegistry = new Map<string, IDEAdapter>([
  ['cursor', cursorAdapter],
  ['copilot', copilotAdapter],
  ['windsurf', windsurfAdapter],
  ['claude', claudeAdapter],
  ['agents', agentsAdapter],
]);

/**
 * Get adapter by name
 */
export function getAdapter(name: string): IDEAdapter | undefined {
  return adapters.get(name.toLowerCase());
}

/**
 * Get all adapter names
 */
export function getAdapterNames(): string[] {
  return Array.from(adapters.keys());
}

/**
 * Detect which IDE is in use
 */
export function detectIDE(rootDir: string): IDEDetectionResult {
  // Priority order: Cursor > Windsurf > Copilot
  
  // Check Cursor first (most common for this tool)
  if (cursorAdapter.detect(rootDir)) {
    return {
      detected: 'cursor',
      confidence: 'high',
      reason: 'Found .cursor directory or .cursorrules file',
    };
  }
  
  // Check Windsurf
  if (windsurfAdapter.detect(rootDir)) {
    return {
      detected: 'windsurf',
      confidence: 'high',
      reason: 'Found .windsurf directory or .windsurfrules file',
    };
  }
  
  // Check Copilot
  if (copilotAdapter.detect(rootDir)) {
    return {
      detected: 'copilot',
      confidence: 'medium',
      reason: 'Found .github/copilot-instructions.md file',
    };
  }
  
  // Default to Cursor if .vscode exists (VS Code family)
  if (fs.existsSync(path.join(rootDir, '.vscode'))) {
    return {
      detected: 'cursor',
      confidence: 'low',
      reason: 'Found .vscode directory, defaulting to Cursor format',
    };
  }
  
  // No detection
  return {
    detected: null,
    confidence: 'low',
    reason: 'No IDE markers found',
  };
}

/**
 * Load Paradigm files from .paradigm/ directory
 */
export function loadParadigmFiles(rootDir: string): ParadigmFiles | null {
  const paradigmDir = path.join(rootDir, '.paradigm');
  const paradigmFile = path.join(rootDir, '.paradigm');

  // Check if .paradigm is a directory (new format)
  let configPath: string;
  let specsDir: string;
  let docsDir: string;

  if (fs.existsSync(paradigmDir) && fs.statSync(paradigmDir).isDirectory()) {
    configPath = path.join(paradigmDir, 'config.yaml');
    specsDir = path.join(paradigmDir, 'specs');
    docsDir = path.join(paradigmDir, 'docs');
  } else if (fs.existsSync(paradigmFile) && fs.statSync(paradigmFile).isFile()) {
    // Legacy format: .paradigm is a file
    configPath = paradigmFile;
    specsDir = ''; // No specs in legacy format
    docsDir = '';
  } else {
    return null;
  }
  
  // Load config
  if (!fs.existsSync(configPath)) {
    return null;
  }
  
  let config: ParadigmConfig;
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    config = parseParadigmConfig(configContent);
  } catch {
    return null;
  }
  
  // Load specs
  const specs: SpecFiles = {};
  if (specsDir && fs.existsSync(specsDir)) {
    const specFiles = ['logger.md', 'probe.md', 'symbols.md'];
    for (const file of specFiles) {
      const filePath = path.join(specsDir, file);
      if (fs.existsSync(filePath)) {
        const key = file.replace('.md', '');
        specs[key] = fs.readFileSync(filePath, 'utf8');
      }
    }
  }
  
  // Load docs
  const docs: DocFiles = {};
  if (docsDir && fs.existsSync(docsDir)) {
    const docFiles = ['commands.md', 'patterns.md', 'troubleshooting.md'];
    for (const file of docFiles) {
      const filePath = path.join(docsDir, file);
      if (fs.existsSync(filePath)) {
        const key = file.replace('.md', '');
        docs[key] = fs.readFileSync(filePath, 'utf8');
      }
    }
  }
  
  // Load agent profiles for context contributions
  let agents: ParadigmFiles['agents'] = undefined;
  const agentsDir = path.join(rootDir, '.paradigm', 'agents');
  if (fs.existsSync(agentsDir)) {
    try {
      const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.agent'));
      const loaded: NonNullable<ParadigmFiles['agents']> = [];
      for (const file of agentFiles) {
        try {
          const content = fs.readFileSync(path.join(agentsDir, file), 'utf8');
          const profile = yaml.load(content) as Record<string, unknown>;
          if (profile?.id) {
            loaded.push({
              id: profile.id as string,
              role: profile.role as string | undefined,
              context: profile.context as {
                contributions?: Array<{ section: string; content?: string; priority: string }>;
              } | undefined,
            });
          }
        } catch { /* skip invalid */ }
      }
      if (loaded.length > 0) agents = loaded;
    } catch { /* non-fatal */ }
  }

  // Load workspace info if configured
  let workspace: ParadigmFiles['workspace'] = undefined;
  const rawConfig = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  const wsField = rawConfig.workspace;
  if (typeof wsField === 'string') {
    const wsPath = path.resolve(rootDir, wsField);
    if (fs.existsSync(wsPath)) {
      try {
        const wsConfig = yaml.load(fs.readFileSync(wsPath, 'utf8')) as {
          name: string;
          members?: Array<{ name: string; path: string; role?: string; exports?: string[] }>;
        };
        const wsDir = path.dirname(wsPath);
        const currentName = wsConfig.members?.find(
          (m) => path.resolve(wsDir, m.path) === rootDir
        )?.name || path.basename(rootDir);
        workspace = {
          name: wsConfig.name,
          currentMember: currentName,
          members: wsConfig.members || [],
        };
      } catch { /* non-fatal */ }
    }
  }

  // VOLATILE display metadata (#cache-aligner) — rendered only in CLAUDE.md's
  // trailer, never its KV-cacheable head. We populate symbolCount (changes only
  // on real symbol add/remove — meaningful, low git-churn) and deliberately omit
  // generatedAt (a per-sync timestamp would rewrite the trailer on every sync,
  // producing meaningless CLAUDE.md diffs) and currentArc (no canonical source).
  // paradigmVersion is left to its schema-version default ("v2.0").
  let meta: ParadigmFiles['meta'];
  try {
    const scanIndexPath = path.join(rootDir, '.paradigm', 'scan-index.json');
    if (fs.existsSync(scanIndexPath)) {
      const idx = JSON.parse(fs.readFileSync(scanIndexPath, 'utf8')) as Record<string, unknown>;
      let count = 0;
      for (const k of ['components', 'features', 'flows', 'state', 'gates', 'signals', 'aspects']) {
        const v = idx[k];
        if (Array.isArray(v)) count += v.length;
        else if (v && typeof v === 'object') count += Object.keys(v as object).length;
      }
      if (count > 0) meta = { symbolCount: count };
    }
  } catch { /* non-fatal — omit symbolCount */ }

  return {
    config,
    specs,
    docs,
    projectName: path.basename(rootDir),
    workspace,
    agents,
    ...(meta ? { meta } : {}),
  };
}

/**
 * Sync Paradigm to IDE instruction file(s)
 */
export function syncToIDE(
  rootDir: string,
  ideName: string,
  files: ParadigmFiles,
  force: boolean = false
): SyncResult {
  const adapter = getAdapter(ideName);
  
  if (!adapter) {
    return {
      success: false,
      ide: ideName,
      outputPath: '',
      message: `Unknown IDE: ${ideName}. Available: ${getAdapterNames().join(', ')}`,
    };
  }
  
  const outputPath = path.join(rootDir, adapter.outputPath);
  
  try {
    // Handle multi-file adapters (like modern Cursor format)
    if (adapter.multiFile && adapter.generateFiles) {
      return syncMultiFileAdapter(rootDir, adapter, files, force);
    }
    
    // Single file adapter
    // Check if output exists and not forcing
    if (!force && fs.existsSync(outputPath)) {
      // Could check if content is different, for now just note it exists
    }
    
    // Ensure parent directory exists (for copilot)
    const parentDir = path.dirname(outputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    
    // Generate content
    const content = adapter.generate(files);
    
    // Write file
    fs.writeFileSync(outputPath, content, 'utf8');
    return {
      success: true,
      ide: ideName,
      outputPath,
      message: `Generated ${adapter.outputPath}`,
    };
  } catch (error) {
    return {
      success: false,
      ide: ideName,
      outputPath,
      message: `Failed to write ${adapter.outputPath}: ${(error as Error).message}`,
    };
  }
}

/**
 * Sync multi-file adapter (generates directory of files)
 */
function syncMultiFileAdapter(
  rootDir: string,
  adapter: IDEAdapter,
  files: ParadigmFiles,
  force: boolean
): SyncResult {
  const outputDir = path.join(rootDir, adapter.outputPath);
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Generate files (pass rootDir for adapters that need to load additional config)
  const generatedFiles = adapter.generateFiles!(files, rootDir);
  
  // Write each file
  const writtenFiles: string[] = [];
  for (const file of generatedFiles) {
    // Handle relative paths (e.g., ../copilot-instructions.md for Copilot)
    let filePath: string;
    if (file.path.startsWith('../')) {
      filePath = path.join(outputDir, file.path);
    } else {
      filePath = path.join(outputDir, file.path);
    }
    
    // Ensure parent directory exists
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    
    // Check if file exists and not forcing
    if (!force && fs.existsSync(filePath)) {
      // Could check if content is different
    }
    
    fs.writeFileSync(filePath, file.content, 'utf8');
    writtenFiles.push(file.path);
  }
  
  // Clean up legacy files when migrating to modern format
  if (adapter.name === 'cursor') {
    const legacyCursorrules = path.join(rootDir, '.cursorrules');
    if (fs.existsSync(legacyCursorrules)) {
      // Rename to .cursorrules.bak for safety
      const backupPath = path.join(rootDir, '.cursorrules.bak');
      if (!fs.existsSync(backupPath)) {
        fs.renameSync(legacyCursorrules, backupPath);
      }
    }
  }
  
  // Count files in the main directory (excluding parent references)
  const mainDirFiles = writtenFiles.filter(f => !f.startsWith('../'));
  const extraFiles = writtenFiles.filter(f => f.startsWith('../'));
  
  let message = `Generated ${mainDirFiles.length} files in ${adapter.outputPath}/`;
  if (extraFiles.length > 0) {
    message += ` + ${extraFiles.length} additional file(s)`;
  }
  
  return {
    success: true,
    ide: adapter.name,
    outputPath: outputDir,
    message,
  };
}

/**
 * Sync to all IDEs
 */
export function syncToAllIDEs(
  rootDir: string,
  files: ParadigmFiles,
  force: boolean = false
): SyncResult[] {
  const results: SyncResult[] = [];

  for (const [name] of adapters) {
    results.push(syncToIDE(rootDir, name, files, force));
  }

  return results;
}

/**
 * Write MCP configuration for an IDE
 */
export function writeMcpConfig(
  rootDir: string,
  ideName: string
): { success: boolean; path: string; message: string } {
  const adapter = getAdapter(ideName);

  if (!adapter || !adapter.generateMcpConfig) {
    return {
      success: false,
      path: '',
      message: `IDE ${ideName} does not support MCP configuration`,
    };
  }

  const mcpConfig = adapter.generateMcpConfig(rootDir);
  let configPath: string;

  // Determine the config path based on IDE
  // Cursor reads from .cursor/mcp.json (project-level)
  // Claude Code reads from .mcp.json at project root
  switch (ideName) {
    case 'cursor':
      configPath = path.join(rootDir, '.cursor', 'mcp.json');
      break;
    case 'claude':
      configPath = path.join(rootDir, '.mcp.json');
      break;
    default:
      return {
        success: false,
        path: '',
        message: `Unknown MCP config path for ${ideName}`,
      };
  }

  try {
    // Ensure directory exists
    const parentDir = path.dirname(configPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Merge with existing config if present
    let existingConfig: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      existingConfig = JSON.parse(content);
    }

    // Merge MCP servers
    const mergedConfig = {
      ...existingConfig,
      mcpServers: {
        ...(existingConfig.mcpServers as Record<string, unknown> || {}),
        ...mcpConfig.mcpServers,
      },
    };

    // For Claude, also add permissions for paradigm commands
    if (ideName === 'claude') {
      const existingPermissions = (existingConfig.permissions as Record<string, string[]>) || {};
      const existingAllow = existingPermissions.allow || [];
      
      // Add paradigm command permission if not already present
      const paradigmPermission = 'Bash(paradigm *)';
      if (!existingAllow.includes(paradigmPermission)) {
        (mergedConfig as Record<string, unknown>).permissions = {
          ...existingPermissions,
          allow: [...existingAllow, paradigmPermission],
        };
      }
    }

    fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2));

    return {
      success: true,
      path: configPath,
      message: `MCP configuration written to ${path.relative(rootDir, configPath)}`,
    };
  } catch (error) {
    return {
      success: false,
      path: configPath,
      message: `Failed to write MCP config: ${(error as Error).message}`,
    };
  }
}

/**
 * Write nested context files (e.g., CLAUDE.md in directories with .purpose)
 */
export function writeNestedContexts(
  rootDir: string,
  ideName: string,
  files: ParadigmFiles
): { success: boolean; count: number; message: string } {
  const adapter = getAdapter(ideName);

  if (!adapter || !adapter.generateNestedContexts) {
    return {
      success: false,
      count: 0,
      message: `IDE ${ideName} does not support nested contexts`,
    };
  }

  try {
    const generatedFiles = adapter.generateNestedContexts(rootDir, files);

    for (const file of generatedFiles) {
      const filePath = path.join(rootDir, file.path);

      // Ensure parent directory exists
      const parentDir = path.dirname(filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(filePath, file.content, 'utf8');
    }

    return {
      success: true,
      count: generatedFiles.length,
      message: `Generated ${generatedFiles.length} nested context files`,
    };
  } catch (error) {
    return {
      success: false,
      count: 0,
      message: `Failed to write nested contexts: ${(error as Error).message}`,
    };
  }
}
