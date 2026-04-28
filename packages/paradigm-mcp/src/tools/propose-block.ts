/**
 * propose-block.ts — v6.1 soft-block primitive MCP tool
 *
 * Single tool `paradigm_propose_block`: agent-initiated, framework-honored,
 * user-keystroke-overridable. Writes a remediation YAML to
 * `.paradigm/remediations/<id>.yaml`. The Stop hook (Check 14) reads
 * remediations dir on next run and refuses-with-override when active.
 *
 * Per TD-2026-04-26-284 res 3: soft-block primitive ships at v6.1.
 * Per TD-2026-04-25-417: framework provides primitives, agents own enforcement.
 *
 * Roster check: NONE. Per agent-sovereignty principle, framework provides
 * primitives; user can override noise. Builder will not gate by roster.
 *
 * Symbol: #paradigm-propose-block
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ProjectContext } from '../utils/index-loader.js';

const REMEDIATIONS_RELATIVE_DIR = path.join('.paradigm', 'remediations');

interface RemediationTarget {
  file?: string;
  symbol?: string;
  line?: number;
}

interface Remediation {
  id: string;
  claimant: string;
  severity: 'advise' | 'auto-author' | 'guard';
  reason: string;
  unblock_hint: string;
  created: string;
  expires_at?: string;
  target?: RemediationTarget;
}

/**
 * Generate a remediation id matching the project's id convention:
 * `rmd-<base36-of-Date.now()>`. ~8-9 chars after prefix.
 */
function generateRemediationId(): string {
  return 'rmd-' + Date.now().toString(36);
}

/**
 * Get list of soft-block primitive tools with safety annotations.
 */
export function getProposeBlockToolsList() {
  return [
    {
      name: 'paradigm_propose_block',
      description:
        'Author a soft-block (remediation) that the Stop hook will honor until resolved. Use when your archetype detects a condition the user should resolve before continuing (e.g., coverage drop, missing aspect, broken anchor). User can override via `paradigm override <id>` or PARADIGM_OVERRIDE env var. v6.1: only severity=guard hard-blocks; advise/auto-author are informational. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          claimant: {
            type: 'string',
            description: 'Archetype id authoring this block (e.g., "compliance", "security"). REQUIRED — do not infer.',
          },
          severity: {
            type: 'string',
            enum: ['advise', 'auto-author', 'guard'],
            description: 'Block intent for this event. v6.1: only `guard` hard-blocks; `advise`/`auto-author` are informational.',
          },
          reason: {
            type: 'string',
            description: 'Free-text explanation surfaced to the user verbatim. Be specific (component name, file path).',
          },
          unblock_hint: {
            type: 'string',
            description: 'Plain-string remediation hint (v6.1; JSONLogic predicates ship v6.2). Tell the user how to resolve.',
          },
          expires_at: {
            type: 'string',
            description: 'OPTIONAL ISO 8601 UTC timestamp. After this, Check 14 silently skips the remediation. Use for time-bounded conditions.',
          },
          target: {
            type: 'object',
            description: 'OPTIONAL context: {file, symbol, line}.',
            properties: {
              file: { type: 'string' },
              symbol: { type: 'string' },
              line: { type: 'number' },
            },
          },
        },
        required: ['claimant', 'severity', 'reason', 'unblock_hint'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
  ];
}

/**
 * Handle propose-block tool calls.
 */
export async function handleProposeBlockTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  if (name !== 'paradigm_propose_block') {
    return { handled: false, text: '' };
  }

  const claimant = args.claimant as string;
  const severity = args.severity as 'advise' | 'auto-author' | 'guard';
  const reason = args.reason as string;
  const unblockHint = args.unblock_hint as string;
  const expiresAt = args.expires_at as string | undefined;
  const target = args.target as RemediationTarget | undefined;

  if (!claimant || !severity || !reason || !unblockHint) {
    return {
      handled: true,
      text: JSON.stringify({
        error: 'Missing required field. Required: claimant, severity, reason, unblock_hint.',
      }, null, 2),
    };
  }

  const id = generateRemediationId();
  const now = new Date().toISOString();

  const remediation: Remediation = {
    id,
    claimant,
    severity,
    reason,
    unblock_hint: unblockHint,
    created: now,
  };
  if (expiresAt) remediation.expires_at = expiresAt;
  if (target && (target.file || target.symbol || target.line != null)) {
    remediation.target = target;
  }

  const remediationsDir = path.join(ctx.rootDir, REMEDIATIONS_RELATIVE_DIR);
  await fs.mkdir(remediationsDir, { recursive: true });

  const filePath = path.join(remediationsDir, `${id}.yaml`);
  const serialized = yaml.dump(remediation, { lineWidth: 100, sortKeys: false });
  await fs.writeFile(filePath, serialized, 'utf8');

  return {
    handled: true,
    text: JSON.stringify({
      id,
      path: path.join(REMEDIATIONS_RELATIVE_DIR, `${id}.yaml`),
      claimant,
      severity,
      ...(expiresAt ? { expires_at: expiresAt } : {}),
      note: `Stop hook will ${severity === 'guard' ? 'block' : 'note'} on next run. User can clear with: paradigm override ${id}`,
    }, null, 2),
  };
}
