/**
 * @symbol #session-runner
 *
 * The `session` sandbox profile on Windows (spec §15.5, §16 "Sandbox" + "Session denies"; W5 of
 * docs/plans/gnomon-windows.md). Sessions run at LOW integrity under a restricted token (gnomon-helper `sandbox --low
 * --desktop --session-sid <own>`), with Claude Code's PowerShell tool and no Bash tool: Git Bash cannot start nested
 * at Low (msys cannot create its object directory), PowerShell and git.exe can (founder decision, option 1 of the
 * Aegis W5 review). Low integrity is the boundary: a Low process cannot write any object that is not labelled Low
 * (every file and HKCU key of the user outside the roots), cannot open the user's Medium processes for write, VM,
 * thread or handle access, and UIPI blocks its input to their windows. The token's restricting SIDs carry
 * GNOMON_SESSION_SID (every session) and this session's own SID below it; the SessionPolicy becomes:
 *
 *   WRITES  the writable roots (the repo roots, the session temp dir, the allowWrite carve-backs) get an inheritable
 *           Low label (`label-low`). Inside them the policy's write denies (.git hooks/config/info, the repo's
 *           .claude, warpline tokens, CLAUDE* files) are `deny-write` / `deny-replace` ACEs for GNOMON_SESSION_SID,
 *           and the PARENT of each literal deny gets `deny-replace` (no FILE_DELETE_CHILD: a denied file cannot be
 *           deleted through its dir and recreated without its deny, Aegis H1). Outside the roots the same denies
 *           stand as defence in depth.
 *   READS   the policy's read denies (the Gnomon home, keys, the kernel log, browser profiles) are `deny-all` ACEs;
 *           the home is also labelled no-read-up (ensureGnomonHome), which a Low process cannot pass whatever the
 *           DACL says. The allowRead carve-backs get `label-readable` and an `allow-read`; their literal ancestors in
 *           the home (allowReadMetadata) get `label-meta`: the dir itself readable for attributes and security (a
 *           path-vetting walk: Claude Code refuses a settings file whose path it cannot examine), its listing still
 *           denied by the ACE, everything below still no-read-up.
 *   CARVE-BACKS `allow-write-keep` on Claude's transcripts and this session's session-env/<uuid>. A carve-back only
 *           this session uses (its session-env, its own dir below the home's sessions/) is granted to its OWN SID, so
 *           a concurrent session hits the inherited deny (Aegis M2); shared ones (transcripts, the pinned binary, a
 *           runner tree) to GNOMON_SESSION_SID. Own grants are dropped at session end (releaseSessionGrants).
 *   PROCESS a private Low desktop and a kill-on-close job with UI limits; the kernel also shields its own process
 *           (platform/win32/shield.ts) and denies sessions its pipe (pipe.ts).
 *
 * Reported `partial`, honestly: a `steering`/`dep-steering` regex or a `prefix` deny covers only what exists at spawn
 * (a new CLAUDE*.md can be created at a repo root); a deny on a path that does not exist yet is skipped (and listed);
 * a child with a protected DACL below a read deny keeps no deny (the home's label still holds); another session can
 * write this session's temp dir and the shared transcripts; the endpoint-port loopback deny waits for the WFP filter
 * (probe P10w); a Low process can still read whatever is not denied (as on darwin). Any entry the helper fails to
 * apply, or reads back without its ACE or label (other than a missing path), refuses the session
 * (`sandbox-unavailable`): never silently weaker.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LifecycleRefusal } from '../../kernel/lifecycle/refusal.js';
import type { PolicyPath, SessionPolicy } from '../../kernel/manifest/policy.js';
import { helperOpSync, kernelWin32Helper, type Win32HelperPin } from './helper-client.js';

/** The restricting SID every session token carries (gnomon-helper sandbox.rs GNOMON_SESSION_SID). */
export const GNOMON_SESSION_SID = 'S-1-9-4174-2026-1022';

