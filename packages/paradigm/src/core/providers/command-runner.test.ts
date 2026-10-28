/**
 * #command-runner: cleaned environment, process-group kill, and search_files
 * glob limits (#claude-provider).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanCommandEnv, isSecretEnvName, killAllCommandGroups, runShellCommand } from './command-runner.js';
import { CommandGate } from './command-consent.js';
import { executeTool } from './claude-tools.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-runner-')));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pid: number, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
}

describe('cleaned environment', () => {
  it('drops secrets and keeps ordinary variables', () => {
    for (const name of [
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN',
      'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'MY_SERVICE_TOKEN',
      'DB_PASSWORD', 'STRIPE_SECRET', 'STRIPE_KEY', 'SENTRY_AUTH', 'GITLAB_PAT', 'SSH_AUTH_SOCK',
      'GOOGLE_APPLICATION_CREDENTIALS', 'npm_config__auth', 'slack_bot_token',
    ]) {
      expect(isSecretEnvName(name), name).toBe(true);
    }
    for (const name of ['PATH', 'HOME', 'LANG', 'TERM', 'PWD', 'SHELL', 'USER', 'NODE_ENV', 'KEYBOARD_LAYOUT', 'MONKEY']) {
      expect(isSecretEnvName(name), name).toBe(false);
    }
    const env = cleanCommandEnv({ PATH: '/bin', GITHUB_TOKEN: 'ghp_x', FOO_SECRET: 's' });
    expect(env).toEqual({ PATH: '/bin' });
  });

  it('a command does not see the CLI\'s secrets', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-should-not-leak');
    vi.stubEnv('MY_DEPLOY_TOKEN', 'tok-should-not-leak');
    vi.stubEnv('PARADIGM_VISIBLE', 'visible');
    const r = await runShellCommand('env', { cwd: tmp, timeoutMs: 5000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('should-not-leak');
    expect(r.stdout).toContain('PARADIGM_VISIBLE=visible');
    expect(r.stdout).toMatch(/^PATH=/m);
  });
});

describe.skipIf(process.platform === 'win32')('process group', () => {
  it('on timeout the whole group is killed, including background children', async () => {
    const pidFile = path.join(tmp, 'bg.pid');
    const r = await runShellCommand(`sleep 30 & echo $! > "${pidFile}"; wait`, { cwd: tmp, timeoutMs: 400 });
    expect(r.timedOut).toBe(true);
    const bg = Number(fs.readFileSync(pidFile, 'utf-8').trim());
    expect(bg).toBeGreaterThan(0);
    expect(await waitDead(bg)).toBe(true);
  });

  it('killAllCommandGroups (run on CLI exit and on SIGINT/SIGTERM/SIGHUP) kills running commands', async () => {
    const pidFile = path.join(tmp, 'bg2.pid');
    const running = runShellCommand(`sleep 30 & echo $! > "${pidFile}"; wait`, { cwd: tmp, timeoutMs: 60000 });
    const end = Date.now() + 3000;
    while (!fs.existsSync(pidFile) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 50));
    const bg = Number(fs.readFileSync(pidFile, 'utf-8').trim());
    killAllCommandGroups('SIGKILL');
    const r = await running;
    expect(r.exitCode).toBeNull();
    expect(await waitDead(bg)).toBe(true);
  });

  it('run_command reports a timeout and keeps the exit hooks tidy', async () => {
    const work = path.join(tmp, 'w');
    fs.mkdirSync(work);
    const gate = new CommandGate({ allowCommands: true }, { configPath: path.join(tmp, 'cfg.yaml'), notify: () => {} });
    const before = process.listenerCount('SIGINT');
    const out = await executeTool('run_command', { command: 'sleep 5' }, {
      workingDirectory: work, gate, commandsOffered: true, commandLogPath: path.join(tmp, 'log.jsonl'), timeout: 200,
    });
    expect(out).toMatch(/timed out after 200 ms/);
    expect(process.listenerCount('SIGINT')).toBe(before);
    const rec = JSON.parse(fs.readFileSync(path.join(tmp, 'log.jsonl'), 'utf-8').trim());
    expect(rec).toMatchObject({ exitCode: null, timedOut: true });
  });
});

describe('search_files limits', () => {
  it('refuses braces, absolute and leading-slash patterns', async () => {
    const work = path.join(tmp, 'w');
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, 'a.ts'), '');
    const gate = new CommandGate({ allowCommands: false }, { configPath: path.join(tmp, 'cfg.yaml'), notify: () => {} });
    const c = { workingDirectory: work, gate, commandsOffered: false, commandLogPath: path.join(tmp, 'log.jsonl') };
    for (const pattern of ['{a,../../etc}/*', '*.{ts,js}', '/etc/*', '\\\\host\\x']) {
      expect(await executeTool('search_files', { pattern }, c), pattern).toMatch(/must be a relative glob/);
    }
    expect((await executeTool('search_files', { pattern: '*.ts' }, c)).trim()).toBe('a.ts');
  });
});
