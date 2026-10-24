/**
 * $daemon-lifecycle + #supervisor — the §2.4 rule 11 resume PLAN and the rule 4 sweep exemption (G-DMN-04
 * amended; TD-2026-10-19-908; T-2026-10-19-014 B2). Pure: synthetic kernel-signed rows and a fake process
 * control, so it runs on every platform (the spawning half is test/session-resume.test.ts, darwin).
 *
 * Falsifiers: a session drained then exited is resumed and never swept; one drained with no exit is swept and
 * never resumed; a row not signed by a kernel key is never read; a spawn of this boot for a resumed hsid is
 * never swept.
 */
import { describe, expect, it } from 'vitest';
import { mintId } from '@a-company/gnomon-contracts';
import { sweepOrphans } from '../src/kernel/lifecycle/children.js';
import type { ProcessControl } from '../src/kernel/lifecycle/process-control.js';
import { planResume, type ResumeRow } from '../src/kernel/supervisor/resume.js';

const HUMAN = 'p:abcdefgh/founder';
const KERNEL = 'p:abcdefgh/kernel';
const TRUST = { principals: [KERNEL], isKernelKey: (k: string) => k === 'key:kernel' };
type Row = ResumeRow & { payload: Record<string, unknown> };

describe('§2.4 rule 4 amended (G-DMN-04): drained-without-exit is swept, never resumed', () => {
  const k = (kind: string, payload: Record<string, unknown>, session?: string): Row => ({ id: mintId('ev'), kind, principal: KERNEL, keyId: 'key:kernel', payload, ...(session ? { session } : {}) });
  const hsidA = 'h:01HZZZZZZZZZZZZZZZZZZZZZZA';
  const hsidB = 'h:01HZZZZZZZZZZZZZZZZZZZZZZB';
  const uuid = '11111111-2222-4333-8444-555555555555';
  const permit = { schemaVersion: 'permit:v1', permitId: 'permit:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ', hsid: hsidA };

  it('plan + sweep: B (drained, exited) is resumed and not swept; A (drained, no exit) is swept and not resumed', async () => {
    const rows: Row[] = [];
    for (const h of [hsidA, hsidB]) {
      rows.push(k('session.open', { hsid: h, by: HUMAN, cwd: '/x', backend: 'claude-code', uuid }, h));
      rows.push(k('permit.grant', { permit: { ...permit, hsid: h } }));
      rows.push(k('session.spawned', { phase: 'running', spawnId: `sp-${h}`, hsid: h, pid: h === hsidA ? 4242 : 4343, pgid: h === hsidA ? 4242 : 4343, boot: 'boot-old', startTime: 't' }));
      rows.push(k('session.sandbox', { hsid: h, layersHash: 'sha256:aa', gitHash: 'sha256:bb', permitId: permit.permitId }, h));
      rows.push(k('session.drained', { uuid, reason: 'upgrade' }, h));
    }
    rows.push(k('session.exited', { spawnId: `sp-${hsidB}`, hsid: hsidB, pid: 4343, reason: 'drain-clean' }));
    // a forged drained row (not kernel-signed) is never read
    rows.push({ ...k('session.exited', { spawnId: `sp-${hsidA}`, hsid: hsidA, reason: 'drain-clean' }), keyId: 'key:other' });
    const plan = planResume(rows, TRUST);
    expect(plan.resume.map((c) => c.hsid)).toEqual([hsidB]);
    expect(plan.unfinished).toEqual([hsidA]);

    const orphaned: Array<Record<string, unknown>> = [];
    const control: ProcessControl = { fidelity: 'full', probeGroup: () => 'gone', signalGroup: () => false, startTime: () => null };
    // a spawn of THIS boot for the resumed hsid (the resume's own child) is exempt as well
    const sweepRows = [...rows.filter((x) => x.keyId === 'key:kernel'), k('session.spawned', { phase: 'running', spawnId: 'sp-new', hsid: hsidB, pid: 5000, pgid: 5000, boot: 'boot-new', startTime: 't' })];
    const res = await sweepOrphans({ rows: sweepRows, kernelPrincipals: [KERNEL], boot: 'boot-new', append: async (kind, payload) => void orphaned.push({ kind, ...payload }), control, resuming: new Set(plan.resume.map((c) => c.hsid)) });
    expect(orphaned.map((o) => o.hsid)).toEqual([hsidA]);
    expect(res.orphans).toBe(1);
  });

  it('Aegis L1: a kernel-signed session.refused{resume} uses the record up (terminal); L4: the open row\'s class is carried', () => {
    const rows: Row[] = [
      k('session.open', { hsid: hsidB, by: HUMAN, principalClass: 'human', cwd: '/x', backend: 'claude-code', uuid }, hsidB),
      k('permit.grant', { permit: { ...permit, hsid: hsidB } }),
      k('session.sandbox', { hsid: hsidB, layersHash: 'sha256:aa', gitHash: 'sha256:bb', permitId: permit.permitId }, hsidB),
      { ...k('session.drained', { uuid, reason: 'upgrade' }, hsidB), at: '2026-10-19T10:00:00.000Z' },
      k('session.exited', { hsid: hsidB, reason: 'drain-clean' }),
    ];
    const [c] = planResume(rows, TRUST).resume;
    expect(c).toMatchObject({ hsid: hsidB, principalClass: 'human', drainedAt: '2026-10-19T10:00:00.000Z' });
    // a forged refusal (not kernel-signed) changes nothing; the kernel's own does
    expect(planResume([...rows, { ...k('session.refused', { hsid: hsidB, code: 'spawn_failed', resume: 'cwd-gone' }, hsidB), keyId: 'key:other' }], TRUST).resume).toHaveLength(1);
    expect(planResume([...rows, k('session.refused', { hsid: hsidB, code: 'spawn_failed', resume: 'layers-changed' }, hsidB)], TRUST).resume).toEqual([]);
    // an open row without a class plans with '' (the resume then refuses not-human: never assumed 'human')
    const noClass = rows.map((x) => (x.kind === 'session.open' ? { ...x, payload: { ...x.payload, principalClass: undefined } } : x));
    expect(planResume(noClass, TRUST).resume[0]!.principalClass).toBe('');
  });

  it('8.0:model-switch: a switched (or reconciled) session resumes on `to` under its permit; a timeout or a forged row changes nothing', () => {
    const p2 = { ...permit, permitId: 'permit:v1:01HZZZZZZZZZZZZZZZZZZZZZZY', hsid: hsidB };
    const head: Row[] = [
      k('session.open', { hsid: hsidB, by: HUMAN, principalClass: 'human', cwd: '/x', backend: 'claude-code', uuid, model: 'haiku' }, hsidB),
      k('permit.grant', { permit: { ...permit, hsid: hsidB } }),
      k('session.sandbox', { hsid: hsidB, layersHash: 'sha256:aa', gitHash: 'sha256:bb', permitId: permit.permitId }, hsidB),
      k('permit.grant', { permit: p2 }),
    ];
    const tail: Row[] = [k('session.drained', { uuid, reason: 'upgrade' }, hsidB), k('session.exited', { hsid: hsidB, reason: 'drain-clean' })];
    const sw = (outcome: string, to = 'sonnet', permitId: string | null = p2.permitId) => k('session.model', { hsid: hsidB, from: 'haiku', to, permitId, outcome }, hsidB);
    const switched = planResume([...head, sw('switched'), ...tail], TRUST).resume[0]!;
    expect(switched).toMatchObject({ model: 'sonnet' });
    expect(switched.permit?.permitId).toBe(p2.permitId);
    const timedOut = planResume([...head, sw('timeout'), ...tail], TRUST).resume[0]!;
    expect(timedOut).toMatchObject({ model: 'haiku' });
    expect(timedOut.permit?.permitId).toBe(permit.permitId);
    expect(planResume([...head, sw('permit-refused', 'sonnet', null), ...tail], TRUST).resume[0]!.model).toBe('haiku');
    const reconciled = planResume([...head, sw('timeout'), sw('reconciled', 'sonnet', permit.permitId), ...tail], TRUST).resume[0]!;
    expect(reconciled).toMatchObject({ model: 'sonnet' });
    expect(reconciled.permit?.permitId).toBe(permit.permitId);
    expect(planResume([...head, { ...sw('switched'), keyId: 'key:other' }, ...tail], TRUST).resume[0]!.model).toBe('haiku');
  });
});
