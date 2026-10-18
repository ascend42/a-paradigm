/**
 * @symbol #manifest-loader
 *
 * #manifest-loader `layersHash` and `gitHash` (spec §3.3 "Settings layers",
 * §15.7 gate-class, §16 "Paths + hashes"; A23-4, S16-2; G-WIN-04).
 *
 *   layersHash — every Claude settings layer the kernel can see: the managed
 *     files (their paths come from the platform, passed in by the caller), the
 *     user layer (`~/.claude/settings*.json`, `~/.claude/CLAUDE.md`, the NAME
 *     listing of `skills/`, `plugins/`, `agents/`, `commands/`, and
 *     `~/.claude.json` — its user-scope mcpServers run commands; the spec's
 *     §3.3/§15.5 lists omit it, a gap to amend), the project layer
 *     (`<cwd>/.claude/**` minus `.claude/worktrees/`, `CLAUDE.md`,
 *     `CLAUDE.local.md`) and
 *     the worktree layer (the same set under the worktree).
 *   gitHash — `.git/config`, `.git/hooks/**`, `.git/info/**` (in the common
 *     git dir; a linked worktree's `.git` file is followed, and its
 *     `config.worktree` is included) and `<repo>/.gitattributes`. The kernel
 *     never runs git for this: hashing is a file read.
 *
 * NORMALISATION, the same on every platform (no platform branch, G-WIN-05):
 *   - content: every CRLF becomes LF before hashing;
 *   - path key: scope label + posix path relative to the scope root, NFC,
 *     lower-cased (case-fold), so `.Claude/Settings.json` on a case-insensitive
 *     filesystem and `.claude/settings.json` on a case-sensitive one hash the
 *     same. Two inputs that fold to one key are both kept, ordered by content
 *     hash, so the digest never depends on the original case or on readdir order.
 *   - absent files are hashed as `null`, so removing a layer changes the hash.
 * A symlink contributes `symlink:<target>\n` followed by the TARGET's bytes
 * (when it is a readable file), so retargeting and editing the target both move the hash.
 *
 *   digest = "sha256:" + hex(sha256(canonicalJson({ schema, entries: [[key, sha256hex | null], …] })))
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson } from '@a-company/gnomon-contracts';

export const LAYERS_HASH_SCHEMA = 'gnomon-layers:v1' as const;
export const GIT_HASH_SCHEMA = 'gnomon-git-layers:v1' as const;

export interface HashInput {
  /** `<scope>:<path>`; normalised by normalizeLayerKey. */
  key: string;
  /** null = absent. */
  bytes: Uint8Array | null;
  /** The absolute path read (not hashed; lets the policy test prove every layer is write-denied). */
  abs?: string;
}

/** CRLF → LF (A23-4). */
export function normalizeContent(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 0x0d && b[i + 1] === 0x0a) continue;
    out[n++] = b[i]!;
  }
  return out.subarray(0, n);
}

/** Posix separators, no `./`, NFC, case-folded. */
export function normalizeLayerKey(key: string): string {
  return key
    .replace(/\\/g, '/')
    .replace(/\/\.\//g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/:\.\//, ':')
    .normalize('NFC')
    .toLowerCase();
}

export function digestInputs(schema: string, inputs: readonly HashInput[]): string {
  const rows = inputs.map((i) => [normalizeLayerKey(i.key), i.bytes === null ? null : createHash('sha256').update(normalizeContent(i.bytes)).digest('hex')] as [string, string | null]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : String(a[1]) < String(b[1]) ? -1 : String(a[1]) > String(b[1]) ? 1 : 0));
  return `sha256:${createHash('sha256').update(canonicalJson({ schema, entries: rows }), 'utf8').digest('hex')}`;
}

function readInput(scope: string, rel: string, abs: string): HashInput {
  try {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) {
      const head = new TextEncoder().encode(`symlink:${fs.readlinkSync(abs)}\n`);
      let target: Uint8Array = new Uint8Array(0);
      try {
        if (fs.statSync(abs).isFile()) target = fs.readFileSync(abs);
      } catch {
        target = new Uint8Array(0); // dangling: the link text alone
      }
      const b = new Uint8Array(head.length + target.length);
      b.set(head);
      b.set(target, head.length);
      return { key: `${scope}:${rel}`, bytes: b, abs };
    }
    if (st.isFile()) return { key: `${scope}:${rel}`, bytes: fs.readFileSync(abs), abs };
    return { key: `${scope}:${rel}`, bytes: new TextEncoder().encode(`not-a-file:${st.isDirectory() ? 'dir' : 'special'}`), abs };
  } catch {
    return { key: `${scope}:${rel}`, bytes: null, abs };
  }
}

/** Every file under `rootAbs/relDir` (recursive, links not followed); a missing dir yields one absent marker. */
function readTree(scope: string, rootAbs: string, relDir: string, skip: (rel: string) => boolean = () => false): HashInput[] {
  const out: HashInput[] = [];
  const visit = (abs: string, rel: string): void => {
    let names: string[];
    try {
      names = fs.readdirSync(abs);
    } catch {
      return;
    }
    for (const n of names) {
      const a = path.join(abs, n);
      const r = `${rel}/${n}`;
      if (skip(r)) continue;
      let st: fs.Stats;
      try {
        st = fs.lstatSync(a);
      } catch {
        continue;
      }
      if (st.isDirectory()) visit(a, r);
      else out.push(readInput(scope, r, a));
    }
  };
  const start = path.join(rootAbs, ...relDir.split('/'));
  if (!fs.existsSync(start)) return [{ key: `${scope}:${relDir}/`, bytes: null, abs: start }];
  visit(start, relDir);
  return out;
}

