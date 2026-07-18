/**
 * #stake-guard — the S1 ONE-WAY guards + the CONSTITUTION-GRADE deny-list of the
 * checkpoint valve (`warpline stake`, T-2026-07-17-001; aegis-security.md §3;
 * arky-architecture.md §3).
 *
 * The valve exports SEALED trees to git as checkpoint commits. This module is the
 * mechanical HALF that keeps the valve one-way: pick/absorb/backfill (and the
 * auto-seal hook, which runs through pick) REFUSE any input that is a stake —
 * a worktree carrying the `.warpline-stake` marker, a ref in the stake namespace,
 * or a commit whose tree contains the marker. A guard, not a convention (S1).
 *
 * D5 (founder-ratified): STAKE_DENYLIST is CONSTITUTION-GRADE. It is a frozen
 * constant paired with a schema version — NOT a config flag. Expanding (or
 * shrinking) the list is a SCHEMA CHANGE: bump STAKE_DENYLIST_SCHEMA and the
 * pinned digest in test/stake.test.ts together, as a founder-visible edit. A
 * denylist that can drift by configuration is not a denylist.
 *
 * Deliberately cycle-free: imports only fs/path, config.ts and git-exec.ts —
 * absorb.ts imports this module, so it must never (transitively) import absorb.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { readWarplineConfig } from './config.js';
import { treeEntryMode } from '../git/git-exec.js';

/** The committed root marker of every stake commit (S1) — provenance label AND
 * machine-readable refusal signal. A tree carrying this name is never input. */
export const STAKE_MARKER = '.warpline-stake';

/** The stake record schema tag (rides the commit trailer + audit rows). */
export const STAKE_SCHEMA = 'stake:v1';

/** The default dedicated stake branch — never the human's working branch. */
export const STAKE_DEFAULT_BRANCH = 'warpline-stakes';

/**
 * The DETERMINISTIC byte content of the committed `.warpline-stake` marker.
 * Constant on purpose: the same sealed state always stakes to the same tree
 * (idempotency is checkable), and the marker carries its own refusal contract.
 */
export const STAKE_MARKER_CONTENT =
  'warpline-stake\n' +
  `schema: ${STAKE_SCHEMA}\n` +
  'This commit is a ONE-WAY Warpline checkpoint export (a stake). It is never\n' +
  'input: warpline pick/absorb/backfill and the auto-seal hook refuse any tree\n' +
  'carrying this marker (S1). Recovery after `git reset --hard <stake>`:\n' +
  '  warpline stake recover <stakeCommit>\n';

/**
 * D5 — the schema version of the leakage deny-list. Any change to the deny
 * constants below (STAKE_DENY_NAMES / STAKE_DENY_PATHS /
 * STAKE_DENY_ENVELOPE_KINDS / STAKE_DENY_ROW_SCHEMAS / STAKE_DENY_ROW_SHAPES)
 * REQUIRES bumping this tag (stake-denylist:v3, …) and re-pinning the
 * freeze-test digest. See the "constitution" test in test/stake.test.ts.
 *
 * v1 → v2 (R2, T-2026-07-18-001): the first REAL stake was refused on FOUR
 * FALSE POSITIVES — basename-global path rules matched a paradigm-events file
 * (`.paradigm/events/verdicts.jsonl`), and byte-substring content markers
 * matched source/spec/tests that legitimately QUOTE the envelope marker
 * (stake-guard.ts itself, stake.test.ts, aegis-security.md). v2 redesigns both
 * rule classes:
 *   (a) path rules are ANCHORED — sidecar files are denied where they actually
 *       live (under `.warpline/`), never by basename anywhere in the project;
 *   (b) content rules are SHAPE-AWARE — only .json/.jsonl files whose PARSED
 *       content is envelope- or sidecar-row-shaped refuse; source code,
 *       markdown, and tests can never match (they are never parsed as JSON).
 */
export const STAKE_DENYLIST_SCHEMA = 'stake-denylist:v2';

/**
 * v2(a) — exact path COMPONENTS denied at ANY depth. Structural internals and
 * secrets-by-name only (never generic sidecar basenames — that was v1's false
 * positive class):
 *   - `.git`             — VCS internals, in any form
 *   - `.warpline`        — the fabric dir WHOLESALE. Decision (R2, documented):
 *                          this repo TRACKS .warpline/{config.json,fabric.jsonl,
 *                          fabric-legacy.json,refs/selvage} in git — already-public
 *                          record, fine AS TRACKED GIT DATA. They still never
 *                          belong in a stake tree: (1) by construction the
 *                          snapshot walk skips `.warpline` at any depth, so a
 *                          LEGITIMATE stake tree cannot contain it; (2) a stake
 *                          exists to be a `git reset --hard` target, and any
 *                          .warpline content inside a stake would stomp the LIVE
 *                          fabric on reset (S5 integrity). So the name-deny is a
 *                          STRUCTURAL guard against crafted trees, not a
 *                          data-secrecy rule. The deny-list's secrecy targets
 *                          are the SIDECAR trust/secret streams (below).
 *   - `.warpline-stake`  — a tree spoofing the stake marker itself
 *   - daemon-tokens.jsonl / session-keys.jsonl — bearer secrets by name,
 *                          never legitimate project content anywhere
 * Frozen (Object.freeze) + schema-versioned (D5): expanding = schema change.
 */
