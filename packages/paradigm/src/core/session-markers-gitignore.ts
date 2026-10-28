/**
 * #session-markers-gitignore — keeps per-session hook state and generated
 * indexes out of git.
 *
 * The Claude Code / Cursor hooks drop marker files in `.paradigm/` (and the
 * Stop hook deletes them on a pass). Committed, they dirty the tree every
 * turn and leak one developer's session state to everyone. The generated
 * indexes and append-only event logs are rewritten on every rebuild or hook
 * run (most carry a generatedAt stamp), so committing them made every commit
 * carry a diff. `paradigm init` and `paradigm sync` call
 * `ensureSessionMarkersGitignore` so every project gets a managed block in
 * `.paradigm/.gitignore`. It is idempotent: the block is replaced in place and
 * any user lines outside it are kept. `paradigm sync` then calls
 * `untrackGeneratedState`, which removes already-committed generated files
 * from the git index (`git rm --cached`, the working copies stay); a second
 * run finds nothing left to untrack.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

/** Hook-written session markers (paths relative to `.paradigm/`). */
export const SESSION_MARKERS: readonly string[] = Object.freeze([
  '.purpose-paths',
  '.orchestrated',
  '.pending-review',
  '.habits-blocking',
  '.session-started',
  '.solo-declared',
  '.stop-hook-active',
  '.stop-block-fingerprint',
  '.team-prompted',
  '.team-reminded',
  '.team-bypass-recorded',
  '.nav-called',
  '.nav-reminded',
  '.cid-briefed',
  '.cid-session',
  '.graduation-failures/',
  '.memory-last-review',
  // per-session hook state: Write/Edit ledger, delegation credit, last blocked set, reminders
  '.sessions/',
  // hook self-monitoring (#hook-monitor): the timing ring + the once-per-session warning marker
  'events/hook-timings.jsonl',
  'events/stop-timing.jsonl',
  '.hook-health-warned',
]);

/**
 * Generated state (paths relative to `.paradigm/`): rebuilt from sources by
 * `paradigm index`, the MCP server (paradigm_reindex, the live index) or the
 * hooks. Authored content stays committed: config.yaml, decisions/,
 * lore/entries/, specs/, docs/ (including the hand-written docs .index.yaml
 * files), roster, habits, protocol and university sources.
 * Every `<dir>/index.yaml` listed here has a rebuild function and a `generated`
 * stamp: protocols (rebuildProtocolIndex), personas (rebuildPersonaIndex),
 * curriculum + scenarios (rebuildSyllabusIndex / rebuildScenarioIndex),
 * university (rebuildUniversityIndex); lore/timeline.yaml is rebuilt from
 * lore/entries/ on every lore write (rebuildTimeline).
 */
export const GENERATED_STATE: readonly string[] = Object.freeze([
  'scan-index.json',
  'flow-index.json',
  'navigator.yaml',
  'manifest.consistency.json',
  'session-breadcrumbs.prev.json',
  'events/*.jsonl',
  'events/.last-processed',
  'history/',
  'lore/timeline.yaml',
  'protocols/index.yaml',
  'personas/index.yaml',
  'curriculum/index.yaml',
  'curriculum/scenarios/index.yaml',
  'university/index.yaml',
]);

const BEGIN = '# >>> paradigm session markers (managed by paradigm init/sync) >>>';
const END = '# <<< paradigm session markers <<<';

export function sessionMarkersBlock(): string {
  return [
    BEGIN,
    ...SESSION_MARKERS.map((m) => `/${m}`),
    '# generated state: rebuilt by `paradigm index` / the MCP server, never committed',
    ...GENERATED_STATE.map((m) => `/${m}`),
    END,
  ].join('\n');
}

/**
 * Write or refresh the managed block in `<paradigmDir>/.gitignore`.
 * Returns true when the file changed.
 */
export function ensureSessionMarkersGitignore(paradigmDir: string): boolean {
  const file = path.join(paradigmDir, '.gitignore');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const block = sessionMarkersBlock();
  let after: string;
  const b = before.indexOf(BEGIN);
  const e = before.indexOf(END);
  if (b !== -1 && e > b) {
    after = before.slice(0, b) + block + before.slice(e + END.length);
  } else {
    after = (before && !before.endsWith('\n') ? before + '\n' : before) + (before ? '\n' : '') + block + '\n';
  }
  if (after === before) return false;
  fs.mkdirSync(paradigmDir, { recursive: true });
  fs.writeFileSync(file, after, 'utf8');
  return true;
}

/** True when `rel` (relative to `.paradigm/`, forward slashes) is generated state. */
export function isGeneratedState(rel: string): boolean {
  for (const pattern of GENERATED_STATE) {
    if (pattern.endsWith('/')) {
      if (rel.startsWith(pattern)) return true;
    } else if (pattern.includes('*')) {
      const [dir, ext] = pattern.split('*');
      if (rel.startsWith(dir) && rel.endsWith(ext) && !rel.slice(dir.length).includes('/')) return true;
    } else if (rel === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Untrack generated state already committed under `<rootDir>/.paradigm/`:
 * `git rm --cached` on every tracked file `isGeneratedState` matches. The
 * files stay on disk. Safe to run any number of times: once untracked (and
 * ignored by the managed block) nothing matches. No shell is involved (git
 * runs through execFileSync). Returns the untracked paths, relative to
 * rootDir; [] outside a git repository.
 */
export function untrackGeneratedState(rootDir: string): string[] {
  let tracked: string;
  try {
    tracked = execFileSync('git', ['ls-files', '-z', '--', '.paradigm'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  const files = tracked
    .split('\0')
    .filter((f) => f.startsWith('.paradigm/') && isGeneratedState(f.slice('.paradigm/'.length)));
  for (let i = 0; i < files.length; i += 200) {
    execFileSync('git', ['rm', '--cached', '--quiet', '--', ...files.slice(i, i + 200)], {
      cwd: rootDir,
      stdio: 'ignore',
    });
  }
  return files;
}
