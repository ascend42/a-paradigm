/**
 * DocumentSymbolProvider - Provides outline view for .purpose files
 */

import * as vscode from 'vscode';
import type { IndexService } from '../services/index-service.js';
import { parsePurposeFile, type PurposeFile, type PurposeItem } from '@a-company/purpose-core';

const SECTION_SYMBOLS: Record<string, vscode.SymbolKind> = {
  features: vscode.SymbolKind.Function,
  components: vscode.SymbolKind.Class,
  gates: vscode.SymbolKind.Key,
  signals: vscode.SymbolKind.Event,
  flows: vscode.SymbolKind.Module,
  states: vscode.SymbolKind.Variable,
};

const SECTION_PREFIXES: Record<string, string> = {
  features: '@',
  components: '#',
  gates: '^',
  signals: '!',
  flows: '$',
  states: '%',
};

export class ParadigmDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private indexService: IndexService) {}

  provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    if (!document.fileName.endsWith('.purpose')) {
      return [];
    }

    const symbols: vscode.DocumentSymbol[] = [];
    const text = document.getText();

    // Parse the purpose file
    const parsed = parsePurposeFile(document.uri.fsPath);
    if (!parsed) return [];

    // Find section positions in the document
    const sections = ['features', 'components', 'gates', 'signals', 'flows', 'states'];

    for (const section of sections) {
      const sectionData = (parsed as any)[section];
      if (!sectionData) continue;

      const sectionRange = this.findSectionRange(document, section);
      if (!sectionRange) continue;

      const sectionSymbol = new vscode.DocumentSymbol(
        section,
        '',
        vscode.SymbolKind.Namespace,
        sectionRange,
        sectionRange
      );

      // Add items within the section
      const items = this.getSectionItems(sectionData);
      const prefix = SECTION_PREFIXES[section] || '';
      const kind = SECTION_SYMBOLS[section] || vscode.SymbolKind.Property;

      for (const item of items) {
        const itemRange = this.findItemRange(document, item.name, sectionRange);
        if (itemRange) {
          const itemSymbol = new vscode.DocumentSymbol(
            `${prefix}${item.name}`,
            item.description || '',
            kind,
            itemRange,
            itemRange
          );
          sectionSymbol.children.push(itemSymbol);
        }
      }

      if (sectionSymbol.children.length > 0 || sectionData) {
        symbols.push(sectionSymbol);
      }
    }

    return symbols;
  }

  private getSectionItems(sectionData: any): Array<{ name: string; description?: string }> {
    if (Array.isArray(sectionData)) {
      return sectionData.map((item) => ({
        name: item.id || item.name || '',
        description: item.description,
      }));
    } else if (typeof sectionData === 'object') {
      return Object.entries(sectionData).map(([name, data]) => ({
        name,
        description: typeof data === 'object' ? (data as any).description : undefined,
      }));
    }
    return [];
  }

  private findSectionRange(
    document: vscode.TextDocument,
    section: string
  ): vscode.Range | null {
    const pattern = new RegExp(`^${section}:\\s*$`, 'im');

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (pattern.test(text)) {
        // Find the end of this section (next section or EOF)
        let endLine = document.lineCount - 1;
        const nextSectionPattern = /^[a-z]+:\s*$/i;

        for (let nextLine = line + 1; nextLine < document.lineCount; nextLine++) {
          const nextText = document.lineAt(nextLine).text;
          if (nextSectionPattern.test(nextText) && !nextText.startsWith(' ')) {
            endLine = nextLine - 1;
            break;
          }
        }

        return new vscode.Range(line, 0, endLine, document.lineAt(endLine).text.length);
      }
    }

    return null;
  }

  private findItemRange(
    document: vscode.TextDocument,
    itemName: string,
    sectionRange: vscode.Range
  ): vscode.Range | null {
    const keyPattern = new RegExp(`^\\s+${itemName}:\\s*`, 'i');
    const idPattern = new RegExp(`id:\\s*['"]?${itemName}['"]?`, 'i');

    for (let line = sectionRange.start.line; line <= sectionRange.end.line; line++) {
      const text = document.lineAt(line).text;
      if (keyPattern.test(text) || idPattern.test(text)) {
        // Find the end of this item
        let endLine = line;
        const currentIndent = text.search(/\S/);

        for (let nextLine = line + 1; nextLine <= sectionRange.end.line; nextLine++) {
          const nextText = document.lineAt(nextLine).text;
          if (nextText.trim() === '') continue;

          const nextIndent = nextText.search(/\S/);
          if (nextIndent <= currentIndent) {
            break;
          }
          endLine = nextLine;
        }

        return new vscode.Range(line, 0, endLine, document.lineAt(endLine).text.length);
      }
    }

    return null;
  }
}

export class ParadigmWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
  constructor(private indexService: IndexService) {}

  provideWorkspaceSymbols(
    query: string,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.SymbolInformation[]> {
    const results = this.indexService.search(query);

    return results.map((entry) => {
      const kind = this.getSymbolKind(entry.type);
      const location = new vscode.Location(
        vscode.Uri.file(entry.filePath),
        new vscode.Position(0, 0)
      );

      return new vscode.SymbolInformation(
        entry.symbol,
        kind,
        entry.description || '',
        location
      );
    });
  }

  private getSymbolKind(type: string): vscode.SymbolKind {
    switch (type) {
      case 'feature':
        return vscode.SymbolKind.Function;
      case 'component':
        return vscode.SymbolKind.Class;
      case 'gate':
        return vscode.SymbolKind.Key;
      case 'signal':
        return vscode.SymbolKind.Event;
      case 'flow':
        return vscode.SymbolKind.Module;
      case 'state':
        return vscode.SymbolKind.Variable;
      case 'idea':
        return vscode.SymbolKind.Interface;
      case 'aspect':
        return vscode.SymbolKind.Constant;
      default:
        return vscode.SymbolKind.Property;
    }
  }
}
