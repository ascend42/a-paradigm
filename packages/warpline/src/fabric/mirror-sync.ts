/**
 * #fabric-mirror-sync — the `warpline mirror …` verbs (W2): replicate the
 * canonical record, migrate a pre-0.3.0 repo, adopt, claim, pin, audit.
 *
 *   mirror push [remote]   fast-forward the remote's warpline/fabric branch to the
 *                          canonical writer's tip. ONLY the canonical writer pushes
 *                          (B2: a linked worktree or a fork never moves the remote).
 *                          No fabric lock (M6). Network env: no prompts, ssh
 *                          BatchMode, 60 s kill (#git-run). `--detached` returns at
 *                          once (the pre-push hook path, L2).
 *   mirror adopt           rebuild an empty/behind ledger from the verified canonical
 *                          record (#fabric-adopt). Refuses on an unmigrated repo (I1).
 *   mirror migrate         move the backstop from branch tracking to the record in
 *                          one step (see migrateToMirror).
 *   mirror claim           make this worktree's record the canonical one (recovery
 *                          for a lost canonical clone). Refused in linked worktrees.
 *   mirror pin             write fabricMirror.genesis (the first pickId) into the
 *                          tracked config.
 *   mirror audit           audit the canonical + remote-tracking chains and advance
 *                          the cursor (#mirror-audit).
 *
 * Library code: no console output — the CLI prints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { configPathOf } from './config.js';
import { readKeyRegistry } from './keys.js';
import { withFabricLock } from './lock.js';
import { verifyFabric } from './verify.js';
import { gitRun, gitText, networkGitEnv, NETWORK_TIMEOUT_MS } from './git-run.js';
import { readWriterId, ensureWriterId, writerRef } from './writer.js';
import { auditChain, advanceAuditCursor, verifyMirror, type AuditResult, type MirrorVerifyReport } from './mirror-audit.js';
import { adoptIntoSection, planMerge, type AdoptResult } from './adopt.js';
import {
  MirrorRefusal,
  LEDGER_REL,
  REMOTE_NAME,
  gitContext,
  guardGit,
  mirrorConfig,
  readMirrorRefs,
  ledgerTracked,
  isAncestor,
  isPickIdPrefix,
  openSection,
  publish,
  registryToRecord,
  parseLedger,
  readLedgerBytes,
  readSnapshot,
  readCap,
  writerOf,
  branchRefOf,
  remoteRefOf,
  type MirrorCtx,
  type MirrorConfig,
  type FabricSection,
} from './git-mirror.js';

export { planMerge };
export type { MergePlan, MergeKind } from './adopt.js';

/** The paths the 0.3.0 migration untracks (the ledger + both tip pointers). */
export const MIGRATE_PATHS = ['.warpline/fabric.jsonl', '.warpline/refs/heads/selvage', '.warpline/refs/selvage'] as const;

/** .gitignore negations that re-include the ledger / tips (removed by migrate). */
const TRACKING_NEGATIONS = new Set([
  '!.warpline/fabric.jsonl',
  '!.warpline/refs/',
  '.warpline/refs/*',
  '!.warpline/refs/selvage',
  '!.warpline/refs/heads/',
  '.warpline/refs/heads/*',
  '!.warpline/refs/heads/selvage',
]);
const GITIGNORE_BEGIN = '# >>> warpline fabric record >>>';
const GITIGNORE_END = '# <<< warpline fabric record <<<';

function requireCtx(root: string, verb: string): MirrorCtx {
  const ctx = gitContext(root);
  if (ctx === null) {
    throw new MirrorRefusal(
      `warpline: mirror ${verb} refused — ${root} is not the toplevel of a git worktree, so it has no fabric record ` +
        `(pass --root <worktree toplevel>).`,
      'not-applicable',
    );
  }
  return ctx;
}

