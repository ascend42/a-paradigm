/**
 * #stake-git — the ONLY module in Warpline allowed to WRITE to a git repository,
 * and only in the service of the checkpoint valve (`warpline stake`,
 * T-2026-07-17-001). git-exec.ts stays read-only by contract; the valve's write
 * surface is deliberately fenced off here so "Warpline never mutates git" keeps
 * one auditable exception.
 *
 * WRITE SURFACE (exactly two kinds of mutation, both scoped to the stake):
 *   1. LOOSE OBJECTS — blob/tree/commit objects are constructed in pure TS
 *      (git's exact framing + sha1) and written straight into
 *      `<gitdir>/objects/aa/…` (zlib, write-tmp + atomic rename — the same disk
 *      discipline as our own ObjectStore). No `git add` / index / filters ever
 *      run, so clean/smudge/autocrlf can NEVER rewrite staked bytes — the commit
 *      tree is byte-identical to the pure-TS expectation BY CONSTRUCTION, and
 *      the S3 verify (rev-parse through git's own reader) proves it.
 *   2. THE STAKE REF — advanced via `git update-ref <ref> <new> <old>`: a
 *      per-ref CAS (old = previous tip, or "" = must-not-exist), never a
 *      checkout, never the human's working branch, never the index/worktree.
 *
 * sha1 repos only: a sha256-object-format repo is refused fail-closed (the
 * loose-object writer speaks sha1 framing).
 *
 * Library code: no console output.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

let tmpSeq = 0;

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: MAX_BUFFER, encoding: 'utf8' });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`git ${args.join(' ')} failed: ${(e.stderr || e.message || '').trim()}`);
  }
}

/** The absolute git dir of a repo (worktree-correct). */
export async function gitDirOf(repo: string): Promise<string> {
  const p = await git(['rev-parse', '--absolute-git-dir'], repo);
  return path.isAbsolute(p) ? p : path.resolve(repo, p);
}

/** The repo's object format ('sha1' | 'sha256'). Older gits (no flag) are sha1. */
export async function objectFormatOf(repo: string): Promise<string> {
  return (await git(['rev-parse', '--show-object-format'], repo).catch(() => 'sha1')) || 'sha1';
}

/** The currently checked-out branch of a repo, or null (detached/unborn edge cases). */
export async function currentBranchOf(repo: string): Promise<string | null> {
  return (await git(['symbolic-ref', '--short', '-q', 'HEAD'], repo).catch(() => '')) || null;
}

/**
 * Write one loose git object (git's exact `<type> <len>\0<body>` framing, sha1,
 * zlib) into `<gitdir>/objects/` and return its sha1. Idempotent + atomic
 * (write-tmp + rename); content-addressed, so an existing object is never
 * rewritten. Pure construction — no git process involved.
 */
export function writeLooseGitObject(gitDir: string, type: 'blob' | 'tree' | 'commit', body: Buffer): string {
  const framed = Buffer.concat([Buffer.from(`${type} ${body.length}\0`, 'utf8'), body]);
  const sha = createHash('sha1').update(framed).digest('hex');
  const p = path.join(gitDir, 'objects', sha.slice(0, 2), sha.slice(2));
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp.${process.pid}.${tmpSeq++}`;
    fs.writeFileSync(tmp, zlib.deflateSync(framed));
    fs.renameSync(tmp, p);
  }
  return sha;
}

/**
 * Advance a ref by COMPARE-AND-SWAP: `oldSha` must be the current tip (null =
 * the ref must not exist yet). git enforces the CAS atomically; a concurrent
 * stake loses cleanly instead of clobbering. Never touches HEAD/index/worktree.
 */
export async function updateRefCas(repo: string, fullRef: string, newSha: string, oldSha: string | null): Promise<void> {
  await git(['update-ref', fullRef, newSha, oldSha ?? ''], repo);
}

export interface CommitMeta {
  treeSha: string;
  parents: string[];
  message: string;
}

/**
 * Read a commit's tree/parents/message via `git cat-file commit` (read-only,
 * exact bytes — no log formatting ambiguity). Used to parse stake trailers.
 */
export async function commitMeta(repo: string, sha: string): Promise<CommitMeta> {
  const raw = await execFileAsync('git', ['cat-file', 'commit', sha], {
    cwd: repo,
    maxBuffer: MAX_BUFFER,
    encoding: 'utf8',
  }).then(
    (r) => r.stdout,
    (err: { stderr?: string; message?: string }) => {
      throw new Error(`git cat-file commit ${sha} failed: ${(err.stderr || err.message || '').trim()}`);
    },
  );
  const blank = raw.indexOf('\n\n');
  const header = blank >= 0 ? raw.slice(0, blank) : raw;
  const message = blank >= 0 ? raw.slice(blank + 2) : '';
  let treeSha = '';
  const parents: string[] = [];
  for (const line of header.split('\n')) {
    if (line.startsWith('tree ')) treeSha = line.slice(5).trim();
    else if (line.startsWith('parent ')) parents.push(line.slice(7).trim());
  }
  if (!treeSha) throw new Error(`warpline: ${sha} is not a commit (no tree header)`);
  return { treeSha, parents, message };
}

/**
 * Construct the raw body of a stake commit object. FIRST-PARENT ONLY by shape
 * (D3): `parent` is a single optional sha — a stake commit structurally cannot
 * be a merge. Timestamps are supplied by the caller (deterministic in tests);
 * timezone pinned to +0000.
 */
export function buildCommitBody(input: {
  treeSha: string;
  parent: string | null;
  author: string; // "Name <email>"
  committer: string; // "Name <email>"
  epochSeconds: number;
  message: string; // must be trailer-only; caller owns the format
}): Buffer {
  for (const [label, ident] of [
    ['author', input.author],
    ['committer', input.committer],
  ] as const) {
    if (!/^[^<>\n]+ <[^<>\n]*>$/.test(ident)) {
      throw new Error(`warpline: stake ${label} ident ${JSON.stringify(ident)} is not "Name <email>" — refusing a malformed commit header`);
    }
  }
  const lines = [
    `tree ${input.treeSha}`,
    ...(input.parent ? [`parent ${input.parent}`] : []),
    `author ${input.author} ${input.epochSeconds} +0000`,
    `committer ${input.committer} ${input.epochSeconds} +0000`,
    '',
    input.message,
  ];
  return Buffer.from(lines.join('\n'), 'utf8');
}
