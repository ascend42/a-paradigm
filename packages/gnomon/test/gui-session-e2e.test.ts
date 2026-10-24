// @gnomon-platform: darwin
/**
 * #gui falsifier (dogfood 2026-10-19): the GUI showed "sessions 0 live · 0
 * seen" and no output while the kernel log held two answered sessions. Two
 * causes: the GUI store read `log.read` rows FLAT while the kernel sends the
 * contracts `LogRow` `{seq, view, event | stub}` (no kind, no session ⇒ every
 * row fell into the kernel feed), and a GUI launch-token connection read the
 * community-client projection, so the reply text (`turn.event`, a sensitive
 * column) reached it as stubs. §9.3: the GUI launch-token session is the
 * first-party human surface ⇒ the full human row.
 *
 * Real dev kernel (`startDevKernel`, the `gnomon dev up` path) → the launch
 * URL → the GUI's own client (packages/gnomon-gui/src/core/client.ts) over the
 * real web endpoint with `{launchToken}` (credential `gui`) → `followLog` into
 * a real `GuiStore` → session.open against the FAKE claude
 * (test/fixtures/fake-claude.mjs, never the real binary, never Anthropic) →
 * the store lists the session and shows the reply → a SECOND send reaches the
 * kernel (a second turn.sent). Darwin only: a session runs only under the
 * darwin session profile.
 */
import * as path from 'node:path';
import { webcrypto } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { followLog, GnomonClient, type Transport } from '../../gnomon-gui/src/core/client.js';
import { parseLaunchFragment } from '../../gnomon-gui/src/core/launch.js';
import { chatItems, GuiStore, rowSummary } from '../../gnomon-gui/src/core/store.js';
import { runDevCommand, startDevKernel, type DevCliIo, type DevKernel } from '../src/cli/dev-cli.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { startDaemonForTest } from '../src/kernel/testing.js';
import { tempHome } from './daemon-helpers.js';
import { sessionWorld, waitFor } from './session-helpers.js';
import { GOOD, wsConnect } from './web-helpers.js';

const SANDBOX_OK = darwinFloor().ok;
const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
const quiet = (): DevCliIo => ({ stdin: new PassThrough(), stdout: { write: () => true }, stderr: { write: () => true } });

/** A raw RFC 6455 socket carrying the page's Origin + Sec-Fetch-Site, as the GUI client's Transport. */
async function transport(port: number): Promise<Transport> {
  const ws = await wsConnect(port, GOOD(port));
  cleanups.push(() => ws.end());
  const t: Transport = { send: (s) => ws.sendText(s), close: () => ws.end(), onMessage: null, onClose: null };
  const timer = setInterval(() => {
    for (let i = 0; i < ws.frames.length; ) {
      const f = ws.frames[i]!;
      if (f.op === 0x1) {
        ws.frames.splice(i, 1);
        t.onMessage?.(f.payload.toString('utf8'));
      } else if (f.op === 0x8) {
        clearInterval(timer);
        return t.onClose?.(f.closeCode ?? 1005);
      } else i++;
    }
    if (ws.socket.destroyed) {
      clearInterval(timer);
      t.onClose?.(1006);
    }
  }, 5);
  cleanups.push(() => clearInterval(timer));
  return t;
}

describe.skipIf(!SANDBOX_OK)('#gui ⇄ real kernel: a GUI-credential page lists its session, shows the reply, sends again', () => {
  it('session list, reply text and a second send through the GUI client + store', async () => {
    const w = sessionWorld();
    cleanups.push(() => w.cleanup());
    const t = tempHome('gx-');
    cleanups.push(t.cleanup);
    const userHome = path.dirname(t.home);
    const devHome = path.join(userHome, 'devhome');
    expect(await runDevCommand(['init', '--home', devHome], quiet(), { userHome, host: 'mac-1' })).toBe(0);
    const k: DevKernel = await startDevKernel(devHome, {
      userHome,
      start: (o) =>
        startDaemonForTest(o, {
          supervisor: { claudePath: w.claude, allowScripts: true, userHome: w.userHome, env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }) },
          billing: { env: () => ({}), layers: () => [] },
        }),
    });
    cleanups.push(() => k.stop());

    // the page's launch: the fragment's token + kernel key, hello → serverSig → auth{launchToken} (credential gui)
    const g = await k.launch();
    const frag = parseLaunchFragment(new URL(g.url).hash)!;
    const c = new GnomonClient(await transport(g.port));
    const out = await c.connect({ surface: 'browser', endpointPath: `ws://127.0.0.1:${g.port}/rpc`, verifyKey: frag.kernelPublicKey, auth: { launchToken: frag.launchToken }, subtle });
    expect(out.ok, JSON.stringify(out)).toBe(true);

    // what app.ts does: backlog + follow into the store; each `event` notification's row applied as it arrives
    const store = new GuiStore();
    c.onNotification((method, params) => {
      if (method !== 'event') return;
      const p = (params ?? {}) as { row?: unknown };
      if (p.row) store.apply([p.row]);
    });
    await followLog(c, store);

    // the composer's session.open, then the first send
    const opened = await c.call<{ hsid: string; state: string }>('session.open', { cwd: w.cwd, attended: true });
    expect(opened.state).toBe('running');
    await c.call('session.send', { hsid: opened.hsid, content: [{ text: 'first from the gui' }] });

    const results = (): number => store.transcript(opened.hsid).filter((r) => r.kind === 'turn.result').length;
    expect(await waitFor(() => results() >= 1, 20_000), JSON.stringify(store.transcript(opened.hsid).map((r) => r.kind))).toBe(true);

    // the sidebar: the session is listed, under its project, live
    const listed = store.groups().flatMap((gr) => gr.sessions);
    expect(listed.map((s) => s.hsid)).toContain(opened.hsid);
    expect(['open', 'streaming', 'idle']).toContain(store.sessions.get(opened.hsid)!.state);
    // the transcript: the reply TEXT (turn.event, a sensitive column) is a full row for the GUI, not a stub
    const lines = store.transcript(opened.hsid);
    expect(lines.some((r) => r.kind === 'session.open')).toBe(true);
    expect(lines.filter((r) => r.kind === 'turn.event').every((r) => r.view === 'full')).toBe(true);
    expect(lines.map(rowSummary)).toContain('assistant · hi');
    // the user's own injected message is visible too (session.inject, a sensitive column)
    expect(lines.some((r) => r.kind === 'session.inject' && r.view === 'full')).toBe(true);

    // a SECOND send reaches the kernel: a second turn.sent and a second result
    await c.call('session.send', { hsid: opened.hsid, content: [{ text: 'second from the gui' }] });
    expect(await waitFor(() => results() >= 2, 20_000)).toBe(true);
    expect(store.transcript(opened.hsid).filter((r) => r.kind === 'turn.sent')).toHaveLength(2);
    expect(store.liveCount()).toBe(1);

    // the chat view (dogfood round 2): the conversation in order, the hook/partial/rate-limit noise hidden
    const chat = chatItems(store.transcript(opened.hsid)).items.map((i) => [i.role, i.text]);
    const conv = chat.filter(([role]) => role === 'user' || role === 'assistant');
    expect(conv).toEqual([['user', 'first from the gui'], ['assistant', 'hi'], ['user', 'second from the gui'], ['assistant', 'hi']]);
    expect(chat.filter(([role]) => role === 'result')).toHaveLength(2);
    expect(chat.map(([, text]) => text).join('\n')).not.toMatch(/hook_started|stream_event|rate_limit/);
  }, 90_000);
});
