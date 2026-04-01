/**
 * Shift Recommendations Engine
 *
 * Checks actual project state after `paradigm shift` and returns
 * conditional recommendations — only items that genuinely need attention.
 *
 * See docs/specs/agent-adoption.md "Post-Shift Recommendations" section.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { ShiftRecommendation } from './agent/scopes-types.js';
import { log } from '../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of action-type recommendations to display */
const MAX_ACTION_ITEMS = 4;

/** Minimum character count for root .purpose to be considered non-empty */
const MIN_PURPOSE_LENGTH = 50;

/** Known default/template strings in root .purpose files */
const PURPOSE_TEMPLATE_MARKERS = [
  'description: ""',
  'components: []',
  'description: \'\'',
];

/** Known default model tier values auto-set by shift */
const DEFAULT_MODEL_TIERS: Record<string, string[]> = {
  'claude-code': ['opus', 'sonnet', 'haiku'],
  'cursor': ['sonnet', 'sonnet', 'haiku'],
  'fallback': ['sonnet', 'sonnet', 'sonnet'],
};

// ============================================================================
// Core API
// ============================================================================

/**
 * Inspect the project at `rootDir` and return recommendations
 * sorted by priority (lower = more urgent).
 *
 * Action items are capped at MAX_ACTION_ITEMS; info items are unlimited.
 */
