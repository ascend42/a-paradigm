/**
 * paradigm drift check — Aspect anchor drift detection with cascading auto-heal
 *
 * Reads .paradigm/aspect-graph.db directly and checks if code at anchor
 * locations has changed. When anchors have merely shifted (code inserted/removed
 * above them), auto-heals by updating line numbers in both the DB and .purpose files.
 *
 * Cascading heal: when any anchor in a file shifts, all other anchors below
 * it in the same file get the same offset applied.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import chalk from 'chalk';

interface AnchorRow {
  id: number;
  aspect_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  content_hash: string | null;
  normalized_hash: string | null;
  materialized_at_commit: string | null;
  drifted: number;
}

interface DriftDetail {
  aspectId: string;
  path: string;
  startLine: number;
  endLine: number;
  status: 'clean' | 'cosmetic' | 'shifted' | 'modified' | 'missing';
  autoHealed?: boolean;
}

interface DriftCheckResult {
  driftedCount: number;
  healedCount: number;
  cleanCount: number;
  missingCount: number;
  details: DriftDetail[];
}

/**
 * Normalize content for hash comparison — strips cosmetic differences.
 */
function normalizeForHash(content: string): string {
  return content
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim().length > 0)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse unified diff hunks from git diff output.
 */
function parseHunks(diff: string): Array<{ oldStart: number; oldCount: number; newCount: number }> {
  const hunks: Array<{ oldStart: number; oldCount: number; newCount: number }> = [];
  const pattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(diff)) !== null) {
    hunks.push({
      oldStart: parseInt(match[1], 10),
      oldCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
      newCount: match[4] !== undefined ? parseInt(match[4], 10) : 1,
    });
  }
  return hunks;
}

/**
 * Compute line shift for an anchor based on git diff hunks.
 * Returns null if a hunk overlaps the anchor (content was modified).
 */
function computeShift(
  rootDir: string,
  filePath: string,
  fromCommit: string,
  startLine: number,
  endLine: number,
): { newStart: number; newEnd: number } | null {
  let diff: string;
  try {
    diff = execSync(
      `git diff ${fromCommit}..HEAD --unified=0 -- "${filePath}"`,
      { cwd: rootDir, encoding: 'utf8', timeout: 5000 }
    );
  } catch {
    return null;
  }

  if (!diff.trim()) {
    return null; // No changes
  }

  const hunks = parseHunks(diff);
  let offset = 0;

  for (const hunk of hunks) {
    const hunkEnd = hunk.oldStart + hunk.oldCount;

    if (hunkEnd <= startLine) {
      offset += (hunk.newCount - hunk.oldCount);
      continue;
    }

    if (hunk.oldStart < endLine) {
      return null; // Overlaps anchor
    }

    break;
  }

  if (offset === 0) return null;

  return { newStart: startLine + offset, newEnd: endLine + offset };
}

/**
 * Update anchor line numbers in a .purpose file.
 */
