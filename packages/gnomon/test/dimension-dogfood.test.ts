// @gnomon-platform: darwin
/**
 * #gui-dim-session dogfood (boards S1.3 pass P4a; draft point 9 "Dogfood"): the LIVE loop of the GUI against the
 * REAL kernel and the REAL dimension mod.
 *
 * Everything between the page's modules and the log is the real code: a dev kernel in this process
 * (`startDevKernel`, the `gnomon dev up` path), its web endpoint, a launch token, the GUI's own client
 * (gnomon-gui core/client.ts) on a real WebSocket, `followLog`, the kernel's `mod.command` relay with its gesture
 * check, the kernel's mod host starting `gnomon.dimension` from its pinned snapshot under the mod sandbox profile,
 * the mod's appends through the kernel's clamp and budget, and the rows coming back on the followed log. The page
 * side is the session of gnomon-gui core/dim-session.ts with its DimStore, DimLive, the one sender and real gesture
 * stamps. What is NOT real: there is no browser, so the "trusted event" is an object with `isTrusted: true` (the
 * stamp is minted by the real `gestureOf`), there is no board engine (ops are given as ops), and the session is a
 * fake claude (test/fixtures/fake-claude.mjs), opened only so the kernel has a live session with a repo scope.
 *
 * Darwin only: a session runs only under the darwin session profile.
 */
import * as path from 'node:path';
import { webcrypto } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_KINDS, dimHash, foldDim, type DimOp } from '@a-company/gnomon-contracts';
import { GRANT_COPY } from '../../gnomon-gui/src/core/board-leaf.js';
import { followLog, GnomonClient, type Transport } from '../../gnomon-gui/src/core/client.js';
import { DIM_SEND_LIMITS, DimSessions, modAnswerOf, type DimSession, type DimSessionNotice } from '../../gnomon-gui/src/core/dim-session.js';
import { DimStore } from '../../gnomon-gui/src/core/dim-store.js';
import { gestureOf } from '../../gnomon-gui/src/core/gesture.js';
import { parseLaunchFragment } from '../../gnomon-gui/src/core/launch.js';
import { sendModCommand } from '../../gnomon-gui/src/core/mod-command.js';
import { GuiStore } from '../../gnomon-gui/src/core/store.js';
import { loadDevHome } from '../src/cli/dev-home.js';
import { runDevCommand, startDevKernel, type DevCliIo, type DevKernel } from '../src/cli/dev-cli.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { startDaemonForTest } from '../src/kernel/testing.js';
import { tempHome } from './daemon-helpers.js';
import { DIMENSION, dimId, installDimension, ulid } from './dimension-helpers.js';
import { sessionWorld, waitFor, E2E_SUPERVISOR_SEAMS, e2eFloorsOk, E2E_SIP_STUB, stubMarks, requireE2e } from './session-helpers.js';
import { GOOD, wsConnect } from './web-helpers.js';

const SANDBOX_OK = e2eFloorsOk('dimension-dogfood');
const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
const quiet = (): DevCliIo => ({ stdin: new PassThrough(), stdout: { write: () => true }, stderr: { write: () => true } });
/** What a trusted DOM event is to the stamp: there is no browser here. */
const press = (type = 'pointerup'): Event => ({ isTrusted: true, type }) as unknown as Event;
const rect = (n: number, more: Record<string, unknown> = {}): DimOp => ({ type: 'add', node: { id: ulid(n), kind: 'rect', x: n, y: n, z: 'V', w: 10, h: 10, ...more } }) as unknown as DimOp;
const words = (n: number, chars: number): DimOp => ({ type: 'add', node: { id: ulid(n), kind: 'text', x: n, y: 0, z: 'V', text: 'w'.repeat(chars) } }) as unknown as DimOp;

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

/** One page: its stores, its sessions, and (per connection) its client. What ui/app.ts will hold. */
interface Page {
  gui: GuiStore;
  dims: DimStore;
  sessions: DimSessions;
  client: GnomonClient;
  connId: string;
  principal: string;
  drop: () => void;
  /** hold the followed rows back (a tab that has not caught up) and let them go */
  hold(on: boolean): void;
  /** when each relay command left this page, by its command id */
  sent: Array<{ at: number; commandId: string }>;
  notices: DimSessionNotice[];
  watch(s: DimSession): DimSession;
}

