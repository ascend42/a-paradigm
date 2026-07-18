/**
 * #stake — THE CHECKPOINT VALVE (T-2026-07-17-001, founder ask; Phase 1 of
 * native-first). `warpline stake` exports ONE sealed fabric state as ONE git
 * commit on a dedicated stake branch — git's demoted role: a familiar,
 * read-only, off-site checkpoint shelf. Never topology, never sidecars, never
 * the human's working branch. Specs: arky-architecture.md §3 (valve design),
 * aegis-security.md §3 (S1–S5), roadmap-native-first.md Phase 1.
 *
 * Ratified decisions bound here:
 *   D3 — stakes are a FIRST-PARENT LINEARIZATION: each stake commit's single
 *        parent is the previous stake commit. Git receives checkpoints, never
 *        the weave DAG (exporting topology would make git a shadow authority).
 *   D5 — the leakage deny-list is CONSTITUTION-GRADE: a frozen, schema-versioned
 *        constant (stake-guard.ts), never a config flag.
 *
 * The five safeguards (aegis-security.md §3), where each lives:
 *   S1 one-way        — `.warpline-stake` marker committed into every stake
 *                       tree; pick/absorb/backfill/hook refuse marked input
 *                       (stake-guard.ts); no provenance backflow by construction
 *                       (the valve never writes the fabric).
 *   S2 no leakage     — allowlist-by-materialization: the stake tree is built by
 *                       restoreTree(binding.treeId) from the object store into a
 *                       clean temp dir (you cannot leak what you never copy),
 *                       THEN the post-build audit walks the built bytes against
 *                       the deny-list + untrusted-prose content markers — belt
 *                       on top of the construction guarantee. Nothing is written
 *                       to the git odb until the audit passes.
 *   S3 verify-or-refuse — the built tree is re-hashed from DISK (native treeId
 *                       + shadow gitOid, pure TS) and must equal BOTH the
 *                       strand's binding.treeId and the gitOid RECOMPUTED from
 *                       the object store (never read from s.binding.gitOid —
 *                       recompute, don't trust). After the commit object is
 *                       written, `git rev-parse <commit>^{tree}` must equal the
 *                       pure-TS expectation. Any mismatch = refuse + audit.
 *   S4 toggle         — default OFF; `stake.enabled:true` + a per-ref allowlist
 *                       (`stake.refs`) in .warpline/config.json; sealed states
 *                       only (the selector resolves through a strand's byte
 *                       binding — unsealed bytes have nothing to verify);
 *                       EVERY invocation appends an audit row
 *                       (.warpline/stakes/audit.jsonl — a G5 sidecar, never
 *                       inside the stake repo).
 *   S5 recovery       — `warpline stake recover <stakeCommit>`: verify the
 *                       reset worktree hashes to the staked binding.treeId,
 *                       then MOVE the working ref to the staked pickId — a ref
 *                       move under the fabric lock, NEVER an import, never a
 *                       new strand (post-recover edits seal new strands
 *                       parented on the staked pick via the normal write path).
 *
 * DETERMINISM: staking the same sealed state twice is IDEMPOTENT — if the stake
 * branch tip already carries this pickId, the invocation SKIPS (audit row
 * action:"skip", same commit returned). Chosen over "same commit bytes" because
 * commit timestamps make byte-identical re-commits dishonest; the tip check is
 * exact and cheap.
 *
 * Library code: no console output — the CLI prints.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObjectStore } from '../warp/object-store.js';
import { restoreTree, snapshotDir } from '../warp/snapshot.js';
import { blobId, gitBlobOid } from '../warp/blob.js';
import { treeId as nativeTreeIdOf, gitTreeOid, gitTreeBytes, type TreeEntry, type GitTreeEntry, type TreeMode } from '../warp/tree.js';
import { warplineDirOf, readFabric, readSelvage, writeSelvage } from './fabric.js';
import { readRef, writeRef } from './refs.js';
import { resolveSelector } from './select.js';
import { withFabricLock } from './lock.js';
import { readWarplineConfig, type StakeConfig } from './config.js';
import {
  STAKE_MARKER,
  STAKE_MARKER_CONTENT,
  STAKE_SCHEMA,
  STAKE_DEFAULT_BRANCH,
  STAKE_DENYLIST_SCHEMA,
  stakeDeniedName,
  stakeDeniedPath,
  stakeContentViolation,
} from './stake-guard.js';
import {
  gitDirOf,
  objectFormatOf,
  currentBranchOf,
  writeLooseGitObject,
  updateRefCas,
  commitMeta,
  buildCommitBody,
} from '../git/stake-git.js';
import { revParse, revParseTree, gitUserName } from '../git/git-exec.js';
import type { Strand } from './strand.js';
// I5's incremental machinery is not used here on purpose: a stake is a rare,
// deliberate checkpoint — full rehash keeps the verify honest and simple.

/* ── audit sidecar (S4/G5) ───────────────────────────────────────────────────── */

