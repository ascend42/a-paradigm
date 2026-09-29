/**
 * #brain-purge — "forget this folder". Removes the brain's storage directory.
 * Never touches the user's folder.
 *
 * Egress-log retention:
 *   - default: egress.log is ARCHIVED to <brains>/_archive/<id>-<timestamp>.egress.log
 *     before the brain is removed, and archives are kept indefinitely (the
 *     record of what left this computer outlives the brain).
 *   - forgetLog: egress.log is NOT archived, and every earlier archive for this
 *     brain id is deleted too — nothing about the brain remains on disk.
 *     Works even when the brain itself was already purged.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '../mcp-logger.js';
import { isInside } from './atomic.js';
import { brainDir, brainsHome, BRAIN_FILES, BrainConfigError, isRootHash } from './config.js';
import type { BrainOptions } from './types.js';

export interface PurgeOptions extends BrainOptions {
  /** Delete the egress log (and earlier archives of it) instead of archiving. */
  forgetLog?: boolean;
}

export interface PurgeResult {
  rootHash: string;
  removed: boolean;
  /** Absolute path of the archived egress log, when one was kept. */
  egressArchive: string | null;
  /** Number of archived egress logs deleted (forgetLog only). */
  archivesDeleted: number;
}

export const EGRESS_ARCHIVE_DIR = '_archive';

function archiveDirOf(home: string): string {
  return path.join(home, EGRESS_ARCHIVE_DIR);
}

/** Delete every archived egress log for this brain id. */
function forgetArchives(rootHash: string, home: string): number {
  const dir = archiveDirOf(home);
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  let n = 0;
  for (const name of names) {
    if (!name.startsWith(`${rootHash}-`) || !name.endsWith('.egress.log')) continue;
    const abs = path.join(dir, name);
    if (!isInside(abs, dir)) continue;
    try {
      if (fs.lstatSync(abs).isFile() || fs.lstatSync(abs).isSymbolicLink()) { fs.unlinkSync(abs); n++; }
    } catch { /* best effort */ }
  }
  return n;
}

export function purgeBrain(rootHash: string, opts?: PurgeOptions): PurgeResult {
  if (!isRootHash(rootHash)) throw new BrainConfigError('invalid brain id');
  const home = brainsHome(opts);
  const dir = brainDir(rootHash, opts);
  if (!isInside(dir, home) || dir === home) throw new BrainConfigError('refusing to purge outside brain storage');
  const forgetLog = opts?.forgetLog === true;
  const archivesDeleted = forgetLog ? forgetArchives(rootHash, home) : 0;
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return { rootHash, removed: false, egressArchive: null, archivesDeleted };
  }
  if (st.isSymbolicLink()) {
    fs.unlinkSync(dir);
    return { rootHash, removed: true, egressArchive: null, archivesDeleted };
  }
  let egressArchive: string | null = null;
  const egress = path.join(dir, BRAIN_FILES.egress);
  if (!forgetLog && fs.existsSync(egress)) {
    const archiveDir = archiveDirOf(home);
    fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    egressArchive = path.join(archiveDir, `${rootHash}-${new Date().toISOString().replace(/[:.]/g, '-')}.egress.log`);
    fs.copyFileSync(egress, egressArchive);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  log.component('#brain-purge').info('Brain purged', { rootHash, archived: egressArchive !== null, forgetLog, archivesDeleted });
  return { rootHash, removed: true, egressArchive, archivesDeleted };
}
