/**
 * Test isolation for the Paradigm Brain: every test file starts with
 * PARADIGM_BRAIN_HOME pointing at an EMPTY temp dir, so no test (including the
 * tools-list budget test) can ever see the real ~/.paradigm/brains.
 * Tests that need a brain use makeSandbox(), which overrides it per sandbox.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll } from 'vitest';

const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-brain-home-'));
process.env.PARADIGM_BRAIN_HOME = isolated;

afterAll(() => {
  fs.rmSync(isolated, { recursive: true, force: true });
});