export const STAKE_AUDIT_SCHEMA = 'stakeAudit:v1';

export interface StakeAuditRow {
  schema: typeof STAKE_AUDIT_SCHEMA;
  at: string; // ISO
  actor: string;
  /** stake = a commit was cut; skip = idempotent no-op; refuse = any refusal;
   * recover / recover-refuse = the S5 re-entry verb. */
  action: 'stake' | 'skip' | 'refuse' | 'recover' | 'recover-refuse';
  selector: string;
  ref?: string | null;
  pickId?: string | null;
  stateId?: string | null;
  treeId?: string | null;
  branch?: string | null;
  gitCommit?: string | null;
  gitTreeOid?: string | null;
  reason?: string | null;
}

export function stakesDirOf(root: string): string {
  return path.join(root, '.warpline', 'stakes');
}

export function stakeAuditPathOf(root: string): string {
  return path.join(stakesDirOf(root), 'audit.jsonl');
}

function appendStakeAudit(root: string, row: StakeAuditRow): void {
  try {
    fs.mkdirSync(stakesDirOf(root), { recursive: true });
    fs.appendFileSync(stakeAuditPathOf(root), JSON.stringify(row) + '\n', 'utf8');
  } catch {
    // The audit is telemetry-grade durable, but an unwritable sidecar must not
    // convert a refusal into a crash-with-no-record; the thrown error remains.
  }
}

/** A refusal by the valve's own safeguards (vs an environmental error). */
export class StakeRefusal extends Error {}

/* ── trailers ────────────────────────────────────────────────────────────────── */

/** The machine trailer — the ENTIRE commit message (no prose, no actor names). */
export function stakeMessage(pickId: string, stateId: string, treeId: string): string {
  return `warpline-stake\n\nPickId: ${pickId}\nStateId: ${stateId}\nTreeId: ${treeId}\nSchema: ${STAKE_SCHEMA}\n`;
}

export interface StakeTrailers {
  pickId: string;
  stateId: string;
  treeId: string | null;
  schema: string;
}

/** Parse the stake trailer out of a commit message; null when not a stake. */
export function parseStakeTrailers(message: string): StakeTrailers | null {
  if (!/^warpline-stake(\n|$)/.test(message)) return null;
  const grab = (key: string): string | null => {
    const m = message.match(new RegExp(`^${key}: (\\S+)$`, 'm'));
    return m ? m[1] : null;
  };
  const pickId = grab('PickId');
  const stateId = grab('StateId');
  const schema = grab('Schema');
  if (!pickId || !stateId || !schema) return null;
  return { pickId, stateId, treeId: grab('TreeId'), schema };
}

/* ── the S3/S2 walks (pure TS, no git) ───────────────────────────────────────── */

/**
 * The BINDING-VERIFIED EXPECTATION: recompute the shadow git tree oid of a
 * native store tree, walking the store's verified reads (blob bytes re-hash to
 * their content-address on read — trust floor). NEVER reads s.binding.gitOid.
 * Gitlink (160000) entries refuse fail-closed: a stake owns its bytes; a
 * submodule pointer is bytes we do not own and cannot verify.
 */
function storeGitTree(store: ObjectStore, treeIdStr: string): { entries: GitTreeEntry[]; gitOid: string } {
  const entries: GitTreeEntry[] = [];
  for (const e of store.getTree(treeIdStr)) {
    if (e.mode === '160000') {
      throw new StakeRefusal(
        `warpline: stake refused — tree carries a gitlink/submodule entry "${e.name}" (bytes Warpline does not own cannot be staked/verified)`,
      );
    }
    if (e.mode === '40000') {
      entries.push({ mode: e.mode, name: e.name, sha1: storeGitTree(store, e.id).gitOid });
    } else {
      entries.push({ mode: e.mode, name: e.name, sha1: gitBlobOid(store.getBlob(e.id)) });
    }
  }
  return { entries, gitOid: gitTreeOid(entries) };
}

