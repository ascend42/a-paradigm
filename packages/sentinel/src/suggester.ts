/**
 * Paradigm Sentinel - Pattern Suggester
 *
 * Generates pattern suggestions from resolved incidents and incident groups.
 */

import type { SentinelStorage } from './storage.js';
import type {
  SymbolicIncidentRecord,
  IncidentGroup,
  FailurePattern,
  PatternCandidate,
  PatternSymbolCriteria,
  SymbolicContext,
} from './types.js';

export class PatternSuggester {
  constructor(private storage: SentinelStorage) {}

  /**
   * Suggest a pattern from a resolved incident
   */
  suggestFromIncident(
    incident: SymbolicIncidentRecord
  ): Partial<FailurePattern> {
    // Generate pattern ID
    const baseId = this.generatePatternId(incident);

    // Build symbol criteria from incident
    const symbols = this.buildSymbolCriteria(incident.symbols);

    // Extract error keywords
    const errorKeywords = this.extractErrorKeywords(incident.error.message);

    // Build pattern
    const pattern: Partial<FailurePattern> = {
      id: baseId,
      name: this.generatePatternName(incident),
      description: `Auto-suggested pattern from incident ${incident.id}`,
      pattern: {
        symbols,
        errorContains: errorKeywords.length > 0 ? errorKeywords : undefined,
        missingSignals: incident.flowPosition?.missing,
      },
      resolution: {
        description: incident.resolution?.notes || 'Resolution approach TBD',
        strategy: 'fix-code',
        priority: 'medium',
      },
      source: 'suggested',
      private: false,
      tags: this.generateTags(incident),
    };

    return pattern;
  }

