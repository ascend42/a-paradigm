/**
 * Regression tests for portal-writer.ts
 *
 * These guard against the v5.37.11 silent-no-op bug:
 *   - `gates: []` in portal.yaml (the v2 scaffold from `paradigm shift`)
 *     was parsed as a JS Array, survived the `if (!data.gates)` guard,
 *     had a named property assigned to it, then js-yaml.dump silently
 *     dropped the named property on serialization — leaving the file
 *     byte-for-byte unchanged while the handler returned success.
 *
 * Critical assertions:
 *   - `expect(Array.isArray(parsed.gates)).toBe(false)` distinguishes the
 *     bug from correct behavior; a response-shape-only test would pass
 *     against the broken code.
 *   - Read-back via raw `fs.readFileSync + yaml.load` — not via the
 *     writer's own reader — ensures we're checking disk state, not
 *     the in-memory object the writer handed us.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { addGateToPortal, addRouteToPortal } from '../src/utils/portal-writer.js';

interface PortalShape {
  version?: string;
  gates?: Record<string, { description?: string; prizes?: unknown[] }> | unknown[];
  routes?: Record<string, string[]> | unknown[];
}

function readPortalRaw(tmpDir: string): PortalShape {
  const content = fs.readFileSync(path.join(tmpDir, 'portal.yaml'), 'utf8');
  return (yaml.load(content) as PortalShape) ?? {};
}

describe('addGateToPortal', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-portal-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a gate when portal.yaml has v2 scaffold with `gates: []` (Array)', () => {
    // v2 scaffold emitted by paradigm shift (pre-5.37.11) — this is the bug trigger
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      "version: '2.0'\ngates: []\nroutes: []\n",
    );

    addGateToPortal(tmpDir, {
      id: 'authenticated',
      description: 'user logged in',
    });

    const parsed = readPortalRaw(tmpDir);

    // CRITICAL: this assertion is what distinguishes the fix from the bug.
    // The broken version would leave gates as [].
    expect(Array.isArray(parsed.gates)).toBe(false);
    expect(parsed.gates).toBeDefined();

    const gates = parsed.gates as Record<string, { description?: string }>;
    expect(gates.authenticated).toBeDefined();
    expect(gates.authenticated.description).toBe('user logged in');
  });

  it('adds a gate when portal.yaml has `gates: {}` (correct shape)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      "version: '2.0'\ngates: {}\nroutes: {}\n",
    );

    addGateToPortal(tmpDir, {
      id: 'authenticated',
      description: 'user logged in',
    });

    const parsed = readPortalRaw(tmpDir);
    expect(Array.isArray(parsed.gates)).toBe(false);
    const gates = parsed.gates as Record<string, { description?: string }>;
    expect(gates.authenticated?.description).toBe('user logged in');
  });

  it('preserves existing gates when adding a new one', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      [
        "version: '2.0'",
        'gates:',
        '  existing-gate:',
        '    description: already here',
        '    prizes: []',
        'routes: {}',
      ].join('\n') + '\n',
    );

    addGateToPortal(tmpDir, {
      id: 'authenticated',
      description: 'user logged in',
    });

    const parsed = readPortalRaw(tmpDir);
    const gates = parsed.gates as Record<string, { description?: string }>;
    expect(gates['existing-gate']?.description).toBe('already here');
    expect(gates.authenticated?.description).toBe('user logged in');
  });

  it('strips symbol prefix from the gate id', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      "version: '2.0'\ngates: []\n",
    );

    addGateToPortal(tmpDir, {
      id: '^admin-only',
      description: 'admins only',
    });

    const parsed = readPortalRaw(tmpDir);
    const gates = parsed.gates as Record<string, { description?: string }>;
    expect(gates['admin-only']).toBeDefined();
    // No leading ^ in the key
    expect(gates['^admin-only']).toBeUndefined();
  });

  it('throws with a descriptive error when write verification fails', () => {
    // Trap: symlink portal.yaml to /dev/null. Writes succeed silently (no-op),
    // but read-back returns empty content — the writer cannot confirm the
    // mutation and must throw rather than return fake success.
    if (process.platform === 'win32') {
      return; // /dev/null trick is POSIX-only
    }
    fs.symlinkSync('/dev/null', path.join(tmpDir, 'portal.yaml'));

    expect(() =>
      addGateToPortal(tmpDir, {
        id: 'never-lands',
        description: 'this should fail verification',
      }),
    ).toThrow(/write verification failed/);
  });
});

describe('addRouteToPortal', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-portal-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a route when portal.yaml has v2 scaffold with `routes: []` (Array)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      "version: '2.0'\ngates: []\nroutes: []\n",
    );

    addRouteToPortal(tmpDir, {
      method: 'POST',
      route: '/api/admin',
      gates: ['authenticated', '^admin-only'],
    });

    const parsed = readPortalRaw(tmpDir);

    expect(Array.isArray(parsed.routes)).toBe(false);
    const routes = parsed.routes as Record<string, string[]>;
    expect(routes['POST /api/admin']).toBeDefined();
    expect(routes['POST /api/admin']).toEqual(['^authenticated', '^admin-only']);
  });

  it('adds a route when portal.yaml has `routes: {}` (correct shape)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'portal.yaml'),
      "version: '2.0'\ngates: {}\nroutes: {}\n",
    );

    addRouteToPortal(tmpDir, {
      method: 'GET',
      route: '/api/health',
      gates: [],
    });

    const parsed = readPortalRaw(tmpDir);
    const routes = parsed.routes as Record<string, string[]>;
    expect(routes['GET /api/health']).toEqual([]);
  });

  it('throws when route write verification fails', () => {
    if (process.platform === 'win32') {
      return;
    }
    // Same /dev/null symlink trap as the gate test.
    fs.symlinkSync('/dev/null', path.join(tmpDir, 'portal.yaml'));

    expect(() =>
      addRouteToPortal(tmpDir, {
        method: 'POST',
        route: '/api/never',
        gates: ['authenticated'],
      }),
    ).toThrow(/write verification failed/);
  });
});
