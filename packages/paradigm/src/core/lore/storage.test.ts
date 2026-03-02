import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createTempProject } from '../../test-utils.js';
import { recordLore, loadLoreEntries, loadLoreEntry, loadLoreTimeline, addReview, rebuildTimeline } from './storage.js';
import type { LoreEntry } from './types.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function makeLoreEntry(overrides: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id: '',
    type: 'agent-session',
    timestamp: '2026-02-21T10:00:00Z',
    author: 'test-user',
    agent: { provider: 'anthropic', model: 'claude-opus-4-6' },
    title: 'Test entry',
    summary: 'A test lore entry',
    symbols_touched: ['#test-component'],
    ...overrides,
  };
}

describe('recordLore', () => {
  it('creates dated dir and .lore file', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    const entry = makeLoreEntry({ timestamp: '2026-02-21T10:00:00Z' });
    await recordLore(rootDir, entry);

    const dateDir = path.join(rootDir, '.paradigm', 'lore', 'entries', '2026-02-21');
    expect(fs.existsSync(dateDir)).toBe(true);

    const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.lore'));
    expect(files.length).toBe(1);

    const content = yaml.load(fs.readFileSync(path.join(dateDir, files[0]), 'utf8')) as LoreEntry;
    expect(content.title).toBe('Test entry');
    expect(content.author).toBe('test-user');
  });

  it('auto-generates IDs with new format', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry({ timestamp: '2026-02-21T10:00:00Z' }));
    await recordLore(rootDir, makeLoreEntry({ timestamp: '2026-02-21T10:00:00Z' }));

    const dateDir = path.join(rootDir, '.paradigm', 'lore', 'entries', '2026-02-21');
    const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.lore')).sort();
    expect(files.length).toBe(2);

    // New format: L-{date}-{author}-{HHMMSS}-{counter}.lore
    expect(files[0]).toMatch(/^L-2026-02-21-test-user-100000-001\.lore$/);
    expect(files[1]).toMatch(/^L-2026-02-21-test-user-100000-002\.lore$/);
  });

  it('uses provided ID', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry({ id: 'L-2026-02-21-custom', timestamp: '2026-02-21T10:00:00Z' }));

    const dateDir = path.join(rootDir, '.paradigm', 'lore', 'entries', '2026-02-21');
    const files = fs.readdirSync(dateDir);
    expect(files).toContain('L-2026-02-21-custom.lore');
  });

  it('rebuilds timeline after write', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry());

    const timelinePath = path.join(rootDir, '.paradigm', 'lore', 'timeline.yaml');
    expect(fs.existsSync(timelinePath)).toBe(true);

    const timeline = yaml.load(fs.readFileSync(timelinePath, 'utf8')) as Record<string, unknown>;
    expect(timeline.entries).toBe(1);
  });
});

describe('loadLoreEntries', () => {
  it('returns [] when no entries dir', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    const entries = await loadLoreEntries(rootDir);
    expect(entries).toEqual([]);
  });

  it('loads all entries sorted newest-first', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry({ timestamp: '2026-02-20T10:00:00Z', title: 'Old' }));
    await recordLore(rootDir, makeLoreEntry({ timestamp: '2026-02-21T10:00:00Z', title: 'New' }));

    const entries = await loadLoreEntries(rootDir);
    expect(entries.length).toBe(2);
    expect(entries[0].title).toBe('New');
    expect(entries[1].title).toBe('Old');
  });

  it('applies filter', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry({
      timestamp: '2026-02-21T10:00:00Z',
      author: 'claude',
      agent: { provider: 'anthropic', model: 'claude-opus-4-6' },
    }));
    await recordLore(rootDir, makeLoreEntry({
      timestamp: '2026-02-21T11:00:00Z',
      author: 'ascend',
      agent: undefined,
    }));

    const entries = await loadLoreEntries(rootDir, { author: 'ascend' });
    expect(entries.length).toBe(1);
    expect(entries[0].author).toBe('ascend');
  });

  it('loads both .yaml and .lore files', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    // Write a .lore file
    await recordLore(rootDir, makeLoreEntry({ timestamp: '2026-02-21T10:00:00Z', title: 'New format' }));

    // Write a legacy .yaml file
    const dateDir = path.join(rootDir, '.paradigm', 'lore', 'entries', '2026-02-21');
    const legacyEntry = makeLoreEntry({ id: 'L-2026-02-21-legacy', timestamp: '2026-02-21T09:00:00Z', title: 'Legacy format' });
    fs.writeFileSync(path.join(dateDir, 'L-2026-02-21-legacy.yaml'), yaml.dump(legacyEntry));

    const entries = await loadLoreEntries(rootDir);
    expect(entries.length).toBe(2);
    const titles = entries.map(e => e.title);
    expect(titles).toContain('New format');
    expect(titles).toContain('Legacy format');
  });

  it('normalizes old author format on load', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    // Write an old-format entry directly
    const dateDir = path.join(rootDir, '.paradigm', 'lore', 'entries', '2026-02-21');
    fs.mkdirSync(dateDir, { recursive: true });
    const oldEntry = {
      id: 'L-2026-02-21-old',
      type: 'agent-session',
      timestamp: '2026-02-21T10:00:00Z',
      author: { type: 'agent', id: 'claude', model: 'claude-opus-4-6' },
      title: 'Old format entry',
      summary: 'Test',
      symbols_touched: ['#test'],
    };
    fs.writeFileSync(path.join(dateDir, 'L-2026-02-21-old.yaml'), yaml.dump(oldEntry));

    const entries = await loadLoreEntries(rootDir);
    expect(entries.length).toBe(1);
    expect(entries[0].author).toBe('unknown'); // Agent entries normalize to 'unknown' human
    expect(entries[0].agent).toEqual({ provider: 'anthropic', model: 'claude-opus-4-6' });
  });

  it('prunes date dirs outside range', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry({ timestamp: '2026-01-15T10:00:00Z', title: 'Jan' }));
    await recordLore(rootDir, makeLoreEntry({ timestamp: '2026-02-21T10:00:00Z', title: 'Feb' }));

    const entries = await loadLoreEntries(rootDir, { dateFrom: '2026-02-01' });
    expect(entries.length).toBe(1);
    expect(entries[0].title).toBe('Feb');
  });

  it('skips malformed YAML', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry({ timestamp: '2026-02-21T10:00:00Z' }));

    // Write a malformed file with .lore extension
    const badPath = path.join(rootDir, '.paradigm', 'lore', 'entries', '2026-02-21', 'bad.lore');
    fs.writeFileSync(badPath, '{{{{ invalid yaml', 'utf8');

    const entries = await loadLoreEntries(rootDir);
    expect(entries.length).toBe(1);
  });
});

