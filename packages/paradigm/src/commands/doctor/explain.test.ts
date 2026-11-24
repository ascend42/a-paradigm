import { describe, it, expect } from 'vitest';
import { explainFindings, findingsToExplain, type ExplainableFinding } from './explain.js';

const OK: ExplainableFinding = { name: '.purpose', status: 'ok', message: 'Present' };
const INFO: ExplainableFinding = { name: 'Aspect coverage', status: 'info', message: '10:2 components:aspects' };

describe('doctor --explain', () => {
  it('says plainly when there is nothing to explain', () => {
    expect(explainFindings([OK, INFO])).toEqual(['Nothing to explain: no check failed, warned or raised an advisory.']);
    expect(explainFindings([])).toHaveLength(1);
  });

  it('explains every failing, missing, warning and advisory check, most severe first', () => {
    const findings: ExplainableFinding[] = [
      OK,
      { name: 'orphaned-symbols', status: 'advisory', message: '3 isolated symbols', details: ['#a', '#b', '#c'] },
      { name: 'Lore entries', status: 'warn', message: 'Lore directory exists but no entries found', fix: 'paradigm lore record' },
      { name: 'stale-portal', status: 'error', message: '2 portal routes with no handler found', details: ['GET /api/a', 'GET /api/b'], fix: 'Implement or remove' },
      { name: 'CLAUDE.md', status: 'missing', message: 'Not found' },
    ];
    expect(findingsToExplain(findings).map((f) => f.name)).toEqual(['stale-portal', 'CLAUDE.md', 'Lore entries', 'orphaned-symbols']);

    const text = explainFindings(findings).join('\n');
    expect(text).toContain('4 findings explained');
    expect(text).toContain('[ERROR] stale-portal');
    expect(text).toContain('[MISSING] CLAUDE.md');
    expect(text).toContain('[WARNING] Lore entries');
    expect(text).toContain('[ADVISORY] orphaned-symbols');
    expect(text).not.toContain('.purpose\n');
  });

  it('prints what the check looks at, every detail line and the fix', () => {
    const details = Array.from({ length: 12 }, (_, i) => `GET /api/route-${i}`);
    const lines = explainFindings([
      { name: 'stale-portal', status: 'error', message: '12 portal routes with no handler found', details, fix: 'Implement or remove' },
    ]);
    const text = lines.join('\n');
    expect(text).toContain('What this checks: For each route in portal.yaml');
    expect(text).toContain('All 12 detail lines:');
    // plain doctor shows five; --explain shows all of them
    for (const d of details) expect(lines).toContain(`    - ${d}`);
    expect(text).toContain('Fix: Implement or remove');
  });

  it('a check with no written description still gets its finding and fix', () => {
    const text = explainFindings([{ name: 'Some new check', status: 'warn', message: 'odd', fix: 'do x' }]).join('\n');
    expect(text).toContain('[WARNING] Some new check');
    expect(text).toContain('Found: odd');
    expect(text).toContain('no longer description is written');
    expect(text).toContain('Fix: do x');
  });
});
