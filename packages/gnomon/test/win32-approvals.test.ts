// @gnomon-platform: win32
/**
 * W4 phase A (docs/plans/gnomon-windows.md, TD-2026-10-22-278): the dev approvals key on Windows, against the real
 * gnomon-helper (approvals.rs, Microsoft Software KSP) and the real dev root. Falsifiers: the first run creates the key
 * and a root-signed binding, a rerun reopens it, a binding for another human or a re-pointed key is refused, a click
 * signature verifies against the bound key, and a fresh (presence) sign is refused until Windows Hello (phase B).
 * Every CNG key a test creates is deleted afterwards.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { provisionDevHome } from '../src/cli/dev-home.js';
import { approveMessage } from '../src/kernel/log/signer.js';
import { HelperRefusal } from '../src/kernel/identity/helper.js';
import { clearVerifiedRootsForTests } from '../src/platform/owner-only.js';
import { DEV_APPROVALS_FILE, ensureDevApprovals, win32HelperTransport } from '../src/platform/win32/approvals.js';
import { pinWin32Helper } from '../src/platform/win32/helper-client.js';
import { tempHome } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';

const HELPER = path.resolve(PKG_ROOT, '..', 'gnomon-helper', 'bin', 'win32', 'gnomon-helper.exe');
const built = fs.existsSync(HELPER);
if (!built && process.env.CI) throw new Error(`the win32 helper is not built at ${HELPER}`);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  clearVerifiedRootsForTests();
  while (cleanups.length) await cleanups.pop()!();
});

function devHome() {
  const t = tempHome('gwa-');
  cleanups.push(t.cleanup);
  const userHome = fs.realpathSync.native(path.dirname(t.home));
  const home = path.join(userHome, 'devhome');
  return provisionDevHome(home, { userHome, host: 'win-test' }).loaded;
}

function dropKey(home: string): void {
  try {
    const gen = JSON.parse(fs.readFileSync(path.join(home, DEV_APPROVALS_FILE), 'utf8')).row.gen as string;
    execFileSync('certutil', ['-user', '-csp', 'Microsoft Software Key Storage Provider', '-delkey', `gnomon-${gen}-approvals`], { stdio: 'ignore' });
  } catch {
    // no record (the test failed before the create) or already gone
  }
}

(built ? describe : describe.skip)('W4 phase A: the dev approvals key on Windows (real helper, real CNG)', () => {
  it('creates + binds on the first run, reopens on the next; a click signature verifies; fresh is refused', async () => {
    const dev = devHome();
    const transport = win32HelperTransport(pinWin32Helper(HELPER));
    cleanups.push(() => transport.close());
    cleanups.push(() => dropKey(dev.home));
    const first = await ensureDevApprovals(dev.home, dev.root, dev.device.principalId, transport);
    expect(first.created).toBe(true);
    expect(first.approvals.clickClass).toBe(true);
    const again = await ensureDevApprovals(dev.home, dev.root, dev.device.principalId, transport);
    expect(again.created).toBe(false);
    expect(again.approvals.keyId).toBe(first.approvals.keyId);

    const message = approveMessage({ cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ', decision: 'allow', cardContentHash: `sha256:${'a'.repeat(64)}`, approverPrincipalId: dev.device.principalId });
    const r = await again.approvals.signDecision({ connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', approver: dev.device.principalId, message, mode: 'click' });
    expect(again.approvals.verify(dev.device.principalId, message, r.decisionSig)).toBe('ok');
    expect(r.token).toBeNull();

    const gen = JSON.parse(fs.readFileSync(path.join(dev.home, DEV_APPROVALS_FILE), 'utf8')).row.gen as string;
    const fresh = await transport.request({ op: 'sign', key: 'approvals', gen, mode: 'fresh', messages: [Buffer.from('x').toString('base64')] }).catch((e: unknown) => e);
    expect(fresh).toBeInstanceOf(HelperRefusal);
    expect((fresh as HelperRefusal).code).toBe('presence-unavailable');
  });

  it('refuses a binding for another human, and a record whose key the helper does not hold', async () => {
    const dev = devHome();
    const transport = win32HelperTransport(pinWin32Helper(HELPER));
    cleanups.push(() => transport.close());
    cleanups.push(() => dropKey(dev.home));
    await ensureDevApprovals(dev.home, dev.root, dev.device.principalId, transport);
    await expect(ensureDevApprovals(dev.home, dev.root, 'p:abcdefgh/eve', transport)).rejects.toThrow(/not this root's binding/);
    // re-point the record at a gen the helper has no key for: the signature no longer verifies either way
    const file = path.join(dev.home, DEV_APPROVALS_FILE);
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    const tampered = { ...rec, row: { ...rec.row, gen: 'nope-0000' } };
    fs.writeFileSync(file, JSON.stringify(tampered));
    await expect(ensureDevApprovals(dev.home, dev.root, dev.device.principalId, transport)).rejects.toThrow(/not this root's binding/);
    fs.writeFileSync(file, JSON.stringify(rec)); // restore so the cleanup deletes the real key
  });
});
