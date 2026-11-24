/**
 * oracle-writes.test — what `warpline oracle` writes, and what the help says.
 *
 * The oracle was described as "read-only". It is read-only toward git and the
 * user's files, and it records its result under `.warpline/` in the repo it
 * runs in. This file pins BOTH halves over the real binary in a throwaway repo:
 *   - git's refs, HEAD and tracked files are unchanged, and no worktree is left
 *     registered;
 *   - `.warpline/oracle.jsonl`, `.warpline/states/` and `.warpline/warp/` exist
 *     afterwards and are the only new paths;
 *   - `warpline oracle --help` and `warpline --help` say so, and do not call the
 *     oracle read-only.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const run = promisify(execFile);
const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));

const AUTH_BASE = [
  'description: Authentication',
  'components:',
  '  auth-middleware:',
  '    description: Validates the session token',
  'gates:',
  '  authenticated:',
  '    description: Requires a valid session token',
  '',
].join('\n');

const AUTH_NO_GATE = [
  'description: Authentication',
  'components:',
  '  auth-middleware:',
  '    description: Validates the session token',
  '',
].join('\n');

const CHECKOUT_BASE = [
  'description: Checkout',
  'components:',
  '  pay-handler:',
  '    description: Takes a payment',
  '',
].join('\n');

const CHECKOUT_GATED = [
  'description: Checkout',
  'components:',
  '  pay-handler:',
  '    description: Takes a payment',
  'flows:',
  '  checkout-flow:',
  '    description: Pay for a cart',
  "    gates: ['^authenticated']",
  "    components: ['#pay-handler']",
  '',
].join('\n');

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

/** Top-level entries of `dir`, sorted. */
function entries(dir: string): string[] {
  return fs.readdirSync(dir).sort();
}

describe('warpline oracle — writes under .warpline/, leaves git and your files alone', () => {
  let root: string;
  const git = async (...args: string[]): Promise<string> =>
    (
      await run(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.autocrlf=false', ...args],
        { cwd: root },
      )
    ).stdout.trim();

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-oracle-writes-'));
    await git('init', '-q');
    write(root, 'src/auth/.purpose', AUTH_BASE);
    write(root, 'src/checkout/.purpose', CHECKOUT_BASE);
    await git('add', '-A');
    await git('commit', '-q', '-m', 'base');
    const base = await git('rev-parse', 'HEAD');

    await git('checkout', '-q', '-b', 'side-a');
    write(root, 'src/auth/.purpose', AUTH_NO_GATE);
    await git('commit', '-q', '-a', '-m', 'side-a: drop the gate');

    await git('checkout', '-q', '-b', 'side-b', base);
    write(root, 'src/checkout/.purpose', CHECKOUT_GATED);
    await git('commit', '-q', '-a', '-m', 'side-b: use the gate');
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('records oracle.jsonl, states/ and warp/ and changes nothing in git', async () => {
    const before = {
      refs: await git('for-each-ref'),
      head: await git('symbolic-ref', 'HEAD'),
      status: await git('status', '--porcelain'),
      worktrees: await git('worktree', 'list', '--porcelain'),
      top: entries(root),
      auth: fs.readFileSync(path.join(root, 'src/auth/.purpose'), 'utf8'),
      checkout: fs.readFileSync(path.join(root, 'src/checkout/.purpose'), 'utf8'),
    };
    expect(before.top).not.toContain('.warpline');
    expect(before.status).toBe('');

    const { stdout } = await run(process.execPath, [distCli, 'oracle', 'side-a', 'side-b'], { cwd: root });
    expect(stdout).toContain('ORACLE  side-a  vs  side-b');
    // The command says where it recorded the result.
    expect(stdout).toContain('.warpline/oracle.jsonl');

    // It wrote: the one new top-level entry is .warpline/, holding the three stores.
    expect(entries(root)).toEqual([...before.top, '.warpline'].sort());
    const wl = path.join(root, '.warpline');
    expect(fs.readFileSync(path.join(wl, 'oracle.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(fs.readdirSync(path.join(wl, 'states')).length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(wl, 'warp'))).toBe(true);

    // It left git alone: same refs, same HEAD, no worktree left registered, and the
    // only thing git sees is the untracked .warpline/ directory.
    expect(await git('for-each-ref')).toBe(before.refs);
    expect(await git('symbolic-ref', 'HEAD')).toBe(before.head);
    expect(await git('worktree', 'list', '--porcelain')).toBe(before.worktrees);
    expect(await git('status', '--porcelain')).toBe('?? .warpline/');

    // It left your files alone.
    expect(fs.readFileSync(path.join(root, 'src/auth/.purpose'), 'utf8')).toBe(before.auth);
    expect(fs.readFileSync(path.join(root, 'src/checkout/.purpose'), 'utf8')).toBe(before.checkout);
  });

  it('`oracle --help` says what it writes and does not call it read-only', async () => {
    const { stdout } = await run(process.execPath, [distCli, 'oracle', '--help'], { cwd: root });
    const help = stdout.replace(/\s+/g, ' ');
    expect(help).toContain('Leaves git history and your files alone');
    expect(help).toContain('Records its result under .warpline/');
    expect(help).toContain('oracle.jsonl');
    expect(help).toContain('temporary git worktree');
    expect(help).not.toMatch(/read-only|writes nothing/i);
  });

  it('`warpline --help` no longer calls the oracle a read-only forecast', async () => {
    const { stdout } = await run(process.execPath, [distCli, '--help'], { cwd: root });
    const help = stdout.replace(/\s+/g, ' ');
    expect(help).not.toContain('read-only forecasts');
    expect(help).toContain('`oracle` records its result under .warpline/');
    expect(help).toContain('leaves git history and your files alone');
  });
});
