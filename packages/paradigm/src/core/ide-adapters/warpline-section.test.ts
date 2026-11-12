/**
 * Warpline block in generated instruction files (T-2026-11-12-001).
 */
import { describe, it, expect } from 'vitest';
import { generateWarplineSection, preserveWarplineBlock } from './base.js';
import { ClaudeAdapter } from './claude.js';
import { agentsAdapter } from './agents.js';
import { windsurfAdapter } from './windsurf.js';
import { copilotAdapter } from './copilot.js';
import { CursorAdapter, cursorAdapter } from './cursor.js';
import { WARPLINE_BLOCK_BEGIN, WARPLINE_BLOCK_END, WARPLINE_BLOCK_TEXT, type ParadigmFiles } from './types.js';
import { createMockParadigmFiles } from '../../test-utils.js';

const claude = new ClaudeAdapter();
const plain = (): ParadigmFiles => createMockParadigmFiles({ projectName: 'wl-proj' }) as ParadigmFiles;
const withWarpline = (mode: 'native' | 'git', meta?: ParadigmFiles['meta']): ParadigmFiles =>
  ({ ...plain(), warpline: { mode }, ...(meta ? { meta } : {}) });

describe('generateWarplineSection', () => {
  it('is empty without Warpline', () => {
    expect(generateWarplineSection(plain())).toBe('');
  });
  it('renders the mode text followed by a blank line', () => {
    expect(generateWarplineSection(withWarpline('native'))).toBe(`${WARPLINE_BLOCK_TEXT.native}\n`);
    expect(generateWarplineSection(withWarpline('git'))).toBe(`${WARPLINE_BLOCK_TEXT.git}\n`);
  });
});

describe('preserveWarplineBlock', () => {
  const gen = `# head\n\n${WARPLINE_BLOCK_TEXT.native}\n\n## tail\n`;

  it('keeps an existing block byte for byte and the generated text around it', () => {
    const custom = `${WARPLINE_BLOCK_BEGIN}\ncustom words\n${WARPLINE_BLOCK_END}`;
    const out = preserveWarplineBlock(`old stuff\n${custom}\nmore old`, gen);
    expect(out).toBe(`# head\n\n${custom}\n\n## tail\n`);
  });
  it('uses the generated text when the existing file has no block or a malformed one', () => {
    expect(preserveWarplineBlock(null, gen)).toBe(gen);
    expect(preserveWarplineBlock('no block', gen)).toBe(gen);
    expect(preserveWarplineBlock(`${WARPLINE_BLOCK_BEGIN}\nno end`, gen)).toBe(gen);
  });
  it('matches markers only as whole lines outside fenced code', () => {
    const custom = `${WARPLINE_BLOCK_BEGIN}\nreal\n${WARPLINE_BLOCK_END}`;
    // An inline mention before the real block is not the block.
    const inline = preserveWarplineBlock(`Uses \`${WARPLINE_BLOCK_BEGIN}\` markers.\n${custom}\n`, gen);
    expect(inline).toBe(`# head\n\n${custom}\n\n## tail\n`);
    // Fenced markers are a code sample, not a block: the generated text wins.
    const fenced = `\`\`\`\n${WARPLINE_BLOCK_BEGIN}\nsample\n${WARPLINE_BLOCK_END}\n\`\`\`\n`;
    expect(preserveWarplineBlock(fenced, gen)).toBe(gen);
  });

  it('two blocks in the existing file are malformed: the generated text wins', () => {
    const two = `${WARPLINE_BLOCK_BEGIN}\na\n${WARPLINE_BLOCK_END}\n${WARPLINE_BLOCK_BEGIN}\nb\n${WARPLINE_BLOCK_END}\n`;
    expect(preserveWarplineBlock(two, gen)).toBe(gen);
  });

  it('converts a kept CRLF block to the generated line endings', () => {
    const crlf = `${WARPLINE_BLOCK_BEGIN}\r\ncustom\r\n${WARPLINE_BLOCK_END}\r\n`;
    expect(preserveWarplineBlock(crlf, gen)).toBe(`# head\n\n${WARPLINE_BLOCK_BEGIN}\ncustom\n${WARPLINE_BLOCK_END}\n\n## tail\n`);
    const genCrlf = gen.replace(/\n/g, '\r\n');
    const lf = `${WARPLINE_BLOCK_BEGIN}\ncustom\n${WARPLINE_BLOCK_END}\n`;
    expect(preserveWarplineBlock(lf, genCrlf)).toBe(`# head\r\n\r\n${WARPLINE_BLOCK_BEGIN}\r\ncustom\r\n${WARPLINE_BLOCK_END}\r\n\r\n## tail\r\n`);
  });

  it('drops an existing block when generation omits it (Warpline gone or opted out)', () => {
    const out = preserveWarplineBlock(`x\n${WARPLINE_BLOCK_TEXT.native}\n`, '# head\n');
    expect(out).toBe('# head\n');
  });
});

describe('adapters', () => {
  it('CLAUDE.md puts the block in the cacheable head, after On-Demand Guidance', () => {
    const doc = claude.generate(withWarpline('native'));
    const head = ClaudeAdapter.headOf(doc);
    expect(head).toContain(WARPLINE_BLOCK_TEXT.native);
    expect(head.indexOf(WARPLINE_BLOCK_BEGIN)).toBeGreaterThan(head.indexOf('## On-Demand Guidance'));
    expect(head.indexOf(WARPLINE_BLOCK_BEGIN)).toBeLessThan(head.indexOf('## Directory Structure'));
    expect(doc.split(WARPLINE_BLOCK_BEGIN)).toHaveLength(2);
  });

  it('CLAUDE.md head stays byte-identical across volatile changes with the block (#cache-aligner)', () => {
    const a = claude.generate(withWarpline('git', { paradigmVersion: 'v2.0', symbolCount: 1, currentArc: 'A' }));
    const b = claude.generate(withWarpline('git', { paradigmVersion: 'v9.9', symbolCount: 999, currentArc: 'B' }));
    expect(a).not.toBe(b);
    expect(ClaudeAdapter.headOf(a)).toBe(ClaudeAdapter.headOf(b));
  });

  it('AGENTS.md, .windsurfrules and copilot-instructions.md carry the block only when detected', () => {
    for (const gen of [
      (f: ParadigmFiles) => agentsAdapter.generate(f),
      (f: ParadigmFiles) => windsurfAdapter.generate(f),
      (f: ParadigmFiles) => copilotAdapter.generateFiles(f).find((x) => x.path === '../copilot-instructions.md')!.content,
    ]) {
      expect(gen(withWarpline('git'))).toContain(WARPLINE_BLOCK_TEXT.git);
      expect(gen(plain()).toLowerCase()).not.toContain('warpline');
    }
  });

  it('AGENTS.md places the block right after the overview', () => {
    const doc = agentsAdapter.generate(withWarpline('native'));
    expect(doc.indexOf(WARPLINE_BLOCK_BEGIN)).toBeLessThan(doc.indexOf('## Symbol'));
  });

  it('Cursor gets an alwaysApply paradigm-warpline.mdc only when detected', () => {
    const files = cursorAdapter.generateFiles(withWarpline('native'));
    const rule = files.find((f) => f.path === CursorAdapter.WARPLINE_RULE);
    expect(rule?.content).toContain('alwaysApply: true');
    expect(rule?.content).toContain(WARPLINE_BLOCK_TEXT.native);
    expect(cursorAdapter.generateFiles(plain()).some((f) => f.path === CursorAdapter.WARPLINE_RULE)).toBe(false);
  });
});
