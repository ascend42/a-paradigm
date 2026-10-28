/**
 * Where ^command-execution-consent is read from, and when it is believed
 * (#command-consent, #claude-provider).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandGate,
  isInteractiveTerminal,
  readAllowCommandsSetting,
  userConfigPath,
  userHomeDir,
  writeAllowCommandsSetting,
} from './command-consent.js';
import { MAX_LOGGED_COMMAND, commandLogPathFor, executeTool } from './claude-tools.js';
import { ClaudeAgentProvider, unsafeRunRoot } from './claude.js';
import type { AgentDefinition } from '../../commands/team/types.js';

let tmp: string;
let home: string;
let work: string;
let configPath: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'consent-trust-')));
  home = path.join(tmp, 'home');
  work = path.join(home, 'proj');
  fs.mkdirSync(work, { recursive: true });
  configPath = path.join(home, '.paradigm', 'config.yaml');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const quiet = { notify: () => {} };

describe('where the setting comes from', () => {
  it('home comes from the account database, so HOME=. changes nothing', () => {
    const before = userConfigPath();
    vi.stubEnv('HOME', '.');
    expect(userHomeDir()).toBe(os.userInfo().homedir);
    expect(userConfigPath()).toBe(before);
    expect(path.isAbsolute(userConfigPath())).toBe(true);
  });

  it('a config symlinked into the working directory is ignored', () => {
    const planted = path.join(work, 'evil.yaml');
    fs.writeFileSync(planted, 'agent-provider:\n  allow-commands: true\n', { mode: 0o600 });
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.symlinkSync(planted, configPath);
    expect(readAllowCommandsSetting(configPath)).toBe(true);
    expect(readAllowCommandsSetting(configPath, work)).toBeUndefined();
    const gate = new CommandGate({}, { configPath, workingDirectory: work, isInteractive: () => false, ...quiet });
    expect(gate.isOffered()).toBe(false);
  });

  it('a group- or world-writable config is ignored', () => {
    writeAllowCommandsSetting(true, configPath);
    expect(readAllowCommandsSetting(configPath)).toBe(true);
    fs.chmodSync(configPath, 0o664);
    expect(readAllowCommandsSetting(configPath)).toBeUndefined();
    fs.chmodSync(configPath, 0o606);
    expect(readAllowCommandsSetting(configPath)).toBeUndefined();
  });

  it('saves atomically with mode 0600, keeping other keys, and refuses a config folder inside the root', () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'other: 1\n', { mode: 0o644 });
    writeAllowCommandsSetting(false, configPath);
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(configPath, 'utf-8')).toMatch(/other: 1/);
    expect(readAllowCommandsSetting(configPath)).toBe(false);
    expect(fs.readdirSync(path.dirname(configPath)).filter((f) => f.endsWith('.tmp'))).toEqual([]);

    expect(() => writeAllowCommandsSetting(true, path.join(work, 'cfg', 'config.yaml'), work)).toThrow(/inside the working directory/);
  });

  it('CI being set means no one is at the terminal', () => {
    vi.stubEnv('CI', 'true');
    expect(isInteractiveTerminal()).toBe(false);
    const gate = new CommandGate({}, { configPath, ...quiet });
    expect(gate.isOffered()).toBe(false);
  });
});

describe('run root', () => {
  it('refuses /, the home folder and anything above it; accepts a project inside home', () => {
    expect(unsafeRunRoot('/', home)).toMatch(/filesystem root/);
    expect(unsafeRunRoot(home, home)).toMatch(/home folder/);
    expect(unsafeRunRoot(tmp, home)).toMatch(/home folder/);
    expect(unsafeRunRoot(work, home)).toBeNull();
  });
});

describe('command log', () => {
  it('lives under ~/.paradigm/logs/<project-hash>/, mode 0600, with long commands cut and their length kept', async () => {
    const logPath = commandLogPathFor(work, home);
    expect(logPath).toMatch(new RegExp(`^${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.paradigm/logs/[0-9a-f]{16}/agent-commands\\.jsonl$`));
    const gate = new CommandGate({ allowCommands: true }, { configPath, ...quiet });
    const long = `true ${'x'.repeat(5000)}`;
    await executeTool('run_command', { command: long }, {
      workingDirectory: work, gate, commandsOffered: true, commandLogPath: logPath,
    });
    expect(fs.statSync(logPath).mode & 0o777).toBe(0o600);
    const rec = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim());
    expect(rec.command).toHaveLength(MAX_LOGGED_COMMAND);
    expect(rec.commandLength).toBe(long.length);
    expect(rec.project).toBe(work);
    expect(rec.exitCode).toBe(0);
  });
});

describe('provider run', () => {
  const agent = { name: 'builder', role: 'build' } as AgentDefinition;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  function sse(events: unknown[]): Response {
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200 });
  }

  it('refuses to start with the home folder as the working directory', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const provider = new ClaudeAgentProvider({ configPath, homeDir: home, ...quiet });
    const out = [];
    for await (const m of provider.spawn(agent, {
      task: 't', context: { systemPrompt: '', files: [], symbols: [] }, workingDirectory: home,
    })) out.push(m);
    expect(out[0]).toMatchObject({ type: 'error' });
    expect(out[0].content).toMatch(/home folder/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a setting flipped to true mid-run does not enable run_command', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const bodies: Array<{ tools: Array<{ name: string }> }> = [];
    let call = 0;
    globalThis.fetch = vi.fn(async (_u: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body)));
      call++;
      if (call === 1) {
        // Something flips the saved setting while the run is going.
        writeAllowCommandsSetting(true, configPath);
        return sse([
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'run_command' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"echo flipped > f.txt"}' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_stop' },
        ]);
      }
      return sse([{ type: 'message_stop' }]);
    }) as unknown as typeof fetch;

    const provider = new ClaudeAgentProvider({ configPath, homeDir: home, isInteractive: () => false, ...quiet });
    const results: string[] = [];
    for await (const m of provider.spawn(agent, {
      task: 't', context: { systemPrompt: '', files: [], symbols: [] }, workingDirectory: work,
    })) {
      if (m.type === 'tool_result') results.push(m.content);
    }
    expect(bodies[0].tools.map((t) => t.name)).not.toContain('run_command');
    expect(bodies[1].tools.map((t) => t.name)).not.toContain('run_command');
    expect(results[0]).toMatch(/not offered/);
    expect(fs.existsSync(path.join(work, 'f.txt'))).toBe(false);
  });
});
