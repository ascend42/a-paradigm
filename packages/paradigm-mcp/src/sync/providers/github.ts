/**
 * GitHub SyncProvider (#github-provider) — Phase 2a (TD-2026-06-13-768).
 *
 * The ONLY implemented provider at Phase 2a. One-way (outbound): it creates and
 * annotates GitHub issues via the `gh` CLI. No OAuth, no token in config —
 * availability is "is `gh` authed?" (`gh auth status` exits 0), mirroring the
 * review command's shell-out to `gh` (packages/paradigm/src/commands/review).
 *
 * Failure isolation: every method shells out best-effort. Callers (the CLI
 * `push`) wrap calls so a `gh` failure NEVER corrupts the local task.
 *
 * Self-registers into the sync registry on module load (bottom of file).
 */

import { execFileSync } from 'child_process';

import type { Task } from '../../utils/task-loader.js';
import { log } from '../../utils/mcp-logger.js';
import type { ExternalRef, ProviderCapabilities, PushResult, RemoteState, SyncProvider } from '../provider.js';
import { registerProvider } from '../registry.js';
import { projectClaimant } from '../claimant-projection.js';

export interface GithubProviderOptions {
  /** Default `owner/repo` used when a task's ref does not carry one. */
  repo?: string;
  /**
   * Injected runner (tests). Returns the command's stdout. Defaults to a real
   * `execFileSync` over `gh`. Using execFileSync (not execSync) keeps args as a
   * structured array — no shell-quoting, and trivially assertable in tests.
   */
  run?: (args: string[]) => string;
}

const GH = 'gh';

