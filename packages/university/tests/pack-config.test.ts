/**
 * pack-config.test.ts — Phase 1 of the University pack-selector fix.
 *
 * Covers the serve server's pack resolution (spec
 * .paradigm/specs/fix-university-pack-selector-full.md §SURFACE 1):
 *   - A1:  buildPackConfig honors `packRoot` (mounts the selected pack's
 *          manifest/sections/branding/version).
 *   - A1b: createApp resolves the pack's content base under BOTH
 *          `content/` and `src/content/` (dual-base probe).
 *
 * HEADLINE (spec §5 test #5): buildPackConfig({ packRoot: <ai-literacy> })
 * returns that pack's 5 sections in `mode:'project'` — this stands in for
 * `serve --pack ai-literacy` WITHOUT launching a server.
 *
 * BACK-COMPAT (spec §5 test #6): buildPackConfig with no packRoot is
 * byte-identical to today (project-dir probe + paradigm fallback).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildPackConfig, createApp } from '../src/server/index.js';

// Repo root — five levels up from this test file
// (packages/university/tests → repo root).
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const AI_LITERACY_ROOT = path.join(REPO_ROOT, '.paradigm', 'university', 'ai-literacy');

describe('buildPackConfig — A1 pack selector', () => {
  it('HEADLINE: packRoot=ai-literacy → mode:project, 5 sections, manifest branding', () => {
    // Fixture sanity — if this pack moves, the headline test is meaningless.
    expect(fs.existsSync(path.join(AI_LITERACY_ROOT, 'pack.yaml'))).toBe(true);

    const cfg = buildPackConfig({ packRoot: AI_LITERACY_ROOT, packId: 'ai-literacy' });

    expect(cfg.mode).toBe('project');
    expect(cfg.sections).toHaveLength(5);
    // Section ids/order come straight from the ai-literacy manifest.
    expect(cfg.sections.map((s) => s.id)).toEqual([
      'foundations',
      'tools-and-agents',
      'claude-code',
      'paradigm',
      'glossary',
    ]);
    // Default section is foundations (default:true in the manifest).
    expect(cfg.sections.find((s) => s.default === true)?.id).toBe('foundations');
    // Version sourced from the pack manifest, not the paradigm fallback.
    expect(cfg.version).toBe('0.1.0');
  });

  it('synthetic pack via packRoot returns that pack’s sections', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
    try {
      fs.writeFileSync(
        path.join(tmp, 'pack.yaml'),
        [
          'id: tmp-pack',
          'name: Temp Pack',
          'version: 9.9.9',
          'tenant_kind: project',
          'sections:',
          '  - id: alpha',
          '    name: Alpha',
          '    order: 0',
          '    style: track',
          '    default: true',
          '  - id: beta',
          '    name: Beta',
          '    order: 1',
          '    style: track',
        ].join('\n'),
      );

      const cfg = buildPackConfig({ packRoot: tmp });
      expect(cfg.mode).toBe('project');
      expect(cfg.version).toBe('9.9.9');
      expect(cfg.sections.map((s) => s.id)).toEqual(['alpha', 'beta']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('first-party pack via packRoot keeps paradigm branding but surfaces its sections', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-fp-'));
    try {
      fs.writeFileSync(
        path.join(tmp, 'pack.yaml'),
        [
          'id: fp-pack',
          'name: First Party Pack',
          'version: 7.7.7',
          'tenant_kind: first-party',
          'sections:',
          '  - id: one',
          '    name: One',
          '    order: 0',
          '    style: track',
          '    default: true',
        ].join('\n'),
      );

      const cfg = buildPackConfig({ packRoot: tmp });
      // First-party → paradigm branding (defaults), full tab set.
      expect(cfg.mode).toBe('paradigm');
      expect(cfg.branding.name).toBe('Paradigm University');
      // ...but the manifest's own sections + version are surfaced.
      expect(cfg.sections.map((s) => s.id)).toEqual(['one']);
      expect(cfg.version).toBe('7.7.7');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('packRoot with missing pack.yaml falls back to paradigm defaults', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-empty-'));
    try {
      const cfg = buildPackConfig({ packRoot: tmp });
      expect(cfg.mode).toBe('paradigm');
      expect(cfg.branding.name).toBe('Paradigm University');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('buildPackConfig — back-compat (no packRoot)', () => {
  it('no packRoot, no projectDir → paradigm defaults (byte-identical to today)', () => {
    const cfg = buildPackConfig({});
    expect(cfg.mode).toBe('paradigm');
    expect(cfg.branding).toEqual({
      name: 'Paradigm University',
      tagline: 'Lux in Codice',
      logo: null,
      institution: null,
      favicon: null,
      tabs: ['campus', 'courses', 'plsat', 'library', 'certificates'],
      startCourse: null,
    });
    expect(cfg.theme).toBeNull();
    expect(cfg.hasProjectLibrary).toBe(false);
    // version is the paradigm fallback (sections may come from the bundled
    // first-party pack.yaml if present, else the implicit default).
    expect(typeof cfg.version).toBe('string');
    expect(cfg.sections.length).toBeGreaterThanOrEqual(1);
  });

  it('no packRoot, projectDir WITH manifest → project mode from project dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
    try {
      const uniDir = path.join(tmp, '.paradigm', 'university');
      fs.mkdirSync(uniDir, { recursive: true });
      fs.writeFileSync(
        path.join(uniDir, 'pack.yaml'),
        ['id: proj-pack', 'name: Proj Pack', 'version: 1.2.3', 'tenant_kind: project'].join('\n'),
      );

      const cfg = buildPackConfig({ projectDir: tmp });
      expect(cfg.mode).toBe('project');
      expect(cfg.version).toBe('1.2.3');
      // No explicit tabs + no reference.json → minimal default tab set.
      expect(cfg.branding.tabs).toEqual(['campus', 'courses', 'certificates']);
      expect(cfg.hasProjectLibrary).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('no packRoot, projectDir WITHOUT manifest → paradigm fallback', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-empty-'));
    try {
      const cfg = buildPackConfig({ projectDir: tmp });
      expect(cfg.mode).toBe('paradigm');
      expect(cfg.branding.name).toBe('Paradigm University');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('createApp — A1b dual-base content probe (/api/courses)', () => {
  // Tiny in-process request helper — exercises the Express router without
  // binding a port.
  function getJson(app: ReturnType<typeof createApp>, url: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        import('http')
          .then((http) => {
            http.get({ host: '127.0.0.1', port, path: url }, (res) => {
              let data = '';
              res.on('data', (c) => (data += c));
              res.on('end', () => {
                server.close();
                try {
                  resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null });
                } catch (e) {
                  reject(e);
                }
              });
            }).on('error', (e) => {
              server.close();
              reject(e);
            });
          })
          .catch(reject);
      });
    });
  }

  it('packRoot=ai-literacy → /api/courses serves the pack’s courses (content/ layout)', async () => {
    const app = createApp({ packRoot: AI_LITERACY_ROOT, packId: 'ai-literacy' });
    const { status, body } = await getJson(app, '/api/courses');
    expect(status).toBe(200);
    expect(Array.isArray(body.courses)).toBe(true);
    // ai-literacy ships learning paths under content/paths → must be found.
    expect(body.courses.length).toBeGreaterThan(0);
    // The 'claude-code' learning path (LP-claude-code.yaml) ships in the
    // ai-literacy fixture's content/paths → must be discovered.
    const cc = body.courses.find((c: { id: string }) => c.id === 'claude-code');
    expect(cc).toBeDefined();
    // Section assignment lands on one of the pack's real sections (NOT the
    // implicit 'main' default), proving the router sees the pack's sections.
    const validSections = ['foundations', 'tools-and-agents', 'claude-code', 'paradigm', 'glossary'];
    expect(validSections).toContain(cc.section);
    expect(body.courses.every((c: { section: string }) => validSections.includes(c.section))).toBe(true);
  });

  it('section-less pack via --pack assigns courses to the pack default section (override)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-sectionless-'));
    try {
      // Manifest declares 2 sections; the LP omits `section:` → must fall to
      // the default section. Without the sectionsOverride the router would
      // read packRoot/content/pack.yaml (absent) → implicit 'main'.
      fs.writeFileSync(
        path.join(tmp, 'pack.yaml'),
        [
          'id: sl-pack',
          'name: SL Pack',
          'tenant_kind: project',
          'sections:',
          '  - id: home',
          '    name: Home',
          '    order: 0',
          '    style: track',
          '    default: true',
          '  - id: extra',
          '    name: Extra',
          '    order: 1',
          '    style: track',
        ].join('\n'),
      );
      const pathsDir = path.join(tmp, 'content', 'paths');
      fs.mkdirSync(pathsDir, { recursive: true });
      fs.mkdirSync(path.join(tmp, 'content', 'notes'), { recursive: true });
      fs.writeFileSync(
        path.join(pathsDir, 'LP-solo.yaml'),
        ['id: solo', 'title: Solo', 'description: d', 'steps: []'].join('\n'),
      );

      const app = createApp({ packRoot: tmp });
      const { body } = await getJson(app, '/api/courses');
      const solo = body.courses.find((c: { id: string }) => c.id === 'solo');
      expect(solo).toBeDefined();
      // Default section = 'home' (default:true) — NOT the implicit 'main'.
      expect(solo.section).toBe('home');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('packRoot with src/content layout resolves the populated base', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-srccontent-'));
    try {
      // Empty content/ beside a populated src/content/ — the probe must pick
      // src/content (spec §C4: first base that CONTAINS content).
      fs.mkdirSync(path.join(tmp, 'content'), { recursive: true });
      const base = path.join(tmp, 'src', 'content');
      fs.mkdirSync(path.join(base, 'paths'), { recursive: true });
      fs.mkdirSync(path.join(base, 'notes'), { recursive: true });
      fs.writeFileSync(
        path.join(base, 'paths', 'LP-demo.yaml'),
        ['id: demo', 'title: Demo', 'description: d', 'steps: []'].join('\n'),
      );

      const app = createApp({ packRoot: tmp });
      const { status, body } = await getJson(app, '/api/courses');
      expect(status).toBe(200);
      expect(body.courses.some((c: { id: string }) => c.id === 'demo')).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
