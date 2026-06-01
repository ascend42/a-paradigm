/**
 * CLI tenant selectors — v6.0 pack/project/discipline resolution.
 *
 * Shared helper used by the paradigm university subcommands to resolve the
 * three selectors (--pack, --project, --discipline) into a pack root + id.
 *
 * Keeps the CLI independent of paradigm-mcp's pack-loader; re-reads
 * pack.yaml at call time. Good enough for the additive v5.39.0 surface —
 * v6.0 may collapse into a shared package if we want the cache/discovery
 * machinery from paradigm-mcp.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
// Unified pack-entry probe (spec §4.4 / T-2026-05-31-001). Replaces the CLI's
// formerly-local `countPackEntries` so the MCP + CLI probes can never re-drift.
import { countPackEntries } from '@a-company/university-core';

const UNIVERSITY_DIR = '.paradigm/university';
const PACK_MANIFEST_FILENAME = 'pack.yaml';

export interface SelectorOptions {
  pack?: string;
  project?: boolean;
  discipline?: string;
}

/**
 * v6.5: Read the user-declared sections array from a pack's manifest. Returns
 * an empty array when the manifest is missing/unparseable or when no sections
 * are declared. Consumers distinguish between "no sections declared" (length 0)
 * and the loader's synthesized implicit-default `main` section (which lives in
 * paradigm-mcp, not here).
 */
export function readPackSections(packRoot: string): Array<{ id: string; name?: string }> {
  const manifest = safeLoadManifest(packRoot);
  if (!manifest || !Array.isArray(manifest.sections)) return [];
  const out: Array<{ id: string; name?: string }> = [];
  for (const s of manifest.sections) {
    if (s && typeof s.id === 'string' && s.id.length > 0) {
      out.push({ id: s.id, name: typeof s.name === 'string' ? s.name : undefined });
    }
  }
  return out;
}

export interface ResolvedPackContext {
  /** Pack id resolved from the manifest (or derived from dir name when
   *  no manifest is present — v5 implicit-pack path). */
  packId: string;
  /** Absolute path to the pack root directory. */
  packRoot: string;
  /** Tenant classification — only populated when a manifest was present. */
  tenantKind?: 'first-party' | 'project' | 'external';
  /** True if a pack.yaml was actually loaded (vs. fabricated). */
  hasManifest: boolean;
  /** When --discipline was requested, the resolved sub-pack root. */
  subPackRoot?: string;
  subPackId?: string;
}

interface MinimalManifest {
  id?: string;
  name?: string;
  tenant_kind?: 'first-party' | 'project' | 'external';
  disciplines?: string[];
  /** v6.5: declared sections. Each entry shape is unvalidated here; consumers
   *  treat the array length as the user-declared count and inspect ids if
   *  needed (add.ts unknown-id validation). Empty/missing → 0 declared. */
  sections?: Array<{ id?: string; name?: string }>;
}

