/**
 * Paradigm Sentinel - Context Enricher
 *
 * Enriches incidents with symbol metadata from .purpose files and symbol index.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  SymbolicIncidentRecord,
  EnrichedIncident,
  SymbolEnrichment,
} from './types.js';

interface PurposeFile {
  symbol?: string;
  description?: string;
  references?: string[];
  referencedBy?: string[];
}

interface SymbolIndexEntry {
  id: string;
  type: string;
  file: string;
  description?: string;
  references?: string[];
  referencedBy?: string[];
}

export class ContextEnricher {
  private symbolCache: Map<string, SymbolEnrichment> = new Map();
  private purposeCache: Map<string, PurposeFile> = new Map();

  constructor(private projectRoot: string = process.cwd()) {}

  /**
   * Enrich an incident with symbol context
   */
  enrich(incident: SymbolicIncidentRecord): EnrichedIncident {
    const symbolEnrichments: Record<string, SymbolEnrichment> = {};

    // Enrich each symbol
    for (const [, value] of Object.entries(incident.symbols)) {
      if (value) {
        const enrichment = this.getSymbolContext(value);
        if (enrichment && Object.keys(enrichment).length > 0) {
          symbolEnrichments[value] = enrichment;
        }
      }
    }

    // Get flow description if present
    let flowDescription: string | undefined;
    if (incident.symbols.flow) {
      const flowContext = this.getSymbolContext(incident.symbols.flow);
      flowDescription = flowContext?.description;
    }

    return {
      ...incident,
      enriched: {
        symbols: symbolEnrichments,
        flowDescription,
      },
    };
  }

  /**
   * Get symbol metadata from index or .purpose files
   */
  getSymbolContext(symbol: string): SymbolEnrichment {
    // Check cache first
    const cached = this.symbolCache.get(symbol);
    if (cached) {
      return cached;
    }

    const enrichment: SymbolEnrichment = {};

    // Try to find in symbol index
    const indexEntry = this.findInSymbolIndex(symbol);
    if (indexEntry) {
      enrichment.description = indexEntry.description;
      enrichment.definedIn = indexEntry.file;
      enrichment.references = indexEntry.references;
      enrichment.referencedBy = indexEntry.referencedBy;
    }

    // Try to find in .purpose files
    const purposeEntry = this.findInPurposeFiles(symbol);
    if (purposeEntry) {
      if (!enrichment.description && purposeEntry.description) {
        enrichment.description = purposeEntry.description;
      }
      if (purposeEntry.references) {
        enrichment.references = [
          ...new Set([...(enrichment.references || []), ...purposeEntry.references]),
        ];
      }
      if (purposeEntry.referencedBy) {
        enrichment.referencedBy = [
          ...new Set([...(enrichment.referencedBy || []), ...purposeEntry.referencedBy]),
        ];
      }
    }

    // Cache and return
    this.symbolCache.set(symbol, enrichment);
    return enrichment;
  }

  /**
   * Find symbol in premise index
   */
  private findInSymbolIndex(symbol: string): SymbolIndexEntry | null {
    const indexPath = path.join(this.projectRoot, '.paradigm', 'index.json');

    if (!fs.existsSync(indexPath)) {
      return null;
    }

    try {
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      const index = JSON.parse(indexContent);

      // Search in symbols array
      if (index.symbols && Array.isArray(index.symbols)) {
        return index.symbols.find(
          (s: SymbolIndexEntry) => s.id === symbol
        ) || null;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Find symbol in .purpose files
   */
  private findInPurposeFiles(symbol: string): PurposeFile | null {
    // Determine search paths based on symbol prefix
    const searchPaths = this.getSearchPathsForSymbol(symbol);

    for (const searchPath of searchPaths) {
      const fullPath = path.join(this.projectRoot, searchPath);

      if (!fs.existsSync(fullPath)) {
        continue;
      }

      // Check cache
      const cached = this.purposeCache.get(fullPath);
      if (cached) {
        if (cached.symbol === symbol) {
          return cached;
        }
        continue;
      }

      // Read and parse .purpose file
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const purpose = this.parsePurposeFile(content);

        // Cache it
        this.purposeCache.set(fullPath, purpose);

        if (purpose.symbol === symbol) {
          return purpose;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Get potential file paths for a symbol
   */
  private getSearchPathsForSymbol(symbol: string): string[] {
    const paths: string[] = [];
    const cleanSymbol = symbol.replace(/^[@#$%^!&~?]/, '');

    // Map symbol prefixes to directories
    const prefixDirs: Record<string, string[]> = {
      '@': ['features', 'src/features'],
      '#': ['components', 'src/components'],
      '$': ['flows', 'src/flows'],
      '^': ['middleware', 'gates', 'src/middleware'],
      '!': ['signals', 'events', 'src/signals'],
      '%': ['state', 'store', 'src/state'],
      '&': ['integrations', 'services', 'src/integrations'],
    };

    const prefix = symbol[0];
    const dirs = prefixDirs[prefix] || [];

    for (const dir of dirs) {
      paths.push(path.join(dir, cleanSymbol, '.purpose'));
      paths.push(path.join(dir, `${cleanSymbol}.purpose`));
    }

    // Also check root .paradigm/purposes
    paths.push(path.join('.paradigm', 'purposes', `${cleanSymbol}.yaml`));
    paths.push(path.join('.paradigm', 'purposes', `${cleanSymbol}.json`));

    return paths;
  }

  /**
   * Parse a .purpose file
   */
  private parsePurposeFile(content: string): PurposeFile {
    const result: PurposeFile = {};

    // Try YAML-like parsing (simple key: value)
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('symbol:')) {
        result.symbol = trimmed.substring(7).trim();
      } else if (trimmed.startsWith('description:')) {
        result.description = trimmed.substring(12).trim();
      } else if (trimmed.startsWith('purpose:')) {
        result.description = trimmed.substring(8).trim();
      }
    }

    // If no structured content, use first non-empty line as description
    if (!result.description) {
      const firstLine = lines.find((l) => l.trim() && !l.startsWith('#'));
      if (firstLine) {
        result.description = firstLine.trim();
      }
    }

    return result;
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    this.symbolCache.clear();
    this.purposeCache.clear();
  }

  /**
   * Batch enrich multiple incidents
   */
  enrichBatch(incidents: SymbolicIncidentRecord[]): EnrichedIncident[] {
    return incidents.map((i) => this.enrich(i));
  }
}
