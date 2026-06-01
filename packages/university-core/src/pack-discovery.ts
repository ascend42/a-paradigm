/**
 * Pack Discovery (SLIM) — v6.0 multi-tenant content-pack discovery + resolution.
 *
 * REIMPLEMENTED for @a-company/university-core (extract-university-core spec
 * §1.4). This is a LEAN reimplementation of the pack-loader's discovery surface
 * that does NOT depend on the original `pack-loader.ts` — that module imports
 * `yaml-validator` (→ @a-company/portal-core) and would drag portal-core into
 * the lean core, violating the zero-@a-company-dep mandate.
 *
 * What is reimplemented vs. moved:
 *   - `loadPackManifest`  — REIMPLEMENTED with raw `js-yaml` + a required-field
 *     presence check (id/name/version/schema_version/tenant_kind + tenant_kind
 *     enum). DROPS the `safeLoad`/`classifyYamlError` (portal-core) path. On
 *     parse failure, throws `PackLoadError('manifest-unparseable', <classifier>)`
 *     derived from the js-yaml error NAME only — never the manifest body.
 *     Byte-identical to the original on VALID manifests (safeLoad returns
 *     `yaml.load(content)` unchanged on the happy path, and loadPackManifest was
 *     called without a schema); divergence is confined to error classification,
 *     which §1.4 accepts.
 *   - `normalizeSections` — REIMPLEMENTED with the original body verbatim
 *     (§1.5 Option B), backed by the copied `pack-schema.ts` (zod only).
 *   - `discoverPacks` + npm-pointer scan + cache — MOVED nearly verbatim
 *     (they only use fs/path + loadPackManifest).
 *   - `resolveEntryAddress` — MOVED verbatim (pure string logic).
 *   - `PackLoadError` — MOVED verbatim.
 *
 * Security contract preserved:
 *   - Manifest-parse failures surface as classifier-only errors — never leaks
 *     file contents, pack internals, or fs paths beyond caller-supplied dirs.
 *   - Discovery cache at `.paradigm/cache/packs.json` keyed by node_modules
 *     mtime so `npm install` invalidates it.
 *   - Direct deps only; does NOT walk transitive deps.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  PACK_MANIFEST_FILENAME,
  PACKAGE_JSON_POINTER_FIELD,
} from './types/pack.js';
import type { PackLocation, PackManifest, Section, SectionStyle } from './types/pack.js';
import {
  SectionsArraySchema,
  SECTION_STYLES as SECTION_STYLE_VALUES,
  MAX_SECTIONS_PER_PACK,
} from './pack-schema.js';
import { getUniversityCoreLogger } from './logger.js';

const FIRST_PARTY_PACKAGE_NAME = '@a-company/university';
const LOCAL_UNIVERSITY_DIR = '.paradigm/university';
const CACHE_REL_PATH = '.paradigm/cache/packs.json';

/**
 * Error classes emitted by pack-discovery. Classifier strings only — never file
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
// v6.5: Section synthesis (schema lives in pack-schema.ts)
// ─────────────────────────────────────────────────────────────

// Reference MAX_SECTIONS_PER_PACK so the const remains traceable from this
// module (load-time importers that grep for the cap can find it here).
void MAX_SECTIONS_PER_PACK;

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
 *
 * Body is verbatim from pack-loader.ts (spec §1.5 Option B) so section
 * synthesis stays byte-identical.
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
 * Map a raw js-yaml load error to a classifier-only detail string. NEVER
 * includes the manifest body or js-yaml's `mark` context (which echoes 2-3
 * lines of file content). Derives from the error NAME only (§1.4).
 */
function classifyManifestParseError(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name?: unknown }).name === 'string') {
    const name = (err as { name: string }).name;
    if (name === 'YAMLException') return 'yaml syntax error';
    return name;
  }
  return 'parse error';
}

/**
 * Read and validate a `pack.yaml` from a directory. Throws `PackLoadError`
 * with a classifier-only message on any failure — never leaks manifest
 * contents into the error surface.
 *
 * SLIM reimplementation (spec §1.4): raw `js-yaml` instead of the
 * portal-core-backed `safeLoad`. Behavior is byte-identical to the original on
 * VALID manifests; only the error-classification path differs.
 */
export function loadPackManifest(dir: string): PackManifest {
  const manifestPath = path.join(dir, PACK_MANIFEST_FILENAME);

  if (!fs.existsSync(manifestPath)) {
    throw new PackLoadError('missing-manifest', `no ${PACK_MANIFEST_FILENAME} at pack root`);
  }

  let content: string;
  try {
    content = fs.readFileSync(manifestPath, 'utf-8');
  } catch {
    // Treat read errors as a parse failure. Do not echo the OS error message
    // as it may include the file path plus OS strings.
    throw new PackLoadError('manifest-unparseable', 'file read error');
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    throw new PackLoadError('manifest-unparseable', classifyManifestParseError(err));
  }

  const manifest = parsed as PackManifest;
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

/**
 * Derive a pack id from `<packRoot>/pack.yaml` via a raw js-yaml read — used for
 * write-time `pack_id` stamping when an explicit `packRoot` is supplied.
 *
 * This is the LENIENT, real-id-or-nothing reader that the CLI's write path
 * historically used (`safeLoadPackId`). It deliberately differs from
 * {@link loadPackManifest} / `loadOrFabricatePackManifest`:
 *   - it requires ONLY a non-empty `id` (no version/schema_version/tenant_kind
 *     presence check), so a partial manifest still yields its real id; and
 *   - it NEVER fabricates an id from the directory basename. A missing/
 *     unparseable manifest, or one with no `id`, returns null (→ no stamp).
 *
 * The CLI's `stampPackId` boolean cannot express "stamp the real id, or nothing,
 * but never the basename"; this reader does. Lives here (not in the CLI) so the
 * raw-manifest id-read exists in EXACTLY ONE place (spec §5.5 names
 * `safeLoadPackId` as a single-home symbol).
 *
 * @returns the manifest `id` when it is a non-empty string; otherwise null.
 */
export function safeLoadPackId(packRoot: string): string | null {
  const manifestPath = path.join(packRoot, PACK_MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const data = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as { id?: unknown } | null;
    return data && typeof data.id === 'string' && data.id.length > 0 ? data.id : null;
  } catch {
    return null;
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
      getUniversityCoreLogger().warn('first-party pack manifest invalid', {
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
      getUniversityCoreLogger().warn('npm pack manifest invalid', {
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
        getUniversityCoreLogger().warn('local pack manifest invalid', {
          errorClass: err instanceof PackLoadError ? err.errorClass : 'other',
        });
      }
    }
    // Note: when `pack.yaml` is absent, we do NOT fabricate a synthetic
    // PackLocation in discoverPacks. The loader handles that implicit case
    // directly on its own resolution path (preserving v5 behavior). Keeping
    // discoverPacks strictly manifest-driven makes the discovery contract
    // clean; the fabrication responsibility lives in the loader.

    // Discipline sub-packs
    const parentPackId = localManifest?.id ?? 'project';
    for (const sub of discoverLocalSubPacks(localRoot)) {
      try {
        const manifest = loadPackManifest(sub);
        packs.push({ manifest, rootDir: sub, source: 'local', parentPackId });
      } catch (err) {
        getUniversityCoreLogger().warn('discipline sub-pack manifest invalid', {
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
