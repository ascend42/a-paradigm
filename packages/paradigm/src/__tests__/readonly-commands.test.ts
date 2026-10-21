/**
 * Read-only command guarantee (#command-policy).
 *
 * Every command in READ_ONLY_COMMANDS is run, as a real CLI process, against
 * a fresh temp project and a temp HOME. Both trees must be byte-identical
 * afterwards: same paths, same bytes, same modes, same mtimes (a directory's
 * mtime catches a file created and then removed). The fixture is in the state
 * that used to provoke writes: a cohort-C project (aspects, no compliance on
 * the roster, no notice marker), a legacy root-level lore entry and a git repo.
 *
 * Tools that auto-approve shell commands (Gnomon's auto-edits classifier) rely
 * on this test. By default it runs the CLI from source (vite-node, shipped with
 * vitest). Set PARADIGM_CLI_UNDER_TEST=/abs/path/dist/index.js to run it
 * against a built bundle instead.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile, execFileSync } from 'child_process';
import { createRequire } from 'module';
import { READ_ONLY_COMMANDS } from '../core/command-policy.js';

const PKG_DIR = path.resolve(__dirname, '..', '..');
const ENTRY = path.join(PKG_DIR, 'src', 'index.ts');

function runnerArgv(): string[] {
  const underTest = process.env.PARADIGM_CLI_UNDER_TEST;
  if (underTest) return [underTest];
  const req = createRequire(path.join(PKG_DIR, 'package.json'));
  const vitestDir = path.dirname(req.resolve('vitest/package.json'));
  const viteNodeDir = path.dirname(createRequire(path.join(vitestDir, 'package.json')).resolve('vite-node/package.json'));
  return [path.join(viteNodeDir, 'vite-node.mjs'), '--root', PKG_DIR, ENTRY];
}

/** One invocation per case; the first words must name a READ_ONLY_COMMANDS entry (aliases allowed via `as`). */
interface Case { argv: string[]; as?: string }

const TASK_ID = 'T-2026-10-01-001';
const LORE_ID = 'L-2026-10-01-x-000000-001';

const READ_ONLY_CASES: Case[] = [
  { argv: ['status'] },
  { argv: ['st'], as: 'status' },
  { argv: ['doctor'] },
  { argv: ['doctor', '--context'] },
  { argv: ['doctor', '--explain'] },
  { argv: ['ripple', '#thing'] },
  { argv: ['ripple', '#thing', '--json'] },
  { argv: ['ripple', '^authed', '-d', '2', '-q'] },
  { argv: ['ripple', '#thing', 'src'] },
  { argv: ['integrity'] },
  { argv: ['integrity', '--json'] },
  { argv: ['purpose', 'validate'] },
  { argv: ['purpose', 'validate', '.'] },
  { argv: ['portal', 'validate'] },
  { argv: ['task', 'ls'] },
  { argv: ['task', 'ls', 'all', '--json'] },
  { argv: ['task', 'ls', 'open', '--mine', '-p', 'medium', '-t', 'x', '-n', '5'] },
  { argv: ['task', 'ls', '--board'] },
  { argv: ['task', 'show', TASK_ID] },
  { argv: ['task', 'show', '001', '--json'] },
  { argv: ['lore', 'list'] },
  { argv: ['lore', 'ls', '--json'], as: 'lore list' },
  { argv: ['lore', 'list', '--type', 'insight', '--from', '2026-01-01', '--to', '2026-12-31', '-l', '5'] },
  { argv: ['lore', 'show', LORE_ID] },
  { argv: ['lore', 'show', LORE_ID, '--json'] },
  { argv: ['lore', 'show', 'L-2026-02-21-nobody-000000-009'] }, // not found: falls back to a full scan
  { argv: ['notices'] },
  { argv: ['notices', '--json'] },
];

function w(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function buildFixture(proj: string): void {
  w(path.join(proj, '.paradigm/config.yaml'), 'version: "2.0"\nproject: readonly-fixture\n');
  w(path.join(proj, '.paradigm/roster.yaml'), 'version: 1.0\nactive:\n  - builder\n');
  w(path.join(proj, '.purpose'), [
    'name: readonly-fixture',
    'components:',
    '  thing:',
    '    description: A thing',
    '    aspects:',
    '      - ~audit',
    '    gates:',
    '      - ^authed',
    'aspects:',
    '  audit:',
    '    description: Audit',
    '    anchors:',
    '      - src/a.ts:1',
    '',
  ].join('\n'));
  w(path.join(proj, 'src/a.ts'), 'export const a = 1;\n');
  w(path.join(proj, 'portal.yaml'), 'version: "2.0"\ngates:\n  authed:\n    description: Auth\n    prizes: []\n');
  w(path.join(proj, `.paradigm/tasks/entries/2026-10-01/${TASK_ID}.yaml`),
    `id: ${TASK_ID}\nblurb: do a thing\nstatus: open\npriority: medium\ncreated: "2026-10-01T00:00:00.000Z"\n`);
  w(path.join(proj, `.paradigm/lore/entries/2026-10-01/${LORE_ID}.lore`),
    `id: ${LORE_ID}\ntype: milestone\ntimestamp: "2026-10-01T00:00:00.000Z"\nauthor: x\ntitle: T\nsummary: S\n`);
  // Legacy root-level entry: read paths used to migrate (move) it.
  w(path.join(proj, '.paradigm/lore/entries/legacy-old.yaml'), 'title: Old\nsummary: legacy\ndate: "2026-02-21"\ntype: decision\n');
  const git = (...a: string[]) => execFileSync('git', a, { cwd: proj, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', 'commit', '-qm', 'fixture');
}

function snapshot(root: string): Map<string, string> {
  const m = new Map<string, string>();
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const st = fs.lstatSync(p);
      const rel = path.relative(root, p);
      if (st.isDirectory()) {
        m.set(rel + '/', `dir ${st.mode} ${st.mtimeMs}`);
        walk(p);
      } else if (st.isSymbolicLink()) {
        m.set(rel, `link ${fs.readlinkSync(p)}`);
      } else {
        m.set(rel, `${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')} ${st.mode} ${st.mtimeMs}`);
      }
    }
  })(root);
  m.set('./', `dir ${fs.lstatSync(root).mode} ${fs.lstatSync(root).mtimeMs}`);
  return m;
}

