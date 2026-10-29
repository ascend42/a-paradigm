/**
 * #kernel-sea (TD-2026-10-29-746, spec P8-D68 amended, G-ID-13): the pure parts of the signed SEA kernel.
 *
 * Falsifiers:
 *   - under the SEA, every node child runs gnomon.node (the bundle's Resources/node/bin/node, else
 *     <dir of gnomon.kernel>/node/bin/node) and never the kernel; none present ⇒ SeaChildNodeMissing (fail closed);
 *   - not a SEA ⇒ process.execPath, unchanged (npm installs, the checkout, tests);
 *   - the kernel's own re-exec under the SEA starts with --gnomond and carries no node flag and no script;
 *   - the sea-config bakes --disable-sigusr1 and execArgvExtension "none" (NODE_OPTIONS is never read);
 *   - FENCE: no source file outside the self-re-exec sites spawns process.execPath (a child must go through
 *     childNodePath()).
 * The built binary is exercised by test/sea-kernel.test.ts (darwin).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script, no declarations
import * as sea from '../scripts/build-sea.mjs';
import { reexecArgs } from '../src/kernel/lifecycle/env.js';
import { childNodePath, DEV_CHILD_NODE_REL, gnomondEntryOf, KERNEL_DEV_IDENTIFIER, KERNEL_IDENTIFIER, KERNEL_SEA_NAME, runningAsSea, SEA_GNOMOND_ARG, SeaChildNodeMissing, SeaChildNodeRefused, seaChildNodeCandidates, seaGuard, type SeaGuard, CHILD_NODE_DEV_IDENTIFIER, CHILD_NODE_IDENTIFIER } from '../src/kernel/lifecycle/sea.js';
import type { AppBundle } from '../src/kernel/lifecycle/app-bundle.js';
import { PKG_ROOT, walk } from './helpers.js';

const KERNEL = '/Applications/Gnomon.app/Contents/Resources/kernel/gnomon.kernel';
const bundle = { node: '/Applications/Gnomon.app/Contents/Resources/node/bin/node' } as AppBundle;
/** A guard stub recording its calls; `distFails` / `nodeFails` make the matching check throw. */
function guard(o: { distFails?: boolean; nodeFails?: boolean } = {}): SeaGuard & { calls: string[] } {
  const calls: string[] = [];
  return {
    profile: 'release',
    distTree: 'sha256:x',
    childNodeRequirement: 'identifier "gnomon.node"',
    calls,
    checkDist() {
      calls.push('dist');
      if (o.distFails) throw new Error('dist hashes to something else');
    },
    checkChildNode(n: string) {
      calls.push(`node:${n}`);
      if (o.nodeFails) throw new Error('does not meet the child-node requirement');
    },
  };
}
const ok = guard();

