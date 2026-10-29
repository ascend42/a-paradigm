/**
 * Slice B1 (Aegis review): gnomon-local's grep under the REAL darwin `session`
 * profile (sandbox-exec, the kernel-generated SBPL) — the profile the kernel
 * runs the child under. A catastrophic regex runs in grep's worker thread and
 * is terminated by its time budget; the worker starts, the child stays
 * responsive, and reads outside the roots stay refused. Uses the built
 * gnomon-local dist (build:gnomon), like local-lane-spawn.
 */
// @gnomon-platform: darwin
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { darwinFloor, sessionLaunchPlan } from '../src/kernel/sandbox/session.js';
import { PKG_ROOT } from './helpers.js';
import { sessionWorld, worldPolicy, type SessionWorld } from './session-helpers.js';

const FLOOR = darwinFloor();
const DIST = path.join(PKG_ROOT, '..', 'gnomon-local', 'dist', 'index.js');
let w: SessionWorld | null = null;
afterAll(() => w?.cleanup());

describe.runIf(process.platform === 'darwin' && FLOOR.ok && fs.existsSync(DIST))('gnomon-local grep under the darwin session profile', () => {
  it('a catastrophic regex is stopped by the worker budget; the keys stay unreadable', () => {
    w = sessionWorld();
    fs.writeFileSync(path.join(w.cwd, 'f.txt'), `${'a'.repeat(40)}!\nplain line\n`);
    const script = path.join(w.root, 'grep.mjs');
    fs.writeFileSync(
      script,
      [
        `import { runTool } from ${JSON.stringify(DIST)};`,
        `const ctx = { cwd: ${JSON.stringify(w.cwd)}, roots: [${JSON.stringify(w.cwd)}] };`,
        'const t0 = Date.now();',
        "const slow = await runTool('grep', { pattern: '^(a+)+$', regex: true }, ctx);",
        'const ms = Date.now() - t0;',
        "const plain = await runTool('grep', { pattern: 'plain' }, ctx);",
        `const keys = await runTool('read_file', { path: ${JSON.stringify(path.join(w.home, 'keys', 'device.key'))} }, ctx);`,
        'console.log(JSON.stringify({ ms, slow, plain, keys }));',
      ].join('\n'),
    );
    const runner = path.join(w.root, 'run.sh');
    fs.writeFileSync(runner, `#!/bin/bash\ncd "${w.cwd}"\nexec "${process.execPath}" "${script}"\n`, { mode: 0o755 });
    const plan = sessionLaunchPlan({ policy: worldPolicy(w), binaryReal: '/bin/bash', argv: [runner], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: w.userHome, roots: [w.cwd] } }, 'darwin');
    const r = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: { HOME: w.userHome, PATH: '/usr/bin:/bin' }, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout.trim().split('\n').at(-1)!) as { ms: number; slow: { isError: boolean; content: string }; plain: { content: string }; keys: { isError: boolean; content: string } };
    expect(out.slow.isError).toBe(false);
    expect(out.slow.content).toMatch(/stopped at the 3 s regex time limit/);
    expect(out.ms).toBeLessThan(10_000);
    expect(out.plain.content).toMatch(/^f\.txt:2: plain line/);
    expect(out.keys.isError).toBe(true);
    expect(out.keys.content).not.toContain('secret');
  }, 90_000);
});