export async function getRecommendations(
  rootDir: string,
): Promise<ShiftRecommendation[]> {
  const checks = await Promise.allSettled([
    checkEmptyPurpose(rootDir),
    checkNoSubPurpose(rootDir),
    checkEmptyPortal(rootDir),
    checkAgentsUnconfigured(rootDir),
    checkPendingScopeReviews(rootDir),
    checkModelTiersDefault(rootDir),
    checkNoLore(rootDir),
    checkNoNotebooks(rootDir),
    checkVerifyNotRun(),
  ]);

  const recommendations: ShiftRecommendation[] = [];

  for (const result of checks) {
    if (result.status === 'fulfilled' && result.value) {
      recommendations.push(result.value);
    }
    // Rejected checks are silently ignored — we never want the
    // recommendation engine to fail the shift command.
  }

  // Sort by priority ascending (lower number = more urgent)
  recommendations.sort((a, b) => a.priority - b.priority);

  // Cap action items at MAX_ACTION_ITEMS; info items are unlimited
  const actions = recommendations.filter((r) => r.type === 'action');
  const infos = recommendations.filter((r) => r.type === 'info');

  const cappedActions = actions.slice(0, MAX_ACTION_ITEMS);

  return [...cappedActions, ...infos];
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format recommendations for terminal output.
 *
 * Action items are shown as a numbered list.
 * Info items are shown as dim text below the actions.
 */
export function formatRecommendations(recs: ShiftRecommendation[]): string {
  if (recs.length === 0) {
    return '';
  }

  const actions = recs.filter((r) => r.type === 'action');
  const infos = recs.filter((r) => r.type === 'info');

  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold('  Recommendations'));
  lines.push(chalk.gray('  ' + '\u2500'.repeat(49)));

  // Numbered action items
  for (let i = 0; i < actions.length; i++) {
    const rec = actions[i];
    const num = chalk.white(`  ${i + 1}. `);
    const msg = chalk.white(rec.message);
    if (rec.command) {
      lines.push(num + msg);
      lines.push('     ' + chalk.cyan(rec.command));
    } else {
      lines.push(num + msg);
    }
  }

  // Info items (dim, not numbered)
  if (infos.length > 0) {
    lines.push('');
    for (const rec of infos) {
      lines.push(chalk.dim('  ' + rec.message));
    }
  }

  // Summary line
  const actionCount = actions.length;
  if (actionCount > 0) {
    lines.push('');
    const plural = actionCount === 1 ? 'item needs' : 'items need';
    lines.push(chalk.dim(`  ${actionCount} ${plural} attention.`));
  }

  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Individual Checks
// ============================================================================

/**
 * Check 1: Root .purpose has default/template content or is very short.
 */
async function checkEmptyPurpose(
  rootDir: string,
): Promise<ShiftRecommendation | null> {
  const purposePath = path.join(rootDir, '.purpose');

  try {
    const content = await fs.readFile(purposePath, 'utf-8');

    // Check if content is shorter than the minimum threshold
    if (content.trim().length < MIN_PURPOSE_LENGTH) {
      return {
        id: 'empty-purpose',
        priority: 1,
        message: 'Edit `.purpose` to define your project\'s features',
        command: undefined,
        type: 'action',
      };
    }

    // Check for template markers that indicate the file was never customized
    const hasTemplateContent = PURPOSE_TEMPLATE_MARKERS.some((marker) =>
      content.includes(marker),
    );
    if (hasTemplateContent) {
      return {
        id: 'empty-purpose',
        priority: 1,
        message: 'Edit `.purpose` to define your project\'s features',
        command: undefined,
        type: 'action',
      };
    }
  } catch {
    // File doesn't exist — shift should have created it, but if not,
    // still recommend editing it.
    return {
      id: 'empty-purpose',
      priority: 1,
      message: 'Edit `.purpose` to define your project\'s features',
      command: undefined,
      type: 'action',
    };
  }

  return null;
}

/**
 * Check 2: No .purpose files in subdirectories under src/, packages/, apps/.
 */
async function checkNoSubPurpose(
  rootDir: string,
): Promise<ShiftRecommendation | null> {
  const searchDirs = ['src', 'packages', 'apps'];

  for (const dir of searchDirs) {
    const fullDir = path.join(rootDir, dir);

    if (!fsSync.existsSync(fullDir)) {
      continue;
    }

    const found = await findPurposeFilesIn(fullDir);
    if (found) {
      // At least one sub-.purpose exists — no recommendation needed
      return null;
    }
  }

  // None of the search dirs had .purpose files (or none of the dirs exist).
  // Only recommend if at least one search dir exists.
  const anyDirExists = searchDirs.some((dir) =>
    fsSync.existsSync(path.join(rootDir, dir)),
  );

  if (anyDirExists) {
    return {
      id: 'no-sub-purpose',
      priority: 2,
      message: 'Add `.purpose` files to feature directories',
      command: undefined,
      type: 'action',
    };
  }

  return null;
}

/**
 * Check 3: portal.yaml has no gates and no routes.
 */
async function checkEmptyPortal(
  rootDir: string,
): Promise<ShiftRecommendation | null> {
  const portalPath = path.join(rootDir, 'portal.yaml');

  try {
    const content = await fs.readFile(portalPath, 'utf-8');

    // Simple string checks for empty gates/routes — avoids pulling in
    // a full YAML parser just for this.
    const hasPopulatedGates =
      content.includes('gates:') &&
      !content.match(/gates:\s*(\[\]|\{\})\s*$/m) &&
      !content.match(/gates:\s*(\[\]|\{\})\s*\n/);

    const hasPopulatedRoutes =
      content.includes('routes:') &&
      !content.match(/routes:\s*(\[\]|\{\})\s*$/m) &&
      !content.match(/routes:\s*(\[\]|\{\})\s*\n/);

    if (!hasPopulatedGates && !hasPopulatedRoutes) {
      return {
        id: 'empty-portal',
        priority: 3,
        message: 'Define auth gates in `portal.yaml` if your project has auth',
        command: undefined,
        type: 'action',
      };
    }
  } catch {
    // File doesn't exist — still recommend
    return {
      id: 'empty-portal',
      priority: 3,
      message: 'Define auth gates in `portal.yaml` if your project has auth',
      command: undefined,
      type: 'action',
    };
  }

  return null;
}

/**
 * Check 4: .paradigm/agents.yaml exists but has only defaults.
 */
async function checkAgentsUnconfigured(
  rootDir: string,
): Promise<ShiftRecommendation | null> {
  const agentsPath = path.join(rootDir, '.paradigm', 'agents.yaml');

  try {
    const content = await fs.readFile(agentsPath, 'utf-8');

    // If the file is very small or has empty agents list, it's unconfigured
    const hasDefaultAgents =
      content.includes('agents: []') || content.trim().length < 40;

    if (hasDefaultAgents) {
      return {
        id: 'agents-unconfigured',
        priority: 4,
        message: 'Review agent roles',
        command: 'paradigm agent list',
        type: 'action',
      };
    }
  } catch {
    // File doesn't exist — not relevant if agents.yaml was never created
    return null;
  }

  return null;
}

/**
 * Check 5: .paradigm/.pending-scope-reviews file exists.
 */
async function checkPendingScopeReviews(
  rootDir: string,
): Promise<ShiftRecommendation | null> {
  const pendingPath = path.join(rootDir, '.paradigm', '.pending-scope-reviews');

  if (fsSync.existsSync(pendingPath)) {
    return {
      id: 'pending-scope-reviews',
      priority: 2,
      message: 'Review agent scopes',
      command: 'paradigm agent review',
      type: 'action',
    };
  }

  return null;
}

/**
 * Check 6: Config has model-resolution but all values are known defaults.
 */
async function checkModelTiersDefault(
  rootDir: string,
): Promise<ShiftRecommendation | null> {
  const configPath = path.join(rootDir, '.paradigm', 'config.yaml');

  try {
    const content = await fs.readFile(configPath, 'utf-8');

    // Only check if model-resolution exists
    if (!content.includes('model-resolution')) {
      return null;
    }

    // Extract tier values with simple regex
    const tier1Match = content.match(/tier-1:\s*(\S+)/);
    const tier2Match = content.match(/tier-2:\s*(\S+)/);
    const tier3Match = content.match(/tier-3:\s*(\S+)/);

    if (!tier1Match || !tier2Match || !tier3Match) {
      return null;
    }

    const currentTiers = [
      tier1Match[1].replace(/['"]/g, ''),
      tier2Match[1].replace(/['"]/g, ''),
      tier3Match[1].replace(/['"]/g, ''),
    ];

    // Check if all three values match any of the known default sets
    const isDefault = Object.values(DEFAULT_MODEL_TIERS).some(
      (defaults) =>
        defaults[0] === currentTiers[0] &&
        defaults[1] === currentTiers[1] &&
        defaults[2] === currentTiers[2],
    );

    if (isDefault) {
      return {
        id: 'model-tiers-default',
        priority: 5,
        message: 'Fine-tune model tiers',
        command: 'paradigm team models',
        type: 'action',
      };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Check 7: No entries in .paradigm/lore/entries/.
 */
async function checkNoLore(
  rootDir: string,
): Promise<ShiftRecommendation | null> {
  const lorePath = path.join(rootDir, '.paradigm', 'lore', 'entries');

  try {
    const entries = await fs.readdir(lorePath);
    // Filter out hidden files like .gitkeep
    const realEntries = entries.filter((e) => !e.startsWith('.'));

    if (realEntries.length === 0) {
      return {
        id: 'no-lore',
        priority: 8,
        message: 'Lore records automatically as you work',
        command: undefined,
        type: 'info',
      };
    }
  } catch {
    // Directory doesn't exist — informational
    return {
      id: 'no-lore',
      priority: 8,
      message: 'Lore records automatically as you work',
      command: undefined,
      type: 'info',
    };
  }

  return null;
}

/**
 * Check 8: .paradigm/notebooks/ is empty.
 */
async function checkNoNotebooks(
  rootDir: string,
): Promise<ShiftRecommendation | null> {
  const notebooksPath = path.join(rootDir, '.paradigm', 'notebooks');

  try {
    const entries = await fs.readdir(notebooksPath);
    const realEntries = entries.filter((e) => !e.startsWith('.'));

    if (realEntries.length === 0) {
      return {
        id: 'no-notebooks',
        priority: 8,
        message: 'Agent notebooks build over time',
        command: undefined,
        type: 'info',
      };
    }
  } catch {
    // Directory doesn't exist — informational
    return {
      id: 'no-notebooks',
      priority: 8,
      message: 'Agent notebooks build over time',
      command: undefined,
      type: 'info',
    };
  }

  return null;
}

/**
 * Check 9: Always recommend verifying setup health.
 */
async function checkVerifyNotRun(): Promise<ShiftRecommendation> {
  return {
    id: 'verify-not-run',
    priority: 6,
    message: 'Verify setup health',
    command: 'paradigm doctor --verify',
    type: 'action',
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively search for a .purpose file anywhere under `dir`.
 * Returns true as soon as one is found; false otherwise.
 * Limits depth to 4 levels to avoid scanning node_modules, etc.
 */
async function findPurposeFilesIn(
  dir: string,
  depth: number = 0,
): Promise<boolean> {
  if (depth > 4) {
    return false;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip common non-source directories
      if (
        entry.isDirectory() &&
        ['node_modules', 'dist', '.git', '.next', '.paradigm', 'build', 'out', 'target', '.turbo'].includes(
          entry.name,
        )
      ) {
        continue;
      }

      if (entry.name === '.purpose' && !entry.isDirectory()) {
        return true;
      }

      if (entry.isDirectory()) {
        const found = await findPurposeFilesIn(
          path.join(dir, entry.name),
          depth + 1,
        );
        if (found) {
          return true;
        }
      }
    }
  } catch {
    // Permission errors, broken symlinks, etc.
    log.operation('shift-recommendations').debug('Could not read directory', { dir });
  }

  return false;
}
