/**
 * @symbol #gui-preview
 *
 * DEV ONLY (#gui-preview): the fixture preview's app.js (scripts/preview.mjs
 * bundles THIS file; the kernel-served bundle is src/main.ts, which never
 * imports src/preview). It installs a fake kernel as the page's WebSocket and
 * starts the real app (ui/app.ts main) with a launch fragment carrying the
 * fake kernel's per-page key, so the real launch → serverSig → auth →
 * log.read path runs. When the fixture is painted it sets
 * <html data-preview="ready"> for the screenshot script.
 */
import { PREVIEW } from './env.js'; // FIRST: stubs matchMedia and the surface before app.ts evaluates
import { PIN_KEY } from '../core/launch.js';
import { devArmOfferOnce, devRulesState, main } from '../ui/app.js';
import { FakeKernel, fakeWebSocketClass, previewKey, signRows, type PreviewKey } from './fake-kernel.js';
import { FIXTURES, PREVIEW_LOG_ID } from './fixtures.js';
import { PREVIEW_DIM_REPO, PreviewDimMod } from './dim-mod.js';
import { followLog, GnomonClient } from '../core/client.js';
import { noticeLine } from '../core/board-leaf.js';
import { DimSessions, type DimSession } from '../core/dim-session.js';
import { DimStore } from '../core/dim-store.js';
import { GuiStore } from '../core/store.js';
import { applyPreset, placeWorkshop, serializeLayout, togglePane } from '../core/commands.js';
import { MOTION_KEY, THEME_KEY } from '../core/settings.js';
import { loadBoard, type BoardModule } from '../core/board.js';
import type { DimOp, LogRow } from '@a-company/gnomon-contracts';
import { boardFixture, FIXTURE_DIM, fixtureRows, fixtureState } from './board-fixture.js';
import { mountBoardLeaf, type BoardLeaf } from '../ui/board-leaf.js';
import { cardHasFocus } from '../ui/card-focus.js';

// DEV ONLY: every CSP refusal on a preview page goes to the preview server's /diag (GET /diag lists them), so a
// fixture that draws anything the kernel's policy would refuse says so (boards S1.0 dogfood: no CSP rows).
document.addEventListener('securitypolicyviolation', (e) => {
  const row = `csp ${e.effectiveDirective || e.violatedDirective} blocked=${e.blockedURI || '(none)'} source=${e.sourceFile || ''}:${e.lineNumber} fixture=${PREVIEW.fixture}`;
  void fetch('/diag', { method: 'POST', body: row }).catch(() => undefined);
});

/**
 * #gui-board DEV fixture (boards S1.1): the board leaf over the chat header and the chat, stopping above the
 * pinned cards and the composer, through the real loader, in the page's theme. `?board=` picks a state: open
 * (default), tray, empty, yielded, loading, failed, crashed, short (the rail folds) or tiny (too short to draw).
 * The marks are rows folded by `foldDim` (src/preview/board-fixture.ts) and drawn with `handle.render`; an edit made
 * on the board is appended as a row of yours and rendered back, as the live leaf will do. Sized with CSSOM.
 */