  /**
   * Suggest a pattern from an incident group
   */
  suggestFromGroup(group: IncidentGroup): Partial<FailurePattern> {
    // Generate pattern ID from group
    const baseId = `group-${group.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    // Build symbol criteria from common symbols
    const symbols = this.buildSymbolCriteria(group.commonSymbols);

    const pattern: Partial<FailurePattern> = {
      id: baseId,
      name: group.name || `Pattern from group ${group.id}`,
      description: `Auto-suggested pattern from incident group with ${group.count} incidents`,
      pattern: {
        symbols,
        errorContains:
          group.commonErrorPatterns.length > 0
            ? group.commonErrorPatterns
            : undefined,
      },
      resolution: {
        description: 'Resolution approach TBD based on grouped incidents',
        strategy: 'fix-code',
        priority: this.getPriorityFromCount(group.count),
      },
      source: 'suggested',
      private: false,
      tags: this.generateTagsFromGroup(group),
    };

    return pattern;
  }

  /**
   * Find incidents that could become patterns
   */
  findPatternCandidates(minOccurrences: number = 3): PatternCandidate[] {
    const incidents = this.storage.getRecentIncidents({
      limit: 1000,
      status: 'resolved',
    });

    // Group incidents by symbol signature
    const signatureGroups = new Map<string, SymbolicIncidentRecord[]>();

    for (const incident of incidents) {
      const signature = this.getSymbolSignature(incident.symbols);
      const existing = signatureGroups.get(signature) || [];
      existing.push(incident);
      signatureGroups.set(signature, existing);
    }

    // Find groups with enough occurrences
    const candidates: PatternCandidate[] = [];

    for (const [, groupIncidents] of signatureGroups) {
      if (groupIncidents.length >= minOccurrences) {
        // Check if there's already a matching pattern
        const hasPattern = this.hasMatchingPattern(groupIncidents[0]);
        if (hasPattern) continue;

        const suggestedPattern = this.suggestFromIncidents(groupIncidents);

        candidates.push({
          incidents: groupIncidents,
          suggestedPattern,
          occurrenceCount: groupIncidents.length,
        });
      }
    }

    // Sort by occurrence count (most common first)
    return candidates.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
  }

  /**
   * Generate pattern from multiple similar incidents
   */
  private suggestFromIncidents(
    incidents: SymbolicIncidentRecord[]
  ): Partial<FailurePattern> {
    // Extract common symbols
    const commonSymbols = this.extractCommonSymbols(incidents);
    const symbols = this.buildSymbolCriteria(commonSymbols);

    // Extract common error keywords
    const errorKeywords = this.extractCommonErrorKeywords(incidents);

    // Extract common missing signals
    const missingSignals = this.extractCommonMissingSignals(incidents);

    // Generate ID from first incident
    const baseId = this.generatePatternId(incidents[0]);

    return {
      id: baseId,
      name: this.generatePatternName(incidents[0]),
      description: `Auto-suggested pattern from ${incidents.length} similar incidents`,
      pattern: {
        symbols,
        errorContains: errorKeywords.length > 0 ? errorKeywords : undefined,
        missingSignals: missingSignals.length > 0 ? missingSignals : undefined,
      },
      resolution: {
        description: 'Resolution approach based on previous resolutions',
        strategy: this.inferStrategy(incidents),
        priority: this.getPriorityFromCount(incidents.length),
      },
      source: 'suggested',
      private: false,
      tags: this.generateTagsFromIncidents(incidents),
    };
  }

  /**
   * Build symbol criteria for pattern, adding wildcards where appropriate
   */
  private buildSymbolCriteria(
    symbols: Partial<SymbolicContext>
  ): PatternSymbolCriteria {
    const criteria: PatternSymbolCriteria = {};

    for (const [key, value] of Object.entries(symbols)) {
      if (value) {
        // Use exact match for now - could be smarter with wildcards
        criteria[key as keyof PatternSymbolCriteria] = value;
      }
    }

    return criteria;
  }

  /**
   * Extract keywords from error message
   */
  private extractErrorKeywords(message: string): string[] {
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
      'and',
      'or',
      'but',
      'not',
      'no',
      'be',
      'been',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
    ]);

    const words = message
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    // Return unique, significant words
    const unique = [...new Set(words)];
    return unique.slice(0, 5);
  }

  /**
   * Extract common error keywords from multiple incidents
   */
  private extractCommonErrorKeywords(
    incidents: SymbolicIncidentRecord[]
  ): string[] {
    const wordCounts = new Map<string, number>();

    for (const incident of incidents) {
      const keywords = this.extractErrorKeywords(incident.error.message);
      for (const keyword of keywords) {
        wordCounts.set(keyword, (wordCounts.get(keyword) || 0) + 1);
      }
    }

    // Find words in majority of incidents
    const threshold = Math.ceil(incidents.length * 0.5);
    return Array.from(wordCounts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([word]) => word)
      .slice(0, 5);
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
   * Extract missing signals common to multiple incidents
   */
  private extractCommonMissingSignals(
    incidents: SymbolicIncidentRecord[]
  ): string[] {
    const signalCounts = new Map<string, number>();

    for (const incident of incidents) {
      if (!incident.flowPosition?.missing) continue;

      for (const signal of incident.flowPosition.missing) {
        signalCounts.set(signal, (signalCounts.get(signal) || 0) + 1);
      }
    }

    // Find signals missing in majority
    const threshold = Math.ceil(incidents.length * 0.5);
    return Array.from(signalCounts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([signal]) => signal);
  }

  /**
   * Generate a pattern ID from incident
   */
  private generatePatternId(incident: SymbolicIncidentRecord): string {
    const parts: string[] = [];

    // Use the most specific symbol available
    if (incident.symbols.gate) {
      parts.push(incident.symbols.gate.replace(/[^a-z0-9]/gi, ''));
    } else if (incident.symbols.feature) {
      parts.push(incident.symbols.feature.replace(/[^a-z0-9]/gi, ''));
    } else if (incident.symbols.component) {
      parts.push(incident.symbols.component.replace(/[^a-z0-9]/gi, ''));
    } else if (incident.symbols.integration) {
      parts.push(incident.symbols.integration.replace(/[^a-z0-9]/gi, ''));
    } else {
      parts.push('unknown');
    }

    // Add error type hint
    const errorType = incident.error.type?.toLowerCase() || 'error';
    parts.push(errorType.replace(/[^a-z0-9]/gi, ''));

    // Add sequence number
    parts.push(String(Date.now() % 1000).padStart(3, '0'));

    return parts.join('-');
  }

  /**
   * Generate a human-readable pattern name
   */
  private generatePatternName(incident: SymbolicIncidentRecord): string {
    const parts: string[] = [];

    if (incident.symbols.feature) {
      parts.push(
        incident.symbols.feature.replace('@', '').replace(/-/g, ' ')
      );
    }

    if (incident.symbols.gate) {
      parts.push('gate ' + incident.symbols.gate.replace('^', ''));
    }

    if (incident.error.type) {
      parts.push(incident.error.type);
    }

    if (parts.length === 0) {
      return 'Unnamed Pattern';
    }

    // Capitalize first letter
    const name = parts.join(' - ');
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  /**
   * Generate tags from incident
   */
  private generateTags(incident: SymbolicIncidentRecord): string[] {
    const tags: string[] = [];

    if (incident.symbols.feature) {
      tags.push('feature');
    }
    if (incident.symbols.gate) {
      tags.push('gate');
    }
    if (incident.symbols.integration) {
      tags.push('integration');
      tags.push(incident.symbols.integration.replace('&', ''));
    }
    if (incident.error.type) {
      tags.push(incident.error.type.toLowerCase());
    }

    tags.push(incident.environment);

    return [...new Set(tags)].slice(0, 5);
  }

  /**
   * Generate tags from incident group
   */
  private generateTagsFromGroup(group: IncidentGroup): string[] {
    const tags: string[] = ['grouped'];

    if (group.commonSymbols.feature) {
      tags.push('feature');
    }
    if (group.commonSymbols.gate) {
      tags.push('gate');
    }
    if (group.commonSymbols.integration) {
      tags.push('integration');
    }

    for (const env of group.environments) {
      tags.push(env);
    }

    return [...new Set(tags)].slice(0, 5);
  }

  /**
   * Generate tags from multiple incidents
   */
  private generateTagsFromIncidents(
    incidents: SymbolicIncidentRecord[]
  ): string[] {
    const tagCounts = new Map<string, number>();

    for (const incident of incidents) {
      const tags = this.generateTags(incident);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    // Get most common tags
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);
  }

  /**
   * Get symbol signature for grouping
   */
  private getSymbolSignature(symbols: SymbolicContext): string {
    const parts: string[] = [];

    if (symbols.feature) parts.push(`f:${symbols.feature}`);
    if (symbols.component) parts.push(`c:${symbols.component}`);
    if (symbols.flow) parts.push(`fl:${symbols.flow}`);
    if (symbols.gate) parts.push(`g:${symbols.gate}`);
    if (symbols.integration) parts.push(`i:${symbols.integration}`);

    return parts.sort().join('|');
  }

  /**
   * Check if there's already a pattern matching this incident
   */
  private hasMatchingPattern(incident: SymbolicIncidentRecord): boolean {
    const patterns = this.storage.getAllPatterns({ includePrivate: true });

    for (const pattern of patterns) {
      let matchCount = 0;
      const symbolTypes = [
        'feature',
        'component',
        'flow',
        'gate',
        'signal',
        'integration',
      ] as const;

      for (const type of symbolTypes) {
        const patternValue = pattern.pattern.symbols[type];
        const incidentValue = incident.symbols[type];

        if (patternValue && incidentValue && patternValue === incidentValue) {
          matchCount++;
        }
      }

      // Consider it a match if at least 2 symbols match
      if (matchCount >= 2) {
        return true;
      }
    }

    return false;
  }

  /**
   * Infer resolution strategy from incidents
   */
  private inferStrategy(
    incidents: SymbolicIncidentRecord[]
  ): 'retry' | 'fallback' | 'fix-data' | 'fix-code' | 'ignore' | 'escalate' {
    // Check error patterns
    const messages = incidents.map((i) => i.error.message.toLowerCase());

    if (messages.some((m) => m.includes('timeout') || m.includes('network'))) {
      return 'retry';
    }

    if (
      messages.some(
        (m) =>
          m.includes('validation') ||
          m.includes('invalid') ||
          m.includes('required')
      )
    ) {
      return 'fix-data';
    }

    if (messages.some((m) => m.includes('permission') || m.includes('403'))) {
      return 'escalate';
    }

    return 'fix-code';
  }

  /**
   * Get priority based on occurrence count
   */
  private getPriorityFromCount(
    count: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (count >= 20) return 'critical';
    if (count >= 10) return 'high';
    if (count >= 5) return 'medium';
    return 'low';
  }
}
