/**
 * Aspect Fingerprint — #aspect-fingerprint
 *
 * Phase 3 of Smart Drift Detection: content fingerprint search.
 * When Layers 1-2 fail, this uses fuzzy matching + Levenshtein distance
 * to relocate drifted code within the same file or across sibling files.
 *
 * Scoring signals (4 weights):
 *   - First/last line exact match: 0.4
 *   - Structural hash match:       0.3
 *   - Levenshtein similarity ≥0.8: 0.2
 *   - Line count within ±20%:      0.1
 *
 * Thresholds:
 *   ≥ 0.85: Auto-relocate
 *   0.7-0.85: Suggest relocation
 *   < 0.7: Real drift
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ContentFingerprint {
  firstLine: string;
  lastLine: string;
  lineCount: number;
  structuralHash: string;
}

export interface SlidingWindowResult {
  windowStart: number; // 1-indexed line number
  windowEnd: number;
  similarity: number;  // Levenshtein similarity 0.0-1.0
  score: number;       // Composite score 0.0-1.0
}

export interface ContentSearchResult {
  found: boolean;
  score: number;
  suggestedStart?: number;
  suggestedEnd?: number;
  suggestedPath?: string;  // Only for cross-file matches
  similarity?: number;
}

// ═══════════════════════════════════════════════════════════════════
// FINGERPRINT GENERATION
// ═══════════════════════════════════════════════════════════════════

/** Structural tokens — function/class/control flow signatures */
const STRUCTURAL_TOKENS = /^\s*(function |class |if |else |for |while |switch |case |return |export |import |const |let |var |async |await |try |catch |throw |struct |enum |protocol |guard |def |fn )/;

/**
 * Generate a content fingerprint for an anchor's original code.
 */
export function generateFingerprint(content: string): ContentFingerprint {
  const lines = content.split('\n').filter(l => l.trim() !== '');
  return {
    firstLine: normalizeLine(lines[0] || ''),
    lastLine: normalizeLine(lines[lines.length - 1] || ''),
    lineCount: lines.length,
    structuralHash: extractStructuralHash(lines),
  };
}

/**
 * Extract a structural hash — captures the control flow pattern
 * without being sensitive to variable names or comments.
 */
function extractStructuralHash(lines: string[]): string {
  const structural = lines
    .map(l => l.trim())
    .filter(l => STRUCTURAL_TOKENS.test(l))
    .map(l => {
      const match = l.match(STRUCTURAL_TOKENS);
      return match ? match[1].trim() : '';
    })
    .join('|');

  return crypto.createHash('sha256').update(structural).digest('hex').slice(0, 16);
}

/**
 * Normalize a line for comparison: trim, collapse whitespace, lowercase.
 */
