/**
 * #delegation-hook — PostToolUse Agent|Task credits roster-agent delegation.
 *
 * Claude Code Agent-tool delegation never reached recordOrchestrationCompletion
 * (settlement/debrief only), so Check 13 warned "without team orchestration" in
 * sessions that did delegate. claude-code-delegation.sh writes
 * .paradigm/.orchestrated (source "delegation") when a roster agent —
 * `paradigm:*` or a project `.claude/agents/<type>.md` — returns a non-empty
 * response, and always appends a team-funnel row. Silent; always exit 0.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { SH, SYS_PATH, WIN, baseEnv, pathValue, shellPath, tempDir } from '../src/test-shell-utils.js';

const SCRIPT = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts', 'claude-code-delegation.sh');
const dirs: string[] = [];
/**
 * Windows-safe cleanup: drop registered git worktrees first (git keeps
 * handles and read-only files under them), then remove with retries so a
 * child process that is still exiting cannot fail the test with EPERM.
 */
function cleanup(d: string): void {
  if (fs.existsSync(path.join(d, '.git')) && fs.statSync(path.join(d, '.git')).isDirectory()) {
    const list = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: d, encoding: 'utf8' }).stdout || '';
    for (const line of list.split('\n')) {
      const wt = line.startsWith('worktree ') ? line.slice('worktree '.length).trim() : '';
      if (wt && path.resolve(wt) !== path.resolve(d)) {
        spawnSync('git', ['worktree', 'remove', '--force', '--force', wt], { cwd: d, encoding: 'utf8' });
      }
    }
    spawnSync('git', ['worktree', 'prune'], { cwd: d, encoding: 'utf8' });
  }
  fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
afterEach(() => { for (const d of dirs.splice(0)) cleanup(d); });

function project(paradigm = true): string {
  const root = tempDir('paradigm-deleg-');
  dirs.push(root);
  if (paradigm) fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
  return root;
}

/** System tools plus jq where a developer machine keeps it (Git for Windows ships no jq). */
const JQ_PATH = WIN ? SYS_PATH : [...SYS_PATH, '/opt/homebrew/bin', '/usr/local/bin'];

/**
 * PATH without jq exercises the grep fallback. POSIX: a dir of symlinked tools
 * (no git either). Windows: Git Bash's own tools, which include no jq
 * (symlinks need a privilege there).
 */
function noJqBin(): string {
  if (WIN) return pathValue(SYS_PATH);
  const bin = tempDir('paradigm-deleg-bin-');
  dirs.push(bin);
  for (const c of ['sh', 'cat', 'grep', 'sed', 'head', 'tr', 'date', 'mkdir']) {
    const src = ['/usr/bin', '/bin'].map((d) => path.join(d, c)).find((p) => fs.existsSync(p));
    if (src) fs.symlinkSync(src, path.join(bin, c));
  }
  return bin;
}

function run(input: string, opts: { cwd?: string; noJq?: boolean } = {}) {
  // Always run from a temp dir: the hook monitor writes its ring under $PWD/.paradigm.
  const cwd = opts.cwd ?? tempDir('paradigm-deleg-cwd-');
  if (!opts.cwd) dirs.push(cwd);
  return spawnSync(SH, [shellPath(SCRIPT)], {
    input,
    cwd,
    env: { ...baseEnv(), PATH: opts.noJq ? noJqBin() : pathValue(JQ_PATH), HOME: os.tmpdir() },
    encoding: 'utf8',
  });
}

const payload = (root: string, subagent: string | undefined, response: unknown) =>
  JSON.stringify({
    cwd: root,
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: subagent === undefined ? { prompt: 'x' } : { subagent_type: subagent, prompt: 'x' },
    ...(response === undefined ? {} : { tool_response: response }),
  });

