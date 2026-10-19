// @gnomon-platform: darwin
/**
 * The darwin half of auto-open (spec §2.4 rule 10): the real osascript accepts a script on stdin with argv
 * ['-'] and an EMPTY env (wrapped so nothing opens), and the GUI setup flow on a terminal hands every fresh
 * setup URL to the opener (also each re-link after expiry), or none with --no-open.
 * Platform-free logic lives in test/open-browser.test.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { openInDefaultBrowser, openLocationScript } from '../src/cli/open-browser.js';
import { runGuiSetup } from '../src/cli/setup-cli.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { privateTmpRoot } from './daemon-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
const CLEAN = { env: {}, execArgv: ['--disable-sigusr1'] as string[] };

describe('darwin: the real osascript', () => {
  it.skipIf(process.env.CI !== undefined)('accepts the script on stdin, argv ["-"], empty env (the open line compiled in a handler never called, so nothing opens)', async () => {
    const url = 'http://127.0.0.1:51234/#launch=abc_-&k=key';
    let built = '';
    const r = await openInDefaultBrowser(url, {
      script: (u) => {
        built = openLocationScript(u);
        return `on neverCalled()\n${built}end neverCalled\nreturn\n`;
      },
    });
    expect(built).toBe(`open location "${url}"\n`);
    expect(r).toEqual({ ok: true });
  });
});

describe('darwin: GUI setup on a terminal opens each setup URL', () => {
  const home = (): string => {
    const d = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), 'gob-')));
    cleanups.push(() => removeTree(d));
    return d;
  };
  const tty = () => {
    const o: string[] = [];
    return { o, io: { stdin: Object.assign(new PassThrough(), { isTTY: true }), stdout: { isTTY: true, write: (s: string) => (o.push(s), true) }, stderr: { write: () => true } } };
  };

  it('every fresh link (the first and each re-link after expiry) is opened; the URL also stays printed', async () => {
    const opened: string[] = [];
    const t = tty();
    const r = await runGuiSetup(t.io, { userHome: home(), isTty: true, handleSignals: false, runtime: CLEAN, ttlMs: 400, openEnv: {}, open: async (u) => (opened.push(u), { ok: true }) }, 'tty', '&cwd=L3g');
    expect(r.code).toBe(1); // every link expired unused
    expect(opened).toHaveLength(3);
    for (const u of opened) expect(u).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#setup=[A-Za-z0-9_-]+&k=[A-Za-z0-9_-]+&cwd=L3g$/);
    expect(new Set(opened).size).toBe(3);
    const out = t.o.join('');
    expect(out.split('opening in your browser').length - 1).toBe(3);
    for (const u of opened) expect(out).toContain(`if it doesn't open: ${u}`);
  }, 30_000);

  it('--no-open: the setup URL is printed only, the opener is never called', async () => {
    const opened: string[] = [];
    const t = tty();
    const r = await runGuiSetup(t.io, { userHome: home(), isTty: true, handleSignals: false, runtime: CLEAN, ttlMs: 300, noOpen: true, openEnv: {}, open: async (u) => (opened.push(u), { ok: true }) }, 'tty');
    expect(r.code).toBe(1);
    expect(opened).toEqual([]);
    expect(t.o.join('')).toMatch(/open this in your browser within 60 s \(single use\) to set up Gnomon on screens:\n\n {2}http:\/\/127\.0\.0\.1:\d+\/#setup=/);
    expect(t.o.join('')).not.toContain('opening in your browser');
  }, 30_000);
});