describe('#kernel-sea childNodePath', () => {
  it('not a SEA: process.execPath (or the given execPath), whatever exists', () => {
    expect(runningAsSea()).toBe(false); // vitest runs under plain node
    expect(childNodePath()).toBe(process.execPath);
    expect(childNodePath({ sea: false, execPath: '/x/node', isFile: () => false })).toBe('/x/node');
  });

  it('FALSIFIER: under the SEA in Gnomon.app a child runs the bundled gnomon.node, never the kernel', () => {
    const got = childNodePath({ sea: true, execPath: KERNEL, bundle, isFile: () => true, guard: ok });
    expect(got).toBe(bundle.node);
    expect(got).not.toBe(KERNEL);
  });

  it('FALSIFIER: a dev SEA uses <dir of gnomon.kernel>/node/bin/node', () => {
    const dev = '/repo/packages/gnomon/gnomon.kernel';
    const want = path.join('/repo/packages/gnomon', DEV_CHILD_NODE_REL);
    expect(childNodePath({ sea: true, execPath: dev, bundle: null, isFile: (p) => p === want, guard: ok })).toBe(want);
    expect(seaChildNodeCandidates({ execPath: KERNEL, bundle })).toEqual([bundle.node, path.join(path.dirname(KERNEL), DEV_CHILD_NODE_REL)]);
  });

  it('FALSIFIER: under the SEA with no gnomon.node it throws SeaChildNodeMissing: it never falls back to execPath', () => {
    expect(() => childNodePath({ sea: true, execPath: KERNEL, bundle, isFile: () => false })).toThrow(SeaChildNodeMissing);
    expect(() => childNodePath({ sea: true, execPath: KERNEL, bundle, isFile: (p) => p === KERNEL })).toThrow(/never spawns itself/);
  });

  it('FALSIFIER (Aegis H1): every call re-runs the guard: the kernel files, then the node it returns', () => {
    const g = guard();
    childNodePath({ sea: true, execPath: KERNEL, bundle, isFile: () => true, guard: g });
    childNodePath({ sea: true, execPath: KERNEL, bundle, isFile: () => true, guard: g });
    expect(g.calls).toEqual(['dist', `node:${bundle.node}`, 'dist', `node:${bundle.node}`]);
  });

  it('FALSIFIER (Aegis H1): a node that fails its requirement, changed kernel files, or no guard: refused, never spawned', () => {
    expect(() => childNodePath({ sea: true, execPath: KERNEL, bundle, isFile: () => true, guard: guard({ nodeFails: true }) })).toThrow(SeaChildNodeRefused);
    expect(() => childNodePath({ sea: true, execPath: KERNEL, bundle, isFile: () => true, guard: guard({ distFails: true }) })).toThrow(/dist hashes to something else/);
    expect(() => childNodePath({ sea: true, execPath: KERNEL, bundle, isFile: () => true, guard: null })).toThrow(/no build guard/);
    expect(seaGuard()).toBeNull(); // plain node: no guard, and none is needed
    expect(childNodePath({ sea: false, execPath: '/x/node', guard: guard({ nodeFails: true, distFails: true }) })).toBe('/x/node');
  });

  it('the gnomond entry is the SEA itself under the SEA, the script otherwise', () => {
    expect(gnomondEntryOf('/p/dist/cli/gnomond.js', { sea: true, execPath: KERNEL })).toBe(KERNEL);
    expect(gnomondEntryOf('/p/dist/cli/gnomond.js', { sea: false, execPath: KERNEL })).toBe('/p/dist/cli/gnomond.js');
  });
});

describe('#kernel-sea re-exec argv', () => {
  it('FALSIFIER: a SEA re-exec (no entry) selects gnomond with --gnomond and carries no node flag and no script', () => {
    const a = reexecArgs({ home: '/h', idleMs: 5 });
    expect(a).toEqual([SEA_GNOMOND_ARG, '--foreground', '--home', '/h', '--idle-ms', '5']);
    expect(a).not.toContain('--disable-sigusr1');
  });

  it('under node the re-exec is unchanged: --disable-sigusr1 then the entry', () => {
    expect(reexecArgs({ entry: '/p/gnomond.js', home: '/h' }).slice(0, 2)).toEqual(['--disable-sigusr1', '/p/gnomond.js']);
  });

  it('the prelude and the kernel agree on the selector', () => {
    const prelude = readFileSync(path.join(PKG_ROOT, 'scripts', 'sea', 'sea-prelude.mjs'), 'utf8');
    expect(prelude).toContain(`args[0] === '${SEA_GNOMOND_ARG}'`);
    // Aegis H1: the prelude checks the kernel tree with the release script's algorithm before any kernel code runs
    expect(prelude).toContain("const KERNEL_TREE_DOMAIN = 'gnomon-wrapper-kernel-tree:v1';");
    expect(prelude.indexOf('checkDist();\n} catch')).toBeGreaterThan(0);
    // Aegis S0 M1: the pre-JS variables are refused, every NODE_*, OPENSSL_*, SSL_CERT_* stripped
    for (const k of ['NODE_EXTRA_CA_CERTS', 'NODE_ICU_DATA', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'OPENSSL_CONF', 'NODE_TLS_REJECT_UNAUTHORIZED']) expect(prelude).toContain(`'${k}'`);
    expect(prelude).toContain('STRIPPED_ENV_PATTERN = /^(NODE_|OPENSSL_|SSL_CERT_)/');
  });
});

