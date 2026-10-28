/**
 * Stop-hook loop guard. Claude Code sets `stop_hook_active: true` on a Stop
 * that follows a turn the Stop hook itself continued; Cursor sends
 * `loop_count`. A violation the agent cannot fix inside the turn used to block
 * every stop forever. Now an unchanged violation set (digits ignored) on such
 * a Stop — or a 4th consecutive block — ends the turn, logs
 * `stop-block-unresolved` to team-funnel.jsonl and keeps the marker. A set
 * blocks once: on later turns the identical set is advisory.
 *
 * Violations come from Check 14 (a guard remediation served by a stub
 * `paradigm internal active-remediations`), so each test controls the exact
 * violation text. Every hook runs with cwd = its temp fixture.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const SCRIPTS = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts');
const MARKER = path.join('.paradigm', '.stop-block-fingerprint');
const FUNNEL = path.join('.paradigm', 'events', 'team-funnel.jsonl');

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

interface Fixture { root: string; bin: string; setReasons: (reasons: string[]) => void }

function fixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-loopguard-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-loopguard-bin-'));
  dirs.push(root, bin);
  const rmds = path.join(bin, 'remediations.json');
  fs.writeFileSync(rmds, '[]');
  fs.writeFileSync(
    path.join(bin, 'paradigm'),
    `#!/bin/sh
case "$1" in
  compliance-check) echo '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}' ;;
  internal) cat "${rmds}" ;;
esac
exit 0
`,
  );
  fs.chmodSync(path.join(bin, 'paradigm'), 0o755);
  fs.mkdirSync(path.join(root, '.paradigm', 'events'), { recursive: true });
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });
  fs.writeFileSync(path.join(root, 'README.md'), 'a\n');
  git('init', '-q');
  git('add', 'README.md');
  git('commit', '-qm', 'init');
  fs.writeFileSync(path.join(root, 'README.md'), 'b\n'); // a non-source change: only Check 14 fires
  const setReasons = (reasons: string[]) =>
    fs.writeFileSync(
      rmds,
      JSON.stringify(reasons.map((reason, i) => ({ id: `rmd-${i}`, severity: 'guard', claimant: 'compliance', reason }))),
    );
  return { root, bin, setReasons };
}

interface Run { status: number | null; stdout: string; stderr: string }

function runStop(fx: Fixture, input: object, opts: { script?: string; pathTail?: string; env?: Record<string, string> } = {}): Run {
  const r = spawnSync('sh', [path.join(SCRIPTS, opts.script ?? 'claude-code-stop.sh')], {
    input: JSON.stringify(input),
    cwd: fx.root, // the hook monitor writes under $PWD/.paradigm
    env: { PATH: `${fx.bin}:${opts.pathTail ?? '/usr/bin:/bin'}`, HOME: fx.root, ...(opts.env ?? {}) },
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const claude = (fx: Fixture, active: boolean, env?: Record<string, string>) =>
  runStop(fx, { cwd: fx.root, hook_event_name: 'Stop', stop_hook_active: active }, { env });

function unresolvedRows(root: string): Array<Record<string, unknown>> {
  const f = path.join(root, FUNNEL);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((r) => r.type === 'stop-block-unresolved');
}

const marker = (root: string) => {
  const f = path.join(root, MARKER);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n') : null;
};

describe('Claude Code Stop hook loop guard', () => {
  it('(1) violation, no stop_hook_active → blocks and writes the marker', () => {
    const fx = fixture();
    fx.setReasons(['purpose missing for src/a']);
    const r = claude(fx, false);
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain('Paradigm compliance check failed');
    const m = marker(fx.root);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/^\d+ \d+$/);
    expect(m![1]).toBe('1');
  });

  it('(2) active + same set → ends the turn, says unresolved, logs a funnel row', () => {
    const fx = fixture();
    fx.setReasons(['purpose missing for src/a']);
    expect(claude(fx, false).status).toBe(2);
    const r = claude(fx, true);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('unresolved after a fix attempt');
    expect(r.stderr).toContain('purpose missing for src/a');
    const rows = unresolvedRows(fx.root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'stop-hook', violations: 1, consecutive: 1 });
    expect(rows[0].fingerprint).toBe(marker(fx.root)![0]);
    expect(marker(fx.root)).not.toBeNull(); // left in place
  });

  it('(3) active + changed set → blocks again', () => {
    const fx = fixture();
    fx.setReasons(['purpose missing for src/a']);
    expect(claude(fx, false).status).toBe(2);
    fx.setReasons(['portal gate missing for /api/x']);
    const r = claude(fx, true);
    expect(r.status, r.stderr).toBe(2);
    expect(marker(fx.root)![1]).toBe('2');
    expect(unresolvedRows(fx.root)).toHaveLength(0);
  });

  it('(4) only digits differ → same set → ends the turn', () => {
    const fx = fixture();
    fx.setReasons(['Task magnitude 5 >= 3 without orchestration']);
    expect(claude(fx, false).status).toBe(2);
    fx.setReasons(['Task magnitude 7 >= 3 without orchestration']);
    const r = claude(fx, true);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('unresolved after a fix attempt');
  });

  it('(5) consecutive cap: a changing set is released after 3 blocks', () => {
    const fx = fixture();
    const statuses: Array<number | null> = [];
    for (let i = 0; i < 4; i++) {
      fx.setReasons([`problem ${'abcd'[i]}`]);
      statuses.push(claude(fx, i > 0).status);
    }
    expect(statuses).toEqual([2, 2, 2, 0]);
    expect(unresolvedRows(fx.root)[0]).toMatchObject({ consecutive: 3 });
  });

  it('(6) a fresh turn after an unresolved release is advisory (one block per set); PARADIGM_OVERRIDE unchanged', () => {
    const fx = fixture();
    fx.setReasons(['purpose missing for src/a']);
    expect(claude(fx, false).status).toBe(2);
    expect(claude(fx, true).status).toBe(0);
    const fresh = claude(fx, false);
    expect(fresh.status, fresh.stderr).toBe(0);
    expect(fresh.stderr).toContain('already reported this session, not blocking again');
    expect(fresh.stderr).toContain('purpose missing for src/a');
    expect(marker(fx.root)![1]).toBe('1');
    // overriding the remediation removes the violation → pass, marker cleared
    const over = claude(fx, false, { PARADIGM_OVERRIDE: 'rmd-0' });
    expect(over.status, over.stderr).toBe(0);
    expect(marker(fx.root)).toBeNull();
    expect(fs.readFileSync(path.join(fx.root, '.paradigm', 'events', 'overrides.jsonl'), 'utf8')).toContain('"remediation_id":"rmd-0"');
  });

  it('(7) a passing run removes the marker', () => {
    const fx = fixture();
    fx.setReasons(['purpose missing for src/a']);
    expect(claude(fx, false).status).toBe(2);
    expect(marker(fx.root)).not.toBeNull();
    fx.setReasons([]);
    expect(claude(fx, true).status).toBe(0);
    expect(marker(fx.root)).toBeNull();
  });

  it('(7b) no modifications removes the marker', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.root, MARKER), '1 2\n1\n');
    fs.writeFileSync(path.join(fx.root, 'README.md'), 'a\n'); // back to HEAD
    expect(claude(fx, false).status).toBe(0);
    expect(marker(fx.root)).toBeNull();
  });

  describe('(8) without jq', () => {
    let noJq = '';
    beforeAll(() => {
      noJq = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-loopguard-nojq-'));
      for (const d of ['/usr/bin', '/bin']) {
        for (const name of fs.readdirSync(d)) {
          if (name === 'jq' || fs.existsSync(path.join(noJq, name))) continue;
          try { fs.symlinkSync(path.join(d, name), path.join(noJq, name)); } catch { /* skip unreadable */ }
        }
      }
    });
    afterAll(() => fs.rmSync(noJq, { recursive: true, force: true }));

    it('grep fallback parses stop_hook_active', () => {
      expect(fs.existsSync(path.join(noJq, 'jq'))).toBe(false);
      const fx = fixture();
      fx.setReasons(['purpose missing for src/a']);
      const input = (active: boolean) => ({ cwd: fx.root, hook_event_name: 'Stop', stop_hook_active: active });
      expect(runStop(fx, input(false), { pathTail: noJq }).status).toBe(2);
      const r = runStop(fx, input(true), { pathTail: noJq });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain('unresolved after a fix attempt');
    });
  });
});

