// @gnomon-platform: darwin, linux
/**
 * #git-verbs (T-2026-10-23-002): the kernel-run git verbs, against a REAL git in throwaway folders, a fake broker and
 * an exec seam where the network would be (push, gh). Aegis list: credential exposure, remote spoofing, config
 * injection through the init template, argument injection, symlinked .git, a repo inside a repo, egress only to the
 * resolved host.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateKindPayload } from '@a-company/gnomon-contracts';
import { GitVerbs, type VerbSession } from '../src/kernel/git/kernel-verbs.js';
import { execTool, networkEnv, NEVER_VERB_ENV, PUSH_GIT_FLAGS, redactOutput, type Exec } from '../src/kernel/git/verb-exec.js';
import { configProblems, hostWarning, initConfigText, initRefusal, parseRemote, pushRuleInput, validBranch, validOwner, validRemoteName, validRepoName } from '../src/kernel/git/verbs.js';
import { inputHash } from '../src/kernel/supervisor/permission.js';
import { kernelMcpAnswer } from '../src/kernel/supervisor/kernel-mcp.js';
import { parseStreamLine, mcpResponseLine } from '../src/adapters/claude-code/adapter.js';

const ENV = { PATH: '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x', HOME: '/nonexistent' };
const git = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, env: ENV, encoding: 'utf8' });
const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function world() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-gv-')));
  tmps.push(root);
  const repo = path.join(root, 'proj');
  const userHome = path.join(root, 'home');
  const gnomonHome = path.join(root, 'gnomon');
  for (const d of [repo, userHome, gnomonHome]) fs.mkdirSync(d);
  return { root, repo, userHome, gnomonHome };
}
function committed(repo: string, remoteUrl?: string) {
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-qm', 'one');
  if (remoteUrl) git(repo, 'remote', 'add', 'origin', remoteUrl);
}

interface Rig {
  verbs: GitVerbs;
  rows: Array<Record<string, unknown>>;
  raised: Array<Record<string, unknown>>;
  autos: Array<Record<string, unknown>>;
  calls: Array<{ bin: string; args: readonly string[]; env: Record<string, string> }>;
  set: { decision: string; rule: { ruleId: string } | null; url: string[] };
}
/** The exec seam: real git for local work; `remote get-url --push` answers set.url (one per call, the last repeats); push and gh are recorded. */
function rig(w: ReturnType<typeof world>, o: { gh?: (args: readonly string[]) => { code: number; stdout: string; stderr: string }; realRemote?: boolean } = {}): Rig {
  const rows: Rig['rows'] = [];
  const raised: Rig['raised'] = [];
  const autos: Rig['autos'] = [];
  const calls: Rig['calls'] = [];
  const set: Rig['set'] = { decision: 'allow', rule: null, url: [] };
  const exec: Exec = async (bin, args, x) => {
    calls.push({ bin, args, env: x.env });
    if (bin === '/fake/gh') return { timedOut: false, ...(o.gh ? o.gh(args) : { code: 0, stdout: '', stderr: '' }) };
    const i = args.indexOf('get-url');
    if (i >= 0 && args.includes('--push') && !o.realRemote) {
      const u = set.url.length > 1 ? set.url.shift()! : set.url[0];
      return u === undefined ? { code: 2, stdout: '', stderr: 'error: No such remote', timedOut: false } : { code: 0, stdout: `${u}\n`, stderr: '', timedOut: false };
    }
    if (args.includes('push')) return { code: 0, stdout: 'To x\n', stderr: '', timedOut: false };
    return execTool(bin, args, x);
  };
  const verbs = new GitVerbs({
    log: async (kind, payload) => void rows.push({ kind, ...payload }),
    broker: {
      raise: async (inp: Record<string, unknown>) => {
        raised.push(inp);
        return { cardId: `card:01JAAAAAAAAAAAAAAAAAAAAAA${raised.length}` } as never;
      },
      decisionOf: async () => set.decision,
      auto: async (p: Record<string, unknown>) => void autos.push(p),
      expire: async () => true,
    } as never,
    alwaysRule: (_k, tool, hash) => (set.rule && tool === 'gnomon_git_push' ? (hash ? set.rule : null) : null),
    gnomonHome: w.gnomonHome,
    userHome: () => w.userHome,
    exec,
    gh: () => '/fake/gh',
    env: () => ({ PATH: ENV.PATH, HOME: '/should-not-leak', GH_TOKEN: 'ghp_leakleakleakleakleakleak', GIT_DIR: '/evil', HTTPS_PROXY: 'http://evil', USER: 'u' }),
  });
  return { verbs, rows, raised, autos, calls, set };
}
const sess = (w: ReturnType<typeof world>, x: Partial<VerbSession> = {}): VerbSession => ({ hsid: 'hsid:v1:01JAAAAAAAAAAAAAAAAAAAAAAA', principalId: 'p:abcdefgh/s-x', cwd: w.repo, repoKey: 'sha256:00', mode: 'ask', planApproved: false, loop: false, ...x });
const phases = (r: Rig) => r.rows.map((x) => `${String(x.phase)}${x.why ? `:${String(x.why)}` : ''}`);

