/**
 * aspect-anchors — shared aspect-anchor existence check.
 *
 * For each aspect whose `applies-to` matches a touched symbol, verify its code
 * anchors point to existing files. This logic was historically triplicated
 * across pm_postflight, the compliance checker, and the CLI review pipeline —
 * with two copies carrying bugs (root-only path resolution → false positives;
 * no per-aspect dedup → duplicate noise). This helper is the single correct
 * implementation: it encapsulates applies-to matching, per-aspect dedup,
 * purposeDir derivation from `aspect.filePath`, and `resolveAnchorPath`
 * resolution (absolute → project-root → purpose-dir bases).
 */

import type { SymbolIndex } from './types.js';
import { getSymbolsByType } from './symbol-index.js';
import { resolveAnchorPath } from './anchor-path.js';
import * as path from 'path';

export interface AspectAnchorIssue {
  aspectSymbol: string;
  anchorRaw: string | null;   // raw anchor for missing-file; null for no-anchors
  kind: 'no-anchors' | 'missing-file';
}

function matchPattern(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) return pattern === value;
  const regex = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$');
  return regex.test(value);
}

/**
 * For each aspect whose applies-to matches a touched symbol, verify its code
 * anchors. Encapsulates applies-to matching, per-aspect dedup, purposeDir
 * derivation from aspect.filePath, and resolveAnchorPath resolution.
 */
export function checkAspectAnchors(
  index: SymbolIndex,
  symbolsTouched: string[],
  rootDir: string,
): AspectAnchorIssue[] {
  const issues: AspectAnchorIssue[] = [];
  const aspects = getSymbolsByType(index, 'aspect');
  const seen = new Set<string>();
  for (const aspect of aspects) {
    const appliesTo = aspect.appliesTo || [];
    if (appliesTo.length === 0) continue;
    for (const pattern of appliesTo) {
      for (const symbol of symbolsTouched) {
        if (!matchPattern(pattern, symbol)) continue;
        const anchors = aspect.anchors || [];
        if (anchors.length === 0) {
          const key = `${aspect.symbol}::__no-anchors__`;
          if (!seen.has(key)) {
            seen.add(key);
            issues.push({ aspectSymbol: aspect.symbol, anchorRaw: null, kind: 'no-anchors' });
          }
        } else {
          const purposeFilePath = aspect.filePath
            ? (path.isAbsolute(aspect.filePath) ? aspect.filePath : path.resolve(rootDir, aspect.filePath))
            : rootDir;
          const purposeDir = aspect.filePath ? path.dirname(purposeFilePath) : rootDir;
          for (const anchor of anchors) {
            const key = `${aspect.symbol}::${anchor.raw}`;
            if (seen.has(key)) continue;
            const resolution = resolveAnchorPath(anchor.path, purposeDir, rootDir);
            if (!resolution.exists) {
              seen.add(key);
              issues.push({ aspectSymbol: aspect.symbol, anchorRaw: anchor.raw, kind: 'missing-file' });
            }
          }
        }
      }
    }
  }
  return issues;
}