describe('Cursor stop hook loop guard', () => {
  const cursor = (fx: Fixture, loopCount?: number) =>
    runStop(fx, { workspace_roots: [fx.root], ...(loopCount === undefined ? {} : { loop_count: loopCount }) }, { script: 'cursor-stop.sh' });

  it('(9) loop_count is honoured: same set on a retry ends the loop', () => {
    const fx = fixture();
    fx.setReasons(['purpose missing for src/a']);
    const first = cursor(fx, 0);
    expect(first.status, first.stderr).toBe(2);
    expect(first.stdout).toContain('followup_message');
    // loop_count drives the count: no file counter is written
    expect(fs.existsSync(path.join(fx.root, '.paradigm', '.stop-hook-active'))).toBe(false);
    const retry = cursor(fx, 1);
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.stderr).toContain('unresolved after a fix attempt');
    expect(unresolvedRows(fx.root)[0]).toMatchObject({ consecutive: 1 });
  });

  it('(9b) loop_count 0 with a stale marker still blocks (fresh turn)', () => {
    const fx = fixture();
    fx.setReasons(['purpose missing for src/a']);
    expect(cursor(fx, 0).status).toBe(2);
    expect(cursor(fx, 0).status).toBe(2);
  });

  it('(9c) loop_count >= 3 hits the cap', () => {
    const fx = fixture();
    fx.setReasons(['changing problem']);
    const r = cursor(fx, 3);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('max retries (3)');
  });

  it('(9d) without loop_count the file counter still drives retries', () => {
    const fx = fixture();
    fx.setReasons(['purpose missing for src/a']);
    expect(cursor(fx).status).toBe(2);
    expect(fs.readFileSync(path.join(fx.root, '.paradigm', '.stop-hook-active'), 'utf8').trim()).toBe('1');
    const retry = cursor(fx);
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.stderr).toContain('unresolved after a fix attempt');
    expect(fs.existsSync(path.join(fx.root, '.paradigm', '.stop-hook-active'))).toBe(false);
  });
});
