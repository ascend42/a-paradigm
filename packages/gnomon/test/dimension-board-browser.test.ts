// @gnomon-platform: darwin
/**
 * #gui-board-dock against the REAL kernel, in a REAL browser (boards S1.3 pass P4b-1): the first time a board is
 * opened from the shipped app.
 *
 * A dev kernel in this process (`startDevKernel`, as the dimension dogfood), the real `gnomon.dimension` mod from its
 * pinned snapshot, a fake claude session so the kernel has a live session with a repo scope, and a headless Chrome
 * that loads the KERNEL-SERVED page (the pinned bundle, under the kernel's own CSP) from the web endpoint with a
 * launch token. Real input over the DevTools protocol: a press on the session, `/board` typed in the composer and
 * Enter, the rectangle tool, one drag. Then a second, node-side GUI client reads the log: the dimension's start row
 * (`command`, titled, relayed for a human on the GUI) and ONE op row adding a rect, which the page also shows.
 *
 * Darwin only: a session runs only under the darwin session profile, and Chrome is found at its macOS path.
 * Run it ALONE. A session starts only with System Integrity Protection on (darwinFloor, `floor: 'sip'`), and
 * GitHub's macOS runners have SIP off. On CI it runs only in the `gnomon-e2e-sip-stubbed` job (S1.4 P5, Aegis
 * ruling 1(a)): GNOMON_E2E_SIP_STUB=1 passes the test-only `sessionSipStub` seam (the SIP answer alone, the fake
 * claude only) and GNOMON_E2E_REQUIRED=1 makes a skip fail. The SIP-on proof stays the recorded local run.
 */
import * as path from 'node:path';
import { webcrypto } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_KINDS, dimHash, foldDim } from '@a-company/gnomon-contracts';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, shootLeaf } from '../../gnomon-gui/scripts/board-leaf-shots.mjs';
import { followLog, GnomonClient, type Transport } from '../../gnomon-gui/src/core/client.js';
import { CHECK_COPY } from '../../gnomon-gui/src/core/board-leaf.js';
import { DimStore } from '../../gnomon-gui/src/core/dim-store.js';
import { parseLaunchFragment } from '../../gnomon-gui/src/core/launch.js';
import { GuiStore, rowOf } from '../../gnomon-gui/src/core/store.js';
import { loadDevHome } from '../src/cli/dev-home.js';
import { runDevCommand, startDevKernel, type DevCliIo, type DevKernel } from '../src/cli/dev-cli.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { startDaemonForTest } from '../src/kernel/testing.js';
import { tempHome } from './daemon-helpers.js';
import { installDimension } from './dimension-helpers.js';
import { sessionWorld, waitFor, E2E_REQUIRED, E2E_SUPERVISOR_SEAMS, e2eFloorsOk, E2E_SIP_STUB, stubMarks, requireE2e } from './session-helpers.js';
import { GOOD, wsConnect } from './web-helpers.js';

const SANDBOX_OK = e2eFloorsOk('dimension-board-browser');
const CHROME = findChrome() as string | null;
const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
const quiet = (): DevCliIo => ({ stdin: new PassThrough(), stdout: { write: () => true }, stderr: { write: () => true } });

/** A raw RFC 6455 socket carrying the page's Origin + Sec-Fetch-Site, as the GUI client's Transport. */
async function transport(port: number): Promise<Transport & { drop(): void }> {
  const ws = await wsConnect(port, GOOD(port));
  cleanups.push(() => ws.end());
  const t: Transport & { drop(): void } = { send: (s) => ws.sendText(s), close: () => ws.end(), drop: () => ws.socket.destroy(), onMessage: null, onClose: null };
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
  }, 2);
  cleanups.push(() => clearInterval(timer));
  return t;
}


