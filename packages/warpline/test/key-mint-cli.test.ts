/**
 * key-mint-cli.test — M3-lite I2 (#keys × #agent-shell): `warpline key mint` /
 * `warpline key list` at the REAL CLI boundary, and the human-class gate on mint.
 *
 * THE GATING CHOICE, pinned here so it cannot drift silently: `key.mint` is
 * deliberately NOT in HUMAN_ONLY_VERBS. That list is the DAEMON's verb law, and
 * two frozen invariants pin it to actual daemon verbs — descriptors-frozen
 * (`agent.size + HUMAN_ONLY_VERBS.length === DAEMON_VERBS.length`) and
 * agent-shell-gate (the exact four CLI paths). Key minting has NO daemon verb
 * (no self-service minting surface exists on the daemon — the anti-sockpuppet
 * line tokens.ts already draws), so the CLI command carries its own gate with
 * the SAME #agent-shell credential (`$WARPLINE_AGENT_ID`) and the SAME
 * FORBIDDEN/refusal:v1 answer — verbatim the `branch --protect` precedent.
 *
 * NEVER against the live fabric — scratch tmp roots only; every CLI spawn
 * passes an explicit `--root` (isolation law + D-7).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AGENT_ID_ENV } from '../src/agent-shell.js';
import type { Refusal } from '../src/fabric/refusal.js';
import { writeRef } from '../src/fabric/refs.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import { readKeyRegistry, agentKeyPathOf, loadAgentKey, signedFromOf } from '../src/fabric/keys.js';

const execFileAsync = promisify(execFile);
const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));
const haveDist = existsSync(distCli);

const PICK_TIP = 'pick:v3:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** The refusal a CLI run printed on stderr (fail() emits one JSON line). */
function refusalOfRun(run: Run): Refusal | null {
  for (const line of run.stderr.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(t) as { refusal?: Refusal };
      if (parsed.refusal) return parsed.refusal;
    } catch {
      /* not the refusal line */
    }
  }
  return null;
}

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-keycli-'));
  // a live tip for signed-from to pin (refs mode, the way seal.ts reads it)
  writeRef(warplineDirOf(root), 'selvage', PICK_TIP, null);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Run the real CLI against the fixture. `agent` marks the shell. */
