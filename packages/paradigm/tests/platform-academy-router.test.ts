/**
 * platform-academy-router.test — /api/academy (7.11.0, T-2026-09-26-003).
 *
 * Pins the read-only Academy contract over a temp project with one local pack:
 *   - every :packId route 404s on an unknown pack and 400s on a bad id
 *   - no absolute path (the temp root) ever appears in a response body
 *   - path steps resolve to note/quiz titles; quizzes ship answers
 *   - the router registers GET handlers only
 * Plus: `paradigm university serve` redirects to the Platform Academy, and
 * `paradigm shift` no longer scaffolds .paradigm/university.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import express from 'express';
import { createAcademyRouter } from '../src/platform-server/routes/academy.js';

function write(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}

describe('platform /api/academy — read-only University packs', () => {
  let root: string;
  let server: http.Server;
  let base: string;

  const get = async (p: string): Promise<{ status: number; json: any; text: string }> => {
    const res = await fetch(`${base}${p}`);
    const text = await res.text();
    return { status: res.status, json: JSON.parse(text), text };
  };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-academy-'));
    const pack = path.join(root, '.paradigm', 'university');
    write(
      path.join(pack, 'pack.yaml'),
      [
        'id: demo',
        'name: Demo Pack',
        'version: 1.0.0',
        "schema_version: '2'",
        'tenant_kind: project',
        'description: A tiny pack for tests',
        'skills:',
        '  - path: skills/trace-debug',
      ].join('\n') + '\n',
    );
    // A pack skill that CLAIMS certified trust — the loader must force external.
    write(
      path.join(pack, 'skills', 'trace-debug', 'SKILL.md'),
      [
        '---',
        'name: trace-debug',
        'description: Debug by tracing',
        'allowed-tools: Read Grep',
        'metadata:',
        '  paradigm:',
        '    id: trace-debug',
        '    version: 1.2.0',
        '    steward: builder',
        '    trust: certified',
        '    provenance: { source: authored, createdBy: pack-author }',
        '---',
        '# Trace',
        '',
        'SECRET_SKILL_BODY step one.',
        '',
      ].join('\n'),
    );
    write(path.join(pack, 'skills', 'trace-debug', 'scripts', 'run.sh'), 'echo SECRET_SCRIPT_BODY\n');
    write(
      path.join(pack, 'content', 'notes', 'N-hello.md'),
      [
        '---',
        'id: N-hello',
        'title: Hello Note',
        'type: note',
        'author: test',
        "created: '2026-09-29'",
        "updated: '2026-09-29'",
        'tags: [intro]',
        'symbols: []',
        'difficulty: beginner',
        'prerequisites: []',
        '---',
        '',
        '# Hello',
        '',
        'Body **text**.',
      ].join('\n'),
    );
    write(
      path.join(pack, 'content', 'quizzes', 'Q-hello.yaml'),
      [
        'id: Q-hello',
        'title: Hello Quiz',
        'author: test',
        "created: '2026-09-29'",
        "updated: '2026-09-29'",
        'tags: []',
        'symbols: []',
        'difficulty: beginner',
        'passThreshold: 0.5',
        'questions:',
        '  - id: q1',
        '    question: Pick A',
        '    choices: { A: yes, B: no }',
        '    correct: A',
        '    explanation: A is right',
      ].join('\n') + '\n',
    );
    write(
      path.join(pack, 'content', 'paths', 'LP-hello.yaml'),
      [
        'id: LP-hello',
        'title: Hello Path',
        'author: test',
        "created: '2026-09-29'",
        "updated: '2026-09-29'",
        'tags: []',
        'ordered: true',
        'steps:',
        '  - { content: N-hello, required: true }',
        '  - { content: Q-hello, required: true, passRequired: true }',
        '  - { content: plsat:v3.0, required: false }',
      ].join('\n') + '\n',
    );

    const app = express();
    app.use('/api/academy', createAcademyRouter(root));
    server = app.listen(0);
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${addr.port}/api/academy`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('GET /packs lists the discovered pack with counts and no absolute paths', async () => {
    const { status, json, text } = await get('/packs');
    expect(status).toBe(200);
    const demo = json.find((p: any) => p.id === 'demo');
    expect(demo).toMatchObject({ title: 'Demo Pack', tenant_kind: 'project', origin: 'local', skillCount: 1 });
    expect(demo.counts).toMatchObject({ note: 1, quiz: 1, path: 1 });
    expect(Array.isArray(demo.sections)).toBe(true);
    expect(text).not.toContain(root);
  });

  it('GET /packs/:packId/paths and /paths/:id resolve steps to titles', async () => {
    const list = await get('/packs/demo/paths');
    expect(list.status).toBe(200);
    expect(list.json).toEqual([expect.objectContaining({ id: 'LP-hello', title: 'Hello Path', stepCount: 3 })]);

    const one = await get('/packs/demo/paths/LP-hello');
    expect(one.status).toBe(200);
    expect(one.json.steps.map((s: any) => [s.kind, s.title])).toEqual([
      ['note', 'Hello Note'],
      ['quiz', 'Hello Quiz'],
      ['plsat', 'plsat:v3.0'],
    ]);
    expect(one.text).not.toContain(root);
  });

  it('GET /notes/:id returns { frontmatter, body }', async () => {
    const { status, json, text } = await get('/packs/demo/notes/N-hello');
    expect(status).toBe(200);
    expect(json.frontmatter.title).toBe('Hello Note');
    expect(json.body).toContain('Body **text**.');
    expect(text).not.toContain(root);
  });

  it('GET /quizzes/:id returns the quiz with answers for local grading', async () => {
    const { status, json } = await get('/packs/demo/quizzes/Q-hello');
    expect(status).toBe(200);
    expect(json.passThreshold).toBe(0.5);
    expect(json.questions[0]).toMatchObject({ id: 'q1', correct: 'A', explanation: 'A is right' });
  });

  it('GET /skills lists pack skills as external with no bodies or paths', async () => {
    const { status, json, text } = await get('/packs/demo/skills');
    expect(status).toBe(200);
    expect(json).toEqual([
      {
        id: 'trace-debug',
        version: '1.2.0',
        description: 'Debug by tracing',
        trust: 'external',
        allowedTools: 'Read Grep',
        scriptCount: 1,
      },
    ]);
    expect(text).not.toContain('SECRET_SKILL_BODY');
    expect(text).not.toContain('SECRET_SCRIPT_BODY');
    expect(text).not.toContain(root);
  });

  it('entry ids of the wrong type 404 (a quiz is not a note)', async () => {
    expect((await get('/packs/demo/notes/Q-hello')).status).toBe(404);
    expect((await get('/packs/demo/paths/N-hello')).status).toBe(404);
    expect((await get('/packs/demo/quizzes/LP-hello')).status).toBe(404);
  });

  const packRoutes = ['/paths', '/paths/LP-hello', '/notes/N-hello', '/quizzes/Q-hello', '/skills'];

  it.each(packRoutes)('unknown pack → 404 on %s', async (suffix) => {
    const { status, json } = await get(`/packs/nope${suffix}`);
    expect(status).toBe(404);
    expect(typeof json.error).toBe('string');
  });

  it.each(['/paths/', '/notes/', '/quizzes/'])('bad entry id → 400 on %s', async (prefix) => {
    for (const bad of ['..%2F..%2Fetc', 'a.b', 'a%20b']) {
      const { status, text } = await get(`/packs/demo${prefix}${bad}`);
      expect(status).toBe(400);
      expect(text).not.toContain(root);
    }
  });

  it('bad pack id → 400', async () => {
    expect((await get('/packs/..%2Fx/paths')).status).toBe(400);
  });

  it('GET /search finds entries across packs without file paths', async () => {
    const { status, json, text } = await get('/search?q=hello');
    expect(status).toBe(200);
    expect(json.total).toBe(3);
    for (const e of json.entries) {
      expect(e.pack).toBe('demo');
      expect(e).not.toHaveProperty('file');
    }
    expect(text).not.toContain(root);
    expect((await get('/search?q=hello&pack=nope')).status).toBe(404);
    expect((await get('/search?type=a.b')).status).toBe(400);
    expect((await get(`/search?q=${'x'.repeat(201)}`)).status).toBe(400);
    expect((await get(`/search?q=${'x'.repeat(200)}`)).status).toBe(200);
  });

  it('registers GET handlers only', () => {
    const router = createAcademyRouter(root) as unknown as {
      stack: Array<{ route?: { methods: Record<string, boolean> } }>;
    };
    for (const layer of router.stack) {
      if (!layer.route) continue;
      expect(Object.keys(layer.route.methods)).toEqual(['get']);
    }
  });
});

describe('paradigm university serve — redirect to the Platform Academy', () => {
  it('starts the Platform with only the academy section and does not use the old server', async () => {
    const startPlatformServer = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../src/platform-server/index.js', () => ({ startPlatformServer }));
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    const wspy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    }) as never);
    const { universityServeCommand } = await import('../src/commands/university/serve.js');
    // The command parks forever after launch — race it against a tick.
    await Promise.race([
      universityServeCommand(undefined, { port: '4123', open: false }),
      new Promise((r) => setTimeout(r, 50)),
    ]);
    spy.mockRestore();
    wspy.mockRestore();
    vi.doUnmock('../src/platform-server/index.js');
    expect(startPlatformServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 4123, sections: ['academy'], open: false }),
    );
    expect(logs.join('\n')).toContain('University moved to Platform → Academy');
  });
});

describe('paradigm shift — no University scaffold (7.11.0)', () => {
  it('shift.ts no longer creates .paradigm/university or snapshots metrics', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'shift.ts'), 'utf8');
    expect(src).not.toMatch(/'\.paradigm',\s*'university'/);
    expect(src).not.toContain('captureSnapshot');
    expect(src).not.toContain('university/metrics');
  });
});
