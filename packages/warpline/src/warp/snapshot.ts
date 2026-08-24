/**
 * #warp-store (M1a) — SNAPSHOT: walk a directory, write every blob + tree to the
 * native object store, and return the root `treeId` (byte identity) plus the
 * shadow git-sha1 OID (native-object-store-design.md §1.5, §2.4, §4).
 *
 * Byte-faithful and git-parity in ONE filesystem walk:
 *   - regular file → 100644, or 100755 when any exec bit is set
 *   - symlink      → 120000; the blob bytes ARE the link target (git's convention)
 *   - directory    → 40000 subtree, recursed; EMPTY dirs are omitted (git parity)
 *   - .git / .warpline / .loom / node_modules are ALWAYS skipped (any depth), and the walk
 *     honors .warplineignore / .gitignore at the root (T-031 — see ignore-rules.ts)
 * Names use the RAW on-disk bytes (not NFC) so the shadow OID matches git exactly.
 * Gitlinks (160000) can't be detected from a plain fs walk — a submodule dir reads
 * as a subtree; native representation + ref-sourced snapshots land with M1b backfill.
 *
 * The shadow `gitOid` MUST equal `git rev-parse <ref>^{tree}` for a clean worktree —
 * a free, total byte-faithfulness proof against git during coexistence (§2.4).
 *
 * DELTA-NATIVE (T-2026-07-04-003): ref snapshots are batched (one `cat-file
 * --batch` stream, not one spawn per file) and, given a VERIFIED SnapshotAnchor
 * (strandSnapshotAnchor), INCREMENTAL — a `git diff --raw` overlay onto the
 * anchor's native tree via writeMergedTree, byte-identical to the full walk and
 * fail-OPEN to it. This is what makes a warm `admit` on a real monorepo run in
 * seconds instead of minutes (see bench/bench-admit.mts).
 *
 * ── THE TREE SEMANTICS DECISION (T-2026-07-18-005; fixes T-2026-07-18-004) ────
 *
 * There is exactly ONE canonical tree semantics for NEW bindings: WORKTREE
 * SEMANTICS (`worktree:v1`) — the tree snapshotDir produces. Concretely: the
 * root `.warplineignore` (preferred) or `.gitignore` (fallback) rules of the
 * SOURCE BEING SNAPSHOTTED are honored, ALWAYS_IGNORE names (.git / .warpline /
 * .loom / node_modules) are skipped at any depth, ignored directories are pruned,
 * empty directories are dropped, and RESTORE_FORBIDDEN names never enter.
 *
 * WHY: F3 drill #1 (f3-drills.jsonl n=1) proved the old split — seal-time ref
 * bindings using GIT-COMMIT-TREE semantics (tracked-but-gitignored files IN)
 * while recover's worktree walk used ignore-honoring semantics (them OUT) —
 * makes every hook-sealed stake verify at cut time yet FALSE-REFUSE recovery.
 * Native-first resolves the fault line the native-first-honest way: the
 * WORKTREE is the source of truth; the git commit tree is a legacy adapter
 * view. snapshotRef therefore now applies the ref's OWN committed ignore rules
 * (a git-commit-tree walk filtered to what a worktree walk of that tree would
 * see); snapshotDir is unchanged (it already WAS the canonical semantics).
 *
 * EPOCH/GRANDFATHER (the pattern this project already uses): new bindings are
 * tagged additively — `binding.treeSemantics: 'worktree:v1'`; ABSENT means
 * legacy-git semantics. The tag rides OUTSIDE the pickId preimage in BOTH
 * epochs (v2 folds only bindingTreeId via the explicit exclusion set; the
 * founder-signed v3 preimage lists bindingTreeId explicitly — strand.ts), so
 * no signed identity changes. Existing strands verify/recover under THEIR OWN
 * recorded semantics: verify walks the recorded binding unchanged, and stake/
 * recover derive the worktree-semantics EXPECTATION of a legacy binding by
 * deterministic projection (projectTreeWorktreeSemantics — pure, from
 * authenticated bytes only). Merge-result bindings stay UNTAGGED (their inputs
 * may include legacy trees, so the result is not guaranteed a projection fixed
 * point); projection covers them at recover.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { gitBlobOid } from './blob.js';
import { gitTreeOid, treeId as computeNativeTreeId, type TreeEntry, type GitTreeEntry, type TreeMode } from './tree.js';
import { ObjectStore } from './object-store.js';
import { catFileBatch, diffRaw, lsTree, revParse, revParseTree, type GitOptions } from '../git/git-exec.js';
import { WORKTREE_REF } from '../absorb.js';
import { loadIgnoreMatcher, ignoreMatcherFrom, IGNORE_FILE_NAMES, type IgnoreMatcher } from './ignore-rules.js';
import { loadWarpignore } from './warpignore.js';
import { isRestoreForbiddenName, pathHasRestoreForbiddenName } from './reserved-names.js';
import {
  loadWorktreeIndex,
  saveWorktreeIndex,
  RACY_WINDOW_MS,
  type WorktreeIndexEntry,
} from './worktree-index.js';
import type { MergeRecipe, Strand } from '../fabric/strand.js';

/**
 * The canonical tree-semantics tag for NEW bindings (see the decision header):
 * additive on StrandBinding, OUTSIDE the pickId preimage in every epoch.
 * Absent on a binding = legacy-git semantics (grandfathered).
 */