async function openBoardFixture(key: PreviewKey): Promise<void> {
  const pane = document.getElementById('pane-transcript');
  const feed = pane?.querySelector('.feed') as HTMLElement | null;
  if (!pane || !feed) return;
  const variant = new URLSearchParams(location.search).get('board') ?? 'open';
  const host = document.createElement('div');
  host.id = 'preview-board';
  host.style.position = 'absolute';
  host.style.left = '0';
  host.style.right = '0';
  host.style.top = '0';
  pane.style.position = 'relative';
  // the leaf covers the chat header and the chat and stops above the pinned cards and the composer
  const fit = (): void => {
    const full = feed.getBoundingClientRect().bottom - pane.getBoundingClientRect().top;
    host.style.height = `${variant === 'short' ? Math.min(full, 304 + 96) : variant === 'tiny' ? Math.min(full, 200) : full}px`;
  };
  fit();
  new ResizeObserver(fit).observe(pane);
  pane.appendChild(host);
  const diag = (row: string): void => void fetch('/diag', { method: 'POST', body: row }).catch(() => undefined);
  let crash: ((e: Error) => void) | undefined;
  const load = (): Promise<BoardModule> =>
    variant === 'loading'
      ? new Promise<BoardModule>(() => undefined)
      : variant === 'failed'
        ? Promise.reject(new Error('the board stylesheet did not load'))
        : loadBoard().then((m) => ({ BOARD_ENGINE: m.BOARD_ENGINE, mountBoard: (h, opts) => ((crash = opts?.onError), m.mountBoard(h, opts)) }));
  const fx = boardFixture(variant === 'empty' ? 'empty' : (new URLSearchParams(location.search).get('marks') ?? 'sample'));
  if (variant === 'live') return void (await openLiveBoard(host, key, load, diag));
  let send: (ops: DimOp[], cause: Event | null) => void = () => undefined;
  const ready = new Promise<void>((done) => {
    const leaf = mountBoardLeaf(host, {
      title: 'auth handoff',
      project: 'billing',
      projectHue: 'h0',
      session: 'Totals are off by a cent',
      how: 'offer',
      agent: 'Arky',
      time: '14:02',
      theme: PREVIEW.theme,
      load,
      cardFocused: () => cardHasFocus(document),
      onFold: () => diag('board fold asked'),
      // a copy, a paste: the leaf's own register over the fixture's fold; pasted ops go where the board's edits go
      view: () => fx.state(),
      onOps: (ops, cause) => send(ops, cause),
      onReady: (handle) => {
        // the fixture's stand-in for the live loop: an edit becomes a row of yours and the fold is rendered back
        handle.render(fx.state());
        send = (ops, cause) => {
          fx.edits.push({ ops, cause: cause ? cause.type : null });
          if (!fx.held) handle.render(fx.apply(ops));
        };
        handle.onEdit((ops, cause) => send(ops, cause));
        handle.onUndoKey((_e, redo) => void fx.undoKeys.push(redo ? 'redo' : 'undo'));
        (globalThis as { gnomonPreviewBoard?: unknown; gnomonPreviewDim?: unknown }).gnomonPreviewBoard = handle;
        (globalThis as { gnomonPreviewDim?: unknown }).gnomonPreviewDim = fx;
        (globalThis as { gnomonPreviewState?: unknown }).gnomonPreviewState = fixtureState;
        handle.onAttempt((a) => diag(`board attempt ${a.kind} types=${a.types.join(',')} files=${a.files}`));
        void loadBoard().then(async (m) => {
          document.documentElement.dataset.previewBoard = m.BOARD_ENGINE;
          (globalThis as { gnomonPreviewBoardModule?: unknown }).gnomonPreviewBoardModule = m; // the chunk's own exports (test/board-c8.test.ts reads boardEngineRuns)
          await new Promise((r) => setTimeout(r, 300)); // the marks are counted after they have had time to be wiped
          if (variant === 'tray') (host.querySelector('.bd-ink') as HTMLElement | null)?.click();
          if (variant === 'yielded') (document.querySelector('#pinned .card button, #stack .card button') as HTMLElement | null)?.focus();
          if (variant === 'crashed') crash?.(new Error('preview: the engine stopped'));
          // a positive row: "no CSP rows" only means something when the board is known to have mounted
          diag(`board ready ${m.BOARD_ENGINE} marks=${handle.count()} theme=${handle.state().theme} leaf=${leaf.state()} surface=${PREVIEW.surface}`);
          done();
        });
      },
    });
    (globalThis as { gnomonPreviewLeaf?: unknown }).gnomonPreviewLeaf = leaf;
    // a state with no engine (loading, failed) is ready once it has drawn itself
    if (variant === 'loading' || variant === 'failed') setTimeout(done, 500);
  });
  await ready;
  await new Promise((r) => setTimeout(r, 150));
}

/**
 * #gui-dim-session DEV fixture (boards S1.3 pass P4a; `?board=live`): the REAL live loop over the fake kernel. Its
 * own GnomonClient on its own fake-kernel connection, `followLog` into a DimStore through `DimSessions`, the one
 * sender with real gesture stamps, the dimension mod's real checks (dim-mod.ts), rows back on the followed log, and
 * the leaf mounted with the session's wiring. What the app will do when it mounts the leaf, in small.
 * Test hooks on `gnomonPreviewLive`: the mod (`refuseNext`, `silent`), `down()` and `up()` for the link.
 */
