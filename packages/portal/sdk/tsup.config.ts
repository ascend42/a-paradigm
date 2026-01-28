import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/decorators/index.ts'],
  format: ['esm'],
  dts: {
    resolve: true,
  },
  clean: true,
  external: ['@a-company/portal-core'],
});
