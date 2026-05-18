/**
 * Pack Loader — v6.0 multi-tenant content-pack discovery + resolution.
 *
 * Purpose (spec §1.3, §3.1 sub-phase 1):
 *   - Parse `pack.yaml` manifests at pack roots
 *   - Discover packs from three sources, in precedence order (later wins on id collision):
 *       1. first-party bundled `node_modules/@a-company/university/`
 *       2. npm packages with a `paradigm.universityPack` pointer in package.json (direct deps only)
 *       3. local `.paradigm/university/` project pack + discipline sub-packs
 *   - Resolve entry addresses — bare `<entry-id>` (uses activePack) or `<pack-id>:<entry-id>`
 *
 * Security contract:
 *   - Manifest-parse failures surface as classifier-only errors (reuses
 *     `classifyYamlError` via `safeLoad` from yaml-validator). Never leaks
 *     file contents, pack internals, or fs paths beyond caller-supplied dirs.
 *   - Discovery cache at `.paradigm/cache/packs.json` is keyed by
 *     `node_modules` mtime so `npm install` invalidates it.
 *   - Cap cost: direct deps only; does NOT walk transitive deps.
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import {
  PACK_MANIFEST_FILENAME,
  PACKAGE_JSON_POINTER_FIELD,
} from '../types/pack.js';
import type { PackLocation, PackManifest, Section, SectionStyle } from '../types/pack.js';
import { safeLoad } from './yaml-validator.js';
import { log } from './mcp-logger.js';

const FIRST_PARTY_PACKAGE_NAME = '@a-company/university';
const LOCAL_UNIVERSITY_DIR = '.paradigm/university';
const CACHE_REL_PATH = '.paradigm/cache/packs.json';

/**
 * Error classes emitted by pack-loader. Classifier strings only — never file
 * contents / pack internals / gate names in the public message.
 */
export type PackLoadErrorClass =
  | 'missing-manifest'
  | 'manifest-unparseable'
  | 'manifest-invalid'
  | 'missing-required-field';

export class PackLoadError extends Error {
  constructor(
    public readonly errorClass: PackLoadErrorClass,
    public readonly detail: string,
  ) {
    super(`pack-load failed (${errorClass}: ${detail})`);
    this.name = 'PackLoadError';
  }
}

// ─────────────────────────────────────────────────────────────
// Manifest loading
// ─────────────────────────────────────────────────────────────

const REQUIRED_MANIFEST_FIELDS: ReadonlyArray<keyof PackManifest> = [
  'id',
  'name',
  'version',
  'schema_version',
  'tenant_kind',
] as const;

const VALID_TENANT_KINDS: ReadonlySet<string> = new Set(['first-party', 'project', 'external']);

// ─────────────────────────────────────────────────────────────
// v6.5: Section schema + synthesis (Aegis-reviewed)
// ─────────────────────────────────────────────────────────────

/** Identifier discipline for section ids — kebab-case, ≤ 64 chars. */
const SECTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Hard cap on sections per pack (defence-in-depth against runaway manifests). */
const MAX_SECTIONS_PER_PACK = 64;

/** Allowed section styles — mirrors the SectionStyle type union. */
const SECTION_STYLE_VALUES = ['track', 'index', 'chronological', 'featured'] as const;

/**
 * Zod schema for a single Section. Surfaces classifier-only errors via the
 * `manifest-invalid` PackLoadError class — never echoes manifest body strings
 * into the public error surface.
 */
