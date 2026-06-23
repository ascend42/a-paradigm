import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  // premise-core (and its transitive deps) are workspace packages resolved at
  // runtime — do not bundle them in. `typescript` is the code-lens's pinned
  // compiler (§5.2): a runtime dependency, resolved (not bundled) so the EXACT
  // pinned version on disk is the one the lens uses.
  external: ['@a-company/premise-core', 'commander', 'typescript'],
});
