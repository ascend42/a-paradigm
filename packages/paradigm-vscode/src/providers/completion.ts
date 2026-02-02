/**
 * CompletionProvider - Symbol autocomplete suggestions
 */

import * as vscode from 'vscode';
import type { IndexService } from '../services/index-service.js';
import type { SymbolEntry } from '@a-company/premise-core';

const TRIGGER_CHARACTERS = ['@', '#', '^', '!', '$', '%', '?', '~', '&'];

const TYPE_ICONS: Record<string, vscode.CompletionItemKind> = {
  feature: vscode.CompletionItemKind.Function,
  component: vscode.CompletionItemKind.Class,
  gate: vscode.CompletionItemKind.Key,
  signal: vscode.CompletionItemKind.Event,
  flow: vscode.CompletionItemKind.Module,
  state: vscode.CompletionItemKind.Variable,
  idea: vscode.CompletionItemKind.Interface,
  aspect: vscode.CompletionItemKind.Constant,
};

const PREFIX_TO_TYPE: Record<string, string> = {
  '@': 'feature',
  '#': 'component',
  '^': 'gate',
  '!': 'signal',
  '$': 'flow',
  '%': 'state',
  '?': 'idea',
  '~': 'aspect',
  '&': 'integration',
};

export class ParadigmCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private indexService: IndexService) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const config = vscode.workspace.getConfiguration('paradigm');
    if (!config.get('enableAutoComplete', true)) {
      return [];
    }

    const line = document.lineAt(position.line).text;
    const textBeforeCursor = line.substring(0, position.character);

    // Check if we're in a context where symbols make sense
    const symbolMatch = textBeforeCursor.match(/[@#$%^!?~&][a-zA-Z0-9_-]*$/);
    if (!symbolMatch) {
      // Check if the trigger character was just typed
      if (context.triggerCharacter && TRIGGER_CHARACTERS.includes(context.triggerCharacter)) {
        return this.getCompletionsForPrefix(context.triggerCharacter, '');
      }
      return [];
    }

    const prefix = symbolMatch[0][0];
    const partial = symbolMatch[0];

    return this.getCompletionsForPrefix(prefix, partial);
  }

  private getCompletionsForPrefix(
    prefix: string,
    partial: string
  ): vscode.CompletionItem[] {
    // Get suggestions from index
    const suggestions = partial.length > 1
      ? this.indexService.autocomplete(partial, 20)
      : this.indexService.getByType(PREFIX_TO_TYPE[prefix] || '').slice(0, 20);

    const items: vscode.CompletionItem[] = [];

    for (const entry of suggestions) {
      const item = this.createCompletionItem(entry);
      items.push(item);
    }

    return items;
  }

  private createCompletionItem(entry: SymbolEntry): vscode.CompletionItem {
    const item = new vscode.CompletionItem(
      entry.symbol,
      TYPE_ICONS[entry.type] || vscode.CompletionItemKind.Reference
    );

    // Remove the prefix from insertText since user already typed it
    item.insertText = entry.symbol.substring(1);
    item.filterText = entry.symbol;
    item.sortText = entry.symbol;

    // Add detail and documentation
    item.detail = entry.type.charAt(0).toUpperCase() + entry.type.slice(1);
    if (entry.description) {
      item.documentation = new vscode.MarkdownString(entry.description);
    }

    // Add file path to detail
    const relativePath = vscode.workspace.asRelativePath(entry.filePath);
    item.detail = `${item.detail} • ${relativePath}`;

    return item;
  }
}

export const COMPLETION_TRIGGER_CHARACTERS = TRIGGER_CHARACTERS;
