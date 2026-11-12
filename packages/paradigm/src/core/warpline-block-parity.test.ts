/**
 * Cross-package parity (T-2026-11-12-001): Paradigm's copy of the Warpline
 * block must be byte-identical to what `warpline init` writes, so a later
 * `paradigm sync` and `warpline init` never fight over the block. Paradigm
 * never imports Warpline at runtime; this test reads its source by relative path.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectWarpline, singleWarplineBlock } from './warpline-detect.js';
import { WARPLINE_BLOCK_TEXT, WARPLINE_BLOCK_BEGIN, WARPLINE_BLOCK_END } from './ide-adapters/types.js';
import {
  WARPLINE_BLOCK_BEGIN as MCP_BLOCK_BEGIN,
  WARPLINE_BLOCK_END as MCP_BLOCK_END,
  getWarplineStatus,
  hasSingleWarplineBlock,
} from '../../../paradigm-mcp/src/utils/warpline-status.js';

type RenderAgentGuide = (mode: 'native' | 'git') => string;

// Resolved at run time (not a static import) so tsc never compiles Warpline's
// sources under this package's config.
const AGENT_GUIDE = new URL('../../../warpline/src/fabric/agent-guide.ts', import.meta.url).href;

interface WarplineAgentGuide {
  renderAgentGuide: RenderAgentGuide;
  agentGuideModeOf: (root: string) => 'native' | 'git';
  scanAgentGuide: (text: string) => { kind: 'none' | 'one' | 'malformed' };
}

async function loadWarpline(): Promise<WarplineAgentGuide> {
  return (await import(AGENT_GUIDE)) as WarplineAgentGuide;
}

async function loadRenderer(): Promise<RenderAgentGuide> {
  return (await loadWarpline()).renderAgentGuide;
}

describe('Warpline block parity with renderAgentGuide', () => {
  for (const mode of ['native', 'git'] as const) {
    it(`${mode} mode text is byte-identical`, async () => {
      const renderAgentGuide = await loadRenderer();
      expect(WARPLINE_BLOCK_TEXT[mode]).toBe(renderAgentGuide(mode));
    });
  }

  it('both modes are wrapped in the shared markers', () => {
    for (const mode of ['native', 'git'] as const) {
      expect(WARPLINE_BLOCK_TEXT[mode].startsWith(WARPLINE_BLOCK_BEGIN)).toBe(true);
      expect(WARPLINE_BLOCK_TEXT[mode].endsWith(WARPLINE_BLOCK_END)).toBe(true);
      expect(WARPLINE_BLOCK_TEXT[mode]).toContain('`warpline orient`');
    }
  });

  it('paradigm_status (paradigm-mcp) looks for the same markers', () => {
    expect(MCP_BLOCK_BEGIN).toBe(WARPLINE_BLOCK_BEGIN);
    expect(MCP_BLOCK_END).toBe(WARPLINE_BLOCK_END);
  });
});

describe('paradigm-mcp getWarplineStatus agrees with detectWarpline', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  function fixture(setup: (root: string) => void): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-parity-'));
    dirs.push(root);
    fs.mkdirSync(path.join(root, '.paradigm'));
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'version: "2.0"\nproject: p\n', 'utf8');
    setup(root);
    return root;
  }
  const cfg = (root: string, text: string) => fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), text, 'utf8');
  const cases: Array<[string, (root: string) => void]> = [
    ['none', () => {}],
    ['.warpline', (r) => fs.mkdirSync(path.join(r, '.warpline'))],
    ['.warpline + .git', (r) => { fs.mkdirSync(path.join(r, '.warpline')); fs.mkdirSync(path.join(r, '.git')); }],
    ['.warpignore only', (r) => fs.writeFileSync(path.join(r, '.warpignore'), '')],
    ['guidance off', (r) => { fs.mkdirSync(path.join(r, '.warpline')); cfg(r, 'version: "2.0"\nproject: p\nintegrations:\n  warpline:\n    guidance: off\n'); }],
    ['a .warpline file, not a dir', (r) => fs.writeFileSync(path.join(r, '.warpline'), '')],
    ['unreadable config', (r) => { fs.mkdirSync(path.join(r, '.warpline')); cfg(r, 'integrations: [unclosed\n  : :\n'); }],
    ['.warpline project nested inside a git repo', (r) => {
      fs.mkdirSync(path.join(r, '.git'));
      const sub = path.join(r, 'apps', 'web');
      fs.mkdirSync(path.join(sub, '.paradigm'), { recursive: true });
      fs.writeFileSync(path.join(sub, '.paradigm', 'config.yaml'), 'version: "2.0"\nproject: web\n', 'utf8');
      fs.mkdirSync(path.join(sub, '.warpline'));
    }],
    ['config is a directory', (r) => { fs.mkdirSync(path.join(r, '.warpline')); fs.rmSync(path.join(r, '.paradigm', 'config.yaml')); fs.mkdirSync(path.join(r, '.paradigm', 'config.yaml')); }],
  ];
  // The nested case is checked at apps/web; every other case at the fixture root.
  const projectOf = (name: string, root: string) => (name.startsWith('.warpline project nested') ? path.join(root, 'apps', 'web') : root);
  for (const [name, setup] of cases) {
    it(name, async () => {
      const root = projectOf(name, fixture(setup));
      const cli = detectWarpline(root);
      const mcp = getWarplineStatus(root);
      expect(mcp ? { mode: mcp.mode } : null).toEqual(cli);
      // When detected, the mode matches what `warpline init` would render.
      if (cli) expect(cli.mode).toBe((await loadWarpline()).agentGuideModeOf(root));
      if (name.startsWith('.warpline project nested')) expect(cli).toEqual({ mode: 'git' });
    });
  }

  it('the block scanners agree (Paradigm CLI, paradigm-mcp, and Warpline\'s own scanAgentGuide)', async () => {
    const { scanAgentGuide } = await loadWarpline();
    const B = WARPLINE_BLOCK_BEGIN;
    const E = WARPLINE_BLOCK_END;
    for (const text of [
      '', `${B}\nx\n${E}\n`, `inline \`${B}\`\n`, `\`\`\`\n${B}\n${E}\n\`\`\`\n`,
      `${B}\na\n${E}\n${B}\nb\n${E}\n`, `${B}\nno end\n`, `${E}\n`, `x\r\n  ${B}\r\ny\r\n${E}\r\n`,
      // a ~~~ example nested in a ``` fence stays an example; the real block after it counts
      `\`\`\`md\n~~~\n${B}\nexample\n${E}\n~~~\n\`\`\`\n${B}\nreal\n${E}\n`,
      // an unclosed fence swallows everything after it
      `\`\`\`\nunclosed\n${B}\nx\n${E}\n`,
      // a \`\`\` line followed by text opens a fence (info string), it does not close one
      `\`\`\`js\nconst a = 1;\n\`\`\`\n${B}\nx\n${E}\n`,
      // a closing-looking \`\`\` line with text after it does not close the fence
      `\`\`\`\ncode\n\`\`\` not a close\n${B}\nx\n${E}\n`,
    ]) {
      const single = singleWarplineBlock(text) !== null;
      expect(hasSingleWarplineBlock(text), JSON.stringify(text)).toBe(single);
      expect(scanAgentGuide(text).kind === 'one', JSON.stringify(text)).toBe(single);
    }
  });
});
