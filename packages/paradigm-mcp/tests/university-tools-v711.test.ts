/**
 * v7.11 University MCP surface: exactly 2 tools, removed names return a
 * moved-to-CLI error, search `id` returns full content, pack_list surfaces
 * pack skills (always external), registry detection is pack-based.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  getUniversityToolsList,
  handleUniversityTool,
  REMOVED_UNIVERSITY_TOOLS,
  MOVED_TO_CLI_ERROR,
} from '../src/tools/university.js';
import { detectUniversityPacks } from '../src/utils/tool-registry.js';

const tmpDirs: string[] = [];
function mktemp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-v711-'));
  tmpDirs.push(d);
  fs.mkdirSync(path.join(d, '.paradigm'), { recursive: true });
  return d;
}
afterEach(() => { for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function writePack(root: string, opts: { note?: boolean; skill?: boolean } = {}): string {
  const pack = path.join(root, '.paradigm', 'university');
  fs.mkdirSync(pack, { recursive: true });
  const manifest: Record<string, unknown> = { id: 'proj', name: 'Proj', version: '1.0.0', schema_version: '2', tenant_kind: 'project' };
  if (opts.skill) {
    manifest.skills = [{ path: 'skills/trace-debug' }];
    const dir = path.join(pack, 'skills', 'trace-debug');
    fs.mkdirSync(dir, { recursive: true });
    const fm = { name: 'trace-debug', description: 'd', metadata: { paradigm: {
      id: 'trace-debug', version: '1.0.0', steward: 'x', trust: 'certified', provenance: { source: 'authored', createdBy: 'x' } } } };
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${yaml.dump(fm)}---\n# T\n1. a\n2. b\n`);
  }
  fs.writeFileSync(path.join(pack, 'pack.yaml'), yaml.dump(manifest));
  if (opts.note) {
    const notes = path.join(pack, 'content', 'notes');
    fs.mkdirSync(notes, { recursive: true });
    fs.writeFileSync(path.join(notes, 'N-hello.md'), [
      '---', 'id: N-hello', 'title: Hello', 'type: note', 'author: a', 'created: 2026-01-01', 'updated: 2026-01-01',
      'tags: []', 'symbols: []', 'difficulty: beginner', 'prerequisites: []', '---', 'FULL BODY TEXT', '',
    ].join('\n'));
  }
  return pack;
}

const ctx = (rootDir: string) => ({ rootDir } as any);

describe('university MCP surface (v7.11)', () => {
  it('lists exactly 2 university tools', () => {
    expect(getUniversityToolsList().map(t => t.name).sort()).toEqual([
      'paradigm_university_pack_list', 'paradigm_university_search',
    ]);
    const search = getUniversityToolsList().find(t => t.name === 'paradigm_university_search')!;
    expect(Object.keys(search.inputSchema.properties)).toContain('id');
  });

  it.each(REMOVED_UNIVERSITY_TOOLS.map(n => [n]))('%s returns the moved-to-CLI error', async (name) => {
    const r = await handleUniversityTool(name, {}, ctx(mktemp()));
    expect(r.handled).toBe(true);
    expect(JSON.parse(r.text)).toEqual({ error: MOVED_TO_CLI_ERROR });
  });

  it('search with id returns the full entry body (absorbs get)', async () => {
    const root = mktemp();
    writePack(root, { note: true });
    const r = await handleUniversityTool('paradigm_university_search', { id: 'proj:N-hello' }, ctx(root));
    const body = JSON.parse(r.text);
    expect(body.title).toBe('Hello');
    expect(body.body).toContain('FULL BODY TEXT');
    const missing = JSON.parse((await handleUniversityTool('paradigm_university_search', { id: 'N-nope' }, ctx(root))).text);
    expect(missing.error).toContain('not found');
  });

  it('pack_list surfaces pack skills with trust external', async () => {
    const root = mktemp();
    writePack(root, { skill: true });
    const r = await handleUniversityTool('paradigm_university_pack_list', {}, ctx(root));
    const packs = JSON.parse(r.text).packs;
    expect(packs[0].skills).toEqual([{ id: 'trace-debug', version: '1.0.0', trust: 'external' }]);
    expect(packs[0].path).toBe('.paradigm/university');
    expect(r.text).not.toContain(root);
  });
});

describe('registry detection (pack-based, fail-closed)', () => {
  it('false for an empty scaffold', () => {
    const root = mktemp();
    writePack(root);
    expect(detectUniversityPacks(root)).toBe(false);
  });
  it('false without .paradigm', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-v711-bare-'));
    tmpDirs.push(d);
    expect(detectUniversityPacks(d)).toBe(false);
  });
  it('true when a pack has content or ships skills', () => {
    const a = mktemp(); writePack(a, { note: true });
    const b = mktemp(); writePack(b, { skill: true });
    expect(detectUniversityPacks(a)).toBe(true);
    expect(detectUniversityPacks(b)).toBe(true);
  });
});