// the CI e2e job (GNOMON_E2E_REQUIRED=1) runs it on CI with the SIP stub; elsewhere on CI it still skips
requireE2e(!!CHROME, 'dimension-board-browser: Chrome');
describe.skipIf(!SANDBOX_OK || !CHROME || (!!process.env.CI && !E2E_REQUIRED))('#gui-board-dock in a real browser ⇄ the real kernel and the real gnomon.dimension mod', () => {
  it('the kernel-served app opens /board, a real drag draws one mark, and its row comes back through the followed log', async () => {
    const w = sessionWorld();
    cleanups.push(() => w.cleanup());
    const t = tempHome('db-');
    cleanups.push(() => removeTree(path.dirname(t.home)));
    const userHome = path.dirname(t.home);
    const devHome = path.join(userHome, 'devhome');
    expect(await runDevCommand(['init', '--home', devHome], quiet(), { userHome, host: 'mac-1' })).toBe(0);
    const dev = loadDevHome(devHome, { userHome });
    installDimension({ root: userHome, home: dev.home, auth: dev.root, events: [], cleanup: async () => undefined });
    const k: DevKernel = await startDevKernel(devHome, {
      userHome,
      start: (o) =>
        startDaemonForTest(o, {
          supervisor: { claudePath: w.claude, allowScripts: true, ...E2E_SUPERVISOR_SEAMS, userHome: w.userHome, env: () => ({ HOME: w.userHome, PATH: '/usr/bin:/bin' }) },
          billing: { env: () => ({}), layers: () => [] },
        }),
    });
    cleanups.push(() => k.stop());

    // a node-side GUI client: it opens the session the page will focus, and reads the log afterwards
    const g = await k.launch();
    const frag = parseLaunchFragment(new URL(g.url).hash)!;
    const client = new GnomonClient(await transport(g.port));
    const out = await client.connect({ surface: 'browser', endpointPath: `ws://127.0.0.1:${g.port}/rpc`, verifyKey: frag.kernelPublicKey, auth: { launchToken: frag.launchToken }, subtle });
    if (!out.ok) throw new Error(`connect: ${JSON.stringify(out)}`);
    const gui = new GuiStore();
    const dims = new DimStore();
    const take = (rows: unknown[]): void => {
      gui.apply(rows);
      dims.apply(rows.map((r) => rowOf(r)).filter((r) => r !== null));
    };
    client.onNotification((method, params) => {
      const row = method === 'event' ? (params as { row?: unknown } | null)?.row : undefined;
      if (row) take([row]);
    });
    await followLog(client, { cursor: () => gui.cursor(), adopt: (id: string) => gui.adopt(id), apply: take, advance: (n: number) => gui.advance(n), reset: () => (gui.reset(), dims.reset()) } as unknown as GuiStore);
    const session = await client.call<{ hsid: string; state: string }>('session.open', { cwd: w.cwd, attended: true });

    // the browser: the kernel-served page on its own launch token
    const page = await k.launch();
    const type = (s: string): unknown[] => [...s].map((key) => ({ key, settle: 30 }));
    const FACTS = `(() => { const l = document.querySelector('.bd-host .bd-leaf'); return { open: !!l, title: l ? l.querySelector('.title').textContent : null, line: l ? l.querySelector('.bd-keep').textContent : null, check: l ? (l.dataset.check ?? null) : null, inert: l ? (l.dataset.inert ?? '') : null, foot: l ? (l.querySelector('.bd-foot')?.textContent ?? null) : null, canvases: document.querySelectorAll('.bd-host canvas').length, engine: !!document.querySelector('.bd-host .excalidraw'), csp: globalThis.__csp, errs: globalThis.__errs, toasts: [...document.querySelectorAll('#toasts > *')].map((x) => x.textContent), reconnect: !document.getElementById('reconnect').hidden, link: document.getElementById('link')?.textContent ?? null }; })()`;
    const shot = (await shootLeaf({
      chrome: CHROME,
      url: page.url,
      width: 1440,
      height: 900,
      timeoutMs: 60_000,
      ready: `!!document.querySelector('#session-list [data-hsid="${session.hsid}"]')`,
      actions: [
        { read: "(globalThis.__errs = [], globalThis.__csp = [], addEventListener('error', (e) => globalThis.__errs.push(String(e.message))), document.addEventListener('securitypolicyviolation', (e) => globalThis.__csp.push(e.effectiveDirective + ' ' + e.blockedURI)), 1)", as: 'listening' },
        { press: `#session-list [data-hsid="${session.hsid}"]` }, { wait: 400 },
        { press: '#composer-text' }, ...type('/board'), { key: 'Enter' }, { wait: 6000 }, { read: FACTS, as: 'opened' },
        { press: '.bd-host [data-key="tool:rect"]' }, { drag: [[250, 200], [290, 225], [330, 250]] }, { wait: 2500 }, { read: FACTS, as: 'drawn' },
      ],
    })) as { png: Buffer; acted: Record<string, { open: boolean; title: string | null; line: string | null; check: string | null; inert: string | null; foot: string | null; canvases: number; engine: boolean; csp: string[]; errs: string[]; toasts: string[]; reconnect: boolean }> };
    if (process.env.GNOMON_SHOTS_DIR) (await import('node:fs')).writeFileSync(path.join(process.env.GNOMON_SHOTS_DIR, 's14b-real-kernel-board.png'), shot.png);
    const { opened, drawn } = shot.acted;
    process.stdout.write(`board in the real app, real kernel\n  opened: ${JSON.stringify(opened)}\n  drawn: ${JSON.stringify(drawn)}\n`);

    // the page: the leaf is open on the engine from the pinned chunk, under the kernel's CSP, with no error
    expect(opened).toMatchObject({ open: true, engine: true, inert: '', reconnect: false, csp: [], errs: [] });
    // the check in words (9ad03947): an open board with no mark has nothing to check yet
    expect(opened!.check).toBe(CHECK_COPY.empty);
    expect(drawn).toMatchObject({ open: true, inert: '', csp: [], errs: [] });
    expect(drawn!.foot).toMatch(/you 1/);
    // S1.4 P4b: the person's own dim.op ok answer is a hash point, so after the drag the board is checked to its last change
    expect(drawn!.check).toBe(CHECK_COPY.latest);

    // the log, read by the other client: one dimension of this session, opened by a typed command, holding ONE rect
    await waitFor(() => dims.list().some((l) => l.nodes === 1), 20_000, 20);
    const listing = dims.list();
    expect(listing).toHaveLength(1);
    const dim = listing[0]!.dim;
    expect(listing[0]).toMatchObject({ nodes: 1, ended: false, attached: [session.hsid] });
    expect(dims.lastDimOf(session.hsid)).toBe(dim);
    const rows = dims.rows(dim);
    expect(rows.map((r) => r.kind)).toEqual([DIM_KINDS.start, DIM_KINDS.op]);
    expect(stubMarks(k.handle.log.read({ reader: { class: 'human' }, kinds: ['session.sandbox', 'mod.sandbox'] }))).toEqual({ session: E2E_SIP_STUB, mod: E2E_SIP_STUB }); // S1.4 P5 review: sipStubbed exactly when this run stubbed SIP
    expect(rows[0]!.payload).toMatchObject({ opened: 'command', relayedFor: { surface: 'gui' } });
    expect(opened!.title).toBe(listing[0]!.title);
    const ops = (rows[1]!.payload as { ops: Array<{ type: string; node?: { kind: string } }> }).ops;
    expect(ops.map((o) => `${o.type}:${o.node?.kind}`)).toEqual(['add:rect']);
    const state = dims.stateAt(dim);
    expect([...state.nodes.values()].map((n) => n.by.cls)).toEqual(['human']);
    expect(dimHash(state)).toBe(dimHash(foldDim(rows as never)));
  }, 180_000);
});
