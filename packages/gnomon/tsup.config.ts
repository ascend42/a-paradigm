import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
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

// TD-2026-10-22-769 (#local-config-request): gnomon-local SHIPS with the kernel, pinned, so nobody builds anything.
// Its single-file dist/cli.js is copied into <outDir>/gnomon-local/cli.js (the plugin below) and its tree hash (the
// runner-pin.ts treeHash of a dir holding only cli.js: sha256 over "cli.js\0<sha256>\n") plus its package version
// are compiled in, so the kernel verifies the copy at load (bundled-runner.ts). No gnomon-local build ⇒ no bundled
// runner (the kernel falls back to the clone's, reported `clone`). The copy re-hashes and fails the build on a race.
const LOCAL_CLI = path.resolve(process.cwd(), '..', 'gnomon-local', 'dist', 'cli.js');
function localRunner(): { define: Record<string, string>; sha: string | null } {
  if (!existsSync(LOCAL_CLI) || !lstatSync(LOCAL_CLI).isFile()) {
    process.stderr.write(`tsup: no ${LOCAL_CLI}: this kernel build carries no bundled gnomon-local (build @a-company/gnomon-local first)\n`);
    return { define: {}, sha: null };
  }
  const file = createHash('sha256').update(readFileSync(LOCAL_CLI)).digest('hex');
  const tree = createHash('sha256').update(`cli.js\0${file}\n`).digest('hex');
  const version = String((JSON.parse(readFileSync(path.resolve(LOCAL_CLI, '..', '..', 'package.json'), 'utf8')) as { version?: unknown }).version ?? '');
  return { define: { __GNOMON_LOCAL_TREE_SHA256__: JSON.stringify(tree), __GNOMON_LOCAL_VERSION__: JSON.stringify(version) }, sha: file };
}
const local = localRunner();
const bundleGnomonLocal = {
  name: 'bundle-gnomon-local',
  setup(b: { initialOptions: { outdir?: string }; onEnd(cb: () => void): void }): void {
    b.onEnd(() => {
      if (local.sha === null || !b.initialOptions.outdir) return;
      const dir = path.join(b.initialOptions.outdir, 'gnomon-local');
      mkdirSync(dir, { recursive: true });
      const to = path.join(dir, 'cli.js');
      copyFileSync(LOCAL_CLI, to);
      if (createHash('sha256').update(readFileSync(to)).digest('hex') !== local.sha) throw new Error('tsup: gnomon-local/dist/cli.js changed during the build: build again');
    });
  },
};

// G-SEC-01: the kernel ships ZERO runtime dependencies. package.json has no
// `dependencies` key, so tsup externalizes nothing but node built-ins and
// BUNDLES the devDependency @a-company/gnomon-contracts into dist.
// test/fence.test.ts scans dist/ to prove no bare import survives the build.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    loops: 'src/loops/index.ts',
    // step 12 (#loop-agent-ops): the agent principal's loop.request client, for paradigm-mcp
    agent: 'src/agent/index.ts',
    'cli/gnomon': 'src/cli/gnomon.ts',
    'cli/gnomond': 'src/cli/gnomond.ts',
    'transport/gnomon-web': 'src/transport/gnomon-web.ts',
  },
  format: ['esm'],
  dts: { entry: { index: 'src/index.ts', loops: 'src/loops/index.ts', agent: 'src/agent/index.ts' } },
  clean: true,
  target: 'node24',
  platform: 'node',
  // Ships later as a signed Node SEA; keep the output single-file per entry.
  splitting: false,
  noExternal: ['@a-company/gnomon-contracts'],
  // Keep the `node:` prefix on built-ins (tsup strips it by default), so the
  // G-KRN-02 dist scan can tell a built-in from a bare package import.
  removeNodeProtocol: false,
  define: { ...releaseDefine(), ...local.define },
  esbuildPlugins: [bundleGnomonLocal],
});
