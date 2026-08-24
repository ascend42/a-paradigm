import { defineConfig } from 'tsup';

const shared = {
  format: ['esm'] as const,
  clean: false,
  treeshake: true,
  minify: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  noExternal: [/^@a-company\//],
  external: [
    'minimatch',
    'express',
  ],
};

export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    dts: true,
    clean: true,
    // Keep the Warpline engine (and its TS-compiler dep) EXTERNAL: it pulls in
    // the `typescript` package via the code-lens, a large CJS module whose
    // dynamic `require('fs')` calls do not survive ESM bundling ("Dynamic
    // require of 'fs' is not supported" at runtime). Warpline is a hard
    // dependency in package.json, so it resolves from node_modules at runtime
    // with its own resolution intact. The platform-server imports it lazily.
    external: [...shared.external, '@a-company/warpline', 'typescript'],
  },
  {
    ...shared,
    entry: { mcp: '../paradigm-mcp/src/index.ts' },
    dts: false,
  },
  {
    ...shared,
    entry: { sentinel: '../sentinel/src/cli.ts' },
    dts: false,
    external: [...shared.external, 'simple-git', 'ws', 'sql.js'],
  },
  {
    ...shared,
    entry: { 'sentinel-mcp': '../sentinel/src/mcp.ts' },
    dts: false,
    external: [...shared.external, 'ws', 'sql.js'],
  },
]);