describe('git.init (^git-init-gate)', () => {
  it('ask: a card, then a repo with the kernel template only (no hooks, no samples, branch main)', async () => {
    const w = world();
    const r = rig(w);
    const res = await r.verbs.call('gnomon_git_init', {}, sess(w));
    expect(res.ok).toBe(true);
    expect(r.raised).toHaveLength(1);
    expect((r.raised[0]!.lines as string[])[0]).toBe(`Make ${w.repo} a git repo`);
    const cfg = fs.readFileSync(path.join(w.repo, '.git', 'config'), 'utf8');
    expect(configProblems(cfg)).toEqual([]);
    expect(cfg).not.toMatch(/hookspath|fsmonitor|sshcommand|helper|filter|include|askpass|editor|pager/i);
    expect(fs.readdirSync(path.join(w.repo, '.git', 'hooks'))).toEqual([]);
    expect(fs.existsSync(path.join(w.repo, '.git', 'description'))).toBe(false);
    expect(fs.readFileSync(path.join(w.repo, '.git', 'HEAD'), 'utf8').trim()).toBe('ref: refs/heads/main');
    expect(phases(r)).toEqual(['requested', 'ran']);
    for (const row of r.rows) expect(validateKindPayload('git.verb', Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'kind')))).toEqual([]);
  });
  it('auto-edits runs it with an approval.auto row and no card; manual and loop sessions refuse', async () => {
    const w = world();
    const r = rig(w);
    expect((await r.verbs.call('gnomon_git_init', {}, sess(w, { mode: 'manual' }))).why).toBe('mode-manual');
    expect((await r.verbs.call('gnomon_git_init', {}, sess(w, { loop: true }))).why).toBe('loop-session');
    expect((await r.verbs.call('gnomon_git_init', {}, sess(w, { mode: 'auto-edits' }))).ok).toBe(true);
    expect(r.raised).toHaveLength(0);
    expect(r.autos[0]).toMatchObject({ tool: 'gnomon_git_init', modeRef: 'mode:auto-edits', path: w.repo });
  });
  it('a denied card makes nothing', async () => {
    const w = world();
    const r = rig(w);
    r.set.decision = 'deny';
    expect((await r.verbs.call('gnomon_git_init', {}, sess(w))).why).toBe('denied');
    expect(fs.existsSync(path.join(w.repo, '.git'))).toBe(false);
  });
  it('the human\'s global config (templateDir, hooksPath) never reaches the new repo', async () => {
    const w = world();
    const tpl = path.join(w.root, 'tpl', 'hooks');
    fs.mkdirSync(tpl, { recursive: true });
    fs.writeFileSync(path.join(tpl, 'pre-commit'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(w.userHome, '.gitconfig'), `[init]\n\ttemplateDir = ${path.dirname(tpl)}\n[core]\n\thooksPath = /tmp/x\n`);
    const r = rig(w);
    await r.verbs.call('gnomon_git_init', {}, sess(w, { mode: 'auto-edits' }));
    expect(fs.readdirSync(path.join(w.repo, '.git', 'hooks'))).toEqual([]);
    expect(fs.readFileSync(path.join(w.repo, '.git', 'config'), 'utf8')).not.toMatch(/hooksPath/i);
  });
  it('a remnant .git left by a failed sandboxed init is cleared; a real or nested repo, home, system and non-root folders refuse', async () => {
    const w = world();
    fs.mkdirSync(path.join(w.repo, '.git', 'objects', 'pack'), { recursive: true });
    fs.writeFileSync(path.join(w.repo, '.git', 'description'), 'x\n');
    const r = rig(w);
    const res = await r.verbs.call('gnomon_git_init', {}, sess(w, { mode: 'auto-edits' }));
    expect(res.ok).toBe(true);
    expect(res.text).toMatch(/incomplete \.git/);
    expect((await r.verbs.call('gnomon_git_init', {}, sess(w, { mode: 'auto-edits' }))).why).toBe('in-repo');
    const sub = path.join(w.repo, 'sub');
    fs.mkdirSync(sub);
    expect((await r.verbs.call('gnomon_git_init', {}, sess(w, { cwd: sub, mode: 'auto-edits' }))).why).toBe('in-repo');
    const ctx = { roots: [w.userHome, '/usr/local', w.gnomonHome], userHome: w.userHome, gnomonHome: w.gnomonHome };
    expect(initRefusal(w.userHome, ctx)?.why).toBe('protected-folder');
    expect(initRefusal('/usr/local', ctx)?.why).toBe('protected-folder');
    expect(initRefusal(w.gnomonHome, ctx)?.why).toBe('protected-folder');
    expect(initRefusal(w.root, ctx)?.why).toBe('not-a-root');
    expect((await r.verbs.call('gnomon_git_init', { path: '/' }, sess(w))).why).toBe('bad-input');
  });
  it('a symlinked .git or a gitfile pointer is never followed', async () => {
    const w = world();
    fs.mkdirSync(path.join(w.root, 'elsewhere'));
    fs.symlinkSync(path.join(w.root, 'elsewhere'), path.join(w.repo, '.git'));
    const r = rig(w);
    expect((await r.verbs.call('gnomon_git_init', {}, sess(w, { mode: 'auto-edits' }))).why).toBe('dotgit-link');
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).why).toBe('dotgit-link');
    fs.unlinkSync(path.join(w.repo, '.git'));
    fs.writeFileSync(path.join(w.repo, '.git'), `gitdir: ${w.root}/elsewhere\n`);
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).why).toBe('dotgit-link');
  });
  it('the template keeps only boolean core probes', () => {
    expect(initConfigText({ ignorecase: 'true', hookspath: '/x', filemode: '!sh' })).toBe('[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n\tignorecase = true\n');
  });
});

