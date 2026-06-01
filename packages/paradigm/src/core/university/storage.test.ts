/**
 * University storage — Phase 2 (CLI pack-selector parity) tests.
 *
 * Covers spec §SURFACE 2: loadPackIndex / searchContent over a selected pack
 * (content/ + src/content/ layouts), the contains-content dual-base probe, and
 * the hard back-compat gate — the no-packRoot path must be byte-identical.
 *
 * Plus the A2 (§Phase 3) Commander parse-regression mechanism: a parent+sub
 * `--port` tree with enablePositionalOptions() must let the subcommand's
 * --port win, while bare-parent --port still parses.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Command } from 'commander';
import {
  loadPackIndex,
  searchContent,
  searchContentWithMeta,
  resolveContentBase,
  loadUniversityIndex,
  loadNote,
  loadQuiz,
  saveNote,
  rebuildUniversityIndex,
} from './storage.js';
import type { UniversityFrontmatter } from './types.js';

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

function mkTmp(prefix = 'uni-pack-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

const NOTE = `---
id: N-hello
title: Hello Pack
type: note
author: tester
created: '2026-05-31'
updated: '2026-05-31'
tags:
  - intro
symbols: []
difficulty: beginner
section: foundations
order: 1
---

Body text.
`;

const QUIZ = `id: Q-hello
title: Hello Quiz
author: tester
created: '2026-05-31'
updated: '2026-05-31'
tags:
  - intro
symbols: []
difficulty: beginner
passThreshold: 0.7
questions: []
section: foundations
`;

/**
 * Scaffold a discipline-style pack at `<root>/<contentSub>/{notes,quizzes}`.
 * @param contentSub 'content' or 'src/content'
 */
function makePack(contentSub: 'content' | 'src/content', opts: { withPackYaml?: boolean; empty?: boolean } = {}): string {
  const root = mkTmp();
  if (opts.withPackYaml) {
    fs.writeFileSync(path.join(root, 'pack.yaml'), yaml.dump({ id: 'ai-literacy', name: 'AI Literacy', tenant_kind: 'project' }), 'utf8');
  }
  if (!opts.empty) {
    const notesDir = path.join(root, contentSub, 'notes');
    const quizDir = path.join(root, contentSub, 'quizzes');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.mkdirSync(quizDir, { recursive: true });
    fs.writeFileSync(path.join(notesDir, 'N-hello.md'), NOTE, 'utf8');
    fs.writeFileSync(path.join(quizDir, 'Q-hello.yaml'), QUIZ, 'utf8');
  } else {
    // create the dirs but leave them empty
    fs.mkdirSync(path.join(root, contentSub, 'notes'), { recursive: true });
  }
  return root;
}

describe('resolveContentBase (contains-content dual-base probe)', () => {
  it('resolves content/ when it holds content', () => {
    const root = makePack('content');
    expect(resolveContentBase(root)).toBe(path.join(root, 'content'));
  });

  it('resolves src/content/ when content/ is absent', () => {
    const root = makePack('src/content');
    expect(resolveContentBase(root)).toBe(path.join(root, 'src/content'));
  });

  it('skips an EMPTY content/ and resolves a populated src/content/ (C4 regression)', () => {
    const root = mkTmp();
    // empty content/ beside a populated src/content/
    fs.mkdirSync(path.join(root, 'content', 'notes'), { recursive: true });
    const srcNotes = path.join(root, 'src/content', 'notes');
    fs.mkdirSync(srcNotes, { recursive: true });
    fs.writeFileSync(path.join(srcNotes, 'N-hello.md'), NOTE, 'utf8');

    expect(resolveContentBase(root)).toBe(path.join(root, 'src/content'));
  });

  it('returns null when neither base has content', () => {
    const root = makePack('content', { empty: true });
    expect(resolveContentBase(root)).toBeNull();
  });
});

