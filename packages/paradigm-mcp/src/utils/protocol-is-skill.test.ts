/** D4 (7.12.0): PROTOCOL_IS_SKILL — reverse of SKILL_IS_PROTOCOL. */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { lintProtocol, validateProtocol, type Protocol } from './protocol-loader.js';

const base: Omit<Protocol, 'steps'> = {
  id: 'P-x', name: 'x', description: 'x', trigger: [], tags: [], symbols: [],
  recorded_at: '2026-01-01T00:00:00Z', last_verified: '2099-01-01T00:00:00Z', status: 'current',
};

describe('PROTOCOL_IS_SKILL', () => {
  it('fires on a tool-only protocol that names no repo path', () => {
    const p: Protocol = { ...base, steps: [
      { action: 'run', command: 'paradigm_reindex', notes: 'Rebuild the index' },
      { action: 'verify', notes: 'Check the tool output looks right' },
    ] };
    const issues = lintProtocol(p);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('PROTOCOL_IS_SKILL');
    // warn only — status untouched
    const v = validateProtocol('/nonexistent', p);
    expect(v.status).toBe('current');
    expect(v.issues.some(i => i.startsWith('PROTOCOL_IS_SKILL'))).toBe(true);
  });

  it('treats a set target / template_from as a repo path (bare filename, {placeholder})', () => {
    expect(lintProtocol({ ...base, steps: [{ action: 'modify', target: 'portal.yaml', notes: 'Add the gate' }] })).toEqual([]);
    expect(lintProtocol({ ...base, steps: [{ action: 'create', target: 'docs/specs/{name}.md' }] })).toEqual([]);
  });

  it('is silent on real protocols that name paths only via target/template_from', () => {
    const dir = path.resolve(__dirname, '../../../../.paradigm/protocols');
    const fired = fs.readdirSync(dir).filter(f => f.endsWith('.protocol'))
      .filter(f => lintProtocol(yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')) as Protocol).length > 0);
    // 7.12.0 audit: these 8 name repo paths via target/template_from and used to fire.
    for (const f of ['add-case-study', 'add-hook-script', 'add-portal-gate', 'add-portal-route-with-gates',
      'add-skill', 'add-spec', 'add-upgrade-guide', 'cross-study']) {
      expect(fired).not.toContain(`${f}.protocol`);
    }
  });

  it('is silent on the real add-mcp-tool.protocol', () => {
    const file = path.resolve(__dirname, '../../../../.paradigm/protocols/add-mcp-tool.protocol');
    const p = yaml.load(fs.readFileSync(file, 'utf8')) as Protocol;
    expect(lintProtocol(p)).toEqual([]);
  });
});
