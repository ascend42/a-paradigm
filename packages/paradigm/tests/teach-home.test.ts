/**
 * Scoped learning S3: `paradigm teach --home <repo|user>` confirms or flips the
 * home of inferred human-taught repo notebook entries, so the commit guard
 * passes them (home_source: explicit). Idempotent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { confirmTeachHome } from '../src/commands/teach.js';
import { learningGuardViolations } from '../../paradigm-mcp/src/utils/learning-commit-guard.js';
import { resetLearningStoreCaches } from '../../paradigm-mcp/src/utils/learning-stores.js';

let root: string;
let home: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'teach-home-root-')));
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'teach-home-home-')));
  for (const k of ['HOME', 'USERPROFILE']) {
    saved[k] = process.env[k];
    process.env[k] = home;
  }
  resetLearningStoreCaches();
});
afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
  resetLearningStoreCaches();
});

function entry(agent: string, id: string, extra: Record<string, unknown>): string {
  const file = path.join(root, '.paradigm', 'notebooks', agent, `${id}.yaml`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump({ id, context: 'c', snippet: 's', concepts: [], tags: ['human-taught'], home: 'repo', ...extra }));
  return file;
}
const guard = (file: string) => learningGuardViolations([{ path: path.relative(root, file).split(path.sep).join('/'), content: fs.readFileSync(file, 'utf8') }]);

describe('paradigm teach --home', () => {
  it('--home repo confirms inferred human-taught entries; the guard then passes; idempotent', () => {
    const a = entry('security', 'nb-a', { home_source: 'inferred' });
    entry('security', 'nb-b', { home_source: 'explicit' });
    expect(guard(a).map(v => v.rule)).toEqual(['human-feedback-public']);
    const changes = confirmTeachHome(root, 'repo');
    expect(changes.map(c => c.id)).toEqual(['nb-a']);
    expect(yaml.load(fs.readFileSync(a, 'utf8'))).toMatchObject({ home: 'repo', home_source: 'explicit' });
    expect(guard(a)).toEqual([]);
    expect(confirmTeachHome(root, 'repo')).toEqual([]);
  });

  it('--home user moves the entry to the user notebooks, explicit', () => {
    const a = entry('kit', 'nb-x', { home_source: 'inferred' });
    const [c] = confirmTeachHome(root, 'user', ['nb-x']);
    expect(fs.existsSync(a)).toBe(false);
    expect(c.to).toBe(path.join(home, '.paradigm', 'notebooks', 'kit', 'nb-x.yaml'));
    expect(yaml.load(fs.readFileSync(c.to, 'utf8'))).toMatchObject({ home: 'user', home_source: 'explicit' });
  });
});
