/**
 * authority.ts — v6.1 authority MCP tools
 *
 * Two tools: `paradigm_authority_claim` and `paradigm_authority_release`.
 * Reads/writes `.paradigm/authority.yaml` schema shipped at v6.0.4
 * (writer in `packages/paradigm/src/core/authority.ts`; this is the
 * READER + mutator side, kept self-contained because paradigm-mcp does
 * not depend on @a-company/paradigm).
 *
 * Per TD-2026-04-26-284 res 2: archetype-default claim model.
 * Per spec §7: single-claimant-per-scope model — re-claiming overwrites.
 *
 * Vocabulary note: authority.yaml severity is `{advise, warn, block}` —
 * the policy stance. Distinct from remediation severity `{advise, auto-author, guard}`
 * which is per-event block intent.
 *
 * Symbols: #paradigm-authority-claim, #paradigm-authority-release
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ProjectContext } from '../utils/index-loader.js';

const AUTHORITY_RELATIVE_PATH = path.join('.paradigm', 'authority.yaml');

type AuthoritySource = 'archetype-default' | 'explicit' | 'user';

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

async function readAuthority(projectRoot: string): Promise<AuthorityFile | null> {
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
    return { version: '1.0', schema: 'v0-experimental', claims: {} };
  }
  if (!parsed.claims || typeof parsed.claims !== 'object') {
    parsed.claims = {};
  }
  return parsed;
}

async function writeAuthorityFile(projectRoot: string, file: AuthorityFile): Promise<void> {
  const authorityPath = path.join(projectRoot, AUTHORITY_RELATIVE_PATH);
  await fs.mkdir(path.dirname(authorityPath), { recursive: true });
  const serialized = yaml.dump(file, { lineWidth: 100, sortKeys: false });
  await fs.writeFile(authorityPath, serialized, 'utf8');
}

/**
 * Get list of authority MCP tools with safety annotations.
 */
export function getAuthorityToolsList() {
  return [
    {
      name: 'paradigm_authority_claim',
      description:
        'Claim authority over a scope in .paradigm/authority.yaml. Idempotent on `scope` — re-claiming overwrites severity/claimant. Single-claimant-per-scope at v6.1. Severity vocab: advise|warn|block (policy stance, distinct from remediation severity). ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          claimant: {
            type: 'string',
            description: 'Archetype id (e.g., "compliance")',
          },
          scope: {
            type: 'string',
            description: 'Scope key (e.g., "aspect-coverage", "aspect-drift", "anchor-staleness")',
          },
          severity: {
            type: 'string',
            enum: ['advise', 'warn', 'block'],
            description: 'Policy stance. Default: advise.',
          },
        },
        required: ['claimant', 'scope'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_authority_release',
      description:
        'Release authority over a scope. Removes the claim entry from .paradigm/authority.yaml. Succeeds on archetype-default-created scopes (user/agent can override defaults). ~80 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          claimant: {
            type: 'string',
            description: 'Archetype id (used for audit; release is by scope key)',
          },
          scope: {
            type: 'string',
            description: 'Scope key to release',
          },
        },
        required: ['claimant', 'scope'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
  ];
}

/**
 * Handle authority MCP tool calls.
 */
export async function handleAuthorityTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  if (name === 'paradigm_authority_claim') {
    const claimant = args.claimant as string;
    const scope = args.scope as string;
    const severity = (args.severity as 'advise' | 'warn' | 'block') ?? 'advise';

    if (!claimant || !scope) {
      return {
        handled: true,
        text: JSON.stringify({ error: 'Missing required field: claimant, scope' }, null, 2),
      };
    }

    const since = new Date().toISOString();
    const claim: AuthorityClaim = { claimant, severity, since, source: 'explicit' };

    const existing = (await readAuthority(ctx.rootDir)) ?? {
      version: '1.0',
      schema: 'v0-experimental',
      claims: {},
    };
    existing.claims[scope] = claim;
    await writeAuthorityFile(ctx.rootDir, existing);

    return {
      handled: true,
      text: JSON.stringify({ scope, claimant, severity, source: 'explicit', since }, null, 2),
    };
  }

  if (name === 'paradigm_authority_release') {
    const claimant = args.claimant as string;
    const scope = args.scope as string;

    if (!claimant || !scope) {
      return {
        handled: true,
        text: JSON.stringify({ error: 'Missing required field: claimant, scope' }, null, 2),
      };
    }

    const existing = await readAuthority(ctx.rootDir);
    if (!existing || !(scope in existing.claims)) {
      return {
        handled: true,
        text: JSON.stringify({
          scope,
          released: false,
          note: 'no active claim on this scope',
        }, null, 2),
      };
    }

    const previousClaimant = existing.claims[scope].claimant;
    delete existing.claims[scope];
    await writeAuthorityFile(ctx.rootDir, existing);

    return {
      handled: true,
      text: JSON.stringify({ scope, released: true, previousClaimant }, null, 2),
    };
  }

  return { handled: false, text: '' };
}