describe('git.push (^git-push-gate)', () => {
  it('the card is composed from the kernel\'s own reading: URL, host, branch; the push argv is hardened; rows carry no URL', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w);
    r.set.url = ['https://github.com/ascend42/a-platform-fighter.git'];
    const res = await r.verbs.call('gnomon_git_push', {}, sess(w));
    expect(res.ok).toBe(true);
    const c = r.raised[0]!;
    expect((c.lines as string[])[0]).toBe('Push main to https://github.com/ascend42/a-platform-fighter.git (github.com/ascend42/a-platform-fighter)');
    expect(c.lines).toContain('host: github.com');
    expect(c.decisions).toEqual(['allow', 'deny', 'always']);
    expect(c.ruleScope).toEqual({ repoKey: 'sha256:00' });
    expect(c.toolInput).toEqual(pushRuleInput(parseRemote('https://github.com/ascend42/a-platform-fighter.git') as never));
    expect((c.block as { children: Array<{ type: string }> }).children.at(-1)!.type).toBe('git-verb');
    const push = r.calls.find((x) => x.args.includes('push'))!;
    for (const f of ['core.hooksPath=/dev/null', 'protocol.allow=never', 'http.followRedirects=false', 'push.followTags=false']) expect(push.args).toContain(f);
    expect(push.args).toContain('--no-follow-tags');
    expect(push.args).not.toContain('--tags');
    expect(push.args).not.toContain('--mirror');
    expect(push.args.slice(-3)).toEqual(['--', 'origin', 'refs/heads/main:refs/heads/main']);
    for (const k of NEVER_VERB_ENV) expect(push.env[k]).toBeUndefined();
    expect(push.env.HOME).toBe(w.userHome);
    expect(push.env.GIT_ALLOW_PROTOCOL).toBe('https:ssh');
    expect(push.env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(JSON.stringify(r.rows)).not.toMatch(/https:|a-platform-fighter|To x/);
    expect(r.rows.at(-1)).toMatchObject({ phase: 'ran', host: 'github.com' });
  });
  it('an Always rule keyed to the exact URL and host pushes with no card; a force push or a lookalike host never uses or offers one', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w);
    r.set.url = ['https://github.com/o/r.git'];
    r.set.rule = { ruleId: 'card:01JAAAAAAAAAAAAAAAAAAAAAAA' };
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).ok).toBe(true);
    expect(r.raised).toHaveLength(0);
    expect(r.autos[0]).toMatchObject({ tool: 'gnomon_git_push', modeRef: 'rule:card:01JAAAAAAAAAAAAAAAAAAAAAAA', inputHash: inputHash(pushRuleInput(parseRemote('https://github.com/o/r.git') as never)) });
    await r.verbs.call('gnomon_git_push', { force: true }, sess(w));
    const f = r.raised.at(-1)!;
    expect(f.decisions).toEqual(['allow', 'deny']);
    expect(f.flags).toEqual(['irreversible']);
    expect((f.lines as string[]).some((l) => /FORCE push/.test(l))).toBe(true);
    expect(r.calls.filter((x) => x.args.includes('push')).at(-1)!.args).toContain('--force-with-lease');
    r.set.url = ['https://githuh.com/o/r.git'];
    await r.verbs.call('gnomon_git_push', {}, sess(w));
    const l = r.raised.at(-1)!;
    expect(l.flags).toEqual(['claim-mismatch']);
    expect(l.decisions).toEqual(['allow', 'deny']);
    expect((l.lines as string[])[0]).toMatch(/^Warning: the host githuh\.com looks like github\.com/);
  });
  it('remote spoofing: the remote is re-read after the card; a change refuses remote-changed and nothing is pushed', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w);
    r.set.url = ['https://github.com/o/r.git', 'https://evil.example/o/r.git'];
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).why).toBe('remote-changed');
    expect(r.calls.some((x) => x.args.includes('push'))).toBe(false);
  });
  it('a denied card pushes nothing; no remote, a detached HEAD and an unborn branch refuse', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w);
    r.set.url = ['git@github.com:o/r.git'];
    r.set.decision = 'deny';
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).why).toBe('denied');
    expect(r.calls.some((x) => x.args.includes('push'))).toBe(false);
    r.set.url = [];
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).why).toBe('no-remote');
    expect((await r.verbs.call('gnomon_git_push', { branch: 'nope' }, sess(w))).why).toBe('no-branch');
    git(w.repo, 'checkout', '-q', '--detach');
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).why).toBe('no-branch');
  });
  it('config injection: a repo config with hooks, helpers, includes or URL rewrites refuses unsafe-config', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w);
    r.set.url = ['https://github.com/o/r.git'];
    for (const [k, v] of [['core.hooksPath', '/tmp'], ['core.fsmonitor', 'x'], ['core.sshCommand', 'x'], ['credential.helper', 'x'], ['include.path', '/x'], ['url.https://evil/.insteadOf', 'https://github.com/'], ['remote.origin.receivepack', 'x'], ['filter.lfs.smudge', 'x']] as const) {
      git(w.repo, 'config', k, v);
      const res = await r.verbs.call('gnomon_git_push', {}, sess(w));
      expect(res.why, k).toBe('unsafe-config');
      git(w.repo, 'config', '--unset', k);
    }
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).ok).toBe(true);
  });
  it('argument injection: options, traversal and odd names refuse before any git call', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w);
    for (const a of [{ remote: '-oProxyCommand=x' }, { remote: '--upload-pack=x' }, { branch: '--force' }, { branch: '../x' }, { branch: 'a b' }, { branch: 'x‮' }, { force: 'yes' }, { tags: true }]) {
      expect((await r.verbs.call('gnomon_git_push', a, sess(w))).why, JSON.stringify(a)).toBe('bad-input');
    }
    expect(r.calls).toHaveLength(0);
    for (const n of ['-x', '.x', '..', 'a/b', 'r.git', 'a b']) expect(validRepoName(n), n).toBe(false);
    for (const n of ['-o', 'a--', 'x'.repeat(40)]) expect(validOwner(n), n).toBe(false);
    expect(validRemoteName('-o')).toBe(false);
    for (const b of ['HEAD', 'a..b', 'a.lock', 'a/', '@{x}', '.x', 'a//b']) expect(validBranch(b), b).toBe(false);
  });
});