/** This session's own restricting SID: GNOMON_SESSION_SID-<32 bits of sha256(hsid)> (helper check_session_sid). */
export function sessionSidFor(hsid: string): string {
  return `${GNOMON_SESSION_SID}-${Number.parseInt(createHash('sha256').update(hsid).digest('hex').slice(0, 8), 16)}`;
}

export type SessionAclMode = 'deny-read' | 'deny-write' | 'deny-all' | 'deny-replace' | 'allow-read' | 'allow-write' | 'allow-write-keep' | 'clear' | 'label-low' | 'label-clear' | 'label-readable' | 'label-meta' | 'label-no-read-up';
export interface SessionAclEntry {
  /** an absolute local path, or an `HKCU\…` key (write denies only) */
  path: string;
  mode: SessionAclMode;
  match: 'subpath' | 'literal';
  /** an allow for this session's own SID instead of GNOMON_SESSION_SID */
  sid?: string;
  /**
   * a write deny OUTSIDE the Low-labelled roots: defence in depth only (a Low process cannot write a Medium object
   * anyway), so a path whose DACL this user may not change (Program Files) is reported partial, not refused
   */
  soft?: boolean;
}

export interface Win32SessionPlanInput {
  policy: SessionPolicy;
  /** the repo roots (cwd, worktree) */
  roots: readonly string[];
  /** the session temp dir (TEMP/TMP of the session env) */
  tempDir: string;
  /** this session's own SID (sessionSidFor(hsid)) */
  sessionSid: string;
}

export interface Win32SessionAcls {
  entries: SessionAclEntry[];
  /** what this profile cannot deny (honest `partial` detail for session.sandbox) */
  partial: string[];
}

