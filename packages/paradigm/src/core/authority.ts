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

export interface AuthorityClaim {
  claimant: string;
  severity: 'advise' | 'warn' | 'block';
  since: string;
  source: AuthoritySource;
}

export interface AuthorityFile {
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

// ─────────────────────────────────────────────────────────────────────────────
// v6.1 Reader / mutator API for the paradigm_authority_claim and
// paradigm_authority_release MCP tools (and any future caller).
//
// Symbol: #authority-readers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read `.paradigm/authority.yaml` from disk and return the parsed file.
 * Returns `null` if the file does not exist.
 *
 * Throws on parse errors (caller surfaces those — the file is user-managed).
 */
export async function readAuthority(projectRoot: string): Promise<AuthorityFile | null> {
  const authorityPath = path.join(projectRoot, AUTHORITY_RELATIVE_PATH);
  let content: string;
  try {
    content = await fs.readFile(authorityPath, 'utf8');
  } catch (err) {
    const errno = (err as NodeJS.ErrnoException).code;
    if (errno === 'ENOENT') return null;
    throw err;
  }

  const parsed = yaml.load(content) as AuthorityFile | null | undefined;
  if (parsed == null || typeof parsed !== 'object') {
    // Defensive: empty or malformed file → treat as empty claims map
    return { version: '1.0', schema: 'v0-experimental', claims: {} };
  }
  // Tolerate files missing the claims map (treat as empty)
  if (!parsed.claims || typeof parsed.claims !== 'object') {
    parsed.claims = {};
  }
  return parsed;
}

/**
 * Get the active claims map. Returns `{}` if the file is missing or empty.
 */
export async function getActiveClaims(projectRoot: string): Promise<Record<string, AuthorityClaim>> {
  const file = await readAuthority(projectRoot);
  return file?.claims ?? {};
}

/**
 * Internal helper: write the authority file with stable serialization.
 */
async function writeAuthorityFile(projectRoot: string, file: AuthorityFile): Promise<void> {
  const authorityPath = path.join(projectRoot, AUTHORITY_RELATIVE_PATH);
  await fs.mkdir(path.dirname(authorityPath), { recursive: true });
  const serialized = yaml.dump(file, { lineWidth: 100, sortKeys: false });
  await fs.writeFile(authorityPath, serialized, 'utf8');
}

/**
 * Idempotent upsert of a single claim. If `.paradigm/authority.yaml` does not
 * exist, a fresh file is created with just this claim. Re-claiming a scope
 * overwrites the prior entry (single-claimant-per-scope at v6.1, per spec §7).
 */
export async function upsertClaim(
  projectRoot: string,
  scope: string,
  claim: AuthorityClaim
): Promise<void> {
  const existing = (await readAuthority(projectRoot)) ?? {
    version: '1.0',
    schema: 'v0-experimental',
    claims: {},
  };
  existing.claims[scope] = claim;
  await writeAuthorityFile(projectRoot, existing);
}

/**
 * Remove a claim by scope. No-op if the file or scope is absent.
 * Returns `true` when a claim was removed, `false` otherwise.
 */
export async function removeClaim(projectRoot: string, scope: string): Promise<boolean> {
  const existing = await readAuthority(projectRoot);
  if (!existing) return false;
  if (!(scope in existing.claims)) return false;
  delete existing.claims[scope];
  await writeAuthorityFile(projectRoot, existing);
  return true;
}
