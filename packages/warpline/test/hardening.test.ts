/**
 * hardening.test — audit fixes that keep the multi-writer path from silently
 * corrupting (Reviewer H3, H1; H2 + mode + the G-matrix).
 *   H3: a binary file changed on both sides FAILS CLOSED (conflict) instead of
 *       round-tripping through the UTF-8 text merge and corrupting bytes.
 *   H1 (RELAXED, PR-B): a 3rd agent re-basing onto a MERGE strand now CLEAN-seals
 *       using the merge strand's DURABLE binding.treeId (the merged bytes an earlier
 *       admit content-addressed) — the second-parent bytes ARE available natively, so
 *       there is no wrong base. A merge strand with NO durable binding still fails
 *       closed (see admit-h1-relax.test.ts for the full 3-agent + genuine-fail proof).
 *   H2: rename decomposes to add+delete — a clean rename merges byte-correctly,
 *       and a rename racing an edit of the old path FAILS CLOSED (add/delete-vs-edit).
 *   MODE: the executable bit and entry TYPE survive the merge — a content merge
 *       keeps `100755`, and a changed symlink/submodule fails closed (no type corruption).
 *   G3: meaning-CLEAN but bytes overlap in a NON-symbol file → downgraded to KNOT.
 *   G4: a multi-file CLEAN merge routes each file to the side that changed it.
 *   (G1 — a 3rd interleaved writer — is exercised by H1: re-basing onto a merge
 *    strand reconstructs the 3rd generation from durable merged bytes.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { admit } from '../src/fabric/admit.js';
import { computeMerge } from '../src/fabric/materialize.js';

const execFileAsync = promisify(execFile);

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new FixtureRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'h@warpline.test');
    await r.git('config', 'user.name', 'Warpline H');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...args: string[]): Promise<string> =>
    (await execFileAsync('git', args, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string | Buffer): Promise<void> {
    const full = path.join(this.dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

describe('H3 — binary changed on both sides fails closed (no silent corruption)', () => {
  let repo: FixtureRepo;
  const BIN = 'asset.bin';

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-h3-');
    await repo.write(BIN, Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03])); // NUL ⇒ binary
    await repo.commitAll('base');
    await repo.git('checkout', '-q', '-b', 'branchA');
    await repo.write(BIN, Buffer.from([0x00, 0x01, 0x09, 0x00, 0x03]));
    await repo.commitAll('A');
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'branchB');
    await repo.write(BIN, Buffer.from([0x00, 0x01, 0x07, 0x00, 0x03]));
    await repo.commitAll('B');
    await repo.git('checkout', '-q', 'base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('computeMerge conflicts on the binary file — never a text merge', async () => {
    const plan = await computeMerge('base', 'branchA', 'branchB', { cwd: repo.dir });
    expect(plan.conflicts.some((c) => c.path === BIN && /binary/.test(c.reason))).toBe(true);
    expect(plan.files.has(BIN)).toBe(false); // not materialized
  });
});

describe('H1 (relaxed) — a 3rd agent re-basing onto a MERGE strand CLEAN-seals off its durable bytes', () => {
  let repo: FixtureRepo;
  const MOD = 'src/mod.ts';

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-h1-');
    await repo.write(MOD, `export function a() { return 1; } export function b() { return 2; }\n`);
    await repo.commitAll('base');
    // A edits a, B edits b (same line) → CLEAN merge. C adds an independent c.
    for (const [name, body] of [
      ['branchA', `export function a() { return 10; } export function b() { return 2; }\n`],
      ['branchB', `export function a() { return 1; } export function b() { return 20; }\n`],
      ['branchC', `export function a() { return 1; } export function b() { return 2; }\nexport function c() { return 3; }\n`],
    ] as const) {
      await repo.git('checkout', '-q', 'base');
      await repo.git('checkout', '-q', '-b', name);
      await repo.write(MOD, body);
      await repo.commitAll(name);
    }
    await repo.git('checkout', '-q', 'base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('the merge strand is marked, and admitting onto it does not silently mis-base', async () => {
    const root = repo.dir;
    await recordPick(root, { cwd: root, ref: 'base', intent: 'genesis' });
    forkScratch(root, 'B');
    forkScratch(root, 'C'); // C also forks at genesis (true concurrency)

    const ra = await admit(root, { cwd: root, agentId: 'A', ref: 'branchA' });
    expect(ra.decision.status).toBe('FAST_ADMIT');

    const rb = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(rb.decision.status).toBe('CLEAN');
    expect(rb.sealed).toBe(true);
    expect(rb.strand?.merged).toBe(true); // the merge strand is marked

    // C re-bases onto the merge strand: meaning says CLEAN, but materializing
    // base/theirs off the merge strand's single-parent commit would mis-base →
    // fail CLOSED (unsealed), never a wrong 3rd-generation merge.
    const rc = await admit(root, { cwd: root, agentId: 'C', ref: 'branchC' });
    expect(rc.decision.status).toBe('CLEAN');
    expect(rc.sealed).toBe(false);
  });
});

describe('H2 — rename decomposes to add+delete (clean rename merges; rename+edit fails closed)', () => {
  let repo: FixtureRepo;
  const FOO = 'src/foo.ts';
  const BAR = 'src/bar.ts';
  const OTHER = 'src/other.ts';
  const FOO_SRC = `export function foo() { return 1; }\n`;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-h2-');
    await repo.write(FOO, FOO_SRC);
    await repo.write(OTHER, `export function other() { return 0; }\n`);
    await repo.commitAll('base');

    // branchA renames foo → bar, content unchanged.
    await repo.git('checkout', '-q', '-b', 'branchA');
    await repo.git('mv', FOO, BAR);
    await repo.commitAll('A rename foo→bar');

    // branchB (from base) edits an UNRELATED file — a real, disjoint merge partner.
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'branchB');
    await repo.write(OTHER, `export function other() { return 99; }\n`);
    await repo.commitAll('B edit other');

    // branchC (from base) edits the OLD path foo — races the rename.
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'branchC');
    await repo.write(FOO, `export function foo() { return 2; }\n`);
    await repo.commitAll('C edit foo');

    await repo.git('checkout', '-q', 'base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('clean rename: old path deleted, new path added byte-correct, no conflict', async () => {
    const plan = await computeMerge('base', 'branchA', 'branchB', { cwd: repo.dir });
    expect(plan.conflicts).toEqual([]);
    expect(plan.files.get(FOO)).toBeNull(); // deleted at the old path
    expect(plan.files.get(BAR)?.content.toString('utf8')).toBe(FOO_SRC); // recreated at the new path
    expect(plan.files.get(OTHER)?.content.toString('utf8')).toBe('export function other() { return 99; }\n');
  });

  it('rename racing an edit of the old path FAILS CLOSED (add/delete vs edit)', async () => {
    const plan = await computeMerge('base', 'branchA', 'branchC', { cwd: repo.dir });
    expect(plan.conflicts.some((c) => c.path === FOO && /add\/delete vs edit/.test(c.reason))).toBe(true);
    expect(plan.files.has(FOO)).toBe(false); // never silently resolved
  });
});

describe('MODE — the executable bit and entry type survive the merge', () => {
  let repo: FixtureRepo;
  const SH = 'scripts/run.sh';
  const OTHER = 'src/other.ts';
  const LINK = 'link';

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-mode-');
    await repo.write(SH, `#!/bin/sh\necho base\n`);
    await fs.chmod(path.join(repo.dir, SH), 0o755);
    await repo.write(OTHER, `export function other() { return 0; }\n`);
    await repo.write('a.txt', 'A\n');
    await repo.write('b.txt', 'B\n');
    await repo.write('c.txt', 'C\n');
    await fs.symlink('a.txt', path.join(repo.dir, LINK)); // symlink entry (mode 120000)
    await repo.commitAll('base');

    // branchA: edit the executable's CONTENT (writeFile forces 0644 on disk); the
    // merge must recover the exec bit from the tree-entry mode compare.
    await repo.git('checkout', '-q', '-b', 'branchA');
    await repo.write(SH, `#!/bin/sh\necho A\n`);
    await fs.symlink('b.txt', path.join(repo.dir, `${LINK}.tmp`));
    await fs.rename(path.join(repo.dir, `${LINK}.tmp`), path.join(repo.dir, LINK)); // repoint symlink → b.txt
    await repo.commitAll('A edit run.sh + repoint link');

    // branchB (from base): edit an unrelated file, and repoint the symlink DIFFERENTLY.
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'branchB');
    await repo.write(OTHER, `export function other() { return 1; }\n`);
    await fs.symlink('c.txt', path.join(repo.dir, `${LINK}.tmp`));
    await fs.rename(path.join(repo.dir, `${LINK}.tmp`), path.join(repo.dir, LINK)); // repoint symlink → c.txt
    await repo.commitAll('B edit other + repoint link');

    await repo.git('checkout', '-q', 'base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('a content merge preserves the 100755 executable bit', async () => {
    // Merge A (edited run.sh) against a base-mode-preserving side. Use branchA vs base:
    // only ours changed run.sh → the merged mode must stay executable.
    const plan = await computeMerge('base', 'branchA', 'base', { cwd: repo.dir });
    const sh = plan.files.get(SH);
    expect(sh?.content.toString('utf8')).toBe(`#!/bin/sh\necho A\n`);
    expect(sh?.mode).toBe('100755');
  });

  it('a symlink changed on both sides fails closed (no entry-type corruption)', async () => {
    const plan = await computeMerge('base', 'branchA', 'branchB', { cwd: repo.dir });
    expect(plan.conflicts.some((c) => c.path === LINK && /symlink|submodule/.test(c.reason))).toBe(true);
    expect(plan.files.has(LINK)).toBe(false); // never round-tripped as a regular blob
  });
});

describe('G3 — meaning CLEAN but bytes overlap in a non-symbol file → KNOT downgrade', () => {
  let repo: FixtureRepo;
  const MOD = 'src/mod.ts';
  const NOTES = 'NOTES.txt'; // no symbols — invisible to the meaning layer

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-g3-');
    await repo.write(MOD, `export function a() { return 1; }\nexport function b() { return 2; }\n`);
    await repo.write(NOTES, `shared line\n`);
    await repo.commitAll('base');
    // A edits symbol a AND the shared notes line; B edits symbol b AND the same
    // notes line, differently. Meaning: disjoint symbols → CLEAN. Bytes: NOTES overlaps.
    await repo.git('checkout', '-q', '-b', 'branchA');
    await repo.write(MOD, `export function a() { return 10; }\nexport function b() { return 2; }\n`);
    await repo.write(NOTES, `A's line\n`);
    await repo.commitAll('A');
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'branchB');
    await repo.write(MOD, `export function a() { return 1; }\nexport function b() { return 20; }\n`);
    await repo.write(NOTES, `B's line\n`);
    await repo.commitAll('B');
    await repo.git('checkout', '-q', 'base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('B admits into a KNOT — the meaning layer said CLEAN, the bytes did not', async () => {
    const root = repo.dir;
    await recordPick(root, { cwd: root, ref: 'base', intent: 'genesis' });
    forkScratch(root, 'B'); // pin B's merge base at genesis

    const ra = await admit(root, { cwd: root, agentId: 'A', ref: 'branchA' });
    expect(ra.decision.status).toBe('FAST_ADMIT');

    const rb = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(rb.decision.status).toBe('KNOT'); // downgraded from a meaning-CLEAN
    expect(rb.sealed).toBe(false);
    expect(rb.merged?.conflicts.some((c) => c.path === NOTES)).toBe(true);
  });
});

describe('G4 — a multi-file CLEAN merge routes each file to the side that changed it', () => {
  let repo: FixtureRepo;
  const FX = 'src/x.ts';
  const FY = 'src/y.ts';

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-g4-');
    await repo.write(FX, `export function x() { return 1; }\n`);
    await repo.write(FY, `export function y() { return 2; }\n`);
    await repo.commitAll('base');
    // A edits only x.ts; B edits only y.ts — different files, different branches.
    await repo.git('checkout', '-q', '-b', 'branchA');
    await repo.write(FX, `export function x() { return 10; }\n`);
    await repo.commitAll('A edit x');
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'branchB');
    await repo.write(FY, `export function y() { return 20; }\n`);
    await repo.commitAll('B edit y');
    await repo.git('checkout', '-q', 'base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('B admits CLEAN + sealed; the merge carries A’s x and B’s y', async () => {
    const root = repo.dir;
    await recordPick(root, { cwd: root, ref: 'base', intent: 'genesis' });
    forkScratch(root, 'B');

    const ra = await admit(root, { cwd: root, agentId: 'A', ref: 'branchA' });
    expect(ra.decision.status).toBe('FAST_ADMIT');

    const rb = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(rb.decision.status).toBe('CLEAN');
    expect(rb.sealed).toBe(true);
    expect(rb.strand?.merged).toBe(true);
    expect(rb.merged?.conflicts).toEqual([]);
    expect(rb.merged?.files.get(FX)?.content.toString('utf8')).toBe(`export function x() { return 10; }\n`);
    expect(rb.merged?.files.get(FY)?.content.toString('utf8')).toBe(`export function y() { return 20; }\n`);
  });
});