const fold = (p: string): string => path.resolve(p).toLowerCase();
const within = (p: string, root: string): boolean => {
  const a = fold(p);
  const r = fold(root);
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
};
const isDir = (p: string): boolean => {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isLabel = (m: SessionAclMode): boolean => m.startsWith('label-');

/** Existing files/dirs in `dir` whose name starts with `prefix` (a `prefix` deny, e.g. `<root>/CLAUDE` → CLAUDE.md). */
function prefixMatches(p: string): string[] {
  const dir = path.dirname(p);
  const stem = path.basename(p).toLowerCase();
  try {
    return fs.readdirSync(dir).filter((n) => n.toLowerCase().startsWith(stem)).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

/** Existing directories named `name` (case-insensitive) below `root`, bounded (steering `.claude` dirs in a repo). */
function namedDirsBelow(root: string, name: string, max = 2000): string[] {
  const out: string[] = [];
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < max) {
    const d = stack.pop()!;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      seen++;
      const full = path.join(d, e.name);
      if (e.name.toLowerCase() === name) out.push(full);
      else if (e.name !== 'node_modules' && e.name !== '.git') stack.push(full);
    }
  }
  return out;
}

/**
 * The carve-backs granted to THIS session's SID alone: its session-env/<uuid> and its read carve-backs below the
 * Gnomon home's `sessions/` dir. The shared ones (Claude's transcripts, the pinned binary in `bin/`, a runner tree in
 * `runners/`) stay on GNOMON_SESSION_SID: a concurrent session's apply would replace a per-session grant there.
 */
export function ownCarveBacks(policy: SessionPolicy): string[] {
  const home = policy.denyRead.find((d) => d.class === 'gnomon-home' && d.match === 'subpath')?.path;
  const sessions = home ? path.join(home, 'sessions') : null;
  return [
    ...policy.allowRead.filter((a) => sessions !== null && within(a.path, sessions) && fold(a.path) !== fold(sessions)).map((a) => a.path),
    ...policy.allowWrite.filter((a) => a.class === 'session-env').map((a) => a.path),
  ];
}

/** The label and ACE entries that realise `policy` on Windows (pure apart from reading the tree). */
export function win32SessionAcls(i: Win32SessionPlanInput): Win32SessionAcls {
  const { policy } = i;
  const entries: SessionAclEntry[] = [];
  const partial: string[] = [];
  const writable = [...i.roots, ...policy.allowWrite.map((a) => a.path), i.tempDir];
  const own = new Set(ownCarveBacks(policy).map(fold));
  const sidFor = (p: string): { sid?: string } => (own.has(fold(p)) ? { sid: i.sessionSid } : {});
  const inWritable = (p: string): boolean => writable.some((w) => within(p, w));

  // writes: Low labels on the writable roots (inheritable)
  for (const w of new Set(writable.map((x) => path.resolve(x)))) entries.push({ path: w, mode: 'label-low', match: 'subpath' });
  // the session temp dir is this session's alone (Aegis re-review M3): its parent denies every session, the dir itself
  // is granted to the session's own SID (the session-env pattern)
  entries.push({ path: path.dirname(i.tempDir), mode: 'deny-write', match: 'subpath' });
  entries.push({ path: i.tempDir, mode: 'allow-write-keep', match: 'subpath', sid: i.sessionSid });

  // reads: the deny list (read AND write) and this session's read-only carve-backs
  const readDeny = (p: PolicyPath): void => {
    if (p.match === 'subpath' || p.match === 'literal') entries.push({ path: p.path, mode: 'deny-all', match: p.match });
    else partial.push(`read deny ${p.match} ${p.path}: only existing matches`);
  };
  for (const p of policy.denyRead) readDeny(p);
  for (const p of policy.allowRead) {
    const match = p.match === 'literal' ? 'literal' : 'subpath';
    entries.push({ path: p.path, mode: 'allow-read', match, ...sidFor(p.path) });
    // the home is labelled no-read-up (ensureGnomonHome): a carve-back is relabelled readable (Medium, no-write-up)
    entries.push({ path: p.path, mode: 'label-readable', match });
  }
  // the literal ancestors of those carve-backs inside the home: attributes and security readable (a path-vetting walk,
  // Claude Code's settings loader), listing still denied, everything below still no-read-up (darwin: metadata only)
  for (const p of policy.allowReadMetadata) entries.push({ path: p.path, mode: 'label-meta', match: 'literal' });
  for (const p of policy.denyReadAlways) readDeny(p);

  // writes: deny ACEs wherever the policy puts them; inside a writable root a literal deny's parent loses delete-child
  // inside a Low-labelled root a deny ACE binds sessions only; a Medium no-write-up label on the denied path itself
  // stops EVERY Low writer (the confined GUI transport, another app's Low sandbox) as well (Aegis re-review H1)
  const isRoot = (p: string): boolean => writable.some((w) => fold(w) === fold(p));
  const relabel = (p: string, match: 'subpath' | 'literal'): void => {
    if (inWritable(p) && !isRoot(p) && fs.existsSync(p)) entries.push({ path: p, mode: 'label-readable', match });
  };
  const literal = (p: string, mode: SessionAclMode): void => {
    entries.push({ path: p, mode, match: 'literal', ...(inWritable(p) ? {} : { soft: true }) });
    relabel(p, 'literal');
    if (inWritable(p) && fs.existsSync(p)) entries.push({ path: path.dirname(p), mode: 'deny-replace', match: 'literal' });
  };
  const writeDeny = (p: PolicyPath): void => {
    if (p.match === 'subpath') {
      entries.push({ path: p.path, mode: 'deny-write', match: 'subpath', ...(inWritable(p.path) ? {} : { soft: true }) });
      relabel(p.path, 'subpath');
      return;
    }
    if (p.match === 'literal') {
      literal(p.path, isDir(p.path) ? 'deny-replace' : 'deny-write');
      return;
    }
    if (p.match === 'prefix') {
      for (const m of prefixMatches(p.path)) {
        if (isDir(m)) {
          entries.push({ path: m, mode: 'deny-write', match: 'subpath' });
          relabel(m, 'subpath');
        } else literal(m, 'deny-write');
      }
      partial.push(`write deny prefix ${p.path}*: existing matches only (a new one can be created)`);
      return;
    }
    // steering / dep-steering: a regex of `.claude` dirs below a root; deny the ones that exist now
    const root = writable.find((w) => within(p.path, w) || within(w, p.path));
    if (!root) return;
    const base = within(p.path, root) ? p.path : root;
    for (const d of namedDirsBelow(base, '.claude')) {
      entries.push({ path: d, mode: 'deny-write', match: 'subpath' });
      relabel(d, 'subpath');
    }
    partial.push(`write deny ${p.match} below ${base}: existing .claude dirs only`);
  };
  const carved = new Set(policy.allowWrite.map((a) => fold(a.path)));
  for (const p of policy.denyWrite) writeDeny(p);
  // carve-backs: the transcripts are every session's; a session-env dir is this session's alone (Aegis M2)
  for (const p of policy.allowWrite) entries.push({ path: p.path, mode: 'allow-write-keep', match: 'subpath', ...sidFor(p.path) });
  // the literal re-deny of a carve-back root is part of its allow-write-keep (a second entry would replace the first)
  for (const p of policy.denyWriteAlways) if (!(p.match === 'literal' && carved.has(fold(p.path)))) writeDeny(p);

  if (policy.denyLoopbackPorts.length) partial.push(`loopback deny of ports ${policy.denyLoopbackPorts.join(',')}: no WFP filter yet (probe P10w)`);
  partial.push('a child with a protected DACL below a read deny keeps no deny (the home also carries a no-read-up label)');
  partial.push('another session can write the shared transcripts (a --resume of a poisoned one); a new CLAUDE*.md or nested .claude can be created at a root');
  partial.push('while any session runs, a Low process can list (not read) the Gnomon home and its sessions/ dir (label-meta)');
  partial.push('Credential Manager / DPAPI reads at Low: not verified');
  return { entries: mergeSessionAcls(entries), partial };
}

const DENY_BITS: Partial<Record<SessionAclMode, number>> = { 'deny-read': 1, 'deny-write': 2, 'deny-all': 3, 'deny-replace': 4 };

/**
 * One ACE entry and one label entry per path (case-folded): the helper REPLACES a path's session ACEs (or its label)
 * with each entry, so a second entry on the same path would silently drop the first (the home is both read- and
 * write-denied). Denies merge (read + write → deny-all; deny-write covers deny-replace; subpath beats literal); an
 * allow on a path that is also denied, or two different labels, cannot be one entry and refuse the session (fail
 * closed). Order of first appearance is kept.
 */
export function mergeSessionAcls(entries: readonly SessionAclEntry[]): SessionAclEntry[] {
  const by = new Map<string, SessionAclEntry>();
  for (const e of entries) {
    const k = `${isLabel(e.mode) ? 'L' : 'A'}|${/^hkcu\\/i.test(e.path) ? e.path.toLowerCase() : fold(e.path)}`;
    const prev = by.get(k);
    if (!prev) {
      by.set(k, { ...e });
      continue;
    }
    const match = prev.match === 'subpath' || e.match === 'subpath' ? 'subpath' : 'literal';
    const a = DENY_BITS[prev.mode];
    const b = DENY_BITS[e.mode];
    if (a !== undefined && b !== undefined) {
      const bits = a | b;
      const mode: SessionAclMode = (bits & 3) === 3 ? 'deny-all' : bits & 1 ? (bits & 4 ? 'deny-all' : 'deny-read') : bits & 2 ? 'deny-write' : 'deny-replace';
      by.set(k, { path: prev.path, mode, match, ...(prev.soft && e.soft ? { soft: true } : {}) });
      continue;
    }
    if (prev.mode === e.mode && prev.sid === e.sid) {
      by.set(k, { ...prev, match, ...(prev.soft && e.soft ? { soft: true } : { soft: undefined }) });
      continue;
    }
    throw new LifecycleRefusal('sandbox-unavailable', `the session ${prev.mode} and ${e.mode} on ${e.path} cannot be one entry`, { profile: 'session' });
  }
  return [...by.values()];
}

/** Does the helper's read-back show `e` (its ACE's SID, or its label)? (Aegis M3: `ok` alone is not proof.) */
function readBackShows(e: SessionAclEntry, sddl: string): boolean {
  switch (e.mode) {
    case 'label-low':
      return /ML;[A-Z]*;NW;;;LW\)/.test(sddl);
    case 'label-readable':
      return /ML;[A-Z]*;NW;;;ME\)/.test(sddl);
    case 'label-meta':
      return /ML;OICIIO;(NRNW|NWNR);;;ME\)/.test(sddl);
    case 'label-no-read-up':
      return /ML;[A-Z]*;(NRNW|NWNR);;;ME\)/.test(sddl);
    case 'label-clear':
    case 'clear':
      return true;
    default: {
      const want = e.mode.startsWith('allow-') ? 'A' : 'D';
      const sid = e.sid ?? GNOMON_SESSION_SID;
      return [...sddl.matchAll(/\((A|D);([A-Z]*);[^;]*;;;([^)]+)\)/g)].some((m) => m[1] === want && !m[2]!.includes('ID') && m[3] === sid);
    }
  }
}

