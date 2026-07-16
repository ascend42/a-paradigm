/**
 * knot-payload.test — P2.2 / R3 (forge-spec §3a): the machine-readable KNOT
 * payload is SELF-SUFFICIENT — a resolver acting from the payload ALONE (no
 * repo archaeology) can construct a valid resolve call that seals.
 *
 *   SEED       : two agents fork the same base; both edit `foo` divergently;
 *                the second admission returns KNOT and admit persists a
 *                knotPayload:v1 to .warpline/knots/, returning a POINTER
 *                (knotPayloadId — G1-additive, never the payload inline).
 *   PAYLOAD    : both sides' bodies + file texts (durable object store), both
 *                enveloped intents, both agentIds, base/ours/theirs stateIds +
 *                treeIds, per-side deltas, conflictingSlots, direct flag,
 *                blast-radius slice, the resolution-proposal envelope.
 *   ROUND-TRIP : the "resolver" reads ONLY the payload JSON, constructs the
 *                merged content from the two sides' file texts, and submits a
 *                KnotResolutionProposal; proposalToResolveOptions →
 *                resolveKnot SEALS it (the strand carries the accountability
 *                record). The harness touches the repo only as the resolver's
 *                hands (writing the file the resolver authored).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { admit, type AdmitResult } from '../src/fabric/admit.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { resolveKnot } from '../src/fabric/resolve.js';
import {
  readKnotPayload,
  listKnotPayloads,
  knotsDirOf,
  proposalToResolveOptions,
  KNOT_PAYLOAD_SCHEMA,
  KNOT_PROPOSAL_SCHEMA,
  type KnotPayload,
  type KnotResolutionProposal,
} from '../src/fabric/knot-payload.js';
import { envelopeProse, verifyProse } from '../src/envelope.js';

const execFileAsync = promisify(execFile);

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), prefix));
    const repo = new FixtureRepo(dir);
    await repo.git('init', '-q', '-b', 'base');
    await repo.git('config', 'user.email', 'kp@warpline.test');
    await repo.git('config', 'user.name', 'Warpline KP');
    await repo.git('config', 'commit.gpgsign', 'false');
    return repo;
  }
  git = async (...args: string[]): Promise<string> =>
    (await execFileAsync('git', args, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async file(rel: string, body: string): Promise<void> {
    const full = nodePath.join(this.dir, rel);
    await fs.mkdir(nodePath.dirname(full), { recursive: true });
    await fs.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  async branch(name: string, from: string, rel: string, body: string): Promise<void> {
    await this.git('checkout', '-q', from);
    await this.git('checkout', '-q', '-b', name);
    await this.file(rel, body);
    await this.commitAll(name);
  }
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

const MOD = 'src/mod.ts';
const BASE_SRC = `export function foo() { return 1; }\nexport function bar() { return 2; }\n`;
const A_SRC = `export function foo() { return 10; }\nexport function bar() { return 2; }\n`;
const B_SRC = `export function foo() { return 20; }\nexport function bar() { return 2; }\n`;

describe('KNOT PAYLOAD — self-sufficient resolution work order (forge-spec §3a)', () => {
  let repo: FixtureRepo;
  let rB: AdmitResult;
  let payload: KnotPayload;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-knot-payload-');
    await repo.file(MOD, BASE_SRC);
    await repo.commitAll('shared base');
    await repo.branch('branchA', 'base', MOD, A_SRC);
    await repo.branch('branchB', 'base', MOD, B_SRC);
    await repo.git('checkout', '-q', 'base');

    // Genesis: seal the shared base (empty fabric → FAST_ADMIT).
    const r0 = await admit(repo.dir, { cwd: repo.dir, agentId: 'agent-0', ref: 'base' });
    expect(r0.sealed).toBe(true);
    // agent-b forks its scratch at the shared base BEFORE the selvage advances.
    forkScratch(repo.dir, 'agent-b');
    // agent-a admits first — selvage advances to branchA.
    const rA = await admit(repo.dir, { cwd: repo.dir, agentId: 'agent-a', ref: 'branchA' });
    expect(rA.decision.status).toBe('FAST_ADMIT');
    expect(rA.sealed).toBe(true);
    // agent-b admits into the KNOT.
    rB = await admit(repo.dir, { cwd: repo.dir, agentId: 'agent-b', ref: 'branchB' });
    expect(rB.decision.status).toBe('KNOT');
    expect(rB.sealed).toBe(false);

    expect(rB.knotPayloadId).toBeDefined();
    const loaded = readKnotPayload(repo.dir, rB.knotPayloadId!);
    expect(loaded).not.toBeNull();
    payload = loaded!;
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('admit returns a payload POINTER, not the payload inline (G1-additive)', () => {
    expect(rB.knotPayloadId!.startsWith('knotPayload:v1:')).toBe(true);
    // Existing consumers see the unchanged AdmitResult shape.
    expect(rB.decision.knots.length).toBeGreaterThan(0);
    expect(rB.proposedStateId).toMatch(/^state:/);
    expect((rB as Record<string, unknown>).contested).toBeUndefined();
    // The payload itself lives in the sidecar (G5), one file per content address.
    expect(existsSync(knotsDirOf(repo.dir))).toBe(true);
    expect(listKnotPayloads(repo.dir).some((p) => p.payloadId === rB.knotPayloadId)).toBe(true);
  });

  it('carries identity + admit context (§3a Identity)', () => {
    expect(payload.schemaVersion).toBe(KNOT_PAYLOAD_SCHEMA);
    expect(payload.verdict).toBe('KNOT');
    expect(payload.rebasedOnto).toBe(rB.decision.rebasedOnto);
    expect(payload.ours.stateId).toBe(rB.proposedStateId);
    expect(payload.agentChanged).toEqual(rB.decision.agentChanged);
    expect(payload.otherChanged).toEqual(rB.decision.otherChanged);
    const knot = rB.decision.knots[0];
    const unit = payload.contested.find((c) => c.stableKey === knot.stableKey)!;
    expect(unit).toBeDefined();
    expect(unit.symbol).toBe(knot.symbol);
    expect(unit.conflictingSlots).toEqual(knot.conflictingSlots);
    expect(unit.conflictingSlots).toContain('body');
    expect(unit.direct).toBe(true);
    // G2: no ledger position anywhere in the document.
    expect(JSON.stringify(payload)).not.toMatch(/"seq"/);
  });

  it("carries BOTH sides' bodies + durable file texts (§3a Bodies) — the actual competing meanings", () => {
    const unit = payload.contested.find((c) => c.symbol.includes('foo'))!;
    expect(unit.ours.present && unit.theirs.present && unit.base.present).toBe(true);
    // essences = the knot's essenceA/essenceB, and they genuinely differ.
    expect(unit.ours.essence).not.toBeNull();
    expect(unit.theirs.essence).not.toBeNull();
    expect(unit.ours.essence).not.toBe(unit.theirs.essence);
    // meaning bodies (the essence-data `body` slot) — present and divergent.
    expect(unit.ours.body).toContain('20');
    expect(unit.theirs.body).toContain('10');
    expect(unit.base.body).toContain('1');
    // durable source texts, read from the content-addressed object store.
    expect(unit.ours.fileText).toBe(B_SRC);
    expect(unit.theirs.fileText).toBe(A_SRC);
    expect(unit.base.fileText).toBe(BASE_SRC);
    // per-side contract deltas.
    expect(unit.ours.delta?.kind).toBe('contract-changed');
    expect(unit.theirs.delta?.kind).toBe('contract-changed');
    // all three sides' trees are content-addressed and named.
    expect(payload.ours.treeId).toMatch(/^tree:v1:/);
    expect(payload.theirs.treeId).toMatch(/^tree:v1:/);
    expect(payload.base.treeId).toMatch(/^tree:v1:/);
  });

  it("carries BOTH sides' intents ENVELOPED + agent attribution (§3a Intents, §3d)", () => {
    expect(payload.ours.agentId).toBe('agent-b');
    expect(payload.theirs.agentId).toBe('agent-a');
    expect(verifyProse(payload.ours.intent)).toBe(true);
    expect(verifyProse(payload.theirs.intent)).toBe(true);
    // intents come from each side's commit subject — prose, hence enveloped.
    expect(payload.ours.intent.body).toBe('branchB');
    expect(payload.theirs.intent.body).toBe('branchA');
    // No bare prose field: every free-text is inside an envelope.
    expect(typeof payload.ours.intent).toBe('object');
  });

  it('carries the blast-radius ripple slice (§3a Blast radius)', () => {
    expect(payload.blastRadius.mode).toBe('ripple');
    const knot = rB.decision.knots[0];
    expect(payload.blastRadius.roots).toContain(knot.symbol);
    expect(payload.blastRadius.symbols.length).toBeGreaterThanOrEqual(payload.blastRadius.roots.length);
  });

  it('is retrievable by payloadId prefix and by the admitted ref (the admitRef selector)', () => {
    expect(readKnotPayload(repo.dir, payload.payloadId.slice(0, 30))?.payloadId).toBe(payload.payloadId);
    expect(readKnotPayload(repo.dir, 'branchB')?.payloadId).toBe(payload.payloadId);
    expect(readKnotPayload(repo.dir, 'no-such-selector')).toBeNull();
  });

  it('ROUND-TRIP: a resolver acting from the payload ALONE constructs a resolve call that SEALS', async () => {
    // ── THE RESOLVER — sees ONLY `doc` (the payload JSON), nothing else. ──────
    const doc = JSON.parse(JSON.stringify(payload)) as KnotPayload;
    const unit = doc.contested[0];
    // Both competing meanings + both intents are in hand; the resolver merges:
    // adopt OURS' contested line into THEIRS' file text (no repo access).
    const oursFooLine = unit.ours.fileText!.split('\n').find((l) => l.includes('function foo'))!;
    const mergedText = unit.theirs
      .fileText!.split('\n')
      .map((l) => (l.includes('function foo') ? oursFooLine : l))
      .join('\n');
    const resolverOutput = {
      path: unit.ours.filePath!,
      content: mergedText,
      proposal: {
        schemaVersion: KNOT_PROPOSAL_SCHEMA,
        payloadId: doc.payloadId,
        decidedBy: 'resolver-agent',
        reason: envelopeProse(
          `adopted ${doc.ours.agentId}'s foo (intent: ${doc.ours.intent.contentAddress}) over ${doc.theirs.agentId}'s; bar untouched`,
        ),
        resolvedRef: 'resolution',
        oursRef: doc.ours.ref,
      } satisfies KnotResolutionProposal,
    };
    expect(mergedText).toContain('return 20'); // ours' foo won
    expect(mergedText).toContain('return 2;'); // theirs' world otherwise intact

    // ── THE HANDS — the harness materializes the resolver's authored content. ─
    await repo.git('checkout', '-q', '-b', 'resolution', 'branchA');
    await repo.file(resolverOutput.path, resolverOutput.content);
    await repo.commitAll('resolution: adopt agent-b foo');

    // ── THE SEAL — proposal → ResolveOptions → resolveKnot. ──────────────────
    const opts = proposalToResolveOptions(resolverOutput.proposal, { agentId: 'agent-b', cwd: repo.dir });
    const sealed = await resolveKnot(repo.dir, opts);
    expect(sealed.strand.resolves).toBeDefined();
    expect(sealed.resolution.decidedBy).toBe('resolver-agent');
    expect(sealed.resolution.reason).toBe(resolverOutput.proposal.reason.body);
    // --ours precision: the contended set names the knotted symbol.
    const knot = rB.decision.knots[0];
    expect(sealed.resolution.contended).toContain(knot.symbol);
    expect(sealed.strand.stateId).toMatch(/^state:/);
  }, 120_000);
});
