/**
 * paradigm learn routing --backfill (#learn-routing-command)
 *
 * Cold-start the routing store from git history. Counts only; see
 * core/routing-backfill.ts.
 */

import * as path from 'path';

import { out, success, kv, dim, header, warn } from '../utils/cli-output.js';
import { writeRoutingBackfill, ROUTING_FILE } from '../core/routing-backfill.js';

export async function learnRoutingCommand(options: {
  backfill?: boolean;
  project?: string;
} = {}): Promise<void> {
  if (!options.backfill) {
    warn('Nothing to do. Pass --backfill to build .paradigm/learned/routing.json from git history.');
    return;
  }
  const root = options.project ? path.resolve(options.project) : process.cwd();
  const { table } = writeRoutingBackfill(root);
  const areas = Object.entries(table.areas);

  header('Routing backfill');
  kv('Head', table.builtFrom.headSha ?? '(no commits)');
  kv('Window', `${table.windowDays} days`);
  kv('Areas', String(areas.length));
  const cv = table.coverage;
  kv('Commits', `${cv.commitsTotal} total, ${cv.commitsWithTrailer} with trailer, ${cv.commitsSkippedNoTrailer} skipped`);
  if (cv.purposeFilesSkipped > 0) warn(`${cv.purposeFilesSkipped} .purpose file(s) skipped (not regular, over 1 MiB, or unparsable); their symbols land in (unowned).`);
  kv('Written to', ROUTING_FILE);
  out('');
  if (areas.length === 0) {
    warn('No commits with a Symbols: trailer in the window; wrote an empty table.');
    return;
  }
  success('Areas by rework/revert:');
  for (const [id, a] of areas) {
    dim(`  ${id}: ${a.reworkOrRevert}/${a.commits} (fix ${a.byType.fix}, revert ${a.byType.revert})`);
  }
}
