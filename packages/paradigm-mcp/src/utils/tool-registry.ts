/**
 * Tool Registry — Tiered dynamic tool loading with auto-detection
 *
 * Tiers:
 *   core    — always loaded (~15 tools)
 *   feature — auto-detected from filesystem/config
 *   advanced — on-demand via paradigm_tool_activate
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ────────────────────────────────────────────────────────
// Feature Detection Cache
// ────────────────────────────────────────────────────────

const FEATURE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let featureCache: { features: Set<string>; timestamp: number } | null = null;

/** Invalidate the feature detection cache. Call after reindex to force re-detection. */
export function invalidateFeatureCache(): void {
  featureCache = null;
}

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export type ToolTier = 'core' | 'feature' | 'advanced';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface ToolModule {
  /** Unique key for this module (e.g., 'wisdom', 'lore', 'symphony') */
  key: string;
  /** Which tier this module belongs to */
  tier: ToolTier;
  /** Return the list of tools this module provides */
  getToolsList: () => ToolDefinition[];
  /** Handle a tool call; return { handled: false } if tool name doesn't match */
  handleTool: (
    name: string,
    args: Record<string, unknown>,
    ctx: unknown,
    reload?: () => Promise<void>
  ) => Promise<{ text: string; handled: boolean }>;
  /** Auto-detection function: returns true if this feature is present in the project */
  detect?: (rootDir: string) => boolean;
}

// ────────────────────────────────────────────────────────
// Detection Functions
// ────────────────────────────────────────────────────────

/** Check if a directory exists relative to rootDir */
function dirExists(rootDir: string, relPath: string): boolean {
  return fs.existsSync(path.join(rootDir, relPath));
}

/** Check if a file exists relative to rootDir */
function fileExists(rootDir: string, relPath: string): boolean {
  return fs.existsSync(path.join(rootDir, relPath));
}

