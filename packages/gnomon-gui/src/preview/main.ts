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
import { main } from '../ui/app.js';
import { FakeKernel, fakeWebSocketClass, previewKey, signRows } from './fake-kernel.js';
import { FIXTURES } from './fixtures.js';
import { drawWorkshop, workshopBlock } from './workshop.js';
import type { MiniDoc } from '../core/render.js';

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
  const key = await previewKey(crypto.subtle);
  const rows = await signRows(fx.rows, key);
  let kernel: FakeKernel | null = null;
  (globalThis as { WebSocket: unknown }).WebSocket = fakeWebSocketClass((url) => (kernel = new FakeKernel(fx, rows, key, url)));
  main(`#launch=cHJldmlldy1sYXVuY2g&k=${key.spki}`);
  for (let i = 0; i < 200 && !kernel; i++) await frames(1);
  if (!kernel) return;
  const k = kernel as FakeKernel;
  await k.followed;
  await frames(2);
  if (fx.focus) (document.querySelector(`#session-list [data-hsid="${fx.focus}"]`) as HTMLElement | null)?.click();
  if (fx.workshop) {
    const pane = document.getElementById('pane-sessions')!;
    // preview-only layout for the strip (the GUI has no mod-view styles yet); colours are the GUI's own tokens
    const css = document.createElement('style');
    css.textContent = '.pane-workshop{flex:none;max-height:42%;overflow:auto;border-top:1px solid var(--rule);padding:4px 0 8px}.workshop-zone{padding:2px 10px}.workshop-zone>.meta{margin:6px 0 2px}.workshop-cap{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--ink2)}.workshop-cap .blk-text{margin:0}.workshop-cap.tone-violet{color:var(--knot)}.workshop-cap.tone-quiet{color:var(--sec)}';
    document.head.appendChild(css);
    const paint = (): void => {
      document.querySelector('.pane-workshop')?.remove();
      pane.appendChild(drawWorkshop(document as unknown as MiniDoc, workshopBlock(k.rows, { motion: PREVIEW.motion === 'off' ? 'reduced' : 'full', theme: PREVIEW.theme })) as unknown as Node);
    };
    paint();
    k.onRow(paint);
  }
  // S3: ?fan=1 shows the stack pile fanned (what :hover / :focus-within does), for the screenshot
  if (new URLSearchParams(location.search).get('fan') === '1') document.getElementById('stack')?.classList.add('fan');
  await frames(3);
  document.documentElement.dataset.preview = 'ready';
}

void boot();