interface BuiltAudit {
  treeId: string;
  gitOid: string;
  /** deny-list hits: repo-relative paths whose NAME or CONTENT is denied. */
  violations: string[];
  files: number;
}

/**
 * S2 belt + S3 recompute in ONE raw walk of the freshly-built stake tree: every
 * entry is checked against the v2 constitution deny rules — NAME rules (exact
 * component, any depth), ANCHORED path rules (root-relative sidecar paths), and
 * the SHAPE-AWARE content audit (parsed .json/.jsonl envelope/sidecar detection
 * — see stake-guard.ts; source/markdown/tests can never match) — and the native
 * treeId + shadow gitOid are re-derived FROM DISK (no ignore rules — everything
 * restoreTree wrote must account for itself). Pure: writes nothing anywhere.
 */
function auditBuiltTree(dir: string, rel = ''): BuiltAudit & { native: TreeEntry[]; git: GitTreeEntry[] } {
  const native: TreeEntry[] = [];
  const git: GitTreeEntry[] = [];
  const violations: string[] = [];
  let files = 0;

  const scan = (bytes: Buffer, relPath: string): void => {
    const hit = stakeContentViolation(bytes, relPath);
    if (hit) violations.push(`${relPath} (${hit})`);
  };

  for (const name of fs.readdirSync(dir).sort()) {
    const relPath = rel ? `${rel}/${name}` : name;
    if (stakeDeniedName(name) || stakeDeniedPath(relPath)) violations.push(relPath);
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) {
      const target = Buffer.from(fs.readlinkSync(full), 'utf8');
      scan(target, relPath);
      native.push({ mode: '120000', name, id: blobId(target) });
      git.push({ mode: '120000', name, sha1: gitBlobOid(target) });
      files++;
    } else if (st.isDirectory()) {
      const child = auditBuiltTree(full, relPath);
      violations.push(...child.violations);
      files += child.files;
      if (child.native.length === 0) continue; // git parity: empty dirs are not tracked
      native.push({ mode: '40000', name, id: nativeTreeIdOf(child.native) });
      git.push({ mode: '40000', name, sha1: gitTreeOid(child.git) });
    } else if (st.isFile()) {
      const bytes = fs.readFileSync(full);
      scan(bytes, relPath);
      const mode: TreeMode = st.mode & 0o111 ? '100755' : '100644';
      native.push({ mode, name, id: blobId(bytes) });
      git.push({ mode, name, sha1: gitBlobOid(bytes) });
      files++;
    }
  }

  return { treeId: nativeTreeIdOf(native), gitOid: gitTreeOid(git), violations, files, native, git };
}

/**
 * Pass B (post-audit only): write the built tree's blobs + trees as loose git
 * objects into the stake repo's odb. Returns the root's git entries + oid.
 * Runs ONLY after the S2 audit passed — a refused tree never touches the odb
 * (unreferenced denied blobs in .git/objects would themselves be a leak).
 */
function writeGitObjectsFromDir(dir: string, gitDir: string): { entries: GitTreeEntry[]; gitOid: string } {
  const entries: GitTreeEntry[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) {
      const sha1 = writeLooseGitObject(gitDir, 'blob', Buffer.from(fs.readlinkSync(full), 'utf8'));
      entries.push({ mode: '120000', name, sha1 });
    } else if (st.isDirectory()) {
      const child = writeGitObjectsFromDir(full, gitDir);
      if (child.entries.length === 0) continue;
      entries.push({ mode: '40000', name, sha1: child.gitOid });
    } else if (st.isFile()) {
      const sha1 = writeLooseGitObject(gitDir, 'blob', fs.readFileSync(full));
      entries.push({ mode: st.mode & 0o111 ? '100755' : '100644', name, sha1 });
    }
  }
  const gitOid = entries.length === 0 ? gitTreeOid([]) : writeLooseGitObject(gitDir, 'tree', gitTreeBytes(entries));
  return { entries, gitOid };
}

/* ── config + selector resolution ────────────────────────────────────────────── */

/** Branch names the valve refuses outright — a stake branch is never a working branch. */
const FORBIDDEN_STAKE_BRANCHES = new Set(['main', 'master', 'trunk', 'develop', 'HEAD']);