describe('remote parsing and egress (Aegis)', () => {
  it('only https and ssh to a plain host; helpers, local paths, cleartext and passwords refuse', () => {
    for (const u of ['ext::sh -c x', 'fd::3', 'file:///tmp/r.git', '/tmp/r.git', '../r', 'git://github.com/o/r', 'http://github.com/o/r', 'https://u:p@github.com/o/r', 'https://tok@github.com/o/r', '-u', 'https://github.com/o/r?x=1', 'https://github.com/o', 'https://github.com/a/b/c']) {
      expect('error' in parseRemote(u), u).toBe(true);
    }
    expect(parseRemote('git@github.com:o/r.git')).toMatchObject({ scheme: 'ssh', host: 'github.com', owner: 'o', repo: 'r', slug: 'github.com/o/r' });
    expect(parseRemote('ssh://git@GitHub.com:22/o/r')).toMatchObject({ scheme: 'ssh', host: 'github.com', port: 22 });
  });
  it('lookalikes and punycode are flagged; real forges and their subdomains are not', () => {
    for (const h of ['githuh.com', 'gihtub.com', 'github.com.evil.io', 'github-com.io', 'xn--gthub-cta.com', 'gitlab.co', 'gíthub.com']) expect(hostWarning(h), h).not.toBeNull();
    for (const h of ['github.com', 'gitlab.com', 'codeberg.org', 'api.github.com', 'git.example.org']) expect(hostWarning(h), h).toBeNull();
    expect((parseRemote('https://gíthub.com/o/r') as { host: string }).host).toBe('gíthub.com');
  });
  it('every network call is pinned to the resolved remote: only https/ssh, no redirects, no submodules', () => {
    expect(PUSH_GIT_FLAGS.join(' ')).toMatch(/protocol\.allow=never.*protocol\.https\.allow=always.*protocol\.ssh\.allow=always.*http\.followRedirects=false.*push\.recurseSubmodules=no/);
    const env = networkEnv({ userHome: '/u', toolDir: '/opt/homebrew/bin', from: { GH_TOKEN: 'x', GITHUB_TOKEN: 'x', HTTPS_PROXY: 'x', GIT_SSH_COMMAND: 'x', SSH_AUTH_SOCK: '/s', USER: 'me' } });
    for (const k of NEVER_VERB_ENV) expect(env[k]).toBeUndefined();
    expect(env).toMatchObject({ HOME: '/u', SSH_AUTH_SOCK: '/s', USER: 'me', GIT_ALLOW_PROTOCOL: 'https:ssh' });
  });
  it('credential exposure: output shown to the agent drops URL userinfo and token shapes', () => {
    const out = redactOutput('remote: https://x-access-token:gho_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r.git ghp_abcdefghijklmnopqrstuvwxyz github_pat_abcdefghijklmnopqrstuvwxyz');
    expect(out).not.toMatch(/gho_|ghp_[a-z]|github_pat_[a-z]|x-access-token/);
  });
});

