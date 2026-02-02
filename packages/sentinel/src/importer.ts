/**
 * Paradigm Sentinel - Pattern Importer
 *
 * Validates and imports patterns from JSON files or URLs.
 */

import * as fs from 'fs';
import type {
  PatternExport,
  FailurePattern,
  PatternCriteria,
  PatternResolution,
} from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
}

export class PatternImporter {
  /**
   * Validate a pattern export file
   */
  validate(data: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check basic structure
    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['Invalid data: expected object'], warnings: [] };
    }

    const obj = data as Record<string, unknown>;

    // Check version
    if (!obj.version) {
      errors.push('Missing version field');
    }

    // Check patterns array
    if (!Array.isArray(obj.patterns)) {
      errors.push('Missing or invalid patterns array');
      return { valid: false, errors, warnings };
    }

    // Validate each pattern
    for (let i = 0; i < obj.patterns.length; i++) {
      const pattern = obj.patterns[i] as Record<string, unknown>;
      const patternErrors = this.validatePattern(pattern, i);
      errors.push(...patternErrors.errors);
      warnings.push(...patternErrors.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a single pattern
   */
  validatePattern(
    pattern: Record<string, unknown>,
    index: number
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const prefix = `Pattern[${index}]`;

    // Required fields
    if (!pattern.id || typeof pattern.id !== 'string') {
      errors.push(`${prefix}: Missing or invalid id`);
    } else if (!/^[a-z0-9-]+$/.test(pattern.id)) {
      warnings.push(`${prefix}: ID "${pattern.id}" should be kebab-case`);
    }

    if (!pattern.name || typeof pattern.name !== 'string') {
      errors.push(`${prefix}: Missing or invalid name`);
    }

    // Pattern criteria
    if (!pattern.pattern || typeof pattern.pattern !== 'object') {
      errors.push(`${prefix}: Missing or invalid pattern criteria`);
    } else {
      const criteria = pattern.pattern as Record<string, unknown>;

      // Must have at least one matching criteria
      const hasSymbols =
        criteria.symbols &&
        typeof criteria.symbols === 'object' &&
        Object.keys(criteria.symbols as object).length > 0;
      const hasErrorContains =
        Array.isArray(criteria.errorContains) &&
        criteria.errorContains.length > 0;
      const hasErrorMatches =
        criteria.errorMatches && typeof criteria.errorMatches === 'string';
      const hasMissingSignals =
        Array.isArray(criteria.missingSignals) &&
        criteria.missingSignals.length > 0;

      if (!hasSymbols && !hasErrorContains && !hasErrorMatches && !hasMissingSignals) {
        errors.push(`${prefix}: Pattern must have at least one matching criteria`);
      }
    }

    // Resolution
    if (!pattern.resolution || typeof pattern.resolution !== 'object') {
      errors.push(`${prefix}: Missing or invalid resolution`);
    } else {
      const resolution = pattern.resolution as Record<string, unknown>;

      if (!resolution.description || typeof resolution.description !== 'string') {
        errors.push(`${prefix}: Missing resolution description`);
      }

      if (!resolution.strategy || typeof resolution.strategy !== 'string') {
        errors.push(`${prefix}: Missing resolution strategy`);
      } else {
        const validStrategies = [
          'retry',
          'fallback',
          'fix-data',
          'fix-code',
          'ignore',
          'escalate',
        ];
        if (!validStrategies.includes(resolution.strategy)) {
          errors.push(`${prefix}: Invalid strategy "${resolution.strategy}"`);
        }
      }

      if (!resolution.priority || typeof resolution.priority !== 'string') {
        warnings.push(`${prefix}: Missing priority, will default to medium`);
      } else {
        const validPriorities = ['low', 'medium', 'high', 'critical'];
        if (!validPriorities.includes(resolution.priority)) {
          warnings.push(`${prefix}: Invalid priority "${resolution.priority}"`);
        }
      }
    }

    return { errors, warnings };
  }

  /**
   * Load patterns from a JSON file
   */
  loadFromFile(filePath: string): PatternExport {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    const validation = this.validate(data);
    if (!validation.valid) {
      throw new Error(`Invalid pattern file: ${validation.errors.join(', ')}`);
    }

    return this.normalizeExport(data);
  }

  /**
   * Load patterns from a URL
   */
  async loadFromUrl(url: string): Promise<PatternExport> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch patterns: ${response.statusText}`);
    }

    const data = await response.json();

    const validation = this.validate(data);
    if (!validation.valid) {
      throw new Error(`Invalid pattern data: ${validation.errors.join(', ')}`);
    }

    return this.normalizeExport(data);
  }

  /**
   * Normalize raw data to PatternExport
   */
  private normalizeExport(data: Record<string, unknown>): PatternExport {
    const patterns = (data.patterns as Record<string, unknown>[]).map((p) =>
      this.normalizePattern(p)
    );

    return {
      version: (data.version as string) || '1.0.0',
      exportedAt: (data.exportedAt as string) || new Date().toISOString(),
      patterns,
    };
  }

  /**
   * Normalize a raw pattern object
   */
  private normalizePattern(data: Record<string, unknown>): FailurePattern {
    const pattern = data.pattern as Record<string, unknown>;
    const resolution = data.resolution as Record<string, unknown>;
    const confidence = (data.confidence as Record<string, unknown>) || {};

    return {
      id: data.id as string,
      name: data.name as string,
      description: (data.description as string) || '',
      pattern: {
        symbols: (pattern.symbols as PatternCriteria['symbols']) || {},
        errorContains: pattern.errorContains as string[] | undefined,
        errorMatches: pattern.errorMatches as string | undefined,
        errorType: pattern.errorType as string[] | undefined,
        missingSignals: pattern.missingSignals as string[] | undefined,
        environment: pattern.environment as string[] | undefined,
      },
      resolution: {
        description: resolution.description as string,
        strategy: resolution.strategy as PatternResolution['strategy'],
        priority: (resolution.priority as PatternResolution['priority']) || 'medium',
        codeHint: resolution.codeHint as string | undefined,
        codeSnippet: resolution.codeSnippet as string | undefined,
        symbolsToModify: resolution.symbolsToModify as string[] | undefined,
        filesLikelyInvolved: resolution.filesLikelyInvolved as string[] | undefined,
        commitRef: resolution.commitRef as string | undefined,
        prRef: resolution.prRef as string | undefined,
        docsRef: resolution.docsRef as string | undefined,
      },
      confidence: {
        score: (confidence.score as number) || 50,
        timesMatched: (confidence.timesMatched as number) || 0,
        timesResolved: (confidence.timesResolved as number) || 0,
        timesRecurred: (confidence.timesRecurred as number) || 0,
        avgTimeToResolve: confidence.avgTimeToResolve as number | undefined,
        lastMatched: confidence.lastMatched as string | undefined,
        lastResolved: confidence.lastResolved as string | undefined,
      },
      source: (data.source as FailurePattern['source']) || 'imported',
      private: Boolean(data.private),
      tags: (data.tags as string[]) || [],
      createdAt: (data.createdAt as string) || new Date().toISOString(),
      updatedAt: (data.updatedAt as string) || new Date().toISOString(),
    };
  }

  /**
   * Merge patterns from multiple sources
   */
  mergePatterns(...exports: PatternExport[]): PatternExport {
    const patternMap = new Map<string, FailurePattern>();

    for (const exp of exports) {
      for (const pattern of exp.patterns) {
        // Later patterns overwrite earlier ones with same ID
        patternMap.set(pattern.id, pattern);
      }
    }

    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      patterns: Array.from(patternMap.values()),
    };
  }
}