describe('#kernel-sea build constants (scripts/build-sea.mjs)', () => {
  it('FALSIFIER: the sea-config bakes --disable-sigusr1 and ignores NODE_OPTIONS (execArgvExtension none)', () => {
    const c = sea.seaConfig('/w/main.cjs', '/w/sea.blob');
    expect(c).toMatchObject({ main: '/w/main.cjs', output: '/w/sea.blob', execArgv: ['--disable-sigusr1'], execArgvExtension: 'none', useSnapshot: false, useCodeCache: false, disableExperimentalSEAWarning: true });
  });

  it('the identifiers and requirement match the kernel, the wrapper layout and the helper check', () => {
    expect(sea.KERNEL_SEA_NAME).toBe(KERNEL_SEA_NAME);
    expect(sea.KERNEL_IDENTIFIER).toBe(KERNEL_IDENTIFIER);
    expect(sea.NODE_IDENTIFIER).toBe(CHILD_NODE_IDENTIFIER);
    expect(sea.CHILD_NODE_REL).toBe(DEV_CHILD_NODE_REL);
    expect(sea.kernelRequirement('developer-id')).toBe('anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "SW4BMQ8PNL" and identifier "gnomon.kernel"');
    expect(sea.kernelRequirement('adhoc')).toBe('identifier "gnomon.kernel"');
    // Aegis H2: dev builds sign gnomon.kernel.dev / gnomon.node.dev and never meet the release requirement
    expect(sea.KERNEL_DEV_IDENTIFIER).toBe(KERNEL_DEV_IDENTIFIER);
    expect(sea.NODE_DEV_IDENTIFIER).toBe(CHILD_NODE_DEV_IDENTIFIER);
    expect(sea.kernelRequirement('developer-id', 'dev')).toMatch(/subject\.OU\] = "SW4BMQ8PNL" and identifier "gnomon\.kernel\.dev"$/);
    expect(sea.kernelRequirement('adhoc', 'dev')).toBe('identifier "gnomon.kernel.dev"');
    expect(() => sea.kernelRequirement('adhoc', 'staging')).toThrow();
    expect(() => sea.kernelRequirement('other')).toThrow();
    const layout = readFileSync(path.join(PKG_ROOT, '..', 'gnomon-wrapper', 'src', 'layout.rs'), 'utf8');
    expect(layout).toContain('pub const KERNEL_EXE_REL: &str = "Resources/kernel/gnomon.kernel";');
    expect(layout).toContain('pub const KERNEL_IDENTIFIER: &str = "gnomon.kernel";');
  });

  it('FALSIFIER (Aegis merge hardening): the stat cache keys on BigInt nanosecond mtime/ctime, never the *Ms doubles', () => {
    const prelude = readFileSync(path.join(PKG_ROOT, 'scripts', 'sea', 'sea-prelude.mjs'), 'utf8');
    // every stat the caches read is a BigInt stat
    const stats = [...prelude.matchAll(/fs\.(l?statSync)\(([^)]*)\)/g)].map((m) => m[2]);
    expect(stats.length).toBe(3);
    for (const a of stats) expect(a, a).toContain('{ bigint: true }');
    // the fingerprint itself (importing the prelude would run it, so its source is evaluated alone)
    const src = /export const fp = (\(st\) => \{[\s\S]*?\n\});/.exec(prelude)?.[1];
    expect(src).toBeDefined();
    expect(src).not.toMatch(/Ms\b/);
    const fp = new Function(`return ${src!}`)() as (st: unknown) => string;
    const base = { dev: 1n, ino: 2n, size: 3n, mtimeNs: 1_700_000_000_000_000_001n, ctimeNs: 1_700_000_000_000_000_001n };
    // one nanosecond apart: the same *Ms double (1700000000000.000001 rounds), different fingerprints
    expect(Number(base.ctimeNs) / 1e6).toBe(Number(base.ctimeNs + 1n) / 1e6);
    expect(fp({ ...base, ctimeNs: base.ctimeNs + 1n })).not.toBe(fp(base));
    expect(fp({ ...base, mtimeNs: base.mtimeNs + 1n })).not.toBe(fp(base));
    expect(fp({ ...base })).toBe(fp(base));
    // a non-BigInt stat is refused, never silently keyed on doubles
    expect(() => fp({ dev: 1, ino: 2, size: 3, mtimeMs: 1, ctimeMs: 1 })).toThrow(/BigInt stats/);
  });

  it('FALSIFIER (Aegis H1): the child-node requirement is cdhash-pinned (+ the Developer ID anchor and team when signed)', () => {
    const cd = 'ab'.repeat(20);
    expect(sea.childNodeRequirement({ signing: 'adhoc', identifier: 'gnomon.node.dev', cdhash: cd })).toBe(`identifier "gnomon.node.dev" and cdhash H"${cd}"`);
    expect(sea.childNodeRequirement({ signing: 'developer-id', identifier: 'gnomon.node', cdhash: cd })).toMatch(/^anchor apple generic .*subject\.OU\] = "SW4BMQ8PNL" and identifier "gnomon\.node" and cdhash H"(ab){20}"$/);
    expect(() => sea.childNodeRequirement({ signing: 'adhoc', identifier: 'gnomon.node', cdhash: 'nope' })).toThrow();
  });

  it('FALSIFIER (Aegis H1): bundleSeaMain refuses to build a SEA without the dist tree and a cdhash-pinned child requirement', async () => {
    await expect(sea.bundleSeaMain('/nonexistent/out.cjs', {})).rejects.toThrow(/needs build/);
    await expect(sea.bundleSeaMain('/nonexistent/out.cjs', { build: { profile: 'dev', distTree: 'sha256:' + '0'.repeat(64), childNodeRequirement: 'identifier "gnomon.node.dev"' } })).rejects.toThrow(/cdhash-pinned/);
  });

  it('FALSIFIER (Aegis M2): --no-sea reaches build.rs, which then pins no SEA (a stale gnomon.kernel is never pinned)', () => {
    const wrapper = path.join(PKG_ROOT, '..', 'gnomon-wrapper');
    const script = readFileSync(path.join(wrapper, 'scripts', 'build-darwin.mjs'), 'utf8');
    expect(script).toContain("GNOMON_WRAPPER_NO_SEA: process.argv.includes('--no-sea') ? '1' : ''");
    const rs = readFileSync(path.join(wrapper, 'build.rs'), 'utf8');
    const fn = rs.slice(rs.indexOf('fn dev_sea('), rs.indexOf('let kexe = pkg.join("gnomon.kernel");'));
    expect(fn).toContain('if std::env::var("GNOMON_WRAPPER_NO_SEA").as_deref() == Ok("1")');
    expect(fn).toContain('return None;');
    expect(fn).toContain('cargo:rerun-if-env-changed=GNOMON_WRAPPER_NO_SEA');
  });

  it('the kernel entitlements are allow-jit only: no get-task-allow, no library-validation opt-out', () => {
    const ent = readFileSync(sea.KERNEL_ENTITLEMENTS, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    expect([...ent.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1])).toEqual(['com.apple.security.cs.allow-jit']);
  });
});

