/**
 * IDE Adapter Types
 * Defines the interface for generating IDE-specific instruction files
 */

import type { HorizonConfig } from '../horizon-config.js';

/**
 * Spec files loaded from .horizon/specs/
 */
export interface SpecFiles {
  logger?: string;
  scan?: string;
  symbols?: string;
  [key: string]: string | undefined;
}

/**
 * Doc files loaded from .horizon/docs/
 */
export interface DocFiles {
  commands?: string;
  patterns?: string;
  troubleshooting?: string;
  [key: string]: string | undefined;
}

/**
 * All loaded Horizon files
 */
export interface HorizonFiles {
  config: HorizonConfig;
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
 * Base interface for IDE adapters
 */
export interface IDEAdapter {
  /** IDE identifier */
  readonly name: string;
  
  /** Display name for UI */
  readonly displayName: string;
  
  /** Output file path relative to project root */
  readonly outputPath: string;
  
  /** Detect if this IDE is in use */
  detect(rootDir: string): boolean;
  
  /** Generate instruction file content */
  generate(files: HorizonFiles): string;
}

/**
 * Registry of all available adapters
 */
export type IDEAdapterRegistry = Map<string, IDEAdapter>;
