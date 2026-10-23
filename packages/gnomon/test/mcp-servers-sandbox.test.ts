// @gnomon-platform: darwin
/**
 * #mcp-servers (T-2026-10-23-003), Aegis "the sandbox for each server": a stdio MCP server Claude Code spawns is a
 * child of the session, so it runs under the session's own SBPL profile. Measured here with a real stdio server
 * under the real profile: it answers initialize + tools/list, it cannot write the first-party server's package dir
 * (mcpDenyWrite), and it cannot read the Gnomon home. Also measured: macOS refuses a nested sandbox_apply, which is
 * why no per-server network narrowing exists inside a session (the card says the server has the session's network).
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSessionPolicy } from '../src/kernel/manifest/policy.js';
import { sessionLaunchPlan } from '../src/kernel/sandbox/session.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (p: string): string => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
  dirs.push(d);
  return d;
};

const SERVER = `
const fs = require('node:fs');
let buf = '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
process.stdin.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\\n')) >= 0; ) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '0' } } });
    if (m.method === 'tools/list') {
      const tryWrite = (p) => { try { fs.writeFileSync(p, 'x'); return 'wrote'; } catch (e) { return e.code; } };
      const tryRead = (p) => { try { fs.readdirSync(p); return 'read'; } catch (e) { return e.code; } };
      out({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'probe_tool', inputSchema: { type: 'object' } }], denied: tryWrite(process.argv[2]), home: tryRead(process.argv[3]), repo: tryWrite(process.argv[4]) } });
    }
  }
});`;

describe('#mcp-servers: a stdio server runs inside the session profile', () => {
  it('answers tools/list under the profile; the first-party dir is write-denied and the Gnomon home unreadable', async () => {
    const home = tmp('gn-home-');
    const repo = tmp('gn-repo-');
    const pkg = tmp('gn-pkg-');
    const sess = path.join(home, 'sessions', 'probe');
    fs.mkdirSync(sess, { recursive: true });
    fs.writeFileSync(path.join(home, 'secret'), 'k');
    const script = path.join(pkg, 'server.cjs');
    fs.writeFileSync(script, SERVER);
    const userHome = tmp('gn-user-');
    const node = fs.realpathSync(process.execPath);
    const policy = buildSessionPolicy({ home, cwd: repo, userClaudeDir: path.join(userHome, '.claude'), userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, homeReadable: [{ path: sess, match: 'subpath' }], extraDenyWrite: [{ path: pkg, match: 'subpath', class: 'binary' }] });
    const plan = sessionLaunchPlan({ policy, binaryReal: node, argv: [script, path.join(pkg, 'planted.js'), home, path.join(repo, 'ok.txt')], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: userHome, roots: [repo] }, hsid: 'probe' }, 'darwin');
    expect(plan.sandbox).toBe('full');
    const ch = spawn(plan.command, plan.args, { cwd: repo, env: { HOME: userHome, PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines: Array<Record<string, unknown>> = [];
    let buf = '';
    const done = new Promise<void>((res) => {
      ch.stdout.on('data', (d) => {
        buf += d;
        for (let i; (i = buf.indexOf('\n')) >= 0; ) {
          lines.push(JSON.parse(buf.slice(0, i)));
          buf = buf.slice(i + 1);
          if (lines.length === 2) res();
        }
      });
    });
    ch.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    ch.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    await done;
    ch.kill();
    const r = lines[1]!.result as { tools: Array<{ name: string }>; denied: string; home: string; repo: string };
    expect(r.tools.map((t) => t.name)).toEqual(['probe_tool']);
    expect(r.denied).toBe('EPERM');
    expect(r.home).toBe('EPERM');
    expect(r.repo).toBe('wrote');
    expect(fs.existsSync(path.join(pkg, 'planted.js'))).toBe(false);
  }, 30_000);

  it('a nested sandbox_apply is refused (no per-server network profile inside a session; measured)', () => {
    const r = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network-outbound)', '/usr/bin/true'], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/sandbox_apply/);
  });
});