function assertLegalStakeBranch(branch: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..') || branch.endsWith('/')) {
    throw new StakeRefusal(`warpline: stake refused — illegal stake branch name ${JSON.stringify(branch)}`);
  }
  if (FORBIDDEN_STAKE_BRANCHES.has(branch)) {
    throw new StakeRefusal(
      `warpline: stake refused — "${branch}" is a working-branch name; stakes go to a DEDICATED branch (default "${STAKE_DEFAULT_BRANCH}") for the same reason a backup tool refuses to overwrite its source`,
    );
  }
}

/**
 * Resolve an ALLOWLISTED native ref name to its sealed strand + byte binding.
 * `selvage`/`HEAD` go through the standard selector (refs mode or legacy);
 * any other allowlisted name must be a pickId ref under refs/heads/. Scratch
 * refs are never stakeable (they are not refs/heads/ refs, and the name guard
 * refuses them by pattern as a belt).
 */
function resolveStakeRef(wdir: string, refName: string): { treeId: string; strand: Strand } {
  if (/scratch/i.test(refName)) {
    throw new StakeRefusal(`warpline: stake refused — scratch refs are never stakeable (ref "${refName}")`);
  }
  if (refName === 'selvage' || refName === 'HEAD') {
    const { treeId, strand } = resolveSelector(wdir, 'selvage');
    if (!strand) throw new StakeRefusal('warpline: stake refused — selector resolved to no sealed strand');
    return { treeId, strand };
  }
  const pickId = readRef(wdir, refName);
  if (pickId === null) {
    throw new StakeRefusal(`warpline: stake refused — ref "${refName}" does not exist under .warpline/refs/heads/`);
  }
  const strand = readFabric(wdir).find((s) => s.pickId === pickId);
  if (!strand) {
    throw new StakeRefusal(`warpline: stake refused — ref "${refName}" points at ${pickId} but no strand carries that pickId`);
  }
  const treeId = strand.binding?.treeId;
  if (!treeId) {
    throw new StakeRefusal(
      `warpline: stake refused — strand ${pickId} has no byte binding (sealed pre-bind-on-seal); only SEALED, BOUND states are stakeable (S4)`,
    );
  }
  return { treeId, strand };
}

/* ── the verbs ───────────────────────────────────────────────────────────────── */

export interface StakeOptions {
  /** the allowlisted native ref to stake (default "selvage"; "HEAD" ⇒ selvage). */
  selector?: string;
  /** actor recorded in the audit row (default: git user.name). */
  actor?: string;
  /** injectable clock (ISO) — determinism in tests. */
  now?: string;
  /** TEST HOOK: runs on the built tree between materialization and the S3
   * recompute — simulates a raced/tampered build dir; production callers never
   * set this. */
  afterBuild?: (buildDir: string) => void;
}

export interface StakeResult {
  action: 'staked' | 'skipped';
  ref: string;
  pickId: string;
  stateId: string;
  treeId: string;
  branch: string;
  /** the stake commit (new, or the existing tip on an idempotent skip). */
  gitCommit: string;
  /** the git tree oid of the stake commit's tree (content + marker). */
  gitTreeOid: string | null;
  /** the previous stake tip this commit parents on (null = first stake). */
  parent: string | null;
  auditPath: string;
}

const STAKE_COMMITTER = 'Warpline Stake <noreply@warpline.local>';

/**
 * Cut a stake: export the sealed state at an allowlisted ref as ONE git commit
 * on the dedicated stake branch. Every safeguard S1–S4 enforced here; every
 * invocation — success, skip, or refusal — appends an audit row.
 */
