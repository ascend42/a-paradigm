/**
 * agent-shell-gate.test — C-11: `HUMAN_ONLY_VERBS` was a law on ONE skin
 * (soundness audit 2026-07-31, Aegis S3; pre-freeze panel D-4; Aegis M-1).
 *
 * The daemon enforced the verb × principal matrix at `server.ts`; the native CLI
 * had no token, no principal and no gate, so `warpline resolve` sailed past
 * authorization and failed only on a missing argument, and `--accept-breach` /
 * `--accept-risk` were free on any shell. That is load-bearing, not cosmetic:
 * FG-1's ratified completion criterion rests on `resolve` being the act the
 * security law FORBIDS, and the law evaporated for an agent with a shell —
 * which every coding agent has.
 *
 * The fix uses the product's own precedent rather than inventing a credential:
 * `$WARPLINE_AGENT_ID` already marks a shell as an agent's (it is what #pick
 * attributes by, and what the R2 gate refuses on). This file pins the two
 * halves that matter:
 *
 *   ENFORCEMENT — a marked shell is refused with a real `refusal:v1`, before
 *                 any engine work, on every human-class verb and flag, and the
 *                 gated sets are BOUND to the daemon's own constants.
 *   INVISIBILITY — an UNMARKED shell is byte-identical to before. The founder's
 *                 shell exports nothing, and the F4 harness's scripted
 *                 human-resolve leg runs in its own unmarked shell; if either
 *                 changed, the fix would have broken more than it closed.
 *
 * NEVER against the live fabric — scratch fixtures only, and every CLI spawn
 * passes an explicit `--root` (isolation law + D-7).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AGENT_ID_ENV,
  HUMAN_ONLY_CLI_PATHS,
  HUMAN_ONLY_CLI_FLAGS,
  agentShellId,
  agentShellRefusal,
  checkHumanClass,
  cliPathOf,
} from '../src/agent-shell.js';
import { HUMAN_ONLY_VERBS, HUMAN_ONLY_ADMIT_FLAGS } from '../src/daemon/protocol.js';
import { exitCodeFor, type Refusal } from '../src/fabric/refusal.js';
import { seedWorld, rivalAdvance } from '../src/f4/seed.js';
import { forkNative, proposeNative, admitNative } from '../src/fabric/native.js';
import { readF4Trace } from '../src/daemon/f4-trace.js';
import { readRef } from '../src/fabric/refs.js';
import { warplineDirOf } from '../src/fabric/fabric.js';

const execFileAsync = promisify(execFile);
const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));
const haveDist = existsSync(distCli);

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

/* ── half 1: the law itself, in-process ──────────────────────────────────────── */