/** Check if any files matching an extension exist (shallow recursive, 1 level) */
function hasFilesWithExtension(rootDir: string, ext: string, searchDir?: string): boolean {
  const dir = searchDir ? path.join(rootDir, searchDir) : rootDir;
  try {
    if (!fs.existsSync(dir)) return false;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isFile() && item.name.endsWith(ext)) return true;
      if (item.isDirectory()) {
        // Shallow recursive (1 level)
        try {
          const subItems = fs.readdirSync(path.join(dir, item.name));
          if (subItems.some(f => f.endsWith(ext))) return true;
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return false;
}

// ────────────────────────────────────────────────────────
// Feature Detection Map
// ────────────────────────────────────────────────────────

/**
 * Auto-detection rules for feature-tier modules.
 * Each key matches a ToolModule.key.
 */
export const FEATURE_DETECTORS: Record<string, (rootDir: string) => boolean> = {
  wisdom: (rootDir) => dirExists(rootDir, '.paradigm/wisdom'),
  history: (rootDir) => dirExists(rootDir, '.paradigm/history'),
  lore: (rootDir) => dirExists(rootDir, '.paradigm/lore'),
  habits: (rootDir) => fileExists(rootDir, '.paradigm/habits.yaml'),
  sentinel: (rootDir) => {
    try {
      const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
      if (!fs.existsSync(configPath)) return false;
      const content = fs.readFileSync(configPath, 'utf-8');
      return content.includes('sentinel');
    } catch { return false; }
  },
  flows: (rootDir) => fileExists(rootDir, '.paradigm/flow-index.json') || fileExists(rootDir, '.paradigm/flows.yaml'),
  fixtures: (rootDir) => fileExists(rootDir, '.paradigm/fixtures.yaml'),
  orchestration: (rootDir) => fileExists(rootDir, '.paradigm/agents.yaml'),
  tasks: (rootDir) => dirExists(rootDir, '.paradigm/tasks'),
  assessment: (rootDir) => dirExists(rootDir, '.paradigm/lore'), // co-loaded with lore
  personas: (rootDir) => hasFilesWithExtension(rootDir, '.persona'),
  protocols: (rootDir) => dirExists(rootDir, '.paradigm/protocols'),
  symphony: () => {
    const scoreDir = path.join(os.homedir(), '.paradigm', 'score');
    return fs.existsSync(scoreDir);
  },
  university: (rootDir) => dirExists(rootDir, '.paradigm/university'),
  agents: (rootDir) => {
    const globalDir = path.join(os.homedir(), '.paradigm', 'agents');
    return dirExists(rootDir, '.paradigm/agents') || fs.existsSync(globalDir);
  },
  'aspect-graph': (rootDir) => fileExists(rootDir, '.paradigm/aspect-graph.db'),
  notebooks: (rootDir) => {
    const globalDir = path.join(os.homedir(), '.paradigm', 'notebooks');
    return dirExists(rootDir, '.paradigm/notebooks') || fs.existsSync(globalDir);
  },
};

// ────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────

export class ToolRegistry {
  private modules: Map<string, ToolModule> = new Map();
  private activatedAdvanced: Set<string> = new Set();
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /** Register a tool module */
  register(module: ToolModule): void {
    this.modules.set(module.key, module);
  }

  /** Register multiple modules */
  registerAll(modules: ToolModule[]): void {
    for (const m of modules) {
      this.register(m);
    }
  }

  /**
   * Detect which features are active based on filesystem state.
   * Returns the set of active feature keys.
   */
  detectActiveFeatures(): Set<string> {
    if (featureCache && Date.now() - featureCache.timestamp < FEATURE_CACHE_TTL) {
      return featureCache.features;
    }

    const active = new Set<string>();

    for (const [key, module] of this.modules) {
      if (module.tier === 'core') {
        active.add(key);
        continue;
      }

      if (module.tier === 'advanced') {
        if (this.activatedAdvanced.has(key)) {
          active.add(key);
        }
        continue;
      }

      // Feature tier: use module's detect function or fallback to registry detector
      const detector = module.detect || FEATURE_DETECTORS[key];
      if (detector) {
        try {
          if (detector(this.rootDir)) {
            active.add(key);
          }
        } catch {
          // Detection failure = not active
        }
      } else {
        // No detector = always active (backward compat)
        active.add(key);
      }
    }

    featureCache = { features: active, timestamp: Date.now() };
    return active;
  }

  /**
   * Get all tools that should be listed for the current project state.
   */
  getActiveTools(): ToolDefinition[] {
    const active = this.detectActiveFeatures();
    const tools: ToolDefinition[] = [];

    for (const [key, module] of this.modules) {
      if (active.has(key)) {
        tools.push(...module.getToolsList());
      }
    }

    return tools;
  }

  /**
   * Activate an advanced-tier feature for this session.
   * Returns the newly available tools, or null if key not found.
   */
  activateAdvanced(key: string): ToolDefinition[] | null {
    const module = this.modules.get(key);
    if (!module) return null;
    if (module.tier !== 'advanced') return null;

    this.activatedAdvanced.add(key);
    return module.getToolsList();
  }

  /**
   * Get list of available advanced features (not yet activated).
   */
  getAvailableAdvanced(): Array<{ key: string; toolCount: number }> {
    const result: Array<{ key: string; toolCount: number }> = [];
    for (const [key, module] of this.modules) {
      if (module.tier === 'advanced' && !this.activatedAdvanced.has(key)) {
        result.push({ key, toolCount: module.getToolsList().length });
      }
    }
    return result;
  }

  /**
   * Dispatch a tool call to the appropriate module.
   * Returns the result from the first module that handles it.
   */
  async dispatch(
    name: string,
    args: Record<string, unknown>,
    ctx: unknown,
    reload?: () => Promise<void>
  ): Promise<{ text: string; handled: boolean } | null> {
    const active = this.detectActiveFeatures();

    for (const [key, module] of this.modules) {
      if (!active.has(key)) continue;

      try {
        const result = await module.handleTool(name, args, ctx, reload);
        if (result.handled) {
          return result;
        }
      } catch (error) {
        // Module handler threw — return error
        return {
          handled: true,
          text: JSON.stringify({
            error: `Tool handler error in module "${key}"`,
            message: (error as Error).message,
          }, null, 2),
        };
      }
    }

    return null;
  }

  /** Get the number of registered modules */
  get size(): number {
    return this.modules.size;
  }

  /** Get info about what's loaded */
  getRegistryInfo(): {
    total: number;
    byTier: Record<ToolTier, number>;
    activeFeatures: string[];
    availableAdvanced: string[];
  } {
    const active = this.detectActiveFeatures();
    const byTier: Record<ToolTier, number> = { core: 0, feature: 0, advanced: 0 };

    for (const module of this.modules.values()) {
      byTier[module.tier]++;
    }

    return {
      total: this.modules.size,
      byTier,
      activeFeatures: [...active],
      availableAdvanced: [...this.modules.entries()]
        .filter(([key, m]) => m.tier === 'advanced' && !this.activatedAdvanced.has(key))
        .map(([key]) => key),
    };
  }
}
