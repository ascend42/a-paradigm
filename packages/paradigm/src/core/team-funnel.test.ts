/**
 * Tests for team-funnel telemetry (Pillar 0 — invocation reliability).
 * The summary metrics here are what Loid calibrates the gates from, so the
 * math must be exact: invocationRate = orchestrated / resolved,
 * legibleRate = (orchestrated + solo) / resolved, resolved = orch + solo + bypass.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  appendTeamFunnelEvent,
  readTeamFunnelEvents,
  summarizeTeamFunnel,
  SOLO_REASONS,
} from './team-funnel.js';

const FUNNEL = '.paradigm/events/team-funnel.jsonl';

describe('team-funnel', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends and reads typed events', () => {
    appendTeamFunnelEvent(dir, { type: 'eligible', source: 'prompt-gate', matched: 'implement' });
    appendTeamFunnelEvent(dir, { type: 'solo-declared', reason: 'trivial', note: 'one-liner' });
    const events = readTeamFunnelEvents(dir);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('eligible');
    expect(events[1].reason).toBe('trivial');
  });

  it('tolerates shell-written lines and garbage lines', () => {
    const filePath = path.join(dir, FUNNEL);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, [
      // exactly what the shell hooks emit
      '{"timestamp":"2026-06-10T17:58:19Z","type":"eligible","source":"prompt-gate","matched":"implement"}',
      '{"timestamp":"2026-06-10T18:05:48Z","type":"bypass","source":"stop-hook","magnitude":5,"reasons":"4 source files","severity":"warn"}',
      'not json at all',
      '{"timestamp":"2026-06-10T18:06:00Z"}', // missing type → dropped
    ].join('\n') + '\n');
    const events = readTeamFunnelEvents(dir);
    expect(events).toHaveLength(2);
    expect(events[1].magnitude).toBe(5);
  });

  it('computes invocation + legible rates correctly', () => {
    appendTeamFunnelEvent(dir, { type: 'eligible' });
    appendTeamFunnelEvent(dir, { type: 'eligible' });
    appendTeamFunnelEvent(dir, { type: 'orchestrated', mode: 'plan' });
    appendTeamFunnelEvent(dir, { type: 'solo-declared', reason: 'hotfix' });
    appendTeamFunnelEvent(dir, { type: 'solo-declared', reason: 'hotfix' });
    appendTeamFunnelEvent(dir, { type: 'bypass', magnitude: 4 });

    const s = summarizeTeamFunnel(dir);
    expect(s.eligible).toBe(2);
    expect(s.orchestrated).toBe(1);
    expect(s.soloDeclared).toBe(2);
    expect(s.bypasses).toBe(1);
    // resolved = 4 → invocation 1/4, legible 3/4
    expect(s.invocationRate).toBeCloseTo(0.25);
    expect(s.legibleRate).toBeCloseTo(0.75);
    expect(s.soloByReason).toEqual({ hotfix: 2 });
  });

  it('returns null rates when nothing resolved (no divide-by-zero)', () => {
    appendTeamFunnelEvent(dir, { type: 'eligible' });
    const s = summarizeTeamFunnel(dir);
    expect(s.invocationRate).toBeNull();
    expect(s.legibleRate).toBeNull();
  });

  it('filters by window', () => {
    const filePath = path.join(dir, FUNNEL);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(filePath,
      JSON.stringify({ timestamp: old, type: 'bypass' }) + '\n' +
      JSON.stringify({ timestamp: new Date().toISOString(), type: 'orchestrated' }) + '\n');
    const s = summarizeTeamFunnel(dir, 30);
    expect(s.bypasses).toBe(0);
    expect(s.orchestrated).toBe(1);
  });

  it('exports the four ratified solo reasons', () => {
    expect(SOLO_REASONS).toEqual(['trivial', 'hotfix', 'user-directed', 'exploratory']);
  });
});
