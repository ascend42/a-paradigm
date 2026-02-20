import { defineConfig } from 'tsup';

const shared = {
  format: ['esm'] as const,
  clean: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  noExternal: [/^@a-company\//],
  external: [
    '@a-company/university',
    '@a-company/sentinel',
    'minimatch',
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
]);
