import { defineConfig } from 'tsup';

// gnomon-local ships ZERO runtime dependencies (no pi-ai cloud SDKs, spec §13.1):
// package.json has no `dependencies` key; test/local-child.test.ts scans src/ and dist/.
export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  target: 'node24',
  platform: 'node',
  splitting: false,
  removeNodeProtocol: false,
});
