/**
 * paradigm notices — list and acknowledge one-time migration notices.
 *
 * `paradigm notices` is read-only (core/command-policy.ts): it lists the
 * pending notices and writes nothing. `paradigm notices ack <id|all>` writes
 * the acknowledgement marker, so the notice stops printing.
 *
 * Symbol: #notices-command
 */

import { out, success, warn, error, dim, header, kv, json } from '../utils/cli-output.js';
import {
  MIGRATION_NOTICES,
  pendingNotices,
  findNotice,
  acknowledgeNotice,
  type MigrationNotice,
} from '../core/migration-notices.js';

export async function noticesListCommand(options: { json?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const pending = pendingNotices(cwd);
  if (options.json) {
    json(pending.map((n) => ({ id: n.id, summary: n.summary })));
    return;
  }
  if (pending.length === 0) {
    dim('No pending notices.');
    return;
  }
  header('PENDING NOTICES');
  for (const n of pending) kv(n.id, n.summary);
  out('');
  dim('Acknowledge with: paradigm notices ack <id>   (or: paradigm notices ack all)');
}

export async function noticesAckCommand(id: string, options: { json?: boolean }): Promise<void> {
  const cwd = process.cwd();
  let targets: MigrationNotice[];
  if (id === 'all') {
    targets = pendingNotices(cwd);
  } else {
    const notice = findNotice(id);
    if (!notice) {
      error(`Unknown notice "${id}". Known: ${MIGRATION_NOTICES.map((n) => n.id).join(', ')}`);
      process.exit(1);
    }
    targets = [notice];
  }

  const acked: string[] = [];
  for (const n of targets) {
    if (acknowledgeNotice(cwd, n)) acked.push(n.id);
  }
  const failed = targets.filter((n) => !acked.includes(n.id)).map((n) => n.id);

  if (options.json) {
    json({ acknowledged: acked, failed });
  } else if (targets.length === 0) {
    dim('No pending notices.');
  } else {
    for (const a of acked) success(`Acknowledged ${a}`);
    for (const f of failed) warn(`Could not acknowledge ${f} (no .paradigm/ directory here, or it is not writable)`);
  }
  if (failed.length > 0) process.exit(1);
}