const SectionSchema = z.object({
  id: z
    .string()
    .regex(SECTION_ID_PATTERN, 'section.id must be kebab-case, ≤64 chars'),
  name: z
    .string()
    .min(1, 'section.name must be non-empty')
    .max(120, 'section.name must be ≤120 chars'),
  order: z
    .number()
    .int('section.order must be an integer')
    .min(0, 'section.order must be ≥0')
    .max(9999, 'section.order must be ≤9999'),
  style: z.enum(SECTION_STYLE_VALUES, {
    errorMap: () => ({ message: `section.style must be one of ${SECTION_STYLE_VALUES.join('|')}` }),
  }),
  description: z
    .string()
    .max(1000, 'section.description must be ≤1000 chars')
    .optional(),
  // Strict boolean — Zod's default z.boolean() rejects non-boolean inputs
  // including string "true"/"false" and 0/1, which is the contract Aegis
  // asked for.
  default: z.boolean({ invalid_type_error: 'section.default must be a boolean' }).optional(),
}).strict();

/** Zod array schema with the 64-section cap. */
const SectionsArraySchema = z
  .array(SectionSchema)
  .max(MAX_SECTIONS_PER_PACK, `sections must contain ≤${MAX_SECTIONS_PER_PACK} entries`);

/** The implicit-default section synthesized for packs without `sections:`. */
const IMPLICIT_DEFAULT_SECTION: Section = {
  id: 'main',
  name: 'Curriculum',
  order: 1,
  style: 'track',
  default: true,
};

/**
 * Validate + normalize a manifest's `sections:` block. Returns a fresh array
 * (never mutates the input). Synthesizes the implicit default section when
 * `sections` is missing or empty. Auto-promotes the sole section to default
 * for single-section packs that omit `default: true`.
 *
 * Throws PackLoadError('manifest-invalid', ...) — classifier-only messages,
 * never the manifest body — when the schema rejects.
 */
export function normalizeSections(rawSections: unknown): Section[] {
  // Missing or empty → synthesize implicit default. Per spec: empty array is
  // treated the same as missing field.
  if (rawSections === undefined || rawSections === null) {
    return [{ ...IMPLICIT_DEFAULT_SECTION }];
  }
  if (Array.isArray(rawSections) && rawSections.length === 0) {
    return [{ ...IMPLICIT_DEFAULT_SECTION }];
  }

  const parsed = SectionsArraySchema.safeParse(rawSections);
  if (!parsed.success) {
    // Classifier message; first issue path + code. Do NOT include issue
    // `received` values (those may echo manifest content).
    const first = parsed.error.issues[0];
    const detail = first
      ? `${first.path.join('.') || 'sections'}: ${first.message}`
      : 'sections failed schema validation';
    throw new PackLoadError('manifest-invalid', detail);
  }

  const sections = parsed.data.map((s) => ({ ...s })) as Section[];

  // Duplicate id check
  const seen = new Set<string>();
  for (const s of sections) {
    if (seen.has(s.id)) {
      throw new PackLoadError('manifest-invalid', `duplicate section id "${s.id}"`);
    }
    seen.add(s.id);
  }

  // Single-section packs with no default get auto-promoted (never fail a
  // one-section pack on the "exactly one default" rule).
  if (sections.length === 1 && !sections[0].default) {
    sections[0] = { ...sections[0], default: true };
  }

  // "Exactly one default" check — applies for multi-section packs.
  const defaults = sections.filter((s) => s.default === true);
  if (defaults.length > 1) {
    throw new PackLoadError(
      'manifest-invalid',
      `at most one section may set default: true (found ${defaults.length})`,
    );
  }

  // Stable sort by order, then id (deterministic when orders tie).
  sections.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));

  return sections;
}

/** Re-export the style enum values so other modules don't re-declare them. */
export const SECTION_STYLES: ReadonlyArray<SectionStyle> = SECTION_STYLE_VALUES;

/**
 * Read and validate a `pack.yaml` from a directory. Throws `PackLoadError`
 * with a classifier-only message on any failure — never leaks manifest
 * contents into the error surface.
 */