function healPurposeFile(
  rootDir: string,
  purposePath: string,
  anchorFile: string,
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
): boolean {
  const absPath = path.isAbsolute(purposePath) ? purposePath : path.join(rootDir, purposePath);
  if (!fs.existsSync(absPath)) return false;

  try {
    const content = fs.readFileSync(absPath, 'utf8');
    const oldRef = oldStart === oldEnd
      ? `${anchorFile}:${oldStart}`
      : `${anchorFile}:${oldStart}-${oldEnd}`;
    const newRef = newStart === newEnd
      ? `${anchorFile}:${newStart}`
      : `${anchorFile}:${newStart}-${newEnd}`;

    if (!content.includes(oldRef)) return false;
    fs.writeFileSync(absPath, content.replace(oldRef, newRef), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export async function driftCheckCommand(options: {
  json?: boolean;
  autoHeal?: boolean;
}): Promise<void> {
  const rootDir = process.cwd();
  const dbPath = path.join(rootDir, '.paradigm', 'aspect-graph.db');

  if (!fs.existsSync(dbPath)) {
    if (options.json) {
      console.log(JSON.stringify({ driftedCount: 0, healedCount: 0, cleanCount: 0, missingCount: 0, details: [] }));
    } else {
      console.log(chalk.gray('No aspect-graph.db found. Run paradigm_aspect_check to initialize.'));
    }
    return;
  }

  const autoHeal = options.autoHeal !== false;

  try {
    // Dynamic import sql.js — it's an optional dependency
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    const results: DriftDetail[] = [];

    try {
      // Query all anchors
      const stmt = db.prepare('SELECT id, aspect_id, file_path, start_line, end_line, content_hash, normalized_hash, materialized_at_commit, drifted FROM anchors');
      const anchors: AnchorRow[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as unknown as AnchorRow;
        anchors.push(row);
      }
      stmt.free();

      for (const anchor of anchors) {
        const absFile = path.isAbsolute(anchor.file_path)
          ? anchor.file_path
          : path.join(rootDir, anchor.file_path);

        if (!fs.existsSync(absFile)) {
          results.push({
            aspectId: anchor.aspect_id,
            path: anchor.file_path,
            startLine: anchor.start_line,
            endLine: anchor.end_line,
            status: 'missing',
          });
          continue;
        }

        const fileContent = fs.readFileSync(absFile, 'utf8');
        const lines = fileContent.split('\n');
        const startIdx = Math.max(0, anchor.start_line - 1);
        const endIdx = Math.min(lines.length, anchor.end_line);
        const slice = lines.slice(startIdx, endIdx).join('\n');
        const exactHash = crypto.createHash('sha256').update(slice).digest('hex');

        // Layer 1a: Exact hash match
        if (anchor.content_hash != null && exactHash === anchor.content_hash) {
          if (anchor.drifted === 1) {
            db.run('UPDATE anchors SET drifted = 0 WHERE id = ?', [anchor.id]);
          }
          results.push({
            aspectId: anchor.aspect_id,
            path: anchor.file_path,
            startLine: anchor.start_line,
            endLine: anchor.end_line,
            status: 'clean',
          });
          continue;
        }

        // Layer 1b: Normalized hash match
        const normHash = crypto.createHash('sha256').update(normalizeForHash(slice)).digest('hex');
        if (anchor.normalized_hash != null && normHash === anchor.normalized_hash) {
          db.run('UPDATE anchors SET content_hash = ?, drifted = 0 WHERE id = ?', [exactHash, anchor.id]);
          results.push({
            aspectId: anchor.aspect_id,
            path: anchor.file_path,
            startLine: anchor.start_line,
            endLine: anchor.end_line,
            status: 'cosmetic',
          });
          continue;
        }

        // No hash stored yet
        if (anchor.content_hash == null && anchor.normalized_hash == null) {
          db.run('UPDATE anchors SET content_hash = ?, normalized_hash = ?, drifted = 0 WHERE id = ?',
            [exactHash, normHash, anchor.id]);
          results.push({
            aspectId: anchor.aspect_id,
            path: anchor.file_path,
            startLine: anchor.start_line,
            endLine: anchor.end_line,
            status: 'clean',
          });
          continue;
        }

        // Layer 2: Git-aware line mapping
        let resolved = false;
        if (anchor.materialized_at_commit) {
          const shift = computeShift(rootDir, anchor.file_path, anchor.materialized_at_commit, anchor.start_line, anchor.end_line);
          if (shift) {
            const shiftedSlice = lines.slice(Math.max(0, shift.newStart - 1), Math.min(lines.length, shift.newEnd)).join('\n');
            const shiftedHash = crypto.createHash('sha256').update(shiftedSlice).digest('hex');

            if ((anchor.content_hash != null && shiftedHash === anchor.content_hash) ||
                (anchor.normalized_hash != null && crypto.createHash('sha256').update(normalizeForHash(shiftedSlice)).digest('hex') === anchor.normalized_hash)) {
              // Shifted — auto-heal
              if (autoHeal) {
                const newHash = crypto.createHash('sha256').update(shiftedSlice).digest('hex');
                db.run('UPDATE anchors SET start_line = ?, end_line = ?, content_hash = ?, drifted = 0 WHERE id = ?',
                  [shift.newStart, shift.newEnd, newHash, anchor.id]);

                // Heal .purpose file
                const aspectStmt = db.prepare('SELECT defined_in FROM aspects WHERE id = ?');
                aspectStmt.bind([anchor.aspect_id]);
                if (aspectStmt.step()) {
                  const aspectRow = aspectStmt.getAsObject() as { defined_in: string };
                  healPurposeFile(rootDir, aspectRow.defined_in, anchor.file_path,
                    anchor.start_line, anchor.end_line, shift.newStart, shift.newEnd);
                }
                aspectStmt.free();
              }

              results.push({
                aspectId: anchor.aspect_id,
                path: anchor.file_path,
                startLine: autoHeal ? shift.newStart : anchor.start_line,
                endLine: autoHeal ? shift.newEnd : anchor.end_line,
                status: 'shifted',
                autoHealed: autoHeal,
              });
              resolved = true;
            }
          }
        }

        if (!resolved) {
          db.run('UPDATE anchors SET drifted = 1 WHERE id = ?', [anchor.id]);
          results.push({
            aspectId: anchor.aspect_id,
            path: anchor.file_path,
            startLine: anchor.start_line,
            endLine: anchor.end_line,
            status: 'modified',
          });
        }
      }

      // Save DB changes
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));

    } finally {
      db.close();
    }

    const summary: DriftCheckResult = {
      driftedCount: results.filter(r => r.status === 'modified').length,
      healedCount: results.filter(r => r.status === 'shifted' && r.autoHealed).length,
      cleanCount: results.filter(r => r.status === 'clean' || r.status === 'cosmetic').length,
      missingCount: results.filter(r => r.status === 'missing').length,
      details: results,
    };

    if (options.json) {
      console.log(JSON.stringify(summary));
    } else {
      console.log(chalk.blue('\nAspect Drift Check\n'));

      if (summary.healedCount > 0) {
        console.log(chalk.green(`  Auto-healed: ${summary.healedCount} shifted anchor(s)`));
      }
      if (summary.cleanCount > 0) {
        console.log(chalk.green(`  Clean: ${summary.cleanCount} anchor(s)`));
      }
      if (summary.driftedCount > 0) {
        console.log(chalk.red(`  Drifted: ${summary.driftedCount} anchor(s) (content changed)`));
        for (const d of results.filter(d => d.status === 'modified')) {
          console.log(chalk.red(`    ${d.aspectId}: ${d.path}:${d.startLine}-${d.endLine}`));
        }
      }
      if (summary.missingCount > 0) {
        console.log(chalk.yellow(`  Missing: ${summary.missingCount} anchor file(s) deleted`));
      }

      if (summary.driftedCount === 0 && summary.missingCount === 0) {
        console.log(chalk.green('\n  All anchors are clean.\n'));
      } else {
        console.log(chalk.gray('\n  Run paradigm_aspect_check to review and fix.\n'));
      }
    }
  } catch (err) {
    if (options.json) {
      console.log(JSON.stringify({ driftedCount: 0, healedCount: 0, cleanCount: 0, missingCount: 0, details: [], error: String(err) }));
    } else {
      console.log(chalk.red(`Drift check failed: ${err}`));
    }
  }
}
