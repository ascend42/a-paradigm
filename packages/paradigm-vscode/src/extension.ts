/**
 * Paradigm VS Code Extension
 *
 * Provides rich IDE support for the Paradigm symbol system:
 * - Symbol highlighting in .purpose, .yaml, .md, .ts, .js files
 * - Hover information for symbols
 * - Go-to-definition
 * - Find all references
 * - Diagnostics for .purpose files
 * - Document outline
 * - CodeLens with reference counts
 * - Symbol autocomplete
 * - Quick fixes for undefined symbols
 */

import * as vscode from 'vscode';
import { IndexService } from './services/index-service.js';
import { ParadigmHoverProvider } from './providers/hover.js';
import { ParadigmDefinitionProvider, ParadigmReferenceProvider } from './providers/definition.js';
import { DiagnosticsProvider } from './providers/diagnostics.js';
import {
  ParadigmDocumentSymbolProvider,
  ParadigmWorkspaceSymbolProvider,
} from './providers/symbols.js';
import { ParadigmCodeLensProvider } from './providers/codelens.js';
import { ParadigmCompletionProvider, COMPLETION_TRIGGER_CHARACTERS } from './providers/completion.js';
import { ParadigmQuickFixProvider, createSymbolCommand } from './providers/quickfix.js';

let indexService: IndexService | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;
let outputChannel: vscode.OutputChannel | null = null;

function log(message: string): void {
  outputChannel?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

// Document selectors for various file types
const PURPOSE_SELECTOR: vscode.DocumentSelector = { language: 'purpose' };
const YAML_SELECTOR: vscode.DocumentSelector = { language: 'yaml' };
const MARKDOWN_SELECTOR: vscode.DocumentSelector = { language: 'markdown' };
const TYPESCRIPT_SELECTOR: vscode.DocumentSelector = [
  { language: 'typescript' },
  { language: 'typescriptreact' },
];
const JAVASCRIPT_SELECTOR: vscode.DocumentSelector = [
  { language: 'javascript' },
  { language: 'javascriptreact' },
];

// Combined selector for all supported languages
const ALL_SELECTORS: vscode.DocumentSelector = [
  PURPOSE_SELECTOR,
  YAML_SELECTOR,
  MARKDOWN_SELECTOR,
  ...TYPESCRIPT_SELECTOR,
  ...JAVASCRIPT_SELECTOR,
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Create output channel first
  outputChannel = vscode.window.createOutputChannel('Paradigm');
  context.subscriptions.push(outputChannel);
  outputChannel.show(true);

  log('Paradigm extension activating...');

  // Get workspace root
  const workspaceFolders = vscode.workspace.workspaceFolders;
  log(`Workspace folders: ${workspaceFolders?.length ?? 0}`);

  if (!workspaceFolders || workspaceFolders.length === 0) {
    log('No workspace folder found, Paradigm extension not activated');
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  log(`Workspace root: ${workspaceRoot}`);

  try {
    // Initialize index service
    log('Creating IndexService...');
    indexService = new IndexService(workspaceRoot, log);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    statusBarItem.text = '$(sync~spin) Paradigm';
    statusBarItem.tooltip = 'Paradigm: Building symbol index...';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Initialize index
    log('Initializing index...');
    await indexService.initialize();
    log(`Index ready with ${indexService.getAllSymbols().length} symbols`);
    updateStatusBar('ready');

    // Register index update handler
    context.subscriptions.push(
      indexService.onDidUpdateIndex(() => {
        updateStatusBar('ready');
      })
    );

    // Register providers
    log('Registering providers...');
    registerProviders(context, indexService);

    // Register commands
    log('Registering commands...');
    registerCommands(context, indexService);

    log('Paradigm extension activated successfully');
  } catch (error) {
    log(`FATAL ERROR during activation: ${error}`);
    if (error instanceof Error) {
      log(`Stack: ${error.stack}`);
    }
    updateStatusBar('error');
  }

  console.log('Paradigm extension activated');
}

function registerProviders(
  context: vscode.ExtensionContext,
  indexService: IndexService
): void {
  // Hover provider - all file types
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      ALL_SELECTORS,
      new ParadigmHoverProvider(indexService)
    )
  );

  // Definition provider - all file types
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      ALL_SELECTORS,
      new ParadigmDefinitionProvider(indexService)
    )
  );

  // Reference provider - all file types
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider(
      ALL_SELECTORS,
      new ParadigmReferenceProvider(indexService)
    )
  );

  // Diagnostics provider - .purpose files
  context.subscriptions.push(new DiagnosticsProvider(indexService));

  // Document symbol provider - .purpose files
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      PURPOSE_SELECTOR,
      new ParadigmDocumentSymbolProvider(indexService)
    )
  );

  // Workspace symbol provider
  context.subscriptions.push(
    vscode.languages.registerWorkspaceSymbolProvider(
      new ParadigmWorkspaceSymbolProvider(indexService)
    )
  );

  // CodeLens provider - .purpose files
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      PURPOSE_SELECTOR,
      new ParadigmCodeLensProvider(indexService)
    )
  );

  // Completion provider - all file types
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      ALL_SELECTORS,
      new ParadigmCompletionProvider(indexService),
      ...COMPLETION_TRIGGER_CHARACTERS
    )
  );

  // Quick fix provider - .purpose files
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      PURPOSE_SELECTOR,
      new ParadigmQuickFixProvider(indexService),
      {
        providedCodeActionKinds: ParadigmQuickFixProvider.providedCodeActionKinds,
      }
    )
  );
}