export const WORKTREE_SEMANTICS = 'worktree:v1' as const;

export interface SnapshotResult {
  /** native root tree id (byte identity of the whole directory). */
  treeId: string;
  /** shadow git-sha1 tree OID — equals `git rev-parse <ref>^{tree}` for a clean tree. */
  gitOid: string;
  /** number of entries in the root tree (0 = empty). */
  entryCount: number;
  /** I5 stat-cache telemetry, present only when an indexRoot was supplied:
   * hits = files whose blob hash was reused from `.warpline/index` (never read),
   * misses = files read + rehashed. Cold walk ⇒ hits 0. */
  indexed?: { hits: number; misses: number };
}

export interface SnapshotDirOptions {
  /** I5 (NATIVE-FIRST phase 0): repo root whose `.warpline/index` stat cache the
   * walk consults + refreshes. Omitted ⇒ the plain full walk (every file read). */
  indexRoot?: string;
}

/**
 * Snapshot a directory tree into `store`; returns the root ids.
 *
 * IGNORE SEMANTICS (T-031 / HIGH-3): the worktree walk honors `.warplineignore`
 * (preferred) or `.gitignore` (fallback) at the snapshot root, and ALWAYS skips
 * .git/.warpline/.loom/node_modules at any depth (see ignore-rules.ts) — so a worktree
 * pick/admit never ingests dependency trees or secrets into the permanent no-gc
 * object store. Ignored directories are pruned (gitignore semantics: no
 * re-inclusion inside an excluded directory). The shadow gitOid consequently
 * equals `git rev-parse <ref>^{tree}` for a CLEAN tree whose ignores match git's.
 *
 * I5 (NATIVE-FIRST phase 0, `opts.indexRoot`): the walk consults the
 * `.warpline/index` stat cache — a file whose {mtimeMs, size, ino, mode} match
 * a trusted cache entry reuses its recorded blobId + gitSha WITHOUT being read
 * or rehashed; only changed files cost I/O + hashing. Byte-identical to the
 * cold walk by construction (same entries, same order, same ignore matcher) and
 * fail-OPEN on every anomaly: unreadable/corrupt/stale index, racy timestamps
 * (RACY_WINDOW_MS), a cached blob missing from the store, or any error inside
 * the indexed attempt ⇒ the plain full walk runs instead. The refreshed index
 * is written back after the walk (atomic; write failures swallowed).
 */
/**
 * The WORKTREE walk's ignore matcher: Warpline's NATIVE `.warpignore` (defaults +
 * file — governs skip decisions with git absent, TD-2026-08-12-218) COMPOSED with
 * the legacy `.warplineignore`/`.gitignore` matcher. Composition (OR), never
 * replacement: `.warpignore` only ENLARGES the exclude set, so the worktree
 * filter stays a SUPERSET of the ref-snapshot / worktree-semantics projection
 * filter (snapshot.ts tree-semantics decision) — the invariant recover relies on.
 */
