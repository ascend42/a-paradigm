/**
 * `_check_severity` must honour `paradigm enforcement resolve --json` whatever
 * its whitespace. The CLI pretty-prints (`"id": "value"`); the hook used to
 * grep only the compact form, so every configured severity was ignored.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const COMMON_SH = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts', 'paradigm-common.sh');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function severities(enforcementJson: string): Record<string, string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-sev-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-sev-bin-'));
  dirs.push(root, bin);
  fs.mkdirSync(path.join(root, '.paradigm', 'events'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'enforcement.json'), enforcementJson);
  fs.writeFileSync(
    path.join(bin, 'paradigm'),
    `#!/bin/sh
case "$1" in
  enforcement) cat "${path.join(bin, 'enforcement.json')}" ;;
  compliance-check) echo '{"driftedCount":0}' ;;
  internal) echo '[]' ;;
esac
exit 0
`,
  );
  fs.chmodSync(path.join(bin, 'paradigm'), 0o755);
  const ids = ['purpose-exists', 'aspect-advisory', 'orchestration-required', 'purpose-coverage', 'not-configured'];
  const script = `cd "${root}"; MODIFIED=""; . "${COMMON_SH}" >/dev/null 2>&1
for id in ${ids.join(' ')}; do echo "$id=$(_check_severity "$id" dflt)"; done
echo "threshold=$ORCH_THRESHOLD"`;
  const r = spawnSync('sh', ['-c', script], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root }, encoding: 'utf8' });
  return Object.fromEntries(r.stdout.trim().split('\n').map((l) => l.split('=') as [string, string]));
}

const MAP = {
  'purpose-exists': 'warn',
  'aspect-advisory': 'off',
  'orchestration-required': 'block',
  'purpose-coverage': 'block',
  orchestrationThreshold: 5,
};
const EXPECTED = {
  'purpose-exists': 'warn',
  'aspect-advisory': 'off',
  'orchestration-required': 'block',
  'purpose-coverage': 'block',
  'not-configured': 'dflt',
  threshold: '5',
};

describe('_check_severity parses enforcement JSON robustly', () => {
  it('pretty-printed JSON (what the CLI emits)', () => {
    expect(severities(JSON.stringify(MAP, null, 2))).toEqual(EXPECTED);
  });
  it('compact JSON', () => {
    expect(severities(JSON.stringify(MAP))).toEqual(EXPECTED);
  });
  it('tabs, CRLF and odd spacing around colons', () => {
    const odd = '{\r\n\t"purpose-exists"  :\t"warn" ,\r\n "aspect-advisory":"off",\n"orchestration-required" : "block",\n"purpose-coverage":   "block",\n "orchestrationThreshold" :  5 }\r\n';
    expect(severities(odd)).toEqual(EXPECTED);
  });
  it('empty output falls back to defaults', () => {
    expect(severities('')).toMatchObject({ 'purpose-exists': 'dflt', threshold: '3' });
  });
});

// ---------------------------------------------------------------------------
// .orchestrated is honoured by TTL (PARADIGM_GATE_TTL_HOURS, default 4h), not
// deleted by the Stop hook. Stop fires per assistant turn, so deleting it on
// every passing turn made Check 13 warn in sessions that did delegate.
// ---------------------------------------------------------------------------

const SCRIPTS = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts');
const FIVE_HOURS_AGO = () => new Date(Date.now() - 5 * 60 * 60 * 1000);

function stubBin(): string {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-orch-bin-'));
  dirs.push(bin);
  fs.writeFileSync(
    path.join(bin, 'paradigm'),
    `#!/bin/sh
case "$1" in
  compliance-check) echo '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}' ;;
  internal) echo '[]' ;;
esac
exit 0
`,
  );
  fs.chmodSync(path.join(bin, 'paradigm'), 0o755);
  return bin;
}

function orchProject(marker: 'none' | 'fresh' | 'stale'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-orch-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.paradigm', 'events'), { recursive: true });
  const m = path.join(root, '.paradigm', '.orchestrated');
  if (marker !== 'none') {
    fs.writeFileSync(m, '{"type":"orchestrated","verdicts":1,"source":"delegation"}');
    if (marker === 'stale') fs.utimesSync(m, FIVE_HOURS_AGO(), FIVE_HOURS_AGO());
  }
  return root;
}

/** Source paradigm-common.sh with a magnitude-4 change set; return ADVISORY. */
function check13Advisory(root: string): string {
  const bin = stubBin();
  const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(root, f), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'src', '.purpose'), 'version: 2.0.0\ncomponents:\n  x:\n    description: x\n');
  const script = `cd "${root}"; MODIFIED="${[...files, 'src/.purpose'].join('\n')}"; . "${COMMON_SH}" >/dev/null 2>&1
echo "$ADVISORY"`;
  const r = spawnSync('sh', ['-c', script], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root }, encoding: 'utf8' });
  return r.stdout;
}

