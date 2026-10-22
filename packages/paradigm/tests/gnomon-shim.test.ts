/**
 * #gnomon-shim (T-2026-10-21-030, TD-2026-10-21-758; 8.0 M3/M4): paradigm's `gnomon` bin resolves its
 * @a-company/gnomon dependency and that package's platform package (both inside its own install, same version); off
 * macOS, or without the platform package npm installs on a matching Mac, it prints one plain line and exits non-zero.
 * The install-and-launch half is tests/gnomon-shim-install.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .js bin, no declarations
import { EXIT_REFUSED, EXIT_UNSUPPORTED, resolveGnomon, UNSUPPORTED } from '../bin/gnomon.js';

const SHIM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'gnomon.js');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A global-install-shaped tree: paradigm with the shim, gnomon (a fake CLI) and optionally its platform package. */
function installTree({ platformArch }: { platformArch?: string } = {}): { root: string; shim: string } {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-shim-')));
  dirs.push(root);
  const nm = path.join(root, 'lib', 'node_modules', '@a-company');
  const paradigm = path.join(nm, 'paradigm');
  mkdirSync(path.join(paradigm, 'bin'), { recursive: true });
  writeFileSync(path.join(paradigm, 'package.json'), JSON.stringify({ name: '@a-company/paradigm', type: 'module' }));
  copyFileSync(SHIM, path.join(paradigm, 'bin', 'gnomon.js'));
  copyFileSync(path.join(path.dirname(SHIM), 'gnomon-app.js'), path.join(paradigm, 'bin', 'gnomon-app.js'));
  const gnomon = path.join(paradigm, 'node_modules', '@a-company', 'gnomon');
  mkdirSync(path.join(gnomon, 'dist', 'cli'), { recursive: true });
  writeFileSync(path.join(gnomon, 'package.json'), JSON.stringify({ name: '@a-company/gnomon', version: '8.0.0', type: 'module', bin: { gnomon: 'dist/cli/gnomon.js' }, exports: { '.': './dist/index.js', './package.json': './package.json' } }));
  writeFileSync(path.join(gnomon, 'dist', 'cli', 'gnomon.js'), "process.stdout.write(JSON.stringify(process.argv.slice(2)));\nprocess.exitCode = 3;\n");
  if (platformArch) {
    const p = path.join(paradigm, 'node_modules', '@a-company', `gnomon-darwin-${platformArch}`);
    mkdirSync(p, { recursive: true });
    writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name: `@a-company/gnomon-darwin-${platformArch}`, version: '8.0.0', type: 'module' }));
  }
  // npm links global bins as symlinks to the package file
  mkdirSync(path.join(root, 'bin'));
  symlinkSync(path.join(paradigm, 'bin', 'gnomon.js'), path.join(root, 'bin', 'gnomon'));
  return { root, shim: path.join(root, 'bin', 'gnomon') };
}

describe('#gnomon-shim resolveGnomon', () => {
  it('off macOS: the one plain line', () => {
    for (const platform of ['linux', 'win32']) expect(resolveGnomon({ platform, arch: 'x64' })).toEqual({ ok: false, message: UNSUPPORTED });
    expect(UNSUPPORTED).toBe('Gnomon runs on macOS only in 8.0; Windows and Linux are planned');
  });

  it('on macOS without the platform package (npm skipped it): the same line', () => {
    const { root } = installTree();
    const from = path.join(root, 'lib', 'node_modules', '@a-company', 'paradigm', 'bin', 'gnomon.js');
    expect(resolveGnomon({ platform: 'darwin', arch: 'arm64', from })).toEqual({ ok: false, message: UNSUPPORTED });
  });

  it('on macOS with the platform package: both packages and their (matching) version', () => {
    const { root } = installTree({ platformArch: 'x64' });
    const from = path.join(root, 'lib', 'node_modules', '@a-company', 'paradigm', 'bin', 'gnomon.js');
    const r = resolveGnomon({ platform: 'darwin', arch: 'x64', from });
    const nm = path.join(root, 'lib', 'node_modules', '@a-company', 'paradigm', 'node_modules', '@a-company');
    expect(r).toEqual({ ok: true, gnomonPackage: path.join(nm, 'gnomon'), platformPackage: path.join(nm, 'gnomon-darwin-x64'), version: '8.0.0' });
    // a platform package of another version (a half-finished upgrade) is refused
    writeFileSync(path.join(nm, 'gnomon-darwin-x64', 'package.json'), JSON.stringify({ name: '@a-company/gnomon-darwin-x64', version: '7.9.9' }));
    expect(resolveGnomon({ platform: 'darwin', arch: 'x64', from }).message).toMatch(/do not match; reinstall/);
    writeFileSync(path.join(nm, 'gnomon-darwin-x64', 'package.json'), JSON.stringify({ name: '@a-company/gnomon-darwin-x64', version: '8.0.0' }));
    // an arch without its package (arm64 here) is still refused
    expect(resolveGnomon({ platform: 'darwin', arch: 'arm64', from }).ok).toBe(false);
  });

  it('without @a-company/gnomon at all: a reinstall hint, not a crash', () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-shim-empty-')));
    dirs.push(root);
    const r = resolveGnomon({ platform: 'darwin', arch: 'arm64', from: path.join(root, 'x', 'gnomon.js') });
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/npm i -g @a-company\/paradigm/);
  });
});

