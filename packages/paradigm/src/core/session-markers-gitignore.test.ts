import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ensureSessionMarkersGitignore, SESSION_MARKERS, untrackGeneratedState } from './session-markers-gitignore.js';

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

  it('untrackGeneratedState: git rm --cached on generated state only, safe to run again', () => {
    const root = tmp();
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    const p = path.join(root, '.paradigm');
    const files: Record<string, string> = {
      'scan-index.json': '{}', 'navigator.yaml': 'a: 1', 'flow-index.json': '{}',
      'events/team-funnel.jsonl': '{}', 'events/compliance-history.jsonl': '{}',
      'events/postflight-liveness.jsonl': '{}', 'events/settlement-liveness.jsonl': '{}',
      'lore/timeline.yaml': 'v: 1', 'protocols/index.yaml': 'v: 1',
      // authored: stays tracked
      'config.yaml': 'v: 1', 'lore/entries/2026-10-28/L-1.lore': 'x', 'docs/.index.yaml': 'x',
      'decisions/D-1.yaml': 'x', 'protocols/P-x.protocol': 'x', 'events/sub/nested.jsonl': '{}',
      // learning records and shared history: stay tracked
      'events/verdicts.jsonl': '{}', 'events/overrides.jsonl': '{}', 'events/debates.jsonl': '{}',
      'events/nominations.jsonl': '{}', 'events/promotion-decisions.jsonl': '{}',
      'events/provisional-mined.jsonl': '{}', 'events/stream.jsonl': '{}', 'events/.last-processed': '1',
      'history/log.jsonl': '{}', 'history/index.yaml': 'v: 1',
    };
    for (const [f, c] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(p, f)), { recursive: true });
      fs.writeFileSync(path.join(p, f), c);
    }
    git('add', '-A');
    git('commit', '-qm', 'init');
    ensureSessionMarkersGitignore(p);
    const first = untrackGeneratedState(root).sort();
    expect(first).toEqual([
      '.paradigm/events/compliance-history.jsonl', '.paradigm/events/postflight-liveness.jsonl',
      '.paradigm/events/settlement-liveness.jsonl', '.paradigm/events/team-funnel.jsonl', '.paradigm/flow-index.json',
      '.paradigm/lore/timeline.yaml', '.paradigm/navigator.yaml',
      '.paradigm/protocols/index.yaml', '.paradigm/scan-index.json',
    ]);
    for (const f of first) expect(fs.existsSync(path.join(root, f))).toBe(true); // kept on disk
    const tracked = git('ls-files', '.paradigm');
    for (const f of ['config.yaml', 'lore/entries/2026-10-28/L-1.lore', 'docs/.index.yaml', 'decisions/D-1.yaml', 'protocols/P-x.protocol', 'events/sub/nested.jsonl',
      'events/verdicts.jsonl', 'events/overrides.jsonl', 'events/debates.jsonl', 'events/nominations.jsonl', 'events/promotion-decisions.jsonl',
      'events/provisional-mined.jsonl', 'events/stream.jsonl', 'events/.last-processed', 'history/log.jsonl', 'history/index.yaml']) {
      expect(tracked).toContain(`.paradigm/${f}`);
    }
    // second run: nothing left, nothing re-added, ignored files stay untracked
    expect(untrackGeneratedState(root)).toEqual([]);
    git('add', '-A');
    expect(git('ls-files', '.paradigm/scan-index.json')).toBe('');
    expect(git('ls-files', '.paradigm/events/team-funnel.jsonl')).toBe('');
    // the hook-timings trim temp file is ignored too
    fs.writeFileSync(path.join(p, 'events', 'hook-timings.jsonl.tmp.123'), 'x');
    expect(git('status', '--porcelain', '--', '.paradigm/events')).not.toContain('hook-timings');
    // outside a git repository: a no-op
    expect(untrackGeneratedState(tmp())).toEqual([]);
  });
});
