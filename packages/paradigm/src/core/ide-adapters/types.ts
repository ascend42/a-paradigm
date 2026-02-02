/**
 * IDE Adapter Types
 * Defines the interface for generating IDE-specific instruction files
 */

import type { ParadigmConfig } from '../paradigm-config.js';

/**
 * Spec files loaded from .paradigm/specs/
 */
export interface SpecFiles {
  logger?: string;
  scan?: string;
  symbols?: string;
  [key: string]: string | undefined;
}

/**
 * Doc files loaded from .paradigm/docs/
 */
export interface DocFiles {
  commands?: string;
  patterns?: string;
  troubleshooting?: string;
  [key: string]: string | undefined;
}

/**
 * All loaded Paradigm files
 */
export interface ParadigmFiles {
  config: ParadigmConfig;
  specs: SpecFiles;
  docs: DocFiles;
  projectName: string;
}

/**
 * Result of IDE detection
 */
export interface IDEDetectionResult {
  detected: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Result of sync operation
 */
export interface SyncResult {
  success: boolean;
  ide: string;
  outputPath: string;
  message: string;
}

/**
 * Generated file for multi-file adapters
 */
export interface GeneratedFile {
  /** File path relative to output directory */
  path: string;
  /** File content */
  content: string;
}

/**
 * MCP Server configuration
 */
export interface McpConfig {
  mcpServers: {
    paradigm: {
      command: string;
      args: string[];
    };
  };
}

/**
 * Base interface for IDE adapters
 */
export interface IDEAdapter {
  /** IDE identifier */
  readonly name: string;

  /** Display name for UI */
  readonly displayName: string;

  /** Output file/directory path relative to project root */
  readonly outputPath: string;

  /** Whether this adapter generates multiple files */
  readonly multiFile?: boolean;

  /** Detect if this IDE is in use */
  detect(rootDir: string): boolean;

  /** Generate instruction file content (single file adapters) */
  generate(files: ParadigmFiles): string;

  /** Generate multiple files (multi-file adapters like Cursor modern format) */
  generateFiles?(files: ParadigmFiles): GeneratedFile[];

  /** Generate MCP configuration for this IDE (optional) */
  generateMcpConfig?(): McpConfig;

  /** Generate nested context files for directories with .purpose files (optional) */
  generateNestedContexts?(rootDir: string, files: ParadigmFiles): GeneratedFile[];
}

/**
 * Registry of all available adapters
 */
export type IDEAdapterRegistry = Map<string, IDEAdapter>;
