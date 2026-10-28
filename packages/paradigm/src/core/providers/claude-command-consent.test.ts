/**
 * ^command-execution-consent and working-directory confinement for the
 * Anthropic API provider's tools (#claude-provider, #command-consent).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandGate,
  readAllowCommandsSetting,
  writeAllowCommandsSetting,
} from './command-consent.js';
import { COMMAND_LOG_FILE, executeTool, toolDefinitions, type ToolContext } from './claude-tools.js';
import { ClaudeAgentProvider } from './claude.js';
import type { AgentDefinition } from '../../commands/team/types.js';

let tmp: string;
let work: string;
let outsideDir: string;
let configPath: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-consent-')));
  work = path.join(tmp, 'work');
  outsideDir = path.join(tmp, 'outside');
  fs.mkdirSync(work);
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'SECRET');
  configPath = path.join(tmp, 'home', '.paradigm', 'config.yaml');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function ctx(gate: CommandGate): ToolContext {
  return { workingDirectory: work, gate, agent: 'builder' };
}

function offered(gate: CommandGate): boolean {
  return toolDefinitions({ gate }).some((t) => t.name === 'run_command');
}

function readLog(): Array<Record<string, unknown>> {
  const file = path.join(work, COMMAND_LOG_FILE);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
}

const quiet = { notify: () => {} };

describe('command consent', () => {
  it('unset + not a TTY: run_command is not offered, and a call is refused without asking', async () => {
    const prompt = vi.fn(async () => true);
    const gate = new CommandGate({}, { configPath, prompt, isInteractive: () => false, ...quiet });
    expect(offered(gate)).toBe(false);

    const out = await executeTool('run_command', { command: 'echo hi > ran.txt' }, ctx(gate));
    expect(out).toMatch(/no one is at a terminal/);
    expect(prompt).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(work, 'ran.txt'))).toBe(false);
    expect(readAllowCommandsSetting(configPath)).toBeUndefined();
  });

  it('a background run (interactive: false) is not offered even when a TTY is attached', () => {
    const gate = new CommandGate({ interactive: false }, { configPath, isInteractive: () => true, ...quiet });
    expect(offered(gate)).toBe(false);
  });

  it('unset + TTY: offered, asks once on first use, saves yes, and runs', async () => {
    const prompt = vi.fn(async () => true);
    const gate = new CommandGate({}, { configPath, prompt, isInteractive: () => true, ...quiet });
    expect(offered(gate)).toBe(true);

    const out1 = await executeTool('run_command', { command: 'echo one' }, ctx(gate));
    const out2 = await executeTool('run_command', { command: 'echo two' }, ctx(gate));
    expect(out1.trim()).toBe('one');
    expect(out2.trim()).toBe('two');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith('echo one', work);
    expect(readAllowCommandsSetting(configPath)).toBe(true);

    // A later run reads the saved answer and does not ask again.
    const prompt2 = vi.fn(async () => false);
    const gate2 = new CommandGate({}, { configPath, prompt: prompt2, isInteractive: () => true, ...quiet });
    expect((await executeTool('run_command', { command: 'echo three' }, ctx(gate2))).trim()).toBe('three');
    expect(prompt2).not.toHaveBeenCalled();
  });

  it('unset + TTY: a no is saved, refuses the call, and removes the tool', async () => {
    const prompt = vi.fn(async () => false);
    const gate = new CommandGate({}, { configPath, prompt, isInteractive: () => true, ...quiet });
    const out = await executeTool('run_command', { command: 'echo hi > ran.txt' }, ctx(gate));
    expect(out).toMatch(/turned off by the user/);
    expect(fs.existsSync(path.join(work, 'ran.txt'))).toBe(false);
    expect(readAllowCommandsSetting(configPath)).toBe(false);
    expect(offered(gate)).toBe(false);
  });

  it('parallel first calls share one question', async () => {
    let release!: (v: boolean) => void;
    const prompt = vi.fn(() => new Promise<boolean>((r) => { release = r; }));
    const gate = new CommandGate({}, { configPath, prompt, isInteractive: () => true, ...quiet });
    const a = gate.authorize('echo a', work);
    const b = gate.authorize('echo b', work);
    release(true);
    expect(await a).toEqual({ allowed: true });
    expect(await b).toEqual({ allowed: true });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('a prompt failure is a no and saves nothing', async () => {
    const gate = new CommandGate({}, {
      configPath, prompt: async () => { throw new Error('stdin closed'); }, isInteractive: () => true, ...quiet,
    });
    expect((await gate.authorize('echo x', work)).allowed).toBe(false);
    expect(readAllowCommandsSetting(configPath)).toBeUndefined();
  });

  it('saved true: offered, runs without asking, and logs command, cwd, exit code and timestamp', async () => {
    writeAllowCommandsSetting(true, configPath);
    const prompt = vi.fn(async () => false);
    const gate = new CommandGate({}, { configPath, prompt, isInteractive: () => false, ...quiet });
    expect(offered(gate)).toBe(true);

    const out = await executeTool('run_command', { command: 'echo hello' }, ctx(gate));
    expect(out.trim()).toBe('hello');
    const failed = await executeTool('run_command', { command: 'exit 3' }, ctx(gate));
    expect(failed).toMatch(/exit code 3/);
    expect(prompt).not.toHaveBeenCalled();

    const log = readLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ command: 'echo hello', cwd: work, exitCode: 0, agent: 'builder' });
    expect(new Date(log[0].timestamp as string).toString()).not.toBe('Invalid Date');
    expect(log[1]).toMatchObject({ command: 'exit 3', exitCode: 3 });
    expect(JSON.stringify(log)).not.toContain(process.env.PATH ?? '\0');
  });

  it('saved false: not offered, and a call is refused and logged', async () => {
    writeAllowCommandsSetting(false, configPath);
    const gate = new CommandGate({}, { configPath, isInteractive: () => true, ...quiet });
    expect(offered(gate)).toBe(false);
    const out = await executeTool('run_command', { command: 'echo hi' }, ctx(gate));
    expect(out).toMatch(/turned off by the user/);
    expect(readLog()[0]).toMatchObject({ command: 'echo hi', exitCode: null });
    expect(readLog()[0].refused).toBeTruthy();
  });

  it('the flag overrides the saved choice both ways, and is never saved', async () => {
    writeAllowCommandsSetting(false, configPath);
    const on = new CommandGate({ allowCommands: true }, { configPath, isInteractive: () => false, ...quiet });
    expect(offered(on)).toBe(true);
    expect((await executeTool('run_command', { command: 'echo on' }, ctx(on))).trim()).toBe('on');
    expect(readAllowCommandsSetting(configPath)).toBe(false);

    writeAllowCommandsSetting(true, configPath);
    const off = new CommandGate({ allowCommands: false }, { configPath, isInteractive: () => true, ...quiet });
    expect(offered(off)).toBe(false);
    expect(await executeTool('run_command', { command: 'echo off' }, ctx(off))).toMatch(/--no-allow-commands/);
    expect(readAllowCommandsSetting(configPath)).toBe(true);
  });

  it('the flag on with an undecided setting does not ask', async () => {
    const prompt = vi.fn(async () => false);
    const gate = new CommandGate({ allowCommands: true }, { configPath, prompt, isInteractive: () => true, ...quiet });
    expect((await gate.authorize('echo x', work)).allowed).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('writing the setting keeps other keys in the user config', () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'other: 1\nagent-provider:\n  keep: 2\n');
    writeAllowCommandsSetting(true, configPath);
    const text = fs.readFileSync(configPath, 'utf-8');
    expect(text).toMatch(/other: 1/);
    expect(text).toMatch(/keep: 2/);
    expect(readAllowCommandsSetting(configPath)).toBe(true);
  });
});

describe('confinement to the working directory', () => {
  const allowed = () => new CommandGate({ allowCommands: true }, { configPath, ...quiet });

  it('run_command refuses a cwd outside, by .. or absolute path, and logs the refusal', async () => {
    for (const cwd of ['..', outsideDir, '/']) {
      const out = await executeTool('run_command', { command: 'echo hi > ran.txt', cwd }, ctx(allowed()));
      expect(out).toMatch(/outside the working directory/);
    }
    expect(fs.existsSync(path.join(outsideDir, 'ran.txt'))).toBe(false);
    expect(readLog().every((r) => r.refused === 'cwd outside working directory')).toBe(true);
  });

  it('run_command refuses a cwd that is a symlink leading out, and accepts a folder inside', async () => {
    fs.symlinkSync(outsideDir, path.join(work, 'escape'));
    expect(await executeTool('run_command', { command: 'pwd', cwd: 'escape' }, ctx(allowed())))
      .toMatch(/outside the working directory/);
    fs.mkdirSync(path.join(work, 'sub'));
    expect((await executeTool('run_command', { command: 'pwd', cwd: 'sub' }, ctx(allowed()))).trim())
      .toBe(path.join(work, 'sub'));
  });

  it('read_file refuses absolute, .. and symlinked paths that leave, and reads inside', async () => {
    fs.writeFileSync(path.join(work, 'in.txt'), 'INSIDE');
    fs.symlinkSync(path.join(outsideDir, 'secret.txt'), path.join(work, 'link.txt'));
    const c = ctx(allowed());
    expect(await executeTool('read_file', { path: 'in.txt' }, c)).toBe('INSIDE');
    for (const p of [path.join(outsideDir, 'secret.txt'), '../outside/secret.txt', 'link.txt']) {
      const out = await executeTool('read_file', { path: p }, c);
      expect(out).toMatch(/outside the working directory/);
      expect(out).not.toContain('SECRET');
    }
  });

  it('write_file refuses paths that leave (including through a symlinked folder), and writes new files inside', async () => {
    fs.symlinkSync(outsideDir, path.join(work, 'escape'));
    const c = ctx(allowed());
    for (const p of [path.join(outsideDir, 'pwn.txt'), '../outside/pwn.txt', 'escape/pwn.txt', 'escape/deep/new/pwn.txt']) {
      expect(await executeTool('write_file', { path: p, content: 'x' }, c)).toMatch(/outside the working directory/);
    }
    expect(fs.readdirSync(outsideDir)).toEqual(['secret.txt']);

    expect(await executeTool('write_file', { path: 'a/b/new.txt', content: 'ok' }, c)).toMatch(/Written to/);
    expect(fs.readFileSync(path.join(work, 'a', 'b', 'new.txt'), 'utf-8')).toBe('ok');
  });

  it('search_files refuses a path or pattern that leaves', async () => {
    const c = ctx(allowed());
    expect(await executeTool('search_files', { pattern: '*', path: '..' }, c)).toMatch(/outside the working directory/);
    expect(await executeTool('search_files', { pattern: '../outside/*' }, c)).toMatch(/without/);
    expect(await executeTool('search_files', { pattern: `${outsideDir}/*` }, c)).toMatch(/without/);
  });

  it('the command log is never written through a symlink that leads out', async () => {
    fs.mkdirSync(path.join(work, '.paradigm', 'events'), { recursive: true });
    const target = path.join(outsideDir, 'rc');
    fs.writeFileSync(target, '');
    fs.symlinkSync(target, path.join(work, COMMAND_LOG_FILE));
    await executeTool('run_command', { command: 'echo hi' }, ctx(allowed()));
    expect(fs.readFileSync(target, 'utf-8')).toBe('');
  });
});

describe('ClaudeAgentProvider request', () => {
  const agent: AgentDefinition = { name: 'builder', role: 'build' } as AgentDefinition;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  async function toolsSent(policy: { allowCommands?: boolean; interactive?: boolean }): Promise<string[]> {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    let body: { tools: Array<{ name: string }> } | undefined;
    const sse = 'data: {"type":"message_stop"}\n\n';
    globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      body = JSON.parse(String(init?.body));
      return new Response(sse, { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new ClaudeAgentProvider({ configPath, isInteractive: () => false, ...quiet });
    for await (const _ of provider.spawn(agent, {
      task: 't',
      context: { systemPrompt: '', files: [], symbols: [] },
      workingDirectory: work,
      commandPolicy: policy,
    })) { /* drain */ }
    return (body?.tools ?? []).map((t) => t.name);
  }

  it('does not send run_command when undecided and non-interactive', async () => {
    const names = await toolsSent({});
    expect(names).toContain('read_file');
    expect(names).not.toContain('run_command');
  });

  it('sends run_command with --allow-commands', async () => {
    expect(await toolsSent({ allowCommands: true })).toContain('run_command');
  });
});
