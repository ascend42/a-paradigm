/**
 * #warpline-mcp — the THIRD SKIN (T-2026-07-21-004, mcp-skin-spec §1-§3):
 * the daemon verb surface as MCP tools over stdio, for the agents that call
 * tools rather than shells. The skin is DELIBERATELY THIN:
 *
 *   - CREDENTIAL PASS-THROUGH, never a principal (D2): one process holds one
 *     human-minted agent-class token (env → mcp.token via ./token.js); the
 *     daemon server-stamps identity from it. No tool accepts identity params —
 *     args are filtered to each verb's declared schema properties, so
 *     `actor`/`decidedBy`/`now` (and any impersonation attempt) never reach
 *     the wire. (`resolve`'s `agentId` is a TARGET, not identity — operator
 *     mode only.)
 *   - SOCKET-ONLY (D3): every call goes through DaemonClient. In-process
 *     engine imports are PROHIBITED in src/mcp/ — the whole stage-1 security
 *     layer (token resolution, verb×principal matrix, stamping, audit) lives
 *     in the daemon request path. Daemon-down/token-missing return the two
 *     skin-built refusals (./refusals.js) — never prose, never a fallback.
 *   - VERBATIM RESULTS (§2): one content item, type:'text', JSON of the engine
 *     shape unchanged — UntrustedProse envelopes intact, nothing unwrapped,
 *     nothing promoted into titles (Aegis R4). No MCP-layer template ever
 *     interpolates prose bodies.
 *   - isError CONTRACT (§3, the T-006 lesson): transport/usage failure → true;
 *     ok result → exitCodeForResult(result) !== 0. A refusing verdict NEVER
 *     presents as MCP success — including a SHADOW verdict, whose refusal rides
 *     one level down inside the `{shadow, row, result}` envelope (C-16; the
 *     depths are known by `refusalOf`, not by this call site).
 *   - DEFAULT SURFACE = agent verbs only (Aegis R2: omission, not
 *     expose-then-refuse). `--operator` registers the human verbs IFF the
 *     discovered token verifies kind:'human' via status at startup — never
 *     speculatively.
 *   - #f4-trace: one f4Trace:v1 row per call (F4 ground truth), refusals
 *     captured from BOTH error frames and result.refusal.
 *
 * stdout belongs to the MCP transport — diagnostics go to stderr only.
 */

import { spawn } from 'node:child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DaemonClient, DaemonRpcError, daemonAvailable } from '../daemon/client.js';
import { VERB_DESCRIPTORS, toolNameOf, agentSurfaceVerbs } from '../daemon/descriptors.js';
import { DAEMON_VERBS, HUMAN_ONLY_VERBS, HUMAN_ONLY_ADMIT_FLAGS, type DaemonVerb } from '../daemon/protocol.js';
import { exitCodeForResult, refusalOf, refuse } from '../fabric/refusal.js';
import { F4Tracer, resultClassOf } from '../daemon/f4-trace.js';
import { mcpAgentToken } from './token.js';
import { daemonDownRefusal, tokenMissingRefusal } from './refusals.js';

export interface McpSkinOptions {
  root: string;
  /** register human-class tools IFF the token verifies kind:'human' at startup. */
  operator?: boolean;
  /** auto-start the daemon on connect failure (same OS user; lock makes it safe). */
  autoStart?: boolean;
}

/** internal sentinels — converted to the two skin-built refusals at the boundary. */
class DaemonDownError extends Error {}
class TokenMissingError extends Error {}

/** Structural request summary for the trace — same key discipline as the daemon's targetOf. */
function targetOfParams(params: Record<string, unknown>): string | null {
  const bits: string[] = [];
  for (const k of ['selector', 'commit', 'agentId', 'claim', 'worktree', 'into', 'dest']) {
    const v = params[k];
    if (typeof v === 'string' && v) bits.push(`${k}=${v}`);
  }
  for (const k of ['shadow', 'noRestore', 'summary']) {
    if (params[k] === true) bits.push(k);
  }
  return bits.length ? bits.join(' ') : null;
}

