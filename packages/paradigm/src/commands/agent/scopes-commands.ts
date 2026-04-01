/**
 * CLI command handlers for agent scoped permissions.
 *
 * Commands:
 *   paradigm agent review [id]   — Review pending scope changes
 *   paradigm agent approve <id>  — Quick-approve pending scopes
 *   paradigm agent deny <id>     — Deny pending scope changes
 *   paradigm agent scopes <id>   — Display current approved scopes
 *
 * See docs/specs/agent-adoption.md for full specification.
 */

import chalk from 'chalk';
import { log } from '../../utils/logger.js';
import { out, success, warn, error, header, kv, dim, json } from '../../utils/cli-output.js';
import {
  loadPendingReviews,
  diffScopes,
  formatScopeDiff,
  approveScopes,
  denyScopes,
} from './scopes.js';
import { loadAdoptions } from './adoption.js';
import type { AgentScopes } from './scopes-types.js';

// ============================================================================
// paradigm agent review [id]
// ============================================================================

/**
 * Review pending scope changes for agents.
 *
 * - If `id` is provided: show the pending diff for that agent and
 *   prompt for approve/deny.
 * - If no `id`: list all agents with pending scope reviews.
 */
export async function agentReviewCommand(
  id?: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const cwd = process.cwd();
  const tracker = log.command('agent-review').start('Reviewing agent scopes', { cwd, id });

  const reviews = await loadPendingReviews(cwd);
  const pendingIds = Object.keys(reviews);

  // No pending reviews at all
  if (pendingIds.length === 0) {
    if (options.json) {
      json({ pending: 0, agents: [] });
    } else {
      header('Agent Scope Reviews');
      out('');
      dim('  No pending scope reviews.');
      out('');
    }
    tracker.success('No pending reviews');
    return;
  }

  // List all pending reviews (no id specified)
  if (!id) {
    if (options.json) {
      const items = pendingIds.map((agentId) => {
        const entry = reviews[agentId];
        const diff = diffScopes(entry.old, entry.new);
        return {
          id: agentId,
          added: diff.added.length,
          removed: diff.removed.length,
          kept: diff.kept.length,
          requiresApproval: diff.requiresApproval,
        };
      });
      json({ pending: pendingIds.length, agents: items });
    } else {
      header('Pending Scope Reviews');
      out('');
      out(`  ${chalk.cyan(String(pendingIds.length))} agent(s) with pending scope changes:`);
      out('');

      for (const agentId of pendingIds) {
        const entry = reviews[agentId];
        const diff = diffScopes(entry.old, entry.new);
        const addedStr = diff.added.length > 0
          ? chalk.green(`+${diff.added.length} new`)
          : '';
        const removedStr = diff.removed.length > 0
          ? chalk.red(`-${diff.removed.length} removed`)
          : '';
        const parts = [addedStr, removedStr].filter(Boolean).join(', ');
        out(`    ${chalk.white.bold(agentId.padEnd(20))} ${parts || chalk.dim('description changes only')}`);
      }

      out('');
      dim(`  Review individually: ${chalk.cyan('paradigm agent review <id>')}`);
      dim(`  Quick approve:      ${chalk.cyan('paradigm agent approve <id>')}`);
      out('');
    }
    tracker.success(`${pendingIds.length} pending reviews listed`);
    return;
  }

  // Review a specific agent
  const entry = reviews[id];
  if (!entry) {
    if (options.json) {
      json({ error: `No pending review for agent "${id}"` });
    } else {
      error(`No pending scope review for agent "${id}".`);
      if (pendingIds.length > 0) {
        dim(`  Pending reviews exist for: ${pendingIds.join(', ')}`);
      }
    }
    tracker.error(`No pending review for ${id}`);
    return;
  }

  // Show the diff
  const diff = diffScopes(entry.old, entry.new);
  diff.agentId = id;

  if (options.json) {
    json({
      agentId: id,
      diff: {
        previousVersion: diff.previousVersion,
        newVersion: diff.newVersion,
        added: diff.added,
        removed: diff.removed,
        kept: diff.kept,
        requiresApproval: diff.requiresApproval,
      },
    });
  } else {
    header('Scope Review');
    out('');
    out(formatScopeDiff(diff, id, diff.previousVersion, diff.newVersion));
    out('');

    if (diff.requiresApproval) {
      dim(`  To approve: ${chalk.cyan(`paradigm agent approve ${id}`)}`);
      dim(`  To deny:    ${chalk.cyan(`paradigm agent deny ${id}`)}`);
    } else {
      dim('  No new scopes — description changes only. Auto-approvable.');
      dim(`  Approve: ${chalk.cyan(`paradigm agent approve ${id}`)}`);
    }
    out('');
  }

  tracker.success(`Showed review for ${id}`);
}

// ============================================================================
// paradigm agent approve <id>
// ============================================================================

/**
 * Quick-approve an agent's pending scope changes without interactive review.
 */
