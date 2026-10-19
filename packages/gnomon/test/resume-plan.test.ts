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
});
