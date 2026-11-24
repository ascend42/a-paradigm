/**
 * #gui-board loader (core/board.ts): the board chunk is fetched by import() the first time a board opens, from a
 * same-origin bundle URL, with its stylesheet as a <link> (never inline style).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BOARD_SCRIPT, BOARD_STYLES, boardUrl, loadBoard, resetBoardLoader, type BoardModule } from '../src/core/board.js';

interface FakeLink { rel: string; href: string; dataset: Record<string, string | undefined>; onload: (() => void) | null; onerror: (() => void) | null; removed: boolean; remove(): void }
/** `styles`: what the stylesheet does once appended ('load', 'error' or 'never'). */
function fakeDoc(styles: 'load' | 'error' | 'never' | Array<'load' | 'error'> = 'load', baseURI = 'http://127.0.0.1:8790/') {
  const links: FakeLink[] = [];
  const plan = Array.isArray(styles) ? [...styles] : null;
  return {
    links,
    live: (): FakeLink[] => links.filter((l) => !l.removed),
    baseURI,
    head: {
      appendChild: (n: unknown) => {
        const link = n as FakeLink;
        links.push(link);
        const what = plan ? plan.shift() : styles;
        if (what === 'load') queueMicrotask(() => link.onload?.());
        if (what === 'error') queueMicrotask(() => link.onerror?.());
      },
    },
    createElement: (_tag: 'link'): FakeLink => {
      const l: FakeLink = { rel: '', href: '', dataset: {}, onload: null, onerror: null, removed: false, remove: () => void (l.removed = true) };
      return l;
    },
  };
}
const good: BoardModule = { BOARD_ENGINE: '@excalidraw/excalidraw@0.18.1', mountBoard: () => Promise.reject(new Error('not mounted in a unit test')) };

describe('#gui-board loader', () => {
  beforeEach(() => resetBoardLoader());

  it('resolves both members against the page: same origin, inside the bundle, whatever the page path', () => {
    expect(BOARD_SCRIPT).toBe('board/board.js');
    expect(BOARD_STYLES).toBe('board/board.css');
    expect(boardUrl(BOARD_SCRIPT, 'http://127.0.0.1:8790/')).toBe('http://127.0.0.1:8790/board/board.js');
    expect(boardUrl(BOARD_STYLES, 'http://127.0.0.1:8790/?fixture=board&theme=day')).toBe('http://127.0.0.1:8790/board/board.css');
  });

  it('imports once, adds ONE stylesheet link, and hands every caller the same module', async () => {
    const doc = fakeDoc();
    const asked: string[] = [];
    const importer = (url: string): Promise<unknown> => (asked.push(url), Promise.resolve(good));
    const [a, b] = await Promise.all([loadBoard(doc, importer), loadBoard(doc, importer)]);
    expect(a).toBe(good);
    expect(b).toBe(good);
    expect(await loadBoard(doc, importer)).toBe(good);
    expect(asked).toEqual(['http://127.0.0.1:8790/board/board.js']);
    expect(doc.links.map((l) => ({ rel: l.rel, href: l.href, dataset: l.dataset, removed: l.removed }))).toEqual([{ rel: 'stylesheet', href: 'http://127.0.0.1:8790/board/board.css', dataset: { gnomonBoard: '1' }, removed: false }]);
  });

  it('does not resolve until the stylesheet has loaded too (a board never mounts unstyled)', async () => {
    const doc = fakeDoc('never');
    let done = false;
    const p = loadBoard(doc, () => Promise.resolve(good)).then((m) => ((done = true), m));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    doc.links[0]!.onload?.();
    expect(await p).toBe(good);
  });

  it('a stylesheet that never settles fails the load after the timeout, removes its link, and the next open starts clean', async () => {
    const doc = fakeDoc(['never' as never, 'load']);
    await expect(loadBoard(doc, () => Promise.resolve(good), 30)).rejects.toThrow('the board did not load in time');
    await Promise.resolve();
    expect(doc.live()).toEqual([]);
    await expect(loadBoard(doc, () => Promise.resolve(good), 30)).resolves.toBe(good);
  });

  it('a stylesheet that fails rejects the load, removes its link, and the next open starts clean', async () => {
    const doc = fakeDoc(['error', 'load']);
    await expect(loadBoard(doc, () => Promise.resolve(good))).rejects.toThrow('the board stylesheet did not load');
    await Promise.resolve();
    expect(doc.live()).toEqual([]);
    await expect(loadBoard(doc, () => Promise.resolve(good))).resolves.toBe(good);
    expect(doc.links.length).toBe(2);
    expect(doc.live().length).toBe(1);
  });

  it('a failed import is not cached and leaves no link: the retry adds a fresh one', async () => {
    const doc = fakeDoc();
    let n = 0;
    const importer = (): Promise<unknown> => (++n === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(good));
    await expect(loadBoard(doc, importer)).rejects.toThrow('offline');
    await Promise.resolve();
    expect(doc.live()).toEqual([]);
    await expect(loadBoard(doc, importer)).resolves.toBe(good);
    expect(n).toBe(2);
    expect(doc.live().length).toBe(1);
  });

  it.each([null, {}, { mountBoard: 'x', BOARD_ENGINE: 'e' }, { mountBoard: () => undefined }])('a module without the board surface is refused and its link removed (%j)', async (bad) => {
    const doc = fakeDoc();
    await expect(loadBoard(doc, () => Promise.resolve(bad))).rejects.toThrow('did not export mountBoard');
    await Promise.resolve();
    expect(doc.live()).toEqual([]);
  });
});