export const STAKE_DENY_NAMES: readonly string[] = Object.freeze([
  '.git',
  '.warpline',
  '.warpline-stake',
  'daemon-tokens.jsonl',
  'session-keys.jsonl',
]);

/**
 * v2(a) — ROOT-ANCHORED sidecar paths (exact file, or the whole subtree): the
 * trust/secret streams of aegis-security.md §2.3, denied WHERE THEY LIVE.
 * Deliberately redundant belts under the `.warpline` name-deny above — pinned
 * separately so a future narrowing of the wholesale rule can never silently
 * expose a sidecar (the freeze digest covers each one by name).
 */
export const STAKE_DENY_PATHS: readonly string[] = Object.freeze([
  '.warpline/shadow',
  '.warpline/stakes',
  '.warpline/claims',
  '.warpline/knots',
  '.warpline/daemon',
  '.warpline/grades.jsonl',
  '.warpline/grades-escalations.jsonl',
  '.warpline/oracle.jsonl',
]);

/**
 * v2(b) — envelope kinds: a PARSED .json/.jsonl value containing (at any depth)
 * an object whose `kind` field EQUALS one of these refuses the stake — a
 * serialized UntrustedProse envelope must never land on a GitHub-renderable
 * surface (forge §3d — the valve's answer is "it never crosses at all").
 * Prose that merely QUOTES the marker (source, docs, tests) never matches:
 * the check is against a parsed field VALUE, not a byte substring.
 */
export const STAKE_DENY_ENVELOPE_KINDS: readonly string[] = Object.freeze(['untrusted-prose']);

/**
 * v2(b) — sidecar STREAM detection by schema tag: a `.jsonl` row whose
 * `schema`/`schemaVersion` field is `<base>:vN` with a base listed here is a
 * warpline sidecar row wherever the file sits (a renamed copy of
 * shadow/verdicts.jsonl is still shadow verdicts). `.jsonl` ONLY — the
 * sidecars are all JSONL streams; a deliberately exported `.json` REPORT
 * (e.g. a committed `warpline grade --json` output in a research dir) is a
 * human act of publication, exactly like quoting rows in markdown.
 */
export const STAKE_DENY_ROW_SCHEMAS: readonly string[] = Object.freeze([
  'claim',
  'knotPayload',
  'knotResolutionProposal',
  'shadowVerdict',
  'stakeAudit',
  'daemonAudit',
  'daemonToken',
  'grade',
  'gradeEscalation',
]);

/**
 * v2(b) — field SIGNATURES of the schema-less sidecar rows (`.jsonl` only,
 * top-level rows). A row carrying EVERY field of a signature is that sidecar:
 *   - {pickId, outcome, priorClass}        → StrandGrade (grades.jsonl)
 *   - {claimId, breach, excess, missing}   → ClaimEvaluationRow (claims/evaluations.jsonl)
 *   - {symbol, survival, acceptedRisk}     → GradeEscalationRow (grades-escalations.jsonl)
 */
export const STAKE_DENY_ROW_SHAPES: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['pickId', 'outcome', 'priorClass']),
  Object.freeze(['claimId', 'breach', 'excess', 'missing']),
  Object.freeze(['symbol', 'survival', 'acceptedRisk']),
]);

/* ── the v2 matchers (pure — no fs, no config; colocated with the constants
      they interpret so the constitution and its enforcement cannot drift) ──── */

/** v2(a): is this exact path component denied at any depth? */
export function stakeDeniedName(name: string): boolean {
  return STAKE_DENY_NAMES.includes(name);
}