/** Apply the entries through the helper; a failure other than a missing path, or a read-back without the entry, refuses. */
export function applySessionAcls(acls: Win32SessionAcls, pin: Win32HelperPin = kernelWin32Helper()): { missing: string[] } {
  const missing: string[] = [];
  for (let k = 0; k < acls.entries.length; k += 256) {
    const batch = acls.entries.slice(k, k + 256);
    const r = helperOpSync(pin, 'acl.session', { entries: batch.map(({ soft: _soft, ...e }) => e) }, 120_000);
    const results = Array.isArray(r.results) ? (r.results as Array<{ path: string; ok: boolean; sddl?: string; error?: string; message?: string }>) : [];
    if (results.length !== batch.length) throw new LifecycleRefusal('sandbox-unavailable', 'the helper answered acl.session with the wrong number of results', { profile: 'session' });
    results.forEach((res, j) => {
      const e = batch[j]!;
      if (res.ok) {
        if (!readBackShows(e, res.sddl ?? '')) throw new LifecycleRefusal('sandbox-unavailable', `the session ${e.mode} on ${e.path} did not read back`, { profile: 'session', mode: e.mode });
        return;
      }
      if (res.error === 'missing' && !e.mode.startsWith('allow-') && e.mode !== 'label-low' && e.mode !== 'label-readable') {
        missing.push(`${e.mode} ${e.path}`);
        return;
      }
      if (e.soft && res.error === 'os-error' && /\(5\)/.test(res.message ?? '')) {
        missing.push(`${e.mode} ${e.path} (not this user's to re-ACL; Low integrity already denies the write)`);
        return;
      }
      throw new LifecycleRefusal('sandbox-unavailable', `the session ${e.mode} on ${e.path} could not be applied (${res.error ?? 'error'}: ${res.message ?? ''})`, { profile: 'session', mode: e.mode });
    });
  }
  return { missing };
}

