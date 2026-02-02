/**
 * Paradigm Sentinel - Incident Grouper
 *
 * Clusters similar incidents based on symbolic context and error patterns.
 */

import type { SentinelStorage } from './storage.js';
import type {
  SymbolicIncidentRecord,
  IncidentGroup,
  SymbolicContext,
} from './types.js';

// Similarity threshold for grouping (0-1)
const SIMILARITY_THRESHOLD = 0.6;

export class IncidentGrouper {
  constructor(private storage: SentinelStorage) {}

  /**
   * Try to find or create a group for an incident
   * Returns the group ID if grouped, null if no suitable group
   */
  group(incident: SymbolicIncidentRecord): string | null {
    // Find existing groups
    const groups = this.storage.getGroups({ limit: 100 });

    // Try to find a matching group
    for (const group of groups) {
      if (this.shouldJoinGroup(incident, group)) {
        this.storage.addToGroup(group.id, incident.id);
        return group.id;
      }
    }

    // Try to find similar incidents and create a new group
    const similar = this.findSimilar(incident, 10);

    // Need at least 2 similar incidents (including this one) to form a group
    if (similar.length >= 1) {
      const commonSymbols = this.extractCommonSymbols([incident, ...similar]);
      const commonErrorPatterns = this.extractCommonErrorPatterns([
        incident,
        ...similar,
      ]);

      const groupId = this.storage.createGroup({
        incidents: [incident.id, ...similar.map((i) => i.id)],
        commonSymbols,
        commonErrorPatterns,
        firstSeen: this.getEarliestTimestamp([incident, ...similar]),
        lastSeen: incident.timestamp,
        environments: this.getUniqueEnvironments([incident, ...similar]),
      });

      return groupId;
    }

    return null;
  }

