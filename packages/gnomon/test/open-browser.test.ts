/**
 * #bare-entry / #first-run auto-open (spec §2.4 rule 10, §11.2 rule 2, probe P07): the launch URL goes to the
 * default browser on osascript's STDIN, never argv or env; the URL is validated first; a failure falls back to
 * printing; `--no-open` / GNOMON_NO_OPEN turn it off; no TTY and the wrapper channel never open.
 * Platform-free: the platform and the spawner are injected (the real darwin smoke is open-browser-darwin.test.ts).
 */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { isOpenableUrl, noOpenFromEnv, openInDefaultBrowser, OSASCRIPT, presentUrl, terminalOpener, type OpenerChild, type OpenerSpawn, type OpenResult } from '../src/cli/open-browser.js';
import { printLaunch } from '../src/cli/launch-tty.js';
import { runUpCommand, upOpener } from '../src/cli/up-cli.js';
import { runBareCommand } from '../src/cli/bare-cli.js';
import { runSetupCommand } from '../src/cli/setup-cli.js';
import { PKG_ROOT } from './helpers.js';

const TOKEN = 'tok_ABCdef-0123456789abcdefghijklmnopqrstuvwxyzAB';
const URL1 = `http://127.0.0.1:51234/#launch=${TOKEN}&k=MCowBQYDK2VwAyEA-key_x&cwd=L1VzZXJzL3g`;

/** A fake osascript: records argv/env/opts and everything written to stdin; exits with `code` after stdin ends. */
function fakeSpawn(code: number | 'hang' | 'error' = 0) {
  const calls: { file: string; args: readonly string[]; opts: Parameters<OpenerSpawn>[2]; stdin: string }[] = [];
  const spawn: OpenerSpawn = (file, args, opts) => {
    const ee = new EventEmitter();
    const call = { file, args, opts, stdin: '' };
    calls.push(call);
    const child: OpenerChild = {
      stdin: {
        write: (s: string) => ((call.stdin += s), true),
        end: () => {
          if (code === 'error') setImmediate(() => ee.emit('error', new Error('ENOENT')));
          else if (code !== 'hang') setImmediate(() => ee.emit('exit', code, null));
        },
        on: () => undefined,
      },
      on: ((ev: string, l: (...a: unknown[]) => void) => ee.on(ev, l)) as OpenerChild['on'],
      kill: () => setImmediate(() => ee.emit('exit', null, 'SIGKILL')),
    };
    return child;
  };
  return { spawn, calls };
}

const tty = (isTTY = true) => {
  const o: string[] = [];
  const e: string[] = [];
  return { o, e, io: { stdin: new PassThrough(), stdout: { isTTY, write: (s: string) => (o.push(s), true) }, stderr: { write: (s: string) => (e.push(s), true) } } };
};