export async function agentApproveCommand(
  id: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const cwd = process.cwd();
  const tracker = log.command('agent-approve').start('Approving agent scopes', { cwd, id });

  const reviews = await loadPendingReviews(cwd);
  const entry = reviews[id];

  if (!entry) {
    if (options.json) {
      json({ error: `No pending review for agent "${id}"` });
    } else {
      error(`No pending scope review for agent "${id}".`);
      const pendingIds = Object.keys(reviews);
      if (pendingIds.length > 0) {
        dim(`  Pending reviews exist for: ${pendingIds.join(', ')}`);
      } else {
        dim('  No pending reviews.');
      }
    }
    tracker.error(`No pending review for ${id}`);
    return;
  }

  await approveScopes(cwd, id, entry.new);

  if (options.json) {
    json({
      agentId: id,
      approved: true,
      scopeVersion: entry.new.version,
      permissions: entry.new.permissions.length,
    });
  } else {
    success(`Scopes approved for ${chalk.white.bold(id)}`);
    kv('Scope version', entry.new.version);
    kv('Permissions', String(entry.new.permissions.length));
    out('');
  }

  tracker.success(`Approved scopes for ${id}`);
}

// ============================================================================
// paradigm agent deny <id>
// ============================================================================

/**
 * Deny an agent's pending scope changes.
 * The agent keeps its previous approved scopes.
 */
export async function agentDenyCommand(
  id: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const cwd = process.cwd();
  const tracker = log.command('agent-deny').start('Denying agent scopes', { cwd, id });

  const reviews = await loadPendingReviews(cwd);
  const entry = reviews[id];

  if (!entry) {
    if (options.json) {
      json({ error: `No pending review for agent "${id}"` });
    } else {
      error(`No pending scope review for agent "${id}".`);
      const pendingIds = Object.keys(reviews);
      if (pendingIds.length > 0) {
        dim(`  Pending reviews exist for: ${pendingIds.join(', ')}`);
      } else {
        dim('  No pending reviews.');
      }
    }
    tracker.error(`No pending review for ${id}`);
    return;
  }

  await denyScopes(cwd, id);

  if (options.json) {
    json({
      agentId: id,
      denied: true,
      message: 'Agent will continue using previously approved scopes.',
    });
  } else {
    warn(`Scopes denied for ${chalk.white.bold(id)}`);
    dim('  Agent will continue using previously approved scopes.');
    out('');
  }

  tracker.success(`Denied scopes for ${id}`);
}

// ============================================================================
// paradigm agent scopes <id>
// ============================================================================

/**
 * Display an agent's current approved scopes.
 */
export async function agentScopesCommand(
  id: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const cwd = process.cwd();
  const tracker = log.command('agent-scopes').start('Showing agent scopes', { cwd, id });

  const adoptions = await loadAdoptions(cwd);

  if (!adoptions || !adoptions.agents[id]) {
    if (options.json) {
      json({ error: `Agent "${id}" not found in adoptions` });
    } else {
      error(`Agent "${id}" not found in adoption records.`);
      dim(`  Run ${chalk.cyan('paradigm shift')} to initialize adoptions.`);
    }
    tracker.error(`Agent ${id} not in adoptions`);
    return;
  }

  const record = adoptions.agents[id];

  // The scopes may be stored in the adoption record directly,
  // or we need to check the raw adoptions file for the scopes field
  const rawAdoptions = await loadRawAdoptions(cwd);
  const rawAgent = rawAdoptions?.agents?.[id];
  const scopes = rawAgent?.scopes as AgentScopes | undefined;

  if (options.json) {
    json({
      agentId: id,
      source: record.source,
      scopesApproved: record.scopesApproved || null,
      scopes: scopes || null,
    });
    tracker.success(`Showed scopes for ${id}`);
    return;
  }

  header(`Scopes: ${id}`);
  out('');
  kv('Source', record.source);
  kv('Adopted', record.adopted);

  if (!scopes || !scopes.permissions || scopes.permissions.length === 0) {
    out('');
    dim('  No scopes declared. Agent is using default permissions.');
    out('');
    tracker.success(`No scopes for ${id}`);
    return;
  }

  kv('Scope version', scopes.version);
  if (scopes.approved) {
    kv('Approved', scopes.approved);
  }

  out('');
  out(`  ${chalk.bold('Permissions:')}`);
  for (const perm of scopes.permissions) {
    const isDangerous = scopes.dangerous?.includes(perm.id);
    const idStr = isDangerous
      ? chalk.yellow(perm.id.padEnd(24))
      : chalk.white(perm.id.padEnd(24));
    out(`    ${idStr} ${chalk.gray(perm.description)}`);
  }

  if (scopes.dangerous && scopes.dangerous.length > 0) {
    out('');
    out(`  ${chalk.yellow('Dangerous scopes')} (require runtime confirmation):`);
    for (const d of scopes.dangerous) {
      out(`    ${chalk.yellow(d)}`);
    }
  }

  out('');
  tracker.success(`Showed scopes for ${id}`);
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Load the raw (unparsed through AdoptionsFile normalization) adoptions data
 * to access the scopes field directly as stored in YAML.
 */
async function loadRawAdoptions(
  rootDir: string,
): Promise<Record<string, any> | null> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const yaml = await import('js-yaml');

  const filePath = path.join(rootDir, '.paradigm', 'adoptions.yaml');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return (yaml.load(content) as Record<string, any>) ?? null;
  } catch {
    return null;
  }
}
