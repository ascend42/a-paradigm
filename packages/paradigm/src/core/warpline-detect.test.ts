import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { detectWarpline, scanWarplineBlocks, singleWarplineBlock } from './warpline-detect.js';
import { createTempProject } from '../test-utils.js';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });

function project(): string {
  const { rootDir, cleanup: c } = createTempProject();
  cleanup = c;
  return rootDir;
}

describe('detectWarpline (T-2026-11-12-001)', () => {
  it('returns null without .warpline/ or .warpignore', () => {
    expect(detectWarpline(project())).toBeNull();
  });

  it('a .warpline/ directory without .git is native mode', () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.warpline'));
    expect(detectWarpline(root)).toEqual({ mode: 'native' });
  });

  it('.warpline/ plus .git is git mode (a worktree .git file counts too)', () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.warpline'));
    fs.mkdirSync(path.join(root, '.git'));
    expect(detectWarpline(root)).toEqual({ mode: 'git' });
    fs.rmSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere\n', 'utf8');
    expect(detectWarpline(root)).toEqual({ mode: 'git' });
  });

  it('a .git in an ancestor folder makes a nested project git mode', () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.git'));
    const sub = path.join(root, 'apps', 'web');
    fs.mkdirSync(path.join(sub, '.warpline'), { recursive: true });
    expect(detectWarpline(sub)).toEqual({ mode: 'git' });
  });

  it('a .warpignore file alone is enough', () => {
    const root = project();
    fs.writeFileSync(path.join(root, '.warpignore'), 'dist/\n', 'utf8');
    expect(detectWarpline(root)).toEqual({ mode: 'native' });
  });

  it('a .warpline file (not a directory) does not count', () => {
    const root = project();
    fs.writeFileSync(path.join(root, '.warpline'), '', 'utf8');
    expect(detectWarpline(root)).toBeNull();
  });

  it('integrations.warpline.guidance: off returns null; auto keeps detection', () => {
    const root = project();
    fs.mkdirSync(path.join(root, '.warpline'));
    const cfg = path.join(root, '.paradigm', 'config.yaml');
    const base = fs.readFileSync(cfg, 'utf8');
    fs.writeFileSync(cfg, `${base}\nintegrations:\n  warpline:\n    guidance: auto\n`, 'utf8');
    expect(detectWarpline(root)).toEqual({ mode: 'native' });
    fs.writeFileSync(cfg, `${base}\nintegrations:\n  warpline:\n    guidance: off\n`, 'utf8');
    expect(detectWarpline(root)).toBeNull();
  });
});

describe('scanWarplineBlocks / singleWarplineBlock (whole-line markers)', () => {
  const B = '<!-- warpline:begin -->';
  const E = '<!-- warpline:end -->';
  it('finds a real block and ignores an inline mention before it', () => {
    const text = `Mentions \`${B}\` inline.\n${B}\nbody\n${E}\n`;
    const span = singleWarplineBlock(text);
    expect(span && text.slice(span.start, span.end)).toBe(`${B}\nbody\n${E}`);
  });
  it('ignores markers inside fenced code (``` and ~~~)', () => {
    for (const f of ['```', '~~~~']) {
      const text = `${f}md\n${B}\nx\n${E}\n${f}\n`;
      expect(scanWarplineBlocks(text)).toEqual({ blocks: [], malformed: false });
    }
  });
  it('two blocks are not a single block; unpaired markers are malformed', () => {
    const two = `${B}\na\n${E}\n${B}\nb\n${E}\n`;
    expect(scanWarplineBlocks(two).blocks).toHaveLength(2);
    expect(singleWarplineBlock(two)).toBeNull();
    expect(scanWarplineBlocks(`${B}\nno end\n`).malformed).toBe(true);
    expect(scanWarplineBlocks(`${E}\n`).malformed).toBe(true);
    expect(scanWarplineBlocks(`${B}\n${B}\n${E}\n`).malformed).toBe(true);
  });
  it('accepts CRLF and indented marker lines', () => {
    expect(singleWarplineBlock(`x\r\n  ${B}\r\nbody\r\n${E}  \r\n`)).not.toBeNull();
  });
});