function changes(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of after) {
    if (!before.has(k)) out.push(`+ ${k}`);
    else if (before.get(k) !== v) out.push(`~ ${k}`);
  }
  for (const k of before.keys()) if (!after.has(k)) out.push(`- ${k}`);
  return out;
}

function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('VITEST') || k === 'NODE_ENV' || k.startsWith('PARADIGM_')) continue;
    env[k] = v;
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    GIT_CONFIG_NOSYSTEM: '1',
    NO_COLOR: '1',
    CI: '1',
  };
}

let template: string;
const RUNNER = runnerArgv();

beforeAll(() => {
  template = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-ro-template-'));
  buildFixture(path.join(template, 'proj'));
});

afterAll(() => {
  fs.rmSync(template, { recursive: true, force: true });
});

describe('read-only command policy', () => {
  it('every READ_ONLY_COMMANDS entry has at least one harness case', () => {
    const covered = new Set(READ_ONLY_CASES.map((c) => c.as ?? READ_ONLY_COMMANDS.find((p) => {
      const words = p.split(' ');
      return words.every((word, i) => c.argv[i] === word);
    })));
    for (const p of READ_ONLY_COMMANDS) expect(covered.has(p), `no harness case for "${p}"`).toBe(true);
  });

  for (const c of READ_ONLY_CASES) {
    it.concurrent(`paradigm ${c.argv.join(' ')} leaves the project and HOME byte-identical`, async () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-ro-'));
      try {
        const proj = path.join(base, 'proj');
        const home = path.join(base, 'home');
        fs.cpSync(path.join(template, 'proj'), proj, { recursive: true, preserveTimestamps: true });
        fs.mkdirSync(home);
        const beforeProj = snapshot(proj);
        const beforeHome = snapshot(home);

        const result = await new Promise<{ stderr: string }>((resolve) => {
          execFile(process.execPath, [...RUNNER, ...c.argv], {
            cwd: proj,
            env: childEnv(home),
            timeout: 90_000,
            maxBuffer: 16 * 1024 * 1024,
          }, (_err, _stdout, stderr) => {
            // Exit status is not asserted: `lore show <missing id>` exits 1 by design.
            resolve({ stderr: String(stderr) });
          });
        });

        const diff = [
          ...changes(beforeProj, snapshot(proj)).map((d) => `project ${d}`),
          ...changes(beforeHome, snapshot(home)).map((d) => `home ${d}`),
        ];
        expect(diff, `stderr:\n${result.stderr.slice(0, 2000)}`).toEqual([]);
        // The CLI must have actually run (a crash before the action proves nothing).
        expect(result.stderr).not.toMatch(/Cannot find module|SyntaxError|ERR_MODULE_NOT_FOUND|error: unknown (command|option)|error: too many arguments/);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    }, 120_000);
  }

  it.concurrent('the cohort-C notice still prints on a read-only command (stderr), and says how to silence it', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-ro-notice-'));
    try {
      const proj = path.join(base, 'proj');
      fs.cpSync(path.join(template, 'proj'), proj, { recursive: true });
      fs.mkdirSync(path.join(base, 'home'));
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
        execFile(process.execPath, [...RUNNER, 'task', 'ls', '--json'], { cwd: proj, env: childEnv(path.join(base, 'home')) },
          (_e, so, se) => resolve({ stdout: String(so), stderr: String(se) }));
      });
      expect(stderr).toContain('Enforcement model changed');
      expect(stderr).toContain('paradigm notices ack v6.0.4');
      expect(stdout).not.toContain('Enforcement model changed');
      expect(JSON.parse(stdout)).toBeInstanceOf(Array);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }, 120_000);

  it.concurrent('`paradigm notices ack v6.0.4` writes the marker and silences the notice', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-ro-ack-'));
    try {
      const proj = path.join(base, 'proj');
      const home = path.join(base, 'home');
      fs.cpSync(path.join(template, 'proj'), proj, { recursive: true });
      fs.mkdirSync(home);
      const run = (argv: string[]) => new Promise<{ code: number; stderr: string }>((resolve) => {
        execFile(process.execPath, [...RUNNER, ...argv], { cwd: proj, env: childEnv(home) },
          (e, _so, se) => resolve({ code: e ? 1 : 0, stderr: String(se) }));
      });
      expect((await run(['notices', 'ack', 'v6.0.4'])).code).toBe(0);
      expect(fs.existsSync(path.join(proj, '.paradigm', '.v6-0-4-migration-acknowledged'))).toBe(true);
      expect((await run(['status'])).stderr).not.toContain('Enforcement model changed');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }, 120_000);
});
