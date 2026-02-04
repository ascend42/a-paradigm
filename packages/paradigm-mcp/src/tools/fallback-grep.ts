/**
 * Fallback Grep - Search for symbol references when index is unavailable
 *
 * Provides graceful degradation for paradigm_ripple when symbols aren't indexed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface FallbackReference {
  filePath: string;
  line: number;
  content: string;
  context: 'purpose' | 'code' | 'comment' | 'unknown';
}

/**
 * Grep for symbol references in the project
 *
 * Returns a list of files and lines where the symbol appears
 */
export function grepForReferences(
  rootDir: string,
  symbol: string,
  options: { maxResults?: number } = {}
): FallbackReference[] {
  const { maxResults = 20 } = options;
  const results: FallbackReference[] = [];

  // Escape special regex chars but preserve the symbol prefix
  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Try using ripgrep first (faster), fall back to grep
  const grepCommands = [
    // ripgrep - exclude common directories
    `rg -n --no-heading "${escapedSymbol}" "${rootDir}" --glob "!node_modules" --glob "!.git" --glob "!dist" --glob "!build" --glob "!coverage" --max-count 50 2>/dev/null`,
    // fallback to grep
    `grep -rn "${escapedSymbol}" "${rootDir}" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage 2>/dev/null | head -50`,
  ];

  let output = '';
  for (const cmd of grepCommands) {
    try {
      output = execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      if (output.trim()) break;
    } catch {
      // grep returns non-zero if no matches, that's fine
      continue;
    }
  }

  if (!output.trim()) {
    return results;
  }

  // Parse grep/ripgrep output: filepath:line:content
  const lines = output.trim().split('\n');
  for (const line of lines.slice(0, maxResults)) {
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (match) {
      const [, filePath, lineNum, content] = match;
      const relativePath = path.relative(rootDir, filePath);

      // Determine context type
      let context: FallbackReference['context'] = 'unknown';
      if (relativePath.includes('.purpose') || relativePath.includes('portal.yaml')) {
        context = 'purpose';
      } else if (content.includes('//') || content.includes('#') || content.includes('*')) {
        context = 'comment';
      } else {
        context = 'code';
      }

      results.push({
        filePath: relativePath,
        line: parseInt(lineNum, 10),
        content: content.trim().slice(0, 200),
        context,
      });
    }
  }

  return results;
}

/**
 * Analyze grep results to provide impact estimation
 */
export function analyzeGrepResults(
  references: FallbackReference[]
): {
  filesAffected: string[];
  contextBreakdown: Record<string, number>;
  estimatedImpact: 'low' | 'medium' | 'high' | 'unknown';
} {
  const filesAffected = [...new Set(references.map((r) => r.filePath))];
  const contextBreakdown: Record<string, number> = {};

  for (const ref of references) {
    contextBreakdown[ref.context] = (contextBreakdown[ref.context] || 0) + 1;
  }

  // Estimate impact based on number of files and reference types
  let estimatedImpact: 'low' | 'medium' | 'high' | 'unknown' = 'unknown';
  if (references.length === 0) {
    estimatedImpact = 'unknown';
  } else if (filesAffected.length > 10 || references.length > 20) {
    estimatedImpact = 'high';
  } else if (filesAffected.length > 3 || references.length > 5) {
    estimatedImpact = 'medium';
  } else {
    estimatedImpact = 'low';
  }

  return {
    filesAffected,
    contextBreakdown,
    estimatedImpact,
  };
}
