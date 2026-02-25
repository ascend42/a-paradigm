import { defineConfig } from 'tsup';

export default defineConfig([
  // Config 1: Library + Server + Adapters (with DTS)
  {
    entry: {
      index: 'src/index.ts',
      'server/index': 'src/server/index.ts',
      'adapters/express': 'src/adapters/express.ts',
      'adapters/fastify': 'src/adapters/fastify.ts',
      'adapters/hono': 'src/adapters/hono.ts',
    },
    format: ['esm'],
    dts: true,
    clean: true,
    external: ['express', 'simple-git', 'open', 'ws'],
  },
  // Config 2: CLI entry (shebang, no DTS)
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
    external: ['express', 'simple-git', 'open', 'sql.js'],
  },
  // Config 3: MCP server entry (shebang, no DTS)
  {
    entry: { mcp: 'src/mcp.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
    external: ['sql.js'],
  },
]);
