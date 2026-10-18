/**
 * @symbol #kernel-log
 *
 * `gnomon replay [<home>] [--expect <hash>] [--json]` (spec §2.1 G-KRN-01,
 * §19.1 M1.12) — verifyLog + the deterministic replay fold
 * (kernel/log/replay.ts). Prints the projection hash. A log that does not
 * verify, a divergence inside the fold, or a hash other than `--expect` is
 * REFUSED INTEGRITY_BROKEN (exit 1). Read-only; runs with or without a daemon.
 *
 * Keys: the kernel public keys recorded in the home (`keys/kernel-pub.jsonl`)
 * and the kernel principal from the same root authority source as the daemon
 * (kernelPrincipalOf). Rows signed by keys outside that file (an approvals or
 * device key) fail verify here — residual until the registry ring is wired
 * into offline verify (stated, not hidden).
 */
import * as path from 'node:path';
import { kernelPrincipalOf, resolveGnomonHome } from '../kernel/lifecycle/index.js';
import { readKernelPubs } from '../kernel/identity/index.js';
import { KeyRing, replayLog } from '../kernel/log/index.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const REPLAY_EXIT_OK = 0;
export const REPLAY_EXIT_REFUSED = 1;
export const REPLAY_EXIT_USAGE = 64;

export const REPLAY_USAGE = `usage: gnomon replay [<home>] [--expect <sha256:hex>] [--json]

  Verifies the kernel log of <home> (default: the Gnomon home), then folds the
  verified chain into the replay projection (per-session kernel-controlled
  inputs, recorded host-layer hashes, card states, head) and prints its hash.
  Divergence (a turn sent with bytes never logged, a log that does not verify,
  or a hash other than --expect) is refused. Read-only.
`;

const HASH = /^sha256:[0-9a-f]{64}$/;

export async function runReplayCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }): Promise<number> {
  let home: string | undefined;
  let expect: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      io.stdout.write(`gnomon ${GNOMON_VERSION}\n${REPLAY_USAGE}`);
      return REPLAY_EXIT_OK;
    } else if (a === '--json') json = true;
    else if (a === '--expect') {
      const v = argv[++i];
      if (!v || !HASH.test(v)) {
        refused(io.stderr, 'BAD_REQUEST', 'usage', '--expect needs sha256:<64 hex>', ['gnomon replay --help']);
        return REPLAY_EXIT_USAGE;
      }
      expect = v;
    } else if (!a.startsWith('-') && home === undefined) {
      if (!path.isAbsolute(a)) {
        refused(io.stderr, 'BAD_REQUEST', 'usage', 'the home must be an absolute path', ['gnomon replay --help']);
        return REPLAY_EXIT_USAGE;
      }
      home = a;
    } else {
      refused(io.stderr, 'BAD_REQUEST', 'usage', `unknown argument ${a}`, ['gnomon replay --help']);
      return REPLAY_EXIT_USAGE;
    }
  }
  home = path.resolve(home ?? resolveGnomonHome());
  const pubs = readKernelPubs(home);
  const ring = new KeyRing();
  for (const k of pubs) ring.addEd25519(k.publicKeyPem);
  let r: ReturnType<typeof replayLog>;
  try {
    r = replayLog(home, { keyRing: ring, kernelPrincipal: kernelPrincipalOf(), kernelKeyIds: pubs.map((k) => k.keyId), ...(expect ? { expect } : {}) });
  } catch (err) {
    refused(io.stderr, 'ENGINE', 'replay-unreadable', `could not read the log: ${(err as Error).message}`, ['check the home path']);
    return REPLAY_EXIT_REFUSED;
  }
  if (json) io.stdout.write(`${JSON.stringify({ ok: r.ok, projectionHash: r.projectionHash ?? null, rows: r.verify.rows, verified: r.verify.ok, divergences: r.divergences, expected: r.expected ?? null, failures: r.verify.failures.slice(0, 20) })}\n`);
  if (!r.verify.ok) {
    refused(io.stderr, 'INTEGRITY_BROKEN', 'verify-failed', `${r.verify.failures.length} verify failure(s); first: ${r.verify.failures[0]?.code ?? '?'} ${r.verify.failures[0]?.detail ?? ''}`, ['an unverified log is never replayed']);
    return REPLAY_EXIT_REFUSED;
  }
  if (r.divergences.length) {
    refused(io.stderr, 'INTEGRITY_BROKEN', 'replay-diverged', `${r.divergences.length} divergence(s); first at seq ${r.divergences[0]!.seq}: ${r.divergences[0]!.detail}`);
    return REPLAY_EXIT_REFUSED;
  }
  if (r.expected && !r.expected.matches) {
    refused(io.stderr, 'INTEGRITY_BROKEN', 'replay-diverged', `projection ${r.projectionHash} is not the expected ${r.expected.hash}`);
    return REPLAY_EXIT_REFUSED;
  }
  if (!json) {
    heading(io.stdout, 'replayed', r.projectionHash);
    readout(io.stdout, [
      ['log', r.projection!.log ?? '-'],
      ['rows', `${r.verify.rows} of ${r.verify.rows} verified`],
      ['sessions', `${Object.keys(r.projection!.sessions).length}`],
      ['expect', r.expected ? 'matches' : 'not given'],
    ]);
  }
  return REPLAY_EXIT_OK;
}
