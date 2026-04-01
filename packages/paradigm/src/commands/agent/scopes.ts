/**
 * Agent scopes — diffing, approval, and persistence engine.
 *
 * Compares scope versions, formats diffs for terminal display,
 * and manages approval state via .paradigm/adoptions.yaml and
 * .paradigm/.pending-scope-reviews.
 *
 * See docs/specs/agent-adoption.md for full specification.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { log } from '../../utils/logger.js';
import type {
  AgentScopes,
  ScopeDiff,
  ScopeDiffEntry,
  ScopePermission,
  ApprovalState,
} from './scopes-types.js';

// ============================================================================
// Constants
// ============================================================================

const ADOPTIONS_FILE = '.paradigm/adoptions.yaml';
const PENDING_REVIEWS_FILE = '.paradigm/.pending-scope-reviews';

// ============================================================================
// Scope Diffing
// ============================================================================

/**
 * Compare two scope versions and produce a structured diff.
 *
 * Categories:
 *   - 'new'      — scope ID exists only in newScopes
 *   - 'removed'  — scope ID exists only in oldScopes
 *   - 'kept'     — scope ID exists in both, description unchanged
 *   - 'expanded' — scope ID exists in both, description changed
 *
 * requiresApproval is true when any scope is 'new'.
 * Removed scopes alone do not require approval.
 */
export function diffScopes(
  oldScopes: AgentScopes | undefined,
  newScopes: AgentScopes,
): ScopeDiff {
  const oldPerms = oldScopes?.permissions ?? [];
  const newPerms = newScopes.permissions ?? [];

  const oldMap = new Map<string, ScopePermission>();
  for (const p of oldPerms) {
    oldMap.set(p.id, p);
  }

  const newMap = new Map<string, ScopePermission>();
  for (const p of newPerms) {
    newMap.set(p.id, p);
  }

  const entries: ScopeDiffEntry[] = [];
  const added: ScopePermission[] = [];
  const removed: ScopePermission[] = [];
  const kept: ScopePermission[] = [];

  // Walk new scopes — categorize as new, kept, or expanded
  for (const perm of newPerms) {
    const old = oldMap.get(perm.id);
    if (!old) {
      entries.push({ scope: perm, status: 'new' });
      added.push(perm);
    } else if (old.description !== perm.description) {
      entries.push({ scope: perm, status: 'expanded' });
      kept.push(perm);
    } else {
      entries.push({ scope: perm, status: 'kept' });
      kept.push(perm);
    }
  }

  // Walk old scopes — find removals
  for (const perm of oldPerms) {
    if (!newMap.has(perm.id)) {
      entries.push({ scope: perm, status: 'removed' });
      removed.push(perm);
    }
  }

  const requiresApproval = added.length > 0;

  return {
    agentId: '',
    previousVersion: oldScopes?.version ?? '0.0.0',
    newVersion: newScopes.version,
    added,
    removed,
    kept,
    entries,
    requiresApproval,
  };
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a scope diff for terminal display.
 *
 * Output pattern:
 *   [kept]     read:source          Read source code files
 *   + [new]    write:migrations     Write database migrations
 *   - [removed] tool:deprecated     Old deprecated tool
 */
export function formatScopeDiff(
  diff: ScopeDiff,
  agentName: string,
  oldVersion?: string,
  newVersion?: string,
): string {
  const lines: string[] = [];

  // Header
  if (oldVersion && newVersion) {
    lines.push(`  Updating ${chalk.white.bold(agentName)} ${chalk.dim(oldVersion)} ${chalk.dim('\u2192')} ${chalk.dim(newVersion)}...`);
  } else {
    lines.push(`  Scopes for ${chalk.white.bold(agentName)}:`);
  }

  lines.push('');
  lines.push(`  ${chalk.dim('Scope changes:')}`);
  lines.push(`  ${chalk.dim('\u2500'.repeat(49))}`);

  // Scope entries
  for (const entry of diff.entries) {
    const id = entry.scope.id;
    const desc = entry.scope.description;

    switch (entry.status) {
      case 'kept':
        lines.push(`    ${chalk.dim('[kept]')}     ${id.padEnd(24)} ${chalk.dim(desc)}`);
        break;
      case 'expanded':
        lines.push(`    ${chalk.yellow('[expanded]')} ${id.padEnd(24)} ${chalk.yellow(desc)}`);
        break;
      case 'new':
        lines.push(`  ${chalk.green('+')} ${chalk.green('[new]')}     ${chalk.green(id.padEnd(24))} ${chalk.green(desc)}`);
        break;
      case 'removed':
        lines.push(`  ${chalk.red('-')} ${chalk.red('[removed]')} ${chalk.red(id.padEnd(24))} ${chalk.red(desc)}`);
        break;
    }
  }

  lines.push('');

  // Summary
  const parts: string[] = [];
  if (diff.added.length > 0) parts.push(chalk.green(`${diff.added.length} new`));
  if (diff.removed.length > 0) parts.push(chalk.red(`${diff.removed.length} removed`));
  if (diff.kept.length > 0) parts.push(chalk.dim(`${diff.kept.length} unchanged`));
  if (parts.length > 0) {
    lines.push(`  ${parts.join(', ')}`);
  }

  return lines.join('\n');
}

// ============================================================================
// Approval Persistence
// ============================================================================

/**
 * Load the adoptions.yaml file from the project root.
 * Returns the raw parsed object, or null if the file doesn't exist.
 */
async function loadAdoptionsFile(rootDir: string): Promise<Record<string, unknown> | null> {
  const filePath = path.join(rootDir, ADOPTIONS_FILE);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return (yaml.load(content) as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

/**
 * Save the adoptions.yaml file.
 */
async function saveAdoptionsFile(rootDir: string, data: Record<string, unknown>): Promise<void> {
  const filePath = path.join(rootDir, ADOPTIONS_FILE);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false }), 'utf-8');
}

