/**
 * `gnomon dev local` (#dev-launch, #local-runner): the dev root signs the local-model lane config. The row it writes is
 * the one the kernel's own loader accepts (loadLocalConfig with the dev root), the version climbs on every re-sign
 * (the kernel refuses a row older than its high-water mark), and the act refuses what the kernel would refuse anyway:
 * a public endpoint (G-SUB-06), a cloud compat, a missing runner, no --model.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultLocalRunnerDir, runDevCommand, type DevCliIo } from '../src/cli/dev-cli.js';
import { loadDevHome } from '../src/cli/dev-home.js';
import { LOCAL_CONFIG_FILE, loadLocalConfig } from '../src/kernel/local/config.js';
import { clearVerifiedRootsForTests } from '../src/platform/owner-only.js';
import { tempHome } from './daemon-helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  clearVerifiedRootsForTests();
  while (cleanups.length) cleanups.pop()!();
});

function io(): DevCliIo & { o: string[]; e: string[] } {
  const o: string[] = [];
  const e: string[] = [];
  return { stdin: new PassThrough(), stdout: { write: (s: string) => (o.push(s), true) }, stderr: { write: (s: string) => (e.push(s), true) }, o, e };
}

function world(): { userHome: string; devHome: string; runner: string } {
  const t = tempHome('gdl-');
  cleanups.push(t.cleanup);
  const userHome = fs.realpathSync.native(path.dirname(t.home));
  const runner = path.join(userHome, 'runner');
  fs.mkdirSync(runner);
  fs.writeFileSync(path.join(runner, 'cli.js'), '// a stand-in gnomon-local\n');
  return { userHome, devHome: path.join(userHome, 'devhome'), runner };
}

describe('#dev-launch: gnomon dev local', () => {
  it('signs a row the kernel loader accepts with the dev root; re-signing climbs the version', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], io(), { userHome: w.userHome, host: 'win-1' })).toBe(0);
    const x = io();
    expect(await runDevCommand(['local', '--home', w.devHome, '--model', 'qwen3.5:9b', '--runner', w.runner], x, { userHome: w.userHome })).toBe(0);
    expect(x.o.join('')).toContain('SIGNED  local-model lane config');
    const dev = loadDevHome(w.devHome, { userHome: w.userHome });
    const loaded = loadLocalConfig(w.devHome, dev.root);
    expect(loaded).toMatchObject({ signed: true, version: 0 });
    expect(loaded.config?.endpoints).toEqual([{ id: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen3.5:9b', compat: 'ollama' }]);
    expect(loaded.config?.runner).toMatchObject({ dir: w.runner, entry: 'cli.js', node: process.execPath });
    expect(await runDevCommand(['local', '--home', w.devHome, '--model', 'qwen3.5:9b', '--runner', w.runner, '--base', 'http://127.0.0.1:8080', '--compat', 'llama.cpp'], io(), { userHome: w.userHome })).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(w.devHome, LOCAL_CONFIG_FILE), 'utf8')).row.version).toBe(1);
  });

  it('refuses a public endpoint, a cloud compat, a missing runner and a missing --model; writes nothing', async () => {
    const w = world();
    expect(await runDevCommand(['init', '--home', w.devHome], io(), { userHome: w.userHome, host: 'win-1' })).toBe(0);
    const pub = io();
    expect(await runDevCommand(['local', '--home', w.devHome, '--model', 'm', '--runner', w.runner, '--base', 'https://api.example.com'], pub, { userHome: w.userHome })).toBe(1);
    expect(pub.e.join('')).toMatch(/local-endpoint/);
    expect(await runDevCommand(['local', '--home', w.devHome, '--model', 'm', '--runner', w.runner, '--compat', 'openai'], io(), { userHome: w.userHome })).toBe(64);
    expect(await runDevCommand(['local', '--home', w.devHome, '--model', 'm', '--runner', path.join(w.userHome, 'nope')], io(), { userHome: w.userHome })).toBe(1);
    expect(await runDevCommand(['local', '--home', w.devHome], io(), { userHome: w.userHome })).toBe(64);
    expect(fs.existsSync(path.join(w.devHome, LOCAL_CONFIG_FILE))).toBe(false);
  });

  it("finds this clone's gnomon-local runner when it is built", () => {
    const d = defaultLocalRunnerDir(path.resolve(__dirname, '..', 'src', 'cli'));
    if (d) expect(fs.existsSync(path.join(d, 'cli.js'))).toBe(true);
  });
});
