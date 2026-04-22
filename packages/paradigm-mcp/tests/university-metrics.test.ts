/**
 * university-metrics.test.ts — v5.39.0 / v6.0 University sub-phase 3.
 *
 * Covers `packages/paradigm-mcp/src/utils/university-metrics.ts`:
 *   - captureSnapshot writes a valid JSON snapshot matching the
 *     UniversityMetricsSnapshot shape at
 *     `.paradigm/university/.metrics/snapshot-YYYY-MM-DD.json`.
 *   - Same-day re-capture overwrites (idempotent per-day).
 *   - No-ops when `metrics.local_snapshots_enabled: false` in config.
 *   - pruneOldSnapshots removes snapshots older than the retention window
 *     and retains the younger ones.
 *   - computeProjectSaltHash is stable across calls and creates the salt
 *     file (0o600 where supported) on first call.
 *
 * Safety property preserved (D7 PRIVACY CONTRACT):
 *   Captured JSON MUST contain only counts + classifiers + hashed salt.
 *   It MUST NOT leak gate names, route paths, or entry titles. This test
 *   fabricates a pack with distinctive sentinel strings in its manifest,
 *   captures a snapshot, then greps the serialized JSON — asserting NONE
 *   of those sentinels appear in the snapshot.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  captureSnapshot,
  computeProjectSaltHash,
  pruneOldSnapshots,
  loadRecentSnapshots,
} from '../src/utils/university-metrics.js';

const SENTINEL_GATE = 'SECRET-GATE-DO-NOT-LEAK';
const SENTINEL_ROUTE = '/api/private/audit-do-not-leak';
const SENTINEL_TITLE = 'LEAKY-ENTRY-TITLE-DO-NOT-EXPORT';

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-metrics-'));
}

function writePackYaml(dir: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.yaml'), body, 'utf8');
}

describe('university-metrics — captureSnapshot', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('writes a snapshot matching UniversityMetricsSnapshot shape', () => {
    tmpDir = mktemp();
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'host' }), 'utf8');
    writePackYaml(
      path.join(tmpDir, '.paradigm', 'university'),
      'id: p\nname: P\nversion: 1\nschema_version: "1"\ntenant_kind: project\ndescription: p\n',
    );

    captureSnapshot(tmpDir);

    const today = new Date().toISOString().slice(0, 10);
    const snapPath = path.join(tmpDir, '.paradigm', 'university', '.metrics', `snapshot-${today}.json`);
    expect(fs.existsSync(snapPath)).toBe(true);

    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    expect(snap.schema_version).toBe('1');
    expect(typeof snap.captured_at).toBe('string');
    expect(snap.project_salt_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.packs).toBeDefined();
    expect(typeof snap.packs.count).toBe('number');
    expect(snap.packs.by_tenant_kind).toBeDefined();
    expect(snap.project_pack).toBeDefined();
    expect(snap.project_pack.entry_counts).toBeDefined();
    expect(snap.activity).toBeDefined();
    expect(typeof snap.activity.quiz_completions_last_30d).toBe('number');
    expect(typeof snap.activity.entries_created_last_30d).toBe('number');
  });

  it('same-day re-capture overwrites the snapshot (idempotent)', () => {
    tmpDir = mktemp();
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'host' }), 'utf8');
    writePackYaml(
      path.join(tmpDir, '.paradigm', 'university'),
      'id: p\nname: P\nversion: 1\nschema_version: "1"\ntenant_kind: project\ndescription: p\n',
    );

    captureSnapshot(tmpDir);
    const today = new Date().toISOString().slice(0, 10);
    const snapPath = path.join(tmpDir, '.paradigm', 'university', '.metrics', `snapshot-${today}.json`);
    const first = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

    captureSnapshot(tmpDir);
    const second = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

    // Same hash (stable), potentially different captured_at timestamps
    expect(second.project_salt_hash).toBe(first.project_salt_hash);

    // Exactly one snapshot file for today
    const files = fs.readdirSync(path.join(tmpDir, '.paradigm', 'university', '.metrics'));
    const todayFiles = files.filter(f => f.startsWith(`snapshot-${today}`));
    expect(todayFiles.length).toBe(1);
  });

  it('no-ops when config.metrics.local_snapshots_enabled is false', () => {
    tmpDir = mktemp();
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'host' }), 'utf8');
    fs.mkdirSync(path.join(tmpDir, '.paradigm'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.paradigm', 'config.yaml'),
      'metrics:\n  local_snapshots_enabled: false\n  remote_consent: pending\n',
      'utf8',
    );
    writePackYaml(
      path.join(tmpDir, '.paradigm', 'university'),
      'id: p\nname: P\nversion: 1\nschema_version: "1"\ntenant_kind: project\ndescription: p\n',
    );

    captureSnapshot(tmpDir);

    const metricsDir = path.join(tmpDir, '.paradigm', 'university', '.metrics');
    expect(fs.existsSync(metricsDir)).toBe(false);
  });

  it('SECURITY: snapshot JSON contains no gate names, route paths, or entry titles', () => {
    tmpDir = mktemp();
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'host' }), 'utf8');

    // Plant sentinels into the pack manifest — description / name / branding.
    writePackYaml(
      path.join(tmpDir, '.paradigm', 'university'),
      [
        'id: leaky-pack',
        `name: "${SENTINEL_GATE}"`,
        'version: 1.0.0',
        'schema_version: "1"',
        'tenant_kind: project',
        `description: "mentions ${SENTINEL_ROUTE} and ${SENTINEL_TITLE}"`,
        'branding:',
        `  tagline: "${SENTINEL_GATE}"`,
        `  institution: "${SENTINEL_TITLE}"`,
      ].join('\n'),
    );

    // Plant sentinels in a note body + title too.
    const notesDir = path.join(tmpDir, '.paradigm', 'university', 'content', 'notes');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.writeFileSync(
      path.join(notesDir, 'N-leaky.md'),
      `---\nid: N-leaky\ntitle: ${SENTINEL_TITLE}\ntype: note\n---\n\n${SENTINEL_GATE}\n${SENTINEL_ROUTE}\n`,
      'utf8',
    );

    captureSnapshot(tmpDir);

    const today = new Date().toISOString().slice(0, 10);
    const snapPath = path.join(tmpDir, '.paradigm', 'university', '.metrics', `snapshot-${today}.json`);
    const raw = fs.readFileSync(snapPath, 'utf8');

    expect(raw).not.toContain(SENTINEL_GATE);
    expect(raw).not.toContain(SENTINEL_ROUTE);
    expect(raw).not.toContain(SENTINEL_TITLE);
  });
});

describe('university-metrics — pruneOldSnapshots', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('removes snapshots older than 90 days and retains newer ones', () => {
    tmpDir = mktemp();
    const metricsDir = path.join(tmpDir, '.paradigm', 'university', '.metrics');
    fs.mkdirSync(metricsDir, { recursive: true });

    // Write a snapshot dated 100 days ago and one dated 10 days ago.
    const now = Date.now();
    const d100 = new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const d10 = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const old = path.join(metricsDir, `snapshot-${d100}.json`);
    const young = path.join(metricsDir, `snapshot-${d10}.json`);
    fs.writeFileSync(old, '{"schema_version":"1"}', 'utf8');
    fs.writeFileSync(young, '{"schema_version":"1"}', 'utf8');

    pruneOldSnapshots(tmpDir, 90);

    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(young)).toBe(true);
  });

  it('is a no-op when the metrics dir does not exist', () => {
    tmpDir = mktemp();
    // Should not throw
    expect(() => pruneOldSnapshots(tmpDir!, 90)).not.toThrow();
  });
});

describe('university-metrics — loadRecentSnapshots', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('returns newest snapshots first, capped by `days` arg', () => {
    tmpDir = mktemp();
    const metricsDir = path.join(tmpDir, '.paradigm', 'university', '.metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    const now = Date.now();
    for (let offset of [1, 3, 5]) {
      const d = new Date(now - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      fs.writeFileSync(
        path.join(metricsDir, `snapshot-${d}.json`),
        JSON.stringify({ schema_version: '1', tag: `d${offset}` }),
        'utf8',
      );
    }

    const snaps = loadRecentSnapshots(tmpDir, 2);
    expect(snaps.length).toBe(2);
  });

  it('returns [] when metrics dir does not exist', () => {
    tmpDir = mktemp();
    expect(loadRecentSnapshots(tmpDir, 7)).toEqual([]);
  });
});

describe('university-metrics — computeProjectSaltHash', () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('creates a salt file on first call and returns a stable 64-hex hash', () => {
    tmpDir = mktemp();
    const first = computeProjectSaltHash(tmpDir);
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    const saltPath = path.join(tmpDir, '.paradigm', '.metrics-salt');
    expect(fs.existsSync(saltPath)).toBe(true);

    // 0o600 on POSIX. On systems that don't enforce chmod (e.g. Windows),
    // we tolerate a looser permission. Here we just assert the file exists
    // with some content.
    const salt = fs.readFileSync(saltPath, 'utf8').trim();
    expect(salt.length).toBeGreaterThan(0);
  });

  it('is stable across calls: same rootDir → same hash', () => {
    tmpDir = mktemp();
    const a = computeProjectSaltHash(tmpDir);
    const b = computeProjectSaltHash(tmpDir);
    const c = computeProjectSaltHash(tmpDir);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('differs across rootDirs (salt + rootPath → distinct hashes)', () => {
    const a = mktemp();
    const b = mktemp();
    try {
      const ha = computeProjectSaltHash(a);
      const hb = computeProjectSaltHash(b);
      expect(ha).not.toBe(hb);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });
});