function registerCommands(
  context: vscode.ExtensionContext,
  indexService: IndexService
): void {
  // Rebuild index command
  context.subscriptions.push(
    vscode.commands.registerCommand('paradigm.rebuildIndex', async () => {
      updateStatusBar('building');
      try {
        await indexService.rebuild();
        vscode.window.showInformationMessage('Paradigm: Symbol index rebuilt');
        updateStatusBar('ready');
      } catch (error) {
        vscode.window.showErrorMessage(`Paradigm: Failed to rebuild index - ${error}`);
        updateStatusBar('error');
      }
    })
  );

  // Show symbol info command
  context.subscriptions.push(
    vscode.commands.registerCommand('paradigm.showSymbol', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter symbol (e.g., @checkout, #Button)',
        placeHolder: '@feature-name',
      });

      if (!input) return;

      const entry = indexService.lookup(input);
      if (!entry) {
        vscode.window.showWarningMessage(`Symbol '${input}' not found`);
        return;
      }

      // Open the file at the symbol location
      const doc = await vscode.workspace.openTextDocument(entry.filePath);
      await vscode.window.showTextDocument(doc);
    })
  );

  // Find references command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'paradigm.findReferences',
      async (symbol?: string, filePath?: string) => {
        if (!symbol) {
          // Get symbol at cursor
          const editor = vscode.window.activeTextEditor;
          if (!editor) return;

          const { getSymbolAtPosition } = await import('./services/index-service.js');
          const match = getSymbolAtPosition(editor.document, editor.selection.active);
          if (!match) {
            vscode.window.showWarningMessage('No symbol at cursor position');
            return;
          }
          symbol = match.symbol;
        }

        // Execute the built-in find references command
        await vscode.commands.executeCommand('references-view.findReferences');
      }
    )
  );

  // Create symbol command (used by quick fix)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'paradigm.createSymbol',
      createSymbolCommand
    )
  );
}

function updateStatusBar(state: 'ready' | 'building' | 'error'): void {
  if (!statusBarItem) return;

  switch (state) {
    case 'ready':
      const symbolCount = indexService?.getAllSymbols().length || 0;
      statusBarItem.text = `$(symbol-misc) Paradigm`;
      statusBarItem.tooltip = `Paradigm: ${symbolCount} symbols indexed`;
      statusBarItem.backgroundColor = undefined;
      break;
    case 'building':
      statusBarItem.text = '$(sync~spin) Paradigm';
      statusBarItem.tooltip = 'Paradigm: Building symbol index...';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'error':
      statusBarItem.text = '$(warning) Paradigm';
      statusBarItem.tooltip = 'Paradigm: Error building index';
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.errorBackground'
      );
      break;
  }
}

export function deactivate(): void {
  console.log('Paradigm extension deactivating...');
  indexService?.dispose();
  indexService = null;
}
