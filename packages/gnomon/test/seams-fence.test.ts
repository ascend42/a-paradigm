/**
 * Seam fence and presence tripwire (spec §19.1 release gate (c), P8-D84;
 * T-2026-10-17-009(c), Aegis S34-10). The kernel's test seams (keystoreAnchor,
 * bootSession, the recovery open, acknowledgeGap, the presence mint) live
 * behind the internal test entry src/kernel/testing.ts, fed by the channel
 * src/kernel/internal-seams.ts. This file proves, on the source import graph,
 * the built dist/ and the public runtime surface, that production entry
 * points (package index, gnomon, gnomond, gnomon-web) cannot reach them, and
 * that nothing in the CLI or the daemon names acknowledgeGap before presence
 * lands (M1.3), nor the #manifest-loader install-card decision / rollback
 * before the approval broker lands (M1.6).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.js';
import { KernelLog, SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { GNOMON_INTERNAL_TEST_ENTRY } from '../src/kernel/testing.js';
import { extractSpecifiers, PKG_ROOT, rel, walk } from './helpers.js';

const SRC = path.join(PKG_ROOT, 'src');
const TEST_ENTRY = 'src/kernel/testing.ts';
const CHANNEL = 'src/kernel/internal-seams.ts';
const CHANNEL_IMPORTERS = ['src/kernel/identity/presence.ts', 'src/kernel/log/kernel-log.ts', 'src/kernel/log/quarantine.ts', 'src/kernel/manifest/install.ts', 'src/kernel/web/endpoint.ts', TEST_ENTRY];
/** Files that may name the gated recovery API in code (the implementation, the channel, the test entry). */
const MAY_NAME_RECOVERY = new Set(['src/kernel/log/kernel-log.ts', CHANNEL, TEST_ENTRY]);
const GATED = /\b(acknowledgeGap|openForRecovery|openKernelLogForRecovery|seamsOf|mintTestPresence)\b/;
/** CLI / daemon only: constructing KernelLog directly or casting it (the constructor-key bypass shape). */
/** #manifest-loader (M1.5): the install-card decision and the rollback — the M1.6 broker owns them in production. */
const GATED_MANIFEST = /\b(decideInstall|decideInstallCard|rollbackMod|rollbackModSnapshot|ManifestDecisions)\b/;
// M1.6 (T-2026-10-18-008): the broker owns the install-card decision in production (bound mod.install presence)
const MAY_NAME_MANIFEST = new Set(['src/kernel/manifest/install.ts', 'src/kernel/broker/install-card.ts', CHANNEL, TEST_ENTRY]);
const DIRECT_CONSTRUCT = /\bnew\s+(\(\s*)?KernelLog\b|\bKernelLog\s+as\b/;

/** Strip block and line comments (string contents kept; good enough for identifier tripwires). */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const files = walk(SRC, (f) => /\.ts$/.test(f) && !f.endsWith('.d.ts'));
const keys = new Set(files.map(rel));
/** Relative specifiers that resolve to no src file (an unresolved edge would silently drop out of a closure). */
const unresolved: string[] = [];
/** Resolve a relative specifier to a graph key: `.js` → `.ts`, then as written, `+ .ts`, `/index.ts`. */
function resolveSpec(from: string, spec: string): string | undefined {
  const base = rel(path.resolve(path.dirname(from), spec));
  const candidates = [base.replace(/\.js$/, '.ts'), base, `${base}.ts`, `${base}/index.ts`];
  return candidates.find((c) => keys.has(c));
}
/** rel(src file) → rel(resolved relative imports). */
const graph = new Map<string, string[]>(
  files.map((f) => [
    rel(f),
    extractSpecifiers(readFileSync(f, 'utf8'))
      .filter((s) => s.startsWith('./') || s.startsWith('../'))
      .flatMap((s) => {
        const r = resolveSpec(f, s);
        if (r === undefined) unresolved.push(`${rel(f)}: ${s}`);
        return r === undefined ? [] : [r];
      }),
  ]),
);

function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...(graph.get(f) ?? []));
  }
  return seen;
}

/** The production entries, read from tsup.config.ts (the bundles that ship). */
const PROD_ENTRIES = [...readFileSync(path.join(PKG_ROOT, 'tsup.config.ts'), 'utf8').matchAll(/'(src\/[^']+\.ts)'/g)].map((m) => m[1]!);

