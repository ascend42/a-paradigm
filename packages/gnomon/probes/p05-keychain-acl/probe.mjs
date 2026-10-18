// p05-keychain-acl — P05 / S29-02 (spec §19.1 M1.0 P05; §3.1 kernel key, §16
// custody row; K1, P8-D68; release gate (b)). FOUNDER-RUN for the dialog half.
//   node packages/gnomon/probes/run.mjs p05-keychain-acl --timeout 1800000
// Claims, as the table states them:
//   1. a helper-only (legacy, creator-ACL) item PROMPTS for
//      `security find-generic-password -w` — a prompt, not a block;
//   2. the helper run from a plain shell reads that item with no prompt —
//      this DISPROVES v3.4's design (any same-user shell can run the helper);
//   3. the helper under sandbox-exec refuses (P8-D68: never runs sandboxed);
//   4. an attacker-replaced item ⇒ INTEGRITY_BROKEN at start — the item's data
//      carries a signature by an SE custody key (no presence) that a same-user
//      attacker cannot produce;
//   5. the D68 design: a data-protection item in the entitlement-gated access
//      group SW4BMQ8PNL.gnomon is invisible to `security` and cannot be written
//      by an unsigned binary (-34018); only the signed kernel SEA obtains the
//      key over XPC — the XPC peer-requirement half needs the signed kernel SEA
//      (M1.1) and is recorded pending.
// Unattended (no TTY / GNOMON_PROBE_UNATTENDED=1): 3, 4 (forged item created
// with `security add-generic-password -A`, which raises no dialog) and 5.
// Interactive adds 1 and 2 (keychain dialogs). Every item and key it creates
// is deleted before it returns.
import { randomBytes } from 'node:crypto';
import { ACCESS_GROUP, APP_ID, IDENTITY, ask, buildHelper, checkIdentity, checkProfile, helper, interactive, prerequisiteFailure, run, say } from '../_shared/signing.mjs';

export const specRefs = ['§3.1 kernel key', '§16 custody row', '§19.1 M1.0 P05 / S29-02', 'K1', 'P8-D68', 'release gate (b)', 'G-ID-07'];

