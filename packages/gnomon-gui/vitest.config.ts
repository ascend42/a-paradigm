import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __GNOMON_PREVIEW__: 'false' },
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});
