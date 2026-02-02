/**
 * IndexService - Manages the SymbolIndex lifecycle and file watching
 */

import * as vscode from 'vscode';
import {
  type SymbolIndex,
  type SymbolEntry,
  buildSymbolIndex,
  getSymbol,
  getSymbolsByType,
  searchSymbols,
  getReferencesTo,
  getReferencesFrom,
  getAutocompleteSuggestions,
  getAllSymbols,
  parseSymbol,
  aggregateFromDirectory,
} from '@a-company/premise-core';

export class IndexService implements vscode.Disposable {
  private index: SymbolIndex | null = null;
  private watchers: vscode.FileSystemWatcher[] = [];
  private _onDidUpdateIndex = new vscode.EventEmitter<SymbolIndex>();
  private isBuilding = false;
  private buildQueue: (() => void)[] = [];

  public readonly onDidUpdateIndex = this._onDidUpdateIndex.event;

  constructor(
    private readonly workspaceRoot: string,
    private readonly log: (msg: string) => void = console.log
  ) {}

  /**
   * Initialize the index service
   */
  async initialize(): Promise<void> {
    await this.rebuild();
    this.setupWatchers();
  }

  /**
   * Get the current symbol index
   */
  getIndex(): SymbolIndex | null {
    return this.index;
  }

  /**
   * Lookup a symbol by its full name (e.g., "@checkout")
   */
  lookup(symbol: string): SymbolEntry | undefined {
    if (!this.index) return undefined;
    return getSymbol(this.index, symbol);
  }

  /**
   * Search symbols by query string
   */
  search(query: string): SymbolEntry[] {
    if (!this.index) return [];
    return searchSymbols(this.index, query);
  }

  /**
   * Get autocomplete suggestions for a partial symbol
   */
  autocomplete(partial: string, limit = 10): SymbolEntry[] {
    if (!this.index) return [];
    return getAutocompleteSuggestions(this.index, partial, limit);
  }

  /**
   * Get all symbols that reference a given symbol
   */
  getReferencesTo(symbol: string): SymbolEntry[] {
    if (!this.index) return [];
    return getReferencesTo(this.index, symbol);
  }

  /**
   * Get all symbols that a given symbol references
   */
  getReferencesFrom(symbol: string): SymbolEntry[] {
    if (!this.index) return [];
    return getReferencesFrom(this.index, symbol);
  }

  /**
   * Get all symbols of a specific type
   */
  getByType(type: string): SymbolEntry[] {
    if (!this.index) return [];
    return getSymbolsByType(this.index, type as any) || [];
  }

  /**
   * Get all symbols
   */
  getAllSymbols(): SymbolEntry[] {
    if (!this.index) return [];
    return getAllSymbols(this.index);
  }

  /**
   * Rebuild the symbol index
   */
  async rebuild(): Promise<void> {
    if (this.isBuilding) {
      return new Promise((resolve) => {
        this.buildQueue.push(resolve);
      });
    }

    this.isBuilding = true;

    try {
      this.log(`Building index from: ${this.workspaceRoot}`);
      const result = await aggregateFromDirectory(this.workspaceRoot);
      this.log(`Found ${result.purposeFiles.length} .purpose files`);
      for (const f of result.purposeFiles) {
        this.log(`  - ${f}`);
      }
      if (result.errors.length > 0) {
        this.log(`Errors during aggregation:`);
        for (const e of result.errors) {
          this.log(`  - ${e.source}: ${e.filePath}: ${e.message}`);
        }
      }
      this.log(`Extracted ${result.symbols.length} symbols`);
      this.index = buildSymbolIndex(result);
      this.log(`Index built with ${this.getAllSymbols().length} symbols`);
      this._onDidUpdateIndex.fire(this.index);
    } catch (error) {
      this.log(`Failed to build symbol index: ${error}`);
    } finally {
      this.isBuilding = false;

      // Process queued rebuilds
      const queued = this.buildQueue.shift();
      if (queued) {
        queued();
        if (this.buildQueue.length > 0) {
          this.rebuild();
        }
      }
    }
  }

  /**
   * Setup file watchers
   */
  private setupWatchers(): void {
    const patterns = ['**/*.purpose', '**/portal.yaml', '**/.paradigm/config.yaml'];

    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(this.workspaceRoot, pattern)
      );

      watcher.onDidCreate(() => this.debouncedRebuild());
      watcher.onDidChange(() => this.debouncedRebuild());
      watcher.onDidDelete(() => this.debouncedRebuild());

      this.watchers.push(watcher);
    }
  }

  private rebuildTimeout: NodeJS.Timeout | null = null;

  private debouncedRebuild(): void {
    if (this.rebuildTimeout) {
      clearTimeout(this.rebuildTimeout);
    }

    this.rebuildTimeout = setTimeout(() => {
      this.rebuild();
      this.rebuildTimeout = null;
    }, 500);
  }

  dispose(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this._onDidUpdateIndex.dispose();
    if (this.rebuildTimeout) {
      clearTimeout(this.rebuildTimeout);
    }
  }
}

/**
 * Parse a symbol string into its components
 */
export function parseSymbolString(symbol: string): { type: string; name: string } | null {
  const result = parseSymbol(symbol);
  if (!result) return null;
  return {
    type: result.type,
    name: result.name,
  };
}

/**
 * Get the symbol at a position in a document
 */
export function getSymbolAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): { symbol: string; range: vscode.Range } | null {
  const symbolPattern = /[@#$%^!?~&][a-zA-Z][a-zA-Z0-9._-]*/g;
  const line = document.lineAt(position.line).text;
  let match;

  while ((match = symbolPattern.exec(line)) !== null) {
    const startCol = match.index;
    const endCol = match.index + match[0].length;

    if (position.character >= startCol && position.character <= endCol) {
      return {
        symbol: match[0],
        range: new vscode.Range(
          position.line,
          startCol,
          position.line,
          endCol
        ),
      };
    }
  }

  return null;
}

/**
 * Find all symbols in a document
 */
export function findSymbolsInDocument(
  document: vscode.TextDocument
): Array<{ symbol: string; range: vscode.Range }> {
  const symbols: Array<{ symbol: string; range: vscode.Range }> = [];
  const symbolPattern = /[@#$%^!?~&][a-zA-Z][a-zA-Z0-9._-]*/g;

  for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
    const line = document.lineAt(lineNum).text;
    let match;

    while ((match = symbolPattern.exec(line)) !== null) {
      symbols.push({
        symbol: match[0],
        range: new vscode.Range(
          lineNum,
          match.index,
          lineNum,
          match.index + match[0].length
        ),
      });
    }
  }

  return symbols;
}
