// @gnomon-platform: darwin
/**
 * #kernel-mcp end to end through the #supervisor and the FAKE claude (never the real one), under the real session
 * profile: the session's mcp.json carries the kernel's SDK server `gnomon`, the appended system prompt names the verbs,
 * the can_use_tool request for a kernel tool passes with an approval.auto{modeRef:'kernel-verb'} row (no second card),
 * an mcp_message tools/call runs gnomon_git_init in the session's fresh folder, and another server name is a control
 * error. The founder's field case: a fresh folder becomes a repo with no sandbox error.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import { GitVerbs } from '../src/kernel/git/kernel-verbs.js';
import { sessionWorld, setMode, trace, waitFor, type SessionWorld } from './session-helpers.js';

const HUMAN = 'p:abcdefgh/founder';
let w: SessionWorld;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

describe.skipIf(!darwinFloor().ok)('#kernel-mcp through a session', () => {
  it('the gnomon SDK server is in mcp.json, the guidance in argv, a kernel tool passes once and tools/call makes the repo', async () => {
    w = sessionWorld();
    fs.rmSync(path.join(w.cwd, '.git'), { recursive: true });
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => void rows.push({ kind, payload });
    const kernel = SoftwareEd25519Signer.generate('kernel');
    const fuse = new BudgetFuse({ kernel, logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
    const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
    const raised: unknown[] = [];
    const autos: Array<Record<string, unknown>> = [];
    const broker = { raise: async (x: unknown) => (raised.push(x), { cardId: 'card:01JAAAAAAAAAAAAAAAAAAAAAAA' }), decisionOf: async () => 'deny', auto: async (p: Record<string, unknown>) => void autos.push(p), expire: async () => true } as never;
    const gitVerbs = new GitVerbs({ log, broker, gnomonHome: w.home, userHome: () => w.userHome });
    const sup = new SessionSupervisor({ log, children, fuse, broker, home: w.home, userHome: w.userHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.home, 'gnomon.sock'), claudePath: w.claude, env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }), platform: 'darwin', watchMs: 10_000, allowScripts: true, runMode: () => ({ effective: 'auto-edits' as never, ceiling: 'auto-edits' as never }), gitVerbs });
    live.push(() => children.stopAll('test-end'));
    const call = (id: string, server: string, message: unknown) => ({ line: { type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: server, message } } });
    setMode(w, {
      permissionAsk: {
        hold: true,
        steps: [
          call('m-init', 'gnomon', { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
          call('m-list', 'gnomon', { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
          { request: { id: 'p-1', tool: 'mcp__gnomon__gnomon_git_init', input: {} } },
          call('m-call', 'gnomon', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'gnomon_git_init', arguments: {} } }),
          call('m-other', 'evil', { jsonrpc: '2.0', id: 3, method: 'tools/list' }),
        ],
      },
    });
    const s = await sup.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.cwd });
    await sup.send(HUMAN, { hsid: s.hsid, text: 'make this a repo' });
    expect(await waitFor(() => trace(w).filter((t) => t.t === 'mcp-answer').length >= 4 && trace(w).some((t) => t.t === 'perm-answer' && t.id === 'p-1'), 15_000)).toBe(true);
    const argv = trace(w).find((t) => t.t === 'argv')!.args as string[];
    const mcpPath = argv[argv.indexOf('--mcp-config') + 1]!;
    expect(JSON.parse(fs.readFileSync(mcpPath, 'utf8')).mcpServers.gnomon).toEqual({ type: 'sdk', name: 'gnomon' });
    expect(argv[argv.indexOf('--append-system-prompt') + 1]).toMatch(/gnomon_git_init/);
    const ans = Object.fromEntries(trace(w).filter((t) => t.t === 'mcp-answer').map((t) => [String(t.id), t]));
    expect(ans['m-init']!.mcp).toMatchObject({ id: 0, result: { serverInfo: { name: 'gnomon' } } });
    expect((ans['m-list']!.mcp as { result: { tools: unknown[] } }).result.tools).toHaveLength(5);
    expect(ans['m-call']!.mcp).toMatchObject({ id: 2, result: { isError: false } });
    expect(ans['m-other']).toMatchObject({ subtype: 'error' });
    expect(trace(w).find((t) => t.t === 'perm-answer' && t.id === 'p-1')).toMatchObject({ behavior: 'allow' });
    expect(autos.map((a) => a.modeRef)).toEqual(expect.arrayContaining(['kernel-verb', 'mode:auto-edits']));
    expect(raised).toHaveLength(0);
    expect(fs.readFileSync(path.join(w.cwd, '.git', 'HEAD'), 'utf8').trim()).toBe('ref: refs/heads/main');
    expect(rows.filter((r) => r.kind === 'git.verb').map((r) => r.payload.phase)).toEqual(['requested', 'ran']);
    expect(rows.some((r) => r.kind === 'session.inject' && r.payload.channel === 'kernel-mcp')).toBe(true);
  }, 30_000);
});
