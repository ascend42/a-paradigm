// @gnomon-platform: darwin, linux
/**
 * #bare-entry installer (scripts/install-darwin.mjs): idempotent link into
 * the first writable bin dir; never overwrites a non-symlink or a link to
 * another clone; refuses NODE_OPTIONS and an old node. POSIX: symlinks and
 * directory write bits (Windows has no /opt/homebrew/bin and needs a privilege
 * for symlinks; the installer is macOS-first).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- a zero-dep .mjs script, no declaration file
import { NEXT_STEPS, placeLink, runtimeProblem } from '../scripts/install-darwin.mjs';
import { removeTree } from '../src/kernel/manifest/index.js';
import { PKG_ROOT } from './helpers.js';
import { privateTmpRoot } from './daemon-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
function world() {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), 'gi-')));
  cleanups.push(() => removeTree(d));
  const target = path.join(d, 'clone', 'gnomon.js');
  fs.mkdirSync(path.dirname(target));
  fs.writeFileSync(target, '#!/usr/bin/env node\n');
  const brew = path.join(d, 'brew-bin');
  const local = path.join(d, 'local-bin');
  fs.mkdirSync(local);
  return { d, target, brew, local };
}

describe('#bare-entry installer', () => {
  it('links into the first writable dir; a second run is a no-op (already)', () => {
    const w = world(); // brew-bin does not exist: the first WRITABLE dir is local-bin
    const a = placeLink(w.target, [w.brew, w.local]);
    expect(a).toMatchObject({ ok: true, action: 'linked', dir: w.local });
    expect(fs.realpathSync.native(path.join(w.local, 'gnomon'))).toBe(w.target);
    expect(placeLink(w.target, [w.brew, w.local])).toMatchObject({ ok: true, action: 'already' });
  });
  it('FALSIFIER: a non-symlink or a link to another clone is refused and left untouched', () => {
    const w = world();
    fs.writeFileSync(path.join(w.local, 'gnomon'), 'not a link');
    const r = placeLink(w.target, [w.local]);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('is not a symlink');
    expect(fs.readFileSync(path.join(w.local, 'gnomon'), 'utf8')).toBe('not a link');
    const w2 = world();
    const other = path.join(w2.d, 'other.js');
    fs.writeFileSync(other, '');
    fs.symlinkSync(other, path.join(w2.local, 'gnomon'));
    const r2 = placeLink(w2.target, [w2.local]);
    expect(r2.ok).toBe(false);
    expect(r2.message).toContain('already points to');
    expect(fs.realpathSync.native(path.join(w2.local, 'gnomon'))).toBe(other);
  });
  it('no writable dir: refused with the manual ln command, nothing written', () => {
    const w = world();
    const r = placeLink(w.target, [w.brew]);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('does not use sudo');
  });
  it('NODE_OPTIONS and node < 22.14 are refused; the next steps name helper, hardware test, identity init, the app and repin', () => {
    expect(runtimeProblem({ NODE_OPTIONS: '--require x' }, '24.0.0')).toContain('unset NODE_OPTIONS');
    expect(runtimeProblem({}, '22.13.0')).toContain('22.14');
    expect(runtimeProblem({}, '24.1.0')).toBeNull();
    for (const s of ['gnomon-helper/scripts/build-darwin.mjs', 'GNOMON_HW_TESTS=1', 'gnomon identity init', 'gnomon-wrapper/scripts/build-darwin.mjs', 'repin-claude']) expect(NEXT_STEPS).toContain(s);
  });
  it('the script never names the Gnomon home or its keys, and never runs sudo', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'scripts', 'install-darwin.mjs'), 'utf8');
    const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
    expect(code).not.toMatch(/\.gnomon['"/]|homedir|keys\/|sudo['"]/);
  });
});