export function loadPackManifest(dir: string): PackManifest {
  const manifestPath = path.join(dir, PACK_MANIFEST_FILENAME);

  const result = safeLoad<PackManifest>(manifestPath);

  switch (result.status) {
    case 'missing':
      throw new PackLoadError('missing-manifest', `no ${PACK_MANIFEST_FILENAME} at pack root`);
    case 'unparseable':
      // detail already classifier-only per yaml-validator contract
      throw new PackLoadError('manifest-unparseable', result.detail);
    case 'invalid':
      throw new PackLoadError('manifest-invalid', result.detail);
    case 'ok': {
      const manifest = result.data;
      if (!manifest || typeof manifest !== 'object') {
        throw new PackLoadError('manifest-invalid', 'manifest is not an object');
      }

      // Presence check for required fields — classifier only, no values echoed.
      for (const field of REQUIRED_MANIFEST_FIELDS) {
        const value = manifest[field];
        if (value === undefined || value === null || value === '') {
          throw new PackLoadError(
            'missing-required-field',
            `required field ${String(field)} is missing or empty`,
          );
        }
      }

      if (!VALID_TENANT_KINDS.has(String(manifest.tenant_kind))) {
        throw new PackLoadError(
          'missing-required-field',
          'tenant_kind must be one of first-party|project|external',
        );
      }

      // v6.5: normalize sections (synthesize default when absent/empty, run
      // Zod schema, enforce single-default invariant). normalizeSections
      // throws PackLoadError('manifest-invalid', ...) with classifier-only
      // detail strings — never the manifest body.
      manifest.sections = normalizeSections((manifest as { sections?: unknown }).sections);

      return manifest;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────

interface PackCacheFile {
  version: 1;
  node_modules_mtime_ms?: number;
  local_university_mtime_ms?: number;
  packs: Array<{
    manifest: PackManifest;
    rootDir: string;
    source: PackLocation['source'];
    parentPackId?: string;
  }>;
}

/**
 * Discover packs from three sources. Returns merged list in precedence
 * order (first-party → npm → local). Caller may apply id-collision policy;
 * this function does NOT dedupe by id (that's a resolution concern).
 */
export function discoverPacks(projectRoot: string): PackLocation[] {
  // Try cache fast path
  const cached = tryReadCache(projectRoot);
  if (cached) {
    return cached;
  }

  const packs: PackLocation[] = [];

  // 1. First-party bundled @a-company/university
  const firstPartyRoot = path.join(projectRoot, 'node_modules', FIRST_PARTY_PACKAGE_NAME);
  if (fs.existsSync(path.join(firstPartyRoot, PACK_MANIFEST_FILENAME))) {
    try {
      const manifest = loadPackManifest(firstPartyRoot);
      packs.push({ manifest, rootDir: firstPartyRoot, source: 'first-party' });
    } catch (err) {
      log.component('#pack-loader').warn('first-party pack manifest invalid', {
        errorClass: err instanceof PackLoadError ? err.errorClass : 'other',
      });
    }
  }

  // 2. npm packages with paradigm.universityPack pointer (direct deps only)
  for (const npmPack of discoverNpmPackagePointers(projectRoot)) {
    try {
      const manifest = loadPackManifest(npmPack);
      packs.push({ manifest, rootDir: npmPack, source: 'npm' });
    } catch (err) {
      log.component('#pack-loader').warn('npm pack manifest invalid', {
        errorClass: err instanceof PackLoadError ? err.errorClass : 'other',
      });
    }
  }

  // 3. Local project pack + discipline sub-packs
  const localRoot = path.join(projectRoot, LOCAL_UNIVERSITY_DIR);
  if (fs.existsSync(localRoot) && fs.statSync(localRoot).isDirectory()) {
    const localManifestPath = path.join(localRoot, PACK_MANIFEST_FILENAME);
    let localManifest: PackManifest | undefined;

    if (fs.existsSync(localManifestPath)) {
      try {
        localManifest = loadPackManifest(localRoot);
        packs.push({ manifest: localManifest, rootDir: localRoot, source: 'local' });
      } catch (err) {
        log.component('#pack-loader').warn('local pack manifest invalid', {
          errorClass: err instanceof PackLoadError ? err.errorClass : 'other',
        });
      }
    }
    // Note: when `pack.yaml` is absent, we do NOT fabricate a synthetic
    // PackLocation in discoverPacks. The university-loader handles that
    // implicit case directly on its own resolution path (preserving v5
    // behavior). Keeping discoverPacks strictly manifest-driven makes the
    // discovery contract clean; the fabrication responsibility is in
    // university-loader where it belongs.

    // Discipline sub-packs
    const parentPackId = localManifest?.id ?? 'project';
    for (const sub of discoverLocalSubPacks(localRoot)) {
      try {
        const manifest = loadPackManifest(sub);
        packs.push({ manifest, rootDir: sub, source: 'local', parentPackId });
      } catch (err) {
        log.component('#pack-loader').warn('discipline sub-pack manifest invalid', {
          errorClass: err instanceof PackLoadError ? err.errorClass : 'other',
        });
      }
    }
  }

  // Persist cache (best-effort — cache failures never block discovery)
  tryWriteCache(projectRoot, packs);

  return packs;
}

/**
 * Scan direct deps (package.json) for a `paradigm.universityPack` field. Only
 * direct deps: reads the project's root `package.json` and looks at the
 * union of dependencies/devDependencies/peerDependencies keys — it does NOT
 * walk lockfiles or recurse into transitive deps.
 */
function discoverNpmPackagePointers(projectRoot: string): string[] {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  let rootPkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
  try {
    rootPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return [];
  }

  const depNames = new Set<string>([
    ...Object.keys(rootPkg.dependencies || {}),
    ...Object.keys(rootPkg.devDependencies || {}),
    ...Object.keys(rootPkg.peerDependencies || {}),
  ]);
  if (depNames.size === 0) return [];

  const nodeModulesRoot = path.join(projectRoot, 'node_modules');
  if (!fs.existsSync(nodeModulesRoot)) return [];

  const results: string[] = [];
  for (const depName of depNames) {
    // Skip the well-known first-party package (already handled in source 1)
    if (depName === FIRST_PARTY_PACKAGE_NAME) continue;

    const depPkgPath = path.join(nodeModulesRoot, depName, 'package.json');
    if (!fs.existsSync(depPkgPath)) continue;

    let depPkg: { paradigm?: { universityPack?: string } };
    try {
      depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf8'));
    } catch {
      continue;
    }

    const pointerField = depPkg.paradigm?.universityPack;
    if (typeof pointerField !== 'string' || pointerField.length === 0) continue;

    const packRoot = path.resolve(path.dirname(depPkgPath), pointerField);
    if (!fs.existsSync(path.join(packRoot, PACK_MANIFEST_FILENAME))) continue;

    results.push(packRoot);
  }

  // Field name is a const for docstring traceability; reference it so a rename
  // does not silently decouple the pointer field.
  void PACKAGE_JSON_POINTER_FIELD;

  return results;
}

/**
 * Find discipline sub-packs under a local project pack root — subdirectories
 * that themselves contain a `pack.yaml`.
 */
function discoverLocalSubPacks(localRoot: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(localRoot, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.')) continue;  // skip hidden (.metrics/, .cache/, etc.)
    const sub = path.join(localRoot, ent.name);
    if (fs.existsSync(path.join(sub, PACK_MANIFEST_FILENAME))) {
      results.push(sub);
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// Entry address resolution
// ─────────────────────────────────────────────────────────────

export interface ResolvedEntryAddress {
  packId: string;
  entryId: string;
}

export interface AddressContext {
  activePack: string;
  /**
   * Optional list of pack ids currently loaded. When provided and a bare
   * entry id exists in multiple packs, the resolver throws an ambiguity
   * error listing the candidates. When omitted, bare ids always resolve to
   * `activePack` without an ambiguity check.
   */
  candidatePacks?: string[];
  /**
   * Optional per-pack entry existence probe. If provided, the resolver will
   * consult it when a bare id is encountered and `candidatePacks` is set,
   * to determine which packs actually contain the entry.
   */
  entryExistsIn?: (packId: string, entryId: string) => boolean;
}

/**
 * Parse a cross-pack entry address. Accepts `<pack-id>:<entry-id>` or bare
 * `<entry-id>` form. Bare ids resolve to `context.activePack`. If the bare
 * id exists in multiple packs (per `context.entryExistsIn`), throws with a
 * list of candidate packs.
 */
export function resolveEntryAddress(address: string, context: AddressContext): ResolvedEntryAddress {
  if (typeof address !== 'string' || address.length === 0) {
    throw new Error('resolveEntryAddress: address must be a non-empty string');
  }

  const colonIdx = address.indexOf(':');
  if (colonIdx !== -1) {
    const packId = address.slice(0, colonIdx);
    const entryId = address.slice(colonIdx + 1);
    if (!packId || !entryId) {
      throw new Error('resolveEntryAddress: malformed <pack-id>:<entry-id> address');
    }
    return { packId, entryId };
  }

  // Bare id → activePack by default
  const entryId = address;

  if (context.candidatePacks && context.entryExistsIn) {
    const matches = context.candidatePacks.filter(p => context.entryExistsIn!(p, entryId));
    if (matches.length > 1) {
      const formatted = matches.map(p => `${p}:${entryId}`).join(', ');
      throw new Error(
        `resolveEntryAddress: bare entry id "${entryId}" is ambiguous across packs. Candidates: ${formatted}`,
      );
    }
    if (matches.length === 1) {
      return { packId: matches[0], entryId };
    }
    // matches.length === 0 → fall through to activePack (caller may validate later)
  }

  return { packId: context.activePack, entryId };
}

// ─────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────

function getNodeModulesMtimeMs(projectRoot: string): number | undefined {
  try {
    const s = fs.statSync(path.join(projectRoot, 'node_modules'));
    return s.mtime.getTime();
  } catch {
    return undefined;
  }
}

function getLocalUniversityMtimeMs(projectRoot: string): number | undefined {
  try {
    const s = fs.statSync(path.join(projectRoot, LOCAL_UNIVERSITY_DIR));
    return s.mtime.getTime();
  } catch {
    return undefined;
  }
}

function tryReadCache(projectRoot: string): PackLocation[] | null {
  const cachePath = path.join(projectRoot, CACHE_REL_PATH);
  if (!fs.existsSync(cachePath)) return null;

  let cached: PackCacheFile;
  try {
    cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return null;
  }

  if (cached.version !== 1 || !Array.isArray(cached.packs)) return null;

  // Compare mtime keys — if either changed, invalidate
  const nmMtime = getNodeModulesMtimeMs(projectRoot);
  const luMtime = getLocalUniversityMtimeMs(projectRoot);
  if (cached.node_modules_mtime_ms !== nmMtime) return null;
  if (cached.local_university_mtime_ms !== luMtime) return null;

  return cached.packs.map(p => ({
    manifest: p.manifest,
    rootDir: p.rootDir,
    source: p.source,
    ...(p.parentPackId ? { parentPackId: p.parentPackId } : {}),
  }));
}

function tryWriteCache(projectRoot: string, packs: PackLocation[]): void {
  const cachePath = path.join(projectRoot, CACHE_REL_PATH);
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const body: PackCacheFile = {
      version: 1,
      node_modules_mtime_ms: getNodeModulesMtimeMs(projectRoot),
      local_university_mtime_ms: getLocalUniversityMtimeMs(projectRoot),
      packs: packs.map(p => ({
        manifest: p.manifest,
        rootDir: p.rootDir,
        source: p.source,
        ...(p.parentPackId ? { parentPackId: p.parentPackId } : {}),
      })),
    };
    fs.writeFileSync(cachePath, JSON.stringify(body, null, 2), 'utf8');
  } catch {
    // cache is best-effort — never block discovery on cache failure
  }
}