function remoteConfigured(ctx: MirrorCtx, remote: string): boolean {
  if (!REMOTE_NAME.test(remote)) return false;
  return gitText(ctx.root, ['remote']).split(/\r?\n/).map((l) => l.trim()).includes(remote);
}

export interface Role {
  role: 'canonical' | 'fork' | 'none';
  wid: string | null;
  own: string | null;
  branch: string | null;
  remote: string | null;
}

/** This worktree's role without a lock (read-only). */
export function mirrorRole(ctx: MirrorCtx, cfg: MirrorConfig): Role {
  const wid = readWriterId(ctx.gitDir);
  const refs = readMirrorRefs(ctx, wid, cfg);
  let role: Role['role'] = 'none';
  if (wid && refs.own) {
    role =
      !ctx.linked && refs.branch && writerOf(ctx, refs.branch) === wid && isAncestor(ctx, refs.branch, refs.own) ? 'canonical' : 'fork';
  }
  return { role, wid, own: refs.own, branch: refs.branch, remote: refs.remote };
}

/* ───────────────────────────── push ───────────────────────────── */

export interface PushResult {
  action: 'pushed' | 'up-to-date' | 'not-canonical' | 'not-a-remote' | 'nothing-to-push';
  remote: string;
  commit: string | null;
}

/** Fast-forward `remote`'s canonical branch to this worktree's tip — canonical writer only (B2, M6). */
export function pushFabric(root: string, opts: { remote?: string; timeoutMs?: number } = {}): PushResult {
  const ctx = requireCtx(root, 'push');
  return guardGit(ctx, () => {
    const cfg = mirrorConfig(root);
    const remote = opts.remote ?? cfg.remote;
    if (!remoteConfigured(ctx, remote)) return { action: 'not-a-remote', remote, commit: null };
    const r = mirrorRole(ctx, cfg);
    if (r.branch === null) return { action: 'nothing-to-push', remote, commit: null };
    if (r.role !== 'canonical') return { action: 'not-canonical', remote, commit: r.branch };
    const dst = branchRefOf(cfg);
    const res = gitRun(ctx.root, ['push', '--porcelain', '--no-verify', remote, `${r.branch}:${dst}`], {
      env: { ...networkGitEnv(ctx.root), WARPLINE_MIRROR_PUSH: '1' },
      timeoutMs: opts.timeoutMs ?? NETWORK_TIMEOUT_MS,
    });
    const out = res.stdout.toString('utf8');
    const line = out.split('\n').find((l) => l.includes(`:${dst}`)) ?? '';
    const flag = line.charAt(0);
    if (res.status !== 0 || flag === '!') {
      throw new MirrorRefusal(
        `warpline: mirror push refused — ${remote}'s ${cfg.branch} did not fast-forward to ${r.branch.slice(0, 12)} ` +
          `(${(line || res.stderr).trim()}). The record is never force-pushed; if the remote is ahead, another ` +
          `writer is canonical (\`warpline mirror status\`).`,
        'cas',
      );
    }
    // (review 6) what we just pushed is audited by construction
    advanceAuditCursor(ctx, remoteRefOf(cfg, remote), r.branch);
    return { action: flag === '=' ? 'up-to-date' : 'pushed', remote, commit: r.branch };
  });
}

/* ───────────────────────────── adopt ───────────────────────────── */

/** `warpline mirror adopt` — refuses on an unmigrated repo (I1); may fetch the canonical branch in the foreground. */
export async function adoptCommand(root: string, opts: { fetch?: boolean } = {}): Promise<AdoptResult> {
  const ctx = requireCtx(root, 'adopt');
  return withFabricLock(
    root,
    () =>
      guardGit(ctx, () => {
        if (ledgerTracked(ctx)) {
          throw new MirrorRefusal(
            `warpline: mirror adopt refused — this checkout still tracks ${LEDGER_REL} (the pre-0.3.0 layout); ` +
              `adopting would activate the record under a tracked ledger (I1). Run \`warpline mirror migrate\` instead. ` +
              `Nothing was written.`,
            'pre-migration',
          );
        }
        const cfg = mirrorConfig(root);
        if (opts.fetch !== false) fetchCanonical(ctx, cfg);
        const m = openSection(root);
        if (m.mode !== 'mirror') throw new MirrorRefusal('warpline: mirror adopt — not a recorded layout', 'not-applicable');
        return adoptIntoSection(m.section);
      }),
    { mirror: 'manual' },
  );
}

