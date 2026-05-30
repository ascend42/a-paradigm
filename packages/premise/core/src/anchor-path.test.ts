/**
 * Tests for anchor-path.ts — shared anchor resolution helper.
 *
 * Covers Option B fix (v6.0.5) for the writer/reader path mismatch in
 * paradigm_purpose_add_aspect ↔ paradigm_aspect_check. These unit tests
 * pin first-match-wins ordering and the mismatch detector used for the
 * Helix DX hint.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveAnchorPath, detectAnchorBaseMismatch } from './anchor-path.js';

let tmpRoot: string;
let purposeDir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-path-'));
  // Project layout:
  //   <tmpRoot>/                        ← project root
  //     packages/foo/.purpose           ← (conceptual) .purpose file lives here
  //     packages/foo/component.ts
  //     packages/bar/util.ts
  fs.mkdirSync(path.join(tmpRoot, 'packages', 'foo'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'packages', 'bar'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'packages', 'foo', 'component.ts'), 'export {};\n');
  fs.writeFileSync(path.join(tmpRoot, 'packages', 'bar', 'util.ts'), 'export {};\n');
  purposeDir = path.join(tmpRoot, 'packages', 'foo');
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('resolveAnchorPath', () => {
  it('resolves an absolute path that exists', () => {
    const abs = path.join(tmpRoot, 'packages', 'foo', 'component.ts');
    const result = resolveAnchorPath(abs, purposeDir, tmpRoot);
    expect(result.baseUsed).toBe('absolute');
    expect(result.exists).toBe(true);
    expect(result.resolvedPath).toBe(abs);
  });

  it('resolves a project-root-relative path (preferred base)', () => {
    const result = resolveAnchorPath('packages/foo/component.ts', purposeDir, tmpRoot);
    expect(result.baseUsed).toBe('project-root');
    expect(result.exists).toBe(true);
    expect(result.resolvedPath).toBe(path.join(tmpRoot, 'packages', 'foo', 'component.ts'));
  });

  it('falls back to .purpose-dir-relative for crossing-dir anchors (e.g., ../bar/util.ts)', () => {
    // Anchor written by v6.0.0–v6.0.4 add_aspect when input was project-root
    // but writer rewrote to purpose-dir-relative.
    const result = resolveAnchorPath('../bar/util.ts', purposeDir, tmpRoot);
    expect(result.baseUsed).toBe('purpose-dir');
    expect(result.exists).toBe(true);
    expect(result.resolvedPath).toBe(path.join(tmpRoot, 'packages', 'bar', 'util.ts'));
  });

  it('returns exists:false when the file is missing under both bases', () => {
    const result = resolveAnchorPath('packages/foo/missing.ts', purposeDir, tmpRoot);
    expect(result.exists).toBe(false);
    // Stable canonical "expected" location for diagnostics.
    expect(result.baseUsed).toBe('project-root');
    expect(result.resolvedPath).toBe(path.join(tmpRoot, 'packages', 'foo', 'missing.ts'));
  });

  it('first-match wins: project-root is tried before purpose-dir', () => {
    // Construct a relative path that resolves under BOTH bases to DIFFERENT
    // real files. From purposeDir = <root>/packages/foo, the string
    // "component.ts" resolves to <root>/packages/foo/component.ts under
    // purpose-dir. Under project-root it resolves to <root>/component.ts —
    // we create that file too. Project-root wins per spec.
    const rootLevel = path.join(tmpRoot, 'component.ts');
    fs.writeFileSync(rootLevel, '// root-level\n');
    const result = resolveAnchorPath('component.ts', purposeDir, tmpRoot);
    expect(result.baseUsed).toBe('project-root');
    expect(result.exists).toBe(true);
    expect(result.resolvedPath).toBe(rootLevel);
  });
});

describe('detectAnchorBaseMismatch', () => {
  it('detects mismatch when only purpose-dir resolves (the writer-rewrite case)', () => {
    const m = detectAnchorBaseMismatch('../bar/util.ts', purposeDir, tmpRoot);
    expect(m.rootResolves).toBe(false);
    expect(m.purposeResolves).toBe(true);
    expect(m.mismatch).toBe(true);
  });

  it('detects mismatch when only project-root resolves', () => {
    const m = detectAnchorBaseMismatch('packages/foo/component.ts', purposeDir, tmpRoot);
    // From purposeDir = <root>/packages/foo, the relative path
    // "packages/foo/component.ts" would point at
    // <root>/packages/foo/packages/foo/component.ts — which does not exist.
    expect(m.rootResolves).toBe(true);
    expect(m.purposeResolves).toBe(false);
    expect(m.mismatch).toBe(true);
  });

  it('reports no mismatch when both bases resolve (ambiguous but consistent)', () => {
    // When the same string resolves under both bases (typical for
    // single-segment local files), no drift signal is raised — the file
    // exists, so the reader is happy.
    fs.writeFileSync(path.join(tmpRoot, 'component.ts'), '// root-level\n');
    const m = detectAnchorBaseMismatch('component.ts', purposeDir, tmpRoot);
    expect(m.rootResolves).toBe(true);
    expect(m.purposeResolves).toBe(true);
    expect(m.mismatch).toBe(false);
  });

  it('reports no mismatch when neither base resolves (genuinely missing)', () => {
    const m = detectAnchorBaseMismatch('does/not/exist.ts', purposeDir, tmpRoot);
    expect(m.rootResolves).toBe(false);
    expect(m.purposeResolves).toBe(false);
    expect(m.mismatch).toBe(false);
  });

  it('treats absolute paths as never-mismatched (base selection N/A)', () => {
    const abs = path.join(tmpRoot, 'packages', 'foo', 'component.ts');
    const m = detectAnchorBaseMismatch(abs, purposeDir, tmpRoot);
    expect(m.mismatch).toBe(false);
    expect(m.rootResolves).toBe(true);
    expect(m.purposeResolves).toBe(true);
  });
});
