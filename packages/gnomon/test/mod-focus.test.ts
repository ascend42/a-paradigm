/**
 * K3 (#paradigm-context-mod, #mod-host): the focus join is SERVER-SIDE. The GUI
 * sends `{focus:{hsid}}` as mod.view input; the host joins hsid → the live
 * session's cwd (focusCwd) and attaches the K1 slice to a mod granted
 * paradigm.read:summary. A relayed render with a forged repo, path, cwd or
 * paradigm slice is ignored: only the join picks the repo.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { unsandboxedModLauncher } from '../src/kernel/testing.js';
import { HOST_INPUT_KEYS } from '../src/kernel/modhost/index.js';
import { host, installStub, rig, type Rig } from './mod-helpers.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
const LIVE = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const GONE = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const HUMAN = { principal: 'p:abcdefgh/matt', connId: 'c1' };

function repos(r: Rig): { mine: string; other: string } {
  const mk = (name: string, title: string): string => {
    const root = path.join(r.root, 'repos', name);
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, '.paradigm', 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'decisions', 'TD-2026-10-20-001.yaml'), `id: TD-2026-10-20-001\ntimestamp: '2026-10-20T01:00:00.000Z'\ntitle: ${title}\n`);
    return root;
  };
  return { mine: mk('mine', 'MINE decision'), other: mk('other', 'OTHER decision') };
}

async function rigged() {
  const r = rig();
  cleanups.push(r.cleanup);
  const { mine, other } = repos(r);
  installStub(r, 'ctx', ['paradigm.read:summary']);
  installStub(r, 'plain', []);
  const joins: string[] = [];
  const { h } = host(r, { launcher: unsandboxedModLauncher }, { focusCwd: (hsid) => (joins.push(hsid), hsid === LIVE ? mine : null), userHome: path.join(r.root, 'nohome') });
  cleanups.push(() => h.stopAll());
  await h.start('ctx');
  await h.start('plain');
  const last = async (name: string) => ((await h.runCommand(name, `${name}.seen`, null)) as { last: Record<string, unknown> }).last;
  return { r, h, mine, other, joins, last };
}

describe('K3 server-side focus join', () => {
  it('{focus:{hsid}} of a live session ⇒ the slice of THAT session repo; the mod input is exactly {hsid, paradigm}', async () => {
    const w = await rigged();
    await w.h.relayView({ name: 'ctx', viewId: 'ctx.echo', input: { focus: { hsid: LIVE } }, ...HUMAN });
    const got = await w.last('ctx');
    expect(Object.keys(got).sort()).toEqual(['hsid', 'paradigm']);
    expect(got.hsid).toBe(LIVE);
    const p = got.paradigm as Record<string, unknown>;
    expect(p).toMatchObject({ v: 'paradigm-slice:v1', state: 'ok', name: 'mine' });
    expect(JSON.stringify(p)).toContain('MINE decision');
    expect(w.joins).toEqual([LIVE]);
  });

  it('a forged repo, path, cwd or paradigm slice in a relayed input is ignored (the repo is never chosen by the client)', async () => {
    const w = await rigged();
    const forged = { focus: { hsid: LIVE, repo: w.other, cwd: w.other }, repo: w.other, path: path.join(w.other, '.paradigm'), cwd: w.other, root: w.other, paradigm: { v: 'paradigm-slice:v1', state: 'ok', decisions: { items: [{ id: 'X', title: 'FORGED' }] } } };
    await w.h.relayView({ name: 'ctx', viewId: 'ctx.echo', input: forged, ...HUMAN });
    const got = await w.last('ctx');
    expect(Object.keys(got).sort()).toEqual(['hsid', 'paradigm']);
    const s = JSON.stringify(got);
    expect(s).toContain('MINE decision');
    expect(s).not.toMatch(/OTHER|FORGED/);
    expect(s).not.toContain(w.r.root); // no path reaches the mod
    // no focus at all, only a forged repo ⇒ unfocused (nothing read)
    await w.h.relayView({ name: 'ctx', viewId: 'ctx.echo', input: { repo: w.other, path: w.other }, ...HUMAN });
    expect(await w.last('ctx')).toEqual({ paradigm: { v: 'paradigm-slice:v1', state: 'unfocused' } });
  });

  it('a focus naming no live session (exited, unknown, malformed) gets the unfocused slice; the join is the only lookup', async () => {
    const w = await rigged();
    for (const focus of [{ hsid: GONE }, { hsid: '../../etc' }, { hsid: 42 }, 'x', null]) {
      await w.h.relayView({ name: 'ctx', viewId: 'ctx.echo', input: { focus }, ...HUMAN });
      expect(await w.last('ctx'), JSON.stringify(focus)).toEqual({ paradigm: { v: 'paradigm-slice:v1', state: 'unfocused' } });
    }
    expect(w.joins).toEqual([GONE]); // a malformed hsid is never even joined
  });

  it('a mod without paradigm.read:summary keeps its display input; host keys are host-composed (focus → hsid, paradigm dropped)', async () => {
    const w = await rigged();
    await w.h.relayView({ name: 'plain', viewId: 'plain.echo', input: { focus: { hsid: LIVE }, name: 'matt', paradigm: { state: 'ok' } }, ...HUMAN });
    expect(await w.last('plain')).toEqual({ name: 'matt', hsid: LIVE });
    await w.h.relayView({ name: 'plain', viewId: 'plain.echo', input: { hsid: LIVE }, ...HUMAN }); // the K0 form still works
    expect(await w.last('plain')).toEqual({ hsid: LIVE });
    expect(HOST_INPUT_KEYS).toEqual(['focus', 'hsid', 'paradigm']);
    expect(w.joins).toEqual([]); // no slice-less mod ever triggers a repo read
  });
});
