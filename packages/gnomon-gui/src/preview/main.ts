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
import { devArmOfferOnce, main } from '../ui/app.js';
import { FakeKernel, fakeWebSocketClass, previewKey, signRows } from './fake-kernel.js';
import { FIXTURES } from './fixtures.js';
import { applyPreset, placeWorkshop, serializeLayout, togglePane } from '../core/commands.js';
import { MOTION_KEY, THEME_KEY } from '../core/settings.js';

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
  if (fx.open === 'settings') document.getElementById('settings-btn')?.click(); // opening needs no trust; its controls do
  if (fx.open === 'model-switch') {
    // #gui-model-picker: the header ▾ and a menu item only DISPLAY the confirm sheet; the switch is its trusted submit
    (document.querySelector('#chead-meta .model-btn') as HTMLElement | null)?.click();
    (document.querySelector('#chead-meta .model-menu [data-model="opus"]') as HTMLElement | null)?.click();
  }
  await frames(3);
  document.documentElement.dataset.preview = 'ready';
}

void boot();
