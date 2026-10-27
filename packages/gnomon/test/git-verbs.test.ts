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
import { execTool, GH_LOCATIONS, networkEnv, NEVER_VERB_ENV, PUSH_GIT_FLAGS, redactOutput, trustedToolPath, type Exec } from '../src/kernel/git/verb-exec.js';
import { redactText } from '../src/kernel/trace/capture.js';
import { configProblems, hostWarning, initConfigText, initRefusal, parseRemote, pushRuleInput, pushRuleWords, validBranch, validOwner, validRemoteName, validRepoName } from '../src/kernel/git/verbs.js';
import { inputHash } from '../src/kernel/supervisor/permission.js';
import { kernelMcpAnswer } from '../src/kernel/supervisor/kernel-mcp.js';
import { parseStreamLine, mcpResponseLine } from '../src/adapters/claude-code/adapter.js';

const ENV = { PATH: '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x', HOME: '/nonexistent' };
const git = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, env: ENV, encoding: 'utf8' });
const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
/** The kernel rightly treats /tmp and /var/tmp as session-writable (a push config there is refused), and on Linux os.tmpdir() IS /tmp: keep the fake user home out of the shared temp dirs. */
function worldBase(): string {
  const t = fs.realpathSync(os.tmpdir());
  const shared = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp'].some((d) => t === d || t.startsWith(`${d}/`));
  if (!shared) return t;
  const b = path.join(os.homedir(), '.gnomon-test-tmp');
  fs.mkdirSync(b, { recursive: true });
  return fs.realpathSync(b);
}
function world() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(worldBase(), 'gnomon-gv-')));
  tmps.push(root);
  const repo = path.join(root, 'proj');
  const userHome = path.join(root, 'home');
  const gnomonHome = path.join(root, 'gnomon');
  for (const d of [repo, userHome, gnomonHome]) fs.mkdirSync(d);
  return { root, repo, userHome, gnomonHome };
}
function committed(repo: string, remoteUrl: string | null = 'https://github.com/o/r.git') {
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
    // the network read stays in the seam (never a real remote): the remote has no heads the rig knows of
    if (args.includes('ls-remote')) return { code: 0, stdout: '', stderr: '', timedOut: false };
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
const sess = (w: ReturnType<typeof world>, x: Partial<VerbSession> = {}): VerbSession => ({ hsid: 'hsid:v1:01JAAAAAAAAAAAAAAAAAAAAAAA', principalId: 'p:abcdefgh/s-x', cwd: w.repo, repoKey: 'sha256:00', mode: 'ask', planApproved: false, loop: false, worktreesGuarded: true, ...x });
const phases = (r: Rig) => r.rows.map((x) => `${String(x.phase)}${x.why ? `:${String(x.why)}` : ''}`);

describe('git.init (^git-init-gate)', () => {
  it('ask: a card, then a repo with the kernel template only (no hooks, no samples, branch main)', async () => {
    const w = world();
    const r = rig(w);
    const res = await r.verbs.call('gnomon_git_init', {}, sess(w));
    expect(res.ok).toBe(true);
    expect(r.raised).toHaveLength(1);
    expect((r.raised[0]!.lines as string[])[0]).toBe(`Make a git repo in ${w.repo}`);
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
    // Mika: the title names the host/owner/repo; the full URL is the body's next line
    expect((c.lines as string[]).slice(0, 2)).toEqual(['Push main to github.com/ascend42/a-platform-fighter', 'url: https://github.com/ascend42/a-platform-fighter.git']);
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
    // Aegis round 2 M3: the sha read once before the card is what is pushed
    const head = git(w.repo, 'rev-parse', 'refs/heads/main').stdout.trim();
    expect(push.args.slice(-3)).toEqual(['--', 'origin', `${head}:refs/heads/main`]);
    expect(c.lines).toContain(`branch: main at ${head.slice(0, 12)} (this exact commit is pushed to refs/heads/main)`);
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
    // Aegis L3: an explicit lease on the kernel-read tracking sha; none fetched here, so the remote must not have the branch
    expect(r.calls.filter((x) => x.args.includes('push')).at(-1)!.args).toContain('--force-with-lease=refs/heads/main:');
    expect((f.lines as string[]).some((l) => l.startsWith('lease: only if the remote has no main'))).toBe(true);
    r.set.url = ['https://githuh.com/o/r.git'];
    await r.verbs.call('gnomon_git_push', {}, sess(w));
    const l = r.raised.at(-1)!;
    expect(l.flags).toEqual(['claim-mismatch']);
    expect(l.decisions).toEqual(['allow', 'deny']);
    expect((l.lines as string[])[0]).toMatch(/^Warning: the host githuh\.com looks like github\.com/);
  });
  it('Aegis M5: a secret in the pushed commits always raises a card naming the file and kind, even with an Always rule; denial is secret-in-push', async () => {
    const w = world();
    committed(w.repo);
    fs.writeFileSync(path.join(w.repo, 'deploy.env'), 'GITHUB_TOKEN=ghp_' + 'a'.repeat(36) + '\n');
    git(w.repo, 'add', 'deploy.env');
    git(w.repo, 'commit', '-qm', 'oops');
    const r = rig(w);
    r.set.url = ['https://github.com/o/r.git'];
    r.set.rule = { ruleId: 'card:01JAAAAAAAAAAAAAAAAAAAAAAA' };
    r.set.decision = 'deny';
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).why).toBe('secret-in-push');
    expect(r.autos).toHaveLength(0);
    const c = r.raised[0]!;
    expect(c.decisions).toEqual(['allow', 'deny']);
    expect((c.lines as string[]).filter((l) => l.startsWith('  secret: '))).toEqual(['  secret: deploy.env (github-token)']);
    expect(JSON.stringify(c)).not.toContain('a'.repeat(36));
  });
  it('Aegis L5: at most MAX_VERB_CALLS_PER_SESSION calls in flight per session; L6: gh api user has its own lookup row', async () => {
    const w = world();
    committed(w.repo, null);
    const r = rig(w, { gh: (args) => (args[0] === 'api' ? { code: 0, stdout: 'me\n', stderr: '' } : { code: 0, stdout: '', stderr: '' }), realRemote: true });
    let release: (v: string) => void = () => undefined;
    const held = new Promise<string>((res) => (release = res));
    const slow = new GitVerbs({ log: async () => undefined, broker: { raise: async () => ({ cardId: 'card:01JAAAAAAAAAAAAAAAAAAAAAAA' }), decisionOf: () => held, auto: async () => undefined, expire: async () => true } as never, gnomonHome: w.gnomonHome, userHome: () => w.userHome });
    const pending = [1, 2, 3, 4].map(() => slow.call('gnomon_git_init', {}, sess(w, { cwd: w.root })));
    const fifth = await slow.call('gnomon_git_init', {}, sess(w, { cwd: w.root }));
    expect(fifth.why).toBe('busy');
    release('deny');
    await Promise.all(pending);
    await r.verbs.call('gnomon_repo_create', { name: 'x' }, sess(w));
    expect(phases(r).slice(0, 2)).toEqual(['requested', 'lookup']);
    expect(r.rows[1]).toMatchObject({ phase: 'lookup', host: 'github.com' });
  });
  it('Aegis M2: worktree verbs refuse a session whose profile has no worktree denies', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w);
    expect((await r.verbs.call('gnomon_worktree_add', { name: 'x' }, sess(w, { worktreesGuarded: false }))).why).toBe('unguarded');
  });
  it('Mika: a learned push rule reads in plain words from its kernel-held input (the slug rides the rule)', () => {
    const input = pushRuleInput(parseRemote('https://github.com/ascend42/a-platform-fighter.git') as never);
    expect(input.slug).toBe('github.com/ascend42/a-platform-fighter');
    expect(pushRuleWords(input)).toBe('pushes to github.com/ascend42/a-platform-fighter from this repo (any branch, never a force push)');
    expect(pushRuleWords({ verb: 'git.init' })).toBeNull();
  });
  it('Aegis round 2 M3: the scan never trusts refs/remotes (a session-written tracking ref hides nothing); the kernel record then narrows it', async () => {
    const w = world();
    committed(w.repo);
    fs.writeFileSync(path.join(w.repo, 'k.env'), 'AWS_SECRET_ACCESS_KEY=' + 'A'.repeat(40) + '\n');
    git(w.repo, 'add', 'k.env');
    git(w.repo, 'commit', '-qm', 'secret');
    // the session could plant this tracking ref at HEAD to hide the secret commit from a --remotes based scan
    git(w.repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const r = rig(w);
    r.set.url = ['https://github.com/o/r.git'];
    r.set.decision = 'allow';
    // ls-remote (the exec seam answers it with nothing): no exclusion, the whole branch is scanned, the hit is shown
    await r.verbs.call('gnomon_git_push', {}, sess(w));
    expect((r.raised[0]!.lines as string[]).filter((l) => l.startsWith('  secret: '))).toEqual(['  secret: k.env (aws-secret)']);
    expect(phases(r)).toContain('lookup');
    // pushed: the kernel's own record is the next exclusion, so a later clean commit raises no secret card
    fs.writeFileSync(path.join(w.repo, 'b.txt'), 'b\n');
    git(w.repo, 'add', 'b.txt');
    git(w.repo, 'commit', '-qm', 'clean');
    await r.verbs.call('gnomon_git_push', {}, sess(w));
    expect((r.raised[1]!.lines as string[]).some((l) => l.startsWith('  secret: '))).toBe(false);
  });
  it('Aegis round 2 M4: a worktree is added at the base sha read once (the steering diff ran on the same sha)', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w);
    const sha = git(w.repo, 'rev-parse', 'HEAD').stdout.trim();
    expect((await r.verbs.call('gnomon_worktree_add', { name: 'wt9' }, sess(w, { mode: 'auto-edits' }))).ok).toBe(true);
    const add = r.calls.find((x) => x.args.includes('worktree') && x.args.includes('add'))!;
    expect(add.args.at(-1)).toBe(sha);
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
  it('Aegis H1: the push runs under the kernel config snapshot (credential + ssh only), the common dir pinned, no system config', async () => {
    const w = world();
    committed(w.repo);
    fs.writeFileSync(path.join(w.userHome, '.gitconfig'), '[core]\n\thooksPath = /tmp/evil\n\tfsmonitor = /tmp/evil\n[url "https://evil.example/"]\n\tinsteadOf = https://github.com/\n[credential]\n\thelper = store\n[include]\n\tpath = /tmp/evil.inc\n');
    fs.mkdirSync(path.join(w.userHome, '.ssh'));
    fs.writeFileSync(path.join(w.userHome, '.ssh', 'config'), 'Host github.com\n\tUser git\n');
    const r = rig(w);
    r.set.url = ['https://github.com/o/r.git'];
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).ok).toBe(true);
    const push = r.calls.find((x) => x.args.includes('push'))!;
    const snap = path.join(w.gnomonHome, 'git-verbs', 'gitconfig');
    expect(push.env).toMatchObject({ GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: snap, GIT_COMMON_DIR: path.join(w.repo, '.git') });
    const keys = git(w.root, 'config', '--file', snap, '--list', '--name-only').stdout.split('\n').filter(Boolean);
    expect(keys.every((k) => /^credential\.|^core\.sshcommand$/.test(k)), keys.join(',')).toBe(true);
    expect(keys).toContain('credential.helper');
    expect(git(w.root, 'config', '--file', snap, 'core.sshCommand').stdout.trim()).toBe(`ssh -F '${path.join(w.gnomonHome, 'git-verbs', 'ssh_config')}'`);
    expect(fs.readFileSync(path.join(w.gnomonHome, 'git-verbs', 'ssh_config'), 'utf8')).toContain('Host github.com');
  });
  it('Aegis round 2 L2: a credential helper (or its config file) where the session can write refuses the push; the card names the snapshot hash', async () => {
    const w = world();
    committed(w.repo);
    const helper = path.join(w.repo, 'tools', 'git-credential-evil');
    fs.mkdirSync(path.dirname(helper));
    fs.writeFileSync(helper, '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(w.userHome, '.gitconfig'), `[credential]\n\thelper = ${helper}\n`);
    const r = rig(w);
    r.set.url = ['https://github.com/o/r.git'];
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).why).toBe('unsafe-config');
    fs.writeFileSync(path.join(w.userHome, '.gitconfig'), '[credential]\n\thelper = osxkeychain\n');
    await r.verbs.refreshPushConfig();
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).ok).toBe(true);
    expect(String((r.raised.at(-1)!.detail as Record<string, unknown>).pushConfigHash)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it('Aegis M3: remotes defined outside .git/config refuse; the remote must be named in .git/config', async () => {
    const w = world();
    committed(w.repo, null);
    const r = rig(w);
    r.set.url = ['https://github.com/o/r.git'];
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).why).toBe('no-remote');
    git(w.repo, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
    fs.mkdirSync(path.join(w.repo, '.git', 'remotes'));
    fs.writeFileSync(path.join(w.repo, '.git', 'remotes', 'origin'), 'URL: https://evil.example/o/r.git\n');
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w))).why).toBe('unsafe-config');
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
    for (const h of ['githuh.com', 'gihtub.com', 'github.com.evil.io', 'github-com.io', 'xn--gthub-cta.com', 'gitlab.co', 'gíthub.com', 'github.evil.io', 'a.gitlab.example']) expect(hostWarning(h), h).not.toBeNull();
    for (const h of ['github.com', 'gitlab.com', 'codeberg.org', 'api.github.com', 'git.example.org']) expect(hostWarning(h), h).toBeNull();
    expect((parseRemote('https://gíthub.com/o/r') as { host: string }).host).toBe('gíthub.com');
  });
  it('every network call is pinned to the resolved remote: only https/ssh, no redirects, no submodules', () => {
    expect(PUSH_GIT_FLAGS.join(' ')).toMatch(/protocol\.allow=never.*protocol\.https\.allow=always.*protocol\.ssh\.allow=always.*http\.followRedirects=false.*push\.recurseSubmodules=no/);
    const env = networkEnv({ userHome: '/u', toolDir: '/opt/homebrew/bin', from: { GH_TOKEN: 'x', GITHUB_TOKEN: 'x', HTTPS_PROXY: 'x', GIT_SSH_COMMAND: 'x', SSH_AUTH_SOCK: '/s', USER: 'me' } });
    for (const k of NEVER_VERB_ENV) expect(env[k]).toBeUndefined();
    expect(env).toMatchObject({ HOME: '/u', SSH_AUTH_SOCK: '/s', USER: 'me', GIT_ALLOW_PROTOCOL: 'https:ssh' });
  });
  it('Aegis M4: gh only from fixed locations, root-owned or under a trusted install prefix, never group/world-writable', () => {
    expect(GH_LOCATIONS).toEqual(['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']);
    expect(trustedToolPath('/opt/homebrew/Cellar/gh/2.80.0/bin/gh', { uid: 501, mode: 0o100755 })).toBe(true);
    expect(trustedToolPath('/Users/me/.local/bin/gh', { uid: 501, mode: 0o100755 })).toBe(false);
    expect(trustedToolPath('/Users/me/bin/gh', { uid: 0, mode: 0o100755 })).toBe(true);
    expect(trustedToolPath('/opt/homebrew/bin/gh', { uid: 501, mode: 0o100777 })).toBe(false);
  });
  it('Aegis L2: the trace redaction covers every GitHub token prefix (gho_, ghu_, ghs_, ghr_, ghp_)', () => {
    for (const p of ['gho', 'ghu', 'ghs', 'ghr', 'ghp']) expect(redactText(`x ${p}_${'b'.repeat(30)} y`).text, p).toBe('x [redacted:github-token] y');
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
    committed(w.repo, null);
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
    // a sha refspec sets no upstream: the kernel tracks the new remote branch itself
    expect(r.calls.some((x) => x.args.includes('--set-upstream-to=origin/main'))).toBe(true);
  });
  it('public is explicit and irreversible-flagged; an existing remote, gh signed out and a bad name refuse', async () => {
    const w = world();
    committed(w.repo, null);
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
  it('Aegis M1: a base whose steering files differ from HEAD raises the card even under auto-edits, naming them; the set hash rides the input', async () => {
    const w = world();
    committed(w.repo);
    git(w.repo, 'checkout', '-q', '-b', 'other');
    fs.mkdirSync(path.join(w.repo, 'sub', '.Claude'), { recursive: true });
    fs.writeFileSync(path.join(w.repo, 'sub', '.Claude', 'settings.json'), '{"hooks":{}}\n');
    fs.writeFileSync(path.join(w.repo, 'Claude.local.md'), 'do bad things\n');
    fs.writeFileSync(path.join(w.repo, 'notes.md'), 'fine\n');
    git(w.repo, 'add', '-A');
    git(w.repo, 'commit', '-qm', 'steer');
    git(w.repo, 'checkout', '-q', 'main');
    const r = rig(w);
    r.set.decision = 'deny';
    expect((await r.verbs.call('gnomon_worktree_add', { name: 'wt3', base: 'other' }, sess(w, { mode: 'auto-edits' }))).why).toBe('denied');
    const c = r.raised[0]!;
    expect((c.lines as string[]).filter((l) => l.startsWith('  steering: '))).toEqual(['  steering: Claude.local.md', '  steering: sub/.Claude/settings.json']);
    expect((c.toolInput as { steeringHash?: string }).steeringHash).toMatch(/^sha256:/);
    expect(r.autos).toHaveLength(0);
    // the same base as HEAD: no difference, auto-edits runs with no card
    r.set.decision = 'allow';
    expect((await r.verbs.call('gnomon_worktree_add', { name: 'wt4' }, sess(w, { mode: 'auto-edits' }))).ok).toBe(true);
    expect(r.raised).toHaveLength(1);
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

describe('git.verb rows (contracts, 8.0:git-verbs)', () => {
  it('are closed: no URL, path or output field; why only on refused/failed; host a DNS name', () => {
    const ok = { hsid: 'hsid:v1:01JAAAAAAAAAAAAAAAAAAAAAAA', verb: 'git.push', phase: 'refused', inputHash: `sha256:${'a'.repeat(64)}`, why: 'denied', host: 'github.com' };
    expect(validateKindPayload('git.verb', ok)).toEqual([]);
    expect(validateKindPayload('git.verb', { ...ok, url: 'https://x' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('git.verb', { ...ok, host: 'https://github.com/o/r' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('git.verb', { ...ok, phase: 'ran' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('git.verb', { ...ok, why: 'because' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('git.verb', { ...ok, phase: 'failed', why: 'command-failed', exitCode: 128 })).toEqual([]);
  });
});

describe('push config capture and close() (daemon shutdown)', () => {
  it('close() resolves only once a capture in flight has written its snapshot; after close no capture starts', async () => {
    const w = world();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[][] = [];
    const exec: Exec = async (bin, args, x) => {
      calls.push([...args]);
      if (calls.length === 1) await gate; // hold the first git call: the capture is in flight
      return execTool(bin, args, x);
    };
    const verbs = new GitVerbs({ log: async () => undefined, gnomonHome: w.gnomonHome, userHome: () => w.userHome, exec, env: () => ({ PATH: ENV.PATH }) });
    const capture = verbs.refreshPushConfig();
    let closed = false;
    const closing = verbs.close().then(() => (closed = true));
    await new Promise((r) => setImmediate(r));
    expect(closed).toBe(false); // still waiting on the held capture
    release();
    await closing;
    expect(fs.existsSync(path.join(w.gnomonHome, 'git-verbs', 'gitconfig'))).toBe(true);
    expect(fs.readdirSync(path.join(w.gnomonHome, 'git-verbs')).filter((e) => e.startsWith('gitconfig.'))).toEqual([]);
    const snap = await capture;
    const n = calls.length;
    expect(await verbs.refreshPushConfig()).toBe(snap); // closed: the snapshot it has, no new capture
    expect(calls.length).toBe(n);
  });
});

describe('Aegis M2: no git verbs on win32 (where the refusal lives: SessionSupervisor\'s constructor, supervisor.ts #gitVerbs)', () => {
  it('a win32 supervisor serves no kernel verbs; darwin does', async () => {
    const { SessionSupervisor } = await import('../src/kernel/supervisor/supervisor.js');
    const w = world();
    const verbs = new GitVerbs({ log: async () => undefined, gnomonHome: w.gnomonHome, userHome: () => w.userHome });
    const base = { log: async () => undefined, children: { intend: async () => undefined, track: () => undefined, stop: async () => undefined }, fuse: {} as never, home: w.gnomonHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.gnomonHome, 's.sock'), gitVerbs: verbs } as never;
    expect(new SessionSupervisor({ ...(base as object), platform: 'win32' } as never).kernelVerbsServed()).toBe(false);
    expect(new SessionSupervisor({ ...(base as object), platform: 'darwin' } as never).kernelVerbsServed()).toBe(true);
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
  it('probe p-kernel-mcp-sdk (claude 2.1.309, probes/results/p-kernel-mcp-sdk.darwin.json): the real lines parse and are answered', async () => {
    const w = world();
    const r = rig(w);
    const s = () => sess(w, { mode: 'auto-edits' });
    // verbatim from the probe transcript: initialize (id 0, jsonrpc after method), the id-less notification, tools/call with _meta
    const lines = [
      '{"type":"control_request","request_id":"8c65f84a-4368-4576-a4ad-b999ca44b440","request":{"subtype":"mcp_message","server_name":"gnomon","message":{"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"claude-code","title":"Claude Code","description":"Anthropic\'s agentic coding tool","websiteUrl":"https://claude.com/claude-code","version":"2.1.309"}},"jsonrpc":"2.0","id":0}}}',
      '{"type":"control_request","request_id":"fb56e912-6a9b-41fb-a549-43d56ebfe308","request":{"subtype":"mcp_message","server_name":"gnomon","message":{"jsonrpc":"2.0","method":"notifications/initialized"}}}',
      '{"type":"control_request","request_id":"a089ac91-a0bc-4344-b05e-f932f4fa23f9","request":{"subtype":"mcp_message","server_name":"gnomon","message":{"method":"tools/list","jsonrpc":"2.0","id":1}}}',
      '{"type":"control_request","request_id":"853a80d5-3c73-499f-b088-b9817834e75e","request":{"subtype":"mcp_message","server_name":"gnomon","message":{"method":"tools/call","params":{"name":"gnomon_git_init","arguments":{},"_meta":{"claudecode/toolUseId":"toolu_016zcHf8GnnQ6RBGJewUJYcA","progressToken":2}},"jsonrpc":"2.0","id":2}}}',
    ];
    const answers = [];
    for (const l of lines) {
      const ev = parseStreamLine(l);
      expect(ev.kind).toBe('mcp-message');
      answers.push(await kernelMcpAnswer((ev as { message: unknown }).message, r.verbs, s));
    }
    expect(answers[0]).toMatchObject({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} } } });
    expect(answers[1]).toEqual({ jsonrpc: '2.0', id: 0, result: {} });
    expect(answers[2]).toMatchObject({ id: 1 });
    expect(answers[3]).toMatchObject({ id: 2, result: { isError: false } });
  });
  it('the adapter reads an mcp_message control request and writes the SDK answer shape', () => {
    const ev = parseStreamLine(JSON.stringify({ type: 'control_request', request_id: 'r-1', request: { subtype: 'mcp_message', server_name: 'gnomon', message: { jsonrpc: '2.0', id: 1, method: 'tools/list' } } }));
    expect(ev).toMatchObject({ kind: 'mcp-message', requestId: 'r-1', serverName: 'gnomon' });
    expect(JSON.parse(mcpResponseLine('r-1', { jsonrpc: '2.0', id: 1, result: {} }))).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: 'r-1', response: { mcp_response: { jsonrpc: '2.0', id: 1, result: {} } } } });
    expect(parseStreamLine(JSON.stringify({ type: 'control_request', request_id: 'bad id!', request: { subtype: 'mcp_message', server_name: 'gnomon' } })).kind).toBe('control-request-unknown');
  });
});

describe('slice C1 (#local-tool-broker, Aegis H1/M2): a local session\'s brokered verb honours its abort and deadline', () => {
  /** A GitVerbs whose card waits for the test; records raises and expiries. */
  function held(w: ReturnType<typeof world>) {
    const raised: Array<Record<string, unknown>> = [];
    const expired: string[] = [];
    const rows: Array<Record<string, unknown>> = [];
    let decide: (d: string) => void = () => undefined;
    const decision = new Promise<string>((res) => (decide = res));
    const verbs = new GitVerbs({
      log: async (kind, payload) => void rows.push({ kind, ...payload }),
      broker: { raise: async (i: Record<string, unknown>) => (raised.push(i), { cardId: `card:01JAAAAAAAAAAAAAAAAAAAAAA${raised.length}` }), decisionOf: () => decision, auto: async () => undefined, expire: async (id: string) => (expired.push(id), true) } as never,
      gnomonHome: w.gnomonHome,
      userHome: () => w.userHome,
    });
    return { verbs, raised, expired, rows, decide };
  }
  const until = async (f: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
  };

  it('an abort while the verb card is open expires the card and runs nothing', async () => {
    const w = world();
    const h = held(w);
    const ctl = new AbortController();
    const p = h.verbs.call('gnomon_git_init', {}, sess(w, { local: true, signal: ctl.signal }));
    await until(() => h.raised.length === 1);
    ctl.abort();
    expect((await p).why).toBe('cancelled');
    h.decide('allow');
    expect(h.expired).toEqual(['card:01JAAAAAAAAAAAAAAAAAAAAAA1']);
    expect(fs.existsSync(path.join(w.repo, '.git'))).toBe(false);
    // the caller is answered at once; the run's own refusal row follows
    await until(() => h.rows.some((r) => r.why === 'cancelled'));
    expect(h.rows.at(-1)).toMatchObject({ phase: 'refused', why: 'cancelled' });
  });

  it('the deadline: the card lives no longer than the call, then expires; nothing runs', async () => {
    const w = world();
    const h = held(w);
    const res = await h.verbs.call('gnomon_git_init', {}, sess(w, { local: true, deadline: Date.now() + 150 }));
    expect(res.why).toBe('cancelled');
    expect(h.raised[0]!.timeoutMs).toBeLessThanOrEqual(1000);
    await until(() => h.expired.length === 1);
    expect(h.expired).toHaveLength(1);
    expect(fs.existsSync(path.join(w.repo, '.git'))).toBe(false);
  });

  it('an abort during the queue wait (another verb holds the repo) answers at once; the queued run refuses and raises no card', async () => {
    const w = world();
    const h = held(w);
    const first = h.verbs.call('gnomon_git_init', {}, sess(w));
    await until(() => h.raised.length === 1);
    const ctl = new AbortController();
    const second = h.verbs.call('gnomon_git_init', {}, sess(w, { hsid: 'hsid:v1:01JBBBBBBBBBBBBBBBBBBBBBBB', local: true, signal: ctl.signal }));
    ctl.abort();
    expect((await second).why).toBe('cancelled');
    h.decide('deny');
    await first;
    await until(() => h.rows.filter((r) => r.why === 'cancelled').length === 1);
    expect(h.rows.filter((r) => r.why === 'cancelled')).toHaveLength(1);
    expect(h.raised).toHaveLength(1);
  });

  it('a local session gets ONE card per verb: no Always offered, no Always rule, no auto pass', async () => {
    const w = world();
    committed(w.repo);
    const r = rig(w);
    r.set.url = ['https://github.com/o/r.git'];
    r.set.rule = { ruleId: 'rule:01JAAAAAAAAAAAAAAAAAAAAAAA' };
    expect((await r.verbs.call('gnomon_git_push', {}, sess(w, { local: true }))).ok).toBe(true);
    expect(r.raised).toHaveLength(1);
    expect(r.raised[0]!.decisions).not.toContain('always');
    expect(r.raised[0]).not.toHaveProperty('ruleScope');
    expect(r.autos).toEqual([]);
    const w2 = world();
    const r2 = rig(w2);
    expect((await r2.verbs.call('gnomon_git_init', {}, sess(w2, { local: true, mode: 'auto-edits' }))).ok).toBe(true);
    expect(r2.raised).toHaveLength(1);
    expect(r2.autos).toEqual([]);
  });

  it('Aegis M2: closeSession refuses later verbs, and an allow that lands after it runs nothing', async () => {
    const w = world();
    const h = held(w);
    const p = h.verbs.call('gnomon_git_init', {}, sess(w));
    await until(() => h.raised.length === 1);
    await h.verbs.closeSession('hsid:v1:01JAAAAAAAAAAAAAAAAAAAAAAA');
    h.decide('allow');
    expect((await p).why).toBe('cancelled');
    expect(fs.existsSync(path.join(w.repo, '.git'))).toBe(false);
    expect((await h.verbs.call('gnomon_git_init', {}, sess(w))).why).toBe('cancelled');
    expect(h.raised).toHaveLength(1);
  });
});
