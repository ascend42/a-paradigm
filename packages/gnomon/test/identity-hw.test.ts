// @gnomon-platform: darwin
/**
 * #identity M1.3 slice 1 — the REAL signed helper and Secure Enclave
 * (founder-run; Touch ID prompts). Never in CI: needs the Developer-ID-signed
 * GnomonHelper.app (node packages/gnomon-helper/scripts/build-darwin.mjs) and
 * a human at the keyboard. Opt in explicitly:
 *
 *   GNOMON_HW_TESTS=1 npx vitest run test/identity-hw.test.ts      (in packages/gnomon)
 *
 * Run it BEFORE `gnomon identity init` (the helper refuses a new key generation
 * while another exists). Each prompt shows the test's text, then the helper's
 * own line `Gnomon Helper: <key> key signs <n>: <digest>…`.
 * Expect THREE Touch ID / password prompts, each naming Gnomon:
 *   1. "Gnomon HW test 1/3: approve and keep the unlock" (approvals, fresh)
 *   2. "Gnomon HW test 2/3: …root key…" (root, fresh)
 *   3. "Gnomon HW test 3/3: decline this one" — press CANCEL
 * The cached sign between 1 and 2 must raise NO prompt (P04 claim c).
 * Temporary keys use a random generation and are deleted at the end.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultHelperPath } from '../src/cli/identity-cli.js';
import {
  HardwarePresenceDenied,
  HardwareRootAuthority,
  HelperApprovalsKey,
  HelperProcess,
  helperOnceSync,
  p256FromX963,
  pemOf,
  pinHelper,
} from '../src/kernel/identity/index.js';
import { approveMessage, signaturePreimage } from '../src/kernel/log/signer.js';

const HW = process.env.GNOMON_HW_TESTS === '1';
const T = 300_000;

describe.runIf(HW)('real helper + Secure Enclave (GNOMON_HW_TESTS=1)', () => {
  it(
    'pins the signed helper; unattended ops; fresh → cached → dropped approvals; root per-signature presence; declined prompt',
    async () => {
      const pin = pinHelper(defaultHelperPath());
      const h = HelperProcess.start(pin);
      const gen = Array.from(randomBytes(10), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
      try {
        const info = await h.request({ op: 'info' });
        expect(info.signing).toEqual({ identifier: 'gnomon.helper', team: 'SW4BMQ8PNL' });
        // round 2 (H2): the helper refuses a new generation while another exists, so run this BEFORE `gnomon identity init`
        const held = (await h.request({ op: 'key.list' })).keys as unknown[];
        if (held.length) throw new Error(`the Secure Enclave already holds Gnomon keys (${JSON.stringify(held)}): run this test before gnomon identity init, or purge them`);
        // domain guards in the helper (no key needed, no prompt): the root never signs presence; cached never signs presence
        await expect(h.request({ op: 'sign', key: 'root', gen, mode: 'fresh', reason: 'x', messages: [signaturePreimage('presence', 'x').toString('base64')] })).rejects.toMatchObject({ code: 'domain-refused' });
        await expect(h.request({ op: 'sign', key: 'approvals', gen, mode: 'cached', connId: 'conn:HW', messages: [signaturePreimage('presence', 'x').toString('base64')] })).rejects.toMatchObject({ code: 'domain-refused' });
        await expect(h.request({ op: 'sign', key: 'approvals', gen, mode: 'fresh', reason: 'x', messages: [signaturePreimage('row', 'x').toString('base64')] })).rejects.toMatchObject({ code: 'domain-refused' });
        const root = pemOf(p256FromX963(String((await h.request({ op: 'key.create', key: 'root', gen })).publicKey)));
        const appr = pemOf(p256FromX963(String((await h.request({ op: 'key.create', key: 'approvals', gen })).publicKey)));
        await expect(h.request({ op: 'key.create', key: 'root', gen })).rejects.toMatchObject({ code: 'exists' });

        const human = 'p:abcdefgh/founder';
        const ak = new HelperApprovalsKey({ gen, approvalsPublicKeyPem: appr }, human, h);
        const m1 = approveMessage({ cardId: 'card:HW1', decision: 'allow', cardContentHash: 'sha256:00', approverPrincipalId: human });
        const bind = { action: 'approval.decide', cardId: 'card:HW1', contentHash: 'sha256:00', decision: 'allow' };
        const fresh = await ak.signDecision({ connId: 'conn:HW', approver: human, message: m1, mode: 'fresh', prompt: 'Gnomon HW test 1/3: approve and keep the unlock', keepUnlock: true, presence: { purpose: 'approval.decide', binding: bind } });
        expect(fresh.kept).toBe(true);
        expect(fresh.token?.method).toBe('helper-se');
        const m2 = approveMessage({ cardId: 'card:HW2', decision: 'deny', cardContentHash: 'sha256:01', approverPrincipalId: human });
        const t0 = Date.now();
        const cached = await ak.signDecision({ connId: 'conn:HW', approver: human, message: m2, mode: 'cached' });
        expect(ak.verify(human, m2, cached.decisionSig)).toBe('ok');
        expect(Date.now() - t0).toBeLessThan(5_000); // no prompt
        await expect(ak.signDecision({ connId: 'conn:OTHER', approver: human, message: m2, mode: 'cached' })).rejects.toThrow(/no unlock/);
        await ak.dropUnlock('conn:HW');
        await expect(ak.signDecision({ connId: 'conn:HW', approver: human, message: m2, mode: 'cached' })).rejects.toThrow(/no unlock/);

        const ra = new HardwareRootAuthority({ gen, rootPublicKeyPem: root }, { helper: h, once: helperOnceSync(pin) });
        const row = { schemaVersion: 'gnomon-hw-test:v1', gen, note: 'Gnomon HW test 2/3' };
        const s = await ra.signRowAsync(row);
        expect(ra.verifyRow(s.signer, row, s.sig)).toBe(true);

        await expect(ak.signDecision({ connId: 'conn:HW3', approver: human, message: m1, mode: 'fresh', prompt: 'Gnomon HW test 3/3: decline this one (press Cancel)', presence: { purpose: 'approval.decide', binding: bind } })).rejects.toBeInstanceOf(HardwarePresenceDenied);
      } finally {
        await h.request({ op: 'key.delete', key: 'approvals', gen }).catch(() => undefined);
        await h.request({ op: 'key.delete', key: 'root', gen }).catch(() => undefined);
        await h.close();
      }
    },
    T,
  );
});

describe.skipIf(HW)('real helper + Secure Enclave', () => {
  it.todo('needs the founder: Touch ID and the Developer-ID-signed helper cannot run in CI — set GNOMON_HW_TESTS=1 on the founder\'s Mac');
});
