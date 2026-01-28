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
} from './types.js';

// Export adapters
export { cursorAdapter } from './cursor.js';
export { copilotAdapter } from './copilot.js';
export { windsurfAdapter } from './windsurf.js';
export { claudeAdapter } from './claude.js';

/**
 * Registry of all available IDE adapters
 */
export const adapters: IDEAdapterRegistry = new Map([
  ['cursor', cursorAdapter],
  ['copilot', copilotAdapter],
  ['windsurf', windsurfAdapter],
  ['claude', claudeAdapter],
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
  const horizonDir = path.join(rootDir, '.paradigm');
  const horizonFile = path.join(rootDir, '.paradigm');
  
  // Check if .paradigm is a directory (new format)
  let configPath: string;
  let specsDir: string;
  let docsDir: string;
  
  if (fs.existsSync(horizonDir) && fs.statSync(horizonDir).isDirectory()) {
    configPath = path.join(horizonDir, 'config.yaml');
    specsDir = path.join(horizonDir, 'specs');
    docsDir = path.join(horizonDir, 'docs');
  } else if (fs.existsSync(horizonFile) && fs.statSync(horizonFile).isFile()) {
    // Legacy format: .paradigm is a file
    configPath = horizonFile;
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
    const specFiles = ['logger.md', 'scan.md', 'symbols.md'];
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
  
  return {
    config,
    specs,
    docs,
    projectName: path.basename(rootDir),
  };
}

/**
 * Sync Paradigm to IDE instruction file
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
  try {
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
