/**
 * resolve-join.test — I-1: the KnotResolution.knotPayloadId JOIN, the
 * genuine-vs-over-block measurement instrument (commit e29b6d9b). The audit found
 * `grep resolution.knotPayloadId test/` returned ZERO hits — the one field the
 * field-test falsifiers read was asserted nowhere. Three regressions, each pinned:
 *
 *   (a) the join fires WITHOUT --ours and binds the correct payload (defect #1:
 *       it used to fire only when the optional --ours flag was supplied);
 *   (b) two payloads share an ours.stateId — the SAME proposal re-admitted against
 *       a MOVED selvage — and the join binds the one on the CURRENT selvage,
 *       deterministically, never an fs.readdir coin-flip (defect #2);
 *   (c) a NATIVE `pick:` scratch value flowing into the git-era resolve refuses
 *       LOUDLY (the C-9 mirror), never silently recording a non-stateId base
 *       into resolution.base (defect #3).
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { admit } from '../src/fabric/admit.js';
import { forkScratch, writeScratchRef } from '../src/fabric/scratch.js';
import { resolveKnot } from '../src/fabric/resolve.js';
import { readKnotPayload } from '../src/fabric/knot-payload.js';
import { absorb } from '../src/absorb.js';
import { readSelvage, warplineDirOf } from '../src/fabric/fabric.js';

const execFileAsync = promisify(execFile);

const MOD = 'src/mod.ts';
const FOO = `#code:${MOD}::foo`;
const BASE_SRC = `export function foo() { return 1; }\nexport function bar() { return 2; }\n`;
const A_SRC = `export function foo() { return 10; }\nexport function bar() { return 2; }\n`;
const B_SRC = `export function foo() { return 20; }\nexport function bar() { return 2; }\n`;
const D_SRC = `export function foo() { return 99; }\nexport function bar() { return 2; }\n`;
const RESOLVED_SRC = `export function foo() { return 42; }\nexport function bar() { return 2; }\n`;

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new FixtureRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'rj@warpline.test');
    await r.git('config', 'user.name', 'Warpline RJ');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...args: string[]): Promise<string> =>
    (await execFileAsync('git', args, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async file(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
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

describe('I-1 — the knotPayloadId join is unconditional, deterministic, and fails closed', () => {
  it('(a) the join fires WITHOUT --ours and binds the correct payload', async () => {
    const repo = await FixtureRepo.create('warpline-resolvejoin-a-');
    try {
      const root = repo.dir;
      await repo.file(MOD, BASE_SRC);
      await repo.commitAll('shared base');
      await repo.branch('branchA', 'base', MOD, A_SRC);
      await repo.branch('branchB', 'base', MOD, B_SRC);
      await repo.branch('resolved', 'base', MOD, RESOLVED_SRC);
      await repo.git('checkout', '-q', 'base');

      await admit(root, { cwd: root, agentId: 'agent-0', ref: 'base' }); // genesis
      forkScratch(root, 'agent-b'); // fork at the shared base BEFORE the selvage moves
      const rA = await admit(root, { cwd: root, agentId: 'agent-a', ref: 'branchA' });
      expect(rA.decision.status).toBe('FAST_ADMIT');
      const rB = await admit(root, { cwd: root, agentId: 'agent-b', ref: 'branchB' });
      expect(rB.decision.status).toBe('KNOT');
      expect(rB.knotPayloadId).toBeDefined();

      // Resolve with NO --ours (oursRef omitted). Pre-fix, knotPayloadId was absent.
      const res = await resolveKnot(root, {
        cwd: root,
        agentId: 'agent-b',
        resolvedRef: 'resolved',
        reason: 'settled on 42',
        decidedBy: 'alice',
      });

      expect(res.resolution.knotPayloadId).toBeDefined();
      expect(res.resolution.knotPayloadId).toBe(rB.knotPayloadId); // the EXACT payload
      // and the strand carries it (the join is durable on the accountability record)
      expect(res.strand.resolves?.knotPayloadId).toBe(rB.knotPayloadId);
      // contended came from the classified payload, not the resolved-symbols fallback
      expect(res.resolution.contended).toContain(FOO);
    } finally {
      await repo.destroy();
    }
  }, 120_000);

  it('(b) same ours.stateId, moved selvage — binds the current-selvage payload deterministically', async () => {
    const repo = await FixtureRepo.create('warpline-resolvejoin-b-');
    try {
      const root = repo.dir;
      await repo.file(MOD, BASE_SRC);
      await repo.commitAll('shared base');
      await repo.branch('branchA', 'base', MOD, A_SRC); // foo=10 (advances the selvage first)
      await repo.branch('branchB', 'base', MOD, B_SRC); // foo=20 (the TWICE-contested proposal)
      await repo.branch('branchD', 'base', MOD, D_SRC); // foo=99 (advances the selvage again)
      await repo.branch('resolved', 'base', MOD, RESOLVED_SRC);
      await repo.git('checkout', '-q', 'base');

      await admit(root, { cwd: root, agentId: 'agent-0', ref: 'base' }); // genesis → selvage=base
      // Fork b AND e at the shared base up front, so both keep it as their conflict
      // base even after the selvage advances (branchB genuinely contests foo).
      forkScratch(root, 'agent-b');
      forkScratch(root, 'agent-e');

      // KNOT #1: branchB (foo=20) vs selvage branchA (foo=10)
      const rA = await admit(root, { cwd: root, agentId: 'agent-a', ref: 'branchA' });
      expect(rA.decision.status).toBe('FAST_ADMIT');
      const selvageA = readSelvage(warplineDirOf(root));
      const kb1 = await admit(root, { cwd: root, agentId: 'agent-b', ref: 'branchB' });
      expect(kb1.decision.status).toBe('KNOT');
      const payload1 = kb1.knotPayloadId!;

      // advance the selvage: branchD (foo=99) fast-forwards over branchA
      forkScratch(root, 'agent-d'); // forks at the current selvage (branchA)
      const rD = await admit(root, { cwd: root, agentId: 'agent-d', ref: 'branchD' });
      expect(rD.decision.status).toBe('FAST_ADMIT');
      const selvageD = readSelvage(warplineDirOf(root));
      expect(selvageD).not.toBe(selvageA);

      // KNOT #2: the SAME branchB content (identical ours.stateId — stateIds are
      // content-addressed) vs the MOVED selvage branchD (foo=99), via agent-e whose
      // scratch is still the shared base.
      const kb2 = await admit(root, { cwd: root, agentId: 'agent-e', ref: 'branchB' });
      expect(kb2.decision.status).toBe('KNOT');
      const payload2 = kb2.knotPayloadId!;

      // The two payloads are distinct files but share the ours.stateId — the exact
      // ambiguity that made the old ours-only join a coin-flip.
      expect(payload2).not.toBe(payload1);
      const oursStateId = (await absorb('branchB', { cwd: root })).stateId;
      expect(readKnotPayload(root, payload1)!.ours.stateId).toBe(oursStateId);
      expect(readKnotPayload(root, payload2)!.ours.stateId).toBe(oursStateId);

      // readKnotPayload on the shared selector is now DETERMINISTIC across calls.
      const pick1 = readKnotPayload(root, oursStateId)!.payloadId;
      const pick2 = readKnotPayload(root, oursStateId)!.payloadId;
      expect(pick1).toBe(pick2);

      // Resolve the CURRENT knot (selvage=branchD) WITHOUT --ours: the join must bind
      // payload2 (theirs === current selvage), NOT the stale payload1.
      const res = await resolveKnot(root, {
        cwd: root,
        agentId: 'agent-e',
        resolvedRef: 'resolved',
        reason: 'settled on 42',
        decidedBy: 'alice',
      });
      expect(res.resolution.knotPayloadId).toBe(payload2);
      expect(res.resolution.knotPayloadId).not.toBe(payload1);
      expect(res.resolution.contended).toContain(FOO);
    } finally {
      await repo.destroy();
    }
  }, 120_000);

  it('(c) a native pick: scratch flowing into git-era resolve refuses LOUDLY (C-9 mirror)', async () => {
    const repo = await FixtureRepo.create('warpline-resolvejoin-c-');
    try {
      const root = repo.dir;
      await repo.file(MOD, BASE_SRC);
      await repo.commitAll('shared base');
      await repo.git('checkout', '-q', 'base');
      await admit(root, { cwd: root, agentId: 'agent-0', ref: 'base' }); // a selvage exists

      // Poison agent-x's scratch with a NATIVE pickId (what `warpline fork` mints on
      // the native path) — the git-era resolve cannot base a stateId recompute on it.
      writeScratchRef(root, 'agent-x', 'pick:v3:deadbeefdeadbeef');
      await expect(
        resolveKnot(root, {
          cwd: root,
          agentId: 'agent-x',
          resolvedRef: 'base',
          reason: 'should never seal',
        }),
      ).rejects.toThrow(/NATIVE pickId base|--native/);
    } finally {
      await repo.destroy();
    }
  }, 120_000);
});
