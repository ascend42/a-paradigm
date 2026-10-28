/**
 * TD-2026-10-27-833 (Aegis H2): every op in LOCAL_ONLY_OPS is class `read` in Gnomon, so it must not write. Each runs
 * in the staged mode against a fixture repo (a git repo with a populated .paradigm/) and must leave the repo and HOME
 * byte-identical. The only tolerated change is the session trail Paradigm keeps for itself under HOME (breadcrumbs and
 * the global session dir), which the staged mode moves OUT of the repo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildRegistry, buildToolSurface, registerTools } from './index.js';
import { LOCAL_ONLY_OPS } from './families.js';
import { familyOpsFromMap } from '../utils/tool-family.js';
import { invalidateFeatureCache } from '../utils/tool-registry.js';
import { loadProjectContext } from '../utils/index-loader.js';
import { getSessionTracker } from '../utils/session-tracker.js';

const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'staged-ops-')));
const repo = path.join(base, 'repo');
const home = path.join(base, 'home');
const prev = { HOME: process.env.HOME, STAGED: process.env.PARADIGM_GNOMON_STAGED };

/** Session trail paths under HOME the staged mode writes on purpose (never in the repo). */
const TRAIL = [path.join(home, 'staged-project'), path.join(home, '.paradigm', 'sessions')];

function treeHash(dir: string, skip: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      if (skip.some((s) => p === s || p.startsWith(s + path.sep))) continue;
      const st = fs.lstatSync(p);
      if (st.isDirectory()) {
        out[`${path.relative(dir, p)}/`] = 'dir';
        walk(p);
      } else out[path.relative(dir, p)] = st.isFile() ? createHash('sha256').update(fs.readFileSync(p)).digest('hex') : `special:${st.mode}`;
    }
  };
  walk(dir);
  return out;
}

function argsFor(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const props = (schema?.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;
  const out: Record<string, unknown> = {};
  for (const r of (schema?.required as string[] | undefined) ?? []) {
    const p = props[r] ?? {};
    out[r] = p.enum?.[0] ?? (p.type === 'number' || p.type === 'integer' ? 1 : p.type === 'boolean' ? false : p.type === 'array' ? ['x'] : p.type === 'object' ? {} : '#x');
  }
  return out;
}

let call: (name: string, args: Record<string, unknown>) => Promise<unknown>;

beforeAll(async () => {
  for (const d of ['lore', 'wisdom', 'history', 'tasks', 'protocols', 'agents', 'notebooks', 'docs']) fs.mkdirSync(path.join(repo, '.paradigm', d), { recursive: true });
  // Paradigm's global dir itself (getGlobalDir makes it on any call; the trail lives inside it)
  fs.mkdirSync(path.join(home, '.paradigm'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.paradigm', 'config.yaml'), 'version: "2.0"\nproject: staged-ops\n');
  fs.writeFileSync(path.join(repo, '.purpose'), 'version: "2.0"\ncomponents:\n  x:\n    description: a component\n');
  fs.writeFileSync(path.join(repo, 'portal.yaml'), 'version: "1.0"\ngates: {}\n');
  fs.writeFileSync(path.join(repo, 'a.ts'), '// #x\nexport const a = 1;\n');
  spawnSync('git', ['init', '-q'], { cwd: repo });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: repo });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: repo });
  fs.cpSync(repo, path.join(base, 'repo.tpl'), { recursive: true });
  fs.cpSync(home, path.join(base, 'home.tpl'), { recursive: true });
  process.env.HOME = home;
  process.env.PARADIGM_GNOMON_STAGED = '1';
  invalidateFeatureCache();
  const ctx = await loadProjectContext(repo);
  getSessionTracker().setRootDir(repo);
  const handlers = new Map<unknown, (req: { params: Record<string, unknown> }) => Promise<unknown>>();
  const server = { setRequestHandler: (s: unknown, h: never) => void handlers.set(s, h), sendToolListChanged: async () => undefined };
  registerTools(server as never, () => ctx, async () => ctx);
  call = (name, args) => handlers.get(CallToolRequestSchema)!({ params: { name, arguments: args } });
});

afterAll(() => {
  if (prev.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = prev.HOME;
  if (prev.STAGED === undefined) delete process.env.PARADIGM_GNOMON_STAGED;
  else process.env.PARADIGM_GNOMON_STAGED = prev.STAGED;
  fs.rmSync(base, { recursive: true, force: true });
});

describe('LOCAL_ONLY_OPS write nothing (staged mode)', () => {
  const surface = buildToolSurface(buildRegistry(os.tmpdir()));
  const ops = familyOpsFromMap();
  for (const [fam, list] of Object.entries(LOCAL_ONLY_OPS)) {
    for (const op of list) {
      it(`${fam}.${op}`, async () => {
        const legacy = ops.get(fam)![op]!;
        const args = { op, ...argsFor(surface.legacyDefs.get(legacy)?.inputSchema as Record<string, unknown>) };
        // a pristine fixture per op: a cache one op creates must not hide the next op's write
        for (const [d, t] of [[repo, 'repo.tpl'], [home, 'home.tpl']] as const) {
          for (const n of fs.readdirSync(d)) fs.rmSync(path.join(d, n), { recursive: true, force: true });
          fs.cpSync(path.join(base, t), d, { recursive: true });
        }
        invalidateFeatureCache();
        const repoBefore = treeHash(repo);
        const homeBefore = treeHash(home, TRAIL);
        await call(fam, args).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 300)); // a background write the op started must land inside its window
        expect(treeHash(repo), `${fam}.${op} changed the repo`).toEqual(repoBefore);
        expect(treeHash(home, TRAIL), `${fam}.${op} changed HOME`).toEqual(homeBefore);
      });
    }
  }

  it('the session trail lands under HOME, never in the repo', () => {
    expect(fs.existsSync(path.join(repo, '.paradigm', 'session-breadcrumbs.json'))).toBe(false);
  });
});