describe('repo.create', () => {
  const gh = (owner = 'ascend42') => (args: readonly string[]) => (args[0] === 'api' ? { code: 0, stdout: `${owner}\n`, stderr: '' } : { code: 0, stdout: 'https://github.com/x\n', stderr: '' });
  it('private by default: one card (no Always), gh creates, the kernel adds the remote and pushes with --set-upstream', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w, { gh: gh(), realRemote: true });
    const res = await r.verbs.call('gnomon_repo_create', { name: 'a-platform-fighter' }, sess(w));
    expect(res.ok, res.text).toBe(true);
    const c = r.raised[0]!;
    expect((c.lines as string[])[0]).toBe('Create github.com/ascend42/a-platform-fighter (private), then push main to it');
    expect(c.decisions).toEqual(['allow', 'deny']);
    expect(c.ruleScope).toBeUndefined();
    const create = r.calls.find((x) => x.bin === '/fake/gh' && x.args[0] === 'repo')!;
    expect(create.args).toEqual(['repo', 'create', 'ascend42/a-platform-fighter', '--private']);
    for (const k of NEVER_VERB_ENV) expect(create.env[k]).toBeUndefined();
    expect(git(w.repo, 'remote', 'get-url', 'origin').stdout.trim()).toBe('https://github.com/ascend42/a-platform-fighter.git');
    expect(r.calls.find((x) => x.args.includes('push'))!.args).toContain('--set-upstream');
  });
  it('public is explicit and irreversible-flagged; an existing remote, gh signed out and a bad name refuse', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w, { gh: gh(), realRemote: true });
    r.set.decision = 'deny';
    await r.verbs.call('gnomon_repo_create', { name: 'x', visibility: 'public' }, sess(w));
    expect(r.raised[0]!.flags).toEqual(['irreversible']);
    expect(r.calls.some((x) => x.args[0] === 'repo')).toBe(false);
    expect((await r.verbs.call('gnomon_repo_create', { name: '--x' }, sess(w))).why).toBe('bad-input');
    git(w.repo, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
    expect((await r.verbs.call('gnomon_repo_create', { name: 'x' }, sess(w))).why).toBe('remote-exists');
    const r2 = rig(w, { gh: () => ({ code: 4, stdout: '', stderr: 'not logged in' }), realRemote: true });
    expect((await r2.verbs.call('gnomon_repo_create', { name: 'x', remote: 'gh' }, sess(w))).why).toBe('not-authenticated');
  });
});