export interface Win32SessionPlan {
  command: string;
  args: string[];
  sandbox: 'partial';
  profile: string;
  profileHash: string;
  partial: string[];
}

/** The launch: labels and ACEs applied, then `gnomon-helper sandbox --low --desktop --session-sid <own> -- <binary> <argv…>`. */
export function win32SessionPlan(i: Win32SessionPlanInput & { binaryReal: string; argv: readonly string[] }, pin: Win32HelperPin = kernelWin32Helper()): Win32SessionPlan {
  if (!path.isAbsolute(i.tempDir)) throw new LifecycleRefusal('sandbox-unavailable', 'the session temp dir must be absolute', { profile: 'session' });
  fs.mkdirSync(i.tempDir, { recursive: true });
  // a label or an ACE needs an object: the carve-backs (~/.claude/projects, this session's session-env/<uuid>, which
  // Claude Code would create itself) exist first (a sandbox profile on darwin names a path in advance)
  for (const a of i.policy.allowWrite) fs.mkdirSync(a.path, { recursive: true });
  const acls = win32SessionAcls(i);
  // held before the apply: a failure part-way is still undone by releaseSession
  holds.set(i.sessionSid, holdFor(i));
  const { missing } = applySessionAcls(acls, pin);
  const partial = [...acls.partial, ...missing.map((m) => `not placed: ${m}`)];
  const profile = JSON.stringify({ backend: 'win32-low-restricted', sid: GNOMON_SESSION_SID, own: i.sessionSid, entries: acls.entries, partial });
  pin.recheck();
  return {
    command: pin.exe,
    args: ['sandbox', '--low', '--desktop', '--session-sid', i.sessionSid, '--', i.binaryReal, ...i.argv],
    sandbox: 'partial',
    profile,
    profileHash: `sha256:${createHash('sha256').update(profile).digest('hex')}`,
    partial,
  };
}