export async function stake(root: string, opts: StakeOptions = {}): Promise<StakeResult> {
  const selectorRaw = (opts.selector ?? 'selvage').trim() || 'selvage';
  const refName = selectorRaw === 'HEAD' ? 'selvage' : selectorRaw;
  const wdir = warplineDirOf(root);
  const now = opts.now ?? new Date().toISOString();
  const actor = opts.actor ?? (await gitUserName({ cwd: root }).catch(() => null)) ?? 'unknown';
  const ctx: Partial<StakeAuditRow> = { selector: selectorRaw, ref: refName };

  try {
    // S4 — the toggle + the per-ref allowlist. Default OFF; a missing config is OFF.
    const sc: StakeConfig | undefined = readWarplineConfig(root).stake;
    if (sc?.enabled !== true) {
      throw new StakeRefusal(
        'warpline: stake refused — the checkpoint valve is OFF (default). Enable it explicitly: .warpline/config.json → {"stake":{"enabled":true,"refs":["selvage"]}} (S4)',
      );
    }
    const allow = sc.refs ?? [];
    if (!allow.includes(refName)) {
      throw new StakeRefusal(
        `warpline: stake refused — ref "${refName}" is not in the per-ref allowlist (stake.refs = ${JSON.stringify(allow)}; S4)`,
      );
    }
    const branch = sc.branch ?? STAKE_DEFAULT_BRANCH;
    ctx.branch = branch;
    assertLegalStakeBranch(branch);
    const stakeRepo = path.resolve(root, sc.repo ?? '.');

    // Sealed-states only: resolve the ref through a strand's byte binding.
    const { treeId: boundTreeId, strand } = resolveStakeRef(wdir, refName);
    ctx.pickId = strand.pickId;
    ctx.stateId = strand.stateId;
    ctx.treeId = boundTreeId;

    // Stake-repo preconditions: sha1 odb; never the checked-out branch.
    const fmt = await objectFormatOf(stakeRepo);
    if (fmt !== 'sha1') {
      throw new StakeRefusal(`warpline: stake refused — stake repo ${stakeRepo} uses object format "${fmt}" (sha1 only)`);
    }
    const checkedOut = await currentBranchOf(stakeRepo);
    if (checkedOut !== null && checkedOut === branch) {
      throw new StakeRefusal(
        `warpline: stake refused — stake branch "${branch}" is currently checked out in ${stakeRepo}; the valve never writes the human's working branch`,
      );
    }
    const fullRef = `refs/heads/${branch}`;
    const tip = await revParse(fullRef, { cwd: stakeRepo }).catch(() => null);

    // Idempotency: same sealed state at the tip ⇒ skip with an audit note.
    if (tip) {
      const meta = await commitMeta(stakeRepo, tip);
      const trailers = parseStakeTrailers(meta.message);
      if (trailers?.pickId === strand.pickId) {
        appendStakeAudit(root, {
          schema: STAKE_AUDIT_SCHEMA, at: now, actor, action: 'skip',
          selector: selectorRaw, ref: refName, pickId: strand.pickId, stateId: strand.stateId,
          treeId: boundTreeId, branch, gitCommit: tip, gitTreeOid: meta.treeSha,
          reason: 'idempotent — the stake branch tip already carries this pickId',
        });
        return {
          action: 'skipped', ref: refName, pickId: strand.pickId, stateId: strand.stateId,
          treeId: boundTreeId, branch, gitCommit: tip, gitTreeOid: meta.treeSha,
          parent: meta.parents[0] ?? null, auditPath: stakeAuditPathOf(root),
        };
      }
    }

    // S2 (mechanism) — allowlist-by-materialization: build the tree FROM THE
    // STORE into a clean temp dir. Compute the store-side expectation FIRST so
    // a gitlink-bearing tree refuses before any bytes hit disk.
    const store = new ObjectStore(root);
    const expectation = storeGitTree(store, boundTreeId);
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-stake-'));
    try {
      restoreTree(store, boundTreeId, buildDir);
      opts.afterBuild?.(buildDir);

      // S2 (belt) + S3 — one raw walk: deny-list audit + recompute-from-disk.
      const built = auditBuiltTree(buildDir);
      if (built.violations.length > 0) {
        throw new StakeRefusal(
          `warpline: stake refused — deny-list violation in the built tree (S2 post-build audit): ${built.violations.join(', ')} ` +
            `[${STAKE_DENYLIST_SCHEMA}]. Nothing was written to the git odb.`,
        );
      }
      if (built.treeId !== boundTreeId) {
        throw new StakeRefusal(
          `warpline: stake refused — recompute mismatch (S3): built tree ${built.treeId} != binding.treeId ${boundTreeId}. ` +
            `A stake that does not reproduce its binding is disinformation with a git sha.`,
        );
      }
      if (built.gitOid !== expectation.gitOid) {
        throw new StakeRefusal(
          `warpline: stake refused — recompute mismatch (S3): built shadow gitOid ${built.gitOid} != store expectation ${expectation.gitOid}`,
        );
      }

      // Pass B — write loose git objects (audit passed; bytes are now cleared).
      const gitDir = await gitDirOf(stakeRepo);
      const written = writeGitObjectsFromDir(buildDir, gitDir);
      if (written.gitOid !== built.gitOid) {
        throw new StakeRefusal('warpline: stake refused — odb write walk diverged from the audit walk (S3 internal belt)');
      }

      // S1 — the committed marker + the trailer-only message.
      const markerSha = writeLooseGitObject(gitDir, 'blob', Buffer.from(STAKE_MARKER_CONTENT, 'utf8'));
      const stakeEntries: GitTreeEntry[] = [...written.entries, { mode: '100644', name: STAKE_MARKER, sha1: markerSha }];
      const stakeTreeOid = writeLooseGitObject(gitDir, 'tree', gitTreeBytes(stakeEntries));

      // D3 — FIRST-PARENT ONLY: parent = the previous stake tip, never a merge.
      const message = stakeMessage(strand.pickId, strand.stateId, boundTreeId);
      const author = sc.author ?? STAKE_COMMITTER;
      const commitSha = writeLooseGitObject(
        gitDir,
        'commit',
        buildCommitBody({
          treeSha: stakeTreeOid,
          parent: tip,
          author,
          committer: STAKE_COMMITTER,
          epochSeconds: Math.floor(new Date(now).getTime() / 1000),
          message,
        }),
      );

      // S3 (git's own reader) — the created commit's tree MUST equal the pure-TS
      // expectation before the ref ever moves.
      const actualTree = await revParseTree(commitSha, { cwd: stakeRepo });
      if (actualTree !== stakeTreeOid) {
        throw new StakeRefusal(
          `warpline: stake refused — git reads commit tree ${actualTree}, expected ${stakeTreeOid} (S3); ref not advanced`,
        );
      }

      // Publish: per-ref CAS onto the dedicated stake branch.
      await updateRefCas(stakeRepo, fullRef, commitSha, tip);

      appendStakeAudit(root, {
        schema: STAKE_AUDIT_SCHEMA, at: now, actor, action: 'stake',
        selector: selectorRaw, ref: refName, pickId: strand.pickId, stateId: strand.stateId,
        treeId: boundTreeId, branch, gitCommit: commitSha, gitTreeOid: stakeTreeOid, reason: null,
      });
      return {
        action: 'staked', ref: refName, pickId: strand.pickId, stateId: strand.stateId,
        treeId: boundTreeId, branch, gitCommit: commitSha, gitTreeOid: stakeTreeOid,
        parent: tip, auditPath: stakeAuditPathOf(root),
      };
    } finally {
      fs.rmSync(buildDir, { recursive: true, force: true });
    }
  } catch (err) {
    appendStakeAudit(root, {
      schema: STAKE_AUDIT_SCHEMA, at: now, actor, action: 'refuse',
      selector: selectorRaw, ref: ctx.ref ?? refName, pickId: ctx.pickId ?? null,
      stateId: ctx.stateId ?? null, treeId: ctx.treeId ?? null, branch: ctx.branch ?? null,
      gitCommit: null, gitTreeOid: null, reason: (err as Error).message,
    });
    throw err;
  }
}