describe('loadPackIndex', () => {
  it('scans a content/ pack with no index.yaml and propagates section/order', () => {
    const root = makePack('content');
    const index = loadPackIndex(root);
    expect(index.totalContent).toBe(2);
    const note = index.entries.find(e => e.id === 'N-hello');
    expect(note).toBeDefined();
    expect(note?.section).toBe('foundations');
    expect(note?.order).toBe(1);
    expect(note?.file).toBe('content/notes/N-hello.md');
    const quiz = index.entries.find(e => e.id === 'Q-hello');
    expect(quiz?.type).toBe('quiz');
    expect(quiz?.section).toBe('foundations');
  });

  it('scans a src/content/ pack and prefixes file paths with src/content', () => {
    const root = makePack('src/content');
    const index = loadPackIndex(root);
    const note = index.entries.find(e => e.id === 'N-hello');
    expect(note?.file).toBe('src/content/notes/N-hello.md');
  });

  it('prefers an existing index.yaml over scanning', () => {
    const root = makePack('content');
    const handWritten = {
      version: '1.0', generatedAt: 'X', totalContent: 1, diplomaCount: 0,
      entries: [{ id: 'PREBUILT', title: 'Prebuilt', type: 'note', author: 'x', created: '', updated: '', tags: [], symbols: [], file: 'content/notes/x.md' }],
    };
    fs.writeFileSync(path.join(root, 'index.yaml'), yaml.dump(handWritten), 'utf8');
    const index = loadPackIndex(root);
    expect(index.totalContent).toBe(1);
    expect(index.entries[0].id).toBe('PREBUILT');
  });

  it('returns an empty index (not null) when the pack has no content base', () => {
    const root = makePack('content', { empty: true });
    const index = loadPackIndex(root);
    expect(index.totalContent).toBe(0);
    expect(index.entries).toEqual([]);
  });
});

describe('searchContent with packRoot', () => {
  it('returns the SELECTED pack entries, not the project index', () => {
    // project has its own index.yaml with unrelated content...
    const projectRoot = mkTmp();
    const uniDir = path.join(projectRoot, '.paradigm', 'university');
    fs.mkdirSync(uniDir, { recursive: true });
    fs.writeFileSync(path.join(uniDir, 'index.yaml'), yaml.dump({
      version: '1.0', generatedAt: 'X', totalContent: 1, diplomaCount: 0,
      entries: [{ id: 'PROJECT-ONLY', title: 'Project', type: 'note', author: 'x', created: '', updated: '', tags: [], symbols: [], file: 'content/notes/p.md' }],
    }), 'utf8');

    const packRoot = makePack('content');
    const results = searchContent(projectRoot, {}, packRoot);
    const ids = results.map(r => r.id).sort();
    expect(ids).toEqual(['N-hello', 'Q-hello']);
    expect(ids).not.toContain('PROJECT-ONLY');
  });

  it('honors type + section filters over the pack index', () => {
    const packRoot = makePack('content');
    expect(searchContent(mkTmp(), { type: 'quiz' }, packRoot).map(r => r.id)).toEqual(['Q-hello']);
    expect(searchContent(mkTmp(), { section: 'foundations' }, packRoot).length).toBe(2);
    expect(searchContent(mkTmp(), { section: 'nope' }, packRoot).length).toBe(0);
  });

  it('searchContentWithMeta reports the pre-slice total', () => {
    const packRoot = makePack('content');
    const { entries, total } = searchContentWithMeta(mkTmp(), { limit: 1 }, packRoot);
    expect(entries.length).toBe(1);
    expect(total).toBe(2);
  });
});