/** Foreground fetch of the canonical branch into its remote-tracking ref (explicit verbs only). */
export function fetchCanonical(ctx: MirrorCtx, cfg: MirrorConfig): boolean {
  if (!remoteConfigured(ctx, cfg.remote)) return false;
  const r = gitRun(
    ctx.root,
    ['fetch', '--quiet', '--no-tags', cfg.remote, `+refs/heads/${cfg.branch}:${remoteRefOf(cfg)}`],
    { env: networkGitEnv(ctx.root), timeoutMs: NETWORK_TIMEOUT_MS },
  );
  return r.status === 0;
}

/* ───────────────────────────── claim / pin / audit / status ───────────────────────────── */

export interface ClaimResult {
  commit: string;
  previousCanonical: string | null;
}

/** Make this worktree the canonical writer. Its record must descend from the current canonical tip. */
export async function claimCanonical(root: string): Promise<ClaimResult> {
  const ctx = requireCtx(root, 'claim');
  if (ctx.linked) {
    throw new MirrorRefusal('warpline: mirror claim refused — a linked worktree is always a fork; claim from the main worktree.', 'not-applicable');
  }
  return withFabricLock(
    root,
    () => {
      const m = openSection(root);
      if (m.mode !== 'mirror') throw new MirrorRefusal('warpline: mirror claim refused — this checkout is not on the recorded layout.', 'pre-migration');
      const s: FabricSection = m.section;
      if (s.ownCommit === null) throw new MirrorRefusal('warpline: mirror claim refused — this worktree has no record yet (seal or adopt first).', 'not-applicable');
      const tip = s.branchTip ?? s.remoteTip;
      if (tip !== null && !isAncestor(s.ctx, tip, s.ownCommit)) {
        throw new MirrorRefusal(
          `warpline: mirror claim refused — this worktree's record does not contain the canonical tip ${tip.slice(0, 12)} ` +
            `(claiming would rewind the canonical fabric). Adopt it first.`,
          'canonical-rewound',
        );
      }
      const previousCanonical = tip;
      s.canonical = s.branchTip !== null;
      s.createBranch = s.branchTip === null;
      // the claimed record must keep the canonical key registry (append-only trust anchor)
      if (tip !== null) {
        const canonReg = readSnapshot(s.ctx, tip, readCap(s.bytes.length)).registry;
        // the bytes the claim commit WILL record (previous record + local rows)
        const ownReg = registryToRecord(s);
        if (canonReg !== null && (ownReg === null || ownReg.length < canonReg.length || !ownReg.subarray(0, canonReg.length).equals(canonReg))) {
          throw new MirrorRefusal(
            `warpline: mirror claim refused — this worktree's record would drop or shrink the canonical key registry ` +
              `(keys-registry.jsonl, the signing trust anchor). Adopt the canonical record first.`,
            'canonical-rewound',
          );
        }
      }
      const commit = publish(s, s.bytes, { message: `warpline: claim canonical for writer ${s.wid}` });
      return { commit, previousCanonical };
    },
    { mirror: 'manual' },
  );
}

function writeMirrorConfig(root: string, patch: Partial<MirrorConfig>): void {
  const p = configPathOf(root);
  let cur: Record<string, unknown> = {};
  try {
    cur = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const fm = { ...((cur.fabricMirror as Record<string, unknown>) ?? {}), ...patch };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ...cur, fabricMirror: fm }, null, 2) + '\n', 'utf8');
}

