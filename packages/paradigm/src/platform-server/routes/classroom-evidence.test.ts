/**
 * F4: the platform Classroom routes count only EVIDENCED survivals as
 * certified, and tag every cert row with the read-time evidenceState
 * (pending|unproven|survived|overturned) — the same rule as
 * paradigm_classroom_status. A legacy aged-only `survived` row reads unproven.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import express from 'express';
import type { Server } from 'http';

import { createClassroomRouter } from './classroom.js';

let root: string;
let server: Server;
let base: string;

const DAY = 24 * 60 * 60 * 1000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const floor = { timesExercised: 2, adversarialProbes: 1, breakAttempts: 0 };

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-evidence-'));
  const curriculum = path.join(root, '.paradigm', 'curriculum');
  fs.mkdirSync(curriculum, { recursive: true });
  fs.writeFileSync(path.join(curriculum, 'kit.syllabus'), 'id: syl-kit\nagent: kit\n', 'utf8');
  const events = path.join(root, '.paradigm', 'events');
  fs.mkdirSync(events, { recursive: true });
  const rows = [
    { agent: 'kit', entryId: 'nb-young', ts: ago(1), certifiedBy: 'peer', outcome: 'pending' },
    { agent: 'kit', entryId: 'nb-aged', ts: ago(40), certifiedBy: 'peer', outcome: 'pending' },
    { agent: 'kit', entryId: 'nb-legacy', ts: ago(40), certifiedBy: 'gate', outcome: 'survived', survivedAt: ago(20) },
    { agent: 'kit', entryId: 'nb-proven', ts: ago(40), certifiedBy: 'peer', outcome: 'survived', exercise: floor },
    { agent: 'kit', entryId: 'nb-broke', ts: ago(40), certifiedBy: 'peer', outcome: 'overturned' },
  ];
  fs.writeFileSync(path.join(events, 'classroom-certifications.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  const app = express();
  app.use('/classroom', createClassroomRouter(root));
  server = await new Promise<Server>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/classroom`;
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

const expected: Record<string, string> = {
  'nb-young': 'pending',
  'nb-aged': 'unproven',
  'nb-legacy': 'unproven',
  'nb-proven': 'survived',
  'nb-broke': 'overturned',
};

describe('classroom routes: evidenced survival only (F4)', () => {
  it('/status counts only an evidenced survival as certified', async () => {
    const body = (await (await fetch(`${base}/status`)).json()) as { syllabi: Array<{ agent: string; certified: number }> };
    expect(body.syllabi.find(s => s.agent === 'kit')?.certified).toBe(1);
  });

  it('/certifications tags each row with its evidenceState', async () => {
    const body = (await (await fetch(`${base}/certifications`)).json()) as Array<{ entryId: string; evidenceState: string }>;
    expect(Object.fromEntries(body.map(r => [r.entryId, r.evidenceState]))).toEqual(expected);
  });

  it('/rapsheet tags each row with its evidenceState', async () => {
    const body = (await (await fetch(`${base}/rapsheet`)).json()) as Array<{ entryId: string; evidenceState: string }>;
    expect(Object.fromEntries(body.map(r => [r.entryId, r.evidenceState]))).toEqual(expected);
  });
});
