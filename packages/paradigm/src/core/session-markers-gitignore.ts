/**
 * #session-markers-gitignore — keeps per-session hook state out of git.
 *
 * The Claude Code / Cursor hooks drop marker files in `.paradigm/` (and the
 * Stop hook deletes them on a pass). Committed, they dirty the tree every
 * turn and leak one developer's session state to everyone. `paradigm init`
 * and `paradigm sync` call `ensureSessionMarkersGitignore` so every project
 * gets a managed block in `.paradigm/.gitignore`. It is idempotent: the block
 * is replaced in place and any user lines outside it are kept.
 */
import * as fs from 'fs';
import * as path from 'path';

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
  // hook self-monitoring (#hook-monitor): the timing ring + the once-per-session warning marker
  'events/hook-timings.jsonl',
  'events/stop-timing.jsonl',
  '.hook-health-warned',
]);

const BEGIN = '# >>> paradigm session markers (managed by paradigm init/sync) >>>';
const END = '# <<< paradigm session markers <<<';

export function sessionMarkersBlock(): string {
  return [BEGIN, ...SESSION_MARKERS.map((m) => `/${m}`), END].join('\n');
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
