import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import { excludedTestFiles } from './test/platform-registry.js';

// G-WIN-05 (T-2026-10-17-011): a test file whose `// @gnomon-platform:` marker
// does not list the running platform is excluded here; test/platform-registry.ts
// holds the row (sibling or n/a reason) for every such file, and
// test/platform-registry.test.ts proves the excluded set equals those rows.
const PKG_ROOT = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...excludedTestFiles(PKG_ROOT, process.platform)],
    testTimeout: 30_000,
    // spec §2.4 rule 10: no test ever opens a real browser; tests that exercise auto-open inject the opener and its env
    env: { GNOMON_NO_OPEN: '1' },
  },
});
