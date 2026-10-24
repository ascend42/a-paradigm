// @gnomon-platform: darwin, linux
/**
 * PR #52 review blocker 3: the device key's owner-only check is STRICT on every platform (platform/owner-only.ts
 * isOwnerOnly {strict}): a key file with more than one hard link is refused even at mode 0600. Intended: a second
 * link is a second path to the private key that the home's checks do not cover (it may sit outside the home, under
 * another directory's mode), so the key must have exactly one name. The win32 side (DACL read-back, nlink) is covered
 * by test/win32-helper.test.ts.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceKeyError, deviceKeyPath, loadDeviceCredential, writeNewDeviceKey } from '../src/kernel/identity/index.js';
import { privateTmpRoot } from './daemon-helpers.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('device key: exactly one link (strict owner-only, darwin and linux)', () => {
  it('a 0600 key with a second hard link is refused; the same key with one link loads', () => {
    const home = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), 'dkl-')));
    dirs.push(home);
    writeNewDeviceKey(home);
    const key = deviceKeyPath(home);
    expect(fs.statSync(key).mode & 0o777).toBe(0o600);
    expect(() => loadDeviceCredential(home)).not.toThrow();
    const other = path.join(home, 'elsewhere.pem');
    fs.linkSync(key, other);
    expect(fs.statSync(key).nlink).toBe(2);
    expect(() => loadDeviceCredential(home)).toThrow(DeviceKeyError);
    fs.unlinkSync(other);
    expect(() => loadDeviceCredential(home)).not.toThrow();
  });
});
