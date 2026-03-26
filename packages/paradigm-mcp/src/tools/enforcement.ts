/**
 * Enforcement Configuration MCP Tool — #enforcement-tools
 *
 * Allows agents to view and configure stop hook enforcement levels,
 * per-check severity overrides, and orchestration thresholds.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { trackToolCall } from './context.js';

interface ToolContext {
  rootDir: string;
}

// ═══════════════════════════════════════════════════════════════════
// TYPES (mirroring packages/paradigm/src/core/enforcement/types.ts)
// ═══════════════════════════════════════════════════════════════════

type EnforcementLevel = 'strict' | 'balanced' | 'minimal';
type CheckSeverity = 'block' | 'warn' | 'off';

const CHECK_IDS = [
  'purpose-coverage',
  'purpose-exists',
  'portal-gates',
  'aspect-anchors',
  'purpose-freshness',
  'aspect-advisory',
  'lore-required',
  'habits-blocking',
  'purpose-required-patterns',
  'drift-detection',
  'portal-compliance',
  'graduation-tracking',
  'orchestration-required',
] as const;

type CheckId = typeof CHECK_IDS[number];

// ═══════════════════════════════════════════════════════════════════
// PRESETS (mirroring packages/paradigm/src/core/enforcement/presets.ts)
// ═══════════════════════════════════════════════════════════════════

const PRESETS: Record<EnforcementLevel, Record<CheckId, CheckSeverity>> = {
  strict: {
    'purpose-coverage':          'block',
    'purpose-exists':            'block',
    'portal-gates':              'block',
    'aspect-anchors':            'block',
    'purpose-freshness':         'warn',
    'aspect-advisory':           'warn',
    'lore-required':             'block',
    'habits-blocking':           'block',
    'purpose-required-patterns': 'block',
    'drift-detection':           'block',
    'portal-compliance':         'block',
    'graduation-tracking':       'warn',
    'orchestration-required':    'block',
  },
  balanced: {
    'purpose-coverage':          'block',
    'purpose-exists':            'warn',
    'portal-gates':              'warn',
    'aspect-anchors':            'warn',
    'purpose-freshness':         'warn',
    'aspect-advisory':           'off',
    'lore-required':             'warn',
    'habits-blocking':           'block',
    'purpose-required-patterns': 'warn',
    'drift-detection':           'warn',
    'portal-compliance':         'warn',
    'graduation-tracking':       'off',
    'orchestration-required':    'warn',
  },
  minimal: {
    'purpose-coverage':          'warn',
    'purpose-exists':            'off',
    'portal-gates':              'off',
    'aspect-anchors':            'off',
    'purpose-freshness':         'off',
    'aspect-advisory':           'off',
    'lore-required':             'off',
    'habits-blocking':           'warn',
    'purpose-required-patterns': 'off',
    'drift-detection':           'off',
    'portal-compliance':         'off',
    'graduation-tracking':       'off',
    'orchestration-required':    'off',
  },
};

// ═══════════════════════════════════════════════════════════════════
// CONFIG I/O
// ═══════════════════════════════════════════════════════════════════

interface ConfigYaml {
  enforcement?: {
    level?: string;
    checks?: Record<string, string>;
    orchestration?: {
      threshold?: number;
      detection?: string;
      exempt?: string[];
    };
  };
  [key: string]: unknown;
}

function loadConfig(rootDir: string): ConfigYaml {
  const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
  if (!fs.existsSync(configPath)) return {};
  try {
    return (yaml.load(fs.readFileSync(configPath, 'utf8')) as ConfigYaml) || {};
  } catch {
    return {};
  }
}

function saveConfig(rootDir: string, config: ConfigYaml): void {
  const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 120, noRefs: true }), 'utf8');
}

function resolveEffective(config: ConfigYaml): Record<CheckId, CheckSeverity> & { orchestrationThreshold: number } {
  const level = (config.enforcement?.level || 'balanced') as EnforcementLevel;
  const preset = PRESETS[level] || PRESETS.balanced;
  const overrides = (config.enforcement?.checks || {}) as Partial<Record<CheckId, CheckSeverity>>;
  const threshold = config.enforcement?.orchestration?.threshold ?? 3;

  const resolved = { ...preset } as Record<CheckId, CheckSeverity> & { orchestrationThreshold: number };
  for (const [id, sev] of Object.entries(overrides)) {
    if ((CHECK_IDS as readonly string[]).includes(id) && isValidSeverity(sev as string)) {
      (resolved as Record<string, string>)[id] = sev as string;
    }
  }
  resolved.orchestrationThreshold = threshold;

  return resolved;
}

function isValidSeverity(s: string): s is CheckSeverity {
  return s === 'block' || s === 'warn' || s === 'off';
}

function isValidLevel(l: string): l is EnforcementLevel {
  return l === 'strict' || l === 'balanced' || l === 'minimal';
}

function isValidCheckId(id: string): id is CheckId {
  return (CHECK_IDS as readonly string[]).includes(id);
}

// ═══════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

export const enforcementToolDefinitions = [
  {
    name: 'paradigm_enforcement_configure',
    description: 'View or modify stop hook enforcement levels. Actions: status (view current), set-level (change preset), override (set per-check severity), reset (clear overrides). ~250 tokens.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'set-level', 'override', 'reset'],
          description: 'Action to perform.',
        },
        level: {
          type: 'string',
          enum: ['strict', 'balanced', 'minimal'],
          description: 'Enforcement preset level (for set-level action).',
        },
        checkId: {
          type: 'string',
          description: 'Check ID to override (for override action). One of: ' + CHECK_IDS.join(', '),
        },
        severity: {
          type: 'string',
          enum: ['block', 'warn', 'off'],
          description: 'Severity to set for the check (for override action).',
        },
      },
      required: ['action'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════
// TOOL HANDLERS
// ═══════════════════════════════════════════════════════════════════

async function handleEnforcementConfigure(
  ctx: ToolContext,
  params: { action: string; level?: string; checkId?: string; severity?: string }
): Promise<string> {
  const { action, level, checkId, severity } = params;

  switch (action) {
    case 'status': {
      const config = loadConfig(ctx.rootDir);
      const effective = resolveEffective(config);
      const activeLevel = (config.enforcement?.level || 'balanced') as string;
      const overrides = config.enforcement?.checks || {};
      const threshold = config.enforcement?.orchestration?.threshold ?? 3;

      return JSON.stringify({
        level: activeLevel,
        orchestrationThreshold: threshold,
        orchestrationNote: 'Threshold is compared against magnitude score (not just file count). Magnitude = source files + cross-package penalty + security-adjacent penalty + symbol file changes.',
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        effective,
        checkIds: [...CHECK_IDS],
        presetLevels: ['strict', 'balanced', 'minimal'],
      }, null, 2);
    }

    case 'set-level': {
      if (!level || !isValidLevel(level)) {
        return JSON.stringify({
          error: `Invalid level "${level}". Must be one of: strict, balanced, minimal`,
        });
      }

      const config = loadConfig(ctx.rootDir);
      if (!config.enforcement) config.enforcement = {};
      config.enforcement.level = level;
      // Clear overrides when changing level (clean slate)
      config.enforcement.checks = {};
      saveConfig(ctx.rootDir, config);

      const effective = resolveEffective(config);
      return JSON.stringify({
        success: true,
        level,
        message: `Enforcement level set to "${level}". Per-check overrides cleared.`,
        effective,
      }, null, 2);
    }

    case 'override': {
      if (!checkId || !isValidCheckId(checkId)) {
        return JSON.stringify({
          error: `Invalid checkId "${checkId}". Must be one of: ${CHECK_IDS.join(', ')}`,
        });
      }
      if (!severity || !isValidSeverity(severity)) {
        return JSON.stringify({
          error: `Invalid severity "${severity}". Must be one of: block, warn, off`,
        });
      }

      const config = loadConfig(ctx.rootDir);
      if (!config.enforcement) config.enforcement = {};
      if (!config.enforcement.checks) config.enforcement.checks = {};
      config.enforcement.checks[checkId] = severity;
      saveConfig(ctx.rootDir, config);

      const effective = resolveEffective(config);
      return JSON.stringify({
        success: true,
        checkId,
        severity,
        message: `Override set: ${checkId} = ${severity}`,
        effective,
      }, null, 2);
    }

    case 'reset': {
      const config = loadConfig(ctx.rootDir);
      if (config.enforcement) {
        config.enforcement.checks = {};
      }
      saveConfig(ctx.rootDir, config);

      const effective = resolveEffective(config);
      const activeLevel = (config.enforcement?.level || 'balanced') as string;
      return JSON.stringify({
        success: true,
        message: `All per-check overrides cleared. Preset "${activeLevel}" is now fully in effect.`,
        effective,
      }, null, 2);
    }

    default:
      return JSON.stringify({
        error: `Unknown action "${action}". Must be one of: status, set-level, override, reset`,
      });
  }
}

// ═══════════════════════════════════════════════════════════════════
// REGISTRATION (matches pattern used by other tool modules)
// ═══════════════════════════════════════════════════════════════════

export function getEnforcementToolsList() {
  return enforcementToolDefinitions;
}

export async function handleEnforcementTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ handled: boolean; text: string }> {
  if (name === 'paradigm_enforcement_configure') {
    const text = await handleEnforcementConfigure(ctx, args as {
      action: string;
      level?: string;
      checkId?: string;
      severity?: string;
    });
    trackToolCall(text.length, 'paradigm_enforcement_configure');
    return { handled: true, text };
  }
  return { handled: false, text: '' };
}
