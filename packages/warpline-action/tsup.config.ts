import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  // The engine is resolved at runtime, NOT bundled: in this monorepo it is the
  // workspace symlink (root node_modules/@a-company/warpline → packages/warpline);
  // for an eventual published action it becomes a pinned npm dependency installed
  // next to the committed dist. Either way the action consumes the engine's
  // exported functions — it never vendors engine code.
  external: ['@a-company/warpline'],
});
