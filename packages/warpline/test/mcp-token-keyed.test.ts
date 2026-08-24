/**
 * mcp-token-keyed.test — the #1 multi-instance trap (warpline-multi-instance-demo
 * A4 / rough-edge #2): `--mcp` used to write a SINGLE-VALUED `mcp.token` file, so
 * minting alice then bob left ONLY bob — alice's instance, falling back to the
 * file, would authenticate as bob (a server-stamped IDENTITY confusion, not just
 * a lost token).
 *
 * What is defended (storage fix, single-value → keyed; the trust model is
 * UNCHANGED — still per-agent, still human-minted, still daemon-verified):
 *   - BOTH agents' tokens persist in the keyed store (no clobber).
 *   - BOTH tokens verify against the daemon's verification path (resolveToken),
 *     and end-to-end the daemon SERVER-STAMPS the correct principal for each —
 *     the second mint does not overwrite the first's identity.
 *   - discovery: env token wins; a name selector resolves the right agent and
 *     fails CLOSED when the named agent is absent; a single-entry store is an
 *     unambiguous convenience; a multi-agent store with no selector fails closed
 *     rather than guess an identity.
 *   - back-compat: a legacy single `mcp.token` file is still honored on read.
 *   - the keyed store is 0600.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  mintToken,
  writeMcpTokenFile,
  readMcpTokens,
  mcpAgentToken,
  mcpTokensPathOf,
  mcpTokenPathOf,
  resolveToken,
} from '../src/daemon/tokens.js';
import { startDaemon, readDaemonAudit, type DaemonHandle } from '../src/daemon/server.js';
import { DaemonClient } from '../src/daemon/client.js';

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

describe('#warplined-tokens — keyed MCP token storage (N agents coexist, no clobber)', () => {
  let root: string;
  const savedEnvToken = process.env.WARPLINE_MCP_TOKEN;
  const savedEnvAgent = process.env.WARPLINE_MCP_AGENT;

  beforeEach(() => {
    delete process.env.WARPLINE_MCP_TOKEN;
    delete process.env.WARPLINE_MCP_AGENT;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmcpkey-'));
    write(root, MOD, BASE);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  afterAll(() => {
    if (savedEnvToken !== undefined) process.env.WARPLINE_MCP_TOKEN = savedEnvToken;
    if (savedEnvAgent !== undefined) process.env.WARPLINE_MCP_AGENT = savedEnvAgent;
  });

  it('minting a second agent --mcp does NOT clobber the first: both persist keyed', () => {
    const alice = mintToken(root, 'alice', 'agent');
    writeMcpTokenFile(root, alice.token, 'alice');
    const bob = mintToken(root, 'bob', 'agent');
    writeMcpTokenFile(root, bob.token, 'bob');

    const map = readMcpTokens(root);
    expect(Object.keys(map).sort()).toEqual(['alice', 'bob']);
    expect(map.alice).toBe(alice.token);
    expect(map.bob).toBe(bob.token); // alice survived the second mint
    expect(alice.token).not.toBe(bob.token);
  });

  it('the keyed store is 0600 and lives at daemon/mcp-tokens.json', () => {
    const t = mintToken(root, 'alice', 'agent');
    const p = writeMcpTokenFile(root, t.token, 'alice');
    expect(p).toBe(mcpTokensPathOf(root));
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });

  it('discovery: an explicit env token always wins (the per-instance mechanism)', () => {
    const alice = mintToken(root, 'alice', 'agent');
    writeMcpTokenFile(root, alice.token, 'alice');
    const bob = mintToken(root, 'bob', 'agent');
    writeMcpTokenFile(root, bob.token, 'bob');
    process.env.WARPLINE_MCP_TOKEN = 'raw-instance-token';
    expect(mcpAgentToken(root)).toBe('raw-instance-token');
  });

  it('discovery: WARPLINE_MCP_AGENT selects the right agent from a multi-agent store', () => {
    const alice = mintToken(root, 'alice', 'agent');
    writeMcpTokenFile(root, alice.token, 'alice');
    const bob = mintToken(root, 'bob', 'agent');
    writeMcpTokenFile(root, bob.token, 'bob');

    process.env.WARPLINE_MCP_AGENT = 'alice';
    expect(mcpAgentToken(root)).toBe(alice.token);
    process.env.WARPLINE_MCP_AGENT = 'bob';
    expect(mcpAgentToken(root)).toBe(bob.token);
  });

  it('discovery: a named-but-absent selector fails CLOSED (never picks another agent)', () => {
    const alice = mintToken(root, 'alice', 'agent');
    writeMcpTokenFile(root, alice.token, 'alice');
    process.env.WARPLINE_MCP_AGENT = 'ghost';
    expect(mcpAgentToken(root)).toBeNull();
  });

  it('discovery: a single keyed entry is an unambiguous convenience', () => {
    const alice = mintToken(root, 'alice', 'agent');
    writeMcpTokenFile(root, alice.token, 'alice');
    expect(mcpAgentToken(root)).toBe(alice.token);
  });

  it('discovery: a multi-agent store with no selector fails CLOSED (no identity guess)', () => {
    writeMcpTokenFile(root, mintToken(root, 'alice', 'agent').token, 'alice');
    writeMcpTokenFile(root, mintToken(root, 'bob', 'agent').token, 'bob');
    expect(mcpAgentToken(root)).toBeNull();
  });

  it('back-compat: a legacy single mcp.token file is still honored on read', () => {
    const legacy = mintToken(root, 'legacy', 'agent');
    const p = writeMcpTokenFile(root, legacy.token); // no agentId → legacy single-file path
    expect(p).toBe(mcpTokenPathOf(root));
    expect(fs.existsSync(mcpTokensPathOf(root))).toBe(false);
    expect(mcpAgentToken(root)).toBe(legacy.token);
    // and it verifies against the daemon's verification path
    expect(resolveToken(root, legacy.token)?.principal).toBe('legacy');
  });

  it('a garbled keyed store fails CLOSED to no tokens (never a wrong one)', () => {
    fs.mkdirSync(path.dirname(mcpTokensPathOf(root)), { recursive: true });
    fs.writeFileSync(mcpTokensPathOf(root), '{ not json', 'utf8');
    expect(readMcpTokens(root)).toEqual({});
    expect(mcpAgentToken(root)).toBeNull();
  });

  it('both minted tokens resolve to their OWN principal (verification path accepts either)', () => {
    const alice = mintToken(root, 'alice', 'agent');
    writeMcpTokenFile(root, alice.token, 'alice');
    const bob = mintToken(root, 'bob', 'agent');
    writeMcpTokenFile(root, bob.token, 'bob');

    expect(resolveToken(root, alice.token)?.principal).toBe('alice');
    expect(resolveToken(root, bob.token)?.principal).toBe('bob');
    expect(resolveToken(root, 'not-a-token')).toBeNull();
  });
});

describe('#warplined-tokens — end-to-end: the daemon verifies BOTH keyed agents', () => {
  let root: string;
  let handle: DaemonHandle;
  let aliceToken: string;
  let bobToken: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmcpkey-e2e-'));
    write(root, MOD, BASE);
    // Two agents minted --mcp back-to-back — bob after alice.
    aliceToken = mintToken(root, 'alice', 'agent').token;
    writeMcpTokenFile(root, aliceToken, 'alice');
    bobToken = mintToken(root, 'bob', 'agent').token;
    writeMcpTokenFile(root, bobToken, 'bob');
    handle = await startDaemon(root);
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }, 30_000);

  it('each keyed token connects and is SERVER-STAMPED to its own principal', async () => {
    const alice = await DaemonClient.connect(root, aliceToken);
    const bob = await DaemonClient.connect(root, bobToken);
    try {
      await alice.status(); // resolves = the daemon verified alice's token
      await bob.status(); //   resolves = bob's token still verifies (not clobbered)
    } finally {
      alice.close();
      bob.close();
    }
    // The audit records the SERVER-RESOLVED principal — proof neither mint
    // overwrote the other's identity.
    const stamped = new Set(
      readDaemonAudit(root)
        .filter((r) => r.verb === 'status' && r.ok)
        .map((r) => r.principal),
    );
    expect(stamped.has('alice')).toBe(true);
    expect(stamped.has('bob')).toBe(true);
  });
});