const cli = async (args: string[], opts: { agent?: string } = {}): Promise<Run> => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[AGENT_ID_ENV]; // the founder's shell exports nothing
  delete env.WARPLINE_F4_RUN_ID;
  if (opts.agent) env[AGENT_ID_ENV] = opts.agent;
  try {
    const { stdout, stderr } = await execFileAsync('node', [distCli, ...args, '--root', root], {
      cwd: root,
      encoding: 'utf8',
      env,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

describe('#keys — `warpline key mint` at the CLI boundary', () => {
  it.skipIf(!haveDist)(
    'HUMAN shell: mint writes the 0600 key file, appends the registry row, pins signed-from at the live tip',
    async () => {
      const run = await cli(['key', 'mint', 'alice']);
      expect(run.code, run.stderr).toBe(0);
      expect(run.stdout).toContain('KEY MINTED');
      expect(run.stdout).toContain('wlkey:v1:');
      expect(run.stdout).toContain(PICK_TIP); // first key ever → the boundary pinned, and SAID
      expect(run.stdout).toMatch(/advisory until then/); // the I3 note
      // on disk: key file 0600, private half never on stdout
      const keyPath = agentKeyPathOf(root, 'alice');
      expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
      expect(run.stdout).not.toContain('PRIVATE KEY');
      // registry: one agent-key row + the pinned signed-from row
      const { rows, malformed } = readKeyRegistry(root);
      expect(malformed).toEqual([]);
      expect(rows.filter((r) => r.kind === 'agent-key').length).toBe(1);
      expect(signedFromOf(root)).toBe(PICK_TIP);
    },
    120_000,
  );

  it.skipIf(!haveDist)(
    'AGENT shell: mint is REFUSED with the human-class refusal — before any key material exists',
    async () => {
      const run = await cli(['key', 'mint', 'mallory'], { agent: 'mallory' });
      const refusal = refusalOfRun(run);
      expect(refusal, 'key mint must hand back a refusal:v1, not a bare Error').not.toBeNull();
      expect(refusal!.code).toBe('FORBIDDEN');
      expect(refusal!.retriable).toBe('never');
      expect(run.code).toBe(2);
      expect(run.stderr).toContain(AGENT_ID_ENV);
      // the gate ran BEFORE the engine: no key file, no registry row, no epoch pin
      expect(loadAgentKey(root, 'mallory')).toBeNull();
      expect(readKeyRegistry(root).rows).toEqual([]);
      expect(signedFromOf(root)).toBeNull();
    },
    120_000,
  );

  it.skipIf(!haveDist)(
    'a SECOND mint appends without re-pinning; --json emits the result minus the private key',
    async () => {
      const first = await cli(['key', 'mint', 'alice']);
      expect(first.code).toBe(0);
      const second = await cli(['key', 'mint', 'bob', '--json']);
      expect(second.code, second.stderr).toBe(0);
      const parsed = JSON.parse(second.stdout) as {
        key: { principal: string; keyId: string; privateKeyPem?: string; publicKeyPem: string };
        signedFrom: unknown;
        keyPath: string;
      };
      expect(parsed.key.principal).toBe('bob');
      expect(parsed.key.keyId).toMatch(/^wlkey:v1:[0-9a-f]{64}$/);
      expect(parsed.key.privateKeyPem).toBeUndefined(); // NEVER on stdout
      expect(parsed.signedFrom).toBeNull(); // the epoch pinned at alice's mint — pins once
      expect(second.stdout).not.toContain('PRIVATE KEY');
      const { rows } = readKeyRegistry(root);
      expect(rows.filter((r) => r.kind === 'agent-key').length).toBe(2);
      expect(rows.filter((r) => r.kind === 'signed-from').length).toBe(1);
    },
    120_000,
  );
});

describe('#keys — `warpline key list` stays agent-readable', () => {
  it.skipIf(!haveDist)(
    'lists rows + signed-from + file presence, identically on human and agent shells',
    async () => {
      await cli(['key', 'mint', 'alice']);
      const human = await cli(['key', 'list']);
      const agent = await cli(['key', 'list'], { agent: 'mallory' });
      expect(human.code).toBe(0);
      // a plain read: the gate must not touch a command it does not gate
      expect(agent.code).toBe(human.code);
      expect(agent.stdout).toBe(human.stdout);
      expect(human.stdout).toContain('alice');
      expect(human.stdout).toContain('signed-from');
      expect(human.stdout).toContain(PICK_TIP);
      expect(human.stdout).not.toContain('KEY FILE MISSING');
    },
    120_000,
  );

  it.skipIf(!haveDist)(
    'flags a registry row whose private key file is gone, and surfaces malformed rows',
    async () => {
      await cli(['key', 'mint', 'alice']);
      fs.rmSync(agentKeyPathOf(root, 'alice')); // the private half vanishes
      fs.appendFileSync(path.join(warplineDirOf(root), 'keys', 'registry.jsonl'), 'garbage line\n', 'utf8');
      const run = await cli(['key', 'list', '--json'], { agent: 'observer' });
      expect(run.code).toBe(0);
      const parsed = JSON.parse(run.stdout) as {
        keys: Array<{ principal: string; keyFilePresent: boolean }>;
        malformed: Array<{ line: number }>;
      };
      expect(parsed.keys[0]!.keyFilePresent).toBe(false);
      expect(parsed.malformed.length).toBe(1);
      const plain = await cli(['key', 'list']);
      expect(plain.stdout).toContain('KEY FILE MISSING');
      expect(plain.stdout).toContain('MALFORMED');
    },
    120_000,
  );

  it.skipIf(!haveDist)(
    'an empty registry orients instead of erroring',
    async () => {
      const run = await cli(['key', 'list']);
      expect(run.code).toBe(0);
      expect(run.stdout).toContain('none minted');
      expect(run.stdout).toContain('warpline key mint');
    },
    120_000,
  );
});
