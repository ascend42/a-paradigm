/**
 * #gnomon-probes P12 and P09 (probes/_shared/browser.mjs): the harness follows the browser that serves the page, not
 * only the process it launched (T-2026-11-25-002). On macos-15 CI the Firefox launcher exited 0 at 2 s while the
 * browser it had started went on, loaded the page and reported: the page was classified `exited`, retried, and its
 * report landed late. A stub launcher (test/fixtures/handoff-launcher.mjs, run by node) plays each case:
 *  - a launcher that exits 0 while the browser it started (same arguments, the profile among them) serves the page
 *    is not a miss: the report is the page's report, and the hand-off is in the result;
 *  - a launcher that exits and leaves nothing behind is still the `exited` miss;
 *  - a hand-off whose browser never asks for the page is a `never-requested` miss, not `exited`;
 *  - in every case the handed-off browser is stopped with its page: none outlives it.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs probe helper (no types)
import { holdersFrom, runPage, startServer } from '../probes/_shared/browser.mjs';
// @ts-expect-error plain .mjs probe harness (no types)
import { MISS, missRow, NO_REPORT, pageRow, retryable } from '../probes/p12-excalidraw-csp/harness.mjs';

const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'handoff-launcher.mjs');
const stub = (mode: string) => ({ name: 'stub', kind: 'firefox', bin: process.execPath, version: 'stub', preArgs: [STUB, mode] });
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

describe('holdersFrom: the processes that name a launch profile', () => {
  const tag = 'gnomon-probe-firefox-Ab12Cd';
  const ps = [
    `  101 /Applications/Firefox.app/Contents/MacOS/firefox --headless --no-remote --profile /var/folders/x/T/${tag} http://127.0.0.1:1/?run=a`,
    '  102 /Applications/Firefox.app/Contents/MacOS/firefox --headless --profile /var/folders/x/T/gnomon-probe-firefox-Zz99Yy http://127.0.0.1:1/',
    `  103 /Applications/Firefox.app/Contents/MacOS/plugin-container.app/Contents/MacOS/plugin-container -profile /private/var/folders/x/T/${tag} tab`,
    `  ${process.pid} node vitest ${tag}`,
    `  104 powershell.exe -Command Get-CimInstance Win32_Process -Filter "CommandLine like '%${tag}%'"`,
    'garbage line',
  ].join('\n');
  it('keeps the processes whose command line holds the tag, never this process nor the listing command', () => {
    expect(holdersFrom(ps, tag).map((h: { pid: number }) => h.pid)).toEqual([101, 103]);
  });
  it('reads Windows lines (pid, a space, the command line) and an empty listing', () => {
    expect(holdersFrom(`4242 "C:\\Program Files\\Mozilla Firefox\\firefox.exe" --profile C:\\Temp\\${tag} http://x/\r\n`, tag)).toEqual([{ pid: 4242, command: `"C:\\Program Files\\Mozilla Firefox\\firefox.exe" --profile C:\\Temp\\${tag} http://x/` }]);
    expect(holdersFrom('', tag)).toEqual([]);
    expect(holdersFrom(ps, '')).toEqual([]);
  });
});

describe('runPage follows a launcher that hands the browser off', () => {
  let server: { close: () => Promise<void>; requests: { method: string; path: string }[] };
  beforeAll(async () => {
    server = await startServer({ files: new Map([['/index.html', '<!doctype html><p>stub</p>']]) });
  });
  afterAll(async () => {
    await server.close();
  });

  it('a launcher that exits 0 while the browser it started serves the page is not `exited`: the page reported', async () => {
    const b0 = server.requests.length;
    const got = await runPage(server, stub('handoff'), '/', 20_000, { loadDeadlineMs: 15_000 });
    expect(got.miss).toBeUndefined();
    expect(got.report).toMatchObject({ stage: 'done', mounted: true, by: 'handed-off browser' });
    // the page was asked for after the launcher had gone, and the request is in the page's own window
    expect(got.pageRequestedMs).toBeGreaterThan(got.handoff.launcherExit.atMs);
    expect(server.requests.slice(b0).map((q) => q.path)).toEqual(['/', '/report']);
    expect(got.handoff.launcherExit).toMatchObject({ code: 0, signal: null });
    expect(got.handoff.pids.length).toBeGreaterThan(0);
    // the handed-off browser is stopped with its page
    expect(got.handoff.stopped).toEqual(got.handoff.pids);
    for (const pid of got.handoff.pids) expect(alive(pid)).toBe(false);
    // the row is a page row (never retried), and it keeps the hand-off as evidence
    const row = pageRow('pinned', got, []);
    expect(row).toMatchObject({ stage: 'done', mounted: true, handoff: { launcherExit: { code: 0 } } });
    expect(retryable(row, new Set())).toBe(false);
  });

  it('a launcher that exits and leaves nothing to serve the page is still the `exited` miss', async () => {
    const got = await runPage(server, stub('exit'), '/', 20_000, { loadDeadlineMs: 15_000 });
    expect(got.report).toBeNull();
    expect(got.miss).toBe('exited');
    expect(got.exit).toMatchObject({ code: 0, signal: null });
    expect(got.handoff).toBeUndefined();
    expect(got.pageRequestedMs).toBeNull();
    expect(got.wallMs).toBeLessThan(10_000);
    const row = missRow('pinned', got, []);
    expect(row).toMatchObject({ error: NO_REPORT, miss: 'exited' });
    expect(MISS[row.miss]).toBe('the browser exited before the page reported');
  });

  it('a hand-off whose browser never asks for the page is `never-requested`, not `exited`, and the browser is stopped', async () => {
    const got = await runPage(server, stub('handoff-silent'), '/', 20_000, { loadDeadlineMs: 4_000 });
    expect(got.report).toBeNull();
    expect(got.miss).toBe('never-requested');
    expect(got.exit).toBeNull();
    expect(got.wallMs).toBeGreaterThanOrEqual(4_000);
    expect(got.handoff.pids.length).toBeGreaterThan(0);
    expect(got.handoff.stopped).toEqual(got.handoff.pids);
    for (const pid of got.handoff.pids) expect(alive(pid)).toBe(false);
  });
});