async function openLiveBoard(host: HTMLElement, key: PreviewKey, load: () => Promise<BoardModule>, diag: (row: string) => void): Promise<void> {
  const set = new URLSearchParams(location.search).get('marks') ?? 'sample';
  const mod = new PreviewDimMod();
  const seedRows = fixtureRows(set);
  mod.seed(seedRows);
  const url = 'ws://preview.invalid/rpc';
  const logRows = seedRows.map((r) => ({ seq: r.seq, view: 'full', event: { schemaVersion: 'event:v1', log: PREVIEW_LOG_ID, seq: r.seq, at: '2026-11-24T14:02:00.000Z', principal: 'p:preview/mod-gnomon.dimension', kind: r.kind, payload: r.payload, scope: { repo: PREVIEW_DIM_REPO } } })) as unknown as LogRow[];
  const kernel = new FakeKernel({ status: {} }, logRows, key, url);
  kernel.dim = mod;
  const dims = new DimStore();
  const sessions = new DimSessions({ store: dims });
  const gui = new GuiStore();
  let client!: GnomonClient;
  const connect = async (): Promise<void> => {
    client = new GnomonClient(kernel);
    const out = await client.connect({ surface: 'browser', endpointPath: url, verifyKey: key.spki, auth: { launchToken: 'preview-launch' }, subtle: crypto.subtle });
    if (!out.ok) throw new Error(`preview live board: ${out.message}`);
    const take = (rows: unknown[]): void => (gui.apply(rows), sessions.apply(rows));
    client.onNotification((method, params) => {
      const row = method === 'event' ? (params as { row?: unknown } | null)?.row : undefined;
      if (row) take([row]);
    });
    client.onClose(() => sessions.linkDown());
    await followLog(client, { cursor: () => gui.cursor(), adopt: (id: string) => gui.adopt(id), apply: take, advance: (n: number) => gui.advance(n), reset: () => (gui.reset(), sessions.reset()) } as unknown as GuiStore);
    sessions.connect({ client, principal: out.session.principal, connId: out.session.connId });
  };
  await connect();
  const live = { sessions, dims, mod, kernel, session: null as DimSession | null, notices: [] as unknown[], leaf: null as BoardLeaf | null, down: (): void => client.close(), up: async (): Promise<void> => (kernel.reopen(), await connect()) };
  (globalThis as { gnomonPreviewLive?: unknown }).gnomonPreviewLive = live;
  const mount = (session: DimSession): Promise<void> =>
    new Promise<void>((done) => {
      live.session = session;
      const leaf = mountBoardLeaf(host, {
        title: session.status().title || 'auth handoff',
        project: 'billing',
        projectHue: 'h0',
        session: 'Totals are off by a cent',
        how: 'command',
        time: '14:02',
        theme: PREVIEW.theme,
        load,
        cardFocused: () => cardHasFocus(document),
        onFold: (cause) => void session.fold(cause).then((closed) => diag(`board fold ${closed ? 'closed' : 'stayed'}`)),
        ...session.leafOptions(),
        onReady: (handle) => {
          session.attachHandle(handle);
          (globalThis as { gnomonPreviewBoard?: unknown }).gnomonPreviewBoard = handle;
          void loadBoard().then(async (m) => {
            document.documentElement.dataset.previewBoard = m.BOARD_ENGINE;
            await new Promise((r) => setTimeout(r, 300));
            diag(`board ready ${m.BOARD_ENGINE} marks=${handle.count()} live=1 surface=${PREVIEW.surface}`);
            done();
          });
        },
      });
      live.leaf = leaf;
      (globalThis as { gnomonPreviewLeaf?: unknown }).gnomonPreviewLeaf = leaf;
      session.bindLeaf(leaf);
      session.onChange((c) => {
        if (!c.notice) return;
        live.notices.push(c.notice);
        if (session.alive) leaf.say(noticeLine(c.notice));
      });
    });
  // a reconnect destroys the session and its leaf: the new session gets a new leaf
  sessions.onEvent((e) => void (e.type === 'rebuilt' && mount(e.session)));
  await mount(sessions.resume({ dim: FIXTURE_DIM, hsid: 'hsid-preview' }));
  await new Promise((r) => setTimeout(r, 150));
}

const frames = (n: number): Promise<void> => new Promise((r) => (n <= 0 ? r() : requestAnimationFrame(() => void frames(n - 1).then(r))));

