/**
 * pick-agentid-env.test — agentId threading through the single-writer auto-seal
 * path (the dogfood attribution precondition).
 *
 *   - An ATTRIBUTED pick (agentId = "alice") folds authoredBy.agentId INTO the v2
 *     pickId, so the SAME tree + ref + time sealed anonymously has a DIFFERENT
 *     identity — attribution is event identity, per strand.ts:174.
 *   - The attributed strand records authoredBy.agentId = "alice" and SURVIVES verify.
 *   - The CLI resolves agentId from $WARPLINE_AGENT_ID when --agent is absent, so a
 *     per-agent worktree seals attributed strands (guarded CLI spawn — runs against a
 *     THROWAWAY temp repo, never the live fabric).
 *
 * HONEST SCOPE: agentId is UNSIGNED self-assertion — attribution DATA for the
 * dogfood, not authenticated identity. M3 signatures close that gap.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recordPick } from '../src/fabric/pick.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { computePickId } from '../src/fabric/strand.js';

const execFileAsync = promisify(execFile);

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'agent@warpline.test');
    await r.git('config', 'user.name', 'Warpline Agent');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...a: string[]): Promise<string> =>
    (await execFileAsync('git', a, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

describe('pick agentId — attributed vs anonymous identity', () => {
  let repo: Repo;
  beforeEach(async () => {
    repo = await Repo.create('warpline-pick-agentid-');
    await repo.write('src/mod.ts', 'export function a() { return 1; }\n');
    await repo.commitAll('base');
  }, 120_000);
  afterEach(async () => repo?.destroy());

  it('agentId folds into the pickId: alice ≠ anonymous for the SAME tree + ref + time', async () => {
    const now = '2026-07-03T00:00:00.000Z'; // pin time so ONLY agentId varies
    const r = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis', agentId: 'alice', now });
    const strand = r.strand!;

    // Attribution recorded.
    expect(strand.authoredBy?.agentId).toBe('alice');
    // The stored pickId reproduces WITH alice folded in (attributed identity).
    const { pickId, ...body } = strand;
    expect(computePickId(body)).toBe(pickId);
    // The SAME event sealed anonymously (agentId → null) hashes DIFFERENTLY: the
    // attributed and anonymous strands are distinct identities, not the same pick.
    const anonPickId = computePickId({ ...body, authoredBy: { agentId: null } });
    expect(anonPickId).not.toBe(pickId);

    // …and the attributed strand survives fabric verify (pure v2 → no anchor needed).
    const report = verifyFabric(repo.dir);
    expect(report.failures).toEqual([]);
  });

  // The CLI env-fallback proof needs the built binary; skip gracefully if dist is
  // absent (src-only CI) — the dogfood/coordinator build runs it for real.
  const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));
  it.skipIf(!existsSync(distCli))(
    'CLI resolves agentId from $WARPLINE_AGENT_ID when --agent is absent (attributed seal)',
    async () => {
      const { stdout } = await execFileAsync('node', [distCli, 'pick', '--ref', 'HEAD', '--json'], {
        cwd: repo.dir,
        encoding: 'utf8',
        env: { ...process.env, WARPLINE_AGENT_ID: 'alice' },
      });
      const result = JSON.parse(stdout);
      expect(result.strand.authoredBy.agentId).toBe('alice');
    },
    120_000,
  );
});