describe('openInDefaultBrowser: the URL travels on stdin only', () => {
  it('FALSIFIER (G-GUI-12, P07): argv is exactly ["-"], the env is empty, no shell; the URL is on stdin and nowhere else', async () => {
    const f = fakeSpawn(0);
    expect(await openInDefaultBrowser(URL1, { platform: 'darwin', spawn: f.spawn })).toEqual({ ok: true });
    expect(f.calls).toHaveLength(1);
    const c = f.calls[0]!;
    expect(c.file).toBe(OSASCRIPT);
    expect(c.file).toBe('/usr/bin/osascript');
    expect(c.args).toEqual(['-']);
    expect(c.opts.env).toEqual({});
    expect(c.opts.shell).toBe(false);
    expect(c.stdin).toBe(`open location "${URL1}"\n`);
    expect(JSON.stringify([c.file, c.args, c.opts])).not.toContain(TOKEN);
  });

  it('validation refuses quotes, backslashes, newlines, other hosts, https and a missing fragment; nothing is spawned', async () => {
    const bad = [
      `${URL1}"`,
      `http://127.0.0.1:51234/#launch=a" & do shell script "id`,
      `http://127.0.0.1:51234/#launch=a\\b`,
      `http://127.0.0.1:51234/#launch=a\nb`,
      `${URL1}\n`,
      `http://localhost:51234/#launch=a`,
      `http://127.0.0.2:51234/#launch=a`,
      `http://127.0.0.1.evil.com:51234/#launch=a`,
      `https://127.0.0.1:51234/#launch=a`,
      `http://127.0.0.1:51234/`,
      `http://127.0.0.1:51234/x#launch=a`,
      `http://127.0.0.1:123456/#launch=a`,
      `http://127.0.0.1:51234/#launch=a b`,
      `file:///etc/passwd`,
      '',
    ];
    const f = fakeSpawn(0);
    for (const u of bad) {
      expect(isOpenableUrl(u), JSON.stringify(u)).toBe(false);
      expect((await openInDefaultBrowser(u, { platform: 'darwin', spawn: f.spawn })).ok).toBe(false);
    }
    expect(f.calls).toHaveLength(0);
    expect(isOpenableUrl(URL1)).toBe(true);
    expect(isOpenableUrl('http://127.0.0.1:5/#setup=abc_-&k=x%2F.y')).toBe(true);
  });

  it('non-darwin: failed, nothing spawned; a non-zero exit, a spawn error, a throw and a hang are all failed, never thrown', async () => {
    const f = fakeSpawn(0);
    expect(await openInDefaultBrowser(URL1, { platform: 'linux', spawn: f.spawn })).toMatchObject({ ok: false });
    expect(await openInDefaultBrowser(URL1, { platform: 'win32', spawn: f.spawn })).toMatchObject({ ok: false });
    expect(f.calls).toHaveLength(0);
    expect(await openInDefaultBrowser(URL1, { platform: 'darwin', spawn: fakeSpawn(1).spawn })).toMatchObject({ ok: false, reason: 'osascript exited 1' });
    expect(await openInDefaultBrowser(URL1, { platform: 'darwin', spawn: fakeSpawn('error').spawn })).toMatchObject({ ok: false });
    const throwing: OpenerSpawn = () => {
      throw new Error('EACCES');
    };
    expect(await openInDefaultBrowser(URL1, { platform: 'darwin', spawn: throwing })).toMatchObject({ ok: false });
    expect(await openInDefaultBrowser(URL1, { platform: 'darwin', spawn: fakeSpawn('hang').spawn, timeoutMs: 30 })).toMatchObject({ ok: false, reason: 'osascript timed out' });
    const r = await openInDefaultBrowser(URL1, { platform: 'darwin', spawn: fakeSpawn(1).spawn });
    expect(JSON.stringify(r)).not.toContain(TOKEN); // a failure reason never echoes the URL
  });
});

describe('the terminal: opened, or printed as before', () => {
  it('the URL is printed BEFORE the open attempt (Aegis L2); a failed open is reported under it; no opener: the copy line', async () => {
    const ok: string[] = [];
    expect(await presentUrl({ write: (s: string) => ok.push(s) }, URL1, async () => ({ ok: true }), 'open this')).toBe(true);
    expect(ok.join('')).toContain('opening in your browser');
    expect(ok.join('')).toContain(`if it doesn't open: ${URL1}`);
    const order: string[] = [];
    await presentUrl({ write: (s: string) => order.push(`w:${s.includes(URL1)}`) }, URL1, async () => (order.push('open'), { ok: true }), 'open this');
    expect(order[0]).toBe('w:true'); // printed first
    const no: string[] = [];
    expect(await presentUrl({ write: (s: string) => no.push(s) }, URL1, async () => ({ ok: false, reason: 'osascript exited 1' }), 'open this')).toBe(false);
    expect(no.join('')).toContain(`if it doesn't open: ${URL1}`);
    expect(no.join('')).toContain('could not open your browser: osascript exited 1');
    const plain: string[] = [];
    expect(await presentUrl({ write: (s: string) => plain.push(s) }, URL1, null, 'open this')).toBe(false);
    expect(plain.join('')).toContain(`open this:\n\n  ${URL1}\n`);
    const thrown: string[] = [];
    await presentUrl({ write: (s: string) => thrown.push(s) }, URL1, () => Promise.reject(new Error('boom')), 'open this');
    expect(thrown.join('')).toContain(`if it doesn't open: ${URL1}\n`);
    const off: string[] = [];
    await presentUrl({ write: (s: string) => off.push(s) }, URL1, null, 'open this');
    expect(off.join('')).toBe(`\n  open this:\n\n  ${URL1}\n`);
  });

  it('printLaunch opens the minted URL (with the hint suffix) on a TTY, again on each fresh URL; off a TTY it opens without printing (#gui-relaunch)', async () => {
    const opened: string[] = [];
    const open = async (u: string): Promise<OpenResult> => (opened.push(u), { ok: true });
    let mints = 0;
    const k = { launch: async () => (mints++, { url: 'http://127.0.0.1:51234/#launch=T0k&k=KEY' }) as never };
    const t = tty(true);
    expect(await printLaunch(k, t.io, 'Enter = a fresh URL', '&cwd=abc', open)).toBe(true);
    expect(opened).toEqual(['http://127.0.0.1:51234/#launch=T0k&k=KEY&cwd=abc']);
    expect(t.o.join('')).toContain('opening in your browser');
    expect(t.o.join('')).toContain("if it doesn't open: http://127.0.0.1:51234/#launch=T0k&k=KEY&cwd=abc");
    expect(t.o.join('')).toContain('Enter = a fresh URL');
    // the Enter keypress calls printLaunch again: the fresh URL opens too
    await printLaunch(k, t.io, 'Enter = a fresh URL', '&cwd=abc', open);
    expect(opened).toHaveLength(2);
    // T-2026-10-20-001: no TTY (nohup, a script) still opens the GUI, and the URL never reaches stdout
    const p = tty(false);
    expect(await printLaunch(k, p.io, 'keys', '&cwd=abc', open)).toBe(true);
    expect(opened).toHaveLength(3);
    expect(opened[2]).toBe('http://127.0.0.1:51234/#launch=T0k&k=KEY&cwd=abc');
    expect(mints).toBe(3);
    expect(p.o.join('')).not.toContain('T0k');
    expect(p.o.join('')).not.toContain('127.0.0.1');
    expect(p.o.join('')).toContain('opened in your default browser');
    // a failing opener: still no URL on stdout, and the UI path is named first
    const f = tty(false);
    expect(await printLaunch(k, f.io, 'keys', '', async () => ({ ok: false, reason: 'osascript exited 1' }))).toBe(false);
    expect(f.o.join('')).not.toContain('T0k');
    expect(f.o.join('')).toContain('Open Gnomon.app');
    // no TTY and no opener (--no-open / GNOMON_NO_OPEN): nothing minted, nothing opened
    const n = tty(false);
    expect(await printLaunch(k, n.io, 'keys', '', null)).toBe(false);
    expect(mints).toBe(4);
    expect(n.o.join('')).toContain('auto-open is off');
  });
});

