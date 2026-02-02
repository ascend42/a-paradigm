/**
 * Paradigm Sentinel - Statistics Calculator
 *
 * Calculates various statistics and metrics for incidents and patterns.
 */

import type { SentinelStorage } from './storage.js';
import type {
  SentinelStats,
  SymbolHealth,
  SymbolicIncidentRecord,
} from './types.js';

export class StatsCalculator {
  constructor(private storage: SentinelStorage) {}

  /**
   * Get comprehensive statistics for a time period
   */
  getStats(periodDays: number = 7): SentinelStats {
    const end = new Date().toISOString();
    const start = new Date(
      Date.now() - periodDays * 24 * 60 * 60 * 1000
    ).toISOString();

    return this.storage.getStats({ start, end });
  }

  /**
   * Get health metrics for a specific symbol
   */
  getSymbolHealth(symbol: string): SymbolHealth {
    return this.storage.getSymbolHealth(symbol);
  }

  /**
   * Get trending issues (symbols with increasing incident rates)
   */
  getTrendingIssues(days: number = 7): { symbol: string; trend: number }[] {
    const now = Date.now();
    const halfPeriod = (days * 24 * 60 * 60 * 1000) / 2;

    // Get incidents from first half and second half of period
    const firstHalfStart = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    const midpoint = new Date(now - halfPeriod).toISOString();
    const secondHalfEnd = new Date(now).toISOString();

    const firstHalfIncidents = this.storage.getRecentIncidents({
      dateFrom: firstHalfStart,
      dateTo: midpoint,
      limit: 1000,
    });

    const secondHalfIncidents = this.storage.getRecentIncidents({
      dateFrom: midpoint,
      dateTo: secondHalfEnd,
      limit: 1000,
    });

    // Count symbols in each half
    const firstHalfCounts = this.countSymbols(firstHalfIncidents);
    const secondHalfCounts = this.countSymbols(secondHalfIncidents);

    // Calculate trends
    const trends: { symbol: string; trend: number }[] = [];
    const allSymbols = new Set([
      ...firstHalfCounts.keys(),
      ...secondHalfCounts.keys(),
    ]);

    for (const symbol of allSymbols) {
      const first = firstHalfCounts.get(symbol) || 0;
      const second = secondHalfCounts.get(symbol) || 0;

      if (first === 0 && second > 0) {
        // New issue
        trends.push({ symbol, trend: second * 100 });
      } else if (first > 0) {
        // Calculate percentage change
        const change = ((second - first) / first) * 100;
        trends.push({ symbol, trend: change });
      }
    }

    // Sort by trend (highest positive first)
    return trends
      .filter((t) => t.trend > 0)
      .sort((a, b) => b.trend - a.trend)
      .slice(0, 10);
  }

  /**
   * Get resolution metrics
   */
  getResolutionMetrics(): {
    avgTimeToResolve: number;
    resolvedWithPattern: number;
    resolvedManually: number;
    totalResolved: number;
    resolutionRate: number;
  } {
    const stats = this.getStats(30);
    return {
      avgTimeToResolve: stats.resolution.avgTimeToResolve,
      resolvedWithPattern: stats.resolution.resolvedWithPattern,
      resolvedManually: stats.resolution.resolvedManually,
      totalResolved: stats.incidents.resolved,
      resolutionRate: stats.resolution.resolutionRate,
    };
  }

  /**
   * Get pattern effectiveness metrics
   */
  getPatternEffectiveness(): {
    patternId: string;
    name: string;
    matches: number;
    resolutions: number;
    recurrences: number;
    effectiveness: number;
  }[] {
    const patterns = this.storage.getAllPatterns({ includePrivate: true });

    return patterns
      .filter((p) => p.confidence.timesMatched > 0)
      .map((p) => ({
        patternId: p.id,
        name: p.name,
        matches: p.confidence.timesMatched,
        resolutions: p.confidence.timesResolved,
        recurrences: p.confidence.timesRecurred,
        effectiveness:
          p.confidence.timesMatched > 0
            ? Math.round(
                ((p.confidence.timesResolved - p.confidence.timesRecurred) /
                  p.confidence.timesMatched) *
                  100
              )
            : 0,
      }))
      .sort((a, b) => b.effectiveness - a.effectiveness);
  }

  /**
   * Get incident rate by hour of day
   */
  getIncidentsByHour(days: number = 7): { hour: number; count: number }[] {
    const start = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    ).toISOString();

    const incidents = this.storage.getRecentIncidents({
      dateFrom: start,
      limit: 10000,
    });

    const hourCounts = new Map<number, number>();
    for (let i = 0; i < 24; i++) {
      hourCounts.set(i, 0);
    }

    for (const incident of incidents) {
      const hour = new Date(incident.timestamp).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    return Array.from(hourCounts.entries()).map(([hour, count]) => ({
      hour,
      count,
    }));
  }