describe('git.worktree.add / remove', () => {
  it('makes .gnomon/worktrees/<name> on a new branch with no hooks, excludes it from status, and removes it', async () => {
    const w = world();
    committed(w.repo);
    fs.writeFileSync(path.join(w.repo, 'CLAUDE.md'), 'committed steering\n');
    git(w.repo, 'add', 'CLAUDE.md');
    git(w.repo, 'commit', '-qm', 'two');
    const r = rig(w);
    const res = await r.verbs.call('gnomon_worktree_add', { name: 'wt1' }, sess(w, { mode: 'auto-edits' }));
    expect(res.ok, res.text).toBe(true);
    const dir = path.join(w.repo, '.gnomon', 'worktrees', 'wt1');
    expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe('committed steering\n');
    expect(fs.lstatSync(path.join(dir, '.git')).isFile()).toBe(true);
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()).toBe('worktree-wt1');
    expect(git(w.repo, 'status', '--porcelain').stdout).toBe('');
    expect((await r.verbs.call('gnomon_worktree_add', { name: 'wt1' }, sess(w, { mode: 'auto-edits' }))).why).toBe('worktree-exists');
    expect((await r.verbs.call('gnomon_worktree_add', { name: '../x' }, sess(w))).why).toBe('bad-input');
    expect((await r.verbs.call('gnomon_worktree_remove', { name: 'nope' }, sess(w))).why).toBe('no-worktree');
    const rm = await r.verbs.call('gnomon_worktree_remove', { name: 'wt1' }, sess(w, { mode: 'auto-edits' }));
    expect(rm.ok, rm.text).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
  });
  it('a force remove always takes its own irreversible card', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w);
    await r.verbs.call('gnomon_worktree_add', { name: 'wt2' }, sess(w, { mode: 'auto-edits' }));
    r.set.decision = 'deny';
    expect((await r.verbs.call('gnomon_worktree_remove', { name: 'wt2', force: true }, sess(w, { mode: 'auto-edits' }))).why).toBe('denied');
    expect(r.raised.at(-1)!.flags).toEqual(['irreversible']);
  });
});

