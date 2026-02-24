/**
 * paradigm global — Manage Global Brain (~/.paradigm/)
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { log } from '../utils/logger.js';

interface CleanOptions {
  olderThan?: string; // "90d", "30d", etc.
  dryRun?: boolean;
}

/**
 * Parse a duration string like "90d", "30d", "7d" into milliseconds
 */
function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)(d|h|m)$/);
  if (!match) return null;
  const [, num, unit] = match;
  const value = parseInt(num, 10);
  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    default: return null;
  }
}

/**
 * Recursively find files older than a cutoff date
 */
function findOldFiles(dir: string, cutoffMs: number): Array<{ path: string; age: string }> {
  const results: Array<{ path: string; age: string }> = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findOldFiles(fullPath, cutoffMs));
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        const age = Date.now() - stat.mtimeMs;
        if (age > cutoffMs) {
          const days = Math.floor(age / (24 * 60 * 60 * 1000));
          results.push({ path: fullPath, age: `${days}d` });
        }
      } catch {
        // Skip files we can't stat
      }
    }
  }

  return results;
}

export async function globalCleanCommand(options: CleanOptions) {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
  const globalDir = path.join(homeDir, '.paradigm');
  const spinner = ora();

  if (!fs.existsSync(globalDir)) {
    console.log(chalk.yellow('\nNo ~/.paradigm/ directory found.\n'));
    return;
  }

  const durationStr = options.olderThan || '90d';
  const durationMs = parseDuration(durationStr);
  if (!durationMs) {
    console.log(chalk.red(`\nInvalid duration: ${durationStr}`));
    console.log(chalk.gray('Use format: 90d, 30d, 7d, 24h, etc.\n'));
    process.exit(1);
  }

  console.log(chalk.blue(`\nGlobal Brain Rotation\n`));
  console.log(chalk.gray(`  Scanning ~/.paradigm/ for files older than ${durationStr}...\n`));

  spinner.start('Scanning...');

  // Scan subdirectories that accumulate old data
  const cleanableDirs = ['wisdom', 'lore', 'history', 'cache'];
  const allOldFiles: Array<{ path: string; age: string }> = [];

  for (const sub of cleanableDirs) {
    const subDir = path.join(globalDir, sub);
    const oldFiles = findOldFiles(subDir, durationMs);
    allOldFiles.push(...oldFiles);
  }

  spinner.stop();

  if (allOldFiles.length === 0) {
    console.log(chalk.green(`  No files older than ${durationStr} found.\n`));
    return;
  }

  console.log(chalk.gray(`  Found ${allOldFiles.length} files older than ${durationStr}:\n`));

  for (const file of allOldFiles.slice(0, 20)) {
    const relPath = path.relative(globalDir, file.path);
    console.log(chalk.gray(`    ${file.age} old - ${relPath}`));
  }
  if (allOldFiles.length > 20) {
    console.log(chalk.gray(`    ... and ${allOldFiles.length - 20} more`));
  }

  if (options.dryRun) {
    console.log(chalk.yellow(`\n  Dry run - no files deleted.\n`));
    log.command('global-clean').info('Dry run completed', { count: allOldFiles.length, olderThan: durationStr });
    return;
  }

  // Delete the files
  spinner.start(`Deleting ${allOldFiles.length} files...`);
  let deleted = 0;
  for (const file of allOldFiles) {
    try {
      fs.unlinkSync(file.path);
      deleted++;
    } catch {
      // Skip files we can't delete
    }
  }
  spinner.succeed(`Deleted ${deleted} files older than ${durationStr}`);

  // Clean up empty directories
  for (const sub of cleanableDirs) {
    const subDir = path.join(globalDir, sub);
    cleanEmptyDirs(subDir);
  }

  console.log('');
  log.command('global-clean').success('Global brain rotation completed', { deleted, olderThan: durationStr });
}

/** Recursively remove empty directories */
function cleanEmptyDirs(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    if (fs.statSync(fullPath).isDirectory()) {
      cleanEmptyDirs(fullPath);
    }
  }
  // Re-check after cleaning children
  if (fs.readdirSync(dir).length === 0) {
    try { fs.rmdirSync(dir); } catch { /* ignore */ }
  }
}
