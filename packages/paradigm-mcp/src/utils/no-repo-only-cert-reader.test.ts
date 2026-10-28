/**
 * Scoped learning guard (review F1): premise-core's `readClassroomCertifications`
 * reads only the repo ledger, so it misses user-home certifications (from
 * transferable:true promotions). Paradigm code must read certifications through
 * paradigm-mcp `field-failures.readClassroomCertifications` (the union of every
 * home). This test fails if any paradigm or paradigm-mcp source imports or
 * re-exports the deprecated reader from @a-company/premise-core.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PACKAGES = path.resolve(__dirname, '../../..');
const ROOTS = [path.join(PACKAGES, 'paradigm', 'src'), path.join(PACKAGES, 'paradigm-mcp', 'src')];

function sources(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'node_modules' && ent.name !== 'dist') sources(p, out);
    } else if (/\.(ts|tsx|mts)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Named bindings of every `import {…}` / `export {…}` from @a-company/premise-core. */
function premiseCoreBindings(src: string): string[] {
  const names: string[] = [];
  const re = /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@a-company\/premise-core['"]/g;
  for (const m of src.matchAll(re)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe('no repo-only certification reader', () => {
  it('detects the binding in multi-line and aliased imports', () => {
    expect(premiseCoreBindings("import {\n  computeRepeatFailureRate,\n  readClassroomCertifications as r,\n} from '@a-company/premise-core';"))
      .toContain('readClassroomCertifications');
    expect(premiseCoreBindings("import { readClassroomCertifications } from './field-failures.js';")).toEqual([]);
  });

  it('no paradigm or paradigm-mcp source imports premise-core readClassroomCertifications', () => {
    const offenders = ROOTS.filter(r => fs.existsSync(r))
      .flatMap(r => sources(r))
      .filter(f => premiseCoreBindings(fs.readFileSync(f, 'utf8')).includes('readClassroomCertifications'))
      .map(f => path.relative(PACKAGES, f));
    expect(offenders).toEqual([]);
  });
});
