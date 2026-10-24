import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildPluginCheckReport,
  detectPluginHost,
  formatPluginUpdateSummary,
  pluginUpdateCommand,
  toPluginUpdateNotices,
  type PluginUpdateResult,
} from './plugin-update-checker.js';

function result(over: Partial<PluginUpdateResult> = {}): PluginUpdateResult {
  return {
    repo: 'neondatabase/agent-skills',
    plugin: 'neon-postgres',
    marketplace: 'neon',
    installedVersion: '2.3.0',
    installedSha: 'd814689cbba1506b7a25a7a6df5346258ba8ccf8',
    localVersion: '2.3.0',
    remoteSha: 'd814689cbba1506b7a25a7a6df5346258ba8ccf8',
    marketplacePath: '/home/u/.claude/plugins/marketplaces/neon',
    hasRemoteUpdate: false,
    hasCacheStale: false,
    marketplaceContentHash: 'aaaaaaaaaaaa',
    cachedContentHash: 'aaaaaaaaaaaa',
    hasContentDrift: false,
    ...over,
  };
}

const drift = result({ hasCacheStale: true, hasContentDrift: true, cachedContentHash: '6a8448a47720', marketplaceContentHash: '712c4c732f47' });

describe('#plugin-update-checker', () => {
  it('turns content drift into an inert structured notice', () => {
    expect(toPluginUpdateNotices([drift])).toEqual([{
      kind: 'plugin-update',
      plugin: 'neon-postgres',
      marketplace: 'neon',
      repo: 'neondatabase/agent-skills',
      from: '6a8448a47720',
      to: '712c4c732f47',
      reason: 'content-changed',
      command: 'claude plugin marketplace update neon && claude plugin update neon-postgres@neon',
    }]);
  });

  it('classifies remote commits and version changes; up-to-date plugins give no notice', () => {
    const notices = toPluginUpdateNotices([
      result(),
      result({ plugin: 'a', hasRemoteUpdate: true, remoteSha: 'ffffffffffffffffffff' }),
      result({ plugin: 'b', hasCacheStale: true, installedVersion: '1.0.0', localVersion: '1.1.0' }),
    ]);
    expect(notices.map((n) => [n.plugin, n.reason, n.from, n.to])).toEqual([
      ['a', 'remote-commits', 'd814689cbba1', 'ffffffffffff'],
      ['b', 'version-changed', '1.0.0', '1.1.0'],
    ]);
  });

  it('derives the marketplace name from the clone dir for older stored results', () => {
    const [n] = toPluginUpdateNotices([{ ...drift, marketplace: undefined }]);
    expect(n.marketplace).toBe('neon');
  });

  it('detects Gnomon sessions by GNOMON_HSID', () => {
    expect(detectPluginHost({ GNOMON_HSID: 'hs_123' })).toBe('gnomon');
    expect(detectPluginHost({ GNOMON_HSID: '' })).toBe('claude-code');
    expect(detectPluginHost({})).toBe('claude-code');
  });

  it('Gnomon wording names only the terminal command, never /plugin', () => {
    const text = formatPluginUpdateSummary(toPluginUpdateNotices([drift]), 'gnomon');
    expect(text).toContain(pluginUpdateCommand('neon-postgres', 'neon'));
    expect(text).not.toContain('/plugin');
  });

  it('Claude Code wording may name /plugin', () => {
    const text = formatPluginUpdateSummary(toPluginUpdateNotices([drift]), 'claude-code');
    expect(text).toContain('/plugin');
    expect(text).toContain('claude plugin update neon-postgres@neon');
  });

  it('never addresses the agent', () => {
    for (const host of ['gnomon', 'claude-code'] as const) {
      const report = JSON.stringify(buildPluginCheckReport([drift], host));
      expect(report).not.toMatch(/tell the user|suggest the following|restart the claude code session/i);
      expect(report).not.toContain('PLUGIN UPDATES AVAILABLE');
    }
  });

  it('report carries host, count, notices and summary', () => {
    const r = buildPluginCheckReport([drift, result({ plugin: 'ok' })], 'gnomon');
    expect(r.host).toBe('gnomon');
    expect(r.pluginsChecked).toBe(2);
    expect(r.notices).toHaveLength(1);
    expect(buildPluginCheckReport([], 'gnomon').summary).toMatch(/No Claude Code plugins found/);
    expect(buildPluginCheckReport([result()], 'gnomon').summary).toBe('All installed plugins are up to date.');
  });

  it('the dispatcher no longer prepends plugin notices to the first tool result', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'index.ts'), 'utf8');
    expect(src).not.toContain('getPluginUpdateNotice');
    expect(src).not.toContain('schedulePluginUpdateCheck');
  });
});