/**
 * (final N1) The signing pin derived from the LOCAL key registry: signedFrom =
 * the first signed-from row (null = genesis), keyIds = every agent-key row.
 * undefined when the local registry has no signing epoch.
 */
export function localSigningPin(root: string): { signedFrom: string | null; keyIds: string[] } | undefined {
  const rows = readKeyRegistry(root).rows;
  const sf = rows.find((r) => r.kind === 'signed-from');
  if (!sf || sf.kind !== 'signed-from') return undefined;
  const keyIds = [...new Set(rows.filter((r) => r.kind === 'agent-key').map((r) => (r as { keyId: string }).keyId))];
  return { signedFrom: sf.signedFromPickId, keyIds };
}

/** Rewrite fabricMirror.signedFrom/keyIds from the local registry when a mirror pin exists (key mint calls this). */
export function refreshSigningPin(root: string): boolean {
  let cfg: MirrorConfig;
  try {
    cfg = mirrorConfig(root);
  } catch {
    return false;
  }
  const pin = localSigningPin(root);
  if (cfg.genesis === null || pin === undefined) return false;
  if (cfg.signedFrom === pin.signedFrom && JSON.stringify(cfg.keyIds ?? []) === JSON.stringify(pin.keyIds)) return false;
  writeMirrorConfig(root, { signedFrom: pin.signedFrom, keyIds: pin.keyIds });
  return true;
}

/** Pin the genesis pickId (and branch/remote) in the tracked config. Refuses a different existing pin. */
export function pinGenesis(root: string, opts: { autoPush?: boolean } = {}): { genesis: string; changed: boolean } {
  const cfg = mirrorConfig(root);
  const first = parseLedger(readLedgerBytes(root)).lines[0];
  if (!first) throw new MirrorRefusal('warpline: mirror pin refused — the ledger is empty (nothing to pin).', 'not-applicable');
  if (cfg.genesis !== null && cfg.genesis !== first.pickId) {
    throw new MirrorRefusal(`warpline: mirror pin refused — the config already pins genesis ${cfg.genesis}, not ${first.pickId}.`, 'pin-mismatch');
  }
  const sign = localSigningPin(root);
  const changed =
    cfg.genesis === null ||
    (opts.autoPush !== undefined && opts.autoPush !== cfg.autoPush) ||
    (sign !== undefined && (cfg.signedFrom !== sign.signedFrom || JSON.stringify(cfg.keyIds ?? []) !== JSON.stringify(sign.keyIds)));
  if (changed) {
    writeMirrorConfig(root, {
      branch: cfg.branch,
      remote: cfg.remote,
      genesis: first.pickId,
      ...(sign ?? {}),
      ...(opts.autoPush !== undefined ? { autoPush: opts.autoPush } : {}),
    });
  }
  return { genesis: first.pickId, changed };
}

/** Audit the canonical + remote-tracking chains; advance the cursor of each clean one. */
export function auditCommand(root: string, opts: { full?: boolean } = {}): AuditResult[] {
  const ctx = requireCtx(root, 'audit');
  return guardGit(ctx, () => {
    const cfg = mirrorConfig(root);
    const refs = readMirrorRefs(ctx, readWriterId(ctx.gitDir), cfg);
    const out: AuditResult[] = [];
    for (const [ref, tip] of [
      [branchRefOf(cfg), refs.branch],
      [remoteRefOf(cfg), refs.remote],
    ] as const) {
      if (tip === null) continue;
      const r = auditChain(ctx, cfg, ref, tip, { full: opts.full, localLedgerBytes: readLedgerBytes(root).length });
      if (r.violations.length === 0) advanceAuditCursor(ctx, ref, tip);
      out.push(r);
    }
    return out;
  });
}

export interface MirrorStatus extends MirrorVerifyReport {
  branch: string;
  remote: string;
  genesis: string | null;
  autoPush: boolean;
  writerId: string | null;
  linked: boolean;
}

