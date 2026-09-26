import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSymbolMap } from './navigator.js';

describe('buildSymbolMap', () => {
  const root = path.join(path.sep, 'repo');

  it('maps aggregator filePath to the project-relative directory', () => {
    const map = buildSymbolMap([
      { id: 'purpose-component-doctor', type: 'component', filePath: path.join(root, 'packages', 'paradigm', 'src', 'commands', 'doctor', '.purpose') },
      { id: 'gate-local-only', type: 'gate', filePath: path.join(root, 'portal.yaml') },
    ], [], root);
    expect(map['#purpose-component-doctor']).toBe('packages/paradigm/src/commands/doctor/');
    expect(map['^gate-local-only']).toBe('./');
  });

  it('prefers explicit path / directory over filePath', () => {
    const map = buildSymbolMap([
      { id: 'a', type: 'component', path: 'src/a.ts', filePath: path.join(root, 'x', '.purpose') },
      { id: 'b', type: 'component', directory: 'src/b/', filePath: path.join(root, 'x', '.purpose') },
    ], [], root);
    expect(map['#a']).toBe('src/a.ts');
    expect(map['#b']).toBe('src/b/');
  });

  it('maps a directory filePath (portal gates) to that directory, not its parent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-'));
    try {
      const map = buildSymbolMap([{ id: 'gate-x', type: 'gate', filePath: tmp }], [], tmp);
      expect(map['^gate-x']).toBe('./');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