/**
 * Inverse of `toolNameOf` for MEASUREMENT ONLY: recover the daemon verb an
 * unregistered tool name was reaching for, so the attempt can be traced under
 * the verb it meant. Returns null when the name is not a real daemon verb (a
 * genuine surface miss rather than a reach for an omitted verb). Never used to
 * dispatch — an unregistered tool stays unregistered.
 */
function demangleToolName(name: string): string | null {
  const candidate = DAEMON_VERBS.find((v) => toolNameOf(v) === name);
  return candidate ?? null;
}

/** Filter args to the verb's DECLARED schema properties — the skin-side
 * additionalProperties:false. Identity/clock params structurally cannot pass. */
function filterToSchema(verb: DaemonVerb, args: Record<string, unknown>): Record<string, unknown> {
  const schema = VERB_DESCRIPTORS[verb].paramsSchema as { properties?: Record<string, unknown> };
  const allowed = new Set(Object.keys(schema.properties ?? {}));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (allowed.has(k) && v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/**
 * Build the configured Server (surface resolved, handlers wired) WITHOUT
 * binding a transport — `runMcpServer` binds stdio; tests bind an in-memory
 * pair. Returns the resolved surface for callers that report it.
 */
export async function buildMcpServer(
  opts: McpSkinOptions,
): Promise<{ server: Server; surface: DaemonVerb[]; close: () => void }> {
  const root = opts.root;
  const autoStart = opts.autoStart !== false;
  const tracer = new F4Tracer(root, 'mcp', '(unresolved)');

  let client: DaemonClient | null = null;

  const tryAutoStart = async (): Promise<void> => {
    const cliPath = process.argv[1];
    if (!cliPath) return;
    // The detached child IS the daemon; the single-instance pidfile lock makes
    // a concurrent second start safe (it refuses, we just poll the socket).
    const child = spawn(process.execPath, [cliPath, 'daemon', 'start', '--foreground'], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (daemonAvailable(root)) return;
    }
  };

  const ensureClient = async (): Promise<DaemonClient> => {
    if (client) return client;
    const token = mcpAgentToken(root);
    if (!token) throw new TokenMissingError();
    if (!daemonAvailable(root) && autoStart) await tryAutoStart();
    try {
      client = await DaemonClient.connect(root, token);
    } catch {
      throw new DaemonDownError();
    }
    return client;
  };

  const callDaemon = async (verb: string, params: Record<string, unknown>): Promise<unknown> => {
    const c = await ensureClient();
    try {
      return await c.call(verb, params);
    } catch (err) {
      if (err instanceof DaemonRpcError) throw err; // daemon answered — a real refusal
      // transport tore (socket closed / timed out): drop the client so the next
      // call reconnects, and surface daemon-down.
      client?.close();
      client = null;
      throw new DaemonDownError();
    }
  };

  // ── surface: agent verbs by default; +human verbs only after operator proof ──
  let surface: DaemonVerb[] = agentSurfaceVerbs();
  if (opts.operator) {
    try {
      const status = await (await ensureClient()).status();
      if (status.kind === 'human') {
        surface = [...DAEMON_VERBS];
      } else {
        process.stderr.write('warpline mcp: --operator ignored — the discovered token is not human-class\n');
      }
      tracer.principal = status.principal;
    } catch {
      process.stderr.write('warpline mcp: --operator ignored — daemon unreachable at startup (agent surface only)\n');
    }
  }
  const verbOfTool = new Map<string, DaemonVerb>(surface.map((v) => [toolNameOf(v), v]));

  const server = new Server(
    { name: 'warpline', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: surface.map((verb) => ({
      name: toolNameOf(verb),
      description: VERB_DESCRIPTORS[verb].summary,
      inputSchema: VERB_DESCRIPTORS[verb].paramsSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const verb = verbOfTool.get(name);
    if (!verb) {
      // An unregistered tool name stays a HOST protocol error — the skin builds
      // only its two refusals and the SDK surfaces this one. But the ATTEMPT is
      // now RECORDED first (F4 measurement fix, panel finding D-2): this branch
      // threw before `tracer.emit` ever ran, so an agent reaching for an omitted
      // HUMAN-CLASS verb left no trace row at all — and W3 (escalation-violation)
      // reads rows. The violation was unrecorded, not merely unpunished, which
      // made "zero W3 marks" a criterion that structurally could not fail.
      //
      // Omission still holds (Aegis R2): the tool is not registered, the call
      // still fails, no human capability is exposed. Only the observation is new.
      const attempted = demangleToolName(name);
      const isOmittedHumanVerb = attempted !== null && HUMAN_ONLY_VERBS.includes(attempted);
      tracer.emit({
        verb: attempted ?? name,
        target: null,
        ok: false,
        // FORBIDDEN, not UNKNOWN_VERB, when the agent reached for a real
        // human-class verb: the classifier treats UNKNOWN_VERB as a SURFACE MISS
        // and judges such rows against their OWN episode instead of the open one
        // (classifier.ts:159), which would skip the W3 check entirely. FORBIDDEN
        // is also what the daemon itself would have answered.
        refusal: refuse({ code: isOmittedHumanVerb ? 'FORBIDDEN' : 'UNKNOWN_VERB' }),
      });
      throw new Error(`unknown tool ${JSON.stringify(name)}`);
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const params = filterToSchema(verb, args);
    // Human-class flags are dropped by filterToSchema (they are not in admit's
    // paramsSchema, so they can never reach the wire — the defense is intact).
    // They were dropped SILENTLY, so the classifier's /accept(Breach|Risk)/ test
    // on `target` could never match and W3-by-flag was unobservable. Record the
    // attempt: supplying one IS the escalation violation, whether or not it
    // travelled. Flag names only — never a value, never prose.
    const attemptedHumanFlags = HUMAN_ONLY_ADMIT_FLAGS.filter((f) => args[f] === true);
    const target = [targetOfParams(params), ...attemptedHumanFlags].filter(Boolean).join(' ') || null;

    const asContent = (value: unknown): { content: Array<{ type: 'text'; text: string }> } => ({
      content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    });

    try {
      const result = await callDaemon(verb, params);
      // learn the principal once (cheap: status carries it; other verbs don't).
      if (tracer.principal === '(unresolved)' && verb === 'status' && result && typeof result === 'object') {
        const p = (result as { principal?: unknown }).principal;
        if (typeof p === 'string') tracer.principal = p;
      }
      // §3 detection, ONE accessor for BOTH depths (refusal.ts refusalOf).
      // C-16: the outer-only probe that stood here could not see the SHADOW
      // envelope — daemon `admit {shadow:true}` answers `{shadow, row, result}`
      // and nests the verdict at `result.refusal`, so a shadow CLAIM_BREACH /
      // TRUST_HELD / KNOT reached the host as isError:false. Two call sites each
      // knowing one depth is exactly how that regressed; one accessor that knows
      // both is why it cannot regress again.
      const refusal = refusalOf(result);
      tracer.emit({ verb, target, ok: true, refusal, resultClass: resultClassOf(result) });
      // §3: a refusing verdict inside an ok result must NEVER present as success.
      return { ...asContent(result), isError: exitCodeForResult({ refusal }) !== 0 };
    } catch (err) {
      if (err instanceof TokenMissingError) {
        const refusal = tokenMissingRefusal();
        tracer.emit({ verb, target, ok: false, refusal });
        return { ...asContent({ refusal }), isError: true };
      }
      if (err instanceof DaemonDownError) {
        const refusal = daemonDownRefusal();
        tracer.emit({ verb, target, ok: false, refusal });
        return { ...asContent({ refusal }), isError: true };
      }
      if (err instanceof DaemonRpcError) {
        // the daemon's error frame VERBATIM: {code, message} + its refusal.
        tracer.emit({ verb, target, ok: false, refusal: err.refusal });
        return {
          ...asContent({ error: { code: err.code, message: err.message }, ...(err.refusal ? { refusal: err.refusal } : {}) }),
          isError: true,
        };
      }
      throw err;
    }
  });

  return {
    server,
    surface,
    // release the daemon socket (tests + clean shutdown) — idempotent.
    close: () => {
      client?.close();
      client = null;
    },
  };
}

/** The stdio entry (`warpline mcp`): build, bind stdio, stay serving. */
export async function runMcpServer(opts: McpSkinOptions): Promise<void> {
  const { server, surface } = await buildMcpServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`warpline mcp: serving ${surface.length} tools over stdio (root ${opts.root})\n`);
}
