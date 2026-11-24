/**
 * #gui-preview board fixture (boards S1.0 item 10, DEV ONLY): the preview serves fixture pages under the kernel's
 * CSP, serves the board chunk by its pinned-tree names, and keeps what pages POST to /diag so "no CSP rows" can be
 * read. The page-side run (mount, zero rows, in Chrome and WKWebView) is the dogfood in the S1.0 report.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../../gnomon/src/kernel/web/rules.js';
import { FIXTURES } from '../src/preview/fixtures.js';
// @ts-expect-error plain .mjs dev script (no types)
import { previewCsp, startPreview } from '../scripts/preview.mjs';

describe('#gui-preview board fixture', () => {
  let p: { url: string; diag: Array<{ row: string }>; close: () => Promise<void> };
  beforeAll(async () => {
    p = await startPreview({ port: 0 });
  }, 60_000);
  afterAll(() => p.close());

  it('the fixture exists and opens the board (dev only)', () => {
    expect(FIXTURES.board).toMatchObject({ name: 'board', open: 'board' });
  });

  it('the preview policy is the kernel policy, byte for byte', () => {
    for (const port of [1, 8790, 65535]) expect(previewCsp(port)).toBe(contentSecurityPolicy(port));
  });

  it('a fixture page carries that policy for its own port; the dev list page is plain', async () => {
    const port = Number(new URL(p.url).port);
    const page = await fetch(`${p.url}/?fixture=board&theme=day`);
    expect(page.headers.get('content-security-policy')).toBe(contentSecurityPolicy(port));
    expect(await page.text()).toContain('<script src="/app.js" defer></script>');
    expect((await fetch(`${p.url}/`)).headers.get('content-security-policy')).toBeNull();
  });

  it('serves the board chunk by its exact names, and nothing beside it', async () => {
    const js = await fetch(`${p.url}/board/board.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect((await js.text()).length).toBeGreaterThan(500_000);
    const css = await fetch(`${p.url}/board/board.css`);
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    const asset = /url\(\.\/(asset-[0-9a-f]{16}\.png)\)/.exec(await css.text())![1];
    const png = await fetch(`${p.url}/board/${asset}`);
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect((await fetch(`${p.url}/board/LICENSES.txt`)).status).toBe(200);
    for (const miss of ['/board/board.js.map', '/board/..%2fpackage.json', '/board/fonts/x.woff2', '/board/asset-0000000000000000.png', '/board/']) expect((await fetch(`${p.url}${miss}`)).status, miss).toBe(404);
  }, 60_000);

  it('/diag keeps what a page posts (bounded, control characters stripped) and GET /diag counts the CSP rows', async () => {
    expect(p.diag).toEqual([]);
    await fetch(`${p.url}/diag`, { method: 'POST', body: 'board ready @excalidraw/excalidraw@0.18.1 marks=3' });
    await fetch(`${p.url}/diag`, { method: 'POST', body: 'csp img-src blocked=data source=x:1\u001b[31m fixture=board' });
    await fetch(`${p.url}/diag`, { method: 'POST', body: 'x'.repeat(10_000) });
    const text = await (await fetch(`${p.url}/diag`)).text();
    expect(text.split('\n')[0]).toBe('3 diag row(s), 1 CSP row(s)');
    expect(text).toContain('csp img-src blocked=data source=x:1 [31m fixture=board');
    expect(p.diag[2]!.row.length).toBeLessThanOrEqual(4096);
  });
});