function worktreeIgnoreMatcher(dir: string): IgnoreMatcher {
  const warp = loadWarpignore(dir);
  const legacy = loadIgnoreMatcher(dir);
  return (relPath: string, isDir: boolean): boolean => warp.isIgnored(relPath, isDir) || legacy(relPath, isDir);
}

export function snapshotDir(store: ObjectStore, dir: string, opts: SnapshotDirOptions = {}): SnapshotResult {
  const ignored = worktreeIgnoreMatcher(dir);
  if (opts.indexRoot) {
    try {
      const cached = loadWorktreeIndex(opts.indexRoot, dir); // null ⇒ cold (still records)
      const ctx: IndexCtx = {
        cache: cached?.entries ?? null,
        builtAtMs: cached?.builtAtMs ?? 0,
        out: new Map(),
        hits: 0,
        misses: 0,
      };
      const result = walk(store, dir, '', ignored, ctx);
      saveWorktreeIndex(opts.indexRoot, dir, ctx.out);
      return { ...result, indexed: { hits: ctx.hits, misses: ctx.misses } };
    } catch {
      // Fail OPEN on ANY anomaly inside the indexed attempt — the full walk is
      // the source of truth (idempotent store ⇒ partial writes are harmless).
    }
  }
  return walk(store, dir, '', ignored);
}

/** The I5 stat-cache walk context (see worktree-index.ts for the trust rules). */
interface IndexCtx {
  cache: Map<string, WorktreeIndexEntry> | null;
  /** the cache's builtAt (ms) — the racy-guard anchor; 0 when walking cold. */
  builtAtMs: number;
  /** entries the walk produces — becomes the refreshed index section. */
  out: Map<string, WorktreeIndexEntry>;
  hits: number;
  misses: number;
}

function walk(
  store: ObjectStore,
  dir: string,
  rel: string,
  ignored: IgnoreMatcher,
  idx?: IndexCtx,
): SnapshotResult {
  const native: TreeEntry[] = [];
  const git: GitTreeEntry[] = [];

  for (const name of fs.readdirSync(dir)) {
    const relPath = rel ? `${rel}/${name}` : name;
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (ignored(relPath, st.isDirectory())) continue;

    if (st.isSymbolicLink()) {
      const target = Buffer.from(fs.readlinkSync(full), 'utf8'); // link target IS the blob
      native.push({ mode: '120000', name, id: store.putBlob(target) });
      git.push({ mode: '120000', name, sha1: gitBlobOid(target) });
    } else if (st.isDirectory()) {
      const child = walk(store, full, relPath, ignored, idx);
      if (child.entryCount === 0) continue; // git does not track empty directories
      native.push({ mode: '40000', name, id: child.treeId });
      git.push({ mode: '40000', name, sha1: child.gitOid });
    } else if (st.isFile()) {
      const mode: TreeMode = st.mode & 0o111 ? '100755' : '100644';
      const ent = idx?.cache?.get(relPath);
      if (
        ent &&
        ent[0] === st.mtimeMs &&
        ent[1] === st.size &&
        ent[2] === st.ino &&
        ent[3] === mode && // chmod flips mode without touching mtime — mode is part of the key
        st.mtimeMs + RACY_WINDOW_MS <= idx!.builtAtMs && // racy guard (worktree-index.ts)
        store.has(ent[4]) // a copied/doctored index can never invent bytes
      ) {
        idx!.hits++;
        native.push({ mode, name, id: ent[4] });
        git.push({ mode, name, sha1: ent[5] });
        idx!.out.set(relPath, ent);
      } else {
        const bytes = fs.readFileSync(full);
        const id = store.putBlob(bytes);
        const sha1 = gitBlobOid(bytes);
        native.push({ mode, name, id });
        git.push({ mode, name, sha1 });
        if (idx) {
          idx.misses++;
          idx.out.set(relPath, [st.mtimeMs, st.size, st.ino, mode, id, sha1]);
        }
      }
    }
    // sockets/fifos/other special files are skipped (not representable in a tree)
  }

  return { treeId: store.putTree(native), gitOid: gitTreeOid(git), entryCount: native.length };
}

