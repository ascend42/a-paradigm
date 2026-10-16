/**
 * ripple.test — CLI ripple resolves user-typed names fuzzily, lists
 * candidates for ambiguous names, and anchors a portal gate's test-path
 * suggestion on its .purpose source.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { aggregateFromDirectory, buildSymbolIndex } from '@a-company/premise-core';
import { analyzeRipple } from './ripple.js';

let tmp: string;

function write(rel: string, content: string): void {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ripple-'));
  write('portal.yaml', 'version: 2.0.0\ngates:\n  auth:\n    description: Auth gate\n    prizes: []\n');
  write(
    'src/auth/.purpose',
    'version: "2.0"\ncomponents:\n  auth:\n    description: Auth module\n  login:\n    description: Login\n    gates: [^auth]\n',
  );
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function index() {
  return buildSymbolIndex(await aggregateFromDirectory(tmp));
}

describe('CLI ripple', () => {
  it('resolves a case variant to the canonical symbol', async () => {
    const { ripple } = analyzeRipple('#Login', await index());
    expect(ripple?.symbol).toBe('#login');
    expect(ripple?.requires).toContain('^auth');
  });

  it('returns candidates for an ambiguous bare name', async () => {
    const { ripple, candidates } = analyzeRipple('auth', await index());
    expect(ripple).toBeUndefined();
    expect([...candidates].sort()).toEqual(['#auth', '^auth']);
  });

  it("anchors a portal gate's test path on its .purpose source", async () => {
    const { ripple } = analyzeRipple('^auth', await index());
    expect(ripple?.path).toBe(tmp); // portal (the project-dir portal source) stays canonical
    expect(ripple?.testPath).toBe(`${path.join(tmp, 'src/auth')}/**/*.test.{ts,tsx}`);
  });
});
