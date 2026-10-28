/**
 * G-LCL-29 (slice C6'a2-2): "/" skills of a CLAUDE session, served by the supervisor (request.session.skills.list /
 * request.session.skill.run through localSessionRequest) — a FAKE claude (test/fixtures/fake-claude.mjs) under the REAL
 * generated `session` profile, as test/session-supervisor.test.ts. The skills are the session's kernel-staged plugin;
 * with no slash probe the run is the kernel's template; with a probe that says the binary expands plugin skills it is
 * `/project:<name> <args>` (the probe runs once per binary sha256, on a canary in the kernel's scratch dir).
 */
// @gnomon-platform: darwin
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateKindPayload } from '@a-company/gnomon-contracts';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import type { ApprovalBroker } from '../src/kernel/broker/broker.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import type { SlashProbeInput } from '../src/kernel/supervisor/skill-run.js';
import { sessionWorld, trace, waitFor, type SessionWorld } from './session-helpers.js';

const SANDBOX_OK = darwinFloor().ok;
const HUMAN = 'p:abcdefgh/founder';
const human = { connId: 'c1', principal: HUMAN, principalClass: 'human', credential: 'gui' };
let w: SessionWorld;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

function rig(slashProbe?: (i: SlashProbeInput) => Promise<boolean>) {
  w = sessionWorld();
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
  const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  const broker = { raise: async () => ({ cardId: 'card:1' }) } as unknown as Pick<ApprovalBroker, 'raise'>;
  const sup = new SessionSupervisor({ log, children, fuse, broker, home: w.home, userHome: w.userHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.home, 'gnomon.sock'), claudePath: w.claude, env: () => ({ HOME: '/x', PATH: '/usr/bin:/bin' }), platform: 'darwin', watchMs: 200, allowScripts: true, ...(slashProbe ? { slashProbe } : {}), repoHookDecisions: () => new Map() });
  live.push(() => children.stopAll('test-end'));
  const skillDir = path.join(w.cwd, '.claude', 'skills');
  fs.mkdirSync(path.join(skillDir, 'tidy'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'tidy', 'SKILL.md'), '---\nname: tidy\ndescription: Tidy up\n---\nTidy $ARGUMENTS.\n');
  fs.mkdirSync(path.join(skillDir, 'hidden'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'hidden', 'SKILL.md'), '---\nname: hidden\nuser-invocable: false\n---\nNo.\n');
  fs.mkdirSync(path.join(skillDir, 'huge'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'huge', 'SKILL.md'), `---\nname: huge\n---\n${'word '.repeat(60_000)}\n`);
  const ask = (kind: string, p: Record<string, unknown>, asker: object = human) => sup.localSessionRequest(asker as never, kind, p);
  const sentTexts = () => trace(w).filter((t) => t.t === 'stdin' && (t.m as { type?: string }).type === 'user').map((t) => JSON.stringify((t.m as { message?: unknown }).message));
  return { rows, sup, ask, sentTexts, skillRows: () => rows.filter((r) => r.kind === 'skill.run').map((r) => r.payload) };
}

describe.skipIf(!SANDBOX_OK)('G-LCL-29 "/" skills of a Claude session', () => {
  it('lists the staged plugin and runs the kernel template when no probe says native', async () => {
    const r = rig();
    const s = await r.sup.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.cwd });
    try {
      const list = (await r.ask('request.session.skills.list', { hsid: s.hsid })) as { skills: Array<{ name: string; loaded: boolean }> };
      expect(list.skills.map((x) => [x.name, x.loaded])).toEqual([['hidden', false], ['huge', true], ['tidy', true]]);
      expect(await r.ask('request.session.skill.run', { hsid: s.hsid, name: 'hidden', args: '' })).toMatchObject({ status: 'refused', why: 'not-listed' });
      expect(await r.ask('request.session.skill.run', { hsid: s.hsid, name: 'tidy', args: 'x\ny' })).toMatchObject({ status: 'refused', why: 'bad-args' });
      // Aegis L3: a Claude session's skill is capped too
      const over = await r.ask('request.session.skill.run', { hsid: s.hsid, name: 'huge', args: '' });
      expect(over).toMatchObject({ status: 'refused', why: 'over-budget', limit: 100_000 });
      await expect(r.ask('request.session.skill.run', { hsid: s.hsid, name: 'tidy', args: '' }, { ...human, principal: 'p:abcdefgh/other' })).rejects.toThrow(/no such running session/);
      await expect(r.ask('request.session.skill.run', { hsid: s.hsid, name: 'tidy', args: '' }, { ...human, principalClass: 'agent' })).rejects.toThrow(/gui or device/);
      expect(await r.ask('request.session.skill.run', { hsid: s.hsid, name: 'tidy', args: 'the $& desk' })).toMatchObject({ status: 'ran', via: 'template' });
      expect(await waitFor(() => r.sentTexts().length === 1)).toBe(true);
      expect(r.sentTexts()[0]).toContain('The human ran repo skill tidy (from .claude/skills/tidy/SKILL.md, sha ');
      expect(r.sentTexts()[0]).toContain('Tidy the $& desk.');
      expect(r.skillRows().map((x) => [x.via, x.decision])).toEqual([['template', 'refused'], ['template', 'over-budget'], ['template', 'ran']]);
      for (const x of r.skillRows()) expect(validateKindPayload('skill.run', x)).toEqual([]);
    } finally {
      await r.sup.stop(HUMAN, { hsid: s.hsid });
    }
  }, 30_000);

  it('runs natively when the probe (once per binary sha) says the binary expands plugin skills', async () => {
    const probes: SlashProbeInput[] = [];
    const r = rig(async (i) => (probes.push(i), true));
    const s = await r.sup.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.cwd });
    try {
      expect(await r.ask('request.session.skill.run', { hsid: s.hsid, name: 'tidy', args: 'now' })).toMatchObject({ status: 'ran', via: 'native' });
      expect(await r.ask('request.session.skill.run', { hsid: s.hsid, name: 'tidy', args: '' })).toMatchObject({ status: 'ran', via: 'native' });
      expect(probes).toHaveLength(1);
      expect(probes[0]!.scratch.startsWith(path.join(w.home, 'probes'))).toBe(true);
      expect(probes[0]!.scratch.startsWith(w.cwd)).toBe(false);
      expect(await waitFor(() => r.sentTexts().length === 2)).toBe(true);
      expect(r.sentTexts()[0]).toContain('/project:tidy now');
      expect(r.skillRows().map((x) => x.via)).toEqual(['native', 'native']);
    } finally {
      await r.sup.stop(HUMAN, { hsid: s.hsid });
    }
  }, 30_000);
});
