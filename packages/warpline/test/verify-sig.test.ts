/**
 * verify-sig.test — M3-lite I4: verifyFabric's signature rules over the
 * signing epoch (m3-integrity-design-2026-08-23.md §3 "Verification" under the
 * §6 rulings — human-class rules dropped, agent-sig rules only).
 *
 * The four failure kinds + the registry boundary, each driven to fire:
 *   sig-missing            — post-boundary agent-class strand with no sig;
 *   sig-invalid            — sig present but cryptographically wrong (byte-flip);
 *   sig-key-unknown        — signed by a key the REGISTRY does not hold for the
 *                            principal (a non-registry key, or the swapped-key-
 *                            file case: verification uses the registry public
 *                            key, never the key file);
 *   sig-principal-mismatch — sig.principal != authoredBy.agentId;
 *   registry-invalid       — the signed-from row names a pickId absent from the
 *                            fabric (unverifiable boundary, HARD).
 *
 * And the exemptions that keep every pre-M3 repo green: strands at-or-before
 * the boundary, human-class strands, and epoch-less repos (all exempt, summary
 * reports epochPinned:false).
 *
 * Tampering is done on fabric.jsonl directly — because `sig` is EXCLUDED from
 * the pickId preimage, every sig tamper below leaves the pickId reproducing, so
 * the ONLY failure each test may see is the named sig-* kind. (If the preimage
 * exclusion ever regressed, these tests would drown in pickId-mismatch.)
 *
 * NEVER against the live fabric — scratch tmp roots only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recordPick } from '../src/fabric/pick.js';
import { warplineDirOf, readFabric } from '../src/fabric/fabric.js';
import { verifyFabric } from '../src/fabric/verify.js';
import type { Strand } from '../src/fabric/strand.js';
import {
  mintAgentKey,
  generateAgentKey,
  signPickId,
  agentKeyPathOf,
  keyRegistryPathOf,
  AGENT_KEY_SCHEMA,
  KEY_REGISTRY_SCHEMA,
} from '../src/fabric/keys.js';

const NOW = '2026-08-23T00:00:00.000Z';

function writePurpose(root: string, components: string): void {
  fs.writeFileSync(
    path.join(root, '.purpose'),
    `version: "2.0"\ndescription: I4 fixture\ncomponents:\n${components}`,
    'utf8',
  );
}

const A = '  alpha:\n    description: A\n    type: module\n';
const B = A + '  beta:\n    description: B\n    type: cli\n';
const C = B + '  gamma:\n    description: G\n    type: service\n';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-verify-sig-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Mutate the TAIL strand's JSON row in fabric.jsonl (sig tampering never moves
 * the pickId — the preimage exclusion — so only sig-* checks may fire). */
function mutateTail(r: string, fn: (s: Strand) => void): void {
  const p = path.join(warplineDirOf(r), 'fabric.jsonl');
  const lines = fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim());
  const tail = JSON.parse(lines[lines.length - 1]) as Strand;
  fn(tail);
  lines[lines.length - 1] = JSON.stringify(tail);
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
}

