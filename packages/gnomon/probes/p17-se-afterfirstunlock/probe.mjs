// p17-se-afterfirstunlock — S0 P3 (TD-2026-10-29-746: the helper's permanent kernel-cert key). FOUNDER-RUN.
//   node packages/gnomon/probes/run.mjs p17-se-afterfirstunlock --timeout 900000
// Claims (no Touch ID, no prompt):
//   a. the signed helper-shaped binary (.app, bundle id gnomon.probe, embedded profile, hardened runtime, Developer
//      ID, keychain-access-groups [SW4BMQ8PNL.gnomon.probe]) creates a PERMANENT Secure Enclave P-256 key in that group
//      with kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly and .privateKeyUsage only, reads back accessibility
//      `cku` (AfterFirstUnlockThisDeviceOnly), and signs with it from a second process run;
//   b. a DIFFERENT binary signed by the same Developer ID with the hardened runtime but WITHOUT the entitlement
//      cannot use it (errSecMissingEntitlement -34018 or errSecItemNotFound -25300), nor can an ad-hoc copy.
// Group: SW4BMQ8PNL.gnomon.probe, NOT SW4BMQ8PNL.gnomon.prod as the S0 brief named (Aegis H1: a probe binary
// entitled to the production group could read production keys). The entitlement mechanism is identical; the tool
// refuses any other group or tag.
// Needs the Developer ID and ~/.config/gnomon-signing/gnomon-helper.provisionprofile; without them (or with
// GNOMON_PROBE_ADHOC=1) it records `partial` with evidence.blocked "prerequisites" and creates nothing.
import { copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { onAbort } from '../_shared/abort.mjs';
import { buildProbeApp, buildTool, checkProfile, json, PROBE_GROUP, rmSync, signBare, signingAvailable, workDir } from '../_shared/kernel-probe.mjs';
import { prerequisiteFailure } from '../_shared/signing.mjs';

export const specRefs = ['P8-D68', 'TD-2026-10-29-746 S0 P3', 'G-ID-12'];

export default async function probe(ctx) {
  if (ctx.platform !== 'darwin') return { verdict: 'partial', evidence: { skipped: `${ctx.platform}: Secure Enclave is macOS` } };
  const s = signingAvailable();
  const profile = s.signed ? checkProfile() : { present: false };
  const missing = [];
  if (!s.signed) missing.push(`Developer ID signing (${s.why})`);
  else if (!profile.present || !profile.valid) missing.push('a valid provisioning profile ~/.config/gnomon-signing/gnomon-helper.provisionprofile granting SW4BMQ8PNL.gnomon.probe');
  if (missing.length) return prerequisiteFailure(missing, { profile });
  const dir = workDir('p17');
  const tag = `gnomon-p17-${randomBytes(4).toString('hex')}`;
  let appExe = null;
  const done = onAbort(() => {
    const del = appExe ? json(appExe, ['se-perm-delete', tag, PROBE_GROUP]).json : null;
    rmSync(dir, { recursive: true, force: true });
    return del;
  }, ctx.signal);
  const evidence = { group: PROBE_GROUP, tag, profile };
  try {
    const tool = buildTool(dir);
    appExe = buildProbeApp(dir, tool).exe;
    const other = path.join(dir, 'kernel-probe-other');
    copyFileSync(tool, other);
    signBare(other, 'gnomon.probe.other', true);
    const adhoc = path.join(dir, 'kernel-probe-adhoc');
    copyFileSync(tool, adhoc);
    evidence.create = json(appExe, ['se-perm-create', tag, PROBE_GROUP]).json;
    evidence.signAgain = json(appExe, ['se-perm-sign', tag, PROBE_GROUP]).json;
    evidence.otherSigned = json(other, ['se-perm-sign', tag, PROBE_GROUP]).json;
    evidence.adhoc = json(adhoc, ['se-perm-sign', tag, PROBE_GROUP]).json;
    const refused = (r) => r?.ok === false && [-34018, -25300].includes(r?.status);
    const claims = {
      a_created: evidence.create?.ok === true && evidence.create?.use?.signed === true,
      a_afterFirstUnlock: evidence.create?.accessible === 'cku',
      a_signsFromSecondRun: evidence.signAgain?.ok === true,
      b_otherSignedBinaryRefused: refused(evidence.otherSigned),
      b_adhocRefused: refused(evidence.adhoc),
    };
    evidence.claims = claims;
    const all = Object.values(claims).every(Boolean);
    const line = `P3 ${all ? 'PASS' : 'FAIL'}: ${Object.entries(claims).map(([k, v]) => `${k}=${v}`).join(' ')}`;
    process.stderr.write(`${line}\n`);
    evidence.summary = line;
    return { verdict: all ? 'pass' : 'fail', evidence };
  } finally {
    evidence.cleanup = done();
  }
}
