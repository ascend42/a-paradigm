/**
 * TD-2026-10-27-833 (Aegis M1): the staged-mode fs guard confines writes to <root>/.paradigm/**, .purpose files,
 * portal.yaml and HOME (never .git, never through a symlink), and reads to the root, HOME and the server's own dir.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { installStagedGuard, uninstallStagedGuard } from './staged-guard.js';

const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'staged-guard-')));
const root = path.join(base, 'repo');
const home = path.join(base, 'home');
const self = path.join(base, 'self');
const outside = path.join(base, 'outside');

beforeAll(() => {
  for (const d of [path.join(root, '.paradigm'), path.join(root, '.git'), path.join(root, 'src'), home, self, outside]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret'), 's');
  fs.writeFileSync(path.join(self, 'sql-wasm.wasm'), 'w');
  fs.symlinkSync(outside, path.join(root, '.paradigm', 'out'));
  fs.symlinkSync(path.join(outside, 'secret'), path.join(root, '.paradigm', 'link.yaml'));
  installStagedGuard({ root, home, selfDir: self });
});
afterAll(() => {
  uninstallStagedGuard();
  fs.rmSync(base, { recursive: true, force: true });
});

describe('staged guard: writes', () => {
  it('allows .paradigm/**, .purpose files, the root portal.yaml and HOME', async () => {
    fs.writeFileSync(path.join(root, '.paradigm', 'a.yaml'), 'x');
    fs.mkdirSync(path.join(root, '.paradigm', 'lore'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', '.purpose'), 'x');
    fs.writeFileSync(path.join(root, 'portal.yaml'), 'x');
    fs.writeFileSync(path.join(home, 'g.json'), 'x');
    await fs.promises.writeFile(path.join(root, '.paradigm', 'b.yaml'), 'x');
    expect(fs.readFileSync(path.join(root, '.paradigm', 'a.yaml'), 'utf8')).toBe('x');
  });

  it('refuses source files, .git, a nested portal.yaml, outside paths and symlinks', async () => {
    for (const p of [path.join(root, 'src', 'a.ts'), path.join(root, '.git', 'config'), path.join(root, 'src', 'portal.yaml'), path.join(outside, 'x'), path.join(root, '.paradigm', 'out', 'x'), path.join(root, '.paradigm', 'link.yaml'), path.join(root, '.paradigm', '..', 'src', 'x.ts')]) {
      expect(() => fs.writeFileSync(p, 'x'), p).toThrow(/staged Gnomon mode/);
    }
    expect(() => fs.renameSync(path.join(root, '.paradigm', 'a.yaml'), path.join(root, 'src', 'a.ts'))).toThrow(/staged/);
    expect(() => fs.rmSync(path.join(root, 'src'), { recursive: true })).toThrow(/staged/);
    expect(() => fs.openSync(path.join(root, 'src', 'a.ts'), 'w')).toThrow(/staged/);
    await expect(fs.promises.appendFile(path.join(outside, 'x'), 'x')).rejects.toThrow(/staged/);
    expect(fs.existsSync(path.join(outside, 'x'))).toBe(false);
  });
});

describe('staged guard: reads', () => {
  it('reads inside the root, HOME and its own dir; refuses outside and through a symlink out', () => {
    expect(fs.readdirSync(path.join(root, '.paradigm'))).toContain('a.yaml');
    expect(fs.readFileSync(path.join(self, 'sql-wasm.wasm'), 'utf8')).toBe('w');
    expect(() => fs.readFileSync(path.join(outside, 'secret'))).toThrow(/staged/);
    expect(() => fs.readFileSync(path.join(root, '.paradigm', 'link.yaml'))).toThrow(/staged/);
    expect(() => fs.readdirSync(outside)).toThrow(/staged/);
  });
});
