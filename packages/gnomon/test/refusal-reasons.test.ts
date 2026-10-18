/**
 * #socket refusal-reason coverage (P8-D89 round 3): every reason the kernel can
 * put on the wire is registered in gnomon-contracts REFUSAL_REASONS (so it is
 * in clientApiId), and every routed socket reason is actually sent — or is a
 * named, deliberate future-stable placeholder.
 *
 * WIRE SCOPE: src/kernel/socket/**, src/kernel/web/** and src/kernel/refs/** (every refusal there
 * reaches a client), src/kernel/log/redaction.ts (the read projection's
 * refusal travels through asRpcRefusal), and the kernel log's read-side
 * `closed`. The rest of #kernel-log's refusals are in-process only: the socket
 * never reaches KernelLog.append (log.append refuses every cell in M1.4,
 * log-append.ts), so they are checked to stay out of the wire scope instead.
 * Platform-independent: reads source files only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFUSAL_REASONS, SOCKET_REASON_ROUTES } from '@a-company/gnomon-contracts';
import { PKG_ROOT } from './helpers.js';

const SRC = path.join(PKG_ROOT, 'src', 'kernel');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Literal reasons at refusal construction sites. */
const PATTERNS = [
  /new RpcRefusal\(\s*'[A-Z_]+',\s*'([a-z0-9-]+)'/g,
  /refusalWith\(\s*'[A-Z_]+',\s*'([a-z0-9-]+)'/g,
  /logRefusal\(\s*'[A-Z_]+',\s*'([a-z0-9-]+)'/g,
  /refuse\(\{\s*code:\s*'[A-Z_]+',\s*data:\s*\{\s*reason:\s*'([a-z0-9-]+)'/g,
  /\bfail\(\s*'([a-z0-9-]+)'/g, // auth.ts fail(reason, …)
  /\bfail\(\s*'[A-Z_]+',\s*'([a-z0-9-]+)'/g, // refs/resolve.ts fail(code, reason, …)
  /\bbad\(\s*'([a-z0-9-]+)'/g, // log-read.ts bad(reason, …)
];

function reasonsIn(files: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    for (const re of PATTERNS) for (const m of s.matchAll(re)) out.set(m[1]!, [...(out.get(m[1]!) ?? []), path.relative(SRC, f)]);
  }
  return out;
}

/** Reasons built dynamically: the ReadTokenFailure union (auth.ts sends `fail(r.reason, …)`) and framing's `malformed-<kind>`. */
function dynamicReasons(): string[] {
  const rt = readFileSync(path.join(SRC, 'identity', 'read-token.ts'), 'utf8');
  const union = /export type ReadTokenFailure =([^;]+);/.exec(rt)![1]!;
  const tokens = [...union.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]!);
  const framing = readFileSync(path.join(SRC, 'socket', 'framing.ts'), 'utf8');
  const malformed = [...framing.matchAll(/reason:\s*'(utf8|json|not-object)'/g)].map((m) => `malformed-${m[1]}`);
  const server = readFileSync(path.join(SRC, 'socket', 'server.ts'), 'utf8');
  const frame = server.includes("'frame-too-large'") ? ['frame-too-large'] : [];
  // hello's version refusal rides contracts negotiateHello's refusal, re-tagged in auth.ts `data: { reason: … }`
  const auth = readFileSync(path.join(SRC, 'socket', 'auth.ts'), 'utf8');
  const hello = [...auth.matchAll(/data:\s*\{[^}]*reason:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]!);
  return [...tokens, ...malformed, ...frame, ...hello];
}

/** Routed reasons kept as future-stable placeholders (orchestrator ruling round 2): not sent today, on purpose. */
const PLACEHOLDERS: Record<string, string> = {
  'token-not-implemented': 'pre-slice-3 read-token placeholder; read tokens are served since M1.4 slice 3',
  'nonce-used': 'a second attempt on one nonce cannot arrive (the first failure closes); kept as the named reason',
};

/** client.ts is the CLIENT side: its reasons are synthesized locally, never sent by the kernel. */
const CLIENT_FILE = path.join(SRC, 'socket', 'client.ts');
// src/kernel/web/** (#web-endpoint, M1.4): its auth hook and WebSocket replies reach GUI clients.
const wireFiles = [...tsFiles(path.join(SRC, 'socket')).filter((f) => f !== CLIENT_FILE), ...tsFiles(path.join(SRC, 'refs')), ...tsFiles(path.join(SRC, 'web')), path.join(SRC, 'log', 'redaction.ts')];

describe('refusal reasons on the wire are registered (P8-D89)', () => {
  const sent = reasonsIn(wireFiles);
  const dynamic = dynamicReasons();
  const all = new Set([...sent.keys(), ...dynamic, 'closed']);

  it('the scan finds the reasons it should (scanner sanity)', () => {
    for (const r of ['matrix', 'unauthenticated', 'follow-needs-id', 'backlog-too-large', 'no-resolver', 'row-integrity', 'reader-unsupported', 'mod-principal-name', 'kernel-owned', 'gone', 'auth-params']) expect(all, r).toContain(r);
    expect(dynamic).toEqual(expect.arrayContaining(['unknown-token', 'token-expired', 'token-revoked', 'token-not-yet-valid', 'token-store-untrusted', 'root-unprovisioned']));
  });

  it('every reason the kernel can send is in REFUSAL_REASONS', () => {
    const missing = [...all].filter((r) => !REFUSAL_REASONS.includes(r)).sort();
    expect(missing, `unregistered: ${missing.map((r) => `${r} (${(sent.get(r) ?? ['dynamic']).join(', ')})`).join('; ')}`).toEqual([]);
  });

  it('every routed socket reason is sent, or is a named future-stable placeholder', () => {
    const unsent = Object.keys(SOCKET_REASON_ROUTES).filter((r) => !all.has(r) && !Object.hasOwn(PLACEHOLDERS, r)).sort();
    expect(unsent).toEqual([]);
    for (const p of Object.keys(PLACEHOLDERS)) expect(all.has(p), `${p} is sent again: drop it from PLACEHOLDERS`).toBe(false);
  });

  it('client-local reasons: hello-not-offered is registered as client-local; connection-closed stays unregistered (ruled not a wire reason)', () => {
    const client = readFileSync(CLIENT_FILE, 'utf8');
    expect(client).toContain("'hello-not-offered'");
    expect(REFUSAL_REASONS).toContain('hello-not-offered');
    expect(client).toContain("reason: 'connection-closed'");
    expect(REFUSAL_REASONS).not.toContain('connection-closed');
  });

  it('in-process #kernel-log refusals stay out of the wire scope (no socket/refs file constructs them)', () => {
    const logOnly = reasonsIn([path.join(SRC, 'log', 'kernel-log.ts'), path.join(SRC, 'log', 'chain.ts')]);
    const leaked = [...logOnly.keys()].filter((r) => r !== 'closed' && !REFUSAL_REASONS.includes(r) && sent.has(r));
    expect(leaked).toEqual([]);
  });
});