describe('seam fence: the internal test entry is unreachable from production (source graph)', () => {
  it('the graph and the production entries were found', () => {
    expect(graph.has(TEST_ENTRY)).toBe(true);
    expect(graph.has(CHANNEL)).toBe(true);
    expect(PROD_ENTRIES).toEqual(expect.arrayContaining(['src/index.ts', 'src/cli/gnomon.ts', 'src/cli/gnomond.ts', 'src/transport/gnomon-web.ts']));
    expect(PROD_ENTRIES).not.toContain(TEST_ENTRY);
  });

  it('every relative import under src/ resolves to a src file (no edge can silently drop out of a closure)', () => {
    expect(unresolved).toEqual([]);
  });

  it('no file under src/ imports the internal test entry', () => {
    expect([...graph].filter(([, deps]) => deps.includes(TEST_ENTRY)).map(([f]) => f)).toEqual([]);
  });

  it('only the seam owners and the test entry import the seam channel', () => {
    expect([...graph].filter(([, deps]) => deps.includes(CHANNEL)).map(([f]) => f).sort()).toEqual([...CHANNEL_IMPORTERS].sort());
  });

  it.each(PROD_ENTRIES)('the import closure of %s excludes the test entry', (entry) => {
    const c = closure(entry);
    expect(c.size).toBeGreaterThan(1);
    expect(c.has(TEST_ENTRY)).toBe(false);
  });
});

describe('presence tripwire: the CLI and the daemon cannot reach acknowledgeGap before presence lands (M1.3)', () => {
  it('self-test: the scanner sees code, ignores comments', () => {
    expect(DIRECT_CONSTRUCT.test('new (KernelLog as any)(o, s, true)')).toBe(true);
    expect(DIRECT_CONSTRUCT.test('const l = new KernelLog(o)')).toBe(true);
    expect(DIRECT_CONSTRUCT.test('KernelLog.open(o)')).toBe(false);
    expect(GATED.test(stripComments('await log.acknowledgeGap({ presenceToken })'))).toBe(true);
    expect(GATED.test(stripComments('const x = 1; // acknowledgeGap later\n/* openForRecovery */'))).toBe(false);
  });

  it('no src/cli or daemon ($daemon-lifecycle) file names the gated recovery API', () => {
    const scoped = files.map(rel).filter((f) => f.startsWith('src/cli/') || f.startsWith('src/kernel/lifecycle/'));
    expect(scoped.length).toBeGreaterThan(3);
    expect(scoped.filter((f) => GATED.test(stripComments(readFileSync(path.join(PKG_ROOT, f), 'utf8'))))).toEqual([]);
    expect(scoped.filter((f) => DIRECT_CONSTRUCT.test(stripComments(readFileSync(path.join(PKG_ROOT, f), 'utf8'))))).toEqual([]);
  });

  it('no other src file names it either (only kernel-log.ts, the channel and the test entry)', () => {
    const hits = files.map(rel).filter((f) => !MAY_NAME_RECOVERY.has(f) && GATED.test(stripComments(readFileSync(path.join(PKG_ROOT, f), 'utf8'))));
    expect(hits).toEqual([]);
  });

  it('#manifest-loader: only install.ts, the channel and the test entry name the install-card decision / rollback (M1.6 owns cards)', () => {
    expect(GATED_MANIFEST.test(stripComments('decideInstallCard(home, n, id, "install", o)'))).toBe(true);
    const hits = files.map(rel).filter((f) => !MAY_NAME_MANIFEST.has(f) && GATED_MANIFEST.test(stripComments(readFileSync(path.join(PKG_ROOT, f), 'utf8'))));
    expect(hits).toEqual([]);
  });

  it('#manifest-loader: the public surface stages installs but exposes no decision, rollback or seam owner', () => {
    expect(typeof pkg.manifestLoader.stageInstall).toBe('function');
    for (const k of ['decideInstall', 'decideInstallCard', 'rollbackMod', 'rollbackModSnapshot', 'ManifestDecisions']) {
      expect(Object.keys(pkg.manifestLoader)).not.toContain(k);
      expect(Object.keys(pkg)).not.toContain(k);
    }
  });

  it('the public runtime surface has no recovery open, no acknowledgeGap and no seam keys', () => {
    const K = pkg.kernelLog.KernelLog as unknown as Record<string, unknown>;
    expect(K.openForRecovery).toBeUndefined();
    expect('acknowledgeGap' in pkg.kernelLog.KernelLog.prototype).toBe(false);
    for (const k of ['openKernelLog', 'openKernelLogForRecovery', 'acknowledgeGap', 'mintTestPresence', 'seamsOf', 'registerSeams', 'GNOMON_INTERNAL_TEST_ENTRY']) {
      expect(Object.keys(pkg.kernelLog)).not.toContain(k);
      expect(Object.keys(pkg)).not.toContain(k);
    }
  });

  it('KernelLog.open refuses the seam options at runtime (a JS caller cannot slip them past the type)', () => {
    for (const k of ['keystoreAnchor', 'bootSession']) {
      const opts = { home: path.join(PKG_ROOT, 'never-created'), kernelPrincipal: 'p:abcdefgh/kernel', signer: SoftwareEd25519Signer.generate(), [k]: undefined };
      expect(() => KernelLog.open(opts as never)).toThrow(/test seam/);
    }
    expect(existsSync(path.join(PKG_ROOT, 'never-created'))).toBe(false);
  });

  it('the private constructor cannot be called with seams + recovery by a cast (module-private construct key)', () => {
    const home = path.join(PKG_ROOT, 'never-created');
    const fake = { name: 'keystore', read: () => ({ state: 'absent' }), write: () => undefined };
    const Ctor = KernelLog as unknown as new (...a: unknown[]) => KernelLog;
    const opts = { home, kernelPrincipal: 'p:abcdefgh/kernel', signer: SoftwareEd25519Signer.generate() };
    expect(() => new Ctor(opts, { keystoreAnchor: fake, bootSession: 'x' }, true)).toThrow(/constructed only by KernelLog.open/);
    expect(() => new Ctor(Symbol('gnomon.kernel-log.construct'), opts, { keystoreAnchor: fake }, true)).toThrow(/constructed only by KernelLog.open/);
    expect(() => Reflect.construct(Ctor, [undefined, opts, {}, true])).toThrow(TypeError);
    expect(existsSync(home)).toBe(false);
  });

  it('verifyLog refuses the keystoreAnchor seam at runtime (always the kernel\'s own store)', () => {
    const fake = { name: 'keystore', read: () => ({ state: 'absent' }), write: () => undefined };
    expect(() => pkg.kernelLog.verifyLog(path.join(PKG_ROOT, 'never-created'), { keyRing: new pkg.kernelLog.KeyRing(), keystoreAnchor: fake } as never)).toThrow(/test seam/);
  });
});