/**
 * Approve scopes for an agent.
 *
 * Writes the approved scopes into the agent's adoption record,
 * sets scopes.approved to the current ISO date, and removes
 * the agent from .pending-scope-reviews if present.
 */
export async function approveScopes(
  rootDir: string,
  agentId: string,
  scopes: AgentScopes,
): Promise<void> {
  const tracker = log.component('#scopes-approval').info('Approving scopes', { agentId });

  // Update adoptions.yaml
  let adoptions = await loadAdoptionsFile(rootDir);
  if (!adoptions) {
    adoptions = { version: '1.0', 'adopted-at': '', 'project-type': '', agents: {} };
  }
  const agents = (adoptions.agents as Record<string, Record<string, unknown>>) ?? {};

  const now = new Date().toISOString().split('T')[0];
  const approvedScopes: AgentScopes = {
    ...scopes,
    approved: now,
  };

  if (!agents[agentId]) {
    agents[agentId] = {};
  }
  agents[agentId]['scopes-approved'] = now;
  agents[agentId]['scopes'] = approvedScopes;
  adoptions.agents = agents;

  await saveAdoptionsFile(rootDir, adoptions);

  // Remove from pending reviews
  await removePendingReview(rootDir, agentId);

  log.component('#scopes-approval').info('Scopes approved', { agentId, date: now });
}

/**
 * Deny scopes for an agent.
 *
 * Marks the agent's scope update as denied. The agent keeps its
 * previous approved scopes. Removes from pending reviews.
 */
export async function denyScopes(
  rootDir: string,
  agentId: string,
): Promise<void> {
  log.component('#scopes-denial').info('Denying scopes', { agentId });

  // Update adoptions.yaml with denial marker
  let adoptions = await loadAdoptionsFile(rootDir);
  if (!adoptions) {
    adoptions = { version: '1.0', 'adopted-at': '', 'project-type': '', agents: {} };
  }
  const agents = (adoptions.agents as Record<string, Record<string, unknown>>) ?? {};

  if (!agents[agentId]) {
    agents[agentId] = {};
  }
  agents[agentId]['scopes-denied'] = new Date().toISOString().split('T')[0];
  adoptions.agents = agents;

  await saveAdoptionsFile(rootDir, adoptions);

  // Remove from pending reviews
  await removePendingReview(rootDir, agentId);

  log.component('#scopes-denial').info('Scopes denied', { agentId });
}

