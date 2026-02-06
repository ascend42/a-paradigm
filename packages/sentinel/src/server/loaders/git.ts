/**
 * Git integration for loading commit history
 */

import simpleGit, { type SimpleGit, type LogResult } from 'simple-git';
import * as path from 'path';

export interface CommitInfo {
  hash: string;
  shortHash: string;
  date: string;
  author: string;
  message: string;
  symbolsModified: string[];
  filesChanged: string[];
}

/**
 * Extract Paradigm symbols from changed file paths
 */
function extractSymbolsFromFiles(files: string[]): string[] {
  const symbols: Set<string> = new Set();

  for (const file of files) {
    // Check for .purpose files and extract directory-based symbol
    if (file.endsWith('.purpose')) {
      const dir = path.dirname(file);
      const name = path.basename(dir);
      // Infer symbol type from path
      if (dir.includes('features/') || dir.includes('routes/') || dir.includes('api/')) {
        symbols.add(`@${name}`);
      } else if (dir.includes('components/') || dir.includes('lib/') || dir.includes('utils/')) {
        symbols.add(`#${name}`);
      } else if (dir.includes('middleware/') || dir.includes('auth/') || dir.includes('guards/')) {
        symbols.add(`^${name}`);
      } else if (dir.includes('flows/') || dir.includes('workflows/')) {
        symbols.add(`$${name}`);
      }
    }

    // Check for portal.yaml changes
    if (file.includes('portal.yaml')) {
      symbols.add('^portal');
    }

    // Check for feature directories
    const featureMatch = file.match(/features\/([^/]+)/);
    if (featureMatch) {
      symbols.add(`@${featureMatch[1]}`);
    }

    // Check for component directories
    const componentMatch = file.match(/components\/([^/]+)/);
    if (componentMatch) {
      symbols.add(`#${componentMatch[1]}`);
    }
  }

  return Array.from(symbols);
}

/**
 * Load Git commit history for a project
 */
export async function loadGitHistory(
  projectDir: string,
  options: { limit?: number; since?: string } = {}
): Promise<CommitInfo[]> {
  const git: SimpleGit = simpleGit(projectDir);

  // Check if this is a git repository
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    return [];
  }

  try {
    const logOptions: Record<string, unknown> = {
      maxCount: options.limit || 100,
    };

    if (options.since) {
      logOptions['--since'] = options.since;
    }

    const log: LogResult = await git.log(logOptions);

    const commits: CommitInfo[] = [];

    for (const commit of log.all) {
      let filesChanged: string[] = [];
      let symbolsModified: string[] = [];

      try {
        // Get the diff for this commit to extract changed files
        const diff = await git.diffSummary([`${commit.hash}^`, commit.hash]);
        filesChanged = diff.files.map((f) => f.file);
        symbolsModified = extractSymbolsFromFiles(filesChanged);
      } catch {
        // First commit won't have a parent, skip diff
      }

      commits.push({
        hash: commit.hash,
        shortHash: commit.hash.slice(0, 7),
        date: commit.date,
        author: commit.author_name,
        message: commit.message.split('\n')[0], // First line only
        symbolsModified,
        filesChanged,
      });
    }

    return commits;
  } catch (error) {
    console.error('Failed to load git history:', error);
    return [];
  }
}

/**
 * Get symbols at a specific commit
 */
export async function getSymbolsAtCommit(
  projectDir: string,
  commitHash: string
): Promise<string[]> {
  const git: SimpleGit = simpleGit(projectDir);

  try {
    // Get all files at this commit
    const result = await git.raw(['ls-tree', '-r', '--name-only', commitHash]);
    const files = result.split('\n').filter(Boolean);

    // Filter for .purpose files and extract symbols
    const purposeFiles = files.filter((f) => f.endsWith('.purpose'));
    return extractSymbolsFromFiles(purposeFiles);
  } catch (error) {
    console.error('Failed to get symbols at commit:', error);
    return [];
  }
}
