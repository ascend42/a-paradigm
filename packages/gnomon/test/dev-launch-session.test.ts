// @gnomon-platform: darwin
/**
 * #dev-launch end-to-end smoke (spec §2.4 rule 6): `gnomon dev init` → the dev
 * kernel (`startDevKernel`, the same path as `gnomon dev up`) → the GUI launch
 * URL from the in-process `gnomon open` path → a SECOND client connects as the
 * registered human device → session.open against the FAKE claude
 * (test/fixtures/fake-claude.mjs, never the real binary, never Anthropic)
 * under the real darwin `session` profile → session.send → the reply is read
 * back through log.read. No approval is needed on this path.
 *
 * The only test seam is the daemon slot of the internal test entry: the
 * supervisor runs a `#!` script claude from a throwaway user home, and the
 * law-7 billing scan reads an empty env (the test runner's own env is not the
 * subject). Everything else is the production `gnomon dev up` path.
 */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GnomonClient } from '../src/clients/ts/index.js';
import { runDevCommand, startDevKernel, type DevCliIo, type DevKernel } from '../src/cli/dev-cli.js';
import { startDaemonForTest } from '../src/kernel/testing.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { tempHome } from './daemon-helpers.js';
import { sessionWorld, trace } from './session-helpers.js';
import { PassThrough } from 'node:stream';

/** capability, not platform: below the macOS floor or with SIP off the session profile refuses every open */
const SANDBOX_OK = darwinFloor().ok;

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const quiet = (): DevCliIo => ({ stdin: new PassThrough(), stdout: { write: () => true }, stderr: { write: () => true } });

/** A page row: `full` carries the event; a `stub` (sensitive kinds for a community-client reader) only {kind, hsid, at, hash}. */
type Row = { seq: number; view?: string; event?: { kind: string; payload?: Record<string, unknown> }; stub?: { kind?: string; hsid?: string } };
const kindOf = (r: Row): string | undefined => r.event?.kind ?? r.stub?.kind;
const hsidOf = (r: Row): unknown => r.event?.payload?.hsid ?? r.stub?.hsid;
const payloadOf = (r: Row): Record<string, unknown> => r.event?.payload ?? {};

describe.skipIf(!SANDBOX_OK)('#dev-launch smoke: dev init → dev kernel → device → session.open/send → reply', () => {
  it('a fake-claude session answers end to end, with no approval on the path', async () => {
    const w = sessionWorld();
    cleanups.push(() => w.cleanup());
    const t = tempHome('gs-');
    cleanups.push(t.cleanup);
    const userHome = path.dirname(t.home); // the production home would be <userHome>/.gnomon; the dev home is beside it
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

    // the GUI launch path (`gnomon open`, §11.2 rule 2): a single-use token and the kernel key in the fragment
    const g = await k.launch();
    expect(g.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#launch=[A-Za-z0-9_-]{43}&k=[A-Za-z0-9_-]+$/);
    expect(g.port).toBeGreaterThan(0);

    // a second client, as the registered human device (what the GUI session acts as)
    const c = await GnomonClient.connect({ socketPath: k.handle.pidfile.socketPath, client: { name: 'dev-smoke', version: '0', surface: 'cli' }, kernelKey: k.dev.kernelKey, credential: k.dev.device });
    cleanups.push(() => c.close());
    expect(c.principal).toBe(k.dev.device.principalId);

    const opened = (await c.call('session.open', { cwd: w.cwd, attended: true })) as { hsid: string; backend: string; state: string; binaryPin?: string };
    expect(opened.backend).toBe('claude-code');
    expect(opened.state).toBe('running');
    expect(opened.binaryPin).toMatch(/^first-use pin /);
    const sent = (await c.call('session.send', { hsid: opened.hsid, content: [{ text: 'hello from the dev smoke' }] })) as { turn: string };
    expect(typeof sent.turn).toBe('string');

    // the reply, read back through the API the GUI uses
    const rows: Row[] = [];
    let since: unknown; // journal.cursor: the page's {logId, seq}
    const deadline = Date.now() + 10_000;
    while (!rows.some((r) => kindOf(r) === 'turn.result' && hsidOf(r) === opened.hsid) && Date.now() < deadline) {
      const page = (await c.call('log.read', { ...(since ? { since } : {}), kinds: ['turn.event', 'turn.result', 'session.refused', 'approval.request'] })) as { rows: Row[]; cursor: unknown };
      rows.push(...page.rows);
      since = page.cursor;
      await new Promise((r) => setTimeout(r, 50));
    }
    const mine = rows.filter((r) => hsidOf(r) === opened.hsid);
    const result = mine.find((r) => kindOf(r) === 'turn.result');
    expect(result, JSON.stringify(mine.map(kindOf))).toBeDefined();
    expect(payloadOf(result!).isError).toBe(false);
    // a socket device connection is a community-client reader (§9.3): the reply's turn.event rows reach it as stubs
    // — kind + hsid only. The full text is for a first-party surface (the GUI's launch-token session).
    expect(mine.filter((r) => kindOf(r) === 'turn.event').length).toBeGreaterThan(0);
    expect(mine.filter((r) => kindOf(r) === 'turn.event').every((r) => r.view === 'stub' && r.event === undefined)).toBe(true);
    // the reply text itself, from the kernel's own full view of the same rows
    const lines: string[] = [];
    for (const v of k.handle.log.read({ reader: { class: 'human' }, kinds: ['turn.event'] })) {
      const pl = v.view === 'full' ? (v.event.payload as { hsid?: string; type?: string; line?: string }) : undefined;
      if (pl?.hsid === opened.hsid && pl.type === 'assistant' && typeof pl.line === 'string') lines.push(pl.line);
    }
    expect(lines.some((l) => l.includes('"text":"hi"'))).toBe(true);
    expect(mine.some((r) => kindOf(r) === 'session.refused')).toBe(false);
    expect(rows.some((r) => kindOf(r) === 'approval.request')).toBe(false); // no card was needed
    // the fake claude really received the user line through the sandboxed child
    expect(trace(w).some((e) => e.t === 'stdin' && JSON.stringify(e.m).includes('hello from the dev smoke'))).toBe(true);
  }, 60_000);
});