// ============================================================================
// Pending Reviews
// ============================================================================

/**
 * Pending review file structure:
 *   version: "1.0"
 *   reviews:
 *     <agentId>:
 *       old: <AgentScopes | null>
 *       new: <AgentScopes>
 */
interface PendingReviewsFile {
  version: string;
  reviews: Record<string, { old: AgentScopes | null; new: AgentScopes }>;
}

/**
 * Load all pending scope reviews.
 *
 * Reads .paradigm/.pending-scope-reviews (YAML).
 * Returns a map of agent IDs to their pending scope changes.
 */
export async function loadPendingReviews(
  rootDir: string,
): Promise<Record<string, { old: AgentScopes | undefined; new: AgentScopes }>> {
  const filePath = path.join(rootDir, PENDING_REVIEWS_FILE);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = yaml.load(content) as PendingReviewsFile | null;
    if (!data?.reviews) return {};

    // Normalize null → undefined for consumer convenience
    const result: Record<string, { old: AgentScopes | undefined; new: AgentScopes }> = {};
    for (const [id, entry] of Object.entries(data.reviews)) {
      result[id] = {
        old: entry.old ?? undefined,
        new: entry.new,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Save a pending scope review for an agent.
 *
 * Used in non-interactive environments where the user can't
 * approve immediately. Agent runs with previous scopes until
 * the user reviews via `paradigm agent review`.
 */
export async function savePendingReview(
  rootDir: string,
  agentId: string,
  oldScopes: AgentScopes | undefined,
  newScopes: AgentScopes,
): Promise<void> {
  log.component('#scopes-pending').info('Saving pending review', { agentId });

  const filePath = path.join(rootDir, PENDING_REVIEWS_FILE);
  let data: PendingReviewsFile;

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    data = (yaml.load(content) as PendingReviewsFile) ?? { version: '1.0', reviews: {} };
    if (!data.reviews) data.reviews = {};
  } catch {
    data = { version: '1.0', reviews: {} };
  }

  data.reviews[agentId] = {
    old: oldScopes ?? null,
    new: newScopes,
  };

  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false }), 'utf-8');

  log.component('#scopes-pending').info('Pending review saved', { agentId });
}

/**
 * Remove a single agent from the pending reviews file.
 * If the file becomes empty, delete it.
 */
async function removePendingReview(rootDir: string, agentId: string): Promise<void> {
  const filePath = path.join(rootDir, PENDING_REVIEWS_FILE);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = yaml.load(content) as PendingReviewsFile | null;
    if (!data?.reviews) return;

    delete data.reviews[agentId];

    if (Object.keys(data.reviews).length === 0) {
      await fs.unlink(filePath);
    } else {
      await fs.writeFile(filePath, yaml.dump(data, { lineWidth: 120, noRefs: true, sortKeys: false }), 'utf-8');
    }
  } catch {
    // File doesn't exist or can't be read — nothing to remove
  }
}

// ============================================================================
// Approval State
// ============================================================================

/**
 * Determine the approval state for an agent's scopes.
 *
 * States:
 *   - 'approved' — agent has approved scopes with a date
 *   - 'pending'  — agent has pending scope changes awaiting review
 *   - 'denied'   — user explicitly denied the last scope update
 */
export async function getApprovalState(
  rootDir: string,
  agentId: string,
): Promise<ApprovalState> {
  // Check pending reviews first — takes priority
  const pending = await loadPendingReviews(rootDir);
  if (pending[agentId]) {
    return 'pending';
  }

  // Check adoptions.yaml for approved or denied state
  const adoptions = await loadAdoptionsFile(rootDir);
  if (!adoptions) return 'pending';

  const agents = (adoptions.agents as Record<string, Record<string, unknown>>) ?? {};
  const agent = agents[agentId];
  if (!agent) return 'pending';

  // Denied takes precedence over approved (denied is set after a specific update denial)
  if (agent['scopes-denied']) {
    return 'denied';
  }

  if (agent['scopes-approved'] || agent['scopes']?.['approved' as keyof object]) {
    return 'approved';
  }

  return 'pending';
}
