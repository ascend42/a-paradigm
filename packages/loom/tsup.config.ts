import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  // premise-core (and its transitive deps) are workspace packages resolved at
  // runtime — do not bundle them in.
  external: ['@a-company/premise-core', 'commander'],
});
