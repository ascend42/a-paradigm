/**
 * CodeLensProvider - Shows reference counts above symbol definitions
 */

import * as vscode from 'vscode';
import type { IndexService } from '../services/index-service.js';

const SECTION_PREFIXES: Record<string, string> = {
  features: '@',
  components: '#',
  gates: '^',
  signals: '!',
  flows: '$',
  states: '%',
};

export class ParadigmCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private indexService: IndexService) {
    // Refresh code lenses when index updates
    indexService.onDidUpdateIndex(() => {
      this._onDidChangeCodeLenses.fire();
    });
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    if (!document.fileName.endsWith('.purpose')) {
      return [];
    }

    const config = vscode.workspace.getConfiguration('paradigm');
    if (!config.get('enableCodeLens', true)) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    let currentSection: string | null = null;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      // Detect section headers
      const sectionMatch = line.match(/^(features|components|gates|signals|flows|states):\s*$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        continue;
      }

      // Detect item definitions (indented keys)
      if (currentSection) {
        const itemMatch = line.match(/^  ([a-zA-Z][a-zA-Z0-9_-]*):\s*$/);
        if (itemMatch) {
          const itemName = itemMatch[1];
          const prefix = SECTION_PREFIXES[currentSection] || '';
          const symbol = `${prefix}${itemName}`;

          const entry = this.indexService.lookup(symbol);
          if (entry) {
            const refCount = entry.referencedBy.length;
            const range = new vscode.Range(lineNum, 0, lineNum, line.length);

            // Create CodeLens showing reference count
            const lens = new vscode.CodeLens(range, {
              title: refCount === 0
                ? '$(eye-closed) No references'
                : refCount === 1
                  ? '$(eye) 1 reference'
                  : `$(eye) ${refCount} references`,
              command: 'paradigm.findReferences',
              arguments: [symbol, entry.filePath],
              tooltip: `Find all references to ${symbol}`,
            });

            codeLenses.push(lens);
          }
        }
      }

      // Reset section on unindented line that's not a section header
      if (line.match(/^[a-z]/) && !line.match(/^(features|components|gates|signals|flows|states):/)) {
        currentSection = null;
      }
    }

    return codeLenses;
  }

  resolveCodeLens(
    codeLens: vscode.CodeLens,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens> {
    return codeLens;
  }
}
