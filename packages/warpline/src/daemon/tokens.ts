/**
 * #warplined-tokens — Aegis stage-1 identity (aegis-security.md §1.2):
 * per-principal bearer tokens for the solo daemon, minted ONLY via the local
 * CLI (`warpline daemon token mint <name> --kind agent|human`) — token issuance
 * is the human's act, gated by possession of the box. No self-service minting
 * verb exists on the daemon (anti-sockpuppet line, §2.2).
 *
 * Storage: `.warpline/daemon-tokens.jsonl` — append-only rows
 * `{token, principal, kind, createdAt}`, file mode 0600. The filename matches
 * the entry the frozen stake deny-list (stake-guard.ts D5) already pinned:
 * daemon tokens are on the never-leaves-the-box list twice over (the whole
 * `.warpline/` dir is denied AND the filename itself is). `.warpline/*` is
 * gitignored at the repo root, so tokens never reach git either.
 *
 * SERVER-STAMPED IDENTITY (the load-bearing rule, Aegis §1.1): the daemon
 * derives actor/agentId FROM the resolved token's principal. Client-supplied
 * identity fields are advisory and ignored. Trust claim, stated honestly:
 * attribution is authentic within this machine's OS-user boundary; the daemon
 * is the trusted stamper. Per-strand signatures remain M3.
 *
 * Library code: no console output.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { warplineDirOf } from '../fabric/fabric.js';

export const DAEMON_TOKEN_SCHEMA = 'daemonToken:v1' as const;

export type PrincipalKind = 'human' | 'agent';

/** One minted identity row (append-only; a re-mint for the same principal
 * simply adds a newer valid token — rotation without a revocation ceremony,
 * which is deliberately deferred at stage 1). */
export interface DaemonToken {
  schemaVersion: typeof DAEMON_TOKEN_SCHEMA;
  token: string;
  principal: string;
  kind: PrincipalKind;
  createdAt: string;
}

/** The resolved caller identity the daemon stamps onto every engine call. */
export interface Principal {
  principal: string;
  kind: PrincipalKind;
}

export function tokensPathOf(root: string): string {
  return path.join(warplineDirOf(root), 'daemon-tokens.jsonl');
}

/** Mint a token for a principal (the human-gated CLI act). Appends the row and
 * keeps the file 0600. Returns the full row — the ONLY time the token is shown. */
export function mintToken(
  root: string,
  principal: string,
  kind: PrincipalKind,
  opts: { now?: string } = {},
): DaemonToken {
  const name = principal.trim();
  if (!name) throw new Error('warpline: daemon token mint — principal name is required');
  if (kind !== 'human' && kind !== 'agent') {
    throw new Error(`warpline: daemon token mint — kind must be 'human' or 'agent' (got ${JSON.stringify(kind)})`);
  }
  const row: DaemonToken = {
    schemaVersion: DAEMON_TOKEN_SCHEMA,
    token: randomBytes(32).toString('hex'),
    principal: name,
    kind,
    createdAt: opts.now ?? new Date().toISOString(),
  };
  const p = tokensPathOf(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(row) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600); // appendFile mode only applies on create — re-assert
  } catch {
    /* best-effort on exotic filesystems */
  }
  return row;
}

/** All minted rows (unreadable lines skipped — the resolve path fails CLOSED
 * anyway: a garbled row simply never matches a presented token). */
export function readTokens(root: string): DaemonToken[] {
  let raw: string;
  try {
    raw = fs.readFileSync(tokensPathOf(root), 'utf8');
  } catch {
    return [];
  }
  const out: DaemonToken[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as DaemonToken;
      if (row && typeof row.token === 'string' && typeof row.principal === 'string' && (row.kind === 'human' || row.kind === 'agent')) {
        out.push(row);
      }
    } catch {
      /* skip — never matches, fail closed */
    }
  }
  return out;
}

/** Constant-time token comparison (no early-exit length/byte oracle). */
function tokenEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Resolve a presented token to its principal — null = unknown (AUTH refusal). */
export function resolveToken(root: string, token: string | undefined): Principal | null {
  if (!token || typeof token !== 'string') return null;
  for (const row of readTokens(root)) {
    if (tokenEquals(row.token, token)) return { principal: row.principal, kind: row.kind };
  }
  return null;
}

/** Redacted listing for `warpline daemon token list` — never re-shows tokens. */
export function listTokenSummaries(
  root: string,
): Array<{ principal: string; kind: PrincipalKind; createdAt: string; tokenPrefix: string }> {
  return readTokens(root).map((r) => ({
    principal: r.principal,
    kind: r.kind,
    createdAt: r.createdAt,
    tokenPrefix: r.token.slice(0, 8) + '…',
  }));
}
