/**
 * The installed Paradigm CLI version, read from this package's own
 * package.json. Walks up from the running module, so it resolves the same file
 * from `src/` (tests, ts-node) and from the bundled `dist/`.
 *
 * Returns null when no package.json for this package is found: callers omit
 * the version rather than print a wrong one.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

/** The npm name of the CLI package whose version is reported. */
export const PARADIGM_PACKAGE_NAME = '@a-company/paradigm';

/** The public repository generated files link to. */
export const PARADIGM_REPO_URL = 'https://github.com/ascend42/a-paradigm';

let cached: string | null | undefined;

/**
 * Find the version of the nearest package.json named `@a-company/paradigm`
 * at or above `startDir`. Exported for tests.
 */
export function findParadigmVersionFrom(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: unknown; version?: unknown };
        if (pkg.name === PARADIGM_PACKAGE_NAME && typeof pkg.version === 'string' && pkg.version) {
          return pkg.version;
        }
      } catch {
        // unreadable package.json: keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The running CLI's version (e.g. "8.1.3"), or null when it cannot be read. */
export function getParadigmCliVersion(): string | null {
  if (cached === undefined) {
    try {
      cached = findParadigmVersionFrom(path.dirname(fileURLToPath(import.meta.url)));
    } catch {
      cached = null;
    }
  }
  return cached;
}
