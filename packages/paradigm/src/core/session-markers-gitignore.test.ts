import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ensureSessionMarkersGitignore, SESSION_MARKERS } from './session-markers-gitignore.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pdg-gi-')); dirs.push(d); return d; };

describe('ensureSessionMarkersGitignore', () => {
  it('creates .paradigm/.gitignore with every marker, idempotently', () => {
    const p = path.join(tmp(), '.paradigm');
    expect(ensureSessionMarkersGitignore(p)).toBe(true);
    const first = fs.readFileSync(path.join(p, '.gitignore'), 'utf8');
    for (const m of SESSION_MARKERS) expect(first).toContain(`/${m}\n`);
    expect(ensureSessionMarkersGitignore(p)).toBe(false);
    expect(fs.readFileSync(path.join(p, '.gitignore'), 'utf8')).toBe(first);
  });

  it('keeps user lines and replaces a stale managed block in place', () => {
    const p = path.join(tmp(), '.paradigm');
    fs.mkdirSync(p);
    fs.writeFileSync(path.join(p, '.gitignore'), 'mine.txt\n# >>> paradigm session markers (managed by paradigm init/sync) >>>\n/old\n# <<< paradigm session markers <<<\nalso-mine\n');
    ensureSessionMarkersGitignore(p);
    const s = fs.readFileSync(path.join(p, '.gitignore'), 'utf8');
    expect(s.startsWith('mine.txt\n')).toBe(true);
    expect(s.endsWith('also-mine\n')).toBe(true);
    expect(s).not.toContain('/old');
    expect(s).toContain('/.purpose-paths');
  });

  it('git actually ignores the markers but not real .paradigm content', () => {
    const root = tmp();
    execFileSync('git', ['init', '-q'], { cwd: root });
    const p = path.join(root, '.paradigm');
    ensureSessionMarkersGitignore(p);
    fs.writeFileSync(path.join(p, '.purpose-paths'), 'x');
    fs.writeFileSync(path.join(p, '.orchestrated'), 'x');
    fs.writeFileSync(path.join(p, '.purpose'), 'components: {}\n');
    fs.writeFileSync(path.join(p, 'config.yaml'), 'version: "1.0"\n');
    const untracked = execFileSync('git', ['ls-files', '-o', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
    expect(untracked).not.toContain('.purpose-paths');
    expect(untracked).not.toContain('.orchestrated');
    expect(untracked).toContain('.paradigm/.purpose');
    expect(untracked).toContain('.paradigm/config.yaml');
  });
});