describe('seam fence: dist/ (what ships)', () => {
  const distDir = path.join(PKG_ROOT, 'dist');
  const distFiles = existsSync(distDir) ? walk(distDir, (f) => /\.(c|m)?js$|\.d\.ts$/.test(f)) : [];

  it('dist/ exists (run `npm run build` first — never skip silently)', () => {
    expect(distFiles.length).toBeGreaterThan(0);
  });

  // Relies on tsup tree-shaking: internal-seams.ts IS bundled (kernel-log and
  // presence register with it), but seamsOf — and its error string — is used
  // only by testing.ts, so it must be dropped from every production bundle.
  it('no built file contains the internal test entry or its exports', () => {
    const marker = new RegExp(`${GNOMON_INTERNAL_TEST_ENTRY}|\\bmintTestPresence\\b|\\bdecideInstallCard\\b|\\brollbackModSnapshot\\b|\\bopenKernelLogForRecovery\\b|\\bseamsOf\\b|is not registered \\(its owner module was not loaded\\)`);
    expect(distFiles.filter((f) => marker.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  it('the built index exposes no recovery open / acknowledgeGap, and its types keep the seams off KernelLogOptions', async () => {
    const built = (await import(pathToFileURL(path.join(distDir, 'index.js')).href)) as typeof pkg;
    const K = built.kernelLog.KernelLog as unknown as Record<string, unknown>;
    expect(K.openForRecovery).toBeUndefined();
    expect('acknowledgeGap' in built.kernelLog.KernelLog.prototype).toBe(false);
    const dts = readFileSync(path.join(distDir, 'index.d.ts'), 'utf8');
    const opts = /interface KernelLogOptions \{[\s\S]*?\n\}/.exec(dts)?.[0] ?? '';
    expect(opts).toContain('kernelPrincipal');
    expect(opts).not.toMatch(/\b(keystoreAnchor|bootSession)\??:/);
    expect(dts).not.toMatch(/^\s*(static\s+)?(openForRecovery|acknowledgeGap)\s*\(/m);
    const vopts = /interface VerifyLogOptions \{[\s\S]*?\n\}/.exec(dts)?.[0] ?? '';
    expect(vopts).toContain('keyRing');
    expect(vopts).not.toMatch(/\bkeystoreAnchor\??:/);
    const vsig = /declare function verifyLog\([^)]*\)/.exec(dts)?.[0] ?? '';
    expect(vsig).toContain('VerifyLogOptions');
    expect(vsig).not.toMatch(/keystoreAnchor/);
  });
});

describe('transport-child isolation (§2.1, §11.2 rule 1b, A24-1)', () => {
  it('gnomon-web reaches no key, log, auth, identity or kernel state: its import closure is the framing, the channel and the bundle hash only', () => {
    expect([...closure('src/transport/gnomon-web.ts')].sort()).toEqual(
      ['src/kernel/socket/framing.ts', 'src/kernel/web/bundle.ts', 'src/kernel/web/protocol.ts', 'src/transport/gnomon-web.ts', 'src/transport/web-child.ts', 'src/transport/ws-codec.ts', 'src/version.ts'].sort(),
    );
  });
});
