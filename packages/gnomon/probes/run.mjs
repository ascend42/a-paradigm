#!/usr/bin/env node
// Gnomon M1.0 probe harness (spec §19.1 M1.0; research 29 §2).
//
//   node packages/gnomon/probes/run.mjs <id> [--out-dir <dir>] [--timeout <ms>]
//
// Imports probes/<id>/probe.mjs, calls its default export, and writes a
// probeResult:v1 record to probes/results/<id>.<platform>.json (or --out-dir).
// ZERO deps and NO build step: this file must run on a fresh checkout. The
// record shape is the one in @a-company/gnomon-contracts
// (schemas/probeResult.v1.schema.json); assertShape() below mirrors it and
// test/probe-harness.test.ts checks the output against the contracts validator.
//
// Probe module contract:
//   export const specRefs = ['§…', 'OPEN n', 'G-…'];      // optional
//   export default async function probe(ctx) {
//     return { verdict: 'pass'|'fail'|'partial', evidence: {...}, toolVersions?: {...} };
//   }
//   ctx = { id, platform, arch, probeDir, signal }
// A thrown error or timeout is recorded as verdict 'fail' with the error in evidence.
//
// Exit codes: 0 pass, 1 fail, 2 partial, 64 usage error.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROBES_DIR = path.dirname(fileURLToPath(import.meta.url));
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VERDICTS = ['pass', 'fail', 'partial'];
const OSES = ['darwin', 'win32', 'linux'];
const KEYS = ['probe', 'os', 'osVersion', 'arch', 'toolVersions', 'verdict', 'evidence', 'specRefs', 'at'];
const EXIT = { pass: 0, fail: 1, partial: 2 };
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

function usage(message) {
  process.stderr.write(`run.mjs: ${message}\nusage: node probes/run.mjs <id> [--out-dir <dir>] [--timeout <ms>]\n`);
  process.exit(64);
}

function parseArgs(argv) {
  const opts = { id: undefined, outDir: path.join(PROBES_DIR, 'results'), timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out-dir') opts.outDir = path.resolve(argv[++i] ?? usage('--out-dir needs a value'));
    else if (a === '--timeout') {
      opts.timeoutMs = Number(argv[++i]);
      if (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs <= 0) usage('--timeout must be a positive integer (ms)');
    } else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else if (opts.id === undefined) opts.id = a;
    else usage(`unexpected argument ${a}`);
  }
  if (!opts.id) usage('missing probe id');
  if (!ID_PATTERN.test(opts.id)) usage(`invalid probe id "${opts.id}" (must match ${ID_PATTERN})`);
  return opts;
}

function osVersion() {
  try {
    if (process.platform === 'darwin') {
      return `macOS ${execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()} (${os.release()})`;
    }
  } catch {
    // fall through to the generic form
  }
  return `${os.version()} (${os.release()})`;
}

function errorEvidence(err) {
  return err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { thrown: String(err) };
}

function assertShape(r) {
  const problems = [];
  for (const k of KEYS) if (!(k in r)) problems.push(`missing ${k}`);
  for (const k of Object.keys(r)) if (!KEYS.includes(k)) problems.push(`unknown ${k}`);
  if (!ID_PATTERN.test(r.probe)) problems.push('probe id');
  if (!OSES.includes(r.os)) problems.push(`os ${r.os}`);
  if (!VERDICTS.includes(r.verdict)) problems.push(`verdict ${r.verdict}`);
  if (typeof r.evidence !== 'object' || r.evidence === null || Array.isArray(r.evidence)) problems.push('evidence');
  if (!Array.isArray(r.specRefs) || r.specRefs.some((s) => typeof s !== 'string' || !s)) problems.push('specRefs');
  if (typeof r.toolVersions?.node !== 'string') problems.push('toolVersions.node');
  for (const [k, v] of Object.entries(r.toolVersions ?? {})) if (typeof v !== 'string') problems.push(`toolVersions.${k}`);
  if (problems.length) throw new Error(`probeResult:v1 shape violation: ${problems.join(', ')}`);
}

async function runProbe(mod, ctx, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`probe timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([mod.default({ ...ctx, signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const probeDir = path.join(PROBES_DIR, opts.id);
  const probeFile = path.join(probeDir, 'probe.mjs');
  if (!existsSync(probeFile)) usage(`no probe at ${path.relative(process.cwd(), probeFile)}`);

  const mod = await import(pathToFileURL(probeFile).href);
  if (typeof mod.default !== 'function') usage(`${opts.id}/probe.mjs has no default export function`);

  let outcome;
  try {
    outcome = await runProbe(mod, { id: opts.id, platform: process.platform, arch: process.arch, probeDir }, opts.timeoutMs);
    if (!outcome || !VERDICTS.includes(outcome.verdict)) {
      outcome = { verdict: 'fail', evidence: { harnessError: `probe returned invalid verdict: ${JSON.stringify(outcome?.verdict)}` } };
    }
  } catch (err) {
    outcome = { verdict: 'fail', evidence: { harnessError: errorEvidence(err) } };
  }

  const result = {
    probe: opts.id,
    os: process.platform,
    osVersion: osVersion(),
    arch: process.arch,
    toolVersions: { ...(outcome.toolVersions ?? {}), node: process.version },
    verdict: outcome.verdict,
    evidence: outcome.evidence ?? {},
    specRefs: Array.isArray(mod.specRefs) ? [...mod.specRefs] : [],
    at: new Date().toISOString(),
  };
  assertShape(result);

  mkdirSync(opts.outDir, { recursive: true });
  const outFile = path.join(opts.outDir, `${opts.id}.${process.platform}.json`);
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${opts.id}: ${result.verdict} -> ${path.relative(process.cwd(), outFile) || outFile}\n`);
  process.exitCode = EXIT[result.verdict];
}

main().catch((err) => {
  process.stderr.write(`run.mjs: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
