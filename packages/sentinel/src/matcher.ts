/**
 * Paradigm Sentinel - Pattern Matching Engine
 *
 * Matches incidents against failure patterns using symbolic context,
 * error text, and missing signals.
 */

import type { SentinelStorage } from './storage.js';
import type {
  SymbolicIncidentRecord,
  FailurePattern,
  PatternMatch,
  MatchedCriteria,
  MatcherConfig,
  PatternTestResult,
  SymbolicContext,
  PatternSymbolCriteria,
} from './types.js';

const DEFAULT_CONFIG: MatcherConfig = {
  minScore: 30,
  maxResults: 5,
  boostConfidence: true,
};

export class PatternMatcher {
  constructor(private storage: SentinelStorage) {}

  /**
   * Match an incident against all patterns and return ranked results
   */
  match(
    incident: SymbolicIncidentRecord,
    config: Partial<MatcherConfig> = {}
  ): PatternMatch[] {
    const { minScore, maxResults, boostConfidence } = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    const patterns = this.storage.getAllPatterns({ includePrivate: true });
    const matches: PatternMatch[] = [];

    for (const pattern of patterns) {
      // Check environment filter first
      if (!this.matchEnvironment(pattern, incident)) {
        continue;
      }

      const { score, matchedCriteria } = this.scoreMatch(pattern, incident);

      if (score >= minScore) {
        // Calculate final confidence
        let confidence = score;
        if (boostConfidence) {
          const confidenceFactor = pattern.confidence.score / 100;
          confidence = score * (0.5 + 0.5 * confidenceFactor);
        }

        matches.push({
          pattern,
          score,
          matchedCriteria,
          confidence: Math.round(confidence),
        });

        // Update pattern match count
        this.storage.updatePatternConfidence(pattern.id, 'matched');
      }
    }

    // Sort by confidence (descending) and limit results
    return matches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxResults);
  }

  /**
   * Test a pattern against historical incidents
   */
  testPattern(
    pattern: FailurePattern,
    limit: number = 100
  ): PatternTestResult {
    const incidents = this.storage.getRecentIncidents({ limit });
    const wouldMatch: SymbolicIncidentRecord[] = [];
    let totalScore = 0;

    for (const incident of incidents) {
      if (!this.matchEnvironment(pattern, incident)) {
        continue;
      }

      const { score } = this.scoreMatch(pattern, incident);
      if (score >= 30) {
        wouldMatch.push(incident);
        totalScore += score;
      }
    }

    return {
      wouldMatch,
      matchCount: wouldMatch.length,
      avgScore:
        wouldMatch.length > 0
          ? Math.round(totalScore / wouldMatch.length)
          : 0,
    };
  }

  /**
   * Score how well a pattern matches an incident
   */
  private scoreMatch(
    pattern: FailurePattern,
    incident: SymbolicIncidentRecord
  ): { score: number; matchedCriteria: MatchedCriteria } {
    let score = 0;
    const matchedCriteria: MatchedCriteria = {
      symbols: [],
      errorKeywords: [],
      missingSignals: [],
    };

    // Symbol matching (max 50 points)
    const symbolScore = this.matchSymbols(
      pattern.pattern.symbols,
      incident.symbols,
      matchedCriteria.symbols
    );
    score += Math.min(symbolScore, 50);

    // Error text matching (max 25 points)
    const errorScore = this.matchErrorText(
      pattern,
      incident,
      matchedCriteria.errorKeywords
    );
    score += Math.min(errorScore, 25);

    // Missing signals (max 25 points)
    const signalScore = this.matchMissingSignals(
      pattern,
      incident,
      matchedCriteria.missingSignals
    );
    score += Math.min(signalScore, 25);

    // Cap at 100
    score = Math.min(score, 100);

    return { score, matchedCriteria };
  }

  /**
   * Match symbols between pattern and incident
   */
  private matchSymbols(
    patternSymbols: PatternSymbolCriteria,
    incidentSymbols: SymbolicContext,
    matched: string[]
  ): number {
    let score = 0;
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
      const patternValue = patternSymbols[type];
      const incidentValue = incidentSymbols[type];

      if (!patternValue || !incidentValue) {
        continue;
      }

      if (typeof patternValue === 'string') {
        // Single value match
        if (this.matchSingleSymbol(patternValue, incidentValue)) {
          score += patternValue.includes('*') ? 5 : 10;
          matched.push(type);
        }
      } else if (Array.isArray(patternValue)) {
        // Array match - any of
        for (const pv of patternValue) {
          if (this.matchSingleSymbol(pv, incidentValue)) {
            score += 7;
            matched.push(type);
            break;
          }
        }
      }
    }

    return score;
  }

  /**
   * Match a single symbol value (supports wildcards)
   */
  private matchSingleSymbol(pattern: string, value: string): boolean {
    if (pattern === '*') {
      return true;
    }

    if (pattern.endsWith('*')) {
      // Prefix wildcard: "@checkout*" matches "@checkout", "@checkout-v2"
      const prefix = pattern.slice(0, -1);
      return value.startsWith(prefix);
    }

    if (pattern.startsWith('*')) {
      // Suffix wildcard: "*-auth" matches "@user-auth", "^needs-auth"
      const suffix = pattern.slice(1);
      return value.endsWith(suffix);
    }

    if (pattern.includes('*')) {
      // Convert to regex: "^*-validated" -> /^\^.*-validated$/
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*') + '$'
      );
      return regex.test(value);
    }

    // Exact match
    return pattern === value;
  }

  /**
   * Match error text keywords and regex
   */
  private matchErrorText(
    pattern: FailurePattern,
    incident: SymbolicIncidentRecord,
    matched: string[]
  ): number {
    let score = 0;
    const errorMessage = incident.error.message.toLowerCase();
    const errorType = incident.error.type?.toLowerCase();

    // Keyword matching (OR - any match counts)
    if (pattern.pattern.errorContains) {
      for (const keyword of pattern.pattern.errorContains) {
        if (errorMessage.includes(keyword.toLowerCase())) {
          score += 5;
          matched.push(keyword);
        }
      }
    }

    // Regex matching
    if (pattern.pattern.errorMatches) {
      try {
        const regex = new RegExp(pattern.pattern.errorMatches, 'i');
        if (regex.test(incident.error.message)) {
          score += 10;
          matched.push(`regex:${pattern.pattern.errorMatches}`);
        }
      } catch {
        // Invalid regex, skip
      }
    }

    // Error type matching
    if (pattern.pattern.errorType && errorType) {
      for (const type of pattern.pattern.errorType) {
        if (errorType.includes(type.toLowerCase())) {
          score += 5;
          matched.push(`type:${type}`);
        }
      }
    }

    return score;
  }

  /**
   * Match missing signals from flow position
   */
  private matchMissingSignals(
    pattern: FailurePattern,
    incident: SymbolicIncidentRecord,
    matched: string[]
  ): number {
    if (!pattern.pattern.missingSignals || !incident.flowPosition?.missing) {
      return 0;
    }

    let score = 0;

    for (const expectedSignal of pattern.pattern.missingSignals) {
      for (const missingSignal of incident.flowPosition.missing) {
        if (this.matchSingleSymbol(expectedSignal, missingSignal)) {
          score += 12;
          matched.push(missingSignal);
          break;
        }
      }
    }

    return score;
  }

  /**
   * Check if pattern's environment filter matches incident
   */
  private matchEnvironment(
    pattern: FailurePattern,
    incident: SymbolicIncidentRecord
  ): boolean {
    if (
      !pattern.pattern.environment ||
      pattern.pattern.environment.length === 0
    ) {
      return true;
    }

    return pattern.pattern.environment.includes(incident.environment);
  }
}
