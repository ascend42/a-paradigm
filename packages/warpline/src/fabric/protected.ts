/**
 * #protected — the PROTECTED-BRANCH registry and the AGENT-CLASS LANDING GATE
 * (M2.5 security, TD-2026-08-12-813 spine; Aegis's own finding). This module
 * closes a laundering route that branches opened.
 *
 * THE THREAT (Aegis's finding). With branches, an agent can isolate work on a
 * private feature branch — where it is GUARANTEED CLEAN, because it is alone
 * there — and then clean-MERGE that branch into the integration line with NO
 * human, because the KNOT/resolve gate only trips on CONTEST and a solitary
 * branch never contests. That route launders unreviewed work straight into main
 * and bypasses the human gate that is the entire safety model. The fix: name the
 * integration line PROTECTED, and REFUSE agent-class admit/merge ONTO a protected
 * branch — feature branches stay agent-writable, but LANDING into main is a
 * human/policy act.
 *
 * THE REGISTRY. `.warpline/protected.json` is a small JSON array of branch names.
 * ABSENT ⇒ the DEFAULT set (the trunk `selvage`, plus `main` if a branch by that
 * name literally exists — the git-parity trunk alias), so a fresh `warpline init`
 * has its trunk protected WITHOUT any file being written. Once a human writes the
 * file (protect/unprotect), it is AUTHORITATIVE — the default no longer applies,
 * so `unprotect selvage` genuinely removes protection (the file wins). Reads fail
 * CLOSED: a corrupt/non-array registry throws rather than masquerading as "no
 * protection", mirroring #head / #fabric-refs.
 *
 * WHO MAY CHANGE IT. protect/unprotect is a HUMAN-class act — an agent must never
 * decide what is protected FROM agents. The registry functions here are pure
 * mutators; the human-class enforcement lives at the skins (the CLI `branch
 * --protect/--unprotect` is the operator console; the daemon never exposes a
 * protect verb — daemon/protocol.ts documents both as human-only).
 *
 * THE GATE, AND WHY IT DOES NOT BREAK THE SINGLE-LINE WORLD. `protectedLandingRefusal`
 * refuses when THREE things all hold: the principal is AGENT-class, the target
 * branch is PROTECTED, and BRANCHING IS IN USE (more than one named line exists).
 * The third clause is what preserves the pre-branch baseline byte-for-byte: in
 * the single-line world (only the trunk), an agent admits onto the trunk EXACTLY
 * as it did before this module existed — there is no feature branch to launder
 * FROM, so there is nothing to gate. The gate ENGAGES the instant a feature
 * branch opens, which is precisely the state in which the laundering route
 * becomes reachable. A merge inherently needs two named lines, so an agent merge
 * into a protected branch is ALWAYS gated.
 *
 * PRINCIPAL SOURCE (no new vocabulary — Aegis §2.2). 'human' | 'agent' is the
 * SAME class the daemon token kind (daemon/tokens.ts) and #refusal's next[]
 * already speak. The CLI derives it from `$WARPLINE_AGENT_ID` (#agent-shell:
 * possession of an UNMARKED shell is the human credential); the daemon derives it
 * from the resolved token's kind. An ABSENT principal is treated as human — so
 * every existing engine caller (the CLI operator console, the direct-call test
 * suite, the single-human dogfood) is unaffected, and agent-class is OPT-IN.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteSync } from '../warp/durable.js';
import { warplineDirOf } from './fabric.js';
import { DEFAULT_BRANCH } from './head.js';
import { isRefName, listRefs, readRef } from './refs.js';
import { refuse, type Refusal, type RefusalNextStep } from './refusal.js';

/** Landing principal class — the SAME 'human'|'agent' vocabulary the daemon token
 * kind and #refusal's next[] use. Absent (undefined) is treated as human. */
export type PrincipalClass = 'human' | 'agent';

const PROTECTED_FILE = 'protected.json';

/** The git-parity trunk-alias name; protected by default only when it exists. */
const TRUNK_ALIAS = 'main';

function protectedPath(root: string): string {
  return path.join(warplineDirOf(root), PROTECTED_FILE);
}

/**
 * The DEFAULT protected set for a fabric with no `protected.json`: the trunk
 * (`selvage`, DEFAULT_BRANCH), plus `main` iff a branch literally named `main`
 * exists (the git-parity trunk alias). Sorted, deduped.
 */
function defaultProtected(wdir: string): string[] {
  const set = new Set<string>([DEFAULT_BRANCH]);
  if (readRef(wdir, TRUNK_ALIAS) !== null) set.add(TRUNK_ALIAS);
  return [...set].sort();
}

/**
 * The protected branch names. The persisted registry when `protected.json`
 * exists (AUTHORITATIVE — the default no longer applies), else the DEFAULT set.
 * Fails CLOSED: a registry that exists but is unreadable or is not a JSON string
 * array throws rather than being silently treated as "nothing protected".
 */