function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════
// LEVENSHTEIN DISTANCE
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute Levenshtein edit distance between two strings.
 * Uses a row-based DP approach with early termination for large inputs.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Optimization: work with the shorter string as columns
  if (a.length > b.length) [a, b] = [b, a];

  const aLen = a.length;
  const bLen = b.length;

  // Cap for very large strings
  if (aLen > 5000 || bLen > 5000) {
    return Math.abs(aLen - bLen); // Approximate for huge inputs
  }

  let prev = new Array(aLen + 1);
  let curr = new Array(aLen + 1);

  for (let i = 0; i <= aLen; i++) prev[i] = i;

  for (let j = 1; j <= bLen; j++) {
    curr[0] = j;
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,     // deletion
        curr[i - 1] + 1, // insertion
        prev[i - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[aLen];
}

/**
 * Compute Levenshtein similarity as a 0.0-1.0 ratio.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  const distance = levenshteinDistance(a, b);
  return 1.0 - distance / maxLen;
}

// ═══════════════════════════════════════════════════════════════════
// SLIDING WINDOW SEARCH
// ═══════════════════════════════════════════════════════════════════

/** Scoring weights */
const W_FIRST_LAST = 0.4;
const W_STRUCTURAL = 0.3;
const W_LEVENSHTEIN = 0.2;
const W_LINE_COUNT = 0.1;

/**
 * Search a file for the best matching window using the fingerprint.
 * Returns sorted results (best first).
 */
export function slidingWindowSearch(
  fileLines: string[],
  fingerprint: ContentFingerprint,
  originalContent: string,
  maxResults: number = 3
): SlidingWindowResult[] {
  const { lineCount } = fingerprint;
  // Window sizes: original ±20%
  const minWindow = Math.max(1, Math.floor(lineCount * 0.8));
  const maxWindow = Math.ceil(lineCount * 1.2);

  const results: SlidingWindowResult[] = [];
  const normalizedOriginal = normalizeBlock(originalContent);

  // Scan with primary window size first (exact match), then ±20%
  for (const windowSize of [lineCount, minWindow, maxWindow]) {
    if (windowSize > fileLines.length) continue;

    for (let start = 0; start <= fileLines.length - windowSize; start++) {
      const windowLines = fileLines.slice(start, start + windowSize);
      const score = scoreWindow(windowLines, fingerprint, normalizedOriginal);

      if (score >= 0.5) { // Only consider reasonable matches
        const windowContent = windowLines.join('\n');
        results.push({
          windowStart: start + 1, // 1-indexed
          windowEnd: start + windowSize,
          similarity: levenshteinSimilarity(normalizeBlock(windowContent), normalizedOriginal),
          score,
        });
      }
    }
  }

  // Deduplicate overlapping windows — keep highest score per start line
  const byStart = new Map<number, SlidingWindowResult>();
  for (const r of results) {
    const existing = byStart.get(r.windowStart);
    if (!existing || r.score > existing.score) {
      byStart.set(r.windowStart, r);
    }
  }

  return Array.from(byStart.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Score a candidate window against the fingerprint.
 */
function scoreWindow(
  windowLines: string[],
  fingerprint: ContentFingerprint,
  normalizedOriginal: string,
): number {
  const nonEmpty = windowLines.filter(l => l.trim() !== '');
  if (nonEmpty.length === 0) return 0;

  let score = 0;

  // Signal 1: First/last line match (0.4)
  const firstLine = normalizeLine(nonEmpty[0]);
  const lastLine = normalizeLine(nonEmpty[nonEmpty.length - 1]);
  let firstLastScore = 0;
  if (firstLine === fingerprint.firstLine) firstLastScore += 0.5;
  if (lastLine === fingerprint.lastLine) firstLastScore += 0.5;
  score += firstLastScore * W_FIRST_LAST;

  // Signal 2: Structural hash match (0.3)
  const windowStructural = extractStructuralHash(nonEmpty);
  if (windowStructural === fingerprint.structuralHash) {
    score += W_STRUCTURAL;
  }

  // Signal 3: Levenshtein similarity (0.2, only if ≥0.8)
  const windowContent = nonEmpty.join('\n');
  const similarity = levenshteinSimilarity(normalizeBlock(windowContent), normalizedOriginal);
  if (similarity >= 0.8) {
    // Scale: 0.8→0, 1.0→1.0
    score += ((similarity - 0.8) / 0.2) * W_LEVENSHTEIN;
  }

  // Signal 4: Line count within ±20% (0.1)
  const countRatio = nonEmpty.length / fingerprint.lineCount;
  if (countRatio >= 0.8 && countRatio <= 1.2) {
    // Closer to 1.0 = higher score
    const countScore = 1.0 - Math.abs(1.0 - countRatio) / 0.2;
    score += countScore * W_LINE_COUNT;
  }

  return score;
}

/**
 * Normalize a block of content for comparison: trim lines, remove blanks, collapse whitespace.
 */
function normalizeBlock(content: string): string {
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '')
    .join('\n');
}

// ═══════════════════════════════════════════════════════════════════
// CROSS-FILE SEARCH
// ═══════════════════════════════════════════════════════════════════

/**
 * Detect if a file was renamed using git log --follow.
 */
export function detectFileRename(rootDir: string, oldPath: string): string | null {
  try {
    const result = execSync(
      `git log --follow --diff-filter=R --name-status --format="" -- "${oldPath}"`,
      { cwd: rootDir, encoding: 'utf8', timeout: 5000 }
    ).trim();

    if (!result) return null;

    // Parse rename entries: "R100\told/path\tnew/path"
    const lines = result.split('\n');
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 3 && parts[0].startsWith('R')) {
        return parts[2]; // new path
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Search sibling files in the same directory for a fingerprint match.
 * Returns matches sorted by score (best first), limited to maxFiles.
 */
export function searchSiblingFiles(
  rootDir: string,
  dirPath: string,
  fingerprint: ContentFingerprint,
  originalContent: string,
  maxFiles: number = 10
): Array<{ file: string; score: number; start: number; end: number }> {
  const absoluteDir = path.isAbsolute(dirPath) ? dirPath : path.join(rootDir, dirPath);
  if (!fs.existsSync(absoluteDir)) return [];

  const results: Array<{ file: string; score: number; start: number; end: number }> = [];

  try {
    const files = fs.readdirSync(absoluteDir)
      .filter(f => !f.startsWith('.') && fs.statSync(path.join(absoluteDir, f)).isFile())
      .slice(0, maxFiles);

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(absoluteDir, file), 'utf8');
        const lines = content.split('\n');
        const matches = slidingWindowSearch(lines, fingerprint, originalContent, 1);

        if (matches.length > 0 && matches[0].score >= 0.7) {
          const relPath = path.relative(rootDir, path.join(absoluteDir, file));
          results.push({
            file: relPath,
            score: matches[0].score,
            start: matches[0].windowStart,
            end: matches[0].windowEnd,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    return [];
  }

  return results.sort((a, b) => b.score - a.score);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN CONTENT SEARCH (Layer 3 entry point)
// ═══════════════════════════════════════════════════════════════════

/**
 * Search for relocated content using fingerprinting.
 * Called when Layers 1-2 fail.
 *
 * @param rootDir - Project root
 * @param filePath - Original file path (relative)
 * @param originalContent - Normalized content at materialization time
 * @param autoHeal - Whether to auto-apply relocations for score ≥ 0.85
 * @returns ContentSearchResult with the best match
 */
export function contentSearch(
  rootDir: string,
  filePath: string,
  originalContent: string,
  autoHeal: boolean = true
): ContentSearchResult {
  const fingerprint = generateFingerprint(originalContent);
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(rootDir, filePath);

  // Step 1: Search within the same file
  if (fs.existsSync(absolutePath)) {
    const fileContent = fs.readFileSync(absolutePath, 'utf8');
    const fileLines = fileContent.split('\n');
    const matches = slidingWindowSearch(fileLines, fingerprint, originalContent);

    if (matches.length > 0) {
      const best = matches[0];
      return {
        found: best.score >= 0.7,
        score: best.score,
        suggestedStart: best.windowStart,
        suggestedEnd: best.windowEnd,
        similarity: best.similarity,
      };
    }
  }

  // Step 2: Check for file rename via git
  const renamedTo = detectFileRename(rootDir, filePath);
  if (renamedTo) {
    const renamedPath = path.join(rootDir, renamedTo);
    if (fs.existsSync(renamedPath)) {
      const renamedContent = fs.readFileSync(renamedPath, 'utf8');
      const renamedLines = renamedContent.split('\n');
      const matches = slidingWindowSearch(renamedLines, fingerprint, originalContent);

      if (matches.length > 0 && matches[0].score >= 0.7) {
        return {
          found: true,
          score: matches[0].score,
          suggestedStart: matches[0].windowStart,
          suggestedEnd: matches[0].windowEnd,
          suggestedPath: renamedTo,
          similarity: matches[0].similarity,
        };
      }
    }
  }

  // Step 3: Search sibling files in same directory
  const dirPath = path.dirname(filePath);
  const siblingResults = searchSiblingFiles(rootDir, dirPath, fingerprint, originalContent);

  if (siblingResults.length > 0 && siblingResults[0].score >= 0.7) {
    const best = siblingResults[0];
    return {
      found: true,
      score: best.score,
      suggestedStart: best.start,
      suggestedEnd: best.end,
      suggestedPath: best.file !== filePath ? best.file : undefined,
      similarity: best.score, // approximate
    };
  }

  // No match found
  return { found: false, score: 0 };
}
