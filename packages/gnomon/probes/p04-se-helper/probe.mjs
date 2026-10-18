// p04-se-helper — P04 / S29-01 (spec §19.1 M1.0 P04; §3.1 root/approvals keys,
// cached unlock; K2, K5). FOUNDER-RUN for the Touch ID half.
//   node packages/gnomon/probes/run.mjs p04-se-helper --timeout 1800000
// Claims:
//   a. a `.app`-bundled helper (bundle id gnomon.helper, hardened runtime,
//      embedded Developer ID provisioning profile, Developer ID signature) can
//      create a Secure Enclave P-256 key (kSecAttrTokenIDSecureEnclave, access
//      group SW4BMQ8PNL.gnomon, .privateKeyUsage + .userPresence);
//   b. the same code UNSIGNED gets errSecMissingEntitlement (-34018) or
//      errSecItemNotFound (-25300);
//   c. one evaluated LAContext signs N times with no further prompt
//      (interactionNotAllowed is set after the touch, so a prompt would fail
//      instead of showing); after invalidate() it cannot sign; a fresh context
//      prompts again;
//   d. a 300-character localizedReason: where macOS truncates it and whether
//      the dialog names the app (founder reports).
// Unattended (no TTY, or GNOMON_PROBE_UNATTENDED=1): a + b only — creating a
// presence-protected key raises no prompt — then the key is deleted; verdict
// partial with the Touch ID half pending. Source: _shared/helper/ProbeHelper.swift,
// build recipe: _shared/signing.mjs buildHelper().
import { randomBytes } from 'node:crypto';
import { onAbort } from '../_shared/abort.mjs';
import { ACCESS_GROUP, APP_ID, IDENTITY, ask, bindSignal, buildHelper, checkIdentity, checkProfile, helper, interactive, prerequisiteFailure, run, say } from '../_shared/signing.mjs';

export const specRefs = ['§3.1', '§3.4 prompt text', '§16 keys row', '§19.1 M1.0 P04 / S29-01', 'K2', 'K5', 'P8-D68', 'G-ID-01', 'G-ID-06'];

const N = 20;
// Exactly 300 characters; the trailing numbered marks let the founder say
// where the dialog cut the text.
function reason300() {
  let s = 'approve merge of contract C-1042 into main for project a-paradigm, at most 40k tokens, requested by session s:7f3a from the GUI on this Mac. Check that this matches what you just asked for; if it does not, cancel. Marks:';
  for (let i = 1; s.length < 300; i++) s += ` m${String(i).padStart(2, '0')}`;
  return s.slice(0, 300);
}

export default async function probe(ctx) {
  if (ctx.platform !== 'darwin') return { verdict: 'partial', evidence: { skipped: `${ctx.platform}: macOS probe; the Windows key probe is P02 (Windows parity phase, P8-D78)` } };
  const identity = checkIdentity();
  const profile = checkProfile();
  const missing = [];
  if (!identity.present) missing.push(`signing identity "${IDENTITY}"`);
  if (!profile.present) missing.push('provisioning profile ~/.config/gnomon-signing/gnomon-helper.provisionprofile');
  else if (!profile.valid) missing.push(`a VALID provisioning profile (want ${APP_ID} with access group ${ACCESS_GROUP} or ${APP_ID.split('.')[0]}.*, unexpired)`);
  if (missing.length) return prerequisiteFailure(missing, { identity, profile });

  bindSignal(ctx.signal);
  const build = buildHelper({ embedProfile: true });
  const evidence = { identity, profile, build: build.steps };
  const exe = build.exe;
  const tag = `gnomon-p04-${randomBytes(4).toString('hex')}`;
  // Runs on return, Ctrl-C/SIGTERM and the harness timeout: SE keys + temp build dir.
  const done = onAbort(() => {
    const out = { signed: helper(exe, ['se-delete', tag]).json?.ok ?? false, unsigned: helper(build.unsigned, ['se-delete', `${tag}-unsigned`]).json?.ok ?? false };
    build.remove();
    return out;
  }, ctx.signal);
  try {
    return await body();
  } finally {
    evidence.cleanup = done();
  }

  async function body() {
  if (build.steps.codesign?.status !== 0 || !build.steps.verifyStrict?.ok) {
    return { verdict: 'fail', evidence: { ...evidence, error: 'helper could not be signed / verified' } };
  }
  evidence.info = helper(exe, ['info']).json;
  evidence.unsignedCreate = helper(build.unsigned, ['se-create', `${tag}-unsigned`, 'presence']);
  evidence.signedCreate = helper(exe, ['se-create', tag, 'presence']);
  const unsignedRefused = evidence.unsignedCreate.json?.ok === false && [-34018, -25300].includes(evidence.unsignedCreate.json?.code);
  const signedOk = evidence.signedCreate.json?.ok === true;
  evidence.claims = { a_signedHelperCreatesSeKey: signedOk, b_unsignedRefused: unsignedRefused, b_unsignedCode: evidence.unsignedCreate.json?.code ?? null };

  if (!interactive() || !signedOk) {
    evidence.pendingFounder = 'c (one LAContext signs N times, invalidate, fresh prompt) and d (300-character reason) need Touch ID: run in a terminal: node packages/gnomon/probes/run.mjs p04-se-helper --timeout 1800000';
    return { verdict: signedOk && unsignedRefused ? 'partial' : 'fail', evidence, toolVersions: { xcode: run('/usr/bin/xcodebuild', ['-version']).stdout.split('\n')[0] } };
  }

  const reason = reason300();
  say('P04 Touch ID test. Two Touch ID dialogs will appear, one after the other.');
  await ask(`STEP 1. Press Enter. A Touch ID dialog appears. READ its text carefully (note the last mark you can see, e.g. "m07"), then APPROVE it with Touch ID.
After that the helper signs ${N} times with no dialog, then forgets the approval, and a SECOND dialog appears: APPROVE that one too.`);
  const signRun = helper(exe, ['se-sign', tag, String(N), reason], { timeout: 300_000 });
  evidence.seSign = signRun.json ?? signRun;
  const second = await ask('STEP 2. Did a SECOND Touch ID dialog appear after the first one? Type y or n.');
  const cut = await ask('STEP 3. In the FIRST dialog, what were the last few words (or the last "mNN" mark) you could read? Type them exactly, or "all" if the whole text including the marks was shown.');
  const appName = await ask('STEP 4. Did the dialog name an app (for example "Gnomon Helper" or "Terminal")? Type the name, or "none".');
  evidence.founder = { secondDialogSeen: /^y/i.test(second), lastVisibleText: cut, appNameShown: appName, reasonChars: reason.length };
  const s = evidence.seSign;
  evidence.claims.c_reuse = s?.reuse?.signedWithoutPrompt === N;
  evidence.claims.c_invalidateStops = s?.afterInvalidate?.signed === false;
  evidence.claims.c_freshPrompts = s?.freshContext?.signed === true && evidence.founder.secondDialogSeen;
  const all = signedOk && unsignedRefused && evidence.claims.c_reuse && evidence.claims.c_invalidateStops && evidence.claims.c_freshPrompts;
  return { verdict: all ? 'pass' : 'fail', evidence, toolVersions: { xcode: run('/usr/bin/xcodebuild', ['-version']).stdout.split('\n')[0] } };
  }
}
