import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import { excludedTestFiles } from './test/platform-registry.js';

// G-WIN-05 (mirrors packages/gnomon): a test file whose `// @gnomon-platform:` marker omits the running platform is
// excluded; test/platform-registry.ts holds the row (sibling or n/a reason) for each.
const PKG_ROOT = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...excludedTestFiles(PKG_ROOT, process.platform)],
    testTimeout: 30_000,
  },
});