function safeLoadManifest(packRoot: string): MinimalManifest | null {
  const manifestPath = path.join(packRoot, PACK_MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const data = yaml.load(raw) as MinimalManifest | null;
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Discover all packs under a project — first-party (node_modules) + local
 * project pack at .paradigm/university/. Lightweight: no dep walk, no cache.
 */
export function discoverPacksForCli(rootDir: string): Array<{
  id: string;
  name?: string;
  tenantKind: 'first-party' | 'project' | 'external';
  packRoot: string;
  disciplines?: string[];
  entryCount: number;
}> {
  const results: Array<{
    id: string;
    name?: string;
    tenantKind: 'first-party' | 'project' | 'external';
    packRoot: string;
    disciplines?: string[];
    entryCount: number;
  }> = [];

  // First-party
  const firstPartyRoot = path.join(rootDir, 'node_modules', '@a-company', 'university');
  const fp = safeLoadManifest(firstPartyRoot);
  if (fp && fp.id && fp.tenant_kind) {
    results.push({
      id: fp.id,
      name: fp.name,
      tenantKind: fp.tenant_kind,
      packRoot: firstPartyRoot,
      disciplines: fp.disciplines,
      entryCount: countPackEntries(firstPartyRoot),
    });
  }

  // Local project pack
  const localRoot = path.join(rootDir, UNIVERSITY_DIR);
  if (fs.existsSync(localRoot)) {
    const local = safeLoadManifest(localRoot);
    const id = local?.id ?? path.basename(rootDir);
    const tenantKind = local?.tenant_kind ?? 'project';
    results.push({
      id,
      name: local?.name,
      tenantKind,
      packRoot: localRoot,
      disciplines: local?.disciplines,
      entryCount: countPackEntries(localRoot),
    });

    // Discipline sub-packs
    try {
      const entries = fs.readdirSync(localRoot, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
        const sub = path.join(localRoot, ent.name);
        const subManifest = safeLoadManifest(sub);
        if (!subManifest || !subManifest.id) continue;
        results.push({
          id: subManifest.id,
          name: subManifest.name,
          tenantKind: subManifest.tenant_kind ?? 'project',
          packRoot: sub,
          disciplines: subManifest.disciplines,
          entryCount: countPackEntries(sub),
        });
      }
    } catch {
      // skip
    }
  }

  return results;
}

// `countPackEntries` is now imported from @a-company/university-core (above) —
// the formerly-local definition was deleted in the extract-university-core
// refactor (spec §4.4). Re-export it so any consumer of this module's public
// surface keeps resolving the symbol.
export { countPackEntries };

/**
 * Resolve selectors to a concrete pack context. Precedence:
 *   1. --pack <id>        → pick pack with matching id.
 *   2. --project          → local project pack.
 *   3. (default)          → local project pack if present, else first-party.
 *   4. --discipline <d>   → combined with (1-3), picks the sub-pack.
 */
export function resolvePackContext(
  rootDir: string,
  options: SelectorOptions,
): ResolvedPackContext {
  const packs = discoverPacksForCli(rootDir);

  let primary: ResolvedPackContext;

  if (options.pack) {
    const match = packs.find(p => p.id === options.pack);
    if (match) {
      primary = {
        packId: match.id,
        packRoot: match.packRoot,
        tenantKind: match.tenantKind,
        hasManifest: true,
      };
    } else {
      // Explicit pack not discovered — fall through to implicit project root.
      const implicitRoot = path.join(rootDir, UNIVERSITY_DIR);
      primary = {
        packId: options.pack,
        packRoot: implicitRoot,
        hasManifest: false,
      };
    }
  } else if (options.project) {
    const project = packs.find(p => p.tenantKind === 'project' && !p.disciplines);
    const implicitRoot = path.join(rootDir, UNIVERSITY_DIR);
    if (project) {
      primary = {
        packId: project.id,
        packRoot: project.packRoot,
        tenantKind: project.tenantKind,
        hasManifest: true,
      };
    } else {
      primary = {
        packId: path.basename(rootDir),
        packRoot: implicitRoot,
        hasManifest: false,
      };
    }
  } else {
    // Default: project pack if present, else first-party
    const project = packs.find(p => p.tenantKind === 'project');
    if (project) {
      primary = {
        packId: project.id,
        packRoot: project.packRoot,
        tenantKind: project.tenantKind,
        hasManifest: true,
      };
    } else {
      const firstParty = packs.find(p => p.tenantKind === 'first-party');
      if (firstParty) {
        primary = {
          packId: firstParty.id,
          packRoot: firstParty.packRoot,
          tenantKind: firstParty.tenantKind,
          hasManifest: true,
        };
      } else {
        const implicitRoot = path.join(rootDir, UNIVERSITY_DIR);
        primary = {
          packId: path.basename(rootDir),
          packRoot: implicitRoot,
          hasManifest: false,
        };
      }
    }
  }

  // Discipline sub-pack resolution
  if (options.discipline) {
    const subRoot = path.join(primary.packRoot, options.discipline);
    const subManifest = safeLoadManifest(subRoot);
    if (subManifest && subManifest.id) {
      primary.subPackRoot = subRoot;
      primary.subPackId = subManifest.id;
    } else if (fs.existsSync(subRoot)) {
      // Directory exists without manifest — still scope to it.
      primary.subPackRoot = subRoot;
      primary.subPackId = `${primary.packId}-${options.discipline}`;
    }
  }

  return primary;
}

/**
 * True when any selector flag is set. Used by `list` to switch between
 * pack-listing and entry-listing modes.
 */
export function hasSelector(options: SelectorOptions): boolean {
  return Boolean(options.pack || options.project || options.discipline);
}