export default async function probe(ctx) {
  if (ctx.platform !== 'darwin') return { verdict: 'partial', evidence: { skipped: `${ctx.platform}: macOS probe; Windows custody is the Windows parity phase (P8-D78)` } };
  const identity = checkIdentity();
  const profile = checkProfile();
  const missing = [];
  if (!identity.present) missing.push(`signing identity "${IDENTITY}"`);
  if (!profile.present) missing.push('provisioning profile ~/.config/gnomon-signing/gnomon-helper.provisionprofile');
  else if (!profile.valid) missing.push(`a VALID provisioning profile (want ${APP_ID} with access group ${ACCESS_GROUP})`);
  if (missing.length) return prerequisiteFailure(missing, { identity, profile });

  const build = buildHelper({ embedProfile: true });
  if (build.steps.codesign?.status !== 0 || !build.steps.verifyStrict?.ok) return { verdict: 'fail', evidence: { build: build.steps, error: 'helper could not be signed / verified' } };
  const exe = build.exe;
  const r = randomBytes(4).toString('hex');
  const custody = `gnomon-p05-custody-${r}`;
  const svc = `gnomon-p05-${r}`;
  const acct = 'kernel-key';
  const ev = { build: { verifyStrict: build.steps.verifyStrict.ok, details: build.steps.details } };
  const cleanup = [];
  try {
    // 3. sandboxed refusal
    const sbx = run('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', exe, 'info']);
    let sbxJson = null;
    try { sbxJson = JSON.parse(sbx.stdout); } catch { /* none */ }
    ev.c3_sandboxedRefuses = { exit: sbx.status, json: sbxJson, ok: sbx.status === 3 && sbxJson?.error === 'SANDBOXED' };

    // custody key (SE, no presence — integrity anchor)
    ev.custodyKey = helper(exe, ['se-create', custody, 'custody']).json;
    cleanup.push(() => helper(exe, ['se-delete', custody]));

    // 5. data-protection item in the access group
    const dpSvc = `${svc}-dp`;
    ev.dpCreate = helper(exe, ['kc-create', dpSvc, acct, custody, 'dp']).json;
    cleanup.push(() => helper(exe, ['kc-delete', dpSvc, acct, 'dp']));
    ev.dpIntegrity = helper(exe, ['kc-integrity', dpSvc, acct, custody, 'dp']).json;
    const cli = run('/usr/bin/security', ['find-generic-password', '-s', dpSvc, '-a', acct], { timeout: 20_000 });
    ev.dpInvisibleToSecurityCli = { exit: cli.status, timedOut: cli.timedOut, ok: cli.status === 44 };
    const unsignedDp = helper(build.unsigned, ['kc-create', `${svc}-dp-attacker`, acct, custody, 'dp']);
    ev.unsignedCannotUseGroup = { json: unsignedDp.json, ok: unsignedDp.json?.ok === false };
    ev.c5_dataProtectionGated = ev.dpCreate?.ok === true && ev.dpIntegrity?.integrity === 'OK' && ev.dpInvisibleToSecurityCli.ok && ev.unsignedCannotUseGroup.ok;
    ev.c5_xpcPeerRequirement = 'pending: needs the Developer-ID-signed kernel SEA (M1.1) as the only accepted XPC peer';

    // 4. attacker-planted legacy item (any-app ACL ⇒ no dialog) ⇒ INTEGRITY_BROKEN
    const fake = `${svc}-forged`;
    const add = run('/usr/bin/security', ['add-generic-password', '-s', fake, '-a', acct, '-w', randomBytes(16).toString('hex'), '-A'], { timeout: 20_000 });
    cleanup.push(() => run('/usr/bin/security', ['delete-generic-password', '-s', fake, '-a', acct], { timeout: 20_000 }));
    const integ = helper(exe, ['kc-integrity', fake, acct, custody], { timeout: 20_000 });
    ev.c4_forgedItem = { added: add.status === 0, helper: integ.json, timedOut: integ.timedOut, ok: integ.json?.integrity === 'INTEGRITY_BROKEN' };

    const unattendedOk = ev.c3_sandboxedRefuses.ok && ev.c4_forgedItem.ok && ev.c5_dataProtectionGated;
    if (!interactive()) {
      ev.pendingFounder = 'claims 1 and 2 raise keychain dialogs: run in a terminal: node packages/gnomon/probes/run.mjs p05-keychain-acl --timeout 1800000';
      return { verdict: unattendedOk ? 'partial' : 'fail', evidence: ev };
    }

    // 1 + 2: helper-only legacy item
    const hsvc = `${svc}-helper-only`;
    ev.helperOnlyCreate = helper(exe, ['kc-create', hsvc, acct, custody]).json;
    cleanup.push(() => helper(exe, ['kc-delete', hsvc, acct]));
    say('P05 keychain dialog test.');
    await ask(`STEP 1. Press Enter. The probe runs "security find-generic-password -w" on a helper-only item.
A keychain dialog should appear saying "security wants to use your confidential information stored in \\"${hsvc}\\"".
Click DENY (not Allow, not Always Allow).`);
    const sec = run('/usr/bin/security', ['find-generic-password', '-s', hsvc, '-a', acct, '-w'], { timeout: 180_000 });
    const sawDialog = await ask('STEP 2. Did that keychain dialog appear? Type y or n.');
    ev.c1_securityPrompts = { exit: sec.status, gotData: sec.status === 0, founderSawDialog: /^y/i.test(sawDialog), ok: /^y/i.test(sawDialog) && sec.status !== 0 };
    await ask('STEP 3. Press Enter. The probe now runs the signed helper from this plain shell to read the same item. Do NOT click anything; just watch whether a dialog appears.');
    const hr = helper(exe, ['kc-read', hsvc, acct], { timeout: 60_000 });
    const sawDialog2 = await ask('STEP 4. Did ANY dialog appear while the helper read the item? Type y or n.');
    ev.c2_helperReadsFromPlainShell = { helper: hr.json, timedOut: hr.timedOut, founderSawDialog: /^y/i.test(sawDialog2), disprovesV34: hr.json?.ok === true && !/^y/i.test(sawDialog2) };
    const all = unattendedOk && ev.c1_securityPrompts.ok && ev.c2_helperReadsFromPlainShell.helper?.ok === true;
    return { verdict: all ? 'pass' : 'fail', evidence: ev };
  } finally {
    ev.cleanup = cleanup.reverse().map((f) => {
      const x = f();
      return x.json?.ok ?? x.status;
    });
  }
}