describe('#kernel-sea FENCE: children never spawn process.execPath', () => {
  // the kernel's own re-execs (the gnomond activator, the upgrade successor), the SEA module and gnomond's argv fallback
  const ALLOWED = new Set(['src/kernel/lifecycle/sea.ts', 'src/kernel/lifecycle/successor.ts', 'src/cli/daemon-cli.ts', 'src/cli/gnomond.ts']);
  // Aegis S0 L2: under the SEA process.argv[0] and process.argv0 are the kernel too, and argv[1] is (the prelude makes
  // it) execPath: any of them used as a child's command spawns the kernel
  const SELF = /process\.execPath|process\.argv\s*\[\s*[01]\s*\]|process\.argv0\b|process\[['"](execPath|argv0)['"]\]/;
  const offenders = (): string[] => {
    const out: string[] = [];
    for (const f of walk(path.join(PKG_ROOT, 'src'), (n) => n.endsWith('.ts'))) {
      const rel = path.relative(PKG_ROOT, f).split(path.sep).join('/');
      if (ALLOWED.has(rel)) continue;
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
          if (SELF.test(code.replace(/\/\/.*$/, ''))) out.push(`${rel}:${i + 1}`);
        });
    }
    return out;
  };
  it('FALSIFIER: every other process.execPath / process.argv[0|1] / process.argv0 use in src is gone (routed through childNodePath)', () => {
    expect(offenders()).toEqual([]);
  });
  it('the fence pattern catches each self reference (and not a plain argv0 variable)', () => {
    for (const s of ['spawn(process.execPath, a)', 'spawn(process.argv[0], a)', 'x = process.argv[ 1 ]', 'spawn(process.argv0)', "process['execPath']", 'process["argv0"]']) expect(SELF.test(s), s).toBe(true);
    for (const s of ['resolveArgv0(argv0, ctx)', 'process.argv.slice(2)', 'process.argv[2]']) expect(SELF.test(s), s).toBe(false);
  });
  it('FALSIFIER (Aegis L1): a signature passes only with exactly [allow-jit]', () => {
    expect(sea.entitlementsAreExactly(['com.apple.security.cs.allow-jit'])).toBe(true);
    for (const e of [[], ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.disable-library-validation'], ['com.apple.security.get-task-allow'], ['com.apple.security.cs.allow-unsigned-executable-memory'], undefined]) expect(sea.entitlementsAreExactly(e), JSON.stringify(e)).toBe(false);
  });
});
