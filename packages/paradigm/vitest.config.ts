import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'src/**/*.test.ts',
      'tests/**/*.test.ts',
      // Warpline viewer's pure binding/state layer (React-free, node-env safe).
      'platform-ui/src/sections/warpline/**/*.test.ts',
      // Shared docs/Academy markdown renderer (React-free).
      'platform-ui/src/sections/docs/renderMarkdown.test.ts',
      // Brain section plain-language labels (React-free).
      'platform-ui/src/sections/brain/**/*.test.ts',
      // Sentinel incident triage copy and rules (React-free).
      'platform-ui/src/sections/sentinel/**/*.test.ts',
    ],
  },
});