const marker = (root: string) => path.join(root, '.paradigm', '.orchestrated');
function funnel(root: string): Array<Record<string, unknown>> {
  const f = path.join(root, '.paradigm', 'events', 'team-funnel.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

for (const noJq of [false, true]) {
  describe(`claude-code-delegation.sh (${noJq ? 'grep fallback' : 'jq'})`, () => {
    it('paradigm:architect + non-empty response → marker + credited funnel row', () => {
      const root = project();
      const r = run(payload(root, 'paradigm:architect', { content: [{ type: 'text', text: 'plan' }] }), { noJq });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('');
      expect(JSON.parse(fs.readFileSync(marker(root), 'utf8'))).toMatchObject({
        type: 'orchestrated', verdicts: 1, source: 'delegation', subagent: 'paradigm:architect',
      });
      expect(funnel(root)).toEqual([
        expect.objectContaining({ type: 'delegation', source: 'delegation-hook', subagent: 'paradigm:architect', credited: true }),
      ]);
    });

    it('project agent defined in .claude/agents/<type>.md is credited', () => {
      const root = project();
      fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
      fs.writeFileSync(path.join(root, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\n---\n');
      run(payload(root, 'reviewer', 'looks good'), { noJq });
      expect(fs.existsSync(marker(root))).toBe(true);
      expect(funnel(root)[0]).toMatchObject({ subagent: 'reviewer', credited: true });
    });

    it('non-roster agent (Explore) → credited:false, no marker', () => {
      const root = project();
      run(payload(root, 'Explore', 'found it'), { noJq });
      expect(fs.existsSync(marker(root))).toBe(false);
      expect(funnel(root)[0]).toMatchObject({ subagent: 'Explore', credited: false });
    });

    for (const [label, response] of [['empty string', ''], ['empty object', {}], ['null', null], ['missing', undefined]] as const) {
      it(`roster agent with ${label} response → credited:false, no marker`, () => {
        const root = project();
        run(payload(root, 'paradigm:builder', response), { noJq });
        expect(fs.existsSync(marker(root))).toBe(false);
        expect(funnel(root)[0]).toMatchObject({ subagent: 'paradigm:builder', credited: false });
      });
    }

    it('sanitizes the subagent string before writing hand-built JSON', () => {
      const root = project();
      run(payload(root, 'paradigm:bu"il$(x)d/er', 'ok'), { noJq });
      const rows = funnel(root); // parses → the row is valid JSON
      expect(rows[0].subagent).toMatch(/^[a-zA-Z0-9:._-]+$/);
      // jq decodes the escaped quote and the sanitiser strips it; the grep
      // fallback reads escaped JSON strings whole, so both agree.
      expect(rows[0].subagent).toBe('paradigm:builxder');
    });

    it('malformed stdin → exit 0, no output, nothing written', () => {
      const root = project();
      const r = run('not json {{', { cwd: root, noJq });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('');
      expect(fs.existsSync(marker(root))).toBe(false);
      expect(funnel(root)).toEqual([]);
    });

    it('not a paradigm project → exit 0, nothing written', () => {
      const root = project(false);
      const r = run(payload(root, 'paradigm:architect', 'ok'), { noJq });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      expect(fs.existsSync(path.join(root, '.paradigm'))).toBe(false);
    });

    it('a user-global agent in ~/.claude/agents is credited, with a session marker', () => {
      const root = project();
      const home = project(false);
      fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
      fs.writeFileSync(path.join(home, '.claude', 'agents', 'atelier-mika.md'), '---\nname: atelier-mika\n---\n');
      const input = JSON.stringify({ ...JSON.parse(payload(root, 'atelier-mika', 'reviewed')), session_id: 'g1' });
      const r = spawnSync(SH, [shellPath(SCRIPT)], {
        input,
        cwd: home,
        env: { ...baseEnv(), PATH: noJq ? noJqBin() : pathValue(JQ_PATH), HOME: home },
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).toBe('');
      expect(fs.existsSync(marker(root))).toBe(false); // with a session id only the session marker
      expect(JSON.parse(fs.readFileSync(path.join(root, '.paradigm', '.sessions', 'g1.orchestrated'), 'utf8')))
        .toMatchObject({ source: 'delegation', subagent: 'atelier-mika', session: 'g1' });
      expect(funnel(root)[0]).toMatchObject({ subagent: 'atelier-mika', credited: true });
    });

    it('a `.` in the agent name is literal (fixed-string frontmatter match)', () => {
      const root = project();
      fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
      fs.writeFileSync(path.join(root, '.claude', 'agents', 'helper.md'), '---\nname: axb\n---\n');
      run(payload(root, 'a.b', 'ok'), { noJq });
      expect(funnel(root)[0]).toMatchObject({ subagent: 'a.b', credited: false });
      run(payload(root, 'axb', 'ok'), { noJq });
      expect(funnel(root)[1]).toMatchObject({ subagent: 'axb', credited: true });
    });

    it('an unknown agent name is not credited even with a ~/.claude/agents dir', () => {
      const root = project();
      const home = project(false);
      fs.mkdirSync(path.join(home, '.claude', 'agents'), { recursive: true });
      fs.writeFileSync(path.join(home, '.claude', 'agents', 'other.md'), '---\nname: other\n---\n');
      spawnSync(SH, [shellPath(SCRIPT)], {
        input: payload(root, 'nobody', 'x'),
        cwd: home,
        env: { ...baseEnv(), PATH: noJq ? noJqBin() : pathValue(JQ_PATH), HOME: home },
        encoding: 'utf8',
      });
      expect(fs.existsSync(marker(root))).toBe(false);
    });
  });
}

describe('claude-code-delegation.sh from a linked worktree', () => {
  it('writes the markers at the project root, not in the worktree', () => {
    const root = project();
    const git = (cwd: string, ...args: string[]) =>
      spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'version: "1.0"\n');
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'init');
    const wt = path.join(root, '.claude', 'worktrees', 'agent-1');
    git(root, 'worktree', 'add', '-q', '-b', 'agent-1', wt);
    const input = JSON.stringify({ ...JSON.parse(payload(wt, 'paradigm:builder', 'done')), session_id: 'w1' });
    const r = spawnSync(SH, [shellPath(SCRIPT)], { input, cwd: wt, env: { ...baseEnv(), PATH: pathValue(SYS_PATH), HOME: os.tmpdir() }, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(root, '.paradigm', '.sessions', 'w1.orchestrated'))).toBe(true);
    expect(fs.existsSync(marker(root))).toBe(false); // with a session id only the session marker
    expect(fs.existsSync(marker(wt))).toBe(false);
  });
});