async function connect(k: DevKernel, page: Pick<Page, 'gui' | 'dims' | 'sessions' | 'sent' | 'notices'> & { held: unknown[][] | null }): Promise<{ client: GnomonClient; connId: string; principal: string; drop: () => void }> {
  const g = await k.launch();
  const frag = parseLaunchFragment(new URL(g.url).hash)!;
  const t = await transport(g.port);
  const client = new GnomonClient(t);
  const out = await client.connect({ surface: 'browser', endpointPath: `ws://127.0.0.1:${g.port}/rpc`, verifyKey: frag.kernelPublicKey, auth: { launchToken: frag.launchToken }, subtle });
  if (!out.ok) throw new Error(`connect: ${JSON.stringify(out)}`);
  // count what leaves the page, on the client object itself (the stamp is numbered per client object)
  const call = client.call.bind(client);
  client.call = ((method: string, params?: unknown) => {
    if (method !== 'log.read') page.sent.push({ at: Date.now(), commandId: String((params as { commandId?: string } | undefined)?.commandId ?? method) });
    return call(method, params);
  }) as typeof client.call;
  // what the app does: every followed row goes to the GUI store AND to the dimension sessions
  const take = (rows: unknown[]): void => {
    page.gui.apply(rows);
    if (page.held) page.held.push(rows);
    else page.sessions.apply(rows);
  };
  client.onNotification((method, params) => {
    if (method !== 'event') return;
    const p = (params ?? {}) as { row?: unknown };
    if (p.row) take([p.row]);
  });
  client.onClose(() => page.sessions.linkDown());
  const both = { cursor: () => page.gui.cursor(), adopt: (id: string) => page.gui.adopt(id), apply: take, advance: (n: number) => page.gui.advance(n), reset: () => (page.gui.reset(), page.sessions.reset()) } as unknown as GuiStore;
  await followLog(client, both);
  return { client, connId: out.session.connId, principal: out.session.principal, drop: () => t.drop() };
}

async function openPage(k: DevKernel): Promise<Page> {
  const dims = new DimStore();
  const state = { gui: new GuiStore(), dims, sessions: new DimSessions({ store: dims }), sent: [] as Page['sent'], notices: [] as DimSessionNotice[], held: null as unknown[][] | null };
  const c = await connect(k, state);
  state.sessions.connect({ client: c.client, principal: c.principal, connId: c.connId });
  cleanups.push(() => state.sessions.destroy());
  const page: Page = {
    ...state,
    ...c,
    hold(on) {
      if (on) return void (state.held = []);
      const held = state.held ?? [];
      state.held = null;
      for (const rows of held) state.sessions.apply(rows);
    },
    watch(s) {
      s.onChange((ch) => void (ch.notice && state.notices.push(ch.notice)));
      return s;
    },
  };
  (page as unknown as { state: typeof state }).state = state;
  return page;
}

/** A new connection for a page whose socket closed: the store resumes from its cursor, the sessions are rebuilt. */
async function reconnect(k: DevKernel, page: Page): Promise<DimSession[]> {
  const state = (page as unknown as { state: Parameters<typeof connect>[1] }).state;
  const c = await connect(k, state);
  Object.assign(page, c);
  return page.sessions.connect({ client: c.client, principal: c.principal, connId: c.connId });
}

const saved = (s: DimSession, ms = 20_000): Promise<boolean> => waitFor(() => s.status().pending === 0, ms, 5);

