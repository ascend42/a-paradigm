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
import { FakeKernel, fakeWebSocketClass, previewKey, signRows } from './fake-kernel.js';
import { FIXTURES } from './fixtures.js';
import { applyPreset, placeWorkshop, serializeLayout, togglePane } from '../core/commands.js';
import { MOTION_KEY, THEME_KEY } from '../core/settings.js';
import { loadBoard, type BoardMark, type BoardModule } from '../core/board.js';
import { mountBoardLeaf } from '../ui/board-leaf.js';
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
 * The marks carry the fixture's own sample authors: the hands are real only from S1.3. Sized with CSSOM.
 */
const ARKY = { cls: 'agent', id: 'arky', name: 'Arky' } as const;
const LUNA = { cls: 'agent', id: 'luna', name: 'Luna' } as const;
const QUILL = { cls: 'agent', id: 'quill', name: 'Quill' } as const;
const SAMPLE_MARKS: BoardMark[] = [
  { type: 'frame', x: 24, y: 28, width: 330, height: 262, text: 'auth handoff' },
  { type: 'sticky', x: 44, y: 56, width: 132, height: 76, text: 'token expires\nbefore the retry' },
  { type: 'rectangle', x: 212, y: 56, width: 120, height: 60, line: 'cobalt', fill: 'sky', text: 'broker' },
  { type: 'ellipse', x: 212, y: 168, width: 120, height: 64, line: 'leaf', fill: 'leaf', text: 'kernel', by: ARKY },
  { type: 'arrow', x: 258, y: 120, width: 14, height: 44, line: 'raspberry', weight: 'bold' },
  { type: 'arrow', x: 180, y: 92, width: 28, height: 0, line: 'graphite', by: ARKY },
  { type: 'sticky', x: 44, y: 160, width: 132, height: 60, fill: 'orchid', text: 'who signs\nthe second hop?', by: LUNA },
  { type: 'text', x: 48, y: 250, text: 'checked against the log', by: QUILL },
  { type: 'rectangle', x: 212, y: 246, width: 120, height: 30, by: { cls: 'unknown' } },
  { type: 'stub', x: 380, y: 56, kind: 'live:session' },
  { type: 'stub', x: 380, y: 136, kind: 'allow:approved-by-you', by: ARKY },
];

async function openBoardFixture(): Promise<void> {
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
      onReady: (handle) => {
        if (variant !== 'empty') handle.add(SAMPLE_MARKS);
        (globalThis as { gnomonPreviewBoard?: unknown }).gnomonPreviewBoard = handle;
        handle.onAttempt((a) => diag(`board attempt ${a.kind} types=${a.types.join(',')} files=${a.files}`));
        void loadBoard().then(async (m) => {
          document.documentElement.dataset.previewBoard = m.BOARD_ENGINE;
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
  if (fx.open === 'board') await openBoardFixture();
  await frames(3);
  document.documentElement.dataset.preview = 'ready';
}

void boot();
