/**
 * Tests for agent-loader.ts — permissions, integrity, CRUD
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import {
  checkPathPermission,
  checkToolPermission,
  computeIntegrityHash,
  verifyIntegrity,
  saveAgentProfile,
  loadAgentProfile,
  createAgentProfile,
  loadAllAgentProfiles,
  buildProfileEnrichment,
} from './agent-loader.js';
import type { AgentProfile } from '../types/agents.js';

// ────────────────────────────────────────────────────────
// Test Helpers
// ────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'test-agent',
    role: 'Test agent',
    description: 'For testing',
    version: '1.0.0',
    personality: { style: 'deliberate', risk: 'balanced', verbosity: 'concise' },
    expertise: [],
    transferable: [],
    contexts: {},
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-test-'));
  fs.mkdirSync(path.join(tmpDir, '.paradigm', 'agents'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────
// checkPathPermission
// ────────────────────────────────────────────────────────

describe('checkPathPermission', () => {
  it('allows everything when no permissions set', () => {
    const profile = makeProfile();
    expect(checkPathPermission(profile, 'src/index.ts', 'read').allowed).toBe(true);
    expect(checkPathPermission(profile, 'src/index.ts', 'write').allowed).toBe(true);
  });

  it('allows everything when permissions.paths is empty', () => {
    const profile = makeProfile({ permissions: {} });
    expect(checkPathPermission(profile, 'src/index.ts', 'read').allowed).toBe(true);
  });

  it('denies paths matching deny patterns', () => {
    const profile = makeProfile({
      permissions: {
        paths: {
          deny: ['.paradigm/agents/*'],
        },
      },
    });
    const result = checkPathPermission(profile, '.paradigm/agents/builder.agent', 'write');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('denied');
  });

  it('deny overrides allow', () => {
    const profile = makeProfile({
      permissions: {
        paths: {
          write: ['*'],
          deny: ['.env*', '*.key'],
        },
      },
    });
    expect(checkPathPermission(profile, '.env.local', 'write').allowed).toBe(false);
    expect(checkPathPermission(profile, 'server.key', 'write').allowed).toBe(false);
    expect(checkPathPermission(profile, 'src/app.ts', 'write').allowed).toBe(true);
  });

  it('denies when allow patterns exist but none match', () => {
    const profile = makeProfile({
      permissions: {
        paths: {
          write: ['src/*'],
        },
      },
    });
    expect(checkPathPermission(profile, 'src/app.ts', 'write').allowed).toBe(true);
    expect(checkPathPermission(profile, 'lib/utils.ts', 'write').allowed).toBe(false);
  });

  it('read and write modes are independent', () => {
    const profile = makeProfile({
      permissions: {
        paths: {
          read: ['*'],
          write: ['src/*'],
        },
      },
    });
    expect(checkPathPermission(profile, 'lib/utils.ts', 'read').allowed).toBe(true);
    expect(checkPathPermission(profile, 'lib/utils.ts', 'write').allowed).toBe(false);
  });
});

// ────────────────────────────────────────────────────────
// checkToolPermission
// ────────────────────────────────────────────────────────

describe('checkToolPermission', () => {
  it('allows everything when no permissions set', () => {
    const profile = makeProfile();
    expect(checkToolPermission(profile, 'paradigm_search').allowed).toBe(true);
  });

  it('allows everything when permissions.tools is empty', () => {
    const profile = makeProfile({ permissions: {} });
    expect(checkToolPermission(profile, 'paradigm_search').allowed).toBe(true);
  });

  it('denies tools matching deny patterns', () => {
    const profile = makeProfile({
      permissions: {
        tools: {
          deny: ['Bash', 'Write'],
        },
      },
    });
    expect(checkToolPermission(profile, 'Bash').allowed).toBe(false);
    expect(checkToolPermission(profile, 'Write').allowed).toBe(false);
    expect(checkToolPermission(profile, 'Read').allowed).toBe(true);
  });

  it('deny overrides allow for tools', () => {
    const profile = makeProfile({
      permissions: {
        tools: {
          allow: ['paradigm_*'],
          deny: ['paradigm_pipeline_*'],
        },
      },
    });
    expect(checkToolPermission(profile, 'paradigm_search').allowed).toBe(true);
    expect(checkToolPermission(profile, 'paradigm_pipeline_start').allowed).toBe(false);
  });

  it('denies when allow patterns exist but none match', () => {
    const profile = makeProfile({
      permissions: {
        tools: {
          allow: ['paradigm_*', 'Read'],
        },
      },
    });
    expect(checkToolPermission(profile, 'paradigm_search').allowed).toBe(true);
    expect(checkToolPermission(profile, 'Read').allowed).toBe(true);
    expect(checkToolPermission(profile, 'Bash').allowed).toBe(false);
  });

  it('supports wildcard patterns', () => {
    const profile = makeProfile({
      permissions: {
        tools: {
          allow: ['paradigm_notebook_*'],
        },
      },
    });
    expect(checkToolPermission(profile, 'paradigm_notebook_search').allowed).toBe(true);
    expect(checkToolPermission(profile, 'paradigm_notebook_add').allowed).toBe(true);
    expect(checkToolPermission(profile, 'paradigm_search').allowed).toBe(false);
  });
});

// ────────────────────────────────────────────────────────
// Integrity Hashing
// ────────────────────────────────────────────────────────

describe('computeIntegrityHash', () => {
  it('produces a hex string', () => {
    const profile = makeProfile();
    const hash = computeIntegrityHash(profile);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const profile = makeProfile();
    expect(computeIntegrityHash(profile)).toBe(computeIntegrityHash(profile));
  });

  it('changes when id changes', () => {
    const p1 = makeProfile({ id: 'agent-a' });
    const p2 = makeProfile({ id: 'agent-b' });
    expect(computeIntegrityHash(p1)).not.toBe(computeIntegrityHash(p2));
  });

  it('changes when role changes', () => {
    const p1 = makeProfile({ role: 'Architect' });
    const p2 = makeProfile({ role: 'Builder' });
    expect(computeIntegrityHash(p1)).not.toBe(computeIntegrityHash(p2));
  });

  it('changes when permissions change', () => {
    const p1 = makeProfile({ permissions: { paths: { deny: ['*.key'] } } });
    const p2 = makeProfile({ permissions: { paths: { deny: ['*.pem'] } } });
    expect(computeIntegrityHash(p1)).not.toBe(computeIntegrityHash(p2));
  });

  it('is same when only non-hashed fields differ', () => {
    const p1 = makeProfile({ description: 'Version A', expertise: [{ symbol: '#foo', confidence: 0.5, sessions: 1, lastTouch: '' }] });
    const p2 = makeProfile({ description: 'Version B', expertise: [] });
    // Only id, role, permissions are hashed — description and expertise don't affect it
    expect(computeIntegrityHash(p1)).toBe(computeIntegrityHash(p2));
  });
});

describe('verifyIntegrity', () => {
  it('returns valid for profiles without integrityHash (pre-4.0)', () => {
    const profile = makeProfile();
    const result = verifyIntegrity(profile);
    expect(result.valid).toBe(true);
    expect(result.reason).toContain('No integrity hash');
  });

  it('returns valid when hash matches', () => {
    const profile = makeProfile({
      permissions: { paths: { deny: ['*.key'] } },
    });
    profile.integrityHash = computeIntegrityHash(profile);
    expect(verifyIntegrity(profile).valid).toBe(true);
  });

  it('returns invalid when profile was tampered', () => {
    const profile = makeProfile({
      permissions: { paths: { deny: ['*.key'] } },
    });
    profile.integrityHash = computeIntegrityHash(profile);
    // Tamper with permissions
    profile.permissions!.paths!.deny = [];
    const result = verifyIntegrity(profile);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('returns invalid when role was tampered', () => {
    const profile = makeProfile({ role: 'Reviewer' });
    profile.integrityHash = computeIntegrityHash(profile);
    profile.role = 'Admin';
    expect(verifyIntegrity(profile).valid).toBe(false);
  });
});

// ────────────────────────────────────────────────────────
// saveAgentProfile auto-hash
// ────────────────────────────────────────────────────────

describe('saveAgentProfile', () => {
  it('auto-computes integrityHash when permissions exist', () => {
    const profile = makeProfile({
      permissions: { paths: { deny: ['*.key'] } },
    });
    const filePath = saveAgentProfile('test-agent', profile, 'project', tmpDir);
    const saved = yaml.load(fs.readFileSync(filePath, 'utf-8')) as AgentProfile;
    expect(saved.integrityHash).toBeDefined();
    expect(saved.integrityHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not add integrityHash when no permissions', () => {
    const profile = makeProfile();
    const filePath = saveAgentProfile('test-agent', profile, 'project', tmpDir);
    const saved = yaml.load(fs.readFileSync(filePath, 'utf-8')) as AgentProfile;
    expect(saved.integrityHash).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────
// CRUD
// ────────────────────────────────────────────────────────

describe('createAgentProfile', () => {
  it('creates a profile file', () => {
    const { profile, filePath } = createAgentProfile('test-builder', {
      scope: 'project',
      rootDir: tmpDir,
      role: 'Builder',
    });
    expect(fs.existsSync(filePath)).toBe(true);
    expect(profile.id).toBe('test-builder');
    expect(profile.role).toBe('Builder');
  });
});

describe('loadAgentProfile', () => {
  it('returns null for non-existent profile', () => {
    expect(loadAgentProfile(tmpDir, 'nonexistent')).toBeNull();
  });

  it('loads a project-scoped profile', () => {
    createAgentProfile('test-loader', { scope: 'project', rootDir: tmpDir });
    const loaded = loadAgentProfile(tmpDir, 'test-loader');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('test-loader');
  });
});

describe('loadAllAgentProfiles', () => {
  it('loads project profiles created in tmpDir', () => {
    // Note: this may also pick up global profiles from ~/.paradigm/agents/
    // so we test that our created profiles are present, not that the array
    // has an exact length
    createAgentProfile('agent-a', { scope: 'project', rootDir: tmpDir });
    createAgentProfile('agent-b', { scope: 'project', rootDir: tmpDir });
    const profiles = loadAllAgentProfiles(tmpDir);
    const ids = profiles.map(p => p.id);
    expect(ids).toContain('agent-a');
    expect(ids).toContain('agent-b');
  });
});

// ────────────────────────────────────────────────────────
// buildProfileEnrichment
// ────────────────────────────────────────────────────────

describe('buildProfileEnrichment', () => {
  it('includes personality section', () => {
    const profile = makeProfile();
    const text = buildProfileEnrichment(profile, []);
    expect(text).toContain('Agent Identity');
    expect(text).toContain('deliberate');
  });

  it('includes relevant expertise', () => {
    const profile = makeProfile({
      expertise: [
        { symbol: '#auth', confidence: 0.9, sessions: 5, lastTouch: '' },
        { symbol: '#db', confidence: 0.3, sessions: 1, lastTouch: '' },
      ],
    });
    const text = buildProfileEnrichment(profile, ['#auth']);
    expect(text).toContain('#auth');
    expect(text).not.toContain('#db');
  });

  it('includes all expertise when relevantSymbols is empty', () => {
    const profile = makeProfile({
      expertise: [
        { symbol: '#auth', confidence: 0.9, sessions: 5, lastTouch: '' },
        { symbol: '#db', confidence: 0.3, sessions: 1, lastTouch: '' },
      ],
    });
    const text = buildProfileEnrichment(profile, []);
    expect(text).toContain('#auth');
    expect(text).toContain('#db');
  });

  it('includes notebook entries when provided', () => {
    const profile = makeProfile();
    const notebooks = [
      { context: 'JWT auth pattern', snippet: 'const token = jwt.sign(payload, secret)', concepts: ['auth', 'jwt'] },
    ];
    const text = buildProfileEnrichment(profile, [], notebooks);
    expect(text).toContain('Notebook Entries');
    expect(text).toContain('JWT auth pattern');
    expect(text).toContain('jwt.sign');
  });

  it('limits notebook entries to 5', () => {
    const profile = makeProfile();
    const notebooks = Array.from({ length: 10 }, (_, i) => ({
      context: `Entry ${i}`,
      snippet: `code ${i}`,
      concepts: [`concept-${i}`],
    }));
    const text = buildProfileEnrichment(profile, [], notebooks);
    expect((text.match(/Entry \d/g) || []).length).toBeLessThanOrEqual(5);
  });
});
