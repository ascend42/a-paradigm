/**
 * #gnomon-voice TABLE TALK S2 through the REAL supervisor and the fake claude (TD-2026-10-20-294): while voice is
 * attached to the session, every send carries the guidance as a SECOND text block of the user message; turn.sent
 * names it by guidanceHash; contentHash stays the hash of the human's text alone, so replay binds the inject and the
 * turn with no divergence and `gnomon trace` checks only the first text block. Nothing is injected when not attached.
 */
// @gnomon-platform: darwin
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { SessionSupervisor, turnContentHash } from '../src/kernel/supervisor/supervisor.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { foldReplay } from '../src/kernel/log/index.js';
import { TABLE_TALK_GUIDANCE, TABLE_TALK_GUIDANCE_HASH } from '../src/kernel/voice/table-talk.js';
import { extrasAgree, promptExtraHashes, promptText } from '../src/cli/trace-cli.js';
import { composeGuidance, deskGuidance } from '../src/kernel/desk/desk-guidance.js';
import { mergeDeskMcp } from '../src/kernel/desk/mcp-passthrough.js';
import { guidanceHashOf } from '../src/kernel/voice/table-talk.js';
import { deskMod } from './desk-fixtures.js';
import { sessionWorld, trace, waitFor, type SessionWorld } from './session-helpers.js';

const SANDBOX_OK = darwinFloor().ok;
const HUMAN = 'p:abcdefgh/founder';
let w: SessionWorld;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

function rig() {
  w = sessionWorld();
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
    rows.push({ kind, payload });
  };
  const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  const sup = new SessionSupervisor({
    log, children, fuse, home: w.home, userHome: w.userHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.home, 'gnomon.sock'), claudePath: w.claude,
    env: () => ({ HOME: '/x', PATH: '/usr/bin:/bin' }), platform: 'darwin', watchMs: 200, allowScripts: true,
  });
  live.push(() => children.stopAll('test-end'));
  return { rows, sup, kinds: (k: string) => rows.filter((r) => r.kind === k) };
}
const userLines = () => trace(w).filter((t) => t.t === 'stdin' && (t.m as { type?: string }).type === 'user').map((t) => (t.m as { message: { content: Array<{ type: string; text: string }> } }).message.content);
const asRows = (rows: Array<{ kind: string; payload: Record<string, unknown> }>) => rows.map((r, i) => ({ seq: i + 1, kind: r.kind, hash: `h${i + 1}`, envelope: JSON.stringify({ log: 'log:x', kind: r.kind, payload: r.payload }) }));

describe.runIf(SANDBOX_OK)('#gnomon-voice table talk S2: the supervisor injects the guidance while voice is attached', () => {
  it('not attached: one text block, no guidanceHash; attached: a second <gnomon-voice> block on every turn; contentHash unchanged; replay clean', async () => {
    const r = rig();
    let attached: string | null = null;
    r.sup.setVoiceGuidance((hsid) => (hsid === attached ? TABLE_TALK_GUIDANCE : null));
    const s = await r.sup.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.cwd });

    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'typed, not attached' });
    expect(await waitFor(() => r.kinds('turn.result').length === 1)).toBe(true);
    attached = s.hsid;
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'typed while attached' });
    expect(await waitFor(() => r.kinds('turn.result').length === 2)).toBe(true);
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'second turn while attached' });
    expect(await waitFor(() => r.kinds('turn.result').length === 3)).toBe(true);
    attached = 'hs:someone-else';
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'after detach' });
    expect(await waitFor(() => r.kinds('turn.result').length === 4)).toBe(true);

    const lines = userLines();
    expect(lines).toEqual([
      [{ type: 'text', text: 'typed, not attached' }],
      [{ type: 'text', text: 'typed while attached' }, { type: 'text', text: TABLE_TALK_GUIDANCE }],
      [{ type: 'text', text: 'second turn while attached' }, { type: 'text', text: TABLE_TALK_GUIDANCE }],
      [{ type: 'text', text: 'after detach' }],
    ]);
    const sent = r.kinds('turn.sent').map((x) => x.payload);
    expect(sent.map((p) => p.guidanceHash)).toEqual([undefined, TABLE_TALK_GUIDANCE_HASH, TABLE_TALK_GUIDANCE_HASH, undefined]);
    // contentHash is the hash of the human's text only, equal to the inject's hash and to the trace check's first block
    const texts = ['typed, not attached', 'typed while attached', 'second turn while attached', 'after detach'];
    expect(sent.map((p) => p.contentHash)).toEqual(texts.map(turnContentHash));
    expect(r.kinds('session.inject').map((x) => x.payload.hash)).toEqual(texts.map(turnContentHash));
    expect(lines.map((c) => turnContentHash(promptText(c)!))).toEqual(texts.map(turnContentHash));
    // replay: every turn.sent binds to its inject; no divergence
    const replayRows = asRows(r.rows.filter((x) => x.kind === 'session.inject' || x.kind === 'turn.sent'));
    expect(foldReplay(replayRows).divergences).toEqual([]);
  }, 60_000);

  it('the Desk (TD-2026-10-20-812): voice + desk travel as ONE composite block under one guidanceHash; desk mcp servers reach mcp.json', async () => {
    w = sessionWorld();
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
      rows.push({ kind, payload });
    };
    const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
    const desk = deskGuidance([{ name: 'constellation', offers: [{ kind: 'map-the-idea', phase: 'diverge', title: 'Map it' }] }])!;
    const sup = new SessionSupervisor({
      log, children, fuse, home: w.home, userHome: w.userHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.home, 'gnomon.sock'), claudePath: w.claude,
      env: () => ({ HOME: '/x', PATH: '/usr/bin:/bin' }), platform: 'darwin', watchMs: 200, allowScripts: true,
      deskMcp: (repo) => mergeDeskMcp(repo, [deskMod('constellation')]).servers,
    });
    live.push(() => children.stopAll('test-end'));
    sup.setTurnGuidance(() => composeGuidance(TABLE_TALK_GUIDANCE, desk));
    const s = await sup.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.cwd });
    await sup.send(HUMAN, { hsid: s.hsid, text: 'with the desk' });
    await sup.send(HUMAN, { hsid: s.hsid, text: 'Open Map it: use the open_board tool.', origin: 'kernel' });
    expect(await waitFor(() => rows.filter((r) => r.kind === 'turn.result').length === 2)).toBe(true);
    const both = composeGuidance(TABLE_TALK_GUIDANCE, desk)!;
    const lines = userLines();
    expect(lines[0]).toEqual([{ type: 'text', text: 'with the desk' }, { type: 'text', text: both }]);
    const sent = rows.filter((r) => r.kind === 'turn.sent').map((r) => r.payload);
    expect(sent.map((p) => p.guidanceHash)).toEqual([guidanceHashOf(both), guidanceHashOf(both)]);
    expect(extrasAgree(promptExtraHashes(lines[0]), sent[0]!.guidanceHash as string)).toBe(true);
    expect(rows.filter((r) => r.kind === 'session.inject').map((r) => r.payload.origin)).toEqual(['client', 'kernel']);
    const dirs = fs.readdirSync(path.join(w.home, 'sessions'));
    const mcp = JSON.parse(fs.readFileSync(path.join(w.home, 'sessions', dirs[0]!, 'mcp.json'), 'utf8'));
    expect(Object.keys(mcp.mcpServers)).toContain('gnomon-constellation');
  }, 60_000);
});
