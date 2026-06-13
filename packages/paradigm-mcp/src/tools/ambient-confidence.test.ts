/**
 * Tests for the v7 §2.0 real-`confidence_after` threading in runPostflightLearning.
 *
 * When a verdict carries a REAL `confidence` (0–1), the journal entry's
 * `confidence_after` must use it; absent the real value, it falls back to the
 * branch literal (accepted=0.85). Journal entries write to
 * $HOME/.paradigm/agents/<id>/journal — we point HOME at a temp dir so the
 * assertion is hermetic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runPostflightLearning } from './ambient.js';
import { appendVerdictEntry } from '../utils/session-work-log.js';
import { loadJournalEntries } from '../utils/journal-loader.js';

let root: string;
let home: string;
let savedHome: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-conf-root-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-conf-home-'));
  savedHome = process.env.HOME;
  process.env.HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  for (const d of [root, home]) {
    if (d && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('runPostflightLearning — real confidence_after', () => {
  it('prefers the verdict.confidence value when present', async () => {
    appendVerdictEntry(root, {
      timestamp: new Date().toISOString(),
      type: 'user-verdict',
      agent: 'kit',
      nominationId: 'nom-real',
      verdict: 'accepted',
      confidence: 0.91, // REAL post-task confidence
    });

    await runPostflightLearning(root, {});

    const entries = loadJournalEntries('kit', {});
    const target = entries.find(e => (e.tags || []).includes('verdict:accepted'));
    expect(target).toBeTruthy();
    expect(target!.confidence_after).toBe(0.91);
  });

  it('falls back to the branch literal when no real confidence is given', async () => {
    appendVerdictEntry(root, {
      timestamp: new Date().toISOString(),
      type: 'user-verdict',
      agent: 'kit',
      nominationId: 'nom-fallback',
      verdict: 'accepted',
      // no confidence
    });

    await runPostflightLearning(root, {});

    const entries = loadJournalEntries('kit', {});
    const target = entries.find(e => (e.tags || []).includes('verdict:accepted'));
    expect(target).toBeTruthy();
    expect(target!.confidence_after).toBe(0.85); // accepted literal
  });
});
