import { defineConfig } from 'tsup';

const shared = {
  format: ['esm'] as const,
  clean: false,
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
