/**
 * @symbol #git-verbs
 * @symbol ^git-init-gate
 * @symbol ^git-push-gate
 *
 * #git-verbs (T-2026-10-23-002; spec §6.6): the kernel runs `git init`, `git push` and `gh repo create` for a session,
 * OUTSIDE its sandbox, after its own checks and the human's card. A session reaches them through the kernel's own MCP
 * server (supervisor/kernel-mcp.ts: gnomon_git_init, gnomon_git_push, gnomon_repo_create).
 *
 * Every call writes `git.verb{phase:'requested'}` before any card or effect, then exactly one of `refused{why}`,
 * `ran` or `failed{why, exitCode?}`. Rows carry ids, closed values and the kernel-resolved host only: never a URL, a
 * path, a token or command output (credential exposure). The agent gets a short, redacted result text.
 *
 * ^git-init-gate — git.init runs under the session's run mode like an edit: `manual` refuses until a plan is approved,
 *   `auto-edits` runs it with an approval.auto{modeRef:'mode:auto-edits'} row (log before effect: no row, no run;
 *   the request falls back to the card), `ask` raises a permission card (allow / deny). The folder is re-checked after
 *   the decision (a `.git` planted meanwhile refuses). The repo is made with `git init --template= --initial-branch=main`
 *   under the hardened env (no global or system config), then its config is REWRITTEN to initConfigText (core keys
 *   only) and read back, and an empty hooks folder is made.
 * ^git-push-gate — git.push and repo.create are ALWAYS attended: a permission card the kernel composes from its own
 *   reading of the repo (the remote URL git resolves with the same env and flags the push uses, the host shown plainly,
 *   a lookalike or punycode host flagged claim-mismatch with no Always). git.push honours Always rules through the
 *   RuleBook: the rule's tool_input is pushRuleInput (verb, host, owner, repo, exact url), so "Always: push to
 *   github.com/o/r" matches only that URL from that repo (repoKey), any branch, never a force push; a flagged host or a
 *   force push never matches nor offers one. A force push needs `force: true` and is its own card (irreversible flag,
 *   fresh presence, a warning line, --force-with-lease). After the decision the remote and branch are re-read; a change
 *   refuses remote-changed. repo.create offers no Always; a public repo takes the irreversible flag.
 *   Never tags (--no-follow-tags), never a mirror, no hooks, only https/ssh, no redirects.
 * Loop sessions never run a verb (loop-session). One verb at a time per repo root (queued).
 * Slice C1 (#local-tool-broker, Aegis H1/M2): a LOCAL session's verb call (VerbSession.local, from the kernel-brokered
 * path) carries the brokered call's AbortSignal and deadline: the queue wait, the card (timeoutMs = deadline - now; an
 * abort expires it) and the moment right before the effect all honour them (refused `cancelled`); Always rules and
 * auto-edits never apply to a local session (one card per verb, always). closeSession marks the hsid closed: a closed
 * session's verbs are refused before any card and again after the decision.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GitVerb, GitVerbReason, RunMode } from '@a-company/gnomon-contracts';
import type { ApprovalBroker } from '../broker/broker.js';
import { wrappedBlock } from '../manifest/install.js';
import { inputHash } from '../supervisor/permission.js';
import { HARDENED_GIT_FLAGS } from './scratch.js';
import { scanSecrets } from '../loops/secret-scan.js';
import { capturePushConfig, snapshotWritableBy, type PushConfigSnapshot, EXEC_OUTPUT_CAP, execTool, ghPath, gitPath, localGitEnv, networkEnv, PUSH_GIT_FLAGS, redactOutput, VERB_TIMEOUTS, type Exec } from './verb-exec.js';
import {
  configProblems, createCard, dotGitOf, GIT_VERB_TOOLS, hostWarning, INIT_BRANCH, initCard, initConfigText, initRefusal, parseRemote, pushCard, pushRuleInput,
  readConfigEntries, validBranch, validOwner, validRemoteName, validRepoName, kernelWorktreeDirs, isSteeringPath, validWorktreeName, worktreeCard, WORKTREES_REL, type RemoteInfo, type VerbCard,
} from './verbs.js';

export interface VerbSession {
  hsid: string;
  /** the session principal (the card's requestedBy) */
  principalId: string;
  cwd: string;
  worktree?: string;
  repoKey: string;
  /** the session's EFFECTIVE run mode at this call */
  mode: RunMode;
  planApproved: boolean;
  /** a loop session (^loop-origin-clamp): never runs a verb */
  loop: boolean;
  /** Aegis M2: this session's profile carries the kernel-worktree denies (darwin kernelWorktrees); else no worktree verb */
  worktreesGuarded: boolean;
  /** slice C1 (Aegis H1): a local-model session's brokered call: no Always rule, no auto pass, always the verb's card */
  local?: true;
  /** slice C1 (Aegis H1): the brokered call's cancel signal (abort, tool_cancel, the session's stop) */
  signal?: AbortSignal;
  /** slice C1 (Aegis H1): the brokered call's deadline (epoch ms); the card expires at it, nothing runs after it */
  deadline?: number;
  /** slice C1 (Aegis N4): called once, right before the effect starts (the broker tells the child the call is running) */
  onEffect?: () => void;
}

/** Aegis M2: hsids closeSession has closed (bounded; hsids are never reused). */
const CLOSED_CAP = 4096;

/** Aegis L5: verb calls one session may have in flight (queued or waiting on a card); past it, refused busy. */
export const MAX_VERB_CALLS_PER_SESSION = 4;

export interface VerbResult {
  ok: boolean;
  text: string;
  why?: GitVerbReason;
  /** slice C1 (Aegis N2): the card this call raised, if any (kernel-mcp passes it in _meta) */
  cardId?: string;
}

