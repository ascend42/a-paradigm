import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'src/**/*.test.ts',
      'tests/**/*.test.ts',
      // Warpline viewer's pure binding/state layer (React-free, node-env safe).
      'platform-ui/src/sections/warpline/**/*.test.ts',
    ],
  },
});