/** Names only (one level): the user-scope skills/plugins listing. */
function listing(scope: string, rootAbs: string, relDir: string): HashInput {
  try {
    const names = fs.readdirSync(path.join(rootAbs, relDir)).map((n) => n.normalize('NFC').toLowerCase()).sort();
    return { key: `${scope}:${relDir}/`, bytes: new TextEncoder().encode(names.join('\n')), abs: path.join(rootAbs, relDir) };
  } catch {
    return { key: `${scope}:${relDir}/`, bytes: null, abs: path.join(rootAbs, relDir) };
  }
}

function projectLayer(scope: string, root: string): HashInput[] {
  // `.claude/worktrees/` holds Claude's own worktrees (whole checkouts), not settings
  return [...readTree(scope, root, '.claude', (r) => r.toLowerCase() === '.claude/worktrees'), readInput(scope, 'CLAUDE.md', path.join(root, 'CLAUDE.md')), readInput(scope, 'CLAUDE.local.md', path.join(root, 'CLAUDE.local.md'))];
}

export interface LayersInput {
  /** The session cwd (project layer). */
  cwd: string;
  /** The session worktree, when it differs from cwd. */
  worktree?: string;
  /** The user's `~/.claude` (platform-resolved by the caller). */
  userClaudeDir: string;
  /** Managed settings files (platform-specific paths, from the caller / root-signed config). */
  managedPaths: readonly string[];
  /** `~/.claude.json` (default: beside userClaudeDir). */
  userClaudeJson?: string;
  /** M1.7: leave ~/.claude.json out (the mid-session watch hashes only its law-7 projection). */
  excludeClaudeJson?: boolean;
}

export function defaultClaudeJson(userClaudeDir: string): string {
  return path.join(path.dirname(userClaudeDir), '.claude.json');
}

/** The inputs of `layersHash` (exposed for tests and for `session.layers.changed{which}`). */
export function collectLayerInputs(inp: LayersInput): HashInput[] {
  const u = inp.userClaudeDir;
  const user: HashInput[] = [];
  let userNames: string[] = [];
  try {
    userNames = fs.readdirSync(u);
  } catch {
    userNames = [];
  }
  const settings = userNames.filter((n) => /^settings.*\.json$/i.test(n));
  for (const n of settings.length ? settings : ['settings.json']) user.push(readInput('user', n, path.join(u, n)));
  user.push(readInput('user', 'CLAUDE.md', path.join(u, 'CLAUDE.md')));
  for (const d of ['skills', 'plugins', 'agents', 'commands']) user.push(listing('user', u, d));
  const cj = inp.userClaudeJson ?? defaultClaudeJson(u);
  if (!inp.excludeClaudeJson) user.push(readInput('user', '.claude.json', cj));
  const managed = inp.managedPaths.map((p) => readInput('managed', p, p));
  const worktree = inp.worktree && path.resolve(inp.worktree) !== path.resolve(inp.cwd) ? projectLayer('worktree', inp.worktree) : [];
  return [...managed, ...user, ...projectLayer('project', inp.cwd), ...worktree];
}

export function layersHash(inp: LayersInput): string {
  return digestInputs(LAYERS_HASH_SCHEMA, collectLayerInputs(inp));
}

/** Resolve `<repo>/.git` to {gitDir, commonDir}; a `.git` file (`gitdir: …`) is followed. */
export function resolveGitDirs(repo: string): { gitDir: string; commonDir: string } | null {
  const dotgit = path.join(repo, '.git');
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dotgit);
  } catch {
    return null;
  }
  let gitDir = dotgit;
  if (st.isFile()) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotgit, 'utf8'));
    if (!m) return null;
    gitDir = path.resolve(repo, m[1]!);
  } else if (!st.isDirectory()) return null;
  let commonDir = gitDir;
  try {
    commonDir = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
  } catch {
    commonDir = gitDir;
  }
  return { gitDir, commonDir };
}

export function collectGitInputs(repo: string): HashInput[] {
  const dirs = resolveGitDirs(repo);
  const out: HashInput[] = [readInput('repo', '.gitattributes', path.join(repo, '.gitattributes'))];
  if (!dirs) return [...out, { key: 'git:.git', bytes: null }];
  out.push(readInput('git', 'config', path.join(dirs.commonDir, 'config')));
  out.push(...readTree('git', dirs.commonDir, 'hooks'), ...readTree('git', dirs.commonDir, 'info'));
  if (dirs.gitDir !== dirs.commonDir) out.push(readInput('git', 'config.worktree', path.join(dirs.gitDir, 'config.worktree')));
  return out;
}

export function gitHash(repo: string): string {
  return digestInputs(GIT_HASH_SCHEMA, collectGitInputs(repo));
}
