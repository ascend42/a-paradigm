/**
 * #loop-registry, #loop-runner: `gnomon loop` argument handling (docs/specs/gnomon-loops.md §5 CLI). The daemon path is the same
 * pinned human-device connection as `gnomon mode`; these tests cover what is decided before any connection.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOOP_EXIT_OK, LOOP_EXIT_USAGE, LOOP_USAGE, runLoopCommand } from '../src/cli/loop-cli.js';

const sink = () => {
  let text = '';
  return { out: { write: (s: string) => { text += s; return true; } }, text: () => text };
};

describe('gnomon loop (arguments)', () => {
  it('--help prints the verbs', async () => {
    const o = sink();
    expect(await runLoopCommand(['--help'], { stdout: o.out, stderr: sink().out })).toBe(LOOP_EXIT_OK);
    expect(o.text()).toContain(LOOP_USAGE);
    for (const v of ['list', 'show <id>', 'trust <id>', 'untrust <id>', 'trust-status', 'run <id>', 'pause <id>', 'pause --all', 'resume <id>', 'runs <id>', 'logs <runId>']) expect(LOOP_USAGE).toContain(v);
  });
  it.each([
    [[], 'name a verb'],
    [['start', 'x'], 'unknown verb start'],
    [['run'], 'takes a loop id'],
    [['resume'], 'takes a loop id'],
    [['runs'], 'takes a loop id'],
    [['logs'], 'takes a run id'],
    [['logs', 'not-a-run'], 'lr-'],
    [['pause', 'x', '--all'], 'takes no loop id'],
    [['trust'], 'takes a loop id'],
    [['show'], 'takes a loop id'],
    [['list', '--repo', 'relative'], 'absolute path'],
    [['list', '--personal', '--repo', path.join(os.tmpdir(), 'r')], 'different scopes'],
    [['list', 'extra'], 'unknown argument'],
  ])('%j is a usage error', async (argv, msg) => {
    const e = sink();
    expect(await runLoopCommand(argv as string[], { stdout: sink().out, stderr: e.out })).toBe(LOOP_EXIT_USAGE);
    expect(e.text()).toContain(msg);
  });
});
