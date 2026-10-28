import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // TD-2026-10-27-833: tests run against THIS checkout's university-core source (not whatever dist the workspace link
  // points at), so a change to pack discovery (the staged mode's no-cache rule) is tested with the code beside it.
  resolve: {
    alias: {
      '@a-company/university-core': fileURLToPath(new URL('../university-core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Brain HOME isolation: PARADIGM_BRAIN_HOME → empty temp dir per test file.
    setupFiles: ['./vitest.setup.ts'],
  },
});