export function listProtected(root: string): string[] {
  const wdir = warplineDirOf(root);
  let raw: string;
  try {
    raw = fs.readFileSync(protectedPath(root), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultProtected(wdir);
    throw new Error(
      `warpline: protected registry unreadable at ${protectedPath(root)} — refusing to treat a corrupt registry as absent: ${(err as Error).message}`,
    );
  }
  if (raw.trim() === '') return defaultProtected(wdir); // an empty file is absence, not corruption
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `warpline: protected registry at ${protectedPath(root)} is not valid JSON — fail closed: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed) || !parsed.every((n) => typeof n === 'string')) {
    throw new Error(
      `warpline: protected registry at ${protectedPath(root)} must be a JSON array of branch names — fail closed`,
    );
  }
  // Keep only legal ref names (a name isRefName rejects could never be a branch),
  // dedupe, sort — the same normalization protect/unprotect writes.
  return [...new Set((parsed as string[]).filter((n) => isRefName(n)))].sort();
}

/** Is `branch` protected in this fabric? */
export function isProtected(root: string, branch: string): boolean {
  return listProtected(root).includes(branch);
}

/** The result of a protect/unprotect mutation. */
export interface ProtectResult {
  /** the full protected set AFTER the change. */
  protected: string[];
  /** false when the set already had (protect) or lacked (unprotect) the name. */
  changed: boolean;
  /** the name acted on. */
  name: string;
}

/** Persist the registry atomically + durably (#warp-durable). */
function writeProtected(root: string, names: string[]): void {
  const sorted = [...new Set(names)].sort();
  atomicWriteSync(protectedPath(root), JSON.stringify(sorted, null, 2) + '\n');
}

/**
 * PROTECT a branch (a HUMAN-class act — enforced at the skins). Idempotent: a
 * name already protected is a no-op (changed:false). Refuses an illegal ref name
 * fail-closed (isRefName), since a name that can never be a branch can never be
 * protected.
 */
export function protectBranch(root: string, name: string): ProtectResult {
  if (!isRefName(name)) {
    throw new Error(
      `warpline: cannot protect illegal branch name ${JSON.stringify(name)} — a branch is a single ref segment (isRefName)`,
    );
  }
  const cur = listProtected(root);
  if (cur.includes(name)) return { protected: cur, changed: false, name };
  const next = [...cur, name];
  writeProtected(root, next);
  return { protected: [...new Set(next)].sort(), changed: true, name };
}

/**
 * UNPROTECT a branch (a HUMAN-class act — enforced at the skins). Idempotent: a
 * name not currently protected is a no-op. Writing the file makes it AUTHORITATIVE,
 * so unprotecting a default-protected trunk genuinely removes its protection.
 */
export function unprotectBranch(root: string, name: string): ProtectResult {
  const cur = listProtected(root);
  if (!cur.includes(name)) return { protected: cur, changed: false, name };
  const next = cur.filter((n) => n !== name);
  writeProtected(root, next);
  return { protected: next, changed: true, name };
}

/**
 * BRANCHING IS IN USE when more than one named line exists — the state in which
 * the isolate-then-clean-merge laundering route becomes possible, and the exact
 * boundary that keeps the single-line world byte-identical to the pre-gate era.
 * A legacy (unmigrated) fabric has NO refs/heads entries at all → 0 → false, so
 * it too is untouched.
 */
export function branchingInUse(root: string): boolean {
  return listRefs(warplineDirOf(root)).size > 1;
}

/** What the landing gate needs: the acting principal, the branch being landed
 * ONTO, and the next[] recovery ladder naming the human path. */
export interface LandingGateInput {
  /** the acting principal class (undefined ⇒ human ⇒ never gated). */
  principal: PrincipalClass | undefined;
  /** the branch this admit/merge would ADVANCE (admit's targetBranch, merge's into). */
  target: string;
  /** the recovery ladder for the refusal — the human-class door out. */
  next: RefusalNextStep[];
}

/**
 * THE AGENT-CLASS LANDING GATE. Returns a `refusal:v1` to THROW when an
 * agent-class principal attempts to land (admit/merge) onto a PROTECTED branch
 * while BRANCHING IS IN USE; null (permitted) otherwise. Every skin routes its
 * protected-branch decision through this one function, so the three-part rule
 * cannot drift across the CLI, the daemon, and the merge/admit engine sites.
 *
 * FORBIDDEN (the verb × principal-class matrix, Aegis §2.2): retriable 'never'
 * for the SAME principal — the recovery is ESCALATION, carried by `next[]` with
 * principal:'human', never a self-retry.
 */
export function protectedLandingRefusal(root: string, gate: LandingGateInput): Refusal | null {
  if (gate.principal !== 'agent') return null; // human / absent → the operator's own act
  if (!isProtected(root, gate.target)) return null; // a feature branch → agents land here freely
  if (!branchingInUse(root)) return null; // single-line world → byte-identical to the pre-gate era
  return refuse({ code: 'FORBIDDEN', retriable: 'never', next: gate.next });
}
