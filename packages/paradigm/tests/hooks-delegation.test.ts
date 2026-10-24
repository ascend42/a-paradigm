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

const SCRIPT = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts', 'claude-code-delegation.sh');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function project(paradigm = true): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-deleg-'));
  dirs.push(root);
  if (paradigm) fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
  return root;
}

/** PATH without jq exercises the grep fallback. */
function noJqBin(): string {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-deleg-bin-'));
  dirs.push(bin);
  for (const c of ['cat', 'grep', 'sed', 'head', 'tr', 'date', 'mkdir']) {
    const src = ['/usr/bin', '/bin'].map((d) => path.join(d, c)).find((p) => fs.existsSync(p));
    if (src) fs.symlinkSync(src, path.join(bin, c));
  }
  return bin;
}

function run(input: string, opts: { cwd?: string; noJq?: boolean } = {}) {
  // Always run from a temp dir: the hook monitor writes its ring under $PWD/.paradigm.
  const cwd = opts.cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-deleg-cwd-'));
  if (!opts.cwd) dirs.push(cwd);
  return spawnSync('/bin/sh', [SCRIPT], {
    input,
    cwd,
    env: { PATH: opts.noJq ? noJqBin() : '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', HOME: os.tmpdir() },
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
      // jq decodes the escaped quote then strips it; the grep fallback stops at it.
      expect(rows[0].subagent).toBe(noJq ? 'paradigm:bu' : 'paradigm:builxder');
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
  });
}