/**
 * At session end: drop every session ACE on THIS session's own carve-backs (its session-env/<uuid>, its read
 * carve-backs in the home), so no later session inherits a grant it was never given. A missing path is nothing to
 * drop; any other failure throws.
 */
export function releaseSessionGrants(paths: readonly string[], pin: Win32HelperPin = kernelWin32Helper()): void {
  if (!paths.length) return;
  const r = helperOpSync(pin, 'acl.session', { entries: paths.map((p) => ({ path: p, mode: 'clear', match: 'subpath' })) });
  const results = (r.results as Array<{ ok: boolean; error?: string; message?: string }> | undefined) ?? [];
  results.forEach((res, j) => {
    if (!res.ok && res.error !== 'missing') throw new Error(`the session grant on ${paths[j]} was not dropped (${res.error ?? 'error'}: ${res.message ?? ''})`);
  });
}

/** What a live session holds: the paths it labelled Low, the home ancestors it opened for metadata, its own grants. */
interface SessionHold {
  low: string[];
  meta: string[];
  own: string[];
}
/** Live holds by session SID, kernel-wide (Claude and local sessions alike). Lost on a kernel restart (partial). */
const holds = new Map<string, SessionHold>();

function holdFor(i: Win32SessionPlanInput): SessionHold {
  return {
    low: [...new Set([...i.roots, ...i.policy.allowWrite.map((a) => a.path), i.tempDir].map((x) => path.resolve(x)))],
    meta: i.policy.allowReadMetadata.map((p) => p.path),
    own: [...ownCarveBacks(i.policy), i.tempDir],
  };
}

/**
 * At session end (or a refusal after the plan): drop this session's own grants, and undo what no other live session
 * still needs: a Low label on a root, the temp dir or a carve-back (`label-clear`, Aegis re-review H1: a repo must not
 * stay writable to every Low process), and the metadata opening of a home ancestor (`label-no-read-up` again, Aegis
 * re-review M2). A no-op for a session without a hold. Any helper failure throws (the caller logs it).
 */
export function releaseSession(sessionSid: string, pin: Win32HelperPin = kernelWin32Helper()): void {
  const h = holds.get(sessionSid);
  if (!h) return;
  holds.delete(sessionSid);
  const still = (pick: (x: SessionHold) => string[]): Set<string> => new Set([...holds.values()].flatMap((x) => pick(x).map(fold)));
  const low = still((x) => x.low);
  const meta = still((x) => x.meta);
  const entries: SessionAclEntry[] = [
    ...h.own.map((p): SessionAclEntry => ({ path: p, mode: 'clear', match: 'subpath' })),
    ...h.low.filter((p) => !low.has(fold(p))).map((p): SessionAclEntry => ({ path: p, mode: 'label-clear', match: 'subpath' })),
    ...h.meta.filter((p) => !meta.has(fold(p))).map((p): SessionAclEntry => ({ path: p, mode: 'label-no-read-up', match: 'subpath' })),
  ];
  if (!entries.length) return;
  const r = helperOpSync(pin, 'acl.session', { entries }, 120_000);
  const results = (r.results as Array<{ ok: boolean; error?: string; message?: string }> | undefined) ?? [];
  results.forEach((res, j) => {
    if (!res.ok && res.error !== 'missing') throw new Error(`session release: ${entries[j]!.mode} on ${entries[j]!.path} failed (${res.error ?? 'error'}: ${res.message ?? ''})`);
  });
}

/** Test seam: the live holds (session SIDs). */
export function liveHoldsForTests(): string[] {
  return [...holds.keys()];
}