describe('#agent-shell — the gated sets are BOUND, never re-listed (C-11)', () => {
  it('every HUMAN_ONLY_VERB has exactly one derived CLI path, and nothing else does', () => {
    // The binding is what stops a fourth divergent copy of the law appearing:
    // adding a verb to the daemon's list gates its CLI command in the same edit.
    expect(HUMAN_ONLY_CLI_PATHS.size).toBe(HUMAN_ONLY_VERBS.length);
    for (const verb of HUMAN_ONLY_VERBS) {
      expect(HUMAN_ONLY_CLI_PATHS.get(cliPathOf(verb)), `CLI path for ${verb}`).toBe(verb);
    }
    // dots are subcommand separators on the CLI, exactly as toolNameOf mangles
    // them to underscores at the MCP boundary — one law per boundary, derived.
    expect(cliPathOf('stake.recover')).toBe('stake recover');
    expect([...HUMAN_ONLY_CLI_PATHS.keys()].sort()).toEqual(['backup', 'resolve', 'stake', 'stake recover']);
  });

  it('every HUMAN_ONLY_ADMIT_FLAG has exactly one derived long flag', () => {
    expect(HUMAN_ONLY_CLI_FLAGS.size).toBe(HUMAN_ONLY_ADMIT_FLAGS.length);
    expect([...HUMAN_ONLY_CLI_FLAGS.entries()].sort()).toEqual([
      ['--accept-breach', 'acceptBreach'],
      ['--accept-risk', 'acceptRisk'],
    ]);
  });

  it('an UNMARKED shell is never gated — on any path, with any flags', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(agentShellId(env)).toBeNull();
    for (const cliPath of HUMAN_ONLY_CLI_PATHS.keys()) {
      expect(checkHumanClass({ cliPath, env }), cliPath).toBeNull();
    }
    expect(
      checkHumanClass({ cliPath: 'admit', flags: { acceptBreach: true, acceptRisk: true }, env }),
    ).toBeNull();
    // and a whitespace-only value is not a marker either (an empty export is not
    // an agent — fail toward the human path, which is the pre-existing behavior)
    expect(agentShellId({ [AGENT_ID_ENV]: '   ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('a MARKED shell is refused on every human-class verb and every override flag', () => {
    const env = { [AGENT_ID_ENV]: 'subject' } as NodeJS.ProcessEnv;
    // Iterate the AUTHORITY (the daemon's own list), never the derived map: a
    // loop over HUMAN_ONLY_CLI_PATHS silently stops checking whatever the map
    // drops, which made this assertion pass under a mutation that removed
    // `backup` from the gate entirely. The point of the test is that the two
    // cannot diverge, so the daemon's list has to be the thing driving it.
    for (const verb of HUMAN_ONLY_VERBS) {
      const cliPath = cliPathOf(verb);
      const v = checkHumanClass({ cliPath, env });
      expect(v, `${cliPath} must be gated`).not.toBeNull();
      expect(v!.verb).toBe(verb);
      expect(v!.agentId).toBe('subject');
    }
    for (const flag of HUMAN_ONLY_ADMIT_FLAGS) {
      const v = checkHumanClass({ cliPath: 'admit', flags: { [flag]: true }, env });
      expect(v, `--${flag} must be gated`).not.toBeNull();
      expect(v!.verb).toBeNull(); // the VERB is agent-legal; only the flag is not
      expect(v!.flags).toEqual([flag]);
    }
    // an agent-legal verb with no override flag stays legal
    expect(checkHumanClass({ cliPath: 'admit', flags: { acceptRisk: false }, env })).toBeNull();
    expect(checkHumanClass({ cliPath: 'fork', env })).toBeNull();
  });

  it('the refusal is the DAEMON\'s answer verbatim: FORBIDDEN, empty ladder, exit 2', () => {
    const r = agentShellRefusal();
    expect(r.code).toBe('FORBIDDEN');
    expect(r.gate).toBe('transport');
    expect(r.retriable).toBe('never');
    // EMPTY next[] means exactly one thing in refusal:v1 — escalate. Naming the
    // human verb here would invite the retry that IS the W3 violation.
    expect(r.next).toEqual([]);
    expect(exitCodeFor(r.code)).toBe(2);
  });
});

/* ── half 2: the real boundary, through the real binary ──────────────────────── */

describe('#agent-shell — the CLI boundary (real binary, scratch fabric)', () => {
  let root: string;
  let file: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-shellgate-'));
    ({ file } = await seedWorld({ root }));
  }, 120_000);

  afterAll(() => {
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

  it.skipIf(!haveDist)(
    'INVISIBILITY — an agent-legal command is byte-identical marked and unmarked',
    async () => {
      const human = await cli(['log', '--json']);
      const agent = await cli(['log', '--json'], { agent: 'subject' });
      expect(human.code).toBe(0);
      // byte-for-byte: the gate must not touch a command it does not gate.
      expect(agent.stdout).toBe(human.stdout);
      expect(agent.stderr).toBe(human.stderr);
      expect(agent.code).toBe(human.code);
    },
    120_000,
  );

  it.skipIf(!haveDist)(
    'ENFORCEMENT — every human-class verb refuses FORBIDDEN on a marked shell',
    async () => {
      const invocations: Array<[string, string[]]> = [
        ['resolve', ['resolve', 'subject', '-m', 'because', '--native']],
        ['stake', ['stake']],
        ['stake.recover', ['stake', 'recover', 'deadbeef']],
        ['backup', ['backup', path.join(root, 'never-created')]],
      ];
      for (const [verb, args] of invocations) {
        const run = await cli(args, { agent: 'subject' });
        const refusal = refusalOfRun(run);
        expect(refusal, `${verb} must hand back a refusal:v1, not a bare Error`).not.toBeNull();
        expect(refusal!.code, verb).toBe('FORBIDDEN');
        expect(refusal!.next, verb).toEqual([]);
        expect(run.code, `${verb} exit`).toBe(2);
        expect(run.stderr, verb).toContain(AGENT_ID_ENV);
      }
      // the gate runs BEFORE the engine: `backup` wrote nothing at all.
      expect(existsSync(path.join(root, 'never-created'))).toBe(false);
    },
    180_000,
  );

  it.skipIf(!haveDist)(
    'ENFORCEMENT — the override flags refuse on a marked shell, on admit and on pick',
    async () => {
      for (const flag of ['--accept-breach', '--accept-risk']) {
        const run = await cli(['admit', 'subject', '--native', flag], { agent: 'subject' });
        expect(refusalOfRun(run)?.code, `admit ${flag}`).toBe('FORBIDDEN');
        expect(run.code).toBe(2);
      }
      // `pick --accept-risk` is the R2 gate's own override door, and #pick's
      // ladder already marks it principal:'human' — it was reachable from any
      // shell, so an agent could wave through the verdict the gate exists to refuse.
      const pick = await cli(['pick', '-m', 'x', '--accept-risk'], { agent: 'subject' });
      expect(refusalOfRun(pick)?.code).toBe('FORBIDDEN');
      expect(pick.code).toBe(2);
      // …and pick WITHOUT the override flag is untouched on the same shell.
      const plain = await cli(['pick', '-m', 'x', '--json'], { agent: 'subject' });
      expect(refusalOfRun(plain)).toBeNull();
    },
    180_000,
  );

  it.skipIf(!haveDist)(
    'the attempt is RECORDED before it is refused — W3 stays observable',
    async () => {
      // The MCP skin's D-2 lesson: a violation that is refused but unrecorded
      // makes "zero W3 marks" a predicate that cannot fail. Gating must not
      // re-create the blindness that tracing `resolve` was added to remove.
      const before = readF4Trace(root).length;
      const run = await cli(['resolve', 'subject', '-m', 'because', '--native'], { agent: 'subject' });
      expect(run.code).toBe(2);
      const rows = readF4Trace(root);
      expect(rows.length).toBe(before + 1);
      const row = rows[rows.length - 1]!;
      expect(row.verb).toBe('resolve');
      expect(row.ok).toBe(false);
      expect(row.refusal?.code).toBe('FORBIDDEN');
      expect(row.principal).toBe('subject');
    },
    120_000,
  );

  it.skipIf(!haveDist)(
    'the F4 harness\'s scripted human-resolve leg still works — it runs UNMARKED',
    async () => {
      // Shield's constraint. The harness resolves a real KNOT from a shell that
      // exports no WARPLINE_AGENT_ID; if the gate keyed on anything that leg
      // cannot satisfy, the harness would be gated out of its own measurement.
      const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-shellgate-wt-'));
      try {
        forkNative(root, 'subject', { into: wt });
        fs.writeFileSync(
          path.join(wt, file),
          'export function pivot() { return 7; }\nexport function caller() { return pivot() + 1; }\n',
          'utf8',
        );
        await proposeNative(root, { worktree: wt, agentId: 'subject', intent: 'subject: pivot 7' });
        expect((await rivalAdvance({ root, file })).sealed).toBe(true);
        const knot = await admitNative(root, { worktree: wt, agentId: 'subject', noRestore: true });
        expect(knot.decision.status).toBe('KNOT');

        const selvageBefore = readRef(warplineDirOf(root), 'selvage');
        // the human leg: an UNMARKED shell, exactly as the harness spawns it.
        const run = await cli(['resolve', 'subject', '-m', 'human picks 7', '--native', '--worktree', wt]);
        expect(refusalOfRun(run), 'the human leg must not be gated').toBeNull();
        expect(run.code).toBe(0);
        expect(run.stdout).toContain('RESOLVE');
        expect(readRef(warplineDirOf(root), 'selvage')).not.toBe(selvageBefore);
      } finally {
        fs.rmSync(wt, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