describe('--no-open and GNOMON_NO_OPEN', () => {
  const open = async (): Promise<OpenResult> => ({ ok: true });
  it('GNOMON_NO_OPEN set (not "" / "0") or --no-open: no opener; otherwise the injected (or default) one', () => {
    expect(noOpenFromEnv({ GNOMON_NO_OPEN: '1' })).toBe(true);
    expect(noOpenFromEnv({ GNOMON_NO_OPEN: 'yes' })).toBe(true);
    expect(noOpenFromEnv({ GNOMON_NO_OPEN: '0' })).toBe(false);
    expect(noOpenFromEnv({ GNOMON_NO_OPEN: '' })).toBe(false);
    expect(noOpenFromEnv({})).toBe(false);
    expect(terminalOpener({ env: { GNOMON_NO_OPEN: '1' }, open })).toBeNull();
    expect(terminalOpener({ noOpen: true, env: {}, open })).toBeNull();
    expect(terminalOpener({ env: {}, open })).toBe(open);
    expect(typeof terminalOpener({ env: {} })).toBe('function');
    expect(upOpener({ open, openEnv: {} }, { noOpen: true })).toBeNull();
    expect(upOpener({ open, openEnv: { GNOMON_NO_OPEN: '1' } }, {})).toBeNull();
    expect(upOpener({ open, openEnv: {} }, {})).toBe(open);
  });

  it('the test runner itself never opens a real browser (vitest.config sets GNOMON_NO_OPEN)', () => {
    expect(noOpenFromEnv(process.env)).toBe(true);
    expect(terminalOpener({})).toBeNull();
  });

  it('argv: up, setup and bare gnomon accept --no-open; anything else is still a usage error', async () => {
    const t = tty(false);
    expect(await runUpCommand(['--no-open', '--nope'], t.io)).toBe(64);
    expect(await runSetupCommand(['--no-open', '--nope'], t.io)).toBe(64);
    expect(await runSetupCommand(['--no-open', '--no-open'], t.io)).toBe(64);
    expect(await runBareCommand(['--no-open', '--no-open'], t.io)).toBe(64);
    expect(await runBareCommand(['--open'], t.io)).toBe(64);
    // setup --cli --no-open parses (and refuses only for want of a TTY)
    const s = tty(false);
    expect(await runSetupCommand(['--cli', '--no-open'], s.io, { isTty: false })).toBe(1);
    expect(s.e.join('')).toContain('not-interactive');
  });

  it('the setup → up hand-off and bare `gnomon --no-open` carry the flag (entry wiring)', () => {
    const entry = fs.readFileSync(path.join(PKG_ROOT, 'src/cli/gnomon.ts'), 'utf8');
    expect(entry).toContain('continueUp: ({ noOpen }) => runUp(io, {}, { noOpen })');
    expect(entry).toContain("argv.length === 0 || argv[0] === '--no-open'");
    expect(fs.readFileSync(path.join(PKG_ROOT, 'src/cli/setup-cli.ts'), 'utf8')).toContain('deps.continueUp({ noOpen })');
  });
});
