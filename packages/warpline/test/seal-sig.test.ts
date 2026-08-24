/**
 * seal-sig.test — M3-lite I3: seal-time AGENT signing (#seal signStrandForSeal,
 * m3-integrity-design-2026-08-23.md §3 under the §6 rulings).
 *
 * The postures under test:
 *   - EPOCH-LESS repos behave EXACTLY as before — an agent-class seal carries no
 *     sig and nothing about the strand changes (the 1251-test world);
 *   - post-boundary AGENT-CLASS seals carry a valid strandSig:v1 whose keyId is
 *     the principal's REGISTRY key and whose signature verifies over the
 *     domain-separated pickId — and the stored pickId still reproduces (the
 *     preimage exclusion holding in anger, not just in a unit test);
 *   - HUMAN-CLASS seals stay UNSIGNED post-boundary (procedural boundary,
 *     TD-2026-08-23-136 Q1);
 *   - a MISSING or GARBLED key REFUSES the seal fail-closed (refusal:v1 AUTH,
 *     next[] = the human's `key.mint` escalation) — never an unsigned seal past
 *     the boundary;
 *   - `sig` rides the fabric.jsonl row and ROUND-TRIPS through readFabric;
 *   - the NATIVE (v3 / daemon) write path signs and refuses identically — it
 *     seals via buildStrandV3 + appendStrand, NOT sealState, so the shared
 *     helper is pinned on both paths.
 *
 * NEVER against the live fabric — scratch tmp roots only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recordPick } from '../src/fabric/pick.js';
import { proposeNative } from '../src/fabric/native.js';
import { warplineDirOf, readFabric } from '../src/fabric/fabric.js';
import { reproducesUnderKnownRule } from '../src/fabric/strand.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { mintAgentKey, registryKeyFor, verifyPickIdSig, agentKeyPathOf } from '../src/fabric/keys.js';
import { RefusedError } from '../src/fabric/refusal.js';

const NOW = '2026-08-23T00:00:00.000Z';

function writePurpose(root: string, components: string): void {
  fs.writeFileSync(
    path.join(root, '.purpose'),
    `version: "2.0"\ndescription: I3 fixture\ncomponents:\n${components}`,
    'utf8',
  );
}

// Distinct essences → distinct states (the dedup edge case, crash-window fixture).
const A = '  alpha:\n    description: A\n    type: module\n';
const B = A + '  beta:\n    description: B\n    type: cli\n';
const C = B + '  gamma:\n    description: G\n    type: service\n';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-seal-sig-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('I3 — epoch-less repos are untouched', () => {
  it('an agent-class seal on a repo with NO signing epoch carries no sig', async () => {
    writePurpose(root, A);
    const r = await recordPick(root, { cwd: root, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
    expect(r.strand?.sig).toBeUndefined();
    const report = verifyFabric(root);
    expect(report.failures).toEqual([]);
    expect(report.signing).toEqual({
      epochPinned: false,
      signedFromPickId: null,
      signed: 0,
      exempt: 1,
      failed: 0,
    });
  });
});

describe('I3 — post-boundary agent-class seals are SIGNED', () => {
  it('seals with the registry key: valid strandSig:v1, pickId still reproduces, verify green', async () => {
    writePurpose(root, A);
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
    mintAgentKey(root, 'alice', { now: NOW }); // pins signed-from at the tip (boundary)
    writePurpose(root, B);
    const r = await recordPick(root, { cwd: root, intent: 'add beta', actor: 'alice', agentId: 'alice', now: NOW });
    const sig = r.strand!.sig!;
    expect(sig.schemaVersion).toBe('strandSig:v1');
    expect(sig.principal).toBe('alice');
    const row = registryKeyFor(root, 'alice')!;
    expect(sig.keyId).toBe(row.keyId);
    expect(verifyPickIdSig(row.publicKeyPem, r.strand!.pickId, sig.sigBase64)).toBe(true);
    // the preimage exclusion in anger: the SIGNED strand's stored id reproduces.
    expect(reproducesUnderKnownRule(r.strand!)).toBe(true);
    expect(verifyFabric(root).failures).toEqual([]);
  });

  it('sig ROUND-TRIPS through fabric.jsonl (readFabric returns it verbatim)', async () => {
    writePurpose(root, A);
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
    mintAgentKey(root, 'alice', { now: NOW });
    writePurpose(root, B);
    const r = await recordPick(root, { cwd: root, intent: 'add beta', actor: 'alice', agentId: 'alice', now: NOW });
    const onDisk = readFabric(warplineDirOf(root));
    expect(onDisk[onDisk.length - 1].sig).toEqual(r.strand!.sig);
    const report = verifyFabric(root);
    expect(report.signing.epochPinned).toBe(true);
    expect(report.signing.signed).toBe(1);
    expect(report.signing.exempt).toBe(1); // the pre-boundary genesis strand
    expect(report.signing.failed).toBe(0);
  });

  it('HUMAN-CLASS seals stay UNSIGNED post-boundary (procedural boundary, §6 Q1)', async () => {
    writePurpose(root, A);
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'human', now: NOW });
    mintAgentKey(root, 'alice', { now: NOW });
    writePurpose(root, B);
    const r = await recordPick(root, { cwd: root, intent: 'add beta', actor: 'human', now: NOW });
    expect(r.strand?.authoredBy?.agentId ?? null).toBeNull();
    expect(r.strand?.sig).toBeUndefined();
    expect(verifyFabric(root).failures).toEqual([]);
  });
});

describe('I3 — a key that does not resolve REFUSES the seal (fail-closed)', () => {
  it('MISSING key: refusal:v1 AUTH naming the principal and the key.mint escalation', async () => {
    writePurpose(root, A);
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
    mintAgentKey(root, 'alice', { now: NOW }); // epoch exists; bob has no key
    writePurpose(root, B);
    let thrown: unknown;
    try {
      await recordPick(root, { cwd: root, intent: 'as bob', actor: 'bob', agentId: 'bob', now: NOW });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RefusedError);
    const e = thrown as RefusedError;
    expect(e.message).toContain('"bob"');
    expect(e.message).toContain('warpline key mint bob');
    expect(e.refusal.code).toBe('AUTH');
    expect(e.refusal.next[0]).toEqual({
      verb: 'key.mint',
      params: { principal: 'bob' },
      requires: [],
      principal: 'human',
    });
    // nothing was sealed — the ledger did not move.
    expect(readFabric(warplineDirOf(root)).length).toBe(1);
  });

  it('GARBLED key file: the fail-closed loader never softens into an unsigned seal', async () => {
    writePurpose(root, A);
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
    mintAgentKey(root, 'alice', { now: NOW });
    fs.writeFileSync(agentKeyPathOf(root, 'alice'), 'not json at all', 'utf8');
    writePurpose(root, B);
    await expect(
      recordPick(root, { cwd: root, intent: 'add beta', actor: 'alice', agentId: 'alice', now: NOW }),
    ).rejects.toThrow(/no usable signing key/);
    expect(readFabric(warplineDirOf(root)).length).toBe(1);
  });
});

describe('I3 — the NATIVE (v3 / daemon) write path signs and refuses identically', () => {
  it('proposeNative post-boundary seals a SIGNED v3 strand; a keyless principal is refused', async () => {
    // Empty fabric: the first mint pins signed-from with a NULL pickId — the
    // boundary is GENESIS and every strand ever sealed is post-boundary.
    mintAgentKey(root, 'alice', { now: NOW });
    fs.writeFileSync(path.join(root, 'mod.ts'), 'export const one = 1;\n', 'utf8');
    const g = await proposeNative(root, { worktree: root, agentId: 'alice', intent: 'genesis' });
    expect(g.noop).toBe(false);
    expect(g.strand!.schemaVersion).toBe(3);
    const sig = g.strand!.sig!;
    expect(sig.principal).toBe('alice');
    const row = registryKeyFor(root, 'alice')!;
    expect(sig.keyId).toBe(row.keyId);
    expect(verifyPickIdSig(row.publicKeyPem, g.strand!.pickId, sig.sigBase64)).toBe(true);
    expect(reproducesUnderKnownRule(g.strand!)).toBe(true);
    const report = verifyFabric(root);
    expect(report.failures).toEqual([]);
    expect(report.signing).toEqual({
      epochPinned: true,
      signedFromPickId: null, // genesis pin — everything post-boundary
      signed: 1,
      exempt: 0,
      failed: 0,
    });
    // a principal with NO key refuses on the same path (the daemon surfaces
    // this through its error frame unchanged — RefusedError carries refusal:v1).
    fs.writeFileSync(path.join(root, 'mod.ts'), 'export const one = 2;\n', 'utf8');
    await expect(proposeNative(root, { worktree: root, agentId: 'bob', intent: 'as bob' })).rejects.toThrow(
      RefusedError,
    );
  });
});
