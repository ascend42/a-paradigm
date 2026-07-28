/**
 * f4-cli-arm.test — the CLI SKIN's arm of the F4 rig (T-2026-07-21-005).
 *
 * The MCP arm is proven by f4-rig.test.ts. The F4 bar requires BOTH skins
 * independently, and the CLI emitted no f4Trace rows at all until the CLI-arm
 * wiring landed — so this test proves the same measurement pipeline over the
 * REAL CLI binary: a seeded world, a scripted subject making the two canonical
 * cold mistakes, the scripted rival, and the classifier's verdict on the real
 * trace.
 *
 * The load-bearing difference from the MCP arm: the CLI is ONE PROCESS PER
 * COMMAND. A process-local seq counter would stamp every row seq:0 and the
 * classifier (which orders by seq) would read an unorderable transcript — so
 * this test asserts the ordinal is continuous ACROSS processes.
 *
 * NEVER against the live fabric — scratch fixture only (isolation law).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { seedWorld, rivalAdvance } from '../src/f4/seed.js';
import { classifyRun } from '../src/f4/classifier.js';
import { readF4Trace } from '../src/daemon/f4-trace.js';
import type { Refusal } from '../src/fabric/refusal.js';

const execFileAsync = promisify(execFile);
const SUBJECT_EDIT = 'export function pivot() { return 7; }\nexport function caller() { return pivot() + 1; }\n';
const RUN_ID = 'cli-arm-proof-001';
const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

describe('#f4-trace (CLI skin) — the CLI arm produces a classifiable transcript', () => {
  let root: string;
  let file: string;

  // the CLI arm needs the built binary; skip gracefully on a src-only checkout.
  const haveDist = existsSync(distCli);

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf4cli-'));
    ({ file } = await seedWorld({ root }));
  }, 60_000);

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Drive the real CLI in the fixture fabric; never throws on a refusing exit. */
  const cli = async (...args: string[]): Promise<Run> => {
    try {
      const { stdout, stderr } = await execFileAsync('node', [distCli, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, WARPLINE_F4_RUN_ID: RUN_ID },
      });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };

  const ADMIT = ['admit', 'subject', '--native', '--worktree', '.', '--json'];

  it.skipIf(!haveDist)(
    'scripted CLI transcript → f4Trace rows → classifier verdict',
    async () => {
      // 1. COLD MISTAKE #1 — admit before propose (PW-2 sequencing refusal).
      const early = await cli(...ADMIT);
      expect(early.code).not.toBe(0);

      // 2. follow the ladder: fork → edit → propose.
      expect((await cli('fork', 'subject')).code).toBe(0);
      fs.writeFileSync(path.join(root, file), SUBJECT_EDIT, 'utf8');
      const claim = JSON.stringify({ claimedSymbols: [], intent: 'subject: pivot returns 7' });
      const proposed = await cli('propose', '--agent', 'subject', '--claim', claim, '--native', '--worktree', '.', '--json');
      expect(proposed.code).toBe(0);

      // 3. the scripted RIVAL advances the selvage underneath the subject.
      expect((await rivalAdvance({ root, file })).sealed).toBe(true);

      // 4. the subject's admit now KNOTs — a verdict-class refusal on exit≠0.
      const knotted = await cli(...ADMIT);
      expect(knotted.code).not.toBe(0);
      const knotRefusal = (JSON.parse(knotted.stdout) as { refusal?: Refusal }).refusal!;
      expect(knotRefusal.code).toBe('GATE_REFUSED');
      expect(knotRefusal.verdict).toBe('KNOT');
      const payloadId = knotRefusal.pointers.knotPayloadId!;
      expect(payloadId).toBeDefined();

      // 5. hydrate the work order named by the refusal.
      expect((await cli('knot', 'show', payloadId, '--json')).code).toBe(0);

      // 6. COLD MISTAKE #2 — identical re-admit (the KNOT stands).
      expect((await cli(...ADMIT)).code).not.toBe(0);

      // ── the transcript ──────────────────────────────────────────────────
      const rows = readF4Trace(root).filter((r) => r.runId === RUN_ID);
      expect(rows.map((r) => r.verb)).toEqual(['admit', 'fork', 'propose', 'admit', 'knot.show', 'admit']);
      expect([...new Set(rows.map((r) => r.skin))]).toEqual(['cli']);

      // THE CROSS-PROCESS PROOF: six separate `node dist/cli.js` processes, one
      // continuous ordinal — without seq seeding every row here would read 0.
      expect(rows.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4, 5]);

      // prose never enters the trace: `target` carries selectors/flags only,
      // and neither the propose intent nor the claim body may appear anywhere.
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain('pivot returns 7');
      for (const r of rows) {
        if (r.target) expect(r.target).not.toMatch(/intent|reason|because/i);
      }

      // ── the classifier's verdict ────────────────────────────────────────
      const report = classifyRun(rows);
      expect(report.runId).toBe(RUN_ID);
      expect(report.skins).toEqual(['cli']);
      expect(report.descriptorsIds).toHaveLength(1); // FG-3 validity precondition
      expect(report.episodes).toHaveLength(2);
      const [e1, e2] = report.episodes;
      expect(e1!.refusal.code).toBe('BAD_REQUEST');
      expect(e1!.wasted.map((w) => w.rule)).toEqual(['W4']); // the miss itself
      expect(e1!.closedAtSeq).not.toBeNull(); // the ladder recovered it
      expect(e2!.refusal.code).toBe('GATE_REFUSED');
      expect(e2!.wasted.map((w) => w.rule)).toEqual(['W1']); // the identical re-admit
      expect(e2!.closedAtSeq).toBeNull(); // resolution is human-class — held
      expect(report.medianWastedPerRecovery).toBe(1);
      expect(report.surfaceMisses).toBe(1);
    },
    180_000,
  );
});