/* ── M1b: ref snapshots + the compositional merged-tree builder ─────────────── */

/** One byte change to overlay on a base tree: new/edited bytes+mode, or null=delete. */
export type PathChange = { content: Buffer; mode: string } | null;

interface Trie {
  files: Map<string, PathChange>;
  dirs: Map<string, Trie>;
}
const emptyTrie = (): Trie => ({ files: new Map(), dirs: new Map() });

function insertChange(trie: Trie, parts: string[], i: number, val: PathChange): void {
  if (i === parts.length - 1) {
    trie.files.set(parts[i], val);
    return;
  }
  let sub = trie.dirs.get(parts[i]);
  if (!sub) {
    sub = emptyTrie();
    trie.dirs.set(parts[i], sub);
  }
  insertChange(sub, parts, i + 1, val);
}

function buildTree(store: ObjectStore, baseTreeId: string | null, node: Trie): string {
  const map = new Map<string, TreeEntry>((baseTreeId ? store.getTree(baseTreeId) : []).map((e) => [e.name, e]));
  for (const [name, val] of node.files) {
    if (val === null) map.delete(name);
    else map.set(name, { mode: val.mode as TreeMode, name, id: store.putBlob(val.content) });
  }
  for (const [name, child] of node.dirs) {
    const existing = map.get(name);
    const childBase = existing && existing.mode === '40000' ? existing.id : null;
    const childId = buildTree(store, childBase, child);
    if (store.getTree(childId).length === 0) map.delete(name); // empty dir → drop (git parity)
    else map.set(name, { mode: '40000', name, id: childId });
  }
  return store.putTree([...map.values()]);
}

/**
 * Build a native tree from a base tree + per-path byte changes — the COMPOSITIONAL
 * construction (review amendment A2): unchanged subtrees are reused untouched
 * (so it is naturally incremental, A3), and the changed bytes come straight from
 * the caller (raw merge output / cat-file), NEVER the git-archive temp dir. `null`
 * base + all-files-as-changes builds a whole tree from scratch (used by snapshotRef).
 */
export function writeMergedTree(
  store: ObjectStore,
  baseTreeId: string | null,
  changes: Map<string, PathChange>,
): string {
  const root = emptyTrie();
  for (const [full, val] of changes) insertChange(root, full.split('/'), 0, val);
  return buildTree(store, baseTreeId, root);
}

/**
 * A verified byte anchor for an INCREMENTAL ref snapshot (T-2026-07-04-003):
 * `treeId` MUST be the native snapshot (`snapshotRef`) of `ref`'s tree. Callers
 * derive it from a sealed strand's `binding.treeId` + `provenance.gitCommit`,
 * verified via `binding.gitOid === rev-parse <commit>^{tree}` (see admit/pick).
 */
export interface SnapshotAnchor {
  /** a git ref/sha whose native snapshot is already in the store. */
  ref: string;
  /** the native treeId `snapshotRef(store, ref)` produced for that ref. */
  treeId: string;
}

/**
 * A VERIFIED incremental-snapshot anchor off a sealed strand (T-2026-07-04-003,
 * byte layer): usable ONLY when the strand's binding.treeId provably IS the
 * WORKTREE-SEMANTICS snapshot of its provenance.gitCommit's tree —
 *   - not a merge strand (its gitCommit is one parent, NOT the merged tree),
 *   - binding.treeSemantics === 'worktree:v1' (tree-semantics decision,
 *     T-2026-07-18-005): a LEGACY-semantics binding (git-commit-tree, tracked-
 *     but-gitignored files in) must never anchor a worktree-semantics overlay —
 *     the diff would be applied against the wrong base path set. The first seal
 *     after the semantics cutover therefore walks full ONCE, then re-anchors.
 *   - binding.gitOid present (ref-sealed; worktree seals carry null),
 *   - gitOid still equals `rev-parse <gitCommit>^{tree}` (guards a gc'd/rewritten
 *     ref — verification failure falls back to the full snapshot, never a wrong tree),
 *   - the native tree is actually present in the object store.
 * Returns undefined when any leg fails — fail OPEN to the full snapshot.
 */