describe('addReview', () => {
  it('updates entry with review data', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry({ timestamp: '2026-02-21T10:00:00Z' }));

    const entries = await loadLoreEntries(rootDir);
    const entryId = entries[0].id;

    const result = await addReview(rootDir, entryId, {
      reviewer: 'ascend',
      completeness: 5,
      quality: 4,
      reviewed_at: '2026-02-21T12:00:00Z',
    });

    expect(result).toBe(true);

    const updated = await loadLoreEntry(rootDir, entryId);
    expect(updated?.review?.reviewer).toBe('ascend');
    expect(updated?.review?.completeness).toBe(5);
  });

  it('returns false for nonexistent ID', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    const result = await addReview(rootDir, 'L-9999-01-01-999', {
      reviewer: 'ascend',
      completeness: 3,
      quality: 3,
      reviewed_at: '2026-02-21T12:00:00Z',
    });

    expect(result).toBe(false);
  });
});

describe('rebuildTimeline', () => {
  it('creates timeline.yaml with correct count and authors', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry({
      timestamp: '2026-02-21T10:00:00Z',
      author: 'claude',
    }));
    await recordLore(rootDir, makeLoreEntry({
      timestamp: '2026-02-21T11:00:00Z',
      author: 'ascend',
    }));

    const timeline = await loadLoreTimeline(rootDir);
    expect(timeline).not.toBeNull();
    expect(timeline!.entries).toBe(2);
    expect(timeline!.authors).toContain('claude');
    expect(timeline!.authors).toContain('ascend');
  });

  it('reads project name from config', async () => {
    const { rootDir, cleanup: c } = createTempProject({
      config: { project: 'my-project' } as any,
    });
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry());

    const timeline = await loadLoreTimeline(rootDir);
    expect(timeline!.project).toBe('my-project');
  });

  it('handles empty entries dir', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    fs.mkdirSync(path.join(rootDir, '.paradigm', 'lore', 'entries'), { recursive: true });

    await rebuildTimeline(rootDir);

    const timeline = await loadLoreTimeline(rootDir);
    expect(timeline).not.toBeNull();
    expect(timeline!.entries).toBe(0);
  });
});

describe('loadLoreEntry', () => {
  it('loads by ID via date extraction', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry({ timestamp: '2026-02-21T10:00:00Z', title: 'Direct load' }));

    const entries = await loadLoreEntries(rootDir);
    const entryId = entries[0].id;

    const entry = await loadLoreEntry(rootDir, entryId);
    expect(entry).not.toBeNull();
    expect(entry!.title).toBe('Direct load');
  });

  it('loads legacy .yaml entries by ID', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    // Write a legacy .yaml entry
    const dateDir = path.join(rootDir, '.paradigm', 'lore', 'entries', '2026-02-21');
    fs.mkdirSync(dateDir, { recursive: true });
    const entry = makeLoreEntry({ id: 'L-2026-02-21-legacy', timestamp: '2026-02-21T10:00:00Z', title: 'Legacy' });
    fs.writeFileSync(path.join(dateDir, 'L-2026-02-21-legacy.yaml'), yaml.dump(entry));

    const loaded = await loadLoreEntry(rootDir, 'L-2026-02-21-legacy');
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe('Legacy');
  });

  it('falls back to scan for non-standard ID', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    const dateDir = path.join(rootDir, '.paradigm', 'lore', 'entries', '2026-02-21');
    fs.mkdirSync(dateDir, { recursive: true });
    const entry = makeLoreEntry({ id: 'custom-id', timestamp: '2026-02-21T10:00:00Z', title: 'Custom' });
    fs.writeFileSync(path.join(dateDir, 'custom-id.lore'), yaml.dump(entry), 'utf8');

    const loaded = await loadLoreEntry(rootDir, 'custom-id');
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe('Custom');
  });

  it('returns null for missing', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    const entry = await loadLoreEntry(rootDir, 'L-9999-01-01-001');
    expect(entry).toBeNull();
  });
});

describe('loadLoreTimeline', () => {
  it('returns null when missing', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    const timeline = await loadLoreTimeline(rootDir);
    expect(timeline).toBeNull();
  });

  it('returns parsed when exists', async () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;

    await recordLore(rootDir, makeLoreEntry());

    const timeline = await loadLoreTimeline(rootDir);
    expect(timeline).not.toBeNull();
    expect(timeline!.version).toBe('1.0');
    expect(timeline!.entries).toBeGreaterThan(0);
  });
});
