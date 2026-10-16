/**
 * D1 (7.12.0): `work-completed` events never become nominations; other event
 * types (e.g. gate-added) still nominate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('./agent-loader.js', () => ({
  loadAllAgentProfiles: () => [{ id: 'security', role: 'Security', attention: { symbols: ['*'] } }],
  isAgentActive: () => true,
  loadAgentProfile: () => null,
  saveAgentProfile: () => undefined,
}));
vi.mock('./event-stream.js', () => ({
  emitEvent: vi.fn(),
  scoreEventForAgent: () => ({
    score: 0.9, shouldNominate: true,
    breakdown: { symbolMatch: 1, pathMatch: 0, conceptMatch: 0, signalMatch: 0 },
  }),
}));

import { processEvent, NON_NOMINATING_EVENT_TYPES } from './nomination-engine.js';
import type { StreamEvent } from '../types/ambient.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nom-wc-')); });

function ev(type: string): StreamEvent {
  return { id: `ev-${type}`, timestamp: new Date().toISOString(), type, source: 'mcp', symbols: ['#x'] } as unknown as StreamEvent;
}

describe('work-completed nominations (D1)', () => {
  it('work-completed produces 0 nominations and writes nothing', () => {
    const r = processEvent(root, ev('work-completed'));
    expect(r.nominations).toHaveLength(0);
    expect(fs.existsSync(path.join(root, '.paradigm', 'events', 'nominations.jsonl'))).toBe(false);
    expect(NON_NOMINATING_EVENT_TYPES.has('work-completed')).toBe(true);
  });

  it('gate-added still nominates', () => {
    const r = processEvent(root, ev('gate-added'));
    expect(r.nominations).toHaveLength(1);
    expect(r.nominations[0].brief).not.toMatch(/Work completed/);
  });
});
