/**
 * decidePromotion — pure belief-delta gate (7.12.0, D6). One row per reason.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decidePromotion, loadPromotionBands, DEFAULT_PROMOTION_BANDS } from './nomination-engine.js';

const b = DEFAULT_PROMOTION_BANDS; // floor .7, deltaMin .1, epsilon .05, novelBar .8
const none = { value: 0.5, found: false };
const prior = (value: number) => ({ value, found: true });

describe('decidePromotion', () => {
  const cases: Array<[string, { after?: number; trigger: string }, { value: number; found: boolean }, boolean, string]> = [
    ['no-after', { trigger: 'pattern_discovered' }, prior(0.5), false, 'no-after'],
    ['human promotes at floor', { after: 0.7, trigger: 'human_feedback' }, prior(0.95), true, 'human'],
    ['human below floor', { after: 0.69, trigger: 'human_feedback' }, none, false, 'below-floor'],
    ['below floor', { after: 0.6, trigger: 'pattern_discovered' }, none, false, 'below-floor'],
    ['novel at bar', { after: 0.8, trigger: 'pattern_discovered' }, none, true, 'novel'],
    ['novel under bar', { after: 0.79, trigger: 'pattern_discovered' }, none, false, 'novel'],
    ['hold (|delta| < epsilon)', { after: 0.92, trigger: 'pattern_discovered' }, prior(0.9), false, 'hold-silence'],
    ['delta >= deltaMin', { after: 0.75, trigger: 'pattern_discovered' }, prior(0.6), true, 'delta'],
    ['regressed', { after: 0.75, trigger: 'pattern_discovered' }, prior(0.9), false, 'regressed'],
    ['small rise (epsilon..deltaMin)', { after: 0.77, trigger: 'pattern_discovered' }, prior(0.7), false, 'below-delta'],
  ];
  for (const [name, e, p, promote, reason] of cases) {
    it(name, () => {
      expect(decidePromotion(e, p, b)).toEqual({ promote, reason });
    });
  }
});

describe('loadPromotionBands', () => {
  it('defaults when config.yaml is absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bands-'));
    expect(loadPromotionBands(root)).toEqual(DEFAULT_PROMOTION_BANDS);
  });
  it('reads camelCase + snake_case and ignores out-of-range values', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bands-'));
    fs.mkdirSync(path.join(root, '.paradigm'));
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'),
      'learning:\n  promotion:\n    floor: 0.6\n    delta_min: 0.2\n    epsilon: 5\n    novelBar: 0.85\n');
    expect(loadPromotionBands(root)).toEqual({ floor: 0.6, deltaMin: 0.2, epsilon: 0.05, novelBar: 0.85 });
  });
});
