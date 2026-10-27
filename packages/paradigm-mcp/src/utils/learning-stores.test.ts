import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listLearningStores, nativeMemorySlug } from './learning-stores.js';

describe('nativeMemorySlug', () => {
  it("matches Claude Code's project key: every non-alphanumeric character becomes '-'", () => {
    const root = path.resolve('/tmp/my_repo.v2/a b');
    expect(nativeMemorySlug(root)).toBe(root.replace(/[^A-Za-z0-9]/g, '-'));
    expect(nativeMemorySlug(root)).toMatch(/^[A-Za-z0-9-]+$/);
    if (process.platform === 'win32') expect(nativeMemorySlug('C:\\Users\\me\\repo')).toBe('C--Users-me-repo');
    else expect(nativeMemorySlug('/Users/me/my_repo.v2')).toBe('-Users-me-my-repo-v2');
  });
});

describe('listLearningStores (census)', () => {
  it('lists every store with a class, and counts without throwing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-root-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-home-'));
    const ev = path.join(root, '.paradigm', 'events');
    fs.mkdirSync(ev, { recursive: true });
    fs.writeFileSync(path.join(ev, 'promotion-decisions.jsonl'), '{}\n{}\n');
    fs.mkdirSync(path.join(root, '.paradigm', 'protocols'));
    fs.writeFileSync(path.join(root, '.paradigm', 'protocols', 'a.protocol'), 'id: P-a\n');
    fs.mkdirSync(path.join(home, '.paradigm', 'agents', 'kit', 'journal'), { recursive: true });
    fs.writeFileSync(path.join(home, '.paradigm', 'agents', 'kit', 'journal', 'j.yaml'), 'id: j\n');

    const stores = listLearningStores(root, { homeDir: home });
    const classes = new Set(['ledger', 'knowledge', 'pipeline', 'policy', 'native']);
    for (const s of stores) {
      expect(classes.has(s.class)).toBe(true);
      expect(typeof s.count()).toBe('number');
    }
    const byId = Object.fromEntries(stores.map(s => [s.id, s]));
    // Loid's must-NOT-consolidate list stays as separate rows.
    for (const id of ['journals', 'notebooks', 'promotion-decisions', 'classroom-certifications',
      'notebook-refs', 'decisions', 'antipatterns', 'lore', 'habits', 'claude-memory']) {
      expect(byId[id], id).toBeDefined();
    }
    // Spec's three conceptual stores.
    for (const id of ['lore', 'work-log', 'history', 'journals']) expect(byId[id].class, id).toBe('ledger');
    for (const id of ['decisions', 'antipatterns', 'notebooks', 'protocols']) expect(byId[id].class, id).toBe('knowledge');
    for (const id of ['nominations', 'event-stream', 'debates', 'promotion-decisions', 'classroom-certifications', 'notebook-refs'])
      expect(byId[id].class, id).toBe('pipeline');
    expect(byId['habits'].class).toBe('policy');
    expect(byId['claude-memory'].class).toBe('native');
    expect(byId['promotion-decisions'].count()).toBe(2);
    expect(byId['protocols'].count()).toBe(1);
    expect(byId['journals'].count()).toBe(1);
    expect(byId['skills'].count()).toBe(0);
    // Lore recurses into date dirs and counts .lore (and legacy .yaml) entries, not timeline.yaml.
    const loreDay = path.join(root, '.paradigm', 'lore', 'entries', '2026-09-01');
    fs.mkdirSync(loreDay, { recursive: true });
    fs.writeFileSync(path.join(loreDay, 'L-1.lore'), 'id: L-1\n');
    fs.writeFileSync(path.join(loreDay, 'L-2.yaml'), 'id: L-2\n');
    fs.writeFileSync(path.join(root, '.paradigm', 'lore', 'timeline.yaml'), 'entries: []\n');
    expect(byId['lore'].count()).toBe(2);
    expect(byId['claude-memory'].path).toContain(nativeMemorySlug(root));
    // Enumeration is read-only.
    expect(fs.existsSync(path.join(root, '.paradigm', 'skills'))).toBe(false);
  });
});
