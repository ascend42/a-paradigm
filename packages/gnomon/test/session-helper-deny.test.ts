// @gnomon-platform: darwin
/**
 * T-2026-10-18-028 M5: the session profile denies exec AND read of the signed
 * helper's bundle (GnomonHelper.app, the pinned one or any copy) and exec of
 * any file named gnomon-helper, by regex on the RESOLVED path. Enforced with
 * sandbox-exec (works with SIP on or off). The stand-in "helper" is a shell
 * script, so no Apple binary is relocated (launch constraints would SIGKILL it
 * and confound the result) and nothing ever reaches the Secure Enclave.
 * The real-helper half (the signed bundle denied, a bare copy SIGKILLed, and
 * `serve` refusing `sandboxed` under any profile) was measured by hand on
 * 2026-10-18 (lore); it needs the founder-built signed helper.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { helperDenySbpl, sessionProfileSbpl } from '../src/platform/darwin/session-sbpl.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { privateTmpRoot } from './daemon-helpers.js';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), 'hd-')));
afterAll(() => removeTree(root));

function fakeHelper(dir: string, exe = 'gnomon-helper'): string {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, exe);
  fs.writeFileSync(f, '#!/bin/sh\necho ran\n');
  fs.chmodSync(f, 0o755);
  return f;
}

const PROFILE = ['(version 1)', '(allow default)', ...helperDenySbpl()].join('\n');
const run = (cmd: string, args: string[] = [], profile = PROFILE) => spawnSync('/usr/bin/sandbox-exec', ['-p', profile, cmd, ...args], { encoding: 'utf8' });

describe('M5: a session cannot exec or copy the signed helper', () => {
  const pinned = fakeHelper(path.join(root, 'bin', 'GnomonHelper.app', 'Contents', 'MacOS'));
  const copied = fakeHelper(path.join(root, 'elsewhere', 'GnomonHelper.app', 'Contents', 'MacOS'));
  const renamedBundle = fakeHelper(path.join(root, 'r', 'Other.app', 'Contents', 'MacOS'));
  const control = fakeHelper(path.join(root, 'c'), 'not-the-helper');
  const link = path.join(root, 'link-to-helper');
  fs.symlinkSync(pinned, link);

  it('control: the same script under another name runs in the same profile', () => {
    expect(run(control).stdout).toBe('ran\n');
  });

  it('FALSIFIER: exec of the pinned bundle, a copied bundle, a renamed bundle and a symlink is denied', () => {
    for (const f of [pinned, copied, renamedBundle, link]) {
      const r = run(f);
      expect(r.stdout, f).not.toContain('ran');
      expect(r.status, f).not.toBe(0);
    }
  });

  it('FALSIFIER: the bundle cannot be read, so it cannot be copied out', () => {
    const r = run('/bin/cp', [pinned, path.join(root, 'stolen')]);
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(path.join(root, 'stolen'))).toBe(false);
    expect(run('/bin/cat', [path.join(root, 'bin', 'GnomonHelper.app', 'Contents', 'MacOS', 'gnomon-helper')]).stdout).toBe('');
  });

  it('every generated session profile carries the deny lines, last', () => {
    const sb = sessionProfileSbpl(
      { schemaVersion: 'gnomon-session-policy:v1', denyRead: [], allowRead: [], allowReadMetadata: [], denyReadAlways: [], denyWrite: [], denyLoopbackPorts: [], processInfo: 'allow', denyClasses: [], launchers: 'allow' } as never,
      { uid: 501, tmpdir: root, home: root, roots: [] },
    );
    const lines = sb.trimEnd().split('\n');
    expect(lines.slice(-2)).toEqual(helperDenySbpl());
  });
});
