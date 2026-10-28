/**
 * Scoped learning test isolation: per-repo user and machine learning stores
 * resolve under PARADIGM_LEARNING_HOME (an empty temp dir per test file), so no
 * test writes into the real ~/.paradigm/projects.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll } from 'vitest';

const learningHome = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-learning-home-'));
process.env.PARADIGM_LEARNING_HOME = learningHome;

afterAll(() => {
  fs.rmSync(learningHome, { recursive: true, force: true });
});
