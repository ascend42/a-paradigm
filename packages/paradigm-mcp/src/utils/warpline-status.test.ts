import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getWarplineStatus, hasSingleWarplineBlock, WARPLINE_BLOCK_BEGIN, WARPLINE_BLOCK_END } from './warpline-status.js';

const dirs: string[] = [];
function project(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-warpline-'));
  dirs.push(d);
  fs.mkdirSync(path.join(d, '.paradigm'));
  fs.writeFileSync(path.join(d, '.paradigm', 'config.yaml'), 'version: "2.0"\nproject: p\n', 'utf8');
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('paradigm_status warpline field (T-2026-11-12-001)', () => {
  it('is null when the project has no Warpline', () => {
    expect(getWarplineStatus(project())).toBeNull();
  });

  it('reports native mode, the orient start point and synced=false before paradigm sync', () => {
    const d = project();
    fs.mkdirSync(path.join(d, '.warpline'));
    expect(getWarplineStatus(d)).toEqual({ mode: 'native', start: 'warpline orient', synced: false });
  });

  it('reports git mode and synced=true when CLAUDE.md carries the block', () => {
    const d = project();
    fs.mkdirSync(path.join(d, '.warpline'));
    fs.mkdirSync(path.join(d, '.git'));
    fs.writeFileSync(path.join(d, 'CLAUDE.md'), `# x\n${WARPLINE_BLOCK_BEGIN}\nbody\n<!-- warpline:end -->\n`, 'utf8');
    expect(getWarplineStatus(d)).toEqual({ mode: 'git', start: 'warpline orient', synced: true });
  });

  it('a .git in an ancestor folder makes a nested project git mode', () => {
    const d = project();
    fs.mkdirSync(path.join(d, '.git'));
    const sub = path.join(d, 'apps', 'web');
    fs.mkdirSync(path.join(sub, '.warpline'), { recursive: true });
    expect(getWarplineStatus(sub)?.mode).toBe('git');
  });

  it('detects a .warpignore-only project and honours the guidance opt-out', () => {
    const d = project();
    fs.writeFileSync(path.join(d, '.warpignore'), '', 'utf8');
    expect(getWarplineStatus(d)?.mode).toBe('native');
    fs.appendFileSync(path.join(d, '.paradigm', 'config.yaml'), 'integrations:\n  warpline:\n    guidance: off\n', 'utf8');
    expect(getWarplineStatus(d)).toBeNull();
  });

  it('synced needs exactly one whole-line block outside fenced code', () => {
    const d = project();
    fs.mkdirSync(path.join(d, '.warpline'));
    const B = WARPLINE_BLOCK_BEGIN;
    const E = WARPLINE_BLOCK_END;
    const write = (t: string) => fs.writeFileSync(path.join(d, 'CLAUDE.md'), t, 'utf8');
    write(`See \`${B}\` inline only.\n`);
    expect(getWarplineStatus(d)?.synced).toBe(false);
    write(`\`\`\`\n${B}\nx\n${E}\n\`\`\`\n`);
    expect(getWarplineStatus(d)?.synced).toBe(false);
    write(`${B}\na\n${E}\n${B}\nb\n${E}\n`);
    expect(getWarplineStatus(d)?.synced).toBe(false);
    write(`inline \`${B}\`\n${B}\na\n${E}\n`);
    expect(getWarplineStatus(d)?.synced).toBe(true);
    expect(hasSingleWarplineBlock(`${B}\nno end\n`)).toBe(false);
  });

  it('a CLAUDE.md that is a directory is not synced and does not throw', () => {
    const d = project();
    fs.mkdirSync(path.join(d, '.warpline'));
    fs.mkdirSync(path.join(d, 'CLAUDE.md'));
    expect(getWarplineStatus(d)).toEqual({ mode: 'native', start: 'warpline orient', synced: false });
  });

  // The marker's parity with the CLI constant is pinned in packages/paradigm
  // (src/core/warpline-block-parity.test.ts), which may import this package.
});