export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const GIT_VERB_TOOL_SPECS: readonly McpToolSpec[] = Object.freeze([
  {
    name: 'gnomon_git_init',
    description: 'Make this session\'s folder a new git repo (branch main, a minimal config, no hooks). Gnomon runs git init outside the sandbox; plain `git init` in Bash is refused by the sandbox. Refused when the folder is already in a repo, or is the home or a system folder.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'gnomon_git_push',
    description: 'Push the current branch of this session\'s repo to a configured remote with the human\'s own git credentials. The human approves a card that shows the exact remote URL and host. Never pushes tags. A force push needs force: true and its own card.',
    inputSchema: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: 'remote name (default origin)' },
        branch: { type: 'string', description: 'local branch to push (default: the current branch)' },
        force: { type: 'boolean', description: 'force push with lease (default false; its own card with a warning)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'gnomon_repo_create',
    description: 'Create a GitHub repo with the human\'s gh sign-in (private unless visibility is public), add it as a remote and push the current branch. The human approves one card.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'the new repo name (letters, digits, . _ -)' },
        owner: { type: 'string', description: 'user or organisation (default: the signed-in gh user)' },
        visibility: { type: 'string', enum: ['private', 'public'], description: 'default private' },
        remote: { type: 'string', description: 'remote name to add (default origin)' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'gnomon_worktree_add',
    description: 'Make a git worktree of this session\'s repo at .gnomon/worktrees/<name> on a new branch (Claude Code\'s own worktree isolation and `git worktree add` are refused by the sandbox). Returns its absolute path: edit there and point subagents at it.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'the worktree name (letters, digits, . _ -)' },
        branch: { type: 'string', description: 'the new branch (default worktree-<name>)' },
        base: { type: 'string', description: 'branch to start from (default the current HEAD)' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'gnomon_worktree_remove',
    description: 'Remove a worktree made with gnomon_worktree_add (its branch stays). git refuses when it has uncommitted changes unless force is true (its own card).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, force: { type: 'boolean' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
]);

type Broker = Pick<ApprovalBroker, 'raise'> & Partial<Pick<ApprovalBroker, 'decisionOf' | 'auto' | 'expire'>>;

export interface GitVerbsOptions {
  log: (kind: string, payload: Record<string, unknown>, ids?: { session?: string }) => Promise<void>;
  broker?: Broker;
  /** the RuleBook match (rules.ts), as SupervisorOptions.alwaysRule */
  alwaysRule?: (repoKey: string, tool: string, inputHash: string, toolInput?: unknown, ctx?: { prefixRules: boolean; roots: readonly string[] }) => { ruleId: string } | null;
  gnomonHome: string;
  userHome: () => string;
  /** TEST SEAMS: the runner, git and gh paths, the env the scrubbed env reads */
  exec?: Exec;
  git?: () => string | null;
  gh?: () => string | null;
  env?: () => Readonly<Record<string, string | undefined>>;
}

type Refused = { refused: GitVerbReason; text: string };
const isRefused = (v: unknown): v is Refused => typeof v === 'object' && v !== null && 'refused' in v;

interface RepoState {
  root: string;
  gitDir: string;
  branch: string;
  /** Aegis round 2 M3/M4: the branch's commit, read ONCE; it is what is scanned, shown and pushed (`<sha>:refs/heads/<branch>`) */
  sha: string;
}

const real = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};

export class GitVerbs {
  readonly #o: GitVerbsOptions;
  /** hsid → the verb cards it has pending (expired when the session ends) */
  readonly #cards = new Map<string, Set<string>>();
  /** one verb at a time per repo root */
  readonly #queue = new Map<string, Promise<unknown>>();

  /** Aegis H1: the kernel's push config snapshot (verb-exec.ts capturePushConfig); null until captured */
  #pushConfig: PushConfigSnapshot | null = null;
  /** captures in flight (each writes under <home>/git-verbs): close() waits for them, so none writes after the daemon stops */
  readonly #capturing = new Set<Promise<unknown>>();
  #closed = false;

  constructor(o: GitVerbsOptions) {
    this.#o = o;
  }

  /**
   * Aegis H1: (re)capture the push config snapshot from the human's credential and ssh settings (daemon start).
   * After close() no capture starts (the current snapshot, or null ⇒ GIT_CONFIG_GLOBAL=/dev/null, is returned).
   */
  async refreshPushConfig(): Promise<PushConfigSnapshot | null> {
    if (this.#closed) return this.#pushConfig;
    const git = (this.#o.git ?? gitPath)();
    if (!git) return null;
    const capture = capturePushConfig({ dir: path.join(this.#o.gnomonHome, 'git-verbs'), git, userHome: this.#o.userHome(), exec: this.#exec(), from: this.#env() });
    this.#capturing.add(capture);
    try {
      this.#pushConfig = await capture;
    } catch {
      this.#pushConfig = null;
    } finally {
      this.#capturing.delete(capture);
    }
    return this.#pushConfig;
  }

  /**
   * Daemon shutdown: no capture starts after this, and every capture in flight has settled (its files written or
   * failed) when it resolves. The daemon's start-up capture is fire-and-forget; without this it kept spawning git and
   * writing <home>/git-verbs/{gitconfig,ssh_config} after shutdown resolved and the daemon lock was released.
   */
  async close(): Promise<void> {
    this.#closed = true;
    await Promise.allSettled([...this.#capturing]);
  }

  /** The env of a network git/gh call: scrubbed, under the kernel's config snapshot, the common dir pinned to the repo's own. */
  async #netEnv(toolDir: string, commonDir?: string): Promise<Record<string, string>> {
    if (this.#pushConfig === null || !fs.existsSync(this.#pushConfig.path)) await this.refreshPushConfig();
    return networkEnv({ userHome: this.#o.userHome(), toolDir, from: this.#env(), gitConfig: this.#pushConfig?.path ?? null, ...(commonDir ? { commonDir } : {}) });
  }

  /** Aegis round 2 L2: the snapshot's programs and origins must not lie where this session can write. */
  async #snapshotRefusal(s: VerbSession): Promise<Refused | null> {
    if (this.#pushConfig === null || !fs.existsSync(this.#pushConfig.path)) await this.refreshPushConfig();
    const snap = this.#pushConfig;
    if (!snap) return null;
    const tmpBase = real(os.tmpdir());
    // what a session can write besides its roots: its Gnomon-made TMPDIR and cache (under these two) and the shared temp dirs
    const writable = [...this.#roots(s), path.join(tmpBase, 'gnomon-tmp'), path.join(tmpBase, 'gnomon-cache'), '/private/tmp', '/private/var/tmp', '/tmp'];
    const bad = snapshotWritableBy(snap, writable);
    return bad ? { refused: 'unsafe-config', text: `Your git credential or ssh settings run or include ${bad}, a path this session can write: Gnomon does not push with it. Move it, or push from your own terminal.` } : null;
  }

  tools(): readonly McpToolSpec[] {
    return GIT_VERB_TOOL_SPECS;
  }

  /** Run one kernel MCP tool call for a session. Never throws: every outcome is a VerbResult. */
  /** Aegis round 2 M3: the shas this kernel pushed, by `<gitDir>\0<remote>\0<branch>` (the scan's own exclusion record) */
  readonly #pushed = new Map<string, string>();

  /** Aegis L5: verb calls in flight per hsid */
  readonly #inflight = new Map<string, number>();

  /** slice C1 (Aegis M2): sessions that ended; their verbs are refused before any card and after the decision */
  readonly #closedSessions = new Set<string>();

  /** slice C1 (Aegis H1/M2): this call must stop now (aborted, past its deadline, or its session closed). */
  #cancelled(s: VerbSession): boolean {
    return this.#closedSessions.has(s.hsid) || s.signal?.aborted === true || (s.deadline !== undefined && Date.now() >= s.deadline);
  }

  #cancel(s: VerbSession, verb: GitVerb, hash: string, extra: { cardId?: string; host?: string } = {}): Promise<VerbResult> {
    return this.#refuse(s, verb, hash, 'cancelled', 'Cancelled: the request was aborted, ran past its deadline, or its session ended. Nothing was run.', extra);
  }

  async call(tool: string, args: unknown, s: VerbSession): Promise<VerbResult> {
    const verb = GIT_VERB_TOOLS[tool];
    if (!verb) return { ok: false, text: `unknown tool ${tool.slice(0, 64)}` };
    const n = this.#inflight.get(s.hsid) ?? 0;
    if (n >= MAX_VERB_CALLS_PER_SESSION) {
      const h = inputHash({ verb, busy: true });
      await this.#row(s, verb, 'requested', h);
      return this.#refuse(s, verb, h, 'busy', `This session already has ${n} git verbs in flight: wait for them.`);
    }
    this.#inflight.set(s.hsid, n + 1);
    // Aegis N1: the slot is released when the queued RUN settles (an abandoned wait still holds it), exactly once
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      const m = (this.#inflight.get(s.hsid) ?? 1) - 1;
      if (m <= 0) this.#inflight.delete(s.hsid);
      else this.#inflight.set(s.hsid, m);
    };
    // Aegis N2: the card this call raised rides on the result
    let card: string | undefined;
    const sc: VerbSession & { onCard?: (id: string) => void } = { ...s, onCard: (id) => void (card = id) };
    try {
      const r = await this.#queued(verb, args, sc, release);
      return card && !r.cardId ? { ...r, cardId: card } : r;
    } catch (e) {
      release();
      throw e;
    }
  }

  /** Aegis N5: a session (re)opened with this hsid (a resume in the same process) is no longer closed. */
  openSession(hsid: string): void {
    this.#closedSessions.delete(hsid);
  }

  async #queued(verb: GitVerb, args: unknown, s: VerbSession, settled: () => void = () => undefined): Promise<VerbResult> {
    const root = real(verb === 'git.init' ? s.cwd : (s.worktree ?? s.cwd));
    const prev = this.#queue.get(root) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => this.#run(verb, args, s, root));
    void run.then(settled, settled);
    if (s.signal || s.deadline !== undefined) {
      // slice C1 (Aegis H1): a brokered call waiting in the queue stops waiting on abort or at its deadline; the queued
      // run itself re-checks #cancelled first and refuses, so nothing runs late
      const stop = new Promise<VerbResult>((resolve) => {
        const done = (): void => resolve({ ok: false, why: 'cancelled', text: 'Cancelled while waiting for another git verb in this repo. Nothing was run.' });
        if (s.signal?.aborted) return done();
        s.signal?.addEventListener('abort', done, { once: true });
        if (s.deadline !== undefined) setTimeout(done, Math.max(0, s.deadline - Date.now())).unref?.();
      });
      this.#queue.set(root, run);
      void run.then(
        () => (this.#queue.get(root) === run ? void this.#queue.delete(root) : undefined),
        () => (this.#queue.get(root) === run ? void this.#queue.delete(root) : undefined),
      );
      return Promise.race([run, stop]);
    }
    this.#queue.set(root, run);
    try {
      return await run;
    } finally {
      if (this.#queue.get(root) === run) this.#queue.delete(root);
    }
  }

  /** The session ended: its pending verb cards expire into deny. */
  async closeSession(hsid: string): Promise<void> {
    // slice C1 (Aegis M2): later verbs of this hsid are refused, and so is any decision still in flight
    this.#closedSessions.add(hsid);
    while (this.#closedSessions.size > CLOSED_CAP) this.#closedSessions.delete(this.#closedSessions.values().next().value as string);
    const ids = [...(this.#cards.get(hsid) ?? [])];
    this.#cards.delete(hsid);
    for (const id of ids) await this.#o.broker?.expire?.(id, 'session-exited').catch(() => false);
  }

  async #run(verb: GitVerb, args: unknown, s: VerbSession, root: string): Promise<VerbResult> {
    const a = args !== null && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
    const reqHash = inputHash({ verb, root, args: a ?? args ?? null });
    await this.#row(s, verb, 'requested', reqHash);
    if (this.#cancelled(s)) return this.#cancel(s, verb, reqHash);
    try {
      switch (verb) {
        case 'git.init':
          return await this.#init(a, s, root, reqHash);
        case 'git.push':
          return await this.#push(a, s, root, reqHash);
        case 'repo.create':
          return await this.#create(a, s, root, reqHash);
        default:
          return await this.#worktree(verb, a, s, root, reqHash);
      }
    } catch (e) {
      // never unanswered: an unexpected fault is a failed verb (no detail in the row)
      await this.#row(s, verb, 'failed', reqHash, { why: 'command-failed' }).catch(() => undefined);
      return { ok: false, why: 'command-failed', text: `Gnomon could not run ${verb}: ${redactOutput(String((e as Error)?.message ?? e), 300)}` };
    }
  }

  async #row(s: VerbSession, verb: GitVerb, phase: 'requested' | 'refused' | 'ran' | 'failed' | 'lookup', hash: string, extra: { why?: GitVerbReason; cardId?: string; host?: string; exitCode?: number } = {}): Promise<void> {
    const host = extra.host !== undefined && /^[a-z0-9.-]{1,253}$/.test(extra.host) ? extra.host : undefined;
    await this.#o.log('git.verb', { hsid: s.hsid, verb, phase, inputHash: hash, ...(extra.why ? { why: extra.why } : {}), ...(extra.cardId ? { cardId: extra.cardId } : {}), ...(host ? { host } : {}), ...(extra.exitCode !== undefined ? { exitCode: Math.max(-1, Math.min(255, extra.exitCode)) } : {}) }, { session: s.hsid });
  }

  async #refuse(s: VerbSession, verb: GitVerb, hash: string, why: GitVerbReason, text: string, extra: { cardId?: string; host?: string } = {}): Promise<VerbResult> {
    await this.#row(s, verb, 'refused', hash, { why, ...extra });
    return { ok: false, why, text };
  }

  async #fail(s: VerbSession, verb: GitVerb, hash: string, why: GitVerbReason, text: string, extra: { cardId?: string; host?: string; exitCode?: number } = {}): Promise<VerbResult> {
    await this.#row(s, verb, 'failed', hash, { why, ...extra });
    return { ok: false, why, text };
  }

  #roots(s: VerbSession): string[] {
    return [real(s.cwd), ...(s.worktree ? [real(s.worktree)] : [])];
  }

  #exec(): Exec {
    return this.#o.exec ?? execTool;
  }

  #env(): Readonly<Record<string, string | undefined>> {
    return this.#o.env?.() ?? process.env;
  }

  /** The common refusals of every verb: a loop session; manual mode with no approved plan. */
  #sessionRefusal(s: VerbSession): Refused | null {
    if (s.loop) return { refused: 'loop-session', text: 'Loop sessions never run git verbs.' };
    if (s.mode === 'manual' && !s.planApproved) return { refused: 'mode-manual', text: 'This session is in manual mode: propose a plan with ExitPlanMode first; the human approves it.' };
    return null;
  }

  /** Raise the verb's card and wait for the human. 'none' = no approval surface. */
  async #decide(s: VerbSession, card: VerbCard, tool: string, toolInput: Record<string, unknown>, hash: string): Promise<{ decision: string; cardId: string | null }> {
    const b = this.#o.broker;
    if (!b || typeof b.decisionOf !== 'function') return { decision: 'none', cardId: null };
    const detail = { ...card.detail, inputHash: hash };
    const wb = wrappedBlock(card.lines).block as { children?: unknown[] };
    const block = { ...wb, children: [...(wb.children ?? []), { type: 'git-verb', detail: structuredClone(detail) }] };
    let cardId: string;
    try {
      // slice C1 (Aegis H1): a local session never learns an Always; its card lives no longer than the call's deadline
      const decisions = s.local ? card.decisions.filter((x) => x !== 'always') : [...card.decisions];
      const c = await b.raise({ kind: 'permission', requestedBy: s.principalId, hsid: s.hsid, attended: true, detail, lines: card.lines, block, ...(card.flags.length ? { flags: [...card.flags] } : {}), toolInput, tool, decisions, ...(decisions.includes('always') ? { ruleScope: { repoKey: s.repoKey } } : {}), ...(s.deadline !== undefined ? { timeoutMs: Math.max(1000, s.deadline - Date.now()) } : {}) });
      cardId = c.cardId;
      (s as VerbSession & { onCard?: (id: string) => void }).onCard?.(cardId);
    } catch {
      return { decision: 'none', cardId: null };
    }
    const set = this.#cards.get(s.hsid) ?? new Set<string>();
    set.add(cardId);
    this.#cards.set(s.hsid, set);
    try {
      if (this.#cancelled(s)) {
        await b.expire?.(cardId, 'cancelled').catch(() => false);
        return { decision: 'cancelled', cardId };
      }
      let onAbort: (() => void) | undefined;
      let timer: NodeJS.Timeout | undefined;
      const stop = new Promise<string>((resolve) => {
        onAbort = () => resolve('cancelled');
        s.signal?.addEventListener('abort', onAbort, { once: true });
        if (s.deadline !== undefined) {
          timer = setTimeout(onAbort, Math.max(0, s.deadline - Date.now()));
          timer.unref?.();
        }
      });
      let decision: string;
      try {
        decision = await Promise.race([b.decisionOf(cardId), stop]);
      } finally {
        if (onAbort) s.signal?.removeEventListener('abort', onAbort);
        clearTimeout(timer);
      }
      if (decision === 'cancelled') await b.expire?.(cardId, 'cancelled').catch(() => false);
      // re-checked after the decision (Aegis H1/M2): an allow that lands after an abort, the deadline or the session's end runs nothing
      if (this.#cancelled(s)) return { decision: 'cancelled', cardId };
      return { decision, cardId };
    } catch {
      return { decision: 'deny', cardId };
    } finally {
      set.delete(cardId);
      if (!set.size) this.#cards.delete(s.hsid);
    }
  }

  /* ── git.init ─────────────────────────────────────────────────────────── */

  async #init(a: Record<string, unknown> | null, s: VerbSession, root: string, hash: string): Promise<VerbResult> {
    const verb = 'git.init';
    if (!a || Object.keys(a).length) return this.#refuse(s, verb, hash, 'bad-input', 'gnomon_git_init takes no arguments: it makes this session\'s folder a repo.');
    const sr = this.#sessionRefusal(s);
    if (sr) return this.#refuse(s, verb, hash, sr.refused, sr.text);
    const ctx = { roots: this.#roots(s), userHome: real(this.#o.userHome()), gnomonHome: real(this.#o.gnomonHome) };
    const r0 = initRefusal(root, ctx);
    if (r0) return this.#refuse(s, verb, hash, r0.why, `Not made a repo: ${r0.detail}.`);
    const remnant = dotGitOf(root) === 'remnant';
    const toolInput = { verb, root };
    let cardId: string | undefined;
    let ran = false;
    const b = this.#o.broker;
    if (s.mode === 'auto-edits' && !s.local && b && typeof b.auto === 'function') {
      try {
        // log before effect: no approval.auto row, no auto-run (the card is raised instead)
        await b.auto({ hsid: s.hsid, tool: 'gnomon_git_init', path: root, inputHash: hash, modeRef: 'mode:auto-edits' });
        ran = true;
      } catch {
        ran = false;
      }
    }
    if (!ran) {
      const d = await this.#decide(s, initCard(root, remnant), 'gnomon_git_init', toolInput, hash);
      cardId = d.cardId ?? undefined;
      if (d.decision === 'none') return this.#refuse(s, verb, hash, 'no-approval-surface', 'No approval surface could take the card: not made a repo.');
      if (d.decision === 'cancelled') return this.#cancel(s, verb, hash, d.cardId ? { cardId: d.cardId } : {});
      if (d.decision !== 'allow') return this.#refuse(s, verb, hash, 'denied', 'The human did not approve making this folder a repo.', cardId ? { cardId } : {});
    }
    // TOCTOU: the folder is checked again after the decision (a .git planted meanwhile refuses)
    const r1 = initRefusal(root, ctx);
    if (r1) return this.#refuse(s, verb, hash, r1.why, `Not made a repo: ${r1.detail}.`, cardId ? { cardId } : {});
    const git = (this.#o.git ?? gitPath)();
    if (!git) return this.#fail(s, verb, hash, 'tool-missing', 'git is not installed where Gnomon looks for it.', cardId ? { cardId } : {});
    const gitDir = path.join(root, '.git');
    // Aegis re-check: the last cancel check comes before ANY change (the remnant removal included)
    if (this.#cancelled(s)) return this.#cancel(s, verb, hash, cardId ? { cardId } : {});
    if (dotGitOf(root) === 'remnant') fs.rmSync(gitDir, { recursive: true, force: true });
    else if (remnant) return this.#refuse(s, verb, hash, 'in-repo', 'The .git folder changed after the card: not made a repo.', cardId ? { cardId } : {});
    s.onEffect?.();
    const res = await this.#exec()(git, ['init', '--quiet', '--template=', `--initial-branch=${INIT_BRANCH}`, '--', root], { cwd: root, env: localGitEnv(this.#env()), timeoutMs: VERB_TIMEOUTS.init });
    if (res.timedOut) return this.#fail(s, verb, hash, 'timeout', 'git init ran too long and was stopped.', { ...(cardId ? { cardId } : {}), exitCode: -1 });
    if (res.code !== 0) return this.#fail(s, verb, hash, 'command-failed', `git init failed: ${redactOutput(res.stderr, 400)}`, { ...(cardId ? { cardId } : {}), exitCode: res.code });
    // the config the repo keeps is the kernel's: core keys only (filesystem probes kept as booleans), read back
    const st = fs.lstatSync(gitDir);
    if (st.isSymbolicLink() || !st.isDirectory()) return this.#fail(s, verb, hash, 'command-failed', 'git init did not leave a .git folder.', cardId ? { cardId } : {});
    const cfgPath = path.join(gitDir, 'config');
    const probed: Record<string, string> = {};
    for (const e of readConfigEntries(fs.readFileSync(cfgPath, 'utf8')) ?? []) if (e.key.startsWith('core.')) probed[e.key.slice(5)] = e.value;
    const text = initConfigText(probed);
    const tmp = path.join(gitDir, `config.gnomon-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmp, text, { mode: 0o644, flag: 'wx' });
    fs.renameSync(tmp, cfgPath);
    const hooks = path.join(gitDir, 'hooks');
    fs.mkdirSync(hooks, { recursive: true, mode: 0o755 });
    const ok = fs.readFileSync(cfgPath, 'utf8') === text && fs.readdirSync(hooks).length === 0 && fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim() === `ref: refs/heads/${INIT_BRANCH}`;
    if (!ok) return this.#fail(s, verb, hash, 'command-failed', 'The new repo did not read back as Gnomon wrote it.', cardId ? { cardId } : {});
    await this.#row(s, verb, 'ran', hash, cardId ? { cardId } : {});
    return { ok: true, text: `Made ${root} a git repo on branch ${INIT_BRANCH} (a minimal config, no hooks).${remnant ? ' An incomplete .git from a failed git init was removed first.' : ''} Commit as usual; use gnomon_repo_create or gnomon_git_push to publish.` };
  }

  /* ── reading the repo (push, create) ──────────────────────────────────── */

  async #repoState(root: string, branchArg: unknown): Promise<RepoState | Refused> {
    const g = dotGitOf(root);
    if (g === 'link' || g === 'file') return { refused: 'dotgit-link', text: `${root}/.git is ${g === 'link' ? 'a symlink' : 'a gitfile pointer (a linked worktree)'}: Gnomon pushes only from a repo whose .git is a real folder at the session root.` };
    if (g !== 'dir') return { refused: 'no-repo', text: `${root} is not a git repo: use gnomon_git_init first.` };
    const gitDir = path.join(root, '.git');
    if (fs.existsSync(path.join(gitDir, 'commondir'))) return { refused: 'unsafe-config', text: 'This .git reads its config from another folder (commondir): Gnomon does not push from it.' };
    // Aegis M3: legacy remote definitions git reads BESIDE the config (.git/remotes/<name>, .git/branches/<name>)
    for (const legacy of ['remotes', 'branches']) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(path.join(gitDir, legacy));
      } catch {
        entries = [];
      }
      if (entries.length) return { refused: 'unsafe-config', text: `This repo defines remotes outside its config (.git/${legacy}/${entries[0]!.slice(0, 64)}): Gnomon pushes only to remotes named in .git/config.` };
    }
    let cfg: fs.Stats;
    try {
      cfg = fs.lstatSync(path.join(gitDir, 'config'));
    } catch {
      return { refused: 'no-repo', text: 'This repo has no config.' };
    }
    if (!cfg.isFile()) return { refused: 'unsafe-config', text: 'The repo config is not a regular file.' };
    const bad = configProblems(fs.readFileSync(path.join(gitDir, 'config'), 'utf8'));
    if (bad.length) return { refused: 'unsafe-config', text: `The repo config has keys Gnomon does not push with (${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ', …' : ''}). The human can remove them, or push from their own terminal.` };
    let branch: string;
    if (branchArg !== undefined) {
      if (!validBranch(branchArg)) return { refused: 'bad-input', text: 'branch is not a plain branch name.' };
      branch = branchArg;
    } else {
      let head = '';
      try {
        const hs = fs.lstatSync(path.join(gitDir, 'HEAD'));
        if (!hs.isFile()) return { refused: 'no-branch', text: 'HEAD is not a regular file.' };
        head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
      } catch {
        return { refused: 'no-branch', text: 'This repo has no HEAD.' };
      }
      const m = /^ref: refs\/heads\/(.+)$/.exec(head);
      if (!m || !validBranch(m[1])) return { refused: 'no-branch', text: 'HEAD is detached (or names an unusual branch): check out a branch first.' };
      branch = m[1]!;
    }
    const git = (this.#o.git ?? gitPath)();
    if (!git) return { refused: 'tool-missing', text: 'git is not installed where Gnomon looks for it.' };
    const v = await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', gitDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`], { cwd: root, env: localGitEnv(this.#env()), timeoutMs: VERB_TIMEOUTS.read });
    const sha = v.stdout.trim();
    if (v.code !== 0 || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) return { refused: 'no-branch', text: `Branch ${branch} has no commits yet: commit first.` };
    return { root, gitDir, branch, sha };
  }

  /** The URL git itself resolves for a push to `remote` (same env and flags as the push), parsed. */
  async #resolveRemote(st: RepoState, remote: string): Promise<RemoteInfo | Refused> {
    const git = (this.#o.git ?? gitPath)();
    if (!git) return { refused: 'tool-missing', text: 'git is not installed where Gnomon looks for it.' };
    const r = await this.#exec()(git, [...PUSH_GIT_FLAGS, '--git-dir', st.gitDir, 'remote', 'get-url', '--push', '--', remote], { cwd: st.root, env: await this.#netEnv(path.dirname(git), st.gitDir), timeoutMs: VERB_TIMEOUTS.read });
    // Aegis M3: the remote must be named in the repo's own .git/config (never only a legacy remotes/branches file)
    const named = (readConfigEntries(fs.readFileSync(path.join(st.gitDir, 'config'), 'utf8')) ?? []).some((e) => e.key === `remote.${remote}.url`);
    if (r.code !== 0 || !named) return { refused: 'no-remote', text: `No remote named ${remote} in this repo's .git/config. Use gnomon_repo_create to create one on GitHub.` };
    const urls = r.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
    if (urls.length !== 1) return { refused: 'bad-remote', text: `Remote ${remote} has ${urls.length} push URLs: Gnomon pushes to exactly one.` };
    const info = parseRemote(urls[0]!);
    if ('error' in info) return { refused: 'bad-remote', text: `Not pushed: ${info.error}.` };
    return info;
  }

  /* ── git.push ─────────────────────────────────────────────────────────── */

  async #push(a: Record<string, unknown> | null, s: VerbSession, root: string, hash: string): Promise<VerbResult> {
    const verb = 'git.push';
    if (!a || Object.keys(a).some((k) => !['remote', 'branch', 'force'].includes(k))) return this.#refuse(s, verb, hash, 'bad-input', 'gnomon_git_push takes remote, branch and force only.');
    const remote = a.remote === undefined ? 'origin' : a.remote;
    if (!validRemoteName(remote)) return this.#refuse(s, verb, hash, 'bad-input', 'remote is not a plain remote name.');
    if (a.force !== undefined && typeof a.force !== 'boolean') return this.#refuse(s, verb, hash, 'bad-input', 'force must be true or false.');
    const force = a.force === true;
    const sr = this.#sessionRefusal(s);
    if (sr) return this.#refuse(s, verb, hash, sr.refused, sr.text);
    const st = await this.#repoState(root, a.branch);
    if (isRefused(st)) return this.#refuse(s, verb, hash, st.refused, st.text);
    const snapBad = await this.#snapshotRefusal(s);
    if (snapBad) return this.#refuse(s, verb, hash, snapBad.refused, snapBad.text);
    const info = await this.#resolveRemote(st, remote);
    if (isRefused(info)) return this.#refuse(s, verb, hash, info.refused, info.text);
    const warning = hostWarning(info.host);
    const rule = pushRuleInput(info);
    const ruleHash = inputHash(rule);
    // Aegis M5: the commits this push sends, scanned for secrets; a hit (or a diff too large to scan) always takes the card
    const scan = await this.#scanPush(s, hash, st, remote, info);
    // Aegis L3: a force push leases on the kernel-read remote-tracking sha (or on the remote having no such branch)
    const lease = force ? await this.#trackingSha(st, remote) : null;
    const b = this.#o.broker;
    let cardId: string | undefined;
    let viaRule = false;
    if (!force && !warning && !scan.secrets.length && !scan.incomplete && !s.local && b && typeof b.auto === 'function') {
      let m: { ruleId: string } | null = null;
      try {
        m = this.#o.alwaysRule?.(s.repoKey, 'gnomon_git_push', ruleHash, rule, { prefixRules: s.mode !== 'manual', roots: this.#roots(s) }) ?? null;
      } catch {
        m = null; // an unreadable rule source never allows
      }
      if (m) {
        try {
          await b.auto({ hsid: s.hsid, tool: 'gnomon_git_push', inputHash: ruleHash, modeRef: `rule:${m.ruleId}` });
          viaRule = true;
        } catch {
          viaRule = false;
        }
      }
    }
    if (!viaRule) {
      const card = pushCard({ root, branch: st.branch, sha: st.sha, remote, remoteInfo: info, force, warning, lease, secrets: scan.secrets, scanIncomplete: scan.incomplete });
      // Aegis round 2 L2: the card (inside its contentHash) names the credential-config snapshot the push runs under
      if (this.#pushConfig) card.detail.pushConfigHash = this.#pushConfig.hash;
      const d = await this.#decide(s, card, 'gnomon_git_push', rule, ruleHash);
      cardId = d.cardId ?? undefined;
      if (d.decision === 'none') return this.#refuse(s, verb, hash, 'no-approval-surface', 'No approval surface could take the card: not pushed.', { host: info.host });
      if (d.decision === 'cancelled') return this.#cancel(s, verb, hash, d.cardId ? { cardId: d.cardId } : {});
      if (d.decision !== 'allow' && d.decision !== 'always') return this.#refuse(s, verb, hash, scan.secrets.length ? 'secret-in-push' : 'denied', scan.secrets.length ? 'The human did not approve pushing commits that look like they hold a secret.' : 'The human did not approve this push.', { host: info.host, ...(cardId ? { cardId } : {}) });
    }
    return this.#doPush(s, verb, hash, { st, remote, info, force, lease, upstream: false, ...(cardId ? { cardId } : {}) }, a.branch);
  }

  /** Aegis M5: added lines of `<branch> --not --remotes=<remote>` scanned with #loop-check's scanSecrets (kinds only, per file). */
  /**
   * Aegis round 2 M3: the exclusion set is never a ref the session can write (refs/remotes/*): the kernel's own record of
   * the sha it last pushed for this (repo, remote, branch), else the remote's heads from `ls-remote` under the push env
   * (a `lookup` row), kept only when the object exists here; with neither, the WHOLE branch history is scanned.
   */
  async #scanPush(s: VerbSession, hash: string, st: RepoState, remote: string, info: RemoteInfo): Promise<{ secrets: Array<{ file: string; kinds: string[] }>; incomplete: boolean }> {
    const git = (this.#o.git ?? gitPath)()!;
    const local = { cwd: st.root, env: localGitEnv(this.#env()), timeoutMs: VERB_TIMEOUTS.read };
    let not: string[] = [];
    const mine = this.#pushed.get(`${st.gitDir}\0${remote}\0${st.branch}`);
    if (mine) not = [mine];
    else {
      await this.#row(s, 'git.push', 'lookup', hash, { host: info.host });
      const ls = await this.#exec()(git, [...PUSH_GIT_FLAGS, '--git-dir', st.gitDir, 'ls-remote', '--heads', '--', remote], { cwd: st.root, env: await this.#netEnv(path.dirname(git), st.gitDir), timeoutMs: VERB_TIMEOUTS.read });
      const shas = ls.code === 0 ? [...new Set(ls.stdout.split('\n').map((l) => l.split('\t')[0]!.trim()).filter((x) => /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(x)))] : [];
      for (const x of shas.slice(0, 256)) if ((await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', st.gitDir, 'cat-file', '-e', `${x}^{commit}`], local)).code === 0) not.push(x);
    }
    const r = await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', st.gitDir, 'log', '-p', '--no-color', '--no-ext-diff', '--no-textconv', '--format=', st.sha, ...(not.length ? ['--not', ...not] : [])], { ...local, timeoutMs: VERB_TIMEOUTS.push });
    const added = new Map<string, string>();
    let file: string | null = null;
    for (const line of r.stdout.split('\n')) {
      if (line.startsWith('+++ ')) file = line === '+++ /dev/null' ? null : line.slice(4).replace(/^b\//, '');
      else if (file && line.startsWith('+')) added.set(file, `${added.get(file) ?? ''}${line.slice(1)}\n`);
    }
    const secrets = [...added].map(([f, text]) => ({ file: f, kinds: scanSecrets(text).redactions.map((x) => x.kind) })).filter((x) => x.kinds.length > 0).sort((x, y) => (x.file < y.file ? -1 : 1));
    return { secrets, incomplete: r.stdout.length >= EXEC_OUTPUT_CAP || r.timedOut };
  }

  /** Aegis L3: the remote-tracking sha of the pushed branch (the last fetch), or null when there is none. */
  async #trackingSha(st: RepoState, remote: string): Promise<string | null> {
    const git = (this.#o.git ?? gitPath)()!;
    const r = await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', st.gitDir, 'rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${st.branch}`], { cwd: st.root, env: localGitEnv(this.#env()), timeoutMs: VERB_TIMEOUTS.read });
    const sha = r.stdout.trim();
    return r.code === 0 && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha) ? sha : null;
  }

  /** Re-read the repo and the remote (they must match the card), then push by remote name. */
  async #doPush(s: VerbSession, verb: GitVerb, hash: string, p: { st: RepoState; remote: string; info: RemoteInfo; force: boolean; lease?: string | null; upstream: boolean; cardId?: string }, branchArg: unknown): Promise<VerbResult> {
    const ids = { host: p.info.host, ...(p.cardId ? { cardId: p.cardId } : {}) };
    const st2 = await this.#repoState(p.st.root, branchArg ?? p.st.branch);
    if (isRefused(st2)) return this.#refuse(s, verb, hash, st2.refused, st2.text, ids);
    const info2 = await this.#resolveRemote(st2, p.remote);
    if (isRefused(info2) || info2.url !== p.info.url || st2.branch !== p.st.branch || st2.sha !== p.st.sha) return this.#refuse(s, verb, hash, 'remote-changed', 'The remote or the branch changed after the card: not pushed. Ask again.', ids);
    const git = (this.#o.git ?? gitPath)()!;
    const ref = `refs/heads/${p.st.branch}`;
    // Aegis round 2 M3: the sha read before the card is what is pushed (never whatever the branch points to now)
    const args = [...PUSH_GIT_FLAGS, '--git-dir', p.st.gitDir, 'push', '--porcelain', '--no-follow-tags', '--recurse-submodules=no', ...(p.force ? [`--force-with-lease=${ref}:${p.lease ?? ''}`] : []), '--', p.remote, `${p.st.sha}:${ref}`];
    const env = await this.#netEnv(path.dirname(git), p.st.gitDir);
    if (this.#cancelled(s)) return this.#cancel(s, verb, hash, ids);
    s.onEffect?.();
    const r = await this.#exec()(git, args, { cwd: p.st.root, env, timeoutMs: VERB_TIMEOUTS.push });
    if (r.timedOut) return this.#fail(s, verb, hash, 'timeout', 'git push ran too long and was stopped.', { ...ids, exitCode: -1 });
    if (r.code !== 0) return this.#fail(s, verb, hash, 'command-failed', `git push to ${p.info.slug} failed: ${redactOutput(`${r.stderr}\n${r.stdout}`, 800)}`, { ...ids, exitCode: r.code });
    this.#pushed.set(`${p.st.gitDir}\0${p.remote}\0${p.st.branch}`, p.st.sha);
    if (this.#pushed.size > 1024) this.#pushed.delete(this.#pushed.keys().next().value!);
    // a create tracks the new remote branch (the kernel writes branch.<b>.remote/merge; a sha refspec sets no upstream)
    if (p.upstream) await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', p.st.gitDir, 'branch', `--set-upstream-to=${p.remote}/${p.st.branch}`, '--', p.st.branch], { cwd: p.st.root, env: localGitEnv(this.#env()), timeoutMs: VERB_TIMEOUTS.read });
    await this.#row(s, verb, 'ran', hash, ids);
    return { ok: true, text: `Pushed ${p.st.branch} (${p.st.sha.slice(0, 12)}) to ${p.info.url} (${p.info.slug})${p.force ? ` with force (leased on ${p.lease ? p.lease.slice(0, 12) : 'no remote branch'})` : ''}.` };
  }

  /* ── repo.create ──────────────────────────────────────────────────────── */

  async #create(a: Record<string, unknown> | null, s: VerbSession, root: string, hash: string): Promise<VerbResult> {
    const verb = 'repo.create';
    if (!a || Object.keys(a).some((k) => !['name', 'owner', 'visibility', 'remote'].includes(k))) return this.#refuse(s, verb, hash, 'bad-input', 'gnomon_repo_create takes name, owner, visibility and remote only.');
    if (!validRepoName(a.name)) return this.#refuse(s, verb, hash, 'bad-input', 'name must be letters, digits, ".", "_" or "-" (not starting with "-" or ".", no ".git" ending, at most 100).');
    if (a.owner !== undefined && !validOwner(a.owner)) return this.#refuse(s, verb, hash, 'bad-input', 'owner is not a GitHub user or organisation name.');
    if (a.visibility !== undefined && a.visibility !== 'private' && a.visibility !== 'public') return this.#refuse(s, verb, hash, 'bad-input', 'visibility is private or public.');
    const remote = a.remote === undefined ? 'origin' : a.remote;
    if (!validRemoteName(remote)) return this.#refuse(s, verb, hash, 'bad-input', 'remote is not a plain remote name.');
    const visibility: 'private' | 'public' = a.visibility === 'public' ? 'public' : 'private';
    const sr = this.#sessionRefusal(s);
    if (sr) return this.#refuse(s, verb, hash, sr.refused, sr.text);
    const st = await this.#repoState(root, undefined);
    if (isRefused(st)) return this.#refuse(s, verb, hash, st.refused, st.text);
    const git = (this.#o.git ?? gitPath)()!;
    const exists = async (): Promise<boolean> => (await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', st.gitDir, 'remote', 'get-url', '--', remote], { cwd: root, env: localGitEnv(this.#env()), timeoutMs: VERB_TIMEOUTS.read })).code === 0;
    if (await exists()) return this.#refuse(s, verb, hash, 'remote-exists', `This repo already has a remote named ${remote}: use gnomon_git_push, or pick another remote name.`);
    const gh = (this.#o.gh ?? ghPath)();
    if (!gh) return this.#refuse(s, verb, hash, 'tool-missing', 'gh (GitHub CLI) is not installed: the human installs it and runs `gh auth login`.');
    const host = 'github.com';
    const ghEnv = await this.#netEnv(path.dirname(gh));
    let owner = a.owner as string | undefined;
    if (owner === undefined) {
      // Aegis L6: a read with the human's credentials before the card has its own row
      await this.#row(s, verb, 'lookup', hash, { host });
      const who = await this.#exec()(gh, ['api', 'user', '--jq', '.login'], { cwd: this.#o.userHome(), env: ghEnv, timeoutMs: VERB_TIMEOUTS.read });
      const login = who.stdout.trim();
      if (who.code !== 0 || !validOwner(login)) return this.#refuse(s, verb, hash, 'not-authenticated', 'gh is not signed in to github.com: the human runs `gh auth login`.', { host });
      owner = login;
    }
    const url = `https://${host}/${owner}/${a.name}.git`;
    const toolInput = { verb, host, owner, repo: a.name, visibility, remote, url };
    const d = await this.#decide(s, createCard({ root, owner, name: a.name, visibility, remote, branch: st.branch, url, host }), 'gnomon_repo_create', toolInput, hash);
    const cardId = d.cardId ?? undefined;
    const ids = { host, ...(cardId ? { cardId } : {}) };
    if (d.decision === 'none') return this.#refuse(s, verb, hash, 'no-approval-surface', 'No approval surface could take the card: nothing created.', { host });
    if (d.decision === 'cancelled') return this.#cancel(s, verb, hash, d.cardId ? { cardId: d.cardId } : {});
    if (d.decision !== 'allow') return this.#refuse(s, verb, hash, 'denied', 'The human did not approve creating this repo.', ids);
    // re-read after the card: the same branch, still no such remote, the config still plain
    const st2 = await this.#repoState(root, undefined);
    if (isRefused(st2)) return this.#refuse(s, verb, hash, st2.refused, st2.text, ids);
    if (st2.branch !== st.branch || (await exists())) return this.#refuse(s, verb, hash, 'remote-changed', 'The repo changed after the card: nothing created. Ask again.', ids);
    if (this.#cancelled(s)) return this.#cancel(s, verb, hash, ids);
    s.onEffect?.();
    const c = await this.#exec()(gh, ['repo', 'create', `${owner}/${a.name}`, visibility === 'public' ? '--public' : '--private'], { cwd: this.#o.userHome(), env: ghEnv, timeoutMs: VERB_TIMEOUTS.create });
    if (c.timedOut) return this.#fail(s, verb, hash, 'timeout', 'gh repo create ran too long and was stopped.', { ...ids, exitCode: -1 });
    if (c.code !== 0) return this.#fail(s, verb, hash, 'command-failed', `gh repo create failed: ${redactOutput(c.stderr, 600)}`, { ...ids, exitCode: c.code });
    const add = await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', st.gitDir, 'remote', 'add', '--', remote, url], { cwd: root, env: localGitEnv(this.#env()), timeoutMs: VERB_TIMEOUTS.read });
    if (add.code !== 0) return this.#fail(s, verb, hash, 'command-failed', `Created ${host}/${owner}/${a.name}, but adding the remote failed: ${redactOutput(add.stderr, 300)}`, { ...ids, exitCode: add.code });
    const info = parseRemote(url) as RemoteInfo;
    const pushed = await this.#doPush(s, verb, hash, { st: st2, remote, info, force: false, upstream: true, ...(cardId ? { cardId } : {}) }, undefined);
    if (!pushed.ok) return { ...pushed, text: `Created ${host}/${owner}/${a.name} (${visibility}) and added remote ${remote}, but the push did not finish: ${pushed.text}` };
    return { ok: true, text: `Created ${host}/${owner}/${a.name} (${visibility}), added remote ${remote} → ${url}, and pushed ${st.branch}.` };
  }

  /**
   * The edit-like gate (^git-init-gate): auto-edits runs with an approval.auto row (no row, no auto-run: the card
   * instead), ask raises the card. `forceCard` always raises it (a force remove). null = go on.
   */
  async #editGate(s: VerbSession, verb: GitVerb, hash: string, card: VerbCard, tool: string, toolInput: Record<string, unknown>, at: string, forceCard: boolean): Promise<{ cardId?: string } | VerbResult> {
    const b = this.#o.broker;
    if (!forceCard && s.mode === 'auto-edits' && !s.local && b && typeof b.auto === 'function') {
      try {
        await b.auto({ hsid: s.hsid, tool, path: at, inputHash: hash, modeRef: 'mode:auto-edits' });
        return {};
      } catch {
        /* fall through to the card */
      }
    }
    const d = await this.#decide(s, card, tool, toolInput, hash);
    if (d.decision === 'none') return this.#refuse(s, verb, hash, 'no-approval-surface', 'No approval surface could take the card: nothing done.');
    if (d.decision === 'cancelled') return this.#cancel(s, verb, hash, d.cardId ? { cardId: d.cardId } : {});
    if (d.decision !== 'allow') return this.#refuse(s, verb, hash, 'denied', 'The human did not approve this.', d.cardId ? { cardId: d.cardId } : {});
    return d.cardId ? { cardId: d.cardId } : {};
  }

  /* ── git.worktree.add / git.worktree.remove ───────────────────────────── */

  /** Aegis M1: steering paths of `ref` vs HEAD (paths whose blob differs or exists on one side only), and the hash of ref's steering set. */
  async #steering(gitDir: string, ref: string, local: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<{ diff: string[]; hash: string | null }> {
    const git = (this.#o.git ?? gitPath)()!;
    const tree = async (r: string): Promise<Map<string, string>> => {
      const out = await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', gitDir, 'ls-tree', '-r', '-z', '--full-tree', r], local);
      const m = new Map<string, string>();
      for (const e of out.stdout.split('\0')) {
        const tab = e.indexOf('\t');
        if (tab < 0) continue;
        const p = e.slice(tab + 1);
        if (isSteeringPath(p)) m.set(p, e.slice(0, tab).split(' ')[2] ?? '');
      }
      return m;
    };
    const b = await tree(ref);
    const h = await tree('HEAD');
    const diff = [...new Set([...b.keys(), ...h.keys()])].filter((p) => b.get(p) !== h.get(p)).sort();
    return { diff, hash: inputHash([...b].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) };
  }

  /** `<root>/.gnomon` and `<root>/.gnomon/worktrees`: absent or real folders (never a link); made when `make`. */
  #worktreesDir(root: string, make: boolean): string | Refused {
    let d = root;
    for (const part of ['.gnomon', ...WORKTREES_REL.split('/').slice(1)]) {
      d = path.join(d, part);
      let st: fs.Stats | null = null;
      try {
        st = fs.lstatSync(d);
      } catch {
        st = null;
      }
      if (st && (st.isSymbolicLink() || !st.isDirectory())) return { refused: 'dotgit-link', text: `${d} is ${st.isSymbolicLink() ? 'a symlink' : 'not a folder'}: Gnomon makes worktrees only in a real folder.` };
      if (!st) {
        if (!make) return { refused: 'no-worktree', text: 'This repo has no kernel worktrees.' };
        fs.mkdirSync(d, { mode: 0o755 });
      }
    }
    return d;
  }

  async #worktree(verb: GitVerb, a: Record<string, unknown> | null, s: VerbSession, root: string, hash: string): Promise<VerbResult> {
    const remove = verb === 'git.worktree.remove';
    if (!s.worktreesGuarded) return this.#refuse(s, verb, hash, 'unguarded', 'Kernel worktrees need the session profile\'s worktree denies, which this platform does not have yet.');
    const keys = remove ? ['name', 'force'] : ['name', 'branch', 'base'];
    if (!a || Object.keys(a).some((k) => !keys.includes(k))) return this.#refuse(s, verb, hash, 'bad-input', `${remove ? 'gnomon_worktree_remove' : 'gnomon_worktree_add'} takes ${keys.join(', ')} only.`);
    if (!validWorktreeName(a.name)) return this.#refuse(s, verb, hash, 'bad-input', 'name must be letters, digits, ".", "_" or "-" (at most 64, not starting with "." or "-").');
    if (a.force !== undefined && typeof a.force !== 'boolean') return this.#refuse(s, verb, hash, 'bad-input', 'force must be true or false.');
    const branch = a.branch === undefined ? `worktree-${a.name}` : a.branch;
    if (!validBranch(branch)) return this.#refuse(s, verb, hash, 'bad-input', 'branch is not a plain branch name.');
    if (a.base !== undefined && !validBranch(a.base)) return this.#refuse(s, verb, hash, 'bad-input', 'base is not a plain branch name.');
    const sr = this.#sessionRefusal(s);
    if (sr) return this.#refuse(s, verb, hash, sr.refused, sr.text);
    const st = await this.#repoState(root, undefined);
    if (isRefused(st)) return this.#refuse(s, verb, hash, st.refused, st.text);
    const git = (this.#o.git ?? gitPath)()!;
    const local = { cwd: root, env: localGitEnv(this.#env()), timeoutMs: VERB_TIMEOUTS.read };
    const w0 = this.#worktreesDir(root, false);
    const dir = path.join(root, ...WORKTREES_REL.split('/'), a.name);
    const force = remove && a.force === true;
    if (remove) {
      if (isRefused(w0)) return this.#refuse(s, verb, hash, w0.refused, w0.text);
      // a kernel worktree: a real folder with a .git pointer that git lists for this repo
      const list = await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', st.gitDir, 'worktree', 'list', '--porcelain'], local);
      const listed = list.stdout.split('\n').some((l) => l === `worktree ${dir}` || l === `worktree ${real(dir)}`);
      if (!kernelWorktreeDirs(root).includes(dir) || !listed) return this.#refuse(s, verb, hash, 'no-worktree', `No kernel worktree named ${a.name}.`);
    } else {
      if (fs.existsSync(dir)) return this.#refuse(s, verb, hash, 'worktree-exists', `${dir} already exists.`);
      const b = await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', st.gitDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], local);
      if (b.code === 0) return this.#refuse(s, verb, hash, 'worktree-exists', `Branch ${branch} already exists: name another branch.`);
      if (a.base !== undefined && (await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', st.gitDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${a.base}^{commit}`], local)).code !== 0) return this.#refuse(s, verb, hash, 'no-branch', `Branch ${a.base} does not exist.`);
    }
    const base = a.base === undefined ? st.branch : a.base;
    // Aegis M1: the steering files the base would check out (CLAUDE*.md, .claude/**, .mcp.json, any case) against this
    // checkout's HEAD; any difference raises the card even under auto-edits. The set's hash rides the verb's input
    // (approval.auto / approval.request tool_input), so the log names exactly what was checked out
    // Aegis round 2 M4: the base is resolved to a sha ONCE; the steering diff and the checkout both use that sha
    const baseSha = remove ? '' : (await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', st.gitDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${base}^{commit}`], local)).stdout.trim();
    if (!remove && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(baseSha)) return this.#refuse(s, verb, hash, 'no-branch', `Branch ${base} does not exist.`);
    const steer = remove ? { diff: [] as string[], hash: null as string | null } : await this.#steering(st.gitDir, baseSha, local);
    const card = worktreeCard({ root, name: a.name, dir, branch, base, remove, force, steeringDiff: steer.diff });
    const gate = await this.#editGate(s, verb, hash, card, remove ? 'gnomon_worktree_remove' : 'gnomon_worktree_add', { verb, root, name: a.name, branch, base, ...(baseSha ? { baseSha } : {}), force, ...(steer.hash ? { steeringHash: steer.hash } : {}) }, dir, force || steer.diff.length > 0);
    if ('ok' in gate) return gate;
    const ids = gate.cardId ? { cardId: gate.cardId } : {};
    if (this.#cancelled(s)) return this.#cancel(s, verb, hash, ids);
    s.onEffect?.();
    if (remove) {
      const r = await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', st.gitDir, 'worktree', 'remove', ...(force ? ['--force'] : []), '--', dir], { ...local, timeoutMs: VERB_TIMEOUTS.init });
      if (r.code !== 0) return this.#fail(s, verb, hash, 'command-failed', `git worktree remove failed: ${redactOutput(r.stderr, 400)}`, { ...ids, exitCode: r.code });
      await this.#row(s, verb, 'ran', hash, ids);
      return { ok: true, text: `Removed the worktree ${a.name} (its branch is kept).` };
    }
    // re-checked after the decision: the folders are still real, the name still free
    const w = this.#worktreesDir(root, true);
    if (isRefused(w)) return this.#refuse(s, verb, hash, w.refused, w.text, ids);
    if (fs.existsSync(dir)) return this.#refuse(s, verb, hash, 'worktree-exists', `${dir} already exists.`, ids);
    if (this.#cancelled(s)) return this.#cancel(s, verb, hash, ids);
    s.onEffect?.();
    const r = await this.#exec()(git, [...HARDENED_GIT_FLAGS, '--git-dir', st.gitDir, '--work-tree', root, 'worktree', 'add', '--quiet', '-b', branch, '--', dir, baseSha], { ...local, timeoutMs: VERB_TIMEOUTS.push });
    if (r.timedOut) return this.#fail(s, verb, hash, 'timeout', 'git worktree add ran too long and was stopped.', { ...ids, exitCode: -1 });
    if (r.code !== 0) return this.#fail(s, verb, hash, 'command-failed', `git worktree add failed: ${redactOutput(r.stderr, 400)}`, { ...ids, exitCode: r.code });
    // keep the main checkout's status clean: the kernel's own exclude line (info/ is session-denied, the kernel writes it)
    try {
      const info = path.join(st.gitDir, 'info');
      fs.mkdirSync(info, { recursive: true, mode: 0o755 });
      const ex = path.join(info, 'exclude');
      const cur = fs.existsSync(ex) ? fs.readFileSync(ex, 'utf8') : '';
      if (!cur.split('\n').includes(`/${WORKTREES_REL}/`)) fs.appendFileSync(ex, `${cur && !cur.endsWith('\n') ? '\n' : ''}/${WORKTREES_REL}/\n`);
    } catch {
      /* status noise only */
    }
    await this.#row(s, verb, 'ran', hash, ids);
    return { ok: true, text: `Made the worktree ${a.name} at ${dir} on the new branch ${branch} (from ${base}). Edit files there by absolute path and point subagents at it; commit there as usual. Remove it with gnomon_worktree_remove.` };
  }
}
