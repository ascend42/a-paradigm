/**
 * lifeline.test — meaning-aware blame (T-2026-06-25-003).
 *
 * Trace a symbol's ESSENCE through the commits that touched its file. The headline
 * property: a commit that touches the file but does NOT change the symbol's MEANING
 * is NOT a lifeline event — only genuine essence changes appear, attributed to the
 * commit that introduced them, newest-first.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { lifeline } from '../src/lifeline.js';

const exec = promisify(execFile);

let repo: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: repo });
  return stdout.trim();
}
async function write(rel: string, body: string): Promise<void> {
  const full = path.join(repo, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
}

const calc = (body: string) => `export function calc(n: number): number {\n  ${body}\n}\n`;

beforeAll(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-lifeline-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'fixture@warpline.test']);
  await git(['config', 'user.name', 'Warpline Fixture']);
  await git(['config', 'commit.gpgsign', 'false']);

  // base: calc born with essence E0.
  await write('src/mod.ts', calc('return n + 1;'));
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'born calc']);

  // c1: touch the file but NOT calc's meaning (add an unrelated function).
  await write('src/mod.ts', calc('return n + 1;') + `export function other(): number {\n  return 0;\n}\n`);
  await git(['commit', '-qam', 'add unrelated other() — calc meaning unchanged']);

  // c2: change calc's meaning → essence E1.
  await write('src/mod.ts', calc('return n * 2;') + `export function other(): number {\n  return 0;\n}\n`);
  await git(['commit', '-qam', 'calc now doubles']);

  // c3 (HEAD): change calc's meaning again → essence E2.
  await write('src/mod.ts', calc('return n * 2 + 1;') + `export function other(): number {\n  return 0;\n}\n`);
  await git(['commit', '-qam', 'calc doubles-plus-one']);
}, 60_000);

afterAll(async () => {
  if (repo) await fs.rm(repo, { recursive: true, force: true });
});

describe('lifeline — meaning-aware blame', () => {
  it('records essence changes and SKIPS the meaning-preserving file touch', async () => {
    const ll = await lifeline('#code:src/mod.ts::calc', { cwd: repo });

    // THREE meaning states: doubles-plus-one (c3), doubles (c2), born (base).
    expect(ll.events).toHaveLength(3);
    // newest first.
    expect(ll.events[0].intent).toBe('calc doubles-plus-one');
    expect(ll.events[1].intent).toBe('calc now doubles');
    expect(ll.events[2].intent).toBe('born calc');
    // the oldest event is the BIRTH (the window covers all history, not truncated).
    expect(ll.truncated).toBe(false);
    expect(ll.events[2].kind).toBe('born');
    expect(ll.events[0].kind).toBe('essence-changed');

    // THE HEADLINE: the commit that touched the file but not calc's meaning
    // ("add unrelated other()") is NOT a lifeline event.
    const intents = ll.events.map((e) => e.intent);
    expect(intents).not.toContain('add unrelated other() — calc meaning unchanged');

    // each event carries the symbol, a distinct essence, and the human intent.
    expect(ll.symbol).toBe('#code:src/mod.ts::calc');
    const essences = new Set(ll.events.map((e) => e.contentId));
    expect(essences.size).toBe(3); // three genuinely-distinct meanings
    for (const e of ll.events) expect(e.author).toBe('Warpline Fixture');
  });

  it('throws a clear error for a symbol absent at HEAD', async () => {
    await expect(lifeline('#code:src/mod.ts::nope', { cwd: repo })).rejects.toThrow(/not found at HEAD/);
  });
});