export async function strandSnapshotAnchor(
  strand: Strand | undefined,
  store: ObjectStore,
  opts: GitOptions,
): Promise<SnapshotAnchor | undefined> {
  if (!strand || strand.merged) return undefined;
  const treeId = strand.binding?.treeId;
  const gitOid = strand.binding?.gitOid;
  const commit = strand.provenance?.gitCommit;
  if (strand.binding?.treeSemantics !== WORKTREE_SEMANTICS) return undefined; // legacy semantics never anchor
  if (!treeId || !gitOid || !commit || !store.has(treeId)) return undefined;
  const actual = await revParseTree(commit, opts).catch(() => null);
  return actual === gitOid ? { ref: commit, treeId } : undefined;
}

/**
 * The ref's OWN committed ignore rules (worktree semantics for a ref walk):
 * `.warplineignore` at the ref root wins, else `.gitignore`, else always-ignores
 * only. Read from the ref itself (not the live worktree) so a ref snapshot is
 * deterministic from the ref alone — for a clean tree the two agree byte-for-byte.
 */
async function refIgnoreMatcher(ref: string, opts: GitOptions): Promise<IgnoreMatcher> {
  for (const name of IGNORE_FILE_NAMES) {
    const sha = await revParse(`${ref}:${name}`, opts).catch(() => null);
    if (sha) {
      const blobs = await catFileBatch([sha], opts).catch(() => null);
      const buf = blobs?.get(sha);
      if (buf) return ignoreMatcherFrom(buf.toString('utf8'));
    }
  }
  return ignoreMatcherFrom(null);
}

/**
 * Apply an IgnoreMatcher to a FLAT (ls-tree/diff-raw) path: an entry is ignored
 * when any ancestor directory matches as a dir (gitignore pruning — no
 * re-inclusion inside an excluded directory) or the path itself matches as a file.
 */
function flatPathIgnored(matcher: IgnoreMatcher, p: string): boolean {
  const parts = p.split('/');
  let prefix = '';
  for (let i = 0; i < parts.length - 1; i++) {
    prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
    if (matcher(prefix, true)) return true;
  }
  return matcher(p, false);
}

/**
 * Snapshot a git REF's tree natively (§1.5) under WORKTREE SEMANTICS (the
 * tree-semantics decision, header above): the ref's committed root ignore rules
 * filter the walk, so a ref snapshot equals the worktree snapshot of the same
 * checked-out CLEAN tree — tracked-but-gitignored files are OUT (they are git's
 * view, not the worktree walk's; F3 drill #1's false-refusal class dies here).
 *
 * PERF (T-2026-07-04-003, byte layer): two paths, byte-identical results —
 *   - FULL: `ls-tree -r` inventory + ONE `cat-file --batch` stream for all blobs
 *     (previously one `git show` spawn per file — O(minutes) on a real monorepo).
 *   - INCREMENTAL (when a verified `base` anchor is supplied and its tree is in
 *     the store): `git diff --raw base.ref ref` → batch-read only the changed
 *     blobs → overlay onto `base.treeId` via `writeMergedTree` (compositional —
 *     unchanged subtrees reused untouched). Falls OPEN to the full path on any
 *     anomaly (missing base tree, diff failure) — never fail-closed on the cache.
 *
 * T-033 (root-ignore symmetry): a repo may TRACK files under .warpline/ (this repo
 * tracks its own fabric ledger) — but snapshotDir skips .git/.warpline, and
 * restoreTree REFUSES to write those names (RESTORE_FORBIDDEN). A ref snapshot
 * must therefore skip them too, or the hook's `--ref HEAD` seal binds a tree that
 * (a) never matches the worktree snapshot of the same content and (b) can never
 * be restored. Skipped at any depth, matching restoreTree's per-level guard —
 * IDENTICALLY on both the full and incremental paths (the equivalence tests pin
 * full-treeId === incremental-treeId, including tracked-.warpline fixtures).
 */