/** genesis (agent-class, PRE-epoch) → mint alice (pins boundary) → signed seal. */
async function sealSignedFabric(r: string): Promise<Strand> {
  writePurpose(r, A);
  await recordPick(r, { cwd: r, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
  mintAgentKey(r, 'alice', { now: NOW });
  writePurpose(r, B);
  const res = await recordPick(r, { cwd: r, intent: 'add beta', actor: 'alice', agentId: 'alice', now: NOW });
  return res.strand!;
}

describe('I4 — happy path + exemptions', () => {
  it('mint key, epoch pinned, agent seal → verify green with an honest summary', async () => {
    await sealSignedFabric(root);
    const report = verifyFabric(root);
    expect(report.failures).toEqual([]);
    expect(report.signing.epochPinned).toBe(true);
    expect(report.signing.signedFromPickId).not.toBeNull(); // pinned at the genesis strand's pickId
    expect(report.signing.signed).toBe(1); // the post-boundary agent seal
    expect(report.signing.exempt).toBe(1); // the PRE-boundary agent-class genesis — grandfathered
    expect(report.signing.failed).toBe(0);
  });

  it('human-class strands are exempt post-boundary (procedural boundary)', async () => {
    await sealSignedFabric(root);
    writePurpose(root, C);
    await recordPick(root, { cwd: root, intent: 'human edit', actor: 'human', now: NOW });
    const report = verifyFabric(root);
    expect(report.failures).toEqual([]);
    expect(report.signing.signed).toBe(1);
    expect(report.signing.exempt).toBe(2); // pre-boundary genesis + the human strand
  });

  it('a NO-EPOCH repo is fully exempt — signing epoch: none', async () => {
    writePurpose(root, A);
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
    writePurpose(root, B);
    await recordPick(root, { cwd: root, intent: 'add beta', actor: 'alice', agentId: 'alice', now: NOW });
    const report = verifyFabric(root);
    expect(report.failures).toEqual([]);
    expect(report.signing).toEqual({
      epochPinned: false,
      signedFromPickId: null,
      signed: 0,
      exempt: 2,
      failed: 0,
    });
  });
});

describe('I4 — the failure kinds, each at the right seq', () => {
  it('STRIPPED sig → sig-missing', async () => {
    const strand = await sealSignedFabric(root);
    mutateTail(root, (s) => {
      delete s.sig;
    });
    const report = verifyFabric(root);
    expect(report.failures.map((f) => f.kind)).toEqual(['sig-missing']);
    expect(report.failures[0].seq).toBe(strand.seq);
    expect(report.failures[0].pickId).toBe(strand.pickId);
    expect(report.signing.failed).toBe(1);
  });

  it('BYTE-FLIPPED sig → sig-invalid', async () => {
    const strand = await sealSignedFabric(root);
    mutateTail(root, (s) => {
      const sig = s.sig!;
      sig.sigBase64 = (sig.sigBase64[0] === 'A' ? 'B' : 'A') + sig.sigBase64.slice(1);
    });
    const report = verifyFabric(root);
    expect(report.failures.map((f) => f.kind)).toEqual(['sig-invalid']);
    expect(report.failures[0].seq).toBe(strand.seq);
    expect(report.signing.failed).toBe(1);
  });

  it('signed with a NON-REGISTRY key → sig-key-unknown', async () => {
    const strand = await sealSignedFabric(root);
    const rogue = generateAgentKey();
    mutateTail(root, (s) => {
      s.sig = {
        keyId: rogue.keyId,
        sigBase64: signPickId(rogue.privateKeyPem, s.pickId), // a REAL signature — by a key the registry never saw
        principal: 'alice',
        schemaVersion: 'strandSig:v1',
      };
    });
    const report = verifyFabric(root);
    expect(report.failures.map((f) => f.kind)).toEqual(['sig-key-unknown']);
    expect(report.failures[0].seq).toBe(strand.seq);
  });

  it('SWAPPED KEY FILE → sig-key-unknown (verification uses the REGISTRY key, never the key file)', async () => {
    writePurpose(root, A);
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
    mintAgentKey(root, 'alice', { now: NOW });
    // swap the key FILE for a fresh pair the registry has never seen — the seal
    // signs happily with it; verify must refuse against the registry.
    const swapped = generateAgentKey();
    fs.writeFileSync(
      agentKeyPathOf(root, 'alice'),
      JSON.stringify({
        schemaVersion: AGENT_KEY_SCHEMA,
        principal: 'alice',
        keyId: swapped.keyId,
        publicKeyPem: swapped.publicKeyPem,
        privateKeyPem: swapped.privateKeyPem,
        createdAt: NOW,
      }),
      'utf8',
    );
    writePurpose(root, B);
    await recordPick(root, { cwd: root, intent: 'add beta', actor: 'alice', agentId: 'alice', now: NOW });
    const report = verifyFabric(root);
    expect(report.failures.map((f) => f.kind)).toEqual(['sig-key-unknown']);
  });

  it('PRINCIPAL MISMATCH → sig-principal-mismatch', async () => {
    const strand = await sealSignedFabric(root);
    mutateTail(root, (s) => {
      s.sig!.principal = 'mallory';
    });
    const report = verifyFabric(root);
    expect(report.failures.map((f) => f.kind)).toEqual(['sig-principal-mismatch']);
    expect(report.failures[0].seq).toBe(strand.seq);
  });

  it('signed-from naming an UNKNOWN pickId → registry-invalid (checks stand down)', async () => {
    writePurpose(root, A);
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
    const key = generateAgentKey();
    const bogus = 'pick:v2:' + 'de'.repeat(32);
    fs.mkdirSync(path.dirname(keyRegistryPathOf(root)), { recursive: true });
    fs.writeFileSync(
      keyRegistryPathOf(root),
      JSON.stringify({
        schemaVersion: KEY_REGISTRY_SCHEMA,
        kind: 'agent-key',
        keyId: key.keyId,
        principal: 'alice',
        publicKeyPem: key.publicKeyPem,
        createdAt: NOW,
      }) +
        '\n' +
        JSON.stringify({
          schemaVersion: KEY_REGISTRY_SCHEMA,
          kind: 'signed-from',
          signedFromPickId: bogus,
          createdAt: NOW,
        }) +
        '\n',
      'utf8',
    );
    const report = verifyFabric(root);
    expect(report.failures.map((f) => f.kind)).toEqual(['registry-invalid']);
    expect(report.failures[0].pickId).toBe(bogus);
    expect(report.failures[0].seq).toBe(-1);
    // per-strand checks stood down — everything exempt, nothing guessed.
    expect(report.signing.epochPinned).toBe(true);
    expect(report.signing.exempt).toBe(readFabric(warplineDirOf(root)).length);
    expect(report.signing.signed).toBe(0);
  });
});