export function mirrorStatus(root: string): MirrorStatus {
  const v = verifyMirror(root);
  const cfg = mirrorConfig(root);
  let wid: string | null = null;
  let linked = false;
  try {
    const ctx = gitContext(root);
    if (ctx) {
      wid = readWriterId(ctx.gitDir);
      linked = ctx.linked;
    }
  } catch {
    /* reported as unavailable by verifyMirror */
  }
  return { ...v, branch: cfg.branch, remote: cfg.remote, genesis: cfg.genesis, autoPush: cfg.autoPush, writerId: wid, linked };
}

/* ───────────────────────────── migration ───────────────────────────── */

export interface MigrateResult {
  path: 'seed' | 'follow' | 'fork' | 'already-migrated';
  writerId: string;
  ownRef: string;
  commit: string | null;
  strands: number;
  pushed: 'pushed' | 'up-to-date' | 'skipped-no-remote' | 'skipped';
  untracked: string[];
  gitignore: 'edited' | 'appended' | 'present';
  genesis: string | null;
}

function isIgnored(ctx: MirrorCtx, rel: string): boolean {
  return gitRun(ctx.root, ['check-ignore', '-q', '--no-index', '--', rel]).status === 0;
}

function editGitignore(ctx: MirrorCtx): MigrateResult['gitignore'] {
  if (MIGRATE_PATHS.every((p) => isIgnored(ctx, p))) return 'present';
  const gp = path.join(ctx.root, '.gitignore');
  const current = fs.existsSync(gp) ? fs.readFileSync(gp, 'utf8') : '';
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const kept = current.split(/\r?\n/).filter((l) => !TRACKING_NEGATIONS.has(l.trim()));
  let text = kept.join(eol);
  fs.writeFileSync(gp, text, 'utf8');
  // the config carries the genesis pin and must be TRACKED (review b): a bare
  // `.warpline/` cannot be re-included, so it becomes `.warpline/*` + a negation
  if (isIgnored(ctx, '.warpline/config.json')) {
    text = text.replace(/^\s*\.warpline\/?\s*$/m, '.warpline/*');
    if (!/^!\.warpline\/config\.json\s*$/m.test(text)) {
      if (text.length > 0 && !text.endsWith(eol)) text += eol;
      text += `!.warpline/config.json${eol}`;
    }
    fs.writeFileSync(gp, text, 'utf8');
  }
  if (MIGRATE_PATHS.every((p) => isIgnored(ctx, p))) return 'edited';
  if (!text.includes(GITIGNORE_BEGIN)) {
    if (text.length > 0 && !text.endsWith(eol)) text += eol;
    text += [
      GITIGNORE_BEGIN,
      '# The Warpline ledger and tip pointers are per clone caches; the record is the',
      '# warpline/fabric branch (managed by `warpline mirror migrate`).',
      '/.warpline/fabric.jsonl',
      '/.warpline/refs/',
      GITIGNORE_END,
      '',
    ].join(eol);
    fs.writeFileSync(gp, text, 'utf8');
  }
  return 'appended';
}

/** (review 20) roll back ONLY the refs this run created, CAS-checked against what it wrote. */
function rollbackRefs(ctx: MirrorCtx, section: FabricSection, created: { own: boolean; branch: boolean; ownBefore: string | null }): void {
  const lines: string[] = [];
  if (created.own && section.ownCommit) lines.push(`delete ${section.ownRef} ${section.ownCommit}`);
  // an own ref this run only ADVANCED goes back to where it was (CAS on what we wrote)
  const moved = !created.own && created.ownBefore !== null && section.ownCommit !== null && section.ownCommit !== created.ownBefore;
  if (moved) lines.push(`update ${section.ownRef} ${created.ownBefore} ${section.ownCommit}`);
  if (created.branch && section.branchTip) lines.push(`delete ${section.branchRef} ${section.branchTip}`);
  if (lines.length > 0) gitRun(ctx.root, ['update-ref', '--stdin'], { input: lines.join('\n') + '\n' });
  if (created.own || moved) fs.rmSync(path.join(ctx.gitDir, 'warpline', 'mirror-cache.json'), { force: true });
}

