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

/**
 * Token scope. Absent = full verb surface for the principal's kind (the
 * pre-existing token class). `'read'` = the CONSOLE class: the daemon caps the
 * token at protocol.ts READ_ONLY_VERBS regardless of kind — least privilege
 * for surfaces that only ever render (the platform console). The scope is
 * additive schema (G1): old rows have no scope and behave exactly as before.
 */
export type TokenScope = 'read';

/** The principal name the platform console's token is minted under. */
export const CONSOLE_PRINCIPAL = 'console';

/** One minted identity row (append-only; a re-mint for the same principal
 * simply adds a newer valid token — rotation without a revocation ceremony,
 * which is deliberately deferred at stage 1). */
export interface DaemonToken {
  schemaVersion: typeof DAEMON_TOKEN_SCHEMA;
  token: string;
  principal: string;
  kind: PrincipalKind;
  createdAt: string;
  /** absent = full surface; 'read' = READ_ONLY_VERBS ceiling (console class). */
  scope?: TokenScope;
}

/** The resolved caller identity the daemon stamps onto every engine call. */
export interface Principal {
  principal: string;
  kind: PrincipalKind;
  /** 'read' caps the session at READ_ONLY_VERBS (server-enforced). */
  scope?: TokenScope;
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
  opts: { now?: string; scope?: TokenScope } = {},
): DaemonToken {
  const name = principal.trim();
  if (!name) throw new Error('warpline: daemon token mint — principal name is required');
  if (kind !== 'human' && kind !== 'agent') {
    throw new Error(`warpline: daemon token mint — kind must be 'human' or 'agent' (got ${JSON.stringify(kind)})`);
  }
  if (opts.scope !== undefined && opts.scope !== 'read') {
    throw new Error(`warpline: daemon token mint — scope must be 'read' or omitted (got ${JSON.stringify(opts.scope)})`);
  }
  const row: DaemonToken = {
    schemaVersion: DAEMON_TOKEN_SCHEMA,
    token: randomBytes(32).toString('hex'),
    principal: name,
    kind,
    createdAt: opts.now ?? new Date().toISOString(),
    ...(opts.scope ? { scope: opts.scope } : {}),
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
      // An UNKNOWN scope fails closed (skipped): a row we cannot interpret must
      // never resolve as a full-power token.
      if (
        row &&
        typeof row.token === 'string' &&
        typeof row.principal === 'string' &&
        (row.kind === 'human' || row.kind === 'agent') &&
        (row.scope === undefined || row.scope === 'read')
      ) {
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
    if (tokenEquals(row.token, token)) {
      return { principal: row.principal, kind: row.kind, ...(row.scope ? { scope: row.scope } : {}) };
    }
  }
  return null;
}

/** Redacted listing for `warpline daemon token list` — never re-shows tokens. */
export function listTokenSummaries(
  root: string,
): Array<{ principal: string; kind: PrincipalKind; scope: TokenScope | 'full'; createdAt: string; tokenPrefix: string }> {
  return readTokens(root).map((r) => ({
    principal: r.principal,
    kind: r.kind,
    scope: r.scope ?? 'full',
    createdAt: r.createdAt,
    tokenPrefix: r.token.slice(0, 8) + '…',
  }));
}

/**
 * The console lane's token discovery (platform router): the NEWEST token
 * minted for the `console` principal with `scope:'read'` — and ONLY such a
 * row. This helper structurally cannot hand a full-power token to the console:
 * rows without the read scope never match, so a router bug upstream of the
 * daemon still holds no write capability. Returns null when the human has not
 * minted one (`warpline daemon token mint console --kind human --scope read`)
 * — the caller falls back to its in-process read path.
 */
export function consoleReadToken(root: string): string | null {
  let newest: DaemonToken | null = null;
  for (const row of readTokens(root)) {
    if (row.principal !== CONSOLE_PRINCIPAL || row.scope !== 'read') continue;
    if (!newest || row.createdAt > newest.createdAt) newest = row;
  }
  return newest?.token ?? null;
}

/* ── the MCP skin's token custody (PW-9, mcp-skin-spec D2/R5) ─────────────────── */

/** The dedicated 0600 file the MCP skin reads — NEVER daemon-tokens.jsonl. */
export function mcpTokenPathOf(root: string): string {
  return path.join(warplineDirOf(root), 'daemon', 'mcp.token');
}

/**
 * Write the MCP skin's bare token to its dedicated 0600 file (called by the
 * mint CLI when the principal is an agent minted FOR the MCP skin). Custody
 * rules (Aegis R5): the file lives under `.warpline/` (gitignored, on the
 * stake deny-list); the token never appears in `.mcp.json` or any committable
 * config; issuance stays the human's CLI act — the MCP server NEVER mints.
 */
export function writeMcpTokenFile(root: string, token: string): string {
  const p = mcpTokenPathOf(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, token + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600); // writeFile mode only applies on create — re-assert
  } catch {
    /* best-effort on exotic filesystems */
  }
  return p;
}

/**
 * The MCP skin's token discovery, mirroring the consoleReadToken structural
 * pattern: `$WARPLINE_MCP_TOKEN` (shell/keychain-injected) first, else the
 * dedicated mcp.token file. STRUCTURALLY AGENT-CLASS-SAFE: this helper reads
 * ONLY the dedicated sources — it never scans daemon-tokens.jsonl (which holds
 * human tokens; one "newest row" bug there would be a privilege escalation,
 * Aegis R1). Whether the discovered token is actually agent-class is the
 * DAEMON's judgment at resolve time — the skin holds a credential, never an
 * identity. Returns null when neither source exists (the skin surfaces the
 * structured AUTH refusal naming the human mint step).
 */
export function mcpAgentToken(root: string): string | null {
  const env = process.env.WARPLINE_MCP_TOKEN;
  if (env && env.trim()) return env.trim();
  try {
    const raw = fs.readFileSync(mcpTokenPathOf(root), 'utf8').trim();
    return raw || null;
  } catch {
    return null;
  }
}