/* ── auto-stake-on-seal (R2 — "the valve stakes every seal") ─────────────────── */

/** The daily-cadence window: a stake/skip within this window means "not due". */
const AUTO_STAKE_DAILY_MS = 24 * 60 * 60 * 1000;

/** Last time the valve actually ran to completion (action stake|skip), or null. */
function lastStakeCutAt(root: string): number | null {
  let raw: string;
  try {
    raw = fs.readFileSync(stakeAuditPathOf(root), 'utf8');
  } catch {
    return null;
  }
  let last: number | null = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as StakeAuditRow;
      if (row.action === 'stake' || row.action === 'skip') {
        const t = Date.parse(row.at);
        if (Number.isFinite(t)) last = t;
      }
    } catch {
      /* telemetry stream — never fatal */
    }
  }
  return last;
}

export interface AutoStakeOptions {
  /** injectable clock (ISO) — determinism in tests; also the stake's audit clock. */
  now?: string;
  /** actor recorded in the audit row (default: git user.name). */
  actor?: string;
}

/**
 * R2 auto-stake cadence (loid-loops.md R2: "→ checkpoint valve: stake the
 * sealed stateId to git"). Called BEST-EFFORT by the seal call sites (#pick,
 * #admit) after a successful NON-SHADOW seal. Config-gated (S4 — the master
 * toggle still rules):
 *   - `stake.auto` absent/false      → null (default: no cadence, R1 behavior)
 *   - `stake.enabled` !== true       → null (auto never overrides the valve toggle)
 *   - the sealed ref ('selvage') not in `stake.refs` → null (allowlist checked
 *     HERE so a disabled cadence never spams refuse rows on every seal)
 *   - 'daily' and a stake/skip ran within 24h → null (not due)
 *   - otherwise → stake() — and EVERY actual invocation is audited by stake()
 *     itself (stake / skip / refuse rows), so a failing auto-stake is always
 *     on the record while NEVER blocking or failing the seal that triggered it.
 * Returns the StakeResult, or null when nothing was attempted / it refused.
 */