describe('Check 13 honours .orchestrated by TTL', () => {
  it('no marker → orchestration advisory (control)', () => {
    const out = check13Advisory(orchProject('none'));
    expect(out).toContain('(orchestration) Magnitude');
    expect(out).toContain('delegate to a roster agent, run a debrief');
    expect(out).not.toContain('orchestrate_inline');
  });
  it('fresh marker → no advisory', () => {
    expect(check13Advisory(orchProject('fresh'))).not.toContain('(orchestration)');
  });
  it('marker back-dated beyond the TTL → advisory returns', () => {
    expect(check13Advisory(orchProject('stale'))).toContain('(orchestration) Magnitude');
  });
});

describe('a passing Stop leaves .orchestrated in place', () => {
  for (const script of ['claude-code-stop.sh', 'cursor-stop.sh']) {
    it(script, () => {
      const root = orchProject('fresh');
      const bin = stubBin();
      const git = (...args: string[]) =>
        spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });
      fs.writeFileSync(path.join(root, 'README.md'), 'a\n');
      fs.writeFileSync(path.join(root, '.paradigm', '.session-started'), '');
      git('init', '-q');
      git('add', 'README.md');
      git('commit', '-qm', 'init');
      fs.writeFileSync(path.join(root, 'README.md'), 'b\n'); // a non-source change → passing Stop
      const r = spawnSync('sh', [path.join(SCRIPTS, script)], {
        input: JSON.stringify({ cwd: root, hook_event_name: 'Stop', stop_hook_active: false }),
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root },
        encoding: 'utf8',
        cwd: root,
      });
      expect(r.status, r.stderr).toBe(0);
      // the pass-cleanup block ran …
      expect(fs.existsSync(path.join(root, '.paradigm', '.session-started'))).toBe(false);
      // … and the orchestration marker survived it
      expect(fs.existsSync(path.join(root, '.paradigm', '.orchestrated'))).toBe(true);
    });
  }
});

describe('team-gate and prompt-gate honour .orchestrated by TTL', () => {
  function runGate(script: string, root: string, input: object): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync('sh', [path.join(SCRIPTS, script)], {
      input: JSON.stringify({ cwd: root, ...input }),
      cwd: root, // the hook monitor writes its ring under $PWD/.paradigm
      env: { PATH: '/usr/bin:/bin', HOME: root },
      encoding: 'utf8',
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  const team = (root: string) => runGate('claude-code-team-gate.sh', root, { tool_name: 'Write', tool_input: { file_path: path.join(root, 'src', 'a.ts') } });
  const prompt = (root: string) => runGate('claude-code-prompt-gate.sh', root, { prompt: 'please implement the export feature for reports' });

  it('team-gate: fresh marker → silent', () => {
    const r = team(orchProject('fresh'));
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('without team orchestration');
  });
  it('team-gate: stale marker → advisory', () => {
    const r = team(orchProject('stale'));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('Source edit without team orchestration');
  });
  it('prompt-gate: fresh marker → no directive', () => {
    const r = prompt(orchProject('fresh'));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
  it('prompt-gate: stale marker → directive injected', () => {
    const r = prompt(orchProject('stale'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('orchestration-eligible');
  });
});