/** A fake gnomon package (+ optional platform package) inside `nm` (a node_modules dir). */
function plantGnomon(nm: string, { name = '@a-company/gnomon', platformArch }: { name?: string; platformArch?: string } = {}): string {
  const g = path.join(nm, '@a-company', 'gnomon');
  mkdirSync(path.join(g, 'dist', 'cli'), { recursive: true });
  writeFileSync(path.join(g, 'package.json'), JSON.stringify({ name, version: '8.0.0', type: 'module', bin: { gnomon: 'dist/cli/gnomon.js' } }));
  writeFileSync(path.join(g, 'dist', 'cli', 'gnomon.js'), "process.stdout.write('PLANTED');\n");
  if (platformArch) {
    const p = path.join(nm, '@a-company', `gnomon-darwin-${platformArch}`);
    mkdirSync(p, { recursive: true });
    writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name: `@a-company/gnomon-darwin-${platformArch}`, version: '8.0.0' }));
  }
  return g;
}

describe('#gnomon-shim refuses packages outside its own install (Aegis M3 medium 3)', () => {
  /** paradigm installed at <root>/project/node_modules/@a-company/paradigm with NO gnomon of its own */
  function bareParadigm(): { root: string; from: string } {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-shim-plant-')));
    dirs.push(root);
    const paradigm = path.join(root, 'project', 'node_modules', '@a-company', 'paradigm');
    mkdirSync(path.join(paradigm, 'bin'), { recursive: true });
    writeFileSync(path.join(paradigm, 'package.json'), JSON.stringify({ name: '@a-company/paradigm', type: 'module' }));
    copyFileSync(SHIM, path.join(paradigm, 'bin', 'gnomon.js'));
    copyFileSync(path.join(path.dirname(SHIM), 'gnomon-app.js'), path.join(paradigm, 'bin', 'gnomon-app.js'));
    return { root, from: path.join(paradigm, 'bin', 'gnomon.js') };
  }

  it('a gnomon planted in a node_modules HIGHER in the path is refused', () => {
    const { root, from } = bareParadigm();
    plantGnomon(path.join(root, 'node_modules'), { platformArch: 'arm64' });
    const r = resolveGnomon({ platform: 'darwin', arch: 'arm64', from });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/outside this paradigm install; refused/);
  });

  it('a gnomon hoisted beside paradigm (a local install) is accepted; one with the wrong name is refused', () => {
    const { root, from } = bareParadigm();
    const nm = path.join(root, 'project', 'node_modules');
    plantGnomon(nm, { platformArch: 'arm64' });
    expect(resolveGnomon({ platform: 'darwin', arch: 'arm64', from }).ok).toBe(true);
    writeFileSync(path.join(nm, '@a-company', 'gnomon', 'package.json'), JSON.stringify({ name: 'not-gnomon', bin: { gnomon: 'dist/cli/gnomon.js' } }));
    expect(resolveGnomon({ platform: 'darwin', arch: 'arm64', from }).message).toMatch(/is not @a-company\/gnomon; refused/);
  });

  it('a gnomon reached only through NODE_PATH is refused (the bin never runs it)', () => {
    const { root, from } = bareParadigm();
    const elsewhere = path.join(root, 'elsewhere', 'node_modules');
    plantGnomon(elsewhere, { platformArch: process.arch === 'x64' ? 'x64' : 'arm64' });
    const r = spawnSync(process.execPath, [from], { encoding: 'utf8', env: { ...process.env, NODE_PATH: elsewhere } });
    expect(r.stdout).not.toContain('PLANTED');
    expect(r.status).toBe(EXIT_UNSUPPORTED);
    if (process.platform === 'darwin') expect(r.stderr).toMatch(/outside this paradigm install; refused/);
  });
});

describe('#gnomon-shim as a bin (through the npm symlink)', () => {
  it.runIf(process.platform === 'darwin')('never runs the gnomon package CLI on this node: a dev gnomon (no release pins) is refused', () => {
    const { shim } = installTree({ platformArch: process.arch });
    const r = spawnSync(process.execPath, [shim, 'up', '--no-open'], { encoding: 'utf8' });
    expect(r.stdout).toBe(''); // the fake package CLI would print its argv
    expect(r.status).toBe(EXIT_REFUSED);
    expect(r.stderr).toMatch(/no readable build stamp|development build/);
  });

  it('without a platform package (or off macOS) it prints one line and exits non-zero', () => {
    const { shim } = installTree();
    const r = spawnSync(process.execPath, [shim, 'up'], { encoding: 'utf8' });
    expect(r.status).toBe(EXIT_UNSUPPORTED);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe(`${UNSUPPORTED}\n`);
  });
});
