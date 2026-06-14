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
import type { ExternalRef, ProviderCapabilities, PushResult, SyncProvider } from '../provider.js';
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
    return { push: true, comment: true, pull: false, close: true };
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
    const args = ['issue', 'comment', ref.ref, '--body', message];
    if (repo) args.push('--repo', repo);
    this.run(args);
    log.component('#github-provider').info('Commented on GitHub issue', { ref: ref.ref });
  }

  async close(ref: ExternalRef): Promise<void> {
    const repo = repoFromRef(ref.ref) ?? this.repo;
    const args = ['issue', 'close', ref.ref];
    if (repo) args.push('--repo', repo);
    this.run(args);
    log.component('#github-provider').info('Closed GitHub issue', { ref: ref.ref });
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
    lines.push('— Pushed one-way by Paradigm sync (Phase 2a). Edits here do not flow back.');
    return lines.join('\n');
  }
}

// Self-register on module load. A consumer imports this module for the
// side-effect; the core (task-loader) never does.
registerProvider('github', () => new GithubProvider());
