/**
 * scripts/board-leaf-shots.mjs: the launch retry (boards S1.3 P4b-3 fix batch; Probe). A Chrome that fails to START
 * is tried again, at most twice more, each on a fresh profile; nothing is retried once the page has been spoken to.
 * The stubs are shell scripts in front of the real Chrome, so these run where a Chrome is installed and a POSIX
 * shell exists (not on Windows: `spawn` cannot run a script there without a shell, and the retry itself has no
 * platform branch).
 *
 * The real Chrome behind each stub is given START_WAIT_MS to open its port, not the 15 s default (Probe, a load flake in
 * the full suite): the retry exists for a Chrome that does not start in time, and under load a REAL one once took longer
 * than 15 s, so it was rightly launched a third time and "exactly once more" read 3. The stub's own dead launches
 * exit at once, so the longer wait costs them nothing; and each launch is logged by kind (d = died in the stub,
 * r = handed to the real Chrome) so a count that is off says which kind of launch was added.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script (no types)
import { findChrome, LAUNCH_ATTEMPTS, LAUNCH_RETRY_ERRORS, shootLeaf } from '../scripts/board-leaf-shots.mjs';

const chrome = findChrome() as string | null;
const dir = mkdtempSync(path.join(os.tmpdir(), 'gnomon-launch-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
/** A stand-in chrome: logs each launch in `<name>.launches` (d: exited at once, for the first `dead` of them; r: handed to the real Chrome). */
function stub(name: string, dead: number): { file: string; launches: () => string } {
  const log = path.join(dir, `${name}.launches`);
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\nn=$(( $(cat '${log}' 2>/dev/null | wc -c) + 1 ))\nif [ "$n" -le ${dead} ]; then printf d >> '${log}'; exit 1; fi\nprintf r >> '${log}'\nexec '${chrome}' "$@"\n`);
  chmodSync(file, 0o755);
  return { file, launches: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') };
}
/** How long the REAL Chrome may take to open its port here: a loaded machine has taken longer than the 15 s default. */
const START_WAIT_MS = 60_000;
const PAGE = 'data:text/html,<title>t</title><p id="p">ready</p>';

describe('the launch retry is bounded and only for a Chrome that did not start', () => {
  it('the retried failures are the four that happen before a command is sent, and three launches is the most', () => {
    expect(LAUNCH_RETRY_ERRORS).toEqual(['chrome did not open its DevTools port', 'chrome opened no page', 'DevTools socket refused', 'DevTools page list refused']);
    expect(LAUNCH_ATTEMPTS).toBe(3);
    expect(LAUNCH_RETRY_ERRORS).not.toContain('the page was never ready (the fixture never set data-preview="ready")');
  });
});

describe.skipIf(!chrome || process.platform === 'win32' || (!!process.env.CI && process.env.GNOMON_BROWSER_TESTS !== '1'))('the launch retry against a real Chrome behind a stub', () => {
  it('a Chrome that exits without a port ONCE is launched exactly once more, and the run then answers', async () => {
    const s = stub('dies-once', 1);
    const r = (await shootLeaf({ chrome: s.file, url: PAGE, width: 400, height: 300, portWaitMs: START_WAIT_MS, ready: "document.getElementById('p') !== null", actions: [{ read: 'document.title', as: 'title' }] })) as { attempts: number; acted: Record<string, unknown> };
    expect(s.launches()).toBe('dr');
    expect(r.attempts).toBe(2);
    expect(r.acted.title).toBe('t');
  }, 90_000);

  it('a Chrome that never starts is given up after three launches, with the launch error', async () => {
    const s = stub('always-dies', 99);
    const err = (await shootLeaf({ chrome: s.file, url: PAGE, width: 400, height: 300, portWaitMs: START_WAIT_MS }).then(() => null, (e: unknown) => e)) as (Error & { attempts?: number }) | null;
    expect(err?.message).toBe('chrome did not open its DevTools port');
    expect(err?.attempts).toBe(3);
    expect(s.launches()).toBe('ddd');
  }, 90_000);

  it('a page that never becomes ready is NOT retried: Chrome started, the page was spoken to, one launch', async () => {
    const s = stub('never-ready', 0);
    const err = (await shootLeaf({ chrome: s.file, url: PAGE, width: 400, height: 300, portWaitMs: START_WAIT_MS, ready: 'false', timeoutMs: 1500 }).then(() => null, (e: unknown) => e)) as Error | null;
    expect(err?.message).toMatch(/^the page was never ready/);
    expect(s.launches()).toBe('r');
  }, 90_000);

  it('the page stays visible and focused for the run (focus emulation), and an `until` action waits for its condition or fails by name', async () => {
    const r = (await shootLeaf({ chrome, url: PAGE, width: 400, height: 300, portWaitMs: START_WAIT_MS, ready: "document.getElementById('p') !== null", actions: [
      { read: '(setTimeout(() => { globalThis.late = 1; }, 700), 1)', as: 'armed' }, { until: 'globalThis.late === 1', as: 'late' }, { read: 'globalThis.late', as: 'seen' },
      { read: '({ v: document.visibilityState, f: document.hasFocus() })', as: 'page' },
    ] })) as { attempts: number; acted: Record<string, unknown> };
    expect(r.attempts).toBe(1);
    expect(r.acted.seen).toBe(1);
    expect(r.acted.page).toEqual({ v: 'visible', f: true });
    const err = (await shootLeaf({ chrome, url: PAGE, width: 400, height: 300, portWaitMs: START_WAIT_MS, ready: "document.getElementById('p') !== null", actions: [{ until: 'false', as: 'never', timeoutMs: 600 }] }).then(() => null, (e: unknown) => e)) as Error | null;
    expect(err?.message).toBe('the page never reached: never');
  }, 90_000);
});