describe('back-compat — no-packRoot path is byte-identical', () => {
  function scaffoldProject(): string {
    const root = mkTmp();
    const contentBase = path.join(root, '.paradigm', 'university', 'content');
    fs.mkdirSync(path.join(contentBase, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(contentBase, 'quizzes'), { recursive: true });
    fs.writeFileSync(path.join(contentBase, 'notes', 'N-hello.md'), NOTE, 'utf8');
    fs.writeFileSync(path.join(contentBase, 'quizzes', 'Q-hello.yaml'), QUIZ, 'utf8');
    return root;
  }

  it('rebuildUniversityIndex output is stable across two runs (modulo timestamp)', () => {
    const root = scaffoldProject();
    const a = rebuildUniversityIndex(root);
    const b = rebuildUniversityIndex(root);
    const strip = (i: typeof a) => ({ ...i, generatedAt: 'X' });
    expect(strip(a)).toEqual(strip(b));
    // section/order propagated additively from frontmatter
    const note = a.entries.find(e => e.id === 'N-hello');
    expect(note?.section).toBe('foundations');
    expect(note?.order).toBe(1);
    expect(note?.file).toBe('content/notes/N-hello.md');
  });

  it('searchContent without packRoot reads the project index unchanged', () => {
    const root = scaffoldProject();
    rebuildUniversityIndex(root);
    const projectResults = searchContent(root, {}).map(r => r.id).sort();
    expect(projectResults).toEqual(['N-hello', 'Q-hello']);
    // loadUniversityIndex still works the same
    expect(loadUniversityIndex(root)?.totalContent).toBe(2);
  });

  it('saveNote without packRoot writes to the project dir and does NOT stamp pack_id', () => {
    const root = mkTmp();
    // a pack.yaml exists at the project root — proves stamping is gated on the
    // explicit packRoot arg, not on manifest presence.
    const uniDir = path.join(root, '.paradigm', 'university');
    fs.mkdirSync(uniDir, { recursive: true });
    fs.writeFileSync(path.join(uniDir, 'pack.yaml'), yaml.dump({ id: 'proj' }), 'utf8');

    const fm: UniversityFrontmatter = {
      id: 'N-x', title: 'X', type: 'note', author: 't', created: '2026-05-31', updated: '2026-05-31',
      tags: [], symbols: [], difficulty: 'beginner', prerequisites: [],
    };
    const fp = saveNote(root, fm, 'body');
    expect(fp).toBe(path.join(uniDir, 'content', 'notes', 'N-x.md'));
    expect(fs.readFileSync(fp, 'utf8')).not.toContain('pack_id');
  });

  it('saveNote WITH a packRoot stamps pack_id from the pack manifest', () => {
    const packRoot = makePack('content', { withPackYaml: true });
    const fm: UniversityFrontmatter = {
      id: 'N-x', title: 'X', type: 'note', author: 't', created: '2026-05-31', updated: '2026-05-31',
      tags: [], symbols: [], difficulty: 'beginner', prerequisites: [],
    };
    const fp = saveNote(mkTmp(), fm, 'body', packRoot);
    expect(fp).toBe(path.join(packRoot, 'content', 'notes', 'N-x.md'));
    expect(fs.readFileSync(fp, 'utf8')).toContain('pack_id: ai-literacy');
  });
});

describe('loadNote / loadQuiz honor packRoot dual-base', () => {
  it('loads a note body from a src/content pack', () => {
    const packRoot = makePack('src/content');
    const note = loadNote(mkTmp(), 'N-hello', packRoot);
    expect(note?.frontmatter.title).toBe('Hello Pack');
    expect(note?.body).toBe('Body text.');
  });
  it('loads a quiz from a content pack', () => {
    const packRoot = makePack('content');
    const quiz = loadQuiz(mkTmp(), 'Q-hello', packRoot);
    expect(quiz?.title).toBe('Hello Quiz');
  });
});

/**
 * A2 mechanism test (§Phase 3). index.ts calls program.parse() at module load
 * and doesn't export `program`, so we reproduce the exact parent+sub --port
 * tree here and assert enablePositionalOptions() makes the subcommand --port
 * win — the deterministic Commander behavior the fix relies on. Also asserts a
 * sibling parent+sub command still parses (program-global blast-radius guard).
 */
describe('A2 — enablePositionalOptions parent/sub --port resolution', () => {
  function buildTree() {
    const program = new Command();
    program.exitOverride();
    program.enablePositionalOptions();

    const uni = program.command('university');
    uni.enablePositionalOptions();

    let serveOpts: Record<string, unknown> | undefined;
    uni.command('serve')
      .option('-p, --port <port>', 'Port', '3839')
      .option('--no-open', 'no open')
      .option('--pack <id>', 'pack')
      .action((o) => { serveOpts = o; });

    let bareOpts: Record<string, unknown> | undefined;
    uni.option('-p, --port <port>', 'Port', '3839')
      .action((o) => { bareOpts = o; });

    // sibling parent+sub command to guard the program-global change
    let watchOpts: Record<string, unknown> | undefined;
    const portal = program.command('portal');
    portal.enablePositionalOptions();
    portal.command('watch')
      .option('-p, --port <port>', 'Port', '9999')
      .action((o) => { watchOpts = o; });

    return { program, getServe: () => serveOpts, getBare: () => bareOpts, getWatch: () => watchOpts };
  }

  it('subcommand --port wins over the parent default', async () => {
    const t = buildTree();
    await t.program.parseAsync(['node', 'cli', 'university', 'serve', '--port', '4000', '--no-open']);
    expect(t.getServe()?.port).toBe('4000');
  });

  it('bare parent --port still parses (backward compat)', async () => {
    const t = buildTree();
    await t.program.parseAsync(['node', 'cli', 'university', '--port', '4001']);
    expect(t.getBare()?.port).toBe('4001');
  });

  it('sibling parent+sub command (portal watch) still parses its own --port', async () => {
    const t = buildTree();
    await t.program.parseAsync(['node', 'cli', 'portal', 'watch', '--port', '5005']);
    expect(t.getWatch()?.port).toBe('5005');
  });

  it('subcommand still parses its other options alongside --port', async () => {
    const t = buildTree();
    await t.program.parseAsync(['node', 'cli', 'university', 'serve', '--port', '4002', '--pack', 'ai-literacy']);
    expect(t.getServe()?.port).toBe('4002');
    expect(t.getServe()?.pack).toBe('ai-literacy');
  });
});