export async function snapshotRef(
  store: ObjectStore,
  ref: string,
  opts: GitOptions = {},
  base?: SnapshotAnchor,
): Promise<string> {
  if (base && store.has(base.treeId)) {
    try {
      return await snapshotRefIncremental(store, ref, base, opts);
    } catch {
      // Fail OPEN: the full snapshot is the source of truth. (A submodule in the
      // diff throws here AND on the full path below — consistent fail-closed.)
    }
  }
  return snapshotRefFull(store, ref, opts);
}

/** The FULL path: whole-tree inventory + one batched blob read. */
async function snapshotRefFull(store: ObjectStore, ref: string, opts: GitOptions): Promise<string> {
  const entries = await lsTree(ref, opts);
  const ignored = await refIgnoreMatcher(ref, opts); // worktree semantics (decision header)
  const kept = entries.filter(
    (e) =>
      !pathHasRestoreForbiddenName(e.path) && // T-033 (C-3: normalized, any spelling)
      !flatPathIgnored(ignored, e.path),
  );
  for (const e of kept) {
    if (e.type === 'commit' || e.mode === '160000') {
      throw new Error(`warpline: snapshotRef — submodule/gitlink at ${e.path} not yet supported (T-2026-07-01-018)`);
    }
  }
  const blobs = await catFileBatch(kept.map((e) => e.sha), opts);
  const changes = new Map<string, PathChange>();
  for (const e of kept) changes.set(e.path, { content: blobs.get(e.sha)!, mode: e.mode });
  return writeMergedTree(store, null, changes);
}

/**
 * The INCREMENTAL path: overlay only the base→ref byte changes onto the base's
 * native tree. Correct by construction WHEN base.treeId === snapshotRef(base.ref)
 * (the caller's anchor-verification contract): git reports exactly the path set
 * that differs, and writeMergedTree reuses every untouched subtree.
 */
async function snapshotRefIncremental(
  store: ObjectStore,
  ref: string,
  base: SnapshotAnchor,
  opts: GitOptions,
): Promise<string> {
  const raw = await diffRaw(base.ref, ref, opts);
  // Worktree semantics (decision header): the overlay is only correct when BOTH
  // refs share the same root ignore rules — a changed root ignore file could
  // re-include/exclude UNCHANGED paths the diff never lists. Fall OPEN to the
  // full (freshly-filtered) walk on any root ignore-file change.
  if (raw.some((e) => (IGNORE_FILE_NAMES as readonly string[]).includes(e.path))) {
    throw new Error('warpline: snapshotRef — root ignore rules changed between anchor and ref (full walk)');
  }
  const ignored = await refIgnoreMatcher(ref, opts);
  const changes = new Map<string, PathChange>();
  const pending: Array<{ path: string; sha: string; mode: string }> = [];
  for (const e of raw) {
    if (pathHasRestoreForbiddenName(e.path)) continue; // T-033 parity (C-3: normalized)
    if (flatPathIgnored(ignored, e.path)) continue; // ignored paths never enter (nor leave) the tree
    if (e.status === 'D') {
      changes.set(e.path, null);
      continue;
    }
    if (e.newMode === '160000') {
      throw new Error(`warpline: snapshotRef — submodule/gitlink at ${e.path} not yet supported (T-2026-07-01-018)`);
    }
    pending.push({ path: e.path, sha: e.newSha, mode: e.newMode });
  }
  const blobs = await catFileBatch(pending.map((p) => p.sha), opts);
  for (const p of pending) changes.set(p.path, { content: blobs.get(p.sha)!, mode: p.mode });
  return writeMergedTree(store, base.treeId, changes);
}

/**
 * Snapshot the state a strand is being sealed from — worktree (fs) or a git ref.
 * `base` (optional) enables the incremental ref path; ignored for a worktree.
 * `indexRoot` (optional, I5) enables the worktree stat cache; ignored for a ref.
 */
export async function snapshotState(
  store: ObjectStore,
  ref: string,
  cwd: string,
  opts: GitOptions = {},
  base?: SnapshotAnchor,
  indexRoot?: string,
): Promise<string> {
  return ref === WORKTREE_REF
    ? snapshotDir(store, cwd, { indexRoot }).treeId
    : snapshotRef(store, ref, opts, base);
}

