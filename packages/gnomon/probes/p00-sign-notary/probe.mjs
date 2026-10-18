// p00-sign-notary — P00 (spec §19.1 M1.0 P00; OPEN 1, P8-D70). FOUNDER-RUN.
// Claim: the founder's Developer ID identity signs a Swift stub that passes
// `codesign --verify --strict`, and `xcrun notarytool history
// --keychain-profile gnomon-notary` answers.
//   node packages/gnomon/probes/run.mjs p00-sign-notary
// Optional: P00_SUBMIT=1 also notarizes the stub (zip, `notarytool submit
// --wait`, `stapler staple`) — a few minutes, needs network.
// Fails fast with a prerequisite message when the identity or the notary
// profile is missing. No prompts: if codesign raises a keychain dialog for the
// signing key, click "Always Allow" (that is codesign reaching its own key).
import path from 'node:path';
import { IDENTITY, NOTARY_PROFILE, buildHelper, checkIdentity, checkNotary, checkProfile, prerequisiteFailure, run } from '../_shared/signing.mjs';

export const specRefs = ['§19.1 M1.0 P00', 'OPEN 1', 'P8-D70', 'G-HLP-01'];

export default async function probe(ctx) {
  if (ctx.platform !== 'darwin') return { verdict: 'partial', evidence: { skipped: `${ctx.platform}: macOS signing probe; Windows signing (Azure Trusted Signing, P8-D72) is the Windows parity phase` } };
  const identity = checkIdentity();
  const notary = checkNotary();
  const profile = checkProfile();
  const missing = [];
  if (!identity.present) missing.push(`signing identity "${IDENTITY}"`);
  if (!notary.present) missing.push(`notary keychain profile "${NOTARY_PROFILE}"`);
  if (missing.length) return prerequisiteFailure(missing, { identity, notary, helperProfileInfo: { present: profile.present, valid: profile.valid } });

  const build = buildHelper({ embedProfile: false });
  const evidence = { identity, notary: { answered: notary.answered, submissions: notary.submissions }, stub: build.steps };
  if (process.env.P00_SUBMIT === '1' && build.steps.verifyStrict?.ok) {
    const zip = path.join(build.dir, 'stub.zip');
    run('/usr/bin/ditto', ['-c', '-k', '--keepParent', build.app, zip]);
    const t = Date.now();
    const sub = run('/usr/bin/xcrun', ['notarytool', 'submit', zip, '--keychain-profile', NOTARY_PROFILE, '--wait', '--output-format', 'json'], { timeout: 1_800_000 });
    let parsed = null;
    try {
      parsed = JSON.parse(sub.stdout);
    } catch {
      // error text
    }
    const staple = run('/usr/bin/xcrun', ['stapler', 'staple', build.app]);
    const sp = run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '-vv', build.app]);
    evidence.notarize = { status: parsed?.status ?? null, id: parsed?.id ?? null, ms: Date.now() - t, error: sub.status === 0 ? undefined : (sub.stderr || sub.stdout).slice(0, 300), stapled: staple.status === 0, spctlAfter: sp.stderr.slice(0, 300) };
  } else evidence.notarize = 'not requested (set P00_SUBMIT=1)';
  const ok = build.steps.codesign?.status === 0 && build.steps.verifyStrict?.ok && notary.answered;
  return { verdict: ok ? 'pass' : 'fail', evidence, toolVersions: { xcode: run('/usr/bin/xcodebuild', ['-version']).stdout.split('\n')[0] } };
}
