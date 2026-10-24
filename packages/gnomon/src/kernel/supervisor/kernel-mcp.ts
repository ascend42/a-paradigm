/**
 * @symbol #kernel-mcp
 *
 * #kernel-mcp (T-2026-10-23-002; spec §6.6): the kernel's OWN MCP server for a Claude session, named `gnomon`
 * (KERNEL_MCP_SERVER). It is an SDK-type server: the session's mcp.json carries `{"type":"sdk","name":"gnomon"}` and
 * Claude Code sends each JSON-RPC message to the kernel over the session's stdio control channel as
 * `control_request{subtype:'mcp_message', server_name, message}`; the kernel answers
 * `control_response{subtype:'success', request_id, response:{mcp_response}}` (adapter.ts mcpResponseLine). No process,
 * no socket and no port is opened: the caller IS the session the kernel spawned, so the hsid is never taken from the
 * message.
 *
 * Methods: `initialize` (tools capability only), `notifications/*` (acknowledged, nothing done), `ping`, `tools/list`
 * (the #git-verbs specs), `tools/call` (dispatched to GitVerbs; the result is `{content:[{type:'text'}], isError}`).
 * Anything else is JSON-RPC -32601. A message that is not a JSON-RPC 2.0 object is -32600. A server name other than
 * `gnomon` is answered with a control error by the supervisor (never routed).
 */
import { KERNEL_MCP_SERVER } from '../git/verbs.js';
import type { GitVerbs, VerbSession } from '../git/kernel-verbs.js';
import { GNOMON_VERSION } from '../../version.js';

/** The session mcp.json entry of the kernel's SDK server. */
export const KERNEL_MCP_ENTRY = Object.freeze({ type: 'sdk', name: KERNEL_MCP_SERVER });
/** The MCP protocol version answered when the client names none. */
export const KERNEL_MCP_PROTOCOL = '2025-06-18';

export type JsonRpcId = string | number | null;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One JSON-RPC message → its JSON-RPC answer (a notification is answered with an empty result, id 0). */
export async function kernelMcpAnswer(message: unknown, verbs: Pick<GitVerbs, 'tools' | 'call'>, session: () => VerbSession | null): Promise<Record<string, unknown>> {
  if (!isObj(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    const id = isObj(message) && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null;
    return { jsonrpc: '2.0', id, error: { code: -32600, message: 'invalid request' } };
  }
  const id: JsonRpcId = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null;
  const method = message.method;
  const params = isObj(message.params) ? message.params : {};
  if (id === null || method.startsWith('notifications/')) return { jsonrpc: '2.0', id: 0, result: {} };
  const ok = (result: Record<string, unknown>): Record<string, unknown> => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return ok({ protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion.slice(0, 32) : KERNEL_MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: KERNEL_MCP_SERVER, version: GNOMON_VERSION } });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: verbs.tools().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!verbs.tools().some((t) => t.name === name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${name.slice(0, 64)}` } };
      const s = session();
      if (!s) return ok({ content: [{ type: 'text', text: 'The session is not running.' }], isError: true });
      const r = await verbs.call(name, params.arguments ?? {}, s);
      return ok({ content: [{ type: 'text', text: r.text }], isError: !r.ok });
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method.slice(0, 64)}` } };
  }
}
