/**
 * #field-blind-class — the §8 known-blind-class PATH classifier
 * (expo-field-test-protocol.md §8, LOCKED). Given a changed path, decide
 * whether it falls in a class the system CANNOT judge — and say WHY.
 *
 * Only the PATH-EXPRESSIBLE §8 classes live here: `.js`/`.mjs`/`.cjs` files
 * (config or otherwise — ts-lens is `.ts/.tsx` only, so no lens ever sees a
 * .js file) + `.env`, lockfiles, and assets/binaries by extension. The four
 * §8 classes that are NOT a property of a path alone — config×code coupling,
 * non-adjacent cross-symbol edits, no-shared-token shared-invariant conflicts,
 * top-level exported scalar consts — cannot be decided from a filename and are
 * deliberately NOT classified here (claiming to would be a false negative
 * detector; the protocol handles them via the behavioral oracle + reporting).
 *
 * Used by #field-oracle to compute `coveredClass` for every audited seal: a
 * seal whose changed paths are ALL blind is `blind-untested`, never evidence
 * for falsifier (A) surviving.
 *
 * Pure, deterministic, no I/O. Library code: no console output.
 */

/** One path's classification: blind (with the §8 reason) or covered. */
export interface BlindClassDecision {
  blind: boolean;
  /** the §8 reason when blind; null when the path is covered. */
  reason: string | null;
}

/** Lockfiles (§8: derived, regenerable from the manifests; meaning did nothing). */
const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'composer.lock',
  'gemfile.lock',
  'podfile.lock',
  'cargo.lock',
  'poetry.lock',
]);

/** Assets / binaries by extension (§8: byte-custody only; no meaning). */
const ASSET_EXTENSIONS = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'svg', 'heic', 'avif',
  // fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // audio / video
  'mp3', 'mp4', 'mov', 'wav', 'ogg', 'webm', 'm4a', 'aac',
  // documents / archives
  'pdf', 'zip', 'gz', 'tar', 'tgz', 'jar', '7z',
  // compiled / binary artifacts (incl. RN/Expo bundles + signing material)
  'bin', 'so', 'dylib', 'a', 'o', 'wasm', 'hbc', 'jsbundle', 'apk', 'aab', 'ipa',
  'keystore', 'jks', 'p8', 'p12', 'mobileprovision', 'der', 'pem',
]);

const lastSegment = (relPath: string): string => {
  const norm = relPath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return (i === -1 ? norm : norm.slice(i + 1)).toLowerCase();
};

const extensionOf = (basename: string): string | null => {
  const i = basename.lastIndexOf('.');
  return i > 0 && i < basename.length - 1 ? basename.slice(i + 1) : null;
};

/**
 * Classify ONE changed path against the §8 path-expressible blind classes.
 * The reason strings are stable (they land in the hash-chained audit ledger).
 */
export function classifyBlindPath(relPath: string): BlindClassDecision {
  const base = lastSegment(relPath);
  const ext = extensionOf(base);

  // `.env` and `.env.*` (§8 — no lens covers them; meaning never sees the file).
  if (base === '.env' || base.startsWith('.env.')) {
    return { blind: true, reason: '.env config (§8 — no lens covers it; meaning never sees the file)' };
  }

  // `.js`/`.mjs`/`.cjs` (§8 — ts-lens is .ts/.tsx only, cfg-lens is .json/.yml/.yaml
  // only, so NO lens ever lifts a .js file). The §8 bullet names the config flavor
  // (app.config.js / babel.config.js / metro.config.js) because Expo ships exactly
  // those; the blindness mechanism (no covering lens) holds for every .js file, so
  // both flavors classify blind — with reasons that name which one.
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    const isConfig = /(^|\.)config\.(js|mjs|cjs)$/.test(base) || /^\..*rc\.(js|mjs|cjs)$/.test(base);
    return {
      blind: true,
      reason: isConfig
        ? `.${ext} config file (§8 — no lens covers it; a CLEAN here is byte-decided)`
        : `.${ext} source (§8 — ts-lens is .ts/.tsx only; no lens ever sees this file)`,
    };
  }

  // Lockfiles (§8 — derived; the "merge" is byte-identical to git's).
  if (LOCKFILE_NAMES.has(base)) {
    return { blind: true, reason: 'lockfile (§8 — derived, regenerable from the manifests; meaning did nothing)' };
  }

  // Assets / binaries (§8 — byte-custody strands only; no meaning).
  if (ext !== null && ASSET_EXTENSIONS.has(ext)) {
    return { blind: true, reason: `asset/binary .${ext} (§8 — byte custody only; a CLEAN here means byte equality)` };
  }

  return { blind: false, reason: null };
}

/** The per-path blind findings of a changed set (only the blind ones, sorted). */
export interface BlindPathFinding {
  path: string;
  reason: string;
}

export interface CoveredClassResult {
  /**
   * §4/§8: FALSE when the change touched ONLY blind classes (or touched nothing,
   * or the changed set could not be established — never claim coverage on
   * ignorance). TRUE as soon as one changed path is outside every blind class.
   */
  coveredClass: boolean;
  /** every blind changed path with its §8 reason (sorted by path). */
  blind: BlindPathFinding[];
}

/**
 * The §4 `coveredClass` computation over a whole changed-path set. `null` paths
 * (the changed set could not be derived — e.g. an unbound parent tree) yield
 * coveredClass:false: an unestablished change set is NOT evidence of coverage.
 */
export function coveredClassOf(changedPaths: readonly string[] | null): CoveredClassResult {
  if (changedPaths === null || changedPaths.length === 0) {
    return { coveredClass: false, blind: [] };
  }
  const blind: BlindPathFinding[] = [];
  let anyCovered = false;
  for (const p of changedPaths) {
    const d = classifyBlindPath(p);
    if (d.blind) blind.push({ path: p, reason: d.reason! });
    else anyCovered = true;
  }
  blind.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { coveredClass: anyCovered, blind };
}