describe.skipIf(!SANDBOX_OK)('#gui-dim-session ⇄ the real kernel and the real gnomon.dimension mod (S1.3 dogfood)', () => {
  it('open, draw, rows through the followed log, refusal, undo, two tabs, disconnect and reconnect with equal hashes, and spaced sends', async () => {
    const w = sessionWorld();
    cleanups.push(() => w.cleanup());
    const t = tempHome('dd-');
    // removeTree: a pinned mod snapshot is read-only, so a plain recursive remove stops at it
    cleanups.push(() => removeTree(path.dirname(t.home)));
    const userHome = path.dirname(t.home);
    const devHome = path.join(userHome, 'devhome');
    expect(await runDevCommand(['init', '--home', devHome], quiet(), { userHome, host: 'mac-1' })).toBe(0);
    // the REAL mod tree, installed through the real card path under this home's root, before the kernel starts
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
    const report: string[] = [];
    const say = (line: string): void => void report.push(line);

    /* ── tab A opens a dimension ─────────────────────────────────────────── */
    const A = await openPage(k);
    const session = await A.client.call<{ hsid: string; state: string }>('session.open', { cwd: w.cwd, attended: true });
    const hsid = session.hsid;
    const dim = dimId(1);
    let a = A.watch(A.sessions.open({ dim, hsid, opened: 'command', title: 'Dogfood' }, press('click')));
    expect(await a.opened(), JSON.stringify(a.lastNotice())).toBe(true);
    expect(k.handle.mods.running()).toContain(DIMENSION);
    expect(stubMarks(k.handle.log.read({ reader: { class: 'human' }, kinds: ['session.sandbox', 'mod.sandbox'] }))).toEqual({ session: E2E_SIP_STUB, mod: E2E_SIP_STUB }); // S1.4 P5 review: sipStubbed exactly when this run stubbed SIP
    expect(await waitFor(() => a.status().verified === true, 10_000, 5)).toBe(true);
    expect(a.status()).toMatchObject({ phase: 'open', title: 'Dogfood', keep: 'saved', link: 'up' });
    // S1.4 P4b (Aegis D1, N-9): this open MADE the dimension, so the first attached session's default grant is said
    // ONCE, and nothing else is; the board dock says it as these words (one Claude session: 'Claude')
    expect(A.notices).toEqual([{ about: 'grant', code: 'grant-default', field: 'write', why: null, lost: 0, hsid, write: true }]);
    expect(GRANT_COPY.spokenOn('Claude')).toBe('Claude may edit this board: it can change and remove any mark');
    A.notices.length = 0;
    say(`open: dim.open accepted on stamp 1; the start row came back on the followed log at seq ${a.status().seq}; the fold hashes as the mod said`);

    /* ── ops through sendModCommand with real stamps; rows through the followed log ── */
    a.edit([rect(1), rect(2, { label: 'two' })], press());
    expect(a.view().nodes.size).toBe(2); // optimistic
    expect(a.status().keep).toBe('saving');
    expect(await saved(a)).toBe(true);
    expect(A.notices).toEqual([]);
    const rowsA = A.dims.rows(dim);
    expect(rowsA.map((r) => r.kind)).toEqual([DIM_KINDS.start, DIM_KINDS.op]);
    expect((rowsA[1]!.payload as { relayedFor: unknown }).relayedFor).toEqual({ principal: A.principal, connId: A.connId, surface: 'gui' });
    expect(JSON.stringify(rowsA)).not.toContain('gesture');
    expect([...A.dims.stateAt(dim).nodes.values()].map((n) => n.by)).toEqual([{ cls: 'human', principal: A.principal }, { cls: 'human', principal: A.principal }]);
    expect(dimHash(a.view())).toBe(dimHash(foldDim(rowsA)));
    const twoMarks = a.hash();
    say(`draw: 2 adds sent through sendModCommand; row seq ${rowsA[1]!.seq} arrived stamped {principal, connId, surface: gui}; the fold is 2 human marks`);

    /* ── undo after a confirmed add: the inverse is sent, the fold returns to the earlier hash ── */
    a.edit([rect(3)], press());
    expect(await saved(a)).toBe(true);
    expect(a.hash()).not.toBe(twoMarks);
    expect(a.status().canUndo).toBe(true);
    a.undo(press('keydown'));
    expect(await saved(a)).toBe(true);
    expect(a.hash()).toBe(twoMarks);
    const undoRow = A.dims.rows(dim)[A.dims.rows(dim).length - 1]!;
    expect((undoRow.payload as { ops: unknown }).ops).toEqual([{ type: 'delete', id: ulid(3) }]);
    expect(A.notices).toEqual([]);
    say(`undo: Cmd+Z after the confirmed add sent [delete] as row seq ${undoRow.seq}; the hash is the earlier one again`);

    /* ── tab B: the same principal on another connection ─────────────────── */
    const B = await openPage(k);
    expect(B.principal).toBe(A.principal);
    expect(B.connId).not.toBe(A.connId);
    const b = B.watch(B.sessions.resume({ dim, hsid }));
    expect(b.hash()).toBe(twoMarks); // a full read from the start of the log
    // both in flight at once: neither confirms the other's batch
    a.edit([rect(10)], press());
    b.edit([rect(20)], press());
    expect(await saved(a)).toBe(true);
    expect(await saved(b)).toBe(true);
    expect(await waitFor(() => a.view().nodes.size === 4 && b.view().nodes.size === 4, 10_000, 5)).toBe(true);
    // each tab's undo entry is its OWN row: A's Cmd+Z deletes A's mark and B's deletes B's
    a.undo(press('keydown'));
    expect(await saved(a)).toBe(true);
    expect(await waitFor(() => !b.view().nodes.has(ulid(10)), 10_000, 5)).toBe(true);
    expect(a.view().nodes.has(ulid(20))).toBe(true);
    b.undo(press('keydown'));
    expect(await saved(b)).toBe(true);
    expect(await waitFor(() => a.hash() === twoMarks && b.hash() === twoMarks, 10_000, 5)).toBe(true);
    expect([A.notices, B.notices]).toEqual([[], []]);
    say('two tabs: A and B (one principal, two connIds) each had a batch in flight together; each was confirmed by its own row only, and each undo deleted its own mark');

    /* ── a refused op rolls back with ONE notice ─────────────────────────── */
    // B stops hearing the log; A deletes mark 1; B, not knowing, updates it: the MOD refuses, B rolls back
    B.hold(true);
    a.edit([{ type: 'delete', id: ulid(1) } as DimOp], press());
    expect(await saved(a)).toBe(true);
    const oneMark = a.hash();
    b.edit([{ type: 'update', id: ulid(1), patch: { w: 99 } } as DimOp], press());
    expect((b.view().nodes.get(ulid(1))!.node as { w: number }).w).toBe(99); // optimistic
    expect(await saved(b)).toBe(true);
    expect(B.notices).toHaveLength(1);
    expect(B.notices[0]).toMatchObject({ about: 'edit', why: 'ops-refused', lost: 1 });
    expect((b.view().nodes.get(ulid(1))!.node as { w: number }).w).toBe(10); // put back
    const refused = B.notices[0]!;
    B.hold(false);
    expect(b.hash()).toBe(oneMark);
    expect(A.dims.rows(dim).every((r) => JSON.stringify(r.payload).includes('"w":99') === false)).toBe(true);
    say(`refusal: an update of a mark another tab had deleted was refused by the mod (code ${refused.code}, field ${refused.field}, why ${String(refused.why)}); the tab rolled back and raised one notice; no row was written`);
    B.notices.length = 0;

    /* ── disconnect, reconnect on a NEW connection, resume from the cursor ── */
    const cursorBefore = A.gui.cursor()!;
    const sentBefore = A.sent.length;
    const oldClient = A.client;
    const oldSession = a;
    A.drop();
    expect(await waitFor(() => a.status().link === 'down', 5_000, 5)).toBe(true);
    a.edit([rect(30)], press());
    expect(A.notices.map((n) => n.code)).toEqual(['link-down', 'link-down']); // the link line, then the refused edit
    A.notices.length = 0;
    // while A is away, B draws: rows A has not seen
    b.edit([rect(40), rect(41)], press());
    expect(await saved(b)).toBe(true);
    const [again] = await reconnect(k, A);
    a = A.watch(again!);
    expect(a).not.toBe(oldSession);
    expect(oldSession.alive).toBe(false);
    expect(A.client).not.toBe(oldClient);
    expect(A.connId).not.toBe(B.connId);
    // resumed: NO command was sent by the rebuild, and the store read on from its cursor (never from the start)
    expect(A.sent.slice(sentBefore)).toEqual([]);
    expect(A.gui.cursor()!.logId).toBe(cursorBefore.logId);
    expect(A.gui.cursor()!.seq).toBeGreaterThan(cursorBefore.seq);
    expect(a.status()).toMatchObject({ phase: 'open', link: 'up', keep: 'saved', canUndo: false, verified: true });
    expect(a.view().nodes.size).toBe(3);
    const fromCursor = a.hash();
    // the stamp counter restarts at 1 on the new connection, and the kernel takes it: the next dim.open
    const g = gestureOf(press('click'), Date.now())!;
    const reopened = modAnswerOf(await sendModCommand(A.client, g, DIMENSION, 'dim.open', { dim, opened: 'menu', focus: { hsid } })) as { ok: boolean; created: boolean; seq: number; hash: string };
    expect(g.n).toBe(1);
    expect(reopened).toMatchObject({ ok: true, created: false });
    expect(await waitFor(() => A.dims.stateAt(dim).seq >= reopened.seq, 10_000, 5)).toBe(true);
    // a full re-read: a third page that reads the whole log from the start
    const C = await openPage(k);
    expect(await waitFor(() => C.dims.stateAt(dim).seq >= reopened.seq, 10_000, 5)).toBe(true);
    const fromStart = dimHash(C.dims.stateAt(dim));
    expect([fromCursor, a.hash(), fromStart, dimHash(B.dims.stateAt(dim))]).toEqual([reopened.hash, reopened.hash, reopened.hash, reopened.hash]);
    expect(A.dims.rows(dim).length).toBe(C.dims.rows(dim).length);
    say(`reconnect: a new connection (stamp n=${g.n}); resumed from cursor seq ${cursorBefore.seq} with no command sent; dimHash from the cursor, from a full re-read and from the mod's dim.open are one value ${reopened.hash.slice(0, 23)}…`);

    /* ── more than 20 ops a second are spaced; none is refused append-failed ── */
    // three dimensions, each with three actions of several rows: none can merge, so every row is its own command
    const more = [dim, dimId(2), dimId(3)].map((d, i) => (i === 0 ? a : A.watch(A.sessions.open({ dim: d, hsid, opened: 'menu', title: `Burst ${i}` }, press('click')))));
    for (const s of more) expect(await s.opened(), JSON.stringify(s.lastNotice())).toBe(true);
    const from = A.sent.length;
    let n = 100;
    let ops = 0;
    for (let round = 0; round < 3; round++) {
      for (const s of more) {
        const action = Array.from({ length: 9 }, () => words(n++, 3900));
        ops += action.length;
        s.edit(action, press('paste'));
      }
      for (const s of more) expect(await saved(s, 30_000), JSON.stringify(s.status())).toBe(true);
    }
    const burst = A.sent.slice(from).filter((c) => c.commandId === 'dim.op');
    const busiest = Math.max(...burst.map((c) => burst.filter((x) => x.at >= c.at && x.at < c.at + 1000).length));
    // nothing refused: no append-failed, no row-too-large, no timeout. The two burst opens MADE dimensions 2 and 3,
    // so each says its default grant once (Aegis D1, N-9); the reopen of the first says nothing
    const grantDefault = { about: 'grant', code: 'grant-default', field: 'write', why: null, lost: 0, hsid, write: true };
    expect(A.notices).toEqual([grantDefault, grantDefault]);
    A.notices.length = 0;
    expect(burst.length).toBeGreaterThan(20);
    // the limiter SCHEDULES at most perWindow a second (held exactly on an injected clock in gnomon-gui
    // test/dim-session.test.ts); on this wall clock a late timer can move one send into the next window, so the
    // bound held here is the host's own
    expect(busiest).toBeLessThan(DIM_SEND_LIMITS.hostPerSecond);
    // (informational only: two timers can fire back to back after a stall on a loaded runner, so no gap is asserted here)
    const closest = Math.min(...burst.slice(1).map((c, i) => c.at - burst[i]!.at));
    expect(more.reduce((sum, s) => sum + s.view().nodes.size, 0)).toBe(3 + ops);
    for (const s of more) expect(dimHash(s.view())).toBe(dimHash(foldDim(A.dims.rows(s.dim))));
    // and each of those actions is one undo step, on the real mod: one Cmd+Z takes a whole 9-mark action back
    const last = more[2]!;
    const before = last.view().nodes.size;
    last.undo(press('keydown'));
    expect(await saved(last)).toBe(true);
    expect(last.view().nodes.size).toBe(before - 9);
    const span = burst[burst.length - 1]!.at - burst[0]!.at;
    say(`burst: ${ops} ops as ${burst.length} dim.op commands over 3 dimensions in ${span} ms of this run's wall clock; the busiest second held ${busiest} (the page schedules ${DIM_SEND_LIMITS.perWindow} at most, the host allows ${DIM_SEND_LIMITS.hostPerSecond}); the two closest were ${closest} ms apart; 0 refused; one Cmd+Z took a 9-mark, multi-row action back`);

    /* ── fold: dim.close; unfold: dim.open on the ended dimension un-ends it ── */
    expect(await last.fold(press('keydown'))).toBe(true);
    expect(await waitFor(() => C.dims.stateAt(last.dim).ended, 10_000, 5)).toBe(true);
    expect(A.sessions.get(last.dim)).toBeNull();
    const marksAtFold = C.dims.stateAt(last.dim).nodes.size;
    const unfolded = A.watch(A.sessions.open({ dim: last.dim, hsid, opened: 'menu' }, press('click')));
    expect(await unfolded.opened(), JSON.stringify(unfolded.lastNotice())).toBe(true);
    expect(await waitFor(() => !C.dims.stateAt(last.dim).ended && unfolded.status().verified === true, 10_000, 5)).toBe(true);
    expect(unfolded.view().nodes.size).toBe(marksAtFold);
    unfolded.edit([rect(900)], press());
    expect(await saved(unfolded)).toBe(true);
    expect(A.notices).toEqual([]); // the unfold is a reopen (created: false): no grant line
    expect(await waitFor(() => C.dims.stateAt(last.dim).nodes.size === marksAtFold + 1, 10_000, 5)).toBe(true);
    say(`fold and unfold: dim.close ended the dimension and destroyed the session; dim.open on it un-ended it with its ${marksAtFold} marks, the hash matched, and a new mark was kept`);

    /* ── kernel-side negatives, sent RAW on the real socket (the page's sender would refuse most of them itself) ── */
    const D = await openPage(k);
    const rowsBefore = (): number => C.dims.rows(dim).length;
    const rowsAtStart = rowsBefore();
    type Raw = { ok: 'answered'; result: Record<string, unknown> } | { ok: 'refused'; code: string; data: Record<string, unknown> | null };
    const raw = async (args: Record<string, unknown>): Promise<Raw> => {
      try {
        return { ok: 'answered', result: modAnswerOf(await D.client.call('mod.command', { name: DIMENSION, commandId: 'dim.op', args: { dim, ops: [rect(950)], focus: { hsid }, ...args } })) as Record<string, unknown> };
      } catch (err) {
        const r = (err as { refusal?: { code: string; data: Record<string, unknown> | null } }).refusal;
        return { ok: 'refused', code: r?.code ?? String(err), data: r?.data ?? null };
      }
    };
    const table: string[] = [];
    // no stamp
    const none = await raw({});
    expect(none).toMatchObject({ ok: 'refused', code: 'FORBIDDEN', data: { needs: 'gesture' } });
    table.push(`no stamp → ${none.ok === 'refused' ? `${none.code} ${String(none.data?.why)}` : 'answered'}`);
    // one stamp, used as often as it may be (each use is an EMPTY op list, so the mod writes nothing), then a fifth time
    const uses: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await raw({ ops: [], gesture: { n: 1, kind: 'pointer' } });
      uses.push(r.ok === 'refused' ? `${r.code}/${String(r.data?.why)}` : `answered ${String(r.result.code ?? r.result.ok)}`);
    }
    expect(uses.slice(0, 4).every((u) => u.startsWith('answered'))).toBe(true);
    expect(uses[4]).toBe('FORBIDDEN/spent');
    table.push(`one stamp five times → ${uses.join(', ')}`);
    // a later stamp, then the earlier one again: replayed
    expect((await raw({ ops: [], gesture: { n: 2, kind: 'key' } })).ok).toBe('answered');
    const replay = await raw({ gesture: { n: 1, kind: 'pointer' } });
    expect(replay).toMatchObject({ ok: 'refused', code: 'FORBIDDEN', data: { needs: 'gesture', why: 'replayed' } });
    table.push(`an earlier stamp again → ${replay.ok === 'refused' ? `${replay.code} ${String(replay.data?.why)}` : 'answered'}`);
    // a focus on a session that is not live: the host composes no hsid and no repo, and the mod refuses
    const foreign = await raw({ focus: { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ' }, gesture: { n: 3, kind: 'pointer' } });
    expect(foreign.ok === 'answered' ? foreign.result : foreign).toMatchObject({ ok: false, code: 'no-session' });
    table.push(`a focus on a session that is not live → ${foreign.ok === 'answered' ? String(foreign.result.code) : foreign.code}`);
    // an hsid and a repo written into the args by the page are never read: the mod is given the host's own
    const forged = await raw({ ops: [{ type: 'update', id: ulid(999), patch: { w: 5 } }], hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ', repo: 'repo:ffffffffffffffff', gesture: { n: 4, kind: 'pointer' } });
    expect(forged.ok === 'answered' ? forged.result : forged).toMatchObject({ ok: false, code: 'ops-refused' }); // it reached the dimension of the REAL session and repo, and was judged there
    table.push(`a forged hsid and repo in the args → ignored; judged in the real session's dimension: ${forged.ok === 'answered' ? String(forged.result.code) : forged.code}`);
    await new Promise((r) => setTimeout(r, 300));
    expect(rowsBefore()).toBe(rowsAtStart); // none of them wrote a row
    expect(C.dims.stateAt(dim).nodes.has(ulid(950))).toBe(false);
    say(`kernel negatives (raw, no row written by any): ${table.join(' | ')}`);

    process.stdout.write(`dimension dogfood (real kernel, real mod, real WebSocket)\n${report.map((l) => `  ${l}`).join('\n')}\n`);
  }, 180_000);
});
