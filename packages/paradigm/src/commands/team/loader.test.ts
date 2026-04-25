import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import {
  loadAgentsManifest,
  saveAgentsManifest,
  loadAgentsManifestWithReciprocity,
} from './loader.js';
import type { AgentsManifest } from './types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-loader-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeManifest(manifest: AgentsManifest) {
  fs.mkdirSync(path.join(tmpDir, '.paradigm'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, '.paradigm', 'agents.yaml'),
    yaml.dump(manifest)
  );
}

const baseAgent = {
  role: 'role',
  focus: { reads: [], writes: [] },
  triggers: [],
  handoff_to: [],
};

describe('loadAgentsManifestWithReciprocity', () => {
  it('returns null when manifest missing', () => {
    expect(loadAgentsManifestWithReciprocity(tmpDir)).toBeNull();
  });

  it('returns empty pending when all pairings reciprocal', () => {
    writeManifest({
      version: '1.0.0',
      team: { name: 't', default_agent: 'scholar', require_handoff: false },
      agents: {
        scholar: { name: 'scholar', ...baseAgent, partners: [{ id: 'sheila' }] },
        sheila: { name: 'sheila', ...baseAgent, partners: [{ id: 'scholar' }] },
      },
    });
    const result = loadAgentsManifestWithReciprocity(tmpDir);
    expect(result?.pending).toEqual([]);
  });

  it('detects pending one-way pair', () => {
    writeManifest({
      version: '1.0.0',
      team: { name: 't', default_agent: 'scholar', require_handoff: false },
      agents: {
        scholar: { name: 'scholar', ...baseAgent, partners: [{ id: 'sheila' }] },
        sheila: { name: 'sheila', ...baseAgent },
      },
    });
    const result = loadAgentsManifestWithReciprocity(tmpDir);
    expect(result?.pending).toEqual([{ id: 'scholar', pendingPartners: ['sheila'] }]);
  });

  it('ignores partners pointing to non-existent agents', () => {
    writeManifest({
      version: '1.0.0',
      team: { name: 't', default_agent: 'scholar', require_handoff: false },
      agents: {
        scholar: { name: 'scholar', ...baseAgent, partners: [{ id: 'ghost' }] },
      },
    });
    const result = loadAgentsManifestWithReciprocity(tmpDir);
    expect(result?.pending).toEqual([]);
  });
});

describe('saveAgentsManifest partners hygiene', () => {
  it('strips empty partners arrays from output yaml', () => {
    saveAgentsManifest(tmpDir, {
      version: '1.0.0',
      team: { name: 't', default_agent: 'scholar', require_handoff: false },
      agents: {
        scholar: { name: 'scholar', ...baseAgent, partners: [] },
      },
    });
    const reloaded = loadAgentsManifest(tmpDir);
    expect(reloaded?.agents.scholar.partners).toBeUndefined();
  });

  it('preserves non-empty partners array round-trip', () => {
    saveAgentsManifest(tmpDir, {
      version: '1.0.0',
      team: { name: 't', default_agent: 'scholar', require_handoff: false },
      agents: {
        scholar: {
          name: 'scholar',
          ...baseAgent,
          partners: [{ id: 'sheila', relation: 'educator-pair' }],
        },
      },
    });
    const reloaded = loadAgentsManifest(tmpDir);
    expect(reloaded?.agents.scholar.partners).toEqual([
      { id: 'sheila', relation: 'educator-pair' },
    ]);
  });

  it('does not write `partners: null` when undefined', () => {
    saveAgentsManifest(tmpDir, {
      version: '1.0.0',
      team: { name: 't', default_agent: 'scholar', require_handoff: false },
      agents: {
        scholar: { name: 'scholar', ...baseAgent },
      },
    });
    const raw = fs.readFileSync(path.join(tmpDir, '.paradigm', 'agents.yaml'), 'utf8');
    expect(raw).not.toContain('partners: null');
    expect(raw).not.toContain('partners:');
  });
});