  /**
   * Find incidents similar to the given one
   */
  findSimilar(
    incident: SymbolicIncidentRecord,
    limit: number = 10
  ): SymbolicIncidentRecord[] {
    // Get recent incidents
    const candidates = this.storage.getRecentIncidents({
      limit: 500,
      status: 'all',
    });

    const similar: { incident: SymbolicIncidentRecord; score: number }[] = [];

    for (const candidate of candidates) {
      if (candidate.id === incident.id) {
        continue;
      }

      const score = this.calculateSimilarity(incident, candidate);

      if (score >= SIMILARITY_THRESHOLD) {
        similar.push({ incident: candidate, score });
      }
    }

    // Sort by similarity score and return top N
    return similar
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.incident);
  }

  /**
   * Analyze ungrouped incidents and create groups automatically
   */
  analyzeAndGroup(options: { minSize?: number } = {}): IncidentGroup[] {
    const minSize = options.minSize || 3;
    const ungrouped = this.storage.getRecentIncidents({
      limit: 1000,
    }).filter((i) => !i.groupId);

    const newGroups: IncidentGroup[] = [];
    const processed = new Set<string>();

    for (const incident of ungrouped) {
      if (processed.has(incident.id)) {
        continue;
      }

      // Find similar incidents
      const similar = ungrouped.filter(
        (other) =>
          other.id !== incident.id &&
          !processed.has(other.id) &&
          this.calculateSimilarity(incident, other) >= SIMILARITY_THRESHOLD
      );

      if (similar.length + 1 >= minSize) {
        // Create group
        const members = [incident, ...similar];
        const commonSymbols = this.extractCommonSymbols(members);
        const commonErrorPatterns = this.extractCommonErrorPatterns(members);

        const groupId = this.storage.createGroup({
          incidents: members.map((m) => m.id),
          commonSymbols,
          commonErrorPatterns,
          firstSeen: this.getEarliestTimestamp(members),
          lastSeen: this.getLatestTimestamp(members),
          environments: this.getUniqueEnvironments(members),
        });

        // Mark as processed
        for (const m of members) {
          processed.add(m.id);
        }

        const group = this.storage.getGroup(groupId);
        if (group) {
          newGroups.push(group);
        }
      }
    }

    return newGroups;
  }

  /**
   * Calculate similarity between two incidents (0-1)
   */
  private calculateSimilarity(
    a: SymbolicIncidentRecord,
    b: SymbolicIncidentRecord
  ): number {
    let score = 0;
    let maxScore = 0;

    // Symbol matching (60% weight)
    const symbolWeight = 0.6;
    const symbolTypes: (keyof SymbolicContext)[] = [
      'feature',
      'component',
      'flow',
      'gate',
      'signal',
      'state',
      'integration',
    ];

    for (const type of symbolTypes) {
      const aValue = a.symbols[type];
      const bValue = b.symbols[type];

      if (aValue || bValue) {
        maxScore += symbolWeight / symbolTypes.length;
        if (aValue === bValue) {
          score += symbolWeight / symbolTypes.length;
        }
      }
    }

    // Error message similarity (30% weight)
    const errorWeight = 0.3;
    const errorSimilarity = this.stringSimilarity(
      a.error.message,
      b.error.message
    );
    score += errorWeight * errorSimilarity;
    maxScore += errorWeight;

    // Same environment bonus (10% weight)
    const envWeight = 0.1;
    if (a.environment === b.environment) {
      score += envWeight;
    }
    maxScore += envWeight;

    return maxScore > 0 ? score / maxScore : 0;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private stringSimilarity(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;

    const distance = this.levenshteinDistance(
      a.toLowerCase(),
      b.toLowerCase()
    );
    return 1 - distance / maxLen;
  }

  /**
   * Levenshtein distance for string comparison
   */
  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    // Initialize matrix
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Check if incident should join existing group
   */
  private shouldJoinGroup(
    incident: SymbolicIncidentRecord,
    group: IncidentGroup
  ): boolean {
    // Check if incident's symbols match group's common symbols
    let matchCount = 0;
    let totalCommon = 0;

    for (const [key, value] of Object.entries(group.commonSymbols)) {
      if (value) {
        totalCommon++;
        const incidentValue = incident.symbols[key as keyof SymbolicContext];
        if (incidentValue === value) {
          matchCount++;
        }
      }
    }

    if (totalCommon === 0) {
      return false;
    }

    const symbolMatch = matchCount / totalCommon;

    // Check error pattern match
    const errorLower = incident.error.message.toLowerCase();
    const errorMatch = group.commonErrorPatterns.some((pattern) =>
      errorLower.includes(pattern.toLowerCase())
    );

    // Need at least 50% symbol match or error pattern match
    return symbolMatch >= 0.5 || errorMatch;
  }

  /**
   * Extract symbols common to all incidents
   */
  private extractCommonSymbols(
    incidents: SymbolicIncidentRecord[]
  ): Partial<SymbolicContext> {
    if (incidents.length === 0) return {};

    const first = incidents[0].symbols;
    const common: Partial<SymbolicContext> = {};

    for (const [key, value] of Object.entries(first)) {
      if (!value) continue;

      const allMatch = incidents.every(
        (i) => i.symbols[key as keyof SymbolicContext] === value
      );

      if (allMatch) {
        common[key as keyof SymbolicContext] = value;
      }
    }

    return common;
  }

  /**
   * Extract common error patterns from incidents
   */
  private extractCommonErrorPatterns(
    incidents: SymbolicIncidentRecord[]
  ): string[] {
    if (incidents.length === 0) return [];

    // Extract significant words from error messages
    const wordCounts = new Map<string, number>();
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'error',
      'failed',
      'cannot',
    ]);

    for (const incident of incidents) {
      const words = incident.error.message
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w));

      const uniqueWords = new Set(words);
      for (const word of uniqueWords) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }

    // Find words that appear in majority of incidents
    const threshold = Math.ceil(incidents.length * 0.6);
    const commonPatterns = Array.from(wordCounts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([word]) => word)
      .slice(0, 5);

    return commonPatterns;
  }

  private getEarliestTimestamp(incidents: SymbolicIncidentRecord[]): string {
    return incidents.reduce((earliest, i) =>
      i.timestamp < earliest ? i.timestamp : earliest
    , incidents[0].timestamp);
  }

  private getLatestTimestamp(incidents: SymbolicIncidentRecord[]): string {
    return incidents.reduce((latest, i) =>
      i.timestamp > latest ? i.timestamp : latest
    , incidents[0].timestamp);
  }

  private getUniqueEnvironments(incidents: SymbolicIncidentRecord[]): string[] {
    return [...new Set(incidents.map((i) => i.environment))];
  }
}