/**
 * Capture the durable bytes of a materialized CLEAN merge: snapshot the three
 * parents (native, git-independent) and build the merged result COMPOSITIONALLY
 * from the base tree + the merge's own byte changes (A2). Returns the re-derivable
 * recipe; `recipe.result` is the strand's binding.treeId.
 *
 * PERF (T-2026-07-04-003): `baseAnchor` (optional, verified by the caller) makes
 * the base snapshot incremental; the base tree just built is BY CONSTRUCTION the
 * native snapshot of `baseRef`, so ours/theirs anchor on it — their snapshots
 * cost only their own diffs from the fork base, not the whole universe.
 */
export async function captureMerge(
  store: ObjectStore,
  baseRef: string,
  oursRef: string,
  theirsRef: string,
  files: Map<string, PathChange>,
  opts: GitOptions = {},
  baseAnchor?: SnapshotAnchor,
): Promise<MergeRecipe> {
  const base = await snapshotRef(store, baseRef, opts, baseAnchor);
  const fork: SnapshotAnchor = { ref: baseRef, treeId: base };
  const ours = await snapshotRef(store, oursRef, opts, fork);
  const theirs = await snapshotRef(store, theirsRef, opts, fork);
  const result = writeMergedTree(store, base, files);
  // Pin the exact merge algorithm version — folded INTO the v2 pickId (Judge).
  return { algo: 'warpline-merge3-v1', base, ours, theirs, result };
}

/**
 * PATH-HARDENING (Aegis C3, CVE-2021-21300 class): assert a tree entry name is a
 * single, safe path component before it is ever joined to a destination. This is
 * the security boundary of `restore` — it writes attacker/corruption-influenceable
 * tree bytes to disk. A violation means a FORGED or CORRUPT tree, so we FAIL CLOSED
 * (throw, aborting the whole restore) rather than skip-and-continue: a partially
 * restored tree from a tampered object is not a recoverable state.
 */
function assertSafeEntryName(name: string): void {
  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    path.isAbsolute(name) ||
    /^[a-zA-Z]:/.test(name) // Windows drive-letter absolute (C:...)
  ) {
    throw new Error(
      `warpline: refusing to restore — tree entry name is not a safe single path component: ` +
        `${JSON.stringify(name)} (forged or corrupt tree; path-traversal blocked)`,
    );
  }
  // C-3: NORMALIZED lookup — `.GIT`, `.git `, `.git.`, `GIT~1` and HFS-ignorable
  // spellings all resolve to `.git` on a real filesystem. An exact, case-sensitive
  // match here let `.GIT/hooks/post-commit` land in the real `.git` and execute.
  if (isRestoreForbiddenName(name)) {
    throw new Error(
      `warpline: refusing to restore — tree entry name "${name}" would overwrite a real repo/VCS ` +
        `directory (forged or corrupt tree)`,
    );
  }
}

/**
 * Restore a native tree to `dest` byte-faithfully with git ABSENT (the primitive
 * behind the `warpline restore` verb; selector resolution is #restore). Mirrors
 * materialize.ts §4. Returns the count of entries written (files + dirs + symlinks
 * + gitlinks, recursively) for the caller's report.
 *
 * SECURITY (Aegis C3): every entry name is validated as a safe single component
 * (assertSafeEntryName) and the whole restore fails closed on the first violation.
 * SYMLINK/TRAVERSAL SAFETY (defense in depth): the PARENT dir we write into must be
 * a real directory and NOT a symlink; and we never write THROUGH a pre-existing
 * symlink at a target path (an attacker-planted link could escape `dest`). A symlink
 * ENTRY is created (it lives inside `dest`) but is never traversed — and because a
 * mode-120000 entry is always a LEAF, it structurally cannot carry children.
 */
