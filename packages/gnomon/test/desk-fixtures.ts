/** Shared fixtures for the Desk tests (TD-2026-10-20-812, slice S1). */
import type { DeskMod } from '../src/kernel/desk/mcp-passthrough.js';
import type { ManifestV2 } from '../src/kernel/manifest/manifest.js';

export const HSID = 'hsid:v1:01J00000000000000000000000';
export const HSID2 = 'hsid:v1:01J00000000000000000000001';
export const HUMAN = 'p:abcdefgh/founder';
export const KERNEL = 'p:abcdefgh/kernel';

/** A Desk mod for the router/passthrough tests. S0b: `name` is a mod id (a bare name becomes acme.<name>); one server, no entry name. */
export function deskMod(id: string, opts: { offers?: boolean; config?: { command?: true; args?: true; env?: string[] } } = {}): DeskMod {
  const name = id.includes('.') ? id : `acme.${id}`;
  const [publisher, bare] = name.split('.') as [string, string];
  const entries = [{ command: '/usr/local/bin/npx', args: [`${bare}-server`], ...(opts.config ? { config: opts.config } : {}) }];
  const offers = opts.offers === false ? [] : [
    { kind: 'map-the-idea', phase: 'diverge' as const, title: `Map it on ${name}`, summary: 'Lays the idea out as a board.', contextIn: ['recent-messages' as const], resultOut: 'board-link', reach: 'mcp' as const, handoffTool: 'open_board', related: [], restraint: 'Not for a one-line question.' },
    { kind: 'pull-together', phase: 'synthesize' as const, title: 'Pull it together', summary: 'Summarises the threads.', contextIn: ['recent-messages' as const, 'repo-path' as const], resultOut: 'summary', reach: 'mcp' as const, handoffTool: 'summarise', related: [], restraint: 'Only after real divergence.' },
  ];
  const manifest = { manifest: 2, kind: 'mod', publisher, name: bare, version: '1.0.0', abi: 'x', provides: { mcp: entries, ...(offers.length ? { offers } : {}) } } as unknown as ManifestV2;
  return { name, manifest };
}

export function offerReply(prose: string, block: Record<string, unknown> | string): string {
  return `${prose}\n\n\`\`\`offer\n${typeof block === 'string' ? block : JSON.stringify(block)}\n\`\`\``;
}

export function assistantLine(text: string): string {
  return JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text }] } });
}

export function toolUseLine(id: string, name: string): string {
  return JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_2', role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] } });
}

export function toolResultLine(id: string, isError = false): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }] } });
}
