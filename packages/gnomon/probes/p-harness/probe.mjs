// p-harness — the harness self-test. Proves run.mjs can import a probe, run
// it, and write a valid probeResult:v1 record on this platform. Always passes
// when Node and the filesystem behave; it tests the harness, not a ruling.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const specRefs = ['research 29 §2', '§19.1 M1.0'];

export default async function probe(ctx) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gnomon-p-harness-'));
  try {
    const file = path.join(dir, 'roundtrip.txt');
    writeFileSync(file, ctx.id);
    const roundtrip = readFileSync(file, 'utf8') === ctx.id;
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const nodeOk = nodeMajor >= 24;
    return {
      verdict: roundtrip && nodeOk ? 'pass' : 'fail',
      evidence: { roundtrip, nodeMajor, nodeOk, platform: ctx.platform, arch: ctx.arch },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
