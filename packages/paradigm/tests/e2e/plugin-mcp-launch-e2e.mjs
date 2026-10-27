#!/usr/bin/env node
/**
 * Real-npm end-to-end for the plugin's MCP launcher (plugins/paradigm/scripts/paradigm-mcp-launch.cjs).
 *
 * Run by .github/workflows/paradigm-plugin-windows.yml on windows-latest and ubuntu-latest; runnable locally:
 *   node packages/paradigm/tests/e2e/plugin-mcp-launch-e2e.mjs
 *
 * Sets up, under one work folder W:
 *   - W/package.json with devEngines pnpm / onFail "error" (npm 11 fails npx with EBADDEVENGINES if it walks up here)
 *   - W/node_modules/.bin/ plants (POSIX: node, sh; Windows: node.cmd, sh.cmd, cmd.cmd) that drop a marker file
 *     and print a forged PARADIGM_MCP_ENTRY if anything ever runs them
 *   - the OS temp dir pointed at W/t, so the launcher's npx folder sits under W (W is its ancestor)
 *   - a temp copy of the plugin whose plugin.json version is E2E_VERSION (default 8.0.3, the published one): the
 *     shipped launcher pins the plugin version, so the harness pins through the copy, not a launcher override
 *   - a project W/"proj x" whose package.json requires pnpm, with no node_modules (so the npx path is taken)
 * PATH holds only this node's folder (real node, npm, npx) and the system folders: no global paradigm-mcp.
 *
 * Then it starts the launcher like Claude Code does (node <launcher> <project>), sends an MCP initialize over
 * stdio and expects serverInfo back. It fails if no reply arrives, if any marker exists, or if the npx folder
 * under W/t was not used.
 */

import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const WIN = process.platform === 'win32';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const VERSION = process.env.E2E_VERSION || '8.0.3';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 300_000);

const log = (m) => process.stdout.write(`[e2e] ${m}\n`);
const fail = (m) => {
  process.stderr.write(`[e2e] FAIL: ${m}\n`);
  process.exitCode = 1;
};

const W = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pm e2e-')));
const write = (f, body) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
};
const pnpmOnly = (name) => JSON.stringify({ name, devEngines: { packageManager: { name: 'pnpm', onFail: 'error' } } });

write(path.join(W, 'package.json'), pnpmOnly('pnpm-only-ancestor'));

const evil = path.join(W, 'evil.js');
write(evil, `require('fs').writeFileSync(${JSON.stringify(path.join(W, 'evil-ran'))}, '')\n`);
const markers = [path.join(W, 'evil-ran')];
for (const name of WIN ? ['node', 'sh', 'cmd'] : ['node', 'sh']) {
  const marker = path.join(W, `planted-${name}-ran`);
  markers.push(marker);
  if (WIN) {
    write(path.join(W, 'node_modules', '.bin', `${name}.cmd`), `@echo off\r\ntype nul > "${marker}"\r\necho PARADIGM_MCP_ENTRY=${evil}\r\n`);
  } else {
    const p = path.join(W, 'node_modules', '.bin', name);
    write(p, `#!/bin/sh\n: > '${marker}'\necho 'PARADIGM_MCP_ENTRY=${evil}'\n`);
    fs.chmodSync(p, 0o755);
  }
}

const tmpDir = path.join(W, 't');
fs.mkdirSync(tmpDir, { mode: 0o700 });

const plugin = path.join(W, 'plugin copy');
const launcher = path.join(plugin, 'scripts', 'paradigm-mcp-launch.cjs');
write(launcher, fs.readFileSync(path.join(REPO, 'plugins', 'paradigm', 'scripts', 'paradigm-mcp-launch.cjs')));
write(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'paradigm', version: VERSION }));

const project = path.join(W, 'proj x');
write(path.join(project, 'package.json'), pnpmOnly('proj'));

const sys = WIN
  ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'), process.env.SystemRoot || 'C:\\Windows']
  : ['/usr/bin', '/bin'];
const env = { ...process.env, PATH: [path.dirname(process.execPath), ...sys].join(path.delimiter), TMPDIR: tmpDir, TEMP: tmpDir, TMP: tmpDir };
for (const k of Object.keys(env)) if (/^path$/i.test(k) && k !== 'PATH') delete env[k];
delete env.CLAUDE_PROJECT_DIR;

for (const shim of WIN ? ['paradigm-mcp.cmd', 'paradigm-mcp'] : ['paradigm-mcp']) {
  if (fs.existsSync(path.join(path.dirname(process.execPath), shim))) {
    fail(`${shim} is installed beside node, so the launcher would not take the npx path; run on a node without a global @a-company/paradigm`);
    process.exit(1);
  }
}

log(`work folder ${W}`);
log(`pinning @a-company/paradigm@${VERSION} through a plugin copy at ${plugin}`);

const child = spawn(process.execPath, [launcher, project], { cwd: W, env, stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
let reply = null;
child.stderr.on('data', (d) => (stderr += d));

const done = new Promise((resolve) => {
  const timer = setTimeout(() => resolve('timeout'), TIMEOUT_MS);
  child.stdout.on('data', (d) => {
    stdout += d;
    for (const line of stdout.split('\n')) {
      try {
        const msg = JSON.parse(line);
        if (msg && msg.id === 1) {
          reply = msg;
          clearTimeout(timer);
          resolve('reply');
        }
      } catch {
        /* partial or non-JSON line */
      }
    }
  });
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    resolve(`exit ${code ?? signal}`);
  });
});

child.stdin.write(
  `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'paradigm-e2e', version: '0.0.0' } },
  })}\n`,
);

const outcome = await done;
child.stdin.end();
if (WIN && child.pid) {
  // The launcher's server child would outlive a plain kill on Windows: end the whole tree.
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
} else {
  child.kill();
}

if (outcome !== 'reply') fail(`no initialize reply (${outcome})`);
else if (!reply.result || !reply.result.serverInfo) fail(`initialize reply has no serverInfo: ${JSON.stringify(reply)}`);
else log(`serverInfo ${JSON.stringify(reply.result.serverInfo)}`);

for (const m of markers) if (fs.existsSync(m)) fail(`planted executable ran: ${path.basename(m)}`);

const npxFolder = path.join(tmpDir, typeof process.getuid === 'function' ? `paradigm-mcp-npx-${process.getuid()}` : 'paradigm-mcp-npx');
if (!fs.existsSync(path.join(npxFolder, 'package.json'))) fail(`the npx folder ${npxFolder} was not used`);
if (/EBADDEVENGINES/.test(stderr)) fail('npm reported EBADDEVENGINES');

if (process.exitCode) {
  process.stderr.write(`--- launcher stderr ---\n${stderr}\n--- launcher stdout ---\n${stdout.slice(0, 4000)}\n`);
} else {
  log('ok: real npx located the pinned package; no planted executable ran');
}
// Give the child a moment to exit, then remove the work folder (best effort: Windows may still hold handles).
setTimeout(() => {
  try {
    fs.rmSync(W, { recursive: true, force: true });
  } catch {
    /* left for the runner to clean */
  }
  process.exit(process.exitCode ?? 0);
}, 1000);