/** v2(a): is this ROOT-RELATIVE path an anchored sidecar path (or inside one)? */
export function stakeDeniedPath(relPath: string): boolean {
  return STAKE_DENY_PATHS.some((p) => relPath === p || relPath.startsWith(`${p}/`));
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep walk: does the parsed value contain an envelope-shaped object? */
function containsEnvelope(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(containsEnvelope);
  if (!isPlainObject(v)) return false;
  if (typeof v.kind === 'string' && STAKE_DENY_ENVELOPE_KINDS.includes(v.kind)) return true;
  return Object.values(v).some(containsEnvelope);
}

/** Top-level row check: warpline sidecar row by schema tag or field signature. */
function sidecarRowShape(row: unknown): string | null {
  if (!isPlainObject(row)) return null;
  for (const key of ['schema', 'schemaVersion'] as const) {
    const tag = row[key];
    if (typeof tag === 'string') {
      const m = tag.match(/^([A-Za-z]+):v\d+$/);
      if (m && STAKE_DENY_ROW_SCHEMAS.includes(m[1])) return `sidecar schema ${tag}`;
    }
  }
  for (const sig of STAKE_DENY_ROW_SHAPES) {
    if (sig.every((f) => f in row)) return `sidecar row shape {${sig.join(',')}}`;
  }
  return null;
}

/**
 * v2(b) — the SHAPE-AWARE content audit of one blob. Returns a violation label,
 * or null when the blob is clean. Only `.json`/`.jsonl` files are candidates:
 * source code, markdown, and tests can NEVER match (v1's false-positive class).
 *   - `.json`  : the whole document parses → deep envelope check.
 *   - `.jsonl` : each parseable line → deep envelope check + top-level
 *                sidecar-row check (schema tag or field signature).
 * Unparseable content is NOT a violation — a leak that does not parse is not a
 * serialized envelope/sidecar; the path rules and the primary
 * allowlist-by-materialization mechanism still stand in front of it.
 */
export function stakeContentViolation(bytes: Buffer | Uint8Array, relPath: string): string | null {
  const lower = relPath.toLowerCase();
  const isJsonl = lower.endsWith('.jsonl');
  if (!isJsonl && !lower.endsWith('.json')) return null;
  const text = Buffer.from(bytes).toString('utf8');
  if (isJsonl) {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (containsEnvelope(row)) return `content: envelope kind "${STAKE_DENY_ENVELOPE_KINDS[0]}"`;
      const shape = sidecarRowShape(row);
      if (shape) return `content: ${shape}`;
    }
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return containsEnvelope(value) ? `content: envelope kind "${STAKE_DENY_ENVELOPE_KINDS[0]}"` : null;
}

/**
 * Is `ref` in the stake namespace? Matches the configured stake branch (when
 * known) and the default `warpline-stakes` namespace, with or without a
 * `refs/heads/` prefix. Stake refs are never input (S1).
 */
export function isStakeNamespaceRef(ref: string, configuredBranch?: string): boolean {
  const name = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
  if (configuredBranch && name === configuredBranch) return true;
  return name === STAKE_DEFAULT_BRANCH || name.startsWith(`${STAKE_DEFAULT_BRANCH}-`) || name.startsWith(`${STAKE_DEFAULT_BRANCH}/`);
}

/**
 * S1, mechanically: refuse any pick/absorb SOURCE that is a stake.
 *   - worktree source: the `.warpline-stake` marker exists at the root — this
 *     worktree is a `git reset --hard <stake>` state; the ONLY legal re-entry is
 *     the explicit recovery verb (S5), never an implicit re-ingestion.
 *   - ref source: the ref lives in the stake namespace, OR its tree carries the
 *     marker (checked via read-only `git ls-tree` — a stake commit reached by
 *     sha/any alias is still refused).
 * Throws on a stake input; resolves silently otherwise. Config read is
 * best-effort (a corrupt config must not turn the guard off — defaults apply).
 */
export async function assertNotStakeInput(ref: string, cwd: string, isWorktree: boolean): Promise<void> {
  if (isWorktree) {
    if (fs.existsSync(path.join(cwd, STAKE_MARKER))) {
      throw new Error(
        `warpline: refusing worktree input — a ${STAKE_MARKER} marker is present at ${cwd}. ` +
          `This tree is a one-way git stake checkpoint (S1) and is never input. ` +
          `If you just ran \`git reset --hard <stake>\`, re-enter with \`warpline stake recover <stakeCommit>\`.`,
      );
    }
    return;
  }
  let configuredBranch: string | undefined;
  try {
    configuredBranch = readWarplineConfig(cwd).stake?.branch;
  } catch {
    // corrupt config must not disable the guard — fall through with defaults
  }
  if (isStakeNamespaceRef(ref, configuredBranch)) {
    throw new Error(
      `warpline: refusing ref ${ref} — it lives in the stake namespace (S1: stakes are a one-way export, never input)`,
    );
  }
  const markerMode = await treeEntryMode(ref, STAKE_MARKER, { cwd }).catch(() => null);
  if (markerMode !== null) {
    throw new Error(
      `warpline: refusing ref ${ref} — its tree carries the ${STAKE_MARKER} marker (a stake commit; S1: stakes are a one-way export, never input). ` +
        `Recovery is \`git reset --hard <stake>\` + \`warpline stake recover <stakeCommit>\` — a ref move, never an import.`,
    );
  }
}
