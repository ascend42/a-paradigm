/**
 * read-failure-vs-absent.test — C-8 regression: a git READ FAILURE must never be
 * read as "the file is absent on that side", because absent means DELETE.
 *
 * `git show` exits 128 both for "path not in this tree" AND for a missing object,
 * a corrupt pack, EMFILE or ENOMEM. Collapsing all of them to `null` let a bad
 * disk sector become an `rm`: resolveFile saw "deleted on that side", dropped the
 * file from the merged tree, reported ZERO conflicts, and the result sealed CLEAN.
 *
 * The discriminator is STRUCTURAL, not prose: `git ls-tree` exits 0 with EMPTY
 * output for a genuinely absent path and non-zero for any real failure. So
 * presence is decided by the tree entry, and a failed blob read propagates.
 *
 * The fixtures below delete a real loose blob object — the actual failure mode,
 * not a mock.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { treeEntryMode } from '../src/git/git-exec.js';
import { computeMerge } from '../src/fabric/materialize.js';
import { assertNotStakeInput } from '../src/fabric/stake-guard.js';

const execFileAsync = promisify(execFile);

const VICTIM = 'victim.txt';
const OTHER = 'other.txt';

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new FixtureRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'mat@warpline.test');
    await r.git('config', 'user.name', 'Warpline Mat');
    await r.git('config', 'commit.gpgsign', 'false');
    await r.git('config', 'gc.auto', '0'); // keep objects LOOSE so we can delete one
    return r;
  }
  git = async (...args: string[]): Promise<string> =>
    (await execFileAsync('git', args, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async file(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  /** Delete the LOOSE object file for `<ref>:<rel>` — simulates a corrupt/missing blob. */
  async destroyBlob(ref: string, rel: string): Promise<void> {
    const sha = await this.git('rev-parse', `${ref}:${rel}`);
    const loose = path.join(this.dir, '.git', 'objects', sha.slice(0, 2), sha.slice(2));
    await fs.rm(loose, { force: true });
  }
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

describe('C-8 — a failed git read is not "absent", and never becomes a DELETE', () => {
  let repo: FixtureRepo;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-readfail-');
    await repo.file(VICTIM, 'BASE\n');
    await repo.file(OTHER, 'x\n');
    await repo.commitAll('base');

    // ours: changes VICTIM only.
    await repo.git('checkout', '-q', '-b', 'ours');
    await repo.file(VICTIM, 'OURS\n');
    await repo.commitAll('ours');

    // theirs: changes OTHER only — VICTIM still holds the base bytes.
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'theirs');
    await repo.file(OTHER, 'y\n');
    await repo.commitAll('theirs');

    await repo.git('checkout', '-q', 'base');
    // Now break the read: the `ours` blob for VICTIM is gone from the object DB.
    // Its TREE is intact, so the path is demonstrably PRESENT at `ours` — only the
    // bytes are unreadable. That is a corrupt repo, not a deletion.
    await repo.destroyBlob('ours', VICTIM);
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('the fixture is genuinely a READ failure, not an absence (tree intact, blob gone)', async () => {
    // ls-tree still resolves the entry — presence is not in doubt.
    const mode = await treeEntryMode('ours', VICTIM, { cwd: repo.dir });
    expect(mode).toBe('100644');
    // ...but reading the bytes fails.
    await expect(repo.git('show', `ours:${VICTIM}`)).rejects.toThrow();
  });

  it('computeMerge ABORTS rather than planning a delete of the unreadable file', async () => {
    await expect(computeMerge('base', 'ours', 'theirs', { cwd: repo.dir })).rejects.toThrow();
  });

  it('a genuinely absent path is still absent (the fix must not over-block)', async () => {
    expect(await treeEntryMode('base', 'no-such-file.txt', { cwd: repo.dir })).toBeNull();
    // and a merge over intact objects still succeeds.
    const plan = await computeMerge('base', 'theirs', 'theirs', { cwd: repo.dir });
    expect(plan.conflicts).toEqual([]);
    expect(plan.files.get(OTHER)!.content.toString('utf8')).toBe('y\n');
  });

  it('treeEntryMode fails closed on a git error instead of reporting "absent"', async () => {
    await expect(treeEntryMode('no-such-ref-at-all', VICTIM, { cwd: repo.dir })).rejects.toThrow();
  });

  it('the stake guard fails CLOSED when its marker read fails (never allow-on-error)', async () => {
    // A guard whose failure mode is "allow" is not a guard.
    await expect(
      assertNotStakeInput('no-such-ref-at-all', repo.dir, false),
    ).rejects.toThrow();
    // Sanity: an ordinary, readable, non-stake ref still passes.
    await expect(assertNotStakeInput('base', repo.dir, false)).resolves.toBeUndefined();
  });
});