describe('#kernel-mcp', () => {
  it('serves initialize, tools/list and tools/call; never routes another server or method', async () => {
    const w = world();
    const r = rig(w);
    const s = () => sess(w, { mode: 'auto-edits' });
    expect(await kernelMcpAnswer({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, r.verbs, s)).toMatchObject({ id: 1, result: { capabilities: { tools: {} }, serverInfo: { name: 'gnomon' } } });
    const list = (await kernelMcpAnswer({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, r.verbs, s)) as { result: { tools: Array<{ name: string }> } };
    expect(list.result.tools.map((t) => t.name)).toEqual(['gnomon_git_init', 'gnomon_git_push', 'gnomon_repo_create', 'gnomon_worktree_add', 'gnomon_worktree_remove']);
    expect(await kernelMcpAnswer({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'gnomon_git_init', arguments: {} } }, r.verbs, s)).toMatchObject({ result: { isError: false } });
    expect(await kernelMcpAnswer({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'Bash', arguments: {} } }, r.verbs, s)).toMatchObject({ error: { code: -32602 } });
    expect(await kernelMcpAnswer({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, r.verbs, s)).toMatchObject({ error: { code: -32601 } });
    expect(await kernelMcpAnswer({ jsonrpc: '2.0', method: 'notifications/initialized' }, r.verbs, s)).toEqual({ jsonrpc: '2.0', id: 0, result: {} });
    expect(await kernelMcpAnswer('nope', r.verbs, s)).toMatchObject({ error: { code: -32600 } });
  });
  it('the adapter reads an mcp_message control request and writes the SDK answer shape', () => {
    const ev = parseStreamLine(JSON.stringify({ type: 'control_request', request_id: 'r-1', request: { subtype: 'mcp_message', server_name: 'gnomon', message: { jsonrpc: '2.0', id: 1, method: 'tools/list' } } }));
    expect(ev).toMatchObject({ kind: 'mcp-message', requestId: 'r-1', serverName: 'gnomon' });
    expect(JSON.parse(mcpResponseLine('r-1', { jsonrpc: '2.0', id: 1, result: {} }))).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: 'r-1', response: { mcp_response: { jsonrpc: '2.0', id: 1, result: {} } } } });
    expect(parseStreamLine(JSON.stringify({ type: 'control_request', request_id: 'bad id!', request: { subtype: 'mcp_message', server_name: 'gnomon' } })).kind).toBe('control-request-unknown');
  });
});
