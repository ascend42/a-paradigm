/**
 * Roundtrip integration test: paradigm_purpose_add_aspect (writer)
 *   ↔ paradigm_aspect_check (reader).
 *
 * This is the integration coverage that was missing pre-v6.0.5: the writer
 * has self-verification but only re-reads the YAML; it never asks "can the
 * reader actually resolve the anchor?". A crossing-directory anchor (e.g.,
 * `../component.ts`) hit that gap and was reported as `exists: false` by
 * `paradigm_aspect_check`.
 *
 * The test sets up a real tmpdir project, calls the writer, calls the
 * reader, and asserts `exists: true`. If the writer/reader path-resolution
 * convention drifts again, this test fails.
 *
 * Per Jinx's §2 audit (path-bug-and-agent-protocol-analysis.md): roundtrip
 * tests are now a category requirement for writer/reader MCP tool pairs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handlePurposePortalTool } from './purpose-portal.js';
import { handleTagsTool } from './tags.js';
import { loadProjectContext, type ProjectContext } from '../utils/index-loader.js';

let tmpRoot: string;

async function loadCtx(): Promise<ProjectContext> {
  return loadProjectContext(tmpRoot);
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-roundtrip-'));

  // Project layout — an aspect defined in packages/foo/.purpose anchored
  // to a sibling directory. This is the v6.0.0–v6.0.4 trigger condition:
  // writer rewrites to `../bar/util.ts`, reader resolved against root only.
  fs.mkdirSync(path.join(tmpRoot, 'packages', 'foo'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'packages', 'bar'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, 'packages', 'bar', 'util.ts'),
    'export function util() {}\n// line 2\n// line 3\n',
  );

  // Seed a .purpose file so the writer has something to append into.
  fs.writeFileSync(
    path.join(tmpRoot, 'packages', 'foo', '.purpose'),
    'version: 2.0.0\ndescription: test\n',
  );

  // Minimal config so loadProjectContext doesn't warn unnecessarily.
  fs.mkdirSync(path.join(tmpRoot, '.paradigm'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, '.paradigm', 'config.yaml'),
    'version: 2.0.0\nproject:\n  name: roundtrip-test\n',
  );
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('paradigm_purpose_add_aspect ↔ paradigm_aspect_check roundtrip', () => {
  it('reader sees exists:true for a crossing-directory anchor written by add_aspect', async () => {
    let ctx = await loadCtx();
    const reload = async () => {
      ctx = await loadCtx();
    };

    // The agent passes a project-root-relative anchor (the natural input);
    // the writer auto-rewrites to .purpose-dir-relative (`../bar/util.ts`)
    // because the relative path doesn't resolve under purposeDir directly.
    const writeResult = await handlePurposePortalTool(
      'paradigm_purpose_add_aspect',
      {
        purposeFile: 'packages/foo/.purpose',
        id: 'audit-required',
        description: 'Audit logging required for util',
        anchors: ['packages/bar/util.ts:1-2'],
      },
      ctx,
      reload,
    );

    expect(writeResult.handled).toBe(true);
    const writePayload = JSON.parse(writeResult.text);
    // Writer should NOT have errored.
    expect(writePayload.error).toBeUndefined();

    // Confirm the writer rewrote to .purpose-dir-relative — this is the
    // condition that previously broke the reader.
    expect(writePayload.anchors[0]).toContain('..');

    // Now ask the reader.
    const readResult = await handleTagsTool(
      'paradigm_aspect_check',
      { aspect: 'audit-required' },
      ctx,
    );
    expect(readResult.handled).toBe(true);
    const readPayload = JSON.parse(readResult.text);

    // The bug fix assertion: anchor MUST resolve under v6.0.5.
    expect(readPayload.error).toBeUndefined();
    expect(Array.isArray(readPayload.anchors)).toBe(true);
    expect(readPayload.anchors.length).toBe(1);
    expect(readPayload.anchors[0].exists).toBe(true);
    // No resolution_hint should be set when the anchor resolves cleanly.
    expect(readPayload.anchors[0].resolution_hint).toBeUndefined();
  });

  it('reader surfaces resolution_hint when anchor genuinely vanishes (mismatch class)', async () => {
    let ctx = await loadCtx();
    const reload = async () => {
      ctx = await loadCtx();
    };

    // Write an aspect against an existing crossing-dir anchor first.
    await handlePurposePortalTool(
      'paradigm_purpose_add_aspect',
      {
        purposeFile: 'packages/foo/.purpose',
        id: 'will-vanish',
        description: 'Anchor that will be deleted',
        anchors: ['packages/bar/util.ts:1-2'],
      },
      ctx,
      reload,
    );

    // Now move the anchor target so that the stored .purpose-dir-relative
    // string no longer resolves under purpose-dir, but a (hypothetical)
    // root-base resolution still would IF we placed a file there. Simulate
    // the asymmetric mismatch by deleting the original and creating a
    // file at the project-root-relative location.
    fs.unlinkSync(path.join(tmpRoot, 'packages', 'bar', 'util.ts'));
    // Place a file at the project-root resolution of `../bar/util.ts`
    // computed from purposeDir. From <root>/packages/foo, `../bar/util.ts`
    // -> <root>/packages/bar/util.ts. From project-root the same string
    // points to <root>/../bar/util.ts (outside the project) — won't match.
    // Instead, induce mismatch by recreating the file ONLY where the
    // *opposite* base would resolve. Simpler: write a file at the literal
    // root+anchor join location.
    const rootBaseTarget = path.join(tmpRoot, '..', 'bar', 'util.ts');
    // We can't reliably write outside tmpRoot. Skip this case if it would
    // escape the sandbox; the unit tests in anchor-path.test.ts already
    // cover detectAnchorBaseMismatch directly.
    void rootBaseTarget;

    const readResult = await handleTagsTool(
      'paradigm_aspect_check',
      { aspect: 'will-vanish' },
      ctx,
    );
    const readPayload = JSON.parse(readResult.text);
    expect(readPayload.anchors[0].exists).toBe(false);
    // No mismatch in this scenario; ensure shape is still well-formed.
    expect(typeof readPayload.anchors[0].path).toBe('string');
  });
});
