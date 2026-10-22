/**
 * `gnomon local set|status|remove` (#local-config-request, TD-2026-10-22-769): the raw form of Settings → Local model.
 * Usage refusals happen before any connection; status renders status.local with the readout helpers.
 */
import { describe, expect, it } from 'vitest';
import { LOCAL_EXIT_OK, LOCAL_EXIT_USAGE, LOCAL_USAGE, printStatus, runLocalCommand } from '../src/cli/local-cli.js';

const io = () => {
  const o: string[] = [];
  const e: string[] = [];
  return { stdout: { write: (s: string) => (o.push(s), true) }, stderr: { write: (s: string) => (e.push(s), true) }, o, e };
};

describe('gnomon local', () => {
  it('--help names the verbs, loopback only and the guided form', async () => {
    const x = io();
    expect(await runLocalCommand(['--help'], x)).toBe(LOCAL_EXIT_OK);
    const t = x.o.join('');
    for (const w of ['gnomon local set --model', 'status', 'remove', 'LAN endpoints land in 8.1', 'Settings → Local model']) expect(t).toContain(w);
    expect(LOCAL_USAGE).toContain('--runner <abs dir>');
  });
  it('refuses usage errors before any connection', async () => {
    for (const argv of [[], ['frob'], ['set'], ['set', '--model'], ['set', '--model', 'm', '--runner', 'rel/dir'], ['status', '--model', 'm'], ['remove', '--loops'], ['set', '--model', 'm', '--home', 'rel'], ['set', '--model', 'm', '--nope']]) {
      const x = io();
      expect(await runLocalCommand(argv, x), argv.join(' ')).toBe(LOCAL_EXIT_USAGE);
      expect(x.e.join('')).toMatch(/usage|BAD_REQUEST/);
    }
  });
  it('status renders the applied config, the runner and the 8.0 rule', () => {
    const x = io();
    printStatus(x.stdout, { configured: true, version: 2, endpoints: [{ id: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen3.5:9b', compat: 'ollama', loops: true }], runner: { dir: '/x/gnomon-local', treeSha256: 'a'.repeat(64) }, defaultRunner: { source: 'bundled', dir: '/x/gnomon-local' }, pendingCardId: null });
    const t = x.o.join('');
    for (const w of ['version 2 applied', 'ollama http://127.0.0.1:11434 model qwen3.5:9b (ollama), trusted loops may use it', '/x/gnomon-local (tree aaaaaaaaaaaa…)', 'loopback only in 8.0']) expect(t).toContain(w);
    const y = io();
    printStatus(y.stdout, { configured: false, endpoints: [], runner: null, defaultRunner: { source: null, why: 'none' } });
    expect(y.o.join('')).toContain('gnomon local set --model <id>');
  });
});

describe('request.local.config / request.local.probe are dispatcher-only: no contract id moves', () => {
  it('clientApiId equals its pin, and neither kind is a §9.1 request kind (never a row)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { CLIENT_API_ID, KIT_ID } = await import('@a-company/gnomon-contracts');
    const { HUMAN_REQUEST_KINDS } = await import('../src/kernel/socket/log-append.js');
    const { LOCAL_CONFIG_REQUEST, LOCAL_PROBE_REQUEST } = await import('../src/kernel/socket/dispatch.js');
    const { PKG_ROOT } = await import('./helpers.js');
    const pins = JSON.parse(readFileSync(path.join(PKG_ROOT, '..', 'gnomon-contracts', 'schemas', 'client-api.ids.json'), 'utf8')) as { clientApiId: string; kitId: string };
    expect({ clientApiId: CLIENT_API_ID, kitId: KIT_ID }).toEqual({ clientApiId: pins.clientApiId, kitId: pins.kitId });
    expect(HUMAN_REQUEST_KINDS).not.toContain(LOCAL_CONFIG_REQUEST);
    expect(HUMAN_REQUEST_KINDS).not.toContain(LOCAL_PROBE_REQUEST);
  });
});
