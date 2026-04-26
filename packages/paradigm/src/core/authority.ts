/**
 * authority.ts — v6.0.4 authority.yaml writer module
 *
 * Writes `.paradigm/authority.yaml` with archetype-default claims for the
 * compliance archetype (Rune): aspect-coverage, aspect-drift,
 * anchor-staleness — each at severity 'advise', per TD-2026-04-26-284.
 *
 * Schema is locked at v0-experimental for v6.1's `paradigm_authority_claim`
 * MCP tool to read without migration. No reader exists in v6.0.4.
 *
 * Idempotent: if `.paradigm/authority.yaml` already exists, no-op. Caller
 * decides when to invoke (Wave 3 wires `paradigm shift` triggers).
 *
 * Symbol: #authority-yaml-writer
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * Source of an authority.yaml claim entry.
 *
 * - `archetype-default`: written automatically when an archetype with default
 *   claims (currently only `compliance`) is added to the roster.
 * - `explicit`: written by the v6.1 `paradigm_authority_claim` MCP tool.
 * - `user`: written by manual user edit (post-load reconciliation).
 */
export type AuthoritySource = 'archetype-default' | 'explicit' | 'user';

interface AuthorityClaim {
  claimant: string;
  severity: 'advise' | 'warn' | 'block';
  since: string;
  source: AuthoritySource;
}

interface AuthorityFile {
  version: string;
  schema: string;
  claims: Record<string, AuthorityClaim>;
}

const AUTHORITY_RELATIVE_PATH = path.join('.paradigm', 'authority.yaml');

/**
 * Write archetype-default claims for the `compliance` archetype to
 * `.paradigm/authority.yaml`. Idempotent — no-op if the file already exists.
 *
 * @param projectRoot Absolute path to the project root.
 * @param source Trigger that caused this write. Recorded per-claim.
 */
export async function writeArchetypeDefaults(
  projectRoot: string,
  source: AuthoritySource
): Promise<void> {
  const authorityPath = path.join(projectRoot, AUTHORITY_RELATIVE_PATH);

  // Idempotent: do not overwrite an existing file. v6.1 MCP tools or user
  // edits may have already shaped the claims map.
  try {
    await fs.access(authorityPath);
    return;
  } catch {
    // File does not exist — proceed with write.
  }

  // Defensive mkdir — `.paradigm/` should exist when this is called from
  // `paradigm shift`, but the writer should not assume callers prepared the dir.
  await fs.mkdir(path.dirname(authorityPath), { recursive: true });

  const since = new Date().toISOString();
  const data: AuthorityFile = {
    version: '1.0',
    schema: 'v0-experimental',
    claims: {
      'aspect-coverage': {
        claimant: 'compliance',
        severity: 'advise',
        since,
        source,
      },
      'aspect-drift': {
        claimant: 'compliance',
        severity: 'advise',
        since,
        source,
      },
      'anchor-staleness': {
        claimant: 'compliance',
        severity: 'advise',
        since,
        source,
      },
    },
  };

  const serialized = yaml.dump(data, { lineWidth: 100, sortKeys: false });
  await fs.writeFile(authorityPath, serialized, 'utf8');
}
