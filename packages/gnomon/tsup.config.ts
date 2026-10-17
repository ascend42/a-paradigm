import { defineConfig } from 'tsup';

// G-SEC-01: the kernel ships ZERO runtime dependencies. package.json has no
// `dependencies` key, so tsup externalizes nothing but node built-ins and
// BUNDLES the devDependency @a-company/gnomon-contracts into dist.
// test/fence.test.ts scans dist/ to prove no bare import survives the build.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/gnomon': 'src/cli/gnomon.ts',
    'cli/gnomond': 'src/cli/gnomond.ts',
    'transport/gnomon-web': 'src/transport/gnomon-web.ts',
  },
  format: ['esm'],
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  target: 'node24',
  platform: 'node',
  // Ships later as a signed Node SEA; keep the output single-file per entry.
  splitting: false,
  noExternal: ['@a-company/gnomon-contracts'],
  // Keep the `node:` prefix on built-ins (tsup strips it by default), so the
  // G-KRN-02 dist scan can tell a built-in from a bare package import.
  removeNodeProtocol: false,
});
