/**
 * T-2026-10-20-001 #gui-relaunch: the remembered web port is a strict, secret-free preference, and a start without
 * a terminal opens the GUI through gui.open + the browser opener without ever printing the URL.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAST_PORT_FILE, readLastPort, writeLastPort } from '../src/kernel/web/last-port.js';
import { openGuiAfterStart, RELAUNCH_OPENED } from '../src/cli/relaunch.js';
import { UpRefusal } from '../src/cli/up-cli.js';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-relaunch-'));
const URL1 = 'http://127.0.0.1:51234/#launch=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&k=KEY';

describe('last-port', () => {
  it('round-trips a port and holds nothing else', () => {
    const d = tmp();
    expect(readLastPort(d)).toBeNull();
    expect(writeLastPort(d, 51234)).toBe(true);
    expect(readLastPort(d)).toBe(51234);
    const raw = JSON.parse(fs.readFileSync(path.join(d, LAST_PORT_FILE), 'utf8'));
    expect(Object.keys(raw).sort()).toEqual(['port', 'schemaVersion']);
  });

  it('falsifier: a planted or malformed file is never a preference', () => {
    const d = tmp();
    const f = path.join(d, LAST_PORT_FILE);
    const bodies = [
      '{',
      '[]',
      '{"schemaVersion":"gnomon-web-port:v1","port":80}',
      '{"schemaVersion":"gnomon-web-port:v1","port":70000}',
      '{"schemaVersion":"gnomon-web-port:v1","port":"5000"}',
      '{"schemaVersion":"x","port":5000}',
      '{"schemaVersion":"gnomon-web-port:v1","port":5000,"resume":"t"}',
      ' '.repeat(300),
    ];
    for (const body of bodies) {
      fs.writeFileSync(f, body);
      expect(readLastPort(d)).toBeNull();
    }
    expect(writeLastPort(d, 80)).toBe(false);
    expect(writeLastPort(d, 1.5)).toBe(false);
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
