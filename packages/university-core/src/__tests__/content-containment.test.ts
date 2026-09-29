/**
 * v7.11 fix pass — resolveContentFile containment (#university-loader).
 * A pack content file that is a symlink, or whose realpath escapes the pack
 * root, is never read (same rules as resolveSkillDirs).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadNote, setUniversityCoreLogger } from '../index.js';

const dirs: string[] = [];
afterEach(() => {
  setUniversityCoreLogger({ warn() {} });
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const NOTE = (id: string, body: string) => `---\nid: ${id}\ntitle: T\ntype: note\n---\n${body}\n`;

function pack(): { tmp: string; packRoot: string; notes: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ucore-contain-'));
  dirs.push(tmp);
  const packRoot = path.join(tmp, 'pack');
  const notes = path.join(packRoot, 'content', 'notes');
  fs.mkdirSync(notes, { recursive: true });
  fs.writeFileSync(path.join(notes, 'real-note.md'), NOTE('real-note', 'inside'));
  return { tmp, packRoot, notes };
}

describe('resolveContentFile containment', () => {
  it('loads a regular note inside the pack', () => {
    const { tmp, packRoot } = pack();
    expect(loadNote(tmp, 'real-note', packRoot)?.body).toContain('inside');
  });

  it('rejects a symlinked note file (even when the target is inside the pack)', () => {
    const { tmp, packRoot, notes } = pack();
    fs.symlinkSync(path.join(notes, 'real-note.md'), path.join(notes, 'linked-note.md'));
    expect(loadNote(tmp, 'linked-note', packRoot)).toBeNull();
  });

  it('rejects a note whose realpath escapes the pack root (symlinked subdir)', () => {
    const { tmp, packRoot } = pack();
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret-note.md'), NOTE('secret-note', 'SECRET'));
    fs.symlinkSync(outside, path.join(packRoot, 'content', 'policies'));
    expect(loadNote(tmp, 'secret-note', packRoot)).toBeNull();
  });
});
