import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Brain HOME isolation: PARADIGM_BRAIN_HOME → empty temp dir per test file.
    setupFiles: ['./vitest.setup.ts'],
  },
});
