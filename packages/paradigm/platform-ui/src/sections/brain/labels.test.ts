import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  badgeText,
  lockedFolderLabel,
  lockedKindLabel,
  plainText,
  RECENCY_LABELS,
  SIZE_LABELS,
  TYPE_LABELS,
  MATCH_LABELS,
  suggestionsOffCopy,
} from './labels';

const JARGON = /[#^]|yaml|symbol|gate|quarantin|third-party|egress|frontmatter/i;

describe('brain labels — plain vocabulary', () => {
  it('badge text', () => {
    expect(badgeText(true, 0)).toBe('Nothing has left this Mac');
    expect(badgeText(false, 1)).toBe('1 thing shared');
    expect(badgeText(false, 3)).toBe('3 things shared');
  });

  it('locked kinds never show internal gate ids', () => {
    for (const g of ['medical', 'financial', 'third-party-data', 'quarantined', 'weird']) {
      expect(lockedKindLabel(g)).not.toMatch(JARGON);
    }
    expect(lockedFolderLabel(null)).toBe('Individual files');
    expect(lockedFolderLabel('')).toBe('Top folder');
    expect(lockedFolderLabel('Health')).toBe('Health');
  });

  it('static label tables are jargon-free', () => {
    for (const t of [TYPE_LABELS, SIZE_LABELS, RECENCY_LABELS, MATCH_LABELS]) {
      for (const v of Object.values(t)) expect(v).not.toMatch(JARGON);
    }
  });

  it('plainText strips leading sigils from engine prose', () => {
    expect(plainText('Notes tagged #lease share ^topic')).toBe('Notes tagged lease share topic');
    expect(plainText(42)).toBe('');
    expect(plainText('C# is fine')).toBe('C# is fine');
  });

  it('section copy has no symbol sigils or config words in visible strings', () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const files = [path.join(dir, 'BrainSection.tsx'), ...fs.readdirSync(path.join(dir, 'components')).filter((f) => f.endsWith('.tsx')).map((f) => path.join(dir, 'components', f))];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      // JSX text nodes: >text< between tags (ignores code/attributes).
      const texts = [...src.matchAll(/>([^<>{}]+)</g)].map((m) => m[1].trim()).filter(Boolean);
      for (const t of texts) expect(t, `${path.basename(f)}: "${t}"`).not.toMatch(/(^|\s)[#^]\w|yaml|symbol|egress/i);
    }
  });

  it('suggestions-off copy distinguishes auto-pause from turned off', () => {
    expect(suggestionsOffCopy({ paused: true, acceptance: 0.9 })).toBe('Suggestions paused (too many dismissed). Turn back on with `paradigm brain suggestions on`.');
    expect(suggestionsOffCopy({ paused: false, acceptance: 0.1 })).toMatch(/^Suggestions are turned off/);
    // Older servers without `paused`: low measured acceptance reads as paused.
    expect(suggestionsOffCopy({ acceptance: 0.3 })).toMatch(/^Suggestions paused/);
    expect(suggestionsOffCopy({ acceptance: null })).toMatch(/^Suggestions are turned off/);
  });
});
