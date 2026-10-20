/**
 * T-2026-10-20-001 #gui-relaunch: no web port is remembered across a restart (Aegis H1), and a start without
 * a terminal opens the GUI through gui.open + the browser opener without ever printing the URL.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openGuiAfterStart, RELAUNCH_OPENED } from '../src/cli/relaunch.js';
import { UpRefusal } from '../src/cli/up-cli.js';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const URL1 = 'http://127.0.0.1:51234/#launch=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&k=KEY';

describe('no remembered port (Aegis H1)', () => {
  it('FALSIFIER: no code reads or writes a web-port file, and the daemon deletes a leftover one at start', () => {
    const src = (f: string): string => fs.readFileSync(path.join(PKG, 'src', f), 'utf8');
    expect(fs.existsSync(path.join(PKG, 'src', 'kernel', 'web', 'last-port.ts'))).toBe(false);
    expect(src('kernel/web/endpoint.ts')).not.toMatch(/web-port|rememberPort|LastPort/);
    const d = src('kernel/lifecycle/daemon.ts');
    expect(d).toMatch(/rmSync\(path\.join\(home, 'web-port\.json'\), \{ force: true \}\)/);
    expect(d).not.toMatch(/readFileSync\([^)]*web-port/);
  });
});

describe('openGuiAfterStart', () => {
  const sink = () => {
    const o: string[] = [];
    return { o, out: { write: (s: string) => o.push(s) } };
  };

  it('asks gui.open, hands the URL to the opener only, and prints no URL or token', async () => {
    const opened: string[] = [];
    const go = openGuiAfterStart({ env: {}, request: async () => ({ url: URL1, expiresAt: 'x' }), open: async (u) => (opened.push(u), { ok: true }) })!;
    const s = sink();
    expect(await go('/h', s.out)).toBe(true);
    expect(opened).toEqual([URL1]);
    expect(s.o.join('')).toBe(`${RELAUNCH_OPENED}\n`);
    expect(s.o.join('')).not.toContain('127.0.0.1');
  });

  it('--no-open / GNOMON_NO_OPEN: no step at all', () => {
    expect(openGuiAfterStart({ noOpen: true, env: {} })).toBeNull();
    expect(openGuiAfterStart({ env: { GNOMON_NO_OPEN: '1' } })).toBeNull();
  });

  it('a refusal, a non-launch URL, or a failed open: nothing opened, no URL printed, Gnomon.app named', async () => {
    let opened = 0;
    const open = async () => (opened++, { ok: true as const });
    const r1 = sink();
    const refuse = async (): Promise<never> => {
      throw new UpRefusal('unprovisioned', 'no identity');
    };
    expect(await openGuiAfterStart({ env: {}, open, request: refuse })!('/h', r1.out)).toBe(false);
    expect(r1.o.join('')).toContain('Gnomon.app');
    const r2 = sink();
    expect(await openGuiAfterStart({ env: {}, open, request: async () => ({ url: 'https://evil.example/#launch=x', expiresAt: 'x' }) })!('/h', r2.out)).toBe(false);
    expect(opened).toBe(0);
    const r3 = sink();
    expect(await openGuiAfterStart({ env: {}, open: async () => ({ ok: false, reason: 'osascript exited 1' }), request: async () => ({ url: URL1, expiresAt: 'x' }) })!('/h', r3.out)).toBe(false);
    expect(r3.o.join('')).not.toContain('launch=');
  });
});
