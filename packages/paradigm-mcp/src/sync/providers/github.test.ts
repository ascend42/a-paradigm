/**
 * Tests for the GitHub SyncProvider (#github-provider).
 *
 * The `gh` shell-out is injected via the `run` option so NO network/CLI is
 * touched. We assert the exact `gh` arg vectors — especially that an ARCHETYPE
 * task pushes UNASSIGNED + a `paradigm:agent/<ref>` marker label (Loid's rule),
 * while a HUMAN task carries `--assignee` and no marker label.
 */

import { describe, it, expect, vi } from 'vitest';

import { GithubProvider } from './github.js';
import type { Task } from '../../utils/task-loader.js';

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'T-2026-06-13-042',
    blurb: 'Fix the parser',
    priority: 'high',
    status: 'open',
    tags: ['#parser', 'bug'],
    created: '2026-06-13T00:00:00.000Z',
    ...overrides,
  };
}

const ISSUE_URL = 'https://github.com/acme/widgets/issues/7';

describe('GithubProvider.push', () => {
  it('creates an issue with title/body/repo and parses ref + url from gh output', async () => {
    const run = vi.fn().mockReturnValue(ISSUE_URL + '\n');
    const provider = new GithubProvider({ repo: 'acme/widgets', run });

    const result = await provider.push(baseTask({ claimant: { kind: 'human', ref: 'matt@x.com' } }));

    expect(result).toEqual({ ref: 'acme/widgets#7', url: ISSUE_URL });

    const args = run.mock.calls[0][0] as string[];
    expect(args.slice(0, 2)).toEqual(['issue', 'create']);
    expect(args).toContain('--title');
    expect(args[args.indexOf('--title') + 1]).toBe('Fix the parser');
    expect(args).toContain('--repo');
    expect(args[args.indexOf('--repo') + 1]).toBe('acme/widgets');
    // body carries the local task id so the issue links home
    const body = args[args.indexOf('--body') + 1];
    expect(body).toContain('T-2026-06-13-042');
  });

  it('human claimant → --assignee, no agent marker label', () => {
    return (async () => {
      const run = vi.fn().mockReturnValue(ISSUE_URL);
      const provider = new GithubProvider({ repo: 'acme/widgets', run });
      await provider.push(baseTask({ claimant: { kind: 'human', ref: 'matt@x.com' } }));

      const args = run.mock.calls[0][0] as string[];
      expect(args).toContain('--assignee');
      expect(args[args.indexOf('--assignee') + 1]).toBe('matt@x.com');
      // tags become labels; no paradigm:agent marker for a human
      const labels = args.filter((_, i) => args[i - 1] === '--label');
      expect(labels).toEqual(['#parser', 'bug']);
      expect(labels.some(l => l.startsWith('paradigm:agent/'))).toBe(false);
    })();
  });

  it('archetype claimant → UNASSIGNED + paradigm:agent/<ref> marker label', async () => {
    const run = vi.fn().mockReturnValue(ISSUE_URL);
    const provider = new GithubProvider({ repo: 'acme/widgets', run });

    await provider.push(baseTask({ claimant: { kind: 'archetype', ref: 'builder' } }));

    const args = run.mock.calls[0][0] as string[];
    // never falsely assigned to a human
    expect(args).not.toContain('--assignee');
    const labels = args.filter((_, i) => args[i - 1] === '--label');
    expect(labels).toContain('paradigm:agent/builder');
    // the task's own tags ride along too
    expect(labels).toContain('#parser');
    expect(labels).toContain('bug');
  });

  it('peer claimant → UNASSIGNED + paradigm:peer/<ref> marker label', async () => {
    const run = vi.fn().mockReturnValue(ISSUE_URL);
    const provider = new GithubProvider({ repo: 'acme/widgets', run });

    await provider.push(baseTask({ claimant: { kind: 'peer', ref: 'agent-7' } }));

    const args = run.mock.calls[0][0] as string[];
    expect(args).not.toContain('--assignee');
    const labels = args.filter((_, i) => args[i - 1] === '--label');
    expect(labels).toContain('paradigm:peer/agent-7');
  });

  it('throws (does not fabricate) when gh returns no parseable issue URL', async () => {
    const run = vi.fn().mockReturnValue('something went sideways');
    const provider = new GithubProvider({ repo: 'acme/widgets', run });
    await expect(provider.push(baseTask())).rejects.toThrow(/parseable issue URL/);
  });
});

describe('GithubProvider.isAvailable', () => {
  it('true when `gh auth status` succeeds', async () => {
    const run = vi.fn().mockReturnValue('Logged in');
    const provider = new GithubProvider({ run });
    expect(await provider.isAvailable()).toBe(true);
    expect(run.mock.calls[0][0]).toEqual(['auth', 'status']);
  });

  it('false when `gh auth status` throws (not authed)', async () => {
    const run = vi.fn().mockImplementation(() => { throw new Error('not logged in'); });
    const provider = new GithubProvider({ run });
    expect(await provider.isAvailable()).toBe(false);
  });
});

describe('GithubProvider.comment / close', () => {
  it('comment derives repo from the ref and passes the body', async () => {
    const run = vi.fn().mockReturnValue('');
    const provider = new GithubProvider({ run });
    await provider.comment({ provider: 'github', ref: 'acme/widgets#7' }, 'hello');
    const args = run.mock.calls[0][0] as string[];
    expect(args.slice(0, 3)).toEqual(['issue', 'comment', 'acme/widgets#7']);
    expect(args[args.indexOf('--body') + 1]).toBe('hello');
    expect(args[args.indexOf('--repo') + 1]).toBe('acme/widgets');
  });

  it('close shells out gh issue close', async () => {
    const run = vi.fn().mockReturnValue('');
    const provider = new GithubProvider({ run });
    await provider.close!({ provider: 'github', ref: 'acme/widgets#7' });
    const args = run.mock.calls[0][0] as string[];
    expect(args.slice(0, 3)).toEqual(['issue', 'close', 'acme/widgets#7']);
  });
});

describe('GithubProvider.capabilities', () => {
  it('declares one-way: push/comment/close true, pull false', () => {
    expect(new GithubProvider().capabilities()).toEqual({
      push: true, comment: true, pull: false, close: true,
    });
  });
});
