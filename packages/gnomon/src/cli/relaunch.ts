/**
 * @symbol #gui-relaunch
 *
 * #gui-relaunch (T-2026-10-20-001): a kernel started WITHOUT the terminal
 * launch loop (`gnomon daemon start | --detach`, `gnomond` without
 * --foreground) opens the GUI by itself, so a stop-then-start never leaves
 * the human with "run `gnomon` in a terminal" as the only way back.
 *
 * The SAME launch path bare `gnomon` uses on a running kernel, reused, not a
 * parallel one: this process is the human's CLI, it holds this home's device
 * key, and asks the kernel for a launch grant over the human-device verb
 * `gui.open` (requestRunningLaunch: the home's pin verifies the kernel's
 * hello BEFORE the device signs; the kernel mints under its ONE launch-grant
 * cap; single use, 60 s). The URL then goes ONLY to the browser opener
 * (osascript's STDIN, open-browser.ts): never to stdout (often a pipe or a
 * log here), argv, env or a file. Lines printed carry no URL and no token.
 *
 * Off with `--no-open` or GNOMON_NO_OPEN=1; an unprovisioned home, a kernel
 * this home cannot verify, or a non-macOS host opens nothing and says so.
 */
import { sanitizeDisplayText } from '@a-company/gnomon-contracts';
import { isOpenableUrl, terminalOpener, type BrowserOpener } from './open-browser.js';
import { requestRunningLaunch, UpRefusal, type RunningLaunchGrant } from './up-cli.js';

export type OpenGuiAfterStart = (home: string, out: { write(s: string): unknown }) => Promise<boolean>;

export interface RelaunchDeps {
  /** default: requestRunningLaunch (gui.open on the home's verified device connection) */
  request?: (home: string) => Promise<RunningLaunchGrant>;
  /** default: terminalOpener (osascript stdin) */
  open?: BrowserOpener;
  env?: Readonly<Record<string, string | undefined>>;
  noOpen?: boolean;
}

export const RELAUNCH_OPENED = 'gui     opened in your default browser (the single-use launch URL is not printed)';
const NEXT = 'open Gnomon.app, or run `gnomon` in a terminal';

/** The open-after-start step, or null when auto-open is off (--no-open, GNOMON_NO_OPEN). */
export function openGuiAfterStart(deps: RelaunchDeps = {}): OpenGuiAfterStart | null {
  const opener = terminalOpener({ noOpen: deps.noOpen === true, env: deps.env ?? process.env, ...(deps.open ? { open: deps.open } : {}) });
  if (!opener) return null;
  const request = deps.request ?? ((home: string) => requestRunningLaunch(home, undefined));
  return async (home, out) => {
    let g: RunningLaunchGrant;
    try {
      g = await request(home);
    } catch (e) {
      // the refusal's words only (sanitized): a refusal never carries the token
      const why = e instanceof UpRefusal ? `${e.reason}: ${e.message}` : e instanceof Error ? e.message : String(e);
      out.write(`gui     not opened (${sanitizeDisplayText(why).text}); ${NEXT}\n`);
      return false;
    }
    if (!isOpenableUrl(g.url)) {
      out.write(`gui     not opened (the kernel's grant is not a loopback launch URL); ${NEXT}\n`);
      return false;
    }
    let r;
    try {
      r = await opener(g.url);
    } catch (e) {
      r = { ok: false as const, reason: e instanceof Error ? e.message : String(e) };
    }
    out.write(r.ok ? `${RELAUNCH_OPENED}\n` : `gui     not opened (could not open your browser: ${sanitizeDisplayText(r.reason).text}); ${NEXT}\n`);
    return r.ok;
  };
}
