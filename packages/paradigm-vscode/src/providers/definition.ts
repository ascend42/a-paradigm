/**
 * DefinitionProvider - Go-to-definition for Paradigm symbols
 */

import * as vscode from 'vscode';
import type { IndexService } from '../services/index-service.js';
import { getSymbolAtPosition } from '../services/index-service.js';

export class ParadigmDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private indexService: IndexService) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Definition | vscode.LocationLink[] | null> {
    const symbolMatch = getSymbolAtPosition(document, position);
    if (!symbolMatch) return null;

    const entry = this.indexService.lookup(symbolMatch.symbol);
    if (!entry) return null;

    // Find the exact position in the file
    const targetUri = vscode.Uri.file(entry.filePath);

    try {
      const targetDoc = await vscode.workspace.openTextDocument(targetUri);
      const symbolName = symbolMatch.symbol.substring(1); // Remove prefix

      // Search for the symbol definition in the file
      for (let lineNum = 0; lineNum < targetDoc.lineCount; lineNum++) {
        const line = targetDoc.lineAt(lineNum).text;

        // Look for YAML key definition patterns:
        // "  feature-name:" or "- id: feature-name"
        const keyMatch = line.match(new RegExp(`^\\s*${symbolName}:\\s*`, 'i'));
        const idMatch = line.match(new RegExp(`id:\\s*['"]?${symbolName}['"]?`, 'i'));

        if (keyMatch || idMatch) {
          const startCol = line.indexOf(symbolName);
          const range = new vscode.Range(
            lineNum,
            startCol >= 0 ? startCol : 0,
            lineNum,
            startCol >= 0 ? startCol + symbolName.length : line.length
          );

          return new vscode.Location(targetUri, range);
        }
      }

      // Fallback to file start if we can't find the exact position
      return new vscode.Location(targetUri, new vscode.Position(0, 0));
    } catch {
      // If we can't open the file, just return the file location
      return new vscode.Location(targetUri, new vscode.Position(0, 0));
    }
  }
}

export class ParadigmReferenceProvider implements vscode.ReferenceProvider {
  constructor(private indexService: IndexService) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.Location[] | null> {
    const symbolMatch = getSymbolAtPosition(document, position);
    if (!symbolMatch) return null;

    const locations: vscode.Location[] = [];

    // Get the entry for this symbol
    const entry = this.indexService.lookup(symbolMatch.symbol);

    // Include definition if requested
    if (context.includeDeclaration && entry) {
      locations.push(new vscode.Location(
        vscode.Uri.file(entry.filePath),
        new vscode.Position(0, 0)
      ));
    }

    // Find all files that reference this symbol
    const referencingEntries = this.indexService.getReferencesTo(symbolMatch.symbol);

    for (const refEntry of referencingEntries) {
      try {
        const uri = vscode.Uri.file(refEntry.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);

        // Search for the symbol in the file
        for (let lineNum = 0; lineNum < doc.lineCount; lineNum++) {
          const line = doc.lineAt(lineNum).text;
          let index = line.indexOf(symbolMatch.symbol);

          while (index !== -1) {
            locations.push(new vscode.Location(
              uri,
              new vscode.Range(lineNum, index, lineNum, index + symbolMatch.symbol.length)
            ));
            index = line.indexOf(symbolMatch.symbol, index + 1);
          }
        }
      } catch {
        // Skip files we can't open
      }
    }

    // Also search all open .purpose files for direct text references
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.fileName.endsWith('.purpose') || doc.fileName.endsWith('.yaml')) {
        for (let lineNum = 0; lineNum < doc.lineCount; lineNum++) {
          const line = doc.lineAt(lineNum).text;
          let index = line.indexOf(symbolMatch.symbol);

          while (index !== -1) {
            const loc = new vscode.Location(
              doc.uri,
              new vscode.Range(lineNum, index, lineNum, index + symbolMatch.symbol.length)
            );

            // Avoid duplicates
            if (!locations.some(l =>
              l.uri.fsPath === loc.uri.fsPath &&
              l.range.start.line === loc.range.start.line &&
              l.range.start.character === loc.range.start.character
            )) {
              locations.push(loc);
            }

            index = line.indexOf(symbolMatch.symbol, index + 1);
          }
        }
      }
    }

    return locations;
  }
}
