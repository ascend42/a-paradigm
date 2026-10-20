/**
 * @symbol #gui-preview
 *
 * DEV ONLY (#gui-preview): the page environment of the fixture preview,
 * read from the URL (`?fixture=<name>&theme=day|night&motion=on|off
 * &surface=wrapper|browser&workshop=footer|right|left|hidden`). It MUST be the first import of
 * src/preview/main.ts: app.ts reads matchMedia and the host surface when its
 * module evaluates, so the stubs are in place before that. It only answers
 * the two media queries the GUI asks about (colour scheme, reduced motion)
 * and, for surface=wrapper (the default: Gnomon.app), defines the frozen
 * `gnomonSurface` marker the wrapper's document-start script defines.
 */

export interface PreviewParams {
  fixture: string;
  theme: 'day' | 'night';
  motion: 'on' | 'off';
  surface: 'wrapper' | 'browser';
  /** S5: where the Workshop mounts (the GUI Layout; `hidden` hides it) */
  workshop: 'footer' | 'right' | 'left' | 'hidden';
}

export function previewParams(search: string): PreviewParams {
  const q = new URLSearchParams(search);
  return {
    fixture: q.get('fixture') ?? 'desk',
    theme: q.get('theme') === 'night' ? 'night' : 'day',
    motion: q.get('motion') === 'off' ? 'off' : 'on',
    surface: q.get('surface') === 'browser' ? 'browser' : 'wrapper',
    workshop: ((w) => (w === 'right' || w === 'left' || w === 'hidden' ? w : 'footer'))(q.get('workshop')),
  };
}

const fakeQuery = (media: string, matches: boolean): MediaQueryList =>
  ({ media, matches, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }) as unknown as MediaQueryList;

export const PREVIEW: PreviewParams = previewParams(typeof location === 'undefined' ? '' : location.search);

if (typeof window !== 'undefined') {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q: string): MediaQueryList => {
    if (q.includes('prefers-color-scheme')) return fakeQuery(q, PREVIEW.theme === 'night');
    if (q.includes('prefers-reduced-motion')) return fakeQuery(q, PREVIEW.motion === 'off');
    return real(q);
  };
  if (PREVIEW.surface === 'wrapper') Object.defineProperty(globalThis, 'gnomonSurface', { value: 'wrapper', writable: false, configurable: false, enumerable: false });
}