  /**
   * Get incident rate by environment
   */
  getIncidentsByEnvironment(): { environment: string; count: number; percentage: number }[] {
    const stats = this.getStats(30);
    const total = stats.incidents.total;

    return Object.entries(stats.incidents.byEnvironment)
      .map(([environment, count]) => ({
        environment,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get symbol correlation matrix (which symbols fail together)
   */
  getSymbolCorrelation(): {
    symbol1: string;
    symbol2: string;
    correlation: number;
  }[] {
    const incidents = this.storage.getRecentIncidents({ limit: 1000 });
    const correlations = new Map<string, number>();
    const symbolCounts = new Map<string, number>();

    // Count symbol occurrences and co-occurrences
    for (const incident of incidents) {
      const symbols = this.getSymbolsFromIncident(incident);

      for (const symbol of symbols) {
        symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
      }

      // Count pairs
      for (let i = 0; i < symbols.length; i++) {
        for (let j = i + 1; j < symbols.length; j++) {
          const key = [symbols[i], symbols[j]].sort().join('|');
          correlations.set(key, (correlations.get(key) || 0) + 1);
        }
      }
    }

    // Calculate correlation scores
    const results: { symbol1: string; symbol2: string; correlation: number }[] =
      [];

    for (const [key, count] of correlations) {
      const [symbol1, symbol2] = key.split('|');
      const count1 = symbolCounts.get(symbol1) || 1;
      const count2 = symbolCounts.get(symbol2) || 1;

      // Jaccard-like correlation
      const correlation = count / Math.max(count1, count2);

      if (correlation > 0.3) {
        results.push({
          symbol1,
          symbol2,
          correlation: Math.round(correlation * 100) / 100,
        });
      }
    }

    return results.sort((a, b) => b.correlation - a.correlation).slice(0, 20);
  }

  /**
   * Generate a summary dashboard string
   */
  generateDashboard(periodDays: number = 7): string {
    const stats = this.getStats(periodDays);
    const lines: string[] = [];

    // Header
    lines.push('╔════════════════════════════════════════════════════════════════╗');
    lines.push('║                    PARADIGM SENTINEL DASHBOARD                  ║');
    lines.push('╠════════════════════════════════════════════════════════════════╣');

    // Summary line
    const todayCount = stats.incidents.byDay[stats.incidents.byDay.length - 1]?.count || 0;
    lines.push(
      `║  Open: ${String(stats.incidents.open).padEnd(4)} │  Investigating: ${String(stats.incidents.total - stats.incidents.open - stats.incidents.resolved).padEnd(3)} │  Resolved: ${String(stats.incidents.resolved).padEnd(4)} │  Today: +${todayCount}   ║`
    );
    lines.push('╚════════════════════════════════════════════════════════════════╝');
    lines.push('');

    // Incidents by day
    lines.push('Incidents by Day (last 7 days):');
    lines.push('─'.repeat(50));
    const maxDayCount = Math.max(...stats.incidents.byDay.map((d) => d.count), 1);
    for (const day of stats.incidents.byDay.slice(-7)) {
      const barLength = Math.round((day.count / maxDayCount) * 30);
      const bar = '█'.repeat(barLength);
      lines.push(`${day.date.substring(5)}  ${bar} ${day.count}`);
    }
    lines.push('');

    // Top symbols
    lines.push('Most Affected Symbols:');
    lines.push('─'.repeat(50));
    for (const { symbol, count } of stats.symbols.mostIncidents.slice(0, 5)) {
      lines.push(`  ${symbol.padEnd(25)} ${count} incidents`);
    }
    lines.push('');

    // Pattern effectiveness
    lines.push('Top Patterns:');
    lines.push('─'.repeat(50));
    for (const { patternId, resolvedCount } of stats.patterns.mostEffective.slice(0, 5)) {
      lines.push(`  ${patternId.padEnd(25)} ${resolvedCount} resolved`);
    }
    lines.push('');

    // Resolution rate
    lines.push('Resolution Stats:');
    lines.push('─'.repeat(50));
    lines.push(`  Resolution rate: ${Math.round(stats.resolution.resolutionRate)}%`);
    lines.push(`  With pattern: ${stats.resolution.resolvedWithPattern}`);
    lines.push(`  Manual: ${stats.resolution.resolvedManually}`);

    return lines.join('\n');
  }

  /**
   * Helper: Count symbols across incidents
   */
  private countSymbols(
    incidents: SymbolicIncidentRecord[]
  ): Map<string, number> {
    const counts = new Map<string, number>();

    for (const incident of incidents) {
      for (const [, value] of Object.entries(incident.symbols)) {
        if (value) {
          counts.set(value, (counts.get(value) || 0) + 1);
        }
      }
    }

    return counts;
  }

  /**
   * Helper: Get all symbols from incident
   */
  private getSymbolsFromIncident(incident: SymbolicIncidentRecord): string[] {
    const symbols: string[] = [];

    for (const [, value] of Object.entries(incident.symbols)) {
      if (value) {
        symbols.push(value);
      }
    }

    return symbols;
  }
}