/**
 * `warpline mirror migrate`. Order is the safety property: verify baseline →
 * record (seed one commit, or follow / fork an existing canonical) → push the
 * branch in the foreground and confirm with ls-remote (failure ⇒ roll the new
 * refs back, untrack nothing) → only then edit .gitignore, `git rm --cached` the
 * ledger + both tips, write the config pin. The user commits (via a PR).
 */
export async function migrateToMirror(root: string, opts: { push?: boolean; autoPush?: boolean } = {}): Promise<MigrateResult> {
  const ctx = requireCtx(root, 'migrate');
  return withFabricLock(
    root,
    () =>
      guardGit(ctx, () => {
        const cfg = mirrorConfig(root);
        const tracked = MIGRATE_PATHS.filter((p) => gitText(ctx.root, ['ls-files', '-z', '--', p]).length > 0);
        if (!tracked.includes(LEDGER_REL) && cfg.genesis !== null) {
          const wid = ensureWriterId(ctx.gitDir);
          return {
            path: 'already-migrated',
            writerId: wid,
            ownRef: writerRef(wid),
            commit: readMirrorRefs(ctx, wid, cfg).own,
            strands: parseLedger(readLedgerBytes(root)).lines.length,
            pushed: 'skipped',
            untracked: [],
            gitignore: 'present',
            genesis: cfg.genesis,
          } satisfies MigrateResult;
        }
        const ledger = readLedgerBytes(root);
        const lines = parseLedger(ledger).lines;
        if (lines.length === 0) {
          throw new MirrorRefusal(`warpline: mirror migrate refused — ${LEDGER_REL} is empty; nothing to record.`, 'not-applicable');
        }
        const baseline = new Set(verifyFabric(root).failures.map((f) => `${f.kind}\u0000${f.pickId}`));

        const hasRemote = remoteConfigured(ctx, cfg.remote);
        if (hasRemote && opts.push !== false) fetchCanonical(ctx, cfg);
        const m = openSection(root, { ignoreTracked: true });
        if (m.mode !== 'mirror') throw new MirrorRefusal('warpline: mirror migrate — unexpected layout', 'not-applicable');
        const s = m.section;
        const created = { own: s.ownCommit === null, branch: s.branchTip === null, ownBefore: s.ownCommit };
        let migPath: MigrateResult['path'] = 'seed';
        const canonicalTip = s.branchTip ?? s.remoteTip;
        if (s.ownCommit === null) {
          if (canonicalTip !== null) {
            const canon = parseLedger(readSnapshot(ctx, canonicalTip, readCap(ledger.length)).bytes).lines;
            if (isPickIdPrefix(lines, canon)) {
              adoptIntoSection(s);
              migPath = 'follow';
            } else {
              s.createBranch = false;
              s.canonical = false;
              publish(s, ledger, { message: 'warpline: migrate (fork of the canonical record)' });
              migPath = 'fork';
            }
          } else {
            if (ctx.linked) {
              throw new MirrorRefusal(
                'warpline: mirror migrate refused — no canonical record exists yet and this is a linked worktree ' +
                  '(linked worktrees are never canonical). Migrate from the main worktree.',
                'not-applicable',
              );
            }
            publish(s, ledger, { message: `warpline: migrate — seed the record (${lines.length} strand(s))` });
          }
        }
        // (final 9) a re-run whose own ref exists but whose branch was never created publishes once
        if (s.ownCommit !== null && s.createBranch && s.branchTip === null && !ctx.linked) {
          publish(s, readLedgerBytes(root), { message: 'warpline: migrate — create the canonical branch' });
        }
        // verify: the record equals the ledger, and verify gives the same failures as the baseline
        const recorded = readSnapshot(ctx, s.ownCommit as string, readCap(ledger.length)).bytes;
        if (!recorded.equals(readLedgerBytes(root))) {
          throw new MirrorRefusal('warpline: mirror migrate refused — the record does not match the ledger byte for byte; nothing untracked.', 'truncation');
        }
        const fresh = verifyFabric(root).failures.filter((f) => !baseline.has(`${f.kind}\u0000${f.pickId}`));
        if (fresh.length > 0) {
          throw new MirrorRefusal(
            `warpline: mirror migrate refused — verify reports ${fresh.length} failure(s) the baseline did not ` +
              `(first: ${fresh[0].kind} ${fresh[0].pickId}); nothing untracked.`,
            'truncation',
          );
        }

        let pushed: MigrateResult['pushed'] = hasRemote ? 'skipped' : 'skipped-no-remote';
        if (migPath === 'seed' && hasRemote && opts.push !== false) {
          let res: PushResult;
          try {
            res = pushFabric(root, { remote: cfg.remote });
          } catch (err) {
            rollbackRefs(ctx, s, created);
            throw new MirrorRefusal(
              `warpline: mirror migrate stopped — pushing ${cfg.branch} to ${cfg.remote} failed, so the new refs were ` +
                `rolled back and nothing was untracked (${(err as Error).message}).`,
              'cas',
            );
          }
          const ls = gitRun(ctx.root, ['ls-remote', cfg.remote, branchRefOf(cfg)], {
            env: networkGitEnv(ctx.root),
            timeoutMs: NETWORK_TIMEOUT_MS,
          });
          const remoteTip = ls.stdout.toString('utf8').split(/\s+/)[0] ?? '';
          if (ls.status !== 0 || remoteTip !== s.branchTip) {
            rollbackRefs(ctx, s, created);
            throw new MirrorRefusal(
              `warpline: mirror migrate stopped — ${cfg.remote} does not report ${cfg.branch} at ${s.branchTip?.slice(0, 12)} ` +
                `after the push; refs rolled back, nothing untracked.`,
              'cas',
            );
          }
          pushed = res.action === 'up-to-date' ? 'up-to-date' : 'pushed';
          advanceAuditCursor(ctx, remoteRefOf(cfg), remoteTip);
        }
        if (s.branchTip) advanceAuditCursor(ctx, branchRefOf(cfg), s.branchTip);

        const gitignore = editGitignore(ctx);
        if (tracked.length > 0) gitText(ctx.root, ['rm', '--cached', '--quiet', '--', ...tracked]);
        const still = MIGRATE_PATHS.filter((p) => !isIgnored(ctx, p));
        if (still.length > 0) {
          throw new MirrorRefusal(`warpline: mirror migrate — git still does not ignore ${still.join(', ')}; fix .gitignore.`, 'not-applicable');
        }
        writeMirrorConfig(root, {
          branch: cfg.branch,
          remote: cfg.remote,
          genesis: lines[0].pickId,
          ...(localSigningPin(root) ?? {}),
          ...(opts.autoPush !== undefined ? { autoPush: opts.autoPush } : {}),
        });
        return {
          path: migPath,
          writerId: s.wid,
          ownRef: s.ownRef,
          commit: s.ownCommit,
          strands: lines.length,
          pushed,
          untracked: [...tracked],
          gitignore,
          genesis: lines[0].pickId,
        } satisfies MigrateResult;
      }),
    { mirror: 'manual' },
  );
}

/** Does this worktree still branch-track the ledger (a pre-0.3.0 layout `mirror migrate` would fix)? */
export function migrationPending(root: string): boolean {
  try {
    const ctx = gitContext(root);
    return ctx !== null && ledgerTracked(ctx);
  } catch {
    return false;
  }
}
