import { readFileSync } from 'node:fs';
import { validateReleaseManifestV1 } from '@a-company/gnomon-contracts';
import { defineConfig } from 'tsup';

// T-2026-10-21-028 #release-pins (Aegis M1 review): a RELEASE build compiles its pins INTO the bundle. Only
// scripts/build-release.mjs sets GNOMON_RELEASE_MANIFEST (the manifest it just wrote from the signed bins); then
// __GNOMON_RELEASE__ = true and __GNOMON_RELEASE_MANIFEST__ = its JSON are defined, so deleting or editing the
// stamp, loading dist/index.js or copying dist never turns a release into a dev build. Unset: a dev build (nothing
// defined; release-pins.ts sees the identifiers as undeclared). An invalid manifest fails the build.
function releaseDefine(): Record<string, string> {
  const file = process.env.GNOMON_RELEASE_MANIFEST;
  if (!file) return {};
  const manifest: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const errors = validateReleaseManifestV1(manifest);
  if (errors.length) throw new Error(`tsup: ${file} is not a valid release manifest (${errors.join('; ')})`);
  return { __GNOMON_RELEASE__: 'true', __GNOMON_RELEASE_MANIFEST__: JSON.stringify(JSON.stringify(manifest)) };
}

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
  define: releaseDefine(),
});
