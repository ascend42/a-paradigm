// S2.1: one project-hue function for the GUI rail and the kernel's Workshop feed.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROJECT_HUES, projectHue } from '../src/index.js';

describe('projectHue (#gnomon-contracts, S2.1)', () => {
  it('is sha256(utf8(cwd))[0] mod 6, equal to the node digest (pure sha256 = node:crypto)', () => {
    expect(PROJECT_HUES).toBe(6);
    for (const cwd of ['/Users/matt/code/billing', '/srv/ledgerette', 'C:/work/atelier', '/tmp/\u00fcn\u00ef', '']) {
      const want = createHash('sha256').update(cwd, 'utf8').digest()[0]! % 6;
      expect(projectHue(cwd), cwd).toBe(want);
    }
  });
  it('always lands on one of the six pigments', () => {
    for (let i = 0; i < 200; i++) expect(projectHue(`/p/${i}`)).toBeLessThan(6);
  });
});