/** Strip an `owner/repo#N` (or full URL) down to the `owner/repo` segment. */
function repoFromRef(ref: string): string | undefined {
  const m = ref.match(/^([^/\s]+\/[^/#\s]+)#\d+$/);
  if (m) return m[1];
  const url = ref.match(/github\.com\/([^/]+\/[^/]+)\/issues\/\d+/);
  if (url) return url[1];
  return undefined;
}

/** Parse `owner/repo#N` from the URL `gh issue create` prints on stdout. */
function refFromUrl(url: string): string | undefined {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  return m ? `${m[1]}#${m[2]}` : undefined;
}

/**
 * The issue selector `gh` accepts alongside `--repo`: the bare NUMBER. `gh issue
 * edit/close/view` reject `owner/repo#N` as the positional arg ("invalid issue
 * format") — so extract the number from `owner/repo#N` (or a URL); fall back to
 * the raw ref (a full URL is also accepted).
 */
function issueSelector(ref: string): string {
  const m = ref.match(/#(\d+)$/) || ref.match(/\/issues\/(\d+)/);
  return m ? m[1] : ref;
}

export class GithubProvider implements SyncProvider {
  readonly id = 'github';
  private readonly repo?: string;
  private readonly run: (args: string[]) => string;

  constructor(opts: GithubProviderOptions = {}) {
    this.repo = opts.repo;
    this.run =
      opts.run ??
      ((args: string[]) => execFileSync(GH, args, { encoding: 'utf8', timeout: 20000 }));
  }

  capabilities(): ProviderCapabilities {
    return { push: true, comment: true, pull: true, close: true };
  }

  async isAvailable(): Promise<boolean> {
    try {
      // `gh auth status` exits 0 only when authenticated. Any throw ⇒ unavailable.
      this.run(['auth', 'status']);
      return true;
    } catch {
      return false;
    }
  }

  async push(task: Task): Promise<PushResult> {
    const repo = this.resolveRepo(task);
    const body = this.renderBody(task);

    const projection = projectClaimant(task.claimant);

    const args = ['issue', 'create', '--title', task.blurb, '--body', body];
    if (repo) args.push('--repo', repo);
    // Assignee: a human-claimed task assigns to the authenticated pusher via
    // `@me` — GitHub assignees are logins, NOT emails (claimant.ref is an email),
    // and `task push` is run by the task's owner. Archetype/peer tasks stay
    // UNASSIGNED. Tags + claimant ride in the issue body (renderBody); arbitrary
    // tags-as-labels are deferred — `gh issue create` rejects labels that don't
    // already exist in the repo — until two-way round-trip needs the marker labels.
    if (projection.assignee) args.push('--assignee', '@me');

    const stdout = this.run(args).trim();
    const url = stdout.split('\n').map(l => l.trim()).find(l => /github\.com\//.test(l));
    const ref = url ? refFromUrl(url) : undefined;

    if (!ref) {
      // gh did not return a parseable issue URL — surface, do not fabricate.
      log.component('#github-provider').warn('Could not parse issue ref from gh output', { stdout });
      throw new Error(`gh issue create did not return a parseable issue URL: ${stdout || '(empty)'}`);
    }

    log.component('#github-provider').info('Pushed task to GitHub', { taskId: task.id, ref });
    return { ref, url };
  }

  async comment(ref: ExternalRef, message: string): Promise<void> {
    const repo = repoFromRef(ref.ref) ?? this.repo;
    const args = ['issue', 'comment', issueSelector(ref.ref), '--body', message];
    if (repo) args.push('--repo', repo);
    this.run(args);
    log.component('#github-provider').info('Commented on GitHub issue', { ref: ref.ref });
  }

  async close(ref: ExternalRef, reason: 'completed' | 'not-planned' = 'completed'): Promise<void> {
    const repo = repoFromRef(ref.ref) ?? this.repo;
    const args = ['issue', 'close', issueSelector(ref.ref), '--reason', reason];
    if (repo) args.push('--repo', repo);
    this.run(args);
    log.component('#github-provider').info('Closed GitHub issue', { ref: ref.ref, reason });
  }

  async reopen(ref: ExternalRef): Promise<void> {
    const repo = repoFromRef(ref.ref) ?? this.repo;
    const args = ['issue', 'reopen', issueSelector(ref.ref)];
    if (repo) args.push('--repo', repo);
    this.run(args);
    log.component('#github-provider').info('Reopened GitHub issue', { ref: ref.ref });
  }

  /** Add/remove labels and set an assignee. Each gh edit is best-effort. */
  async edit(ref: ExternalRef, change: { addLabels?: string[]; removeLabels?: string[]; addAssignee?: string }): Promise<void> {
    const repo = repoFromRef(ref.ref) ?? this.repo;
    const args = ['issue', 'edit', issueSelector(ref.ref)];
    for (const l of change.addLabels ?? []) args.push('--add-label', l);
    for (const l of change.removeLabels ?? []) args.push('--remove-label', l);
    if (change.addAssignee) args.push('--add-assignee', change.addAssignee);
    if (args.length === 3) return; // nothing to change
    if (repo) args.push('--repo', repo);
    this.run(args);
  }

  /**
   * Read the issue's reconcilable state via `gh issue view --json` (structured
   * fields only — never the free-text body). Throw-safe at the call site.
   */
  async pull(ref: ExternalRef): Promise<RemoteState> {
    const repo = repoFromRef(ref.ref) ?? this.repo;
    const args = ['issue', 'view', issueSelector(ref.ref), '--json', 'state,stateReason,assignees,labels,title,url'];
    if (repo) args.push('--repo', repo);
    const raw = this.run(args);
    const j = JSON.parse(raw) as {
      state?: string; stateReason?: string;
      assignees?: Array<{ login?: string }>; labels?: Array<{ name?: string }>;
      title?: string; url?: string;
    };
    const status: RemoteState['status'] = (j.state || '').toUpperCase() === 'CLOSED' ? 'closed' : 'open';
    const sr = (j.stateReason || '').toUpperCase();
    const closedReason: RemoteState['closedReason'] | undefined =
      status === 'closed' ? (sr === 'NOT_PLANNED' ? 'not-planned' : 'completed') : undefined;
    return {
      status,
      closedReason,
      assignees: (j.assignees ?? []).map(a => a.login).filter((l): l is string => !!l),
      labels: (j.labels ?? []).map(l => l.name).filter((n): n is string => !!n),
      title: j.title,
      url: j.url,
    };
  }

  /** Prefer a repo embedded in the task's existing anchor, else the config default. */
  private resolveRepo(task: Task): string | undefined {
    if (task.external_ref?.ref) {
      const fromRef = repoFromRef(task.external_ref.ref);
      if (fromRef) return fromRef;
    }
    return this.repo;
  }

  /**
   * Render the issue body. Includes the local task id (T-…) so the issue links
   * home, plus the claimant-projection footer for human-readable ownership.
   */
  private renderBody(task: Task): string {
    const lines: string[] = [];
    lines.push(`Synced from Paradigm task \`${task.id}\`.`);
    lines.push('');
    if (task.claimant) {
      lines.push(`Claimant: \`${task.claimant.kind}:${task.claimant.ref}\``);
    }
    lines.push(`Priority: ${task.priority}`);
    if (task.tags.length > 0) lines.push(`Tags: ${task.tags.join(', ')}`);
    lines.push('');
    lines.push('— Synced by Paradigm (two-way). Closing/reopening this issue flows back to the task on the next `paradigm task sync`.');
    return lines.join('\n');
  }
}

// Self-register on module load. A consumer imports this module for the
// side-effect; the core (task-loader) never does.
registerProvider('github', () => new GithubProvider());
