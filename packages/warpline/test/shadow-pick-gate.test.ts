/**
 * shadow-pick-gate.test — the #hook-path wiring of the R1 shadow gate.
 *
 * When `.warpline/config.json` sets shadowGate:true, every #pick (the auto-seal
 * hook runs `pick --ref HEAD`) ALSO appends the observe-only verdict of the
 * sealed state vs the PRE-seal selvage. Pinned:
 *   - default OFF: no config ⇒ pick seals, no shadow dir appears
 *   - opt-in ON: config ⇒ pick seals normally AND appends exactly one row
 *   - fail-safe: a corrupt config never blocks the seal path
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { readShadowVerdicts, shadowDirOf } from '../src/fabric/shadow.js';
import { configPathOf } from '../src/fabric/config.js';
import { warplineDirOf, readFabric } from '../src/fabric/fabric.js';

const execFileAsync = promisify(execFile);
const MOD = 'src/mod.ts';

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'main');
    await r.git('config', 'user.email', 'gate@warpline.test');
    await r.git('config', 'user.name', 'Warpline Gate');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...a: string[]): Promise<string> =>
    (await execFileAsync('git', a, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

describe('shadow gate on the pick/auto-seal path (opt-in via .warpline/config.json)', () => {
  let repo: Repo;

  beforeAll(async () => {
    repo = await Repo.create('warpline-shadow-gate-');
    await repo.write('.gitignore', '.warpline/\n');
    await repo.write(MOD, 'export function f() { return 1; }\n');
    await repo.commitAll('base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('default OFF: pick seals, no shadow rows', async () => {
    const r = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis' });
    expect(r.noop).toBe(false);
    expect(fs.existsSync(shadowDirOf(repo.dir))).toBe(false);
  }, 120_000);

  it('opt-in ON: each pick seals normally AND records one shadow row', async () => {
    fs.writeFileSync(configPathOf(repo.dir), JSON.stringify({ shadowGate: true }, null, 2) + '\n', 'utf8');
    await repo.write(MOD, 'export function f() { return 2; }\n');
    await repo.commitAll('edit f');

    const fabricBefore = readFabric(warplineDirOf(repo.dir)).length;
    const r = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD' });

    // The seal path is untouched: the pick sealed exactly as before.
    expect(r.noop).toBe(false);
    expect(readFabric(warplineDirOf(repo.dir)).length).toBe(fabricBefore + 1);

    // And the shadow verdict of the commit vs the PRE-seal selvage was recorded.
    const rows = readShadowVerdicts(repo.dir);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('FAST_ADMIT'); // hook path: base == selvage
    expect(rows[0].ref).toBe('HEAD');
    expect(rows[0].agentId).toBe('auto-seal'); // unattributed pick default
    expect(rows[0].wouldSeal).toBe(true);
  }, 120_000);

  it('an attributed pick threads its agentId into the row', async () => {
    await repo.write(MOD, 'export function f() { return 3; }\n');
    await repo.commitAll('edit f again');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', agentId: 'agent-7' });
    const rows = readShadowVerdicts(repo.dir);
    expect(rows).toHaveLength(2);
    expect(rows[1].agentId).toBe('agent-7');
  }, 120_000);

  it('fail-safe: a corrupt config never blocks the seal', async () => {
    fs.writeFileSync(configPathOf(repo.dir), '{ this is not json', 'utf8');
    await repo.write(MOD, 'export function f() { return 4; }\n');
    await repo.commitAll('edit f once more');
    const fabricBefore = readFabric(warplineDirOf(repo.dir)).length;
    const r = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD' });
    expect(r.noop).toBe(false); // sealed despite the corrupt toggle file
    expect(readFabric(warplineDirOf(repo.dir)).length).toBe(fabricBefore + 1);
    expect(readShadowVerdicts(repo.dir)).toHaveLength(2); // no new row
  }, 120_000);
});
