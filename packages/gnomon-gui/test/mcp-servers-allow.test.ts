/**
 * #gui-mcp-servers, TD-2026-10-23-361 (Aegis H1, M3; founder rulings): the rows name the human's own Claude Code allow
 * rules for each server (honoured, never overridden), inline code is said, and the Paradigm row shows where it runs
 * from and that a linked install runs live.
 */
import { describe, expect, it } from 'vitest';
import { autoAllowWords, emptyMcpUi, MCP_FIRST_PARTY, mcpSection } from '../src/core/mcp-servers.js';
import type { SettingRow } from '../src/core/settings.js';

const row = (o: Record<string, unknown>) => ({ id: 'user::github', name: 'github', sessionName: 'github', source: 'user', repo: null, plugin: null, transport: 'stdio', command: '/usr/bin/node', args: ['-e', 'x'], url: null, host: null, envNames: [], headerNames: [], needs: [], shell: null, fetches: null, inline: 'node -e', autoAllowed: ['mcp__github__*'], problems: [], on: { all: false, repos: [] }, changed: false, ...o });
const status = {
  mcp: {
    offered: true,
    platform: 'darwin',
    envFile: '~/.gnomon/loop-env',
    firstParty: { id: MCP_FIRST_PARTY, name: 'paradigm', on: true, available: true, version: '8.0.0', dir: '/Users/me/code/a-paradigm/packages/paradigm', linked: true, autoAllowed: ['mcp__paradigm'] },
    servers: [row({})],
    repos: [],
    pending: [],
  },
};
const how = (rs: SettingRow[], label: string): string => ((rs.find((r) => 'label' in r && r.label === label) as { how?: string } | undefined)?.how ?? '');

describe('#gui-mcp-servers: your allow rules and the live Paradigm path', () => {
  it("a row names the human's own allow rules and inline code", () => {
    const h = how(mcpSection({ status, ui: emptyMcpUi(), hsid: null }).rows, 'github');
    expect(h).toContain('no card for its tools: your Claude Code settings allow mcp__github__* (all tools)');
    expect(h).toContain('runs inline code (node -e)');
  });
  it('the Paradigm row shows where it runs from, that it is linked, and its allow rules', () => {
    const h = how(mcpSection({ status, ui: emptyMcpUi(), hsid: null }).rows, 'Paradigm MCP · first-party');
    expect(h).toContain('runs from /Users/me/code/a-paradigm/packages/paradigm (linked: it runs live as that folder changes, and sessions working in that folder can edit it)');
    expect(h).toContain('no card for its tools: your Claude Code settings allow mcp__paradigm (all tools)');
  });
  it('the words for each rule shape', () => {
    expect(autoAllowWords(['mcp__a__*', 'mcp__a__t', 'mcp__a', 'mcp__*'])).toBe('no card for its tools: your Claude Code settings allow mcp__a__* (all tools), mcp__a__t, mcp__a (all tools), mcp__* (every MCP tool)');
  });
});
