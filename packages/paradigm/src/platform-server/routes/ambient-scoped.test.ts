/**
 * Scoped learning F1: the platform ambient routes read nominations and debates
 * from every home (they default to the user home now) and engage a nomination
 * in whichever home holds it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import express from 'express';
import type { Server } from 'http';

import { createAmbientRouter } from './ambient.js';
import type { PlatformWsContext } from '../ws/index.js';
import { appendLearningRows, pathFor, readLearningRows } from '../../../../paradigm-mcp/src/utils/learning-stores.js';

let root: string;
let server: Server;
let base: string;
const broadcasts: Array<Record<string, unknown>> = [];

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ambient-scoped-'));
  const ws = { broadcast: (m: Record<string, unknown>) => broadcasts.push(m) } as unknown as PlatformWsContext;
  const app = express();
  app.use(express.json());
  app.use('/ambient', createAmbientRouter(root, ws));
  server = await new Promise<Server>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ambient`;
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

describe('ambient routes read and write through the resolver', () => {
  it('lists user-home and legacy repo nominations, with their debates', async () => {
    appendLearningRows('nominations', root, [{ id: 'u1', agent: 'kit', urgency: 'low' }]);
    const legacy = path.join(root, '.paradigm', 'events', 'nominations.jsonl');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({ id: 'r1', agent: 'kit', urgency: 'low' }) + '\n', 'utf8');
    appendLearningRows('debates', root, [{ id: 'd1', nominationId: 'u1' }]);

    const res = await fetch(`${base}/nominations?include_debates=true`);
    const body = (await res.json()) as Array<{ id: string; debates?: unknown[] }>;
    expect(body.map(n => n.id).sort()).toEqual(['r1', 'u1']);
    expect(body.find(n => n.id === 'u1')!.debates).toHaveLength(1);
  });

  it('engages a user-home nomination in place, never copying it into the repo', async () => {
    appendLearningRows('nominations', root, [{ id: 'u1', agent: 'kit' }]);
    const res = await fetch(`${base}/nominations/u1/engage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: 'accepted' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { engaged: boolean }).engaged).toBe(true);
    const rows = readLearningRows<{ id: string; engaged?: boolean }>('nominations', root);
    expect(rows).toHaveLength(1);
    expect(rows[0].engaged).toBe(true);
    expect(fs.existsSync(pathFor('nominations', 'repo', root))).toBe(false);

    const missing = await fetch(`${base}/nominations/nope/engage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: 'accepted' }),
    });
    expect(missing.status).toBe(404);
  });
});
