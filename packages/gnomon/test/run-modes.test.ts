/**
 * P8-D86/D87 run modes (spec §3.4 "Run modes (D87)", §11.4–§11.5): manual | ask |
 * auto-edits, per repo and per session, kernel-owned (broker/run-mode.ts,
 * supervisor/auto-edits.ts, manifest/layers.ts gateClassPathRule).
 *
 * This file is the pure half (RunModeBook, RunModeControl over a real
 * #approval-broker, gateClassPathRule, autoEditPass): every OS. The live-session
 * half is test/run-modes-session.test.ts (darwin: the session profile).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { RunModeBook } from '../src/kernel/broker/index.js';
import { realpathFollow } from '../src/kernel/manifest/policy.js';
import { deniedWrite } from '../src/kernel/supervisor/permission.js';
import { gateClassPathRule } from '../src/kernel/manifest/layers.js';
import { autoEditPass } from '../src/kernel/supervisor/auto-edits.js';
import { repoKeyOf } from '../src/kernel/supervisor/repo-hooks.js';
import { ASK_GUI, controlRig, errOf, HSID_A, HUMAN, KP } from './run-mode-helpers.js';

describe('run modes: gate-class path rule (§15.7) and auto-edits eligibility (pure, every OS)', () => {
  it('gate-class paths are refused segment-wise and case-folded; ordinary source files pass', () => {
    for (const p of ['.claude/settings.json', '.Claude/Settings.json', 'CLAUDE.md', 'docs/claude-notes.MD', 'sub/CLAUDE.local.md', '.git/hooks/pre-commit', 'a/.git/config', '.gnomon/project.yaml', 'package.json', 'web/package-lock.json', 'yarn.lock', 'vitest.config.ts', 'jest.config.js', '.github/workflows/ci.yml', '.gitattributes', '.husky/pre-commit', '.mcp.json', '../escape.ts']) {
      expect(gateClassPathRule(p), p).not.toBeNull();
    }
    for (const p of ['src/index.ts', 'README.md', 'docs/guide.md', 'test/a.test.ts', 'packages/x/src/claude.ts', 'notes.txt', '.editorconfig', 'src/make.ts', 'docs/agents-guide.md', 'src/cargo.ts']) expect(gateClassPathRule(p), p).toBeNull();
  });

  it('Aegis H2: code-executing and steering files and dirs are gate-class, in any letter case; non-ASCII and win32 aliases card', () => {
    const dirs = ['.vscode/tasks.json', '.VSCode/settings.json', '.idea/workspace.xml', '.cursor/rules/x.mdc', '.devcontainer/devcontainer.json', '.yarn/plugins/p.cjs', '.cargo/config.toml', '.paradigm/config.yaml', '.lefthook/pre-commit/x.sh', 'sub/.vscode/launch.json'];
    const files = [
      'eslint.config.js', 'eslint.config.mjs', 'pkg/ESLint.config.ts', '.eslintrc', '.eslintrc.json', '.eslintrc.cjs', 'prettier.config.js', '.prettierrc', '.prettierrc.yaml',
      '.pnpmfile.cjs', '.pre-commit-config.yaml', 'lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook-local.yml', '.lintstagedrc', '.lintstagedrc.json', 'lint-staged.config.js',
      'Makefile', 'makefile', 'MAKEFILE', 'GNUmakefile', 'sub/Makefile', 'justfile', 'Justfile', 'Taskfile.yml', 'taskfile.yaml',
      'setup.py', 'setup.cfg', 'pyproject.toml', 'build.rs', 'Cargo.toml', 'crates/a/cargo.toml', 'mise.toml', '.mise.toml', '.tool-versions', '.envrc',
      'AGENTS.md', 'agents.md', 'GEMINI.md', '.cursorrules', '.windsurfrules',
    ];
    for (const p of [...dirs, ...files]) expect(gateClassPathRule(p), p).not.toBeNull();
    expect(gateClassPathRule('.VSCode/x')).toBe('dir:.vscode');
    expect(gateClassPathRule('Makefile')).toBe('file:makefile');
    // a non-ASCII name anywhere (Cyrillic і in `.gіt`, fullwidth Ｍ, a combining mark, an accented dir) is never judged by the list
    for (const p of ['.g\u0456t/hooks/pre-commit', '\uff2dakefile', 'Make\u0301file', 'caf\u00e9/x.ts']) expect(gateClassPathRule(p), p).toBe('non-ascii');
    // win32 aliases: an 8.3 short name, an alternate data stream; trailing dots/spaces are dropped
    expect(gateClassPathRule('GIT~1/hooks/x')).toBe('win-alias');
    expect(gateClassPathRule('Makefile:evil')).toBe('win-alias');
    expect(gateClassPathRule('Makefile.')).toBe('file:makefile');
    expect(gateClassPathRule('.git. /hooks/x')).toBe('dir:.git');
  });

  it('Aegis H1/M3: a symlink anywhere below the root (dangling or not, final or parent) cards; a home-rooted session never auto-edits', () => {
    const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-ae-sl-')));
    const root = path.join(top, 'repo');
    const link = (target: string, at: string, type?: 'dir' | 'file'): boolean => {
      try {
        fs.symlinkSync(target, at, type);
        return true;
      } catch {
        return false; // win32 without symlink rights: that case is skipped
      }
    };
    try {
      fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
      fs.mkdirSync(path.join(root, 'real'));
      const lines = ['Write x'];
      // Aegis re-check: a root prefix that matches only once case is folded (case-sensitive volume) goes to a card
      const upper = path.join(path.dirname(root), path.basename(root).toUpperCase(), 'x.ts');
      if (path.basename(root).toUpperCase() !== path.basename(root))
        expect(autoEditPass('Write', { file_path: upper }, [root], lines, 'darwin')).toMatchObject({ ok: false, why: 'outside-root', rule: 'case-variant' });
      // a dangling link to .git/hooks/pre-commit (no hook yet): the Write would plant it
      if (link('../.git/hooks/pre-commit', path.join(root, 'scripts', 'precommit'), 'file')) {
        expect(autoEditPass('Write', { file_path: path.join(root, 'scripts', 'precommit') }, [root], lines, 'linux')).toMatchObject({ ok: false, why: 'symlink', rule: path.join('scripts', 'precommit') });
        // and the steering/deny side follows it to where the write lands
        expect(realpathFollow(path.join(root, 'scripts', 'precommit'))).toBe(path.join(root, '.git', 'hooks', 'pre-commit'));
        expect(deniedWrite(path.join(root, 'scripts', 'precommit'), [{ path: path.join(root, '.git'), match: 'subpath', class: 'git' }], 'linux')).toMatchObject({ class: 'git' });
      }
      // a dangling link outside the folder
      if (link(path.join(top, 'outside', 'evil.sh'), path.join(root, 'out.sh'), 'file')) {
        expect(autoEditPass('Write', { file_path: path.join(root, 'out.sh') }, [root], lines, 'linux')).toMatchObject({ ok: false, why: 'symlink' });
      }
      // a symlinked parent dir (to a folder inside the root, and to one outside)
      if (link(path.join(root, 'real'), path.join(root, 'alias'), 'dir')) {
        expect(autoEditPass('Write', { file_path: path.join(root, 'alias', 'x.ts') }, [root], lines, 'linux')).toMatchObject({ ok: false, why: 'symlink', rule: 'alias' });
      }
      fs.mkdirSync(path.join(top, 'elsewhere'));
      if (link(path.join(top, 'elsewhere'), path.join(root, 'ext'), 'dir')) {
        expect(autoEditPass('Write', { file_path: path.join(root, 'ext', 'new', 'x.ts') }, [root], lines, 'linux')).toMatchObject({ ok: false, why: 'symlink' });
      }
      // a symlink to a real file inside the root is still a card (the final component is lstat'd)
      fs.writeFileSync(path.join(root, 'real', 'f.ts'), '');
      if (link(path.join(root, 'real', 'f.ts'), path.join(root, 'f-link.ts'), 'file')) {
        expect(autoEditPass('Edit', { file_path: path.join(root, 'f-link.ts') }, [root], lines, 'linux')).toMatchObject({ ok: false, why: 'symlink' });
      }
      // a symlink loop is unresolvable: the deny side denies it outright
      if (link(path.join(root, 'loop-b'), path.join(root, 'loop-a')) && link(path.join(root, 'loop-a'), path.join(root, 'loop-b'))) {
        expect(() => realpathFollow(path.join(root, 'loop-a', 'x'))).toThrow();
        expect(deniedWrite(path.join(root, 'loop-a', 'x'), [], 'linux')).not.toBeNull();
      }
      // no symlink: passes, and the logged path is the real one
      expect(autoEditPass('Write', { file_path: path.join(root, 'real', 'g.ts') }, [root], lines, 'linux')).toMatchObject({ ok: true, path: path.join(root, 'real', 'g.ts') });
      // M3: a session rooted at the user's home, or above it, or at `/`, never auto-edits
      expect(autoEditPass('Write', { file_path: path.join(root, 'real', 'g.ts') }, [root], lines, 'linux', root)).toMatchObject({ ok: false, why: 'home-root' });
      expect(autoEditPass('Write', { file_path: path.join(root, 'real', 'g.ts') }, [top], lines, 'linux', root)).toMatchObject({ ok: false, why: 'home-root' });
      expect(autoEditPass('Write', { file_path: path.join(root, 'real', 'g.ts') }, [path.parse(root).root], lines, 'linux', '/nonexistent-home')).toMatchObject({ ok: false, why: 'home-root' });
      expect(autoEditPass('Write', { file_path: path.join(root, 'real', 'g.ts') }, [root], lines, 'linux', path.join(top, 'elsewhere'))).toMatchObject({ ok: true });
    } finally {
      fs.rmSync(top, { recursive: true, force: true });
    }
  });

  it('autoEditPass: only Edit/Write/MultiEdit/NotebookEdit, inside the roots, not gate-class, no hidden characters', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-ae-')));
    try {
      fs.mkdirSync(path.join(root, 'src'));
      const ok = autoEditPass('Edit', { file_path: path.join(root, 'src', 'a.ts') }, [root], ['Edit a.ts'], 'linux');
      expect(ok).toMatchObject({ ok: true, path: path.join(root, 'src', 'a.ts') });
      // M4: a relative path, or one with a `..` segment, is a card
      expect(autoEditPass('Write', { file_path: 'src/b.ts' }, [root], ['w'], 'linux')).toMatchObject({ ok: false, why: 'relative' });
      expect(autoEditPass('Write', { file_path: './src/b.ts' }, [root], ['w'], 'linux')).toMatchObject({ ok: false, why: 'relative' });
      expect(autoEditPass('NotebookEdit', { notebook_path: path.join(root, 'n.ipynb') }, [root], ['n'], 'linux')).toMatchObject({ ok: true });
      expect(autoEditPass('Bash', { command: 'touch src/a.ts' }, [root], ['b'], 'linux')).toMatchObject({ ok: false, why: 'tool' });
      expect(autoEditPass('WebFetch', { url: 'https://x' }, [root], ['b'], 'linux')).toMatchObject({ ok: false, why: 'tool' });
      expect(autoEditPass('Edit', { file_path: path.join(path.dirname(root), 'elsewhere', 'hosts') }, [root], ['e'], 'linux')).toMatchObject({ ok: false, why: 'outside-root' });
      expect(autoEditPass('Edit', { file_path: `${root}/../x.ts` }, [root], ['e'], 'linux')).toMatchObject({ ok: false, why: 'relative' });
      expect(autoEditPass('Edit', { file_path: `${root}/src/../src/a.ts` }, [root], ['e'], 'linux')).toMatchObject({ ok: false, why: 'relative' });
      expect(autoEditPass('Edit', { file_path: root }, [root], ['e'], 'linux')).toMatchObject({ ok: false, why: 'outside-root' });
      expect(autoEditPass('Edit', { file_path: path.join(root, '.claude', 'settings.json') }, [root], ['e'], 'linux')).toMatchObject({ ok: false, why: 'gate-class' });
      expect(autoEditPass('Write', { file_path: path.join(root, 'CLAUDE.md') }, [root], ['e'], 'linux')).toMatchObject({ ok: false, why: 'gate-class' });
      expect(autoEditPass('Edit', { file_path: '' }, [root], ['e'], 'linux')).toMatchObject({ ok: false, why: 'no-path' });
      // a card whose lines carry a bidi override is shown, never passed
      expect(autoEditPass('Edit', { file_path: path.join(root, 'src', 'a.ts') }, [root], ['new: if (x‮) {'], 'linux')).toMatchObject({ ok: false, why: 'flagged' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('run modes: the control (request.mode.set, the book, the ceiling) — every OS', () => {
  const REPO = repoKeyOf(['/work/repo-a']);
  const sess = [{ hsid: HSID_A, repoKey: REPO, cwd: '/work/repo-a' }];

  it('a session takes its repo\'s mode unless one is set for it; the default is ask', async () => {
    const r = controlRig({ sessions: sess });
    expect(r.control.view(HSID_A, REPO)).toMatchObject({ chosen: 'ask', source: 'default', effective: 'ask', ceiling: 'auto-edits', level: null });
    await r.control.request(ASK_GUI, { repo: REPO, to: 'manual' });
    expect(r.control.view(HSID_A, REPO)).toMatchObject({ chosen: 'manual', source: 'repo', effective: 'manual' });
    // a session's own mode (stricter than its repo's is a tightening too) wins over the repo's
    r.book.apply({ repo: null, hsid: HSID_A }, 'ask');
    expect(r.control.view(HSID_A, REPO)).toMatchObject({ chosen: 'ask', source: 'session' });
  });

  it('tightening: one request, no presence, approval.mode.set{presence:none} after request.mode.set; effective at once', async () => {
    const r = controlRig({ sessions: sess });
    const out = await r.control.request(ASK_GUI, { hsid: HSID_A, to: 'manual' });
    expect(out).toMatchObject({ changed: true, applied: true, from: 'ask', to: 'manual', presence: 'none', effective: 'manual' });
    expect(r.prompts).toHaveLength(0);
    expect(r.rows.map((x) => x.kind)).toEqual(['request.mode.set', 'approval.mode.set']);
    expect(r.kinds('request.mode.set')).toEqual([{ repo: REPO, hsid: HSID_A, to: 'manual' }]);
    expect(r.kinds('approval.mode.set')).toEqual([{ scope: { repo: REPO, hsid: HSID_A }, from: 'ask', to: 'manual', by: { principal: HUMAN, connId: 'conn:gui', via: 'gui' }, presence: 'none' }]);
    expect(r.control.view(HSID_A, REPO).effective).toBe('manual');
    // the same mode again changes nothing and writes nothing
    expect(await r.control.request(ASK_GUI, { hsid: HSID_A, to: 'manual' })).toMatchObject({ changed: false, mode: 'manual' });
    expect(r.rows).toHaveLength(2);
  });

  it('loosening: a strictness card, applied only by an allow with fresh presence; never always; deny keeps the mode', async () => {
    const r = controlRig({ sessions: sess });
    const out = await r.control.request(ASK_GUI, { hsid: HSID_A, to: 'auto-edits' });
    expect(out).toMatchObject({ changed: false, pending: true, from: 'ask', to: 'auto-edits' });
    const cardId = (out as { cardId: string }).cardId;
    const card = r.broker.card(cardId)!;
    expect(card.kind).toBe('strictness');
    expect(JSON.stringify(card.block)).toContain('ask → auto-edits');
    expect(r.control.view(HSID_A, REPO).effective).toBe('ask'); // nothing changed yet
    expect(r.kinds('approval.mode.set')).toHaveLength(0);
    // the same request returns the same card; a different loosening is refused while it is pending
    expect(await r.control.request(ASK_GUI, { hsid: HSID_A, to: 'auto-edits' })).toMatchObject({ pending: true, cardId });
    // always is never a decision of a strictness card
    expect((await errOf(r.approve(cardId, 'always'))).refusal.code).toBe('BAD_REQUEST');
    await r.approve(cardId, 'allow');
    expect(r.prompts).toHaveLength(1); // the fresh-presence prompt, naming the step
    expect(r.prompts[0]).toContain('ask → auto-edits');
    expect(r.kinds('approval.mode.set')).toEqual([expect.objectContaining({ from: 'ask', to: 'auto-edits', presence: 'fresh' })]);
    expect(r.control.view(HSID_A, REPO).effective).toBe('auto-edits');
    // a deny on a second loosening keeps the mode (repo scope this time)
    await r.control.request(ASK_GUI, { hsid: HSID_A, to: 'manual' });
    const again = (await r.control.request(ASK_GUI, { hsid: HSID_A, to: 'ask' })) as { cardId: string };
    await r.approve(again.cardId, 'deny');
    expect(r.control.view(HSID_A, REPO).effective).toBe('manual');
  });

  it('loosening needs FRESH presence: a cached unlock of the connection never carries it, and a declined prompt changes nothing', async () => {
    const r = controlRig({ sessions: sess });
    // open a cached unlock on conn:gui with a cached-class decision (a permission allow)
    const perm = await r.broker.raise({ kind: 'permission', requestedBy: 'p:abcdefgh/s-x', hsid: HSID_A, attended: true, detail: { tool: 'Write' }, lines: ['Write x'], decisions: ['allow', 'deny'] });
    await r.approve(perm.cardId, 'allow');
    expect(r.broker.unlocks.has('conn:gui')).toBe(true);
    const n = r.prompts.length;
    const out = (await r.control.request(ASK_GUI, { hsid: HSID_A, to: 'auto-edits' })) as { cardId: string };
    r.gate.deny = true; // the human declines the prompt: the unlock cannot stand in for it
    const e = await errOf(r.approve(out.cardId, 'allow'));
    expect(e.refusal).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'presence' } });
    expect(r.prompts.length).toBe(n + 1); // a fresh prompt was raised despite the cached unlock
    expect(r.kinds('approval.mode.set')).toHaveLength(0);
    expect(r.control.view(HSID_A, REPO).effective).toBe('ask');
  });

  it('who may set a mode: only the human on a gui or device connection; an agent, session, mod or read-token connection never', async () => {
    const r = controlRig({ sessions: sess });
    for (const asker of [
      { connId: 'conn:a', principal: 'p:abcdefgh/agent-1', principalClass: 'agent', credential: 'device' },
      { connId: 'conn:s', principal: 'p:abcdefgh/s-1', principalClass: 'session', credential: 'device' },
      { connId: 'conn:m', principal: 'p:abcdefgh/mod-x', principalClass: 'mod', credential: 'device' },
      { connId: 'conn:t', principal: HUMAN, principalClass: 'readToken', credential: 'read-token' },
      { connId: 'conn:h', principal: HUMAN, principalClass: 'human', credential: 'read-token' },
    ]) {
      const e = await errOf(r.control.request(asker, { hsid: HSID_A, to: 'manual' }));
      expect(e.refusal.code, asker.principalClass).toBe('FORBIDDEN');
    }
    expect(r.rows).toHaveLength(0);
    // the human device (gnomon mode) is first-party
    expect(await r.control.request({ connId: 'conn:cli', principal: HUMAN, principalClass: 'human', credential: 'device' }, { repo: REPO, to: 'manual' })).toMatchObject({ changed: true });
    expect(r.kinds('approval.mode.set')[0]).toMatchObject({ by: { via: 'cli' } });
  });

  it('bad requests: an unknown mode, unknown keys, a bad or dead session, no scope ⇒ BAD_REQUEST / NOT_FOUND, nothing written', async () => {
    const r = controlRig({ sessions: sess });
    for (const p of [{ hsid: HSID_A, to: 'bypass' }, { hsid: HSID_A, to: 'acceptEdits' }, { hsid: HSID_A }, { hsid: HSID_A, to: 'ask', extra: 1 }, { hsid: 'nope', to: 'ask' }, { to: 'ask' }, { repo: 'relative/path', to: 'ask' }, null, 'ask']) {
      const e = await errOf(r.control.request(ASK_GUI, p));
      expect(e.refusal.code, JSON.stringify(p)).toBe('BAD_REQUEST');
    }
    const e = await errOf(r.control.request(ASK_GUI, { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB', to: 'ask' }));
    expect(e.refusal.code).toBe('NOT_FOUND');
    expect(() => r.control.admitOpen('/work/repo-a', 'turbo')).toThrow(RefusedError);
    expect(r.rows).toHaveLength(0);
  });

  it('the ceiling: a mode looser than the level allows is FORBIDDEN{strictness, strictness-mode}; effective = stricter of chosen and ceiling', async () => {
    const level = { v: 'L2' as 'L0' | 'L1' | 'L2' | 'L3' | null };
    const r = controlRig({ sessions: sess, level: () => level.v });
    const e = await errOf(r.control.request(ASK_GUI, { hsid: HSID_A, to: 'auto-edits' }));
    expect(e.refusal).toMatchObject({ code: 'FORBIDDEN', gate: 'strictness', data: { reason: 'strictness-mode', ceiling: 'ask', level: 'L2' } });
    expect(() => r.control.admitOpen('/work/repo-a', 'auto-edits')).toThrow(/ceiling/);
    // a mode chosen under a looser level is clamped when the level rises; status shows both
    level.v = null;
    r.book.apply({ repo: REPO, hsid: null }, 'auto-edits');
    level.v = 'L3';
    expect(r.control.view(HSID_A, REPO)).toMatchObject({ chosen: 'auto-edits', ceiling: 'manual', effective: 'manual' });
    const st = r.control.status() as { sessions: Array<Record<string, unknown>> };
    expect(st.sessions[0]).toMatchObject({ hsid: HSID_A, chosen: 'auto-edits', ceiling: 'manual', effective: 'manual' });
    // a card raised under a looser level re-checks the ceiling at decision time: the effect refuses, the mode stays
    level.v = null;
    r.book.apply({ repo: REPO, hsid: null }, 'ask');
    const out = (await r.control.request(ASK_GUI, { repo: REPO, to: 'auto-edits' })) as { cardId: string };
    level.v = 'L2';
    await errOf(r.approve(out.cardId, 'allow'));
    expect(r.kinds('approval.mode.set').filter((x) => x.to === 'auto-edits' && x.presence === 'fresh')).toHaveLength(0);
  });

  it('strictness is not built: no level source ⇒ the ceiling permits every mode, and status says so', () => {
    const r = controlRig({ sessions: sess });
    expect(r.control.status()).toMatchObject({ default: 'ask', strictness: { built: false } });
    expect(r.control.admitOpen('/work/repo-a', 'auto-edits')).toEqual({ direct: null, loosen: 'auto-edits' });
    expect(r.control.admitOpen('/work/repo-a', 'manual')).toEqual({ direct: 'manual', loosen: null });
  });

  it('Aegis M1: tightening a repo pulls every live session whose own mode is looser down to it; stricter sessions and other repos stay', async () => {
    const HSID_B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
    const HSID_C = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZC';
    const OTHER = repoKeyOf(['/work/repo-b']);
    const r = controlRig({ sessions: [...sess, { hsid: HSID_B, repoKey: REPO, cwd: '/work/repo-a' }, { hsid: HSID_C, repoKey: OTHER, cwd: '/work/repo-b' }] });
    r.book.apply({ repo: null, hsid: HSID_A }, 'auto-edits'); // its own, looser
    r.book.apply({ repo: null, hsid: HSID_B }, 'manual'); // its own, stricter
    r.book.apply({ repo: null, hsid: HSID_C }, 'auto-edits'); // another repo
    const out = await r.control.request(ASK_GUI, { repo: REPO, to: 'manual' });
    expect(out).toMatchObject({ changed: true, from: 'ask', to: 'manual' });
    const sets = r.kinds('approval.mode.set');
    expect(sets).toEqual([
      expect.objectContaining({ scope: { repo: REPO }, to: 'manual', presence: 'none' }),
      expect.objectContaining({ scope: { repo: REPO, hsid: HSID_A }, from: 'auto-edits', to: 'manual', presence: 'none' }),
    ]);
    expect(r.control.view(HSID_A, REPO)).toMatchObject({ chosen: 'manual', effective: 'manual' });
    expect(r.control.view(HSID_B, REPO)).toMatchObject({ chosen: 'manual' });
    expect(r.control.view(HSID_C, OTHER)).toMatchObject({ chosen: 'auto-edits' });
    expect(r.changes.n).toBe(1); // the live sessions are told at once (L2)
    // a fresh book folding the same rows agrees (the pull-down is on the chain)
    const fresh = new RunModeBook({ principal: KP, isKernelKey: (k) => k === 'kernel-key' });
    r.rows.forEach((x, i) => fresh.fold({ seq: i + 1, kind: x.kind, principal: KP, keyId: 'kernel-key', payload: x.payload }));
    expect(fresh.sessionMode(HSID_A)).toBe('manual');
  });

  it('Aegis M1: the brake withdraws a pending card that would loosen a pulled-down session again', async () => {
    const r = controlRig({ sessions: sess });
    r.book.apply({ repo: null, hsid: HSID_A }, 'ask'); // its own mode
    const pending = (await r.control.request(ASK_GUI, { hsid: HSID_A, to: 'auto-edits' })) as { cardId: string };
    expect(r.broker.card(pending.cardId)!.state).toBe('pending');
    await r.control.request(ASK_GUI, { repo: REPO, to: 'manual' });
    expect(r.control.view(HSID_A, REPO).chosen).toBe('manual');
    expect(r.broker.card(pending.cardId)!.state).not.toBe('pending');
    expect((await errOf(r.approve(pending.cardId, 'allow'))).refusal.code).toBeDefined();
    expect(r.control.view(HSID_A, REPO).chosen).toBe('manual');
  });

  it('Aegis M3: a folder that is the user\'s home, above it, or / never loosens to auto-edits (open or request); tightening still works', async () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-home-')));
    try {
      const HKEY = repoKeyOf([home]);
      const r = controlRig({ userHome: home, sessions: [{ hsid: HSID_A, repoKey: HKEY, cwd: home }] });
      for (const dir of [home, path.dirname(home), path.parse(home).root]) {
        const e = (() => {
          try {
            r.control.admitOpen(dir, 'auto-edits');
            return null;
          } catch (x) {
            return x as RefusedError;
          }
        })();
        expect(e, dir).toBeInstanceOf(RefusedError);
        expect(e!.refusal).toMatchObject({ code: 'FORBIDDEN', gate: 'strictness', data: { reason: 'strictness-mode' } });
      }
      expect(r.control.admitOpen(home, 'ask')).toEqual({ direct: 'ask', loosen: null });
      expect((await errOf(r.control.request(ASK_GUI, { hsid: HSID_A, to: 'auto-edits' }))).refusal).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'strictness-mode' } });
      expect((await errOf(r.control.request(ASK_GUI, { repo: home, to: 'auto-edits' }))).refusal).toMatchObject({ code: 'FORBIDDEN' });
      expect(r.kinds('request.mode.set')).toHaveLength(0);
      expect(await r.control.request(ASK_GUI, { hsid: HSID_A, to: 'manual' })).toMatchObject({ changed: true });
      // a project folder under the home is fine
      fs.mkdirSync(path.join(home, 'proj'));
      expect(r.control.admitOpen(path.join(home, 'proj'), 'auto-edits')).toEqual({ direct: null, loosen: 'auto-edits' });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('the repo mode persists: a fresh book folding the same kernel-signed rows reads the same modes; forged rows are ignored', async () => {
    const r = controlRig({ sessions: sess });
    await r.control.request(ASK_GUI, { repo: REPO, to: 'manual' });
    const fresh = new RunModeBook({ principal: KP, isKernelKey: (k) => k === 'kernel-key' });
    r.rows.forEach((x, i) => fresh.fold({ seq: i + 1, kind: x.kind, principal: KP, keyId: 'kernel-key', payload: x.payload }));
    expect(fresh.repoMode(REPO)).toBe('manual');
    // a forged row (another principal, or a non-kernel key) never moves a mode
    fresh.fold({ seq: 99, kind: 'approval.mode.set', principal: HUMAN, keyId: 'kernel-key', payload: { scope: { repo: REPO }, from: 'manual', to: 'auto-edits' } });
    fresh.fold({ seq: 100, kind: 'approval.mode.set', principal: KP, keyId: 'forged', payload: { scope: { repo: REPO }, from: 'manual', to: 'auto-edits' } });
    expect(fresh.repoMode(REPO)).toBe('manual');
    // session.open{runMode} sets the session's own mode; an unknown value folds fail-safe to manual
    fresh.fold({ seq: 101, kind: 'session.open', principal: KP, keyId: 'kernel-key', payload: { hsid: HSID_A, runMode: 'auto-edits' } });
    expect(fresh.sessionMode(HSID_A)).toBe('auto-edits');
    fresh.fold({ seq: 102, kind: 'approval.mode.set', principal: KP, keyId: 'kernel-key', payload: { scope: { repo: REPO, hsid: HSID_A }, from: 'auto-edits', to: 'yolo' } });
    expect(fresh.sessionMode(HSID_A)).toBe('manual');
  });
});

