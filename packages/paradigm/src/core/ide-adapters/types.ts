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
  probe?: string;
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
  workspace?: {
    name: string;
    currentMember: string;
    members: Array<{
      name: string;
      path: string;
      role?: string;
      exports?: string[];
    }>;
  };
  agents?: Array<{
    id: string;
    role?: string;
    context?: {
      contributions?: Array<{
        section: string;
        content?: string;
        priority: string;
      }>;
    };
  }>;
  /**
   * Set when the project is versioned by Warpline (core/warpline-detect.ts).
   * Unset → no generated file mentions Warpline. The block it renders is
   * config-free and byte-stable, so it lives in CLAUDE.md's cacheable head.
   */
  warpline?: {
    mode: 'native' | 'git';
  };
  /**
   * VOLATILE display metadata (#cache-aligner). These values change on version
   * bumps / reindex / arc shifts and MUST be rendered only in the trailer of a
   * generated context file, never in the KV-cacheable head. See
   * `ClaudeAdapter.generate` and `.paradigm/docs/` docgen guidance.
   */
  meta?: {
    /** Paradigm symbol-schema version string, e.g. "v2.0". */
    paradigmVersion?: string;
    /** Total symbol count at generation time. */
    symbolCount?: number;
    /** ISO timestamp the file was generated. */
    generatedAt?: string;
    /** Current arc / status one-liner (the classic volatile "current arc"). */
    currentArc?: string;
  };
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
      cwd?: string;
      env?: Record<string, string>;
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
  generateFiles?(files: ParadigmFiles, rootDir?: string): GeneratedFile[];

  /** Generate MCP configuration for this IDE (optional) */
  generateMcpConfig?(rootDir: string): McpConfig;

  /** Generate nested context files for directories with .purpose files (optional) */
  generateNestedContexts?(rootDir: string, files: ParadigmFiles): GeneratedFile[];
}

/**
 * Registry of all available adapters
 */
export type IDEAdapterRegistry = Map<string, IDEAdapter>;

// ============================================================================
// Warpline block (T-2026-11-12-001)
// ============================================================================

/** Opening marker of the Warpline block in AGENTS.md / CLAUDE.md. */
export const WARPLINE_BLOCK_BEGIN = '<!-- warpline:begin -->';
/** Closing marker of the Warpline block in AGENTS.md / CLAUDE.md. */
export const WARPLINE_BLOCK_END = '<!-- warpline:end -->';

/**
 * The block text, per mode. MUST stay byte-identical to Warpline's own
 * `renderAgentGuide(mode)` (packages/warpline/src/fabric/agent-guide.ts), which
 * `warpline init` writes. Paradigm keeps its own copy because Warpline is an
 * optional, external dependency it never imports at runtime; the parity test
 * (src/core/warpline-block-parity.test.ts) enforces the match.
 */
export const WARPLINE_BLOCK_TEXT: Readonly<Record<'native' | 'git', string>> = {
  native: [
    WARPLINE_BLOCK_BEGIN,
    '## Version control: Warpline',
    'This project is versioned by Warpline, not git (there is no .git). Warpline is not in your training data; it describes itself at runtime.',
    '- Start with `warpline orient` (where you are and what you can do next), then `warpline status` (what changed, by meaning). Add `--json` for structured output; `warpline --help` lists every command.',
    '- Save work: `warpline fork <you>` → edit → `warpline propose --agent <you> --native -m "<why>"` → `warpline admit <you> --native`.',
    '- If admit refuses with a KNOT, stop and ask the human. Only a human runs `warpline resolve`.',
    '- Never edit `.warpline/` by hand. Diagnose with `warpline health`.',
    WARPLINE_BLOCK_END,
  ].join('\n'),
  git: [
    WARPLINE_BLOCK_BEGIN,
    '## Version control: Warpline',
    'This project uses git plus Warpline, which records the meaning of each change alongside commits. Use git as usual. Start with `warpline orient`; `warpline status` shows what changed by meaning, `warpline mirror status` shows whether the ledger is in step, `warpline health` diagnoses it. Never edit `.warpline/` by hand.',
    WARPLINE_BLOCK_END,
  ].join('\n'),
};
