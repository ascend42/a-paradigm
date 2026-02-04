/**
 * Fuzzy Match - Simple Levenshtein distance for symbol search
 */

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize the matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find fuzzy matches for a query string among candidates
 */
export function findFuzzyMatches(
  query: string,
  candidates: string[],
  options: { maxDistance?: number; maxResults?: number } = {}
): Array<{ match: string; distance: number }> {
  const { maxDistance = 3, maxResults = 5 } = options;
  const queryLower = query.toLowerCase();

  const matches: Array<{ match: string; distance: number }> = [];

  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase();

    // Exact match has distance 0
    if (candidateLower === queryLower) {
      matches.push({ match: candidate, distance: 0 });
      continue;
    }

    // Check if query is contained in candidate (partial match)
    if (candidateLower.includes(queryLower) || queryLower.includes(candidateLower)) {
      matches.push({ match: candidate, distance: 1 });
      continue;
    }

    // Calculate Levenshtein distance
    const distance = levenshteinDistance(queryLower, candidateLower);
    if (distance <= maxDistance) {
      matches.push({ match: candidate, distance });
    }
  }

  // Sort by distance (ascending), then by string (alphabetically)
  matches.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.match.localeCompare(b.match);
  });

  return matches.slice(0, maxResults);
}

/**
 * Check if a string is a valid Paradigm symbol format
 * Symbols must start with @, #, $, %, ^, !, ?, ~, or &
 */
export function isValidSymbolFormat(symbol: string): boolean {
  return /^[@#$%^!?~&]/.test(symbol);
}

/**
 * Extract the symbol prefix from a symbol string
 */
export function getSymbolPrefix(symbol: string): string | null {
  const match = symbol.match(/^([@#$%^!?~&])/);
  return match ? match[1] : null;
}
