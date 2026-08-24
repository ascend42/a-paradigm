/**
 * #derived-artifacts — the DERIVED-ARTIFACT rule (roadmap P3 Lane A, GAP-1).
 *
 * Lockfiles are DERIVED: machine-generated projections of the manifests next to
 * them (package.json → package-lock.json, etc.). They are never MEANING:
 *   - the cfg lens NEVER lifts them (a 40k-line lockfile is not a key-tree an
 *     agent edits — it is a build product);
 *   - the byte-merge layer never KNOTS on them: when both sides changed a derived
 *     artifact divergently, #materialize takes ONE side wholesale (ours — the
 *     admitting agent's bytes) and marks the path STALE in the merge plan
 *     (`MergePlan.derivedStale`) — the honest, typed concession. The regeneration
 *     policy (re-run the package manager against the MERGED manifests) is the
 *     consumer's step; v1 records the staleness, it does not shell out to npm.
 *     TODO(design, GAP-1 v2): optional post-merge `npm install --package-lock-only`
 *     regeneration hook, gated on the merged manifests having merged clean.
 *   - honesty labels (#honesty) classify these paths as `derived` — never
 *     `meaning-decided`, never `byte-decided`.
 *
 * Matching is by BASENAME (a lockfile is a lockfile at any depth of a monorepo).
 * The set is deliberately explicit — a glob like `*.lock` would swallow real
 * meaning files (e.g. a hand-written `config.lock`), and fail-open here means a
 * silent wrong-merge of a file we pretended to understand.
 *
 * Library code: no console output.
 */

/** Basenames of derived lockfile artifacts (never lifted, never knotted). */
export const DERIVED_ARTIFACT_BASENAMES: ReadonlySet<string> = new Set([
  // npm / yarn / pnpm / bun / deno
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'deno.lock',
  // other ecosystems' machine-generated lockfiles
  'Cargo.lock',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'flake.lock',
]);

/** Is `relPath` (posix separators) a derived lockfile artifact? Basename match. */
export function isDerivedArtifact(relPath: string): boolean {
  const idx = relPath.lastIndexOf('/');
  const base = idx >= 0 ? relPath.slice(idx + 1) : relPath;
  return DERIVED_ARTIFACT_BASENAMES.has(base);
}
