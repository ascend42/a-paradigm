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
import { childNodePath, DEV_CHILD_NODE_REL, gnomondEntryOf, KERNEL_IDENTIFIER, KERNEL_SEA_NAME, runningAsSea, SEA_GNOMOND_ARG, SeaChildNodeMissing, seaChildNodeCandidates, CHILD_NODE_IDENTIFIER } from '../src/kernel/lifecycle/sea.js';
import type { AppBundle } from '../src/kernel/lifecycle/app-bundle.js';
import { PKG_ROOT, walk } from './helpers.js';

const KERNEL = '/Applications/Gnomon.app/Contents/Resources/kernel/gnomon.kernel';
const bundle = { node: '/Applications/Gnomon.app/Contents/Resources/node/bin/node' } as AppBundle;

describe('#kernel-sea childNodePath', () => {
  it('not a SEA: process.execPath (or the given execPath), whatever exists', () => {
    expect(runningAsSea()).toBe(false); // vitest runs under plain node
    expect(childNodePath()).toBe(process.execPath);
    expect(childNodePath({ sea: false, execPath: '/x/node', isFile: () => false })).toBe('/x/node');
  });

  it('FALSIFIER: under the SEA in Gnomon.app a child runs the bundled gnomon.node, never the kernel', () => {
    const got = childNodePath({ sea: true, execPath: KERNEL, bundle, isFile: () => true });
    expect(got).toBe(bundle.node);
    expect(got).not.toBe(KERNEL);
  });

  it('FALSIFIER: a dev SEA uses <dir of gnomon.kernel>/node/bin/node', () => {
    const dev = '/repo/packages/gnomon/gnomon.kernel';
    const want = path.join('/repo/packages/gnomon', DEV_CHILD_NODE_REL);
    expect(childNodePath({ sea: true, execPath: dev, bundle: null, isFile: (p) => p === want })).toBe(want);
    expect(seaChildNodeCandidates({ execPath: KERNEL, bundle })).toEqual([bundle.node, path.join(path.dirname(KERNEL), DEV_CHILD_NODE_REL)]);
  });

  it('FALSIFIER: under the SEA with no gnomon.node it throws SeaChildNodeMissing: it never falls back to execPath', () => {
    expect(() => childNodePath({ sea: true, execPath: KERNEL, bundle, isFile: () => false })).toThrow(SeaChildNodeMissing);
    expect(() => childNodePath({ sea: true, execPath: KERNEL, bundle, isFile: (p) => p === KERNEL })).toThrow(/never spawns itself/);
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
    for (const k of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS']) expect(prelude).toContain(`'${k}'`);
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
    expect(() => sea.kernelRequirement('other')).toThrow();
    const layout = readFileSync(path.join(PKG_ROOT, '..', 'gnomon-wrapper', 'src', 'layout.rs'), 'utf8');
    expect(layout).toContain('pub const KERNEL_EXE_REL: &str = "Resources/kernel/gnomon.kernel";');
    expect(layout).toContain('pub const KERNEL_IDENTIFIER: &str = "gnomon.kernel";');
  });

  it('the kernel entitlements are allow-jit only: no get-task-allow, no library-validation opt-out', () => {
    const ent = readFileSync(sea.KERNEL_ENTITLEMENTS, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    expect([...ent.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1])).toEqual(['com.apple.security.cs.allow-jit']);
  });
});

describe('#kernel-sea FENCE: children never spawn process.execPath', () => {
  // the kernel's own re-execs (the gnomond activator, the upgrade successor), the SEA module and gnomond's argv fallback
  const ALLOWED = new Set(['src/kernel/lifecycle/sea.ts', 'src/kernel/lifecycle/successor.ts', 'src/cli/daemon-cli.ts', 'src/cli/gnomond.ts']);
  it('FALSIFIER: every other process.execPath use in src is gone (routed through childNodePath)', () => {
    const offenders: string[] = [];
    for (const f of walk(path.join(PKG_ROOT, 'src'), (n) => n.endsWith('.ts'))) {
      const rel = path.relative(PKG_ROOT, f).split(path.sep).join('/');
      if (ALLOWED.has(rel)) continue;
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
          if (code.replace(/\/\/.*$/, '').includes('process.execPath')) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