async function boot(): Promise<void> {
  const fx = FIXTURES[PREVIEW.fixture];
  document.title = `Gnomon · preview · ${PREVIEW.fixture}`;
  if (!fx) {
    document.body.textContent = `no fixture named "${PREVIEW.fixture}": known fixtures are ${Object.keys(FIXTURES).join(', ')}`;
    return;
  }
  // a fresh key per page: no pin or restart marker from an earlier preview load may apply
  localStorage.removeItem(PIN_KEY);
  sessionStorage.clear();
  // #gui-settings: the stored theme choice is the fixture's (none: auto, which follows ?theme= as the OS)
  if (fx.choice) localStorage.setItem(THEME_KEY, fx.choice);
  else localStorage.removeItem(THEME_KEY);
  localStorage.removeItem(MOTION_KEY);
  // S5: the Workshop placement the screenshot asks for, as the Layout the app restores
  const l = placeWorkshop(applyPreset('desk'), PREVIEW.workshop === 'hidden' ? 'footer' : PREVIEW.workshop);
  localStorage.setItem('gnomon.gui.layout', serializeLayout(PREVIEW.workshop === 'hidden' ? togglePane(l, 'workshop') : l));
  const key = await previewKey(crypto.subtle);
  const rows = await signRows(fx.rows, key);
  let kernel: FakeKernel | null = null;
  (globalThis as { WebSocket: unknown }).WebSocket = fakeWebSocketClass((url) => (kernel = new FakeKernel(fx, rows, key, url)));
  if (fx.open === 'offer-armed') devArmOfferOnce(); // #gui-offer-slip DEV ONLY: the slip as a first trusted press leaves it
  main(`#launch=cHJldmlldy1sYXVuY2g&k=${key.spki}`);
  for (let i = 0; i < 200 && !kernel; i++) await frames(1);
  if (!kernel) return;
  const k = kernel as FakeKernel;
  await k.followed;
  await frames(2);
  if (fx.focus) (document.querySelector(`#session-list [data-hsid="${fx.focus}"]`) as HTMLElement | null)?.click();
  // S3: ?fan=1 shows the stack pile fanned (what :hover / :focus-within does), for the screenshot
  if (new URLSearchParams(location.search).get('fan') === '1') document.getElementById('stack')?.classList.add('fan');
  // opening needs no trust; its controls do (board header-5b: Settings… lives in the Gnomon menu and ⌘,)
  if (fx.open === 'settings') document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true }));
  if (fx.open === 'app-menu') document.getElementById('wordmark-btn')?.click();
  // #gui-rules-view: Settings › Permissions › Rules, optionally in a staged state (DEV ONLY hook)
  if (fx.open === 'rules') devRulesState(fx.rulesState ?? 'none');
  // #gui-voice-ladder / #gui-voice-settings: opening the ladder or the sheet needs no trust; a rung or a sheet press does
  if (fx.open === 'voice-ladder') document.getElementById('voice-pill')?.click();
  if (fx.open === 'voice-settings') {
    document.getElementById('voice-pill')?.click();
    (document.querySelector('#voice-menu [data-vs-open]') as HTMLElement | null)?.click();
  }
  if (fx.open === 'model-switch') {
    // #gui-model-picker: the header ▾ and a menu item only DISPLAY the confirm sheet; the switch is its trusted submit
    (document.querySelector('#chead-meta .model-btn') as HTMLElement | null)?.click();
    (document.querySelector('.chead .model-menu [data-model="opus"]') as HTMLElement | null)?.click();
  }
  // #gui-loops: opening the leaf and unfolding a card need no trust; Trust and Review do
  if (fx.open === 'loops-waiting') (document.querySelector('[data-loop-review-all]') as HTMLElement | null)?.click();
  if (fx.open === 'loops-waiting' && !document.querySelector('.lp-leaf:not([hidden])')) document.getElementById('loops-word')?.click();
  if (fx.open === 'loops-trust') {
    // the pile repaints as status and rows settle: click Read once it has stayed put, and again if a repaint folded it
    for (let tries = 0; tries < 20 && !document.querySelector('.lt-wrap:not([hidden])'); tries++) {
      for (let i = 0; i < 200 && !document.querySelector('#stack [data-loop-read]'); i++) await frames(1);
      (document.querySelector('#stack [data-loop-read]') as HTMLElement | null)?.click();
      await frames(5);
    }
  }
  // #gui-turn-steps: unfolding the working key's list needs no trust
  if (fx.open === 'steps') {
    for (let i = 0; i < 200 && !document.querySelector('#viewport .work-key'); i++) await frames(1);
    (document.querySelector('#viewport .work-key') as HTMLElement | null)?.click();
  }
  // #gui-mcp-servers: Settings at the MCP servers section (opening needs no trust; its keys do)
  if (fx.open === 'mcp') {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true }));
    await frames(2);
    const hd = document.getElementById('settings-h-mcp-servers');
    hd?.scrollIntoView({ block: 'start' });
    hd?.focus({ preventScroll: true });
  }
  if (fx.open === 'board') await openBoardFixture(key);
  await frames(3);
  document.documentElement.dataset.preview = 'ready';
}

void boot();