export async function maybeAutoStakeOnSeal(root: string, opts: AutoStakeOptions = {}): Promise<StakeResult | null> {
  let sc: StakeConfig | undefined;
  try {
    sc = readWarplineConfig(root).stake;
  } catch {
    return null; // corrupt config must never break the seal path
  }
  if (sc?.enabled !== true) return null;
  if (sc.auto !== 'every-seal' && sc.auto !== 'daily') return null;
  const refName = 'selvage'; // both seal call sites advance the selvage
  if (!(sc.refs ?? []).includes(refName)) return null;
  if (sc.auto === 'daily') {
    const last = lastStakeCutAt(root);
    const nowMs = opts.now ? Date.parse(opts.now) : Date.now();
    if (last !== null && nowMs - last < AUTO_STAKE_DAILY_MS) return null;
  }
  try {
    return await stake(root, { selector: refName, now: opts.now, actor: opts.actor });
  } catch {
    return null; // refusal/error already audited by stake(); the seal stands
  }
}

export interface StakeRecoverResult {
  pickId: string;
  stateId: string;
  treeId: string;
  gitCommit: string;
  /** the native ref that was re-pointed. */
  ref: 'selvage';
  /** what the ref held before the move (pickId in refs mode, stateId legacy). */
  previous: string | null;
}

/**
 * S5 — the re-entry verb after `git reset --hard <stake>`: consume exactly ONE
 * datum from git (the pickId trailer), verify EVERYTHING against the fabric
 * (the strand must exist; the trailer treeId must match its binding; the reset
 * worktree must re-hash to the binding), then MOVE refs/heads/selvage (or the
 * legacy selvage) to the staked pick under the fabric lock. Never an import,
 * never a new strand — a worktree edited after the reset REFUSES (re-reset and
 * recover, then seal your edits normally; they will parent on the staked pick).
 */
