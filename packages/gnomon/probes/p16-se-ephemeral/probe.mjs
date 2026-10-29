// p16-se-ephemeral — S0 P2 (TD-2026-10-29-746: the click key is ephemeral, non-permanent, in the Secure Enclave).
//   node packages/gnomon/probes/run.mjs p16-se-ephemeral
// Claims (no Touch ID, no prompt):
//   a. a Secure Enclave P-256 key with kSecAttrIsPermanent false, .privateKeyUsage only (no user presence),
//      AfterFirstUnlockThisDeviceOnly, can be created and signs (and the signature verifies);
//   b. it is never in the keychain: a lookup by its label finds nothing, in the creating process and in a second
//      process after the first exited;
//   c. FINDING (recorded, not gating): whether the key's token blob ("toid") is exposed and can be re-loaded by a
//      SECOND process (CryptoKit dataRepresentation). If it can, "disappears on exit" holds only while the blob never
//      leaves the process: S4's helper must never write or send it.
// Runs the tool ad-hoc (no entitlement) and, when the Developer ID is available, also Developer ID signed with the
// hardened runtime and no entitlements. pass = a + b for every variant run; GNOMON_PROBE_ADHOC=1 runs ad-hoc only
// (still pass/fail: nothing here needs our signature).
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { onAbort } from '../_shared/abort.mjs';
import { buildTool, json, rmSync, signBare, signingAvailable, workDir } from '../_shared/kernel-probe.mjs';

export const specRefs = ['P8-D68', 'TD-2026-10-29-746 S0 P2', 'G-ID-12'];

export default async function probe(ctx) {
  if (ctx.platform !== 'darwin') return { verdict: 'partial', evidence: { skipped: `${ctx.platform}: Secure Enclave is macOS` } };
  const s = signingAvailable();
  const dir = workDir('p16');
  const done = onAbort(() => rmSync(dir, { recursive: true, force: true }), ctx.signal);
  try {
    const tool = buildTool(dir);
    const variants = [{ name: 'adhoc', exe: tool }];
    if (s.signed) {
      const signed = path.join(dir, 'kernel-probe-signed');
      copyFileSync(tool, signed);
      signBare(signed, 'gnomon.probe.p16', true);
      variants.push({ name: 'developer-id', exe: signed });
    }
    const results = {};
    let all = true;
    for (const v of variants) {
      const blob = path.join(dir, `${v.name}.toid`);
      const made = json(v.exe, ['se-ephemeral', blob]).json;
      const later = made?.label ? json(v.exe, ['se-lookup', made.label]).json : null;
      const reimport = existsSync(blob) ? json(v.exe, ['se-reimport', blob]).json : null;
      const claims = {
        a_createdAndSigned: made?.ok === true && made?.use?.signed === true && made?.use?.verified === true,
        b_notInKeychain: made?.lookupDataProtection === -25300 && made?.lookupLegacy === -25300 && later?.lookupDataProtection === -25300 && later?.lookupLegacy === -25300,
      };
      all &&= claims.a_createdAndSigned && claims.b_notInKeychain;
      results[v.name] = { made, later, finding_c_tokenBlobReimportable: reimport, claims };
      rmSync(blob, { force: true });
    }
    const reimportable = Object.values(results).some((r) => r.finding_c_tokenBlobReimportable?.reimported === true);
    const line = `P2 ${all ? 'PASS' : 'FAIL'}: ${Object.entries(results).map(([k, r]) => `${k}: created+signed=${r.claims.a_createdAndSigned} notInKeychain=${r.claims.b_notInKeychain}`).join('; ')}; finding: token blob re-loadable by a second process = ${reimportable}`;
    process.stderr.write(`${line}\n`);
    return { verdict: all ? 'pass' : 'fail', evidence: { signed: s.signed, signingNote: s.why ?? null, results, summary: line } };
  } finally {
    done();
  }
}