export function restoreTree(store: ObjectStore, treeId: string, dest: string): number {
  fs.mkdirSync(dest, { recursive: true });
  // The dir we are about to write INTO must be a real directory, never a symlink —
  // otherwise a symlinked parent would let writes land outside the intended root.
  const parent = fs.lstatSync(dest);
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error(
      `warpline: refusing to restore into ${dest} — not a real directory (symlink or non-dir)`,
    );
  }
  let count = 0;
  for (const e of store.getTree(treeId)) {
    assertSafeEntryName(e.name); // FAIL CLOSED before any path is joined/written
    const full = path.join(dest, e.name);
    // Never write through a symlink already occupying this path (traversal escape).
    let existing: fs.Stats | undefined;
    try {
      existing = fs.lstatSync(full);
    } catch {
      existing = undefined; // ENOENT — nothing there, the normal case
    }
    if (existing?.isSymbolicLink()) {
      throw new Error(
        `warpline: refusing to restore ${e.name} — a symlink already occupies ${full} ` +
          `(never write through a symlink)`,
      );
    }
    count++;
    if (e.mode === '40000') {
      count += restoreTree(store, e.id, full);
    } else if (e.mode === '120000') {
      if (existing) fs.rmSync(full, { force: true }); // --force overlay: replace, never write through a linked inode
      const target = store.getBlob(e.id).toString('utf8');
      fs.symlinkSync(target, full);
    } else if (e.mode === '160000') {
      fs.mkdirSync(full, { recursive: true }); // gitlink: no bytes to fabricate
    } else if (e.mode === '100644' || e.mode === '100755') {
      // Break any pre-existing HARDLINK before writing — write a FRESH inode so a
      // --force overlay can never overwrite the content of a file hardlinked OUTSIDE
      // dest (lstat cannot distinguish a hardlink from a plain file; unlink does).
      if (existing) fs.rmSync(full, { force: true });
      fs.writeFileSync(full, store.getBlob(e.id));
      fs.chmodSync(full, e.mode === '100755' ? 0o755 : 0o644);
    } else {
      // Fail closed on any unknown/forged mode rather than coercing it to a file.
      throw new Error(`warpline: refusing to restore ${e.name} — unknown tree entry mode ${e.mode}`);
    }
  }
  return count;
}

/**
 * The WORKTREE-SEMANTICS PROJECTION of a store tree (tree-semantics decision,
 * T-2026-07-18-005): the treeId a snapshotDir walk of this tree's checked-out
 * bytes would produce — filter by the tree's OWN root ignore rules
 * (.warplineignore preferred, .gitignore fallback — read from the tree itself,
 * so the projection is deterministic from AUTHENTICATED bytes only) plus the
 * always-ignores, prune ignored directories, drop emptied directories.
 *
 * PURE COMPUTE: reads the store, writes NOTHING (ids are hashed via treeId(),
 * never put) — safe on any read path. A worktree-semantics tree is a FIXED
 * POINT (projection returns its own id); a LEGACY git-commit-tree binding
 * projects to the honest recovery expectation stake/recover need (the exact
 * value drill #1 proved the raw binding could never satisfy).
 */
export function projectTreeWorktreeSemantics(store: ObjectStore, rootTreeId: string): string {
  const rootEntries = store.getTree(rootTreeId);
  let rules: string | null = null;
  for (const name of IGNORE_FILE_NAMES) {
    const e = rootEntries.find((x) => x.name === name && (x.mode === '100644' || x.mode === '100755'));
    if (e) {
      rules = store.getBlob(e.id).toString('utf8');
      break;
    }
  }
  const ignored = ignoreMatcherFrom(rules);
  const project = (entries: TreeEntry[], rel: string): string => {
    const kept: TreeEntry[] = [];
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const isDir = e.mode === '40000';
      if (ignored(relPath, isDir)) continue; // pruned — no re-inclusion inside (gitignore semantics)
      if (isDir) {
        const sub = store.getTree(e.id);
        const childId = project(sub, relPath);
        if (childId === computeNativeTreeId([])) continue; // emptied dir → dropped (git parity)
        kept.push(childId === e.id ? e : { ...e, id: childId });
      } else {
        kept.push(e); // files/symlinks/gitlinks pass through untouched
      }
    }
    return computeNativeTreeId(kept);
  };
  return project(rootEntries, '');
}
