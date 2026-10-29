// p15-sea-peertoken — S0 P1 (TD-2026-10-29-746; spec P8-D68 amended, G-ID-13). FOUNDER-RUN for the signed half.
//   node packages/gnomon/probes/run.mjs p15-sea-peertoken --timeout 900000
// Claims:
//   a. a helper spawned as a stdio child of a SEA over libuv pipes sees a unix-domain SOCKET on stdin (libuv uses
//      socketpairs for stdio pipes on macOS);
//   b. it can read the peer's audit token with getsockopt(SOL_LOCAL, LOCAL_PEERTOKEN) and the token's pid is the SEA;
//   c. SecCodeCheckValidity on that token passes
//      `identifier "gnomon.kernel.probe" and anchor apple generic and certificate leaf[subject.OU] = SW4BMQ8PNL`
//      (the kernel requirement shape, with the probe identifier: Aegis H1, a probe binary never passes as the kernel);
//   d. the same check FAILS for the pinned plain `node` running the same script (its signature is not ours), and the
//      production requirement (identifier "gnomon.kernel") fails for the probe SEA.
// The probe SEA is built by scripts/build-sea.mjs's own pipeline (same pinned node, sea-config, hardened runtime).
// No identity, or GNOMON_PROBE_ADHOC=1: everything ad-hoc, the requirement is the identifier only → `partial`
// (the mechanism a, b, d measured; the anchor and team in c pending the founder's signed run).
import path from 'node:path';
import { onAbort } from '../_shared/abort.mjs';
import { buildProbeSea, buildTool, json, PROBE_SEA_IDENTIFIER, rmSync, signingAvailable, workDir } from '../_shared/kernel-probe.mjs';
import { TEAM } from '../_shared/signing.mjs';

export const specRefs = ['P8-D68', 'TD-2026-10-29-746 S0 P1', 'G-ID-13'];

export default async function probe(ctx) {
  if (ctx.platform !== 'darwin') return { verdict: 'partial', evidence: { skipped: `${ctx.platform}: LOCAL_PEERTOKEN and SecCode are macOS` } };
  const s = signingAvailable();
  const dir = workDir('p15');
  const done = onAbort(() => rmSync(dir, { recursive: true, force: true }), ctx.signal);
  try {
    const tool = buildTool(dir);
    const { sea, baseNode, built } = await buildProbeSea(dir, path.join(ctx.probeDir, 'probe-main.cjs'), s.signed);
    const want = s.signed ? `identifier "${PROBE_SEA_IDENTIFIER}" and anchor apple generic and certificate leaf[subject.OU] = ${TEAM}` : `identifier "${PROBE_SEA_IDENTIFIER}"`;
    const kernelReq = `identifier "gnomon.kernel" and anchor apple generic and certificate leaf[subject.OU] = ${TEAM}`;
    const positive = json(sea, [tool, want]).json;
    const negativeNode = json(baseNode, [path.join(ctx.probeDir, 'probe-main.cjs'), tool, want]).json;
    const notTheKernel = json(sea, [tool, kernelReq]).json;
    const claims = {
      a_stdinIsUnixSocket: positive?.stdinIsSocket === true && positive?.family === 'unix' && positive?.soType === 'stream',
      b_peerTokenIsTheSea: typeof positive?.tokenPid === 'number' && positive.tokenPid === positive?.ppid && positive.tokenPid === positive?.peerPid,
      c_seaPassesRequirement: positive?.valid === true,
      d_plainNodeFails: negativeNode?.ok === true && negativeNode?.valid === false,
      d_probeSeaIsNotTheKernel: notTheKernel?.ok === true && notTheKernel?.valid === false,
    };
    const all = Object.values(claims).every(Boolean);
    const evidence = { signed: s.signed, signingNote: s.why ?? null, seaSignature: built.signature, requirement: want, positive, negativeNode, notTheKernel, claims };
    const line = `P1 ${all ? (s.signed ? 'PASS' : 'PARTIAL (ad-hoc: mechanism ok, anchor/team pending the signed run)') : 'FAIL'}: ${Object.entries(claims).map(([k, v]) => `${k}=${v}`).join(' ')}`;
    process.stderr.write(`${line}\n`);
    return { verdict: !all ? 'fail' : s.signed ? 'pass' : 'partial', evidence: { ...evidence, summary: line } };
  } finally {
    done();
  }
}
