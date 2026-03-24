import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/server/index.ts'],
  format: ['esm'],
  dts: { resolve: true },
  clean: true,
  treeshake: true,
  minify: true,
  external: ['express', 'open'],
});