export async function stakeRecover(
  root: string,
  commitish: string,
  opts: { actor?: string; now?: string } = {},
): Promise<StakeRecoverResult> {
  const wdir = warplineDirOf(root);
  const now = opts.now ?? new Date().toISOString();
  const actor = opts.actor ?? (await gitUserName({ cwd: root }).catch(() => null)) ?? 'unknown';
  const ctx: Partial<StakeAuditRow> = {};

  try {
    let cfg: StakeConfig | undefined;
    try {
      cfg = readWarplineConfig(root).stake;
    } catch {
      cfg = undefined; // recovery works even under a corrupt toggle file
    }
    const stakeRepo = path.resolve(root, cfg?.repo ?? '.');
    // Resolve in the working repo first (where the reset happened); fall back to
    // the configured stake repo (separate-repo topologies after a fetch).
    let repoForRead = root;
    let sha = await revParse(commitish, { cwd: root }).catch(() => null);
    if (sha === null && stakeRepo !== root) {
      sha = await revParse(commitish, { cwd: stakeRepo }).catch(() => null);
      repoForRead = stakeRepo;
    }
    if (sha === null) {
      throw new StakeRefusal(`warpline: stake recover refused — cannot resolve "${commitish}" to a commit`);
    }
    ctx.gitCommit = sha;
    const meta = await commitMeta(repoForRead, sha);
    const trailers = parseStakeTrailers(meta.message);
    if (!trailers || trailers.schema !== STAKE_SCHEMA) {
      throw new StakeRefusal(
        `warpline: stake recover refused — ${sha.slice(0, 12)} is not a warpline stake commit (missing/invalid trailer)`,
      );
    }
    ctx.pickId = trailers.pickId;

    // The fabric is authoritative; the stake label is only a pointer (S5).
    const strand = readFabric(wdir).find((s) => s.pickId === trailers.pickId);
    if (!strand) {
      throw new StakeRefusal(
        `warpline: stake recover refused — stake names pickId ${trailers.pickId}, which is absent from the fabric. A stake is never an import; the fabric is authoritative.`,
      );
    }
    const bound = strand.binding?.treeId;
    if (!bound) {
      throw new StakeRefusal(`warpline: stake recover refused — strand ${strand.pickId} carries no byte binding`);
    }
    if (trailers.treeId && trailers.treeId !== bound) {
      throw new StakeRefusal(
        `warpline: stake recover refused — stake TreeId trailer ${trailers.treeId} disagrees with the fabric binding ${bound} (tampered stake label)`,
      );
    }
    ctx.stateId = strand.stateId;
    ctx.treeId = bound;

    // The reset worktree must carry the marker (proof this IS a stake reset)…
    const markerPath = path.join(root, STAKE_MARKER);
    if (!fs.existsSync(markerPath)) {
      throw new StakeRefusal(
        `warpline: stake recover refused — no ${STAKE_MARKER} marker in the working tree; recover re-enters a \`git reset --hard <stake>\` state only`,
      );
    }
    // …and, MINUS the marker, must re-hash to the staked binding (S3, re-run on
    // re-entry — a stake repo tampered after the fact fails here). The marker is
    // Warpline's own file: it is removed as part of re-entry (leaving it would
    // keep S1 refusing every subsequent seal) and restored on refusal.
    const markerBytes = fs.readFileSync(markerPath);
    fs.rmSync(markerPath, { force: true });
    let worktreeTreeId: string;
    try {
      worktreeTreeId = auditBuiltTreeIdOfWorktree(root, bound);
    } catch (err) {
      fs.writeFileSync(markerPath, markerBytes); // refusal leaves the world as found
      throw err;
    }
    void worktreeTreeId;

    // The ref MOVE — under the fabric lock; never a new strand.
    let previous: string | null = null;
    await withFabricLock(root, () => {
      const refTip = readRef(wdir, 'selvage');
      if (refTip !== null) {
        previous = refTip;
        writeRef(wdir, 'selvage', strand.pickId, refTip); // per-ref CAS
      } else {
        previous = readSelvage(wdir);
        writeSelvage(wdir, strand.stateId, previous); // legacy CAS
      }
    });

    appendStakeAudit(root, {
      schema: STAKE_AUDIT_SCHEMA, at: now, actor, action: 'recover',
      selector: commitish, ref: 'selvage', pickId: strand.pickId, stateId: strand.stateId,
      treeId: bound, branch: null, gitCommit: sha, gitTreeOid: meta.treeSha, reason: null,
    });
    return { pickId: strand.pickId, stateId: strand.stateId, treeId: bound, gitCommit: sha, ref: 'selvage', previous };
  } catch (err) {
    appendStakeAudit(root, {
      schema: STAKE_AUDIT_SCHEMA, at: now, actor, action: 'recover-refuse',
      selector: commitish, ref: 'selvage', pickId: ctx.pickId ?? null, stateId: ctx.stateId ?? null,
      treeId: ctx.treeId ?? null, branch: null, gitCommit: ctx.gitCommit ?? null,
      gitTreeOid: null, reason: (err as Error).message,
    });
    throw err;
  }
}

/**
 * Recover's tree check: snapshot the live worktree (standard ignore semantics —
 * the same walk that would seal it) into the store and require it to equal the
 * staked binding. Kept as its own step so the marker restore-on-refusal in
 * stakeRecover stays airtight. Uses the ignore-honoring snapshot (unlike the
 * stake build audit) because a live repo root legitimately carries .warpline/,
 * .git/ and ignored files the staked tree never contained.
 */
function auditBuiltTreeIdOfWorktree(root: string, expected: string): string {
  const snap = snapshotDir(new ObjectStore(root), root);
  if (snap.treeId !== expected) {
    throw new StakeRefusal(
      `warpline: stake recover refused — the working tree hashes to ${snap.treeId}, not the staked binding ${expected}. ` +
        `The tree was edited after the reset (or the stake was tampered). Re-run \`git reset --hard <stake>\` and recover; ` +
        `then seal your edits normally — they will parent on the staked pick.`,
    );
  }
  return snap.treeId;
}
