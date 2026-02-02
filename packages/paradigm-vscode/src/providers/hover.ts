/**
 * HoverProvider - Shows symbol information on hover
 */

import * as vscode from 'vscode';
import type { IndexService } from '../services/index-service.js';
import { getSymbolAtPosition } from '../services/index-service.js';
import { SYMBOL_PREFIXES } from '@a-company/premise-core';

const TYPE_LABELS: Record<string, string> = {
  feature: 'Feature',
  component: 'Component',
  flow: 'Flow',
  state: 'State',
  gate: 'Gate',
  signal: 'Signal',
  idea: 'Idea',
  aspect: 'Deprecated',
};

const TYPE_ICONS: Record<string, string> = {
  feature: '🎯',
  component: '🧩',
  flow: '➡️',
  state: '📦',
  gate: '🔒',
  signal: '⚡',
  idea: '💡',
  aspect: '⚠️',
};

export class ParadigmHoverProvider implements vscode.HoverProvider {
  constructor(private indexService: IndexService) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const symbolMatch = getSymbolAtPosition(document, position);
    if (!symbolMatch) return null;

    const entry = this.indexService.lookup(symbolMatch.symbol);
    if (!entry) {
      // Symbol not found - show unknown symbol info
      return new vscode.Hover(
        new vscode.MarkdownString(`**${symbolMatch.symbol}** _(undefined)_\n\nThis symbol is not defined in any .purpose or portal.yaml file.`),
        symbolMatch.range
      );
    }

    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.isTrusted = true;

    // Header with type
    const icon = TYPE_ICONS[entry.type] || '•';
    const label = TYPE_LABELS[entry.type] || entry.type;
    md.appendMarkdown(`${icon} **${entry.symbol}** _(${label})_\n\n`);

    // Description
    if (entry.description) {
      md.appendMarkdown(`${entry.description}\n\n`);
    }

    // File location - make it a clickable link
    const relativePath = vscode.workspace.asRelativePath(entry.filePath);
    const fileUri = vscode.Uri.file(entry.filePath);
    md.appendMarkdown(`**File**: [${relativePath}](${fileUri})\n\n`);

    // References - show all with links
    if (entry.references.length > 0) {
      const refLinks = entry.references.map(ref => this.createSymbolLink(ref));
      md.appendMarkdown(`**References**: ${refLinks.join(', ')}\n\n`);
    }

    // Referenced by - show all with links
    if (entry.referencedBy.length > 0) {
      const refByLinks = entry.referencedBy.map(ref => this.createSymbolLink(ref));
      md.appendMarkdown(`**Used by**: ${refByLinks.join(', ')}\n\n`);
    }

    // Tags
    if (entry.tags && entry.tags.length > 0) {
      md.appendMarkdown(`**Tags**: ${entry.tags.join(', ')}\n`);
    }

    return new vscode.Hover(md, symbolMatch.range);
  }

  /**
   * Create a clickable markdown link for a symbol
   * Links to the file where the symbol is defined
   */
  private createSymbolLink(symbol: string): string {
    const entry = this.indexService.lookup(symbol);
    if (entry) {
      const fileUri = vscode.Uri.file(entry.filePath);
      const relativePath = vscode.workspace.asRelativePath(entry.filePath);
      // Create link with symbol name, tooltip shows file path
      return `[${symbol}](${fileUri} "${relativePath}")`;
    }
    // Symbol not found in index, just show plain text
    return symbol;
  }
}
