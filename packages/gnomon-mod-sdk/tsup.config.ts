import { defineConfig } from 'tsup';

// dist/runtime.js is the VENDORABLE single file a mod copies into its folder
// (as gnomon-mod-sdk.mjs): @a-company/gnomon-contracts is bundled in, node
// built-ins keep their `node:` prefix, nothing else is imported.
export default defineConfig({
  entry: { index: 'src/index.ts', runtime: 'src/runtime.ts' },
  format: ['esm'],
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  target: 'node24',
  platform: 'node',
  splitting: false,
  treeshake: true,
  noExternal: ['@a-company/gnomon-contracts'],
  removeNodeProtocol: false,
});
