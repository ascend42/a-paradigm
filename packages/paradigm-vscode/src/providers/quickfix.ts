/**
 * QuickFixProvider - Code actions for undefined symbols
 */

import * as vscode from 'vscode';
import type { IndexService } from '../services/index-service.js';
import * as path from 'path';

const PREFIX_TO_SECTION: Record<string, string> = {
  '@': 'features',
  '#': 'components',
  '^': 'gates',
  '!': 'signals',
  '$': 'flows',
  '%': 'states',
};

export class ParadigmQuickFixProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  constructor(private indexService: IndexService) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const actions: vscode.CodeAction[] = [];

    // Find diagnostics for undefined symbols
    const undefinedSymbolDiagnostics = context.diagnostics.filter(
      (d) => d.code === 'undefined-symbol'
    );

    for (const diagnostic of undefinedSymbolDiagnostics) {
      const symbolText = document.getText(diagnostic.range);
      const prefix = symbolText[0];
      const symbolName = symbolText.substring(1);
      const section = PREFIX_TO_SECTION[prefix];

      if (!section) continue;

      // Action 1: Add to current file (if it's a .purpose file)
      if (document.fileName.endsWith('.purpose')) {
        const addAction = this.createAddToCurrentFileAction(
          document,
          symbolName,
          section,
          diagnostic
        );
        if (addAction) {
          actions.push(addAction);
        }
      }

      // Action 2: Create in nearest .purpose file
      const createAction = this.createInNearestPurposeFile(
        document,
        symbolName,
        section,
        prefix,
        diagnostic
      );
      if (createAction) {
        actions.push(createAction);
      }

      // Action 3: Ignore this symbol (suppress diagnostic)
      // Note: This would require adding to a config, skipping for now
    }

    return actions;
  }

  private createAddToCurrentFileAction(
    document: vscode.TextDocument,
    symbolName: string,
    section: string,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | null {
    const text = document.getText();

    // Check if section exists
    const sectionPattern = new RegExp(`^${section}:\\s*$`, 'im');
    const sectionMatch = text.match(sectionPattern);

    const action = new vscode.CodeAction(
      `Add '${symbolName}' to ${section} in current file`,
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];
    action.isPreferred = true;

    const edit = new vscode.WorkspaceEdit();

    if (sectionMatch) {
      // Find the section and add item after it
      const sectionLine = this.findLineNumber(document, sectionPattern);
      if (sectionLine !== null) {
        // Find the end of the section to insert at
        const insertPosition = this.findSectionInsertPosition(document, sectionLine);
        const indent = '  ';
        const snippet = `${indent}${symbolName}:\n${indent}${indent}description: TODO - add description\n`;

        edit.insert(document.uri, new vscode.Position(insertPosition, 0), snippet);
      }
    } else {
      // Add new section at the end
      const lastLine = document.lineCount - 1;
      const snippet = `\n${section}:\n  ${symbolName}:\n    description: TODO - add description\n`;

      edit.insert(
        document.uri,
        new vscode.Position(lastLine, document.lineAt(lastLine).text.length),
        snippet
      );
    }

    action.edit = edit;
    return action;
  }

  private createInNearestPurposeFile(
    document: vscode.TextDocument,
    symbolName: string,
    section: string,
    prefix: string,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | null {
    // Find the nearest .purpose file in the directory hierarchy
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) return null;

    const action = new vscode.CodeAction(
      `Create '${prefix}${symbolName}' in new .purpose file`,
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];

    // This action will create a new .purpose file
    action.command = {
      command: 'paradigm.createSymbol',
      title: 'Create Symbol',
      arguments: [symbolName, section, document.uri],
    };

    return action;
  }

  private findLineNumber(
    document: vscode.TextDocument,
    pattern: RegExp
  ): number | null {
    for (let i = 0; i < document.lineCount; i++) {
      if (pattern.test(document.lineAt(i).text)) {
        return i;
      }
    }
    return null;
  }

  private findSectionInsertPosition(
    document: vscode.TextDocument,
    sectionLine: number
  ): number {
    // Find the last line of items in this section
    let lastItemLine = sectionLine + 1;

    for (let i = sectionLine + 1; i < document.lineCount; i++) {
      const line = document.lineAt(i).text;

      // Empty lines within section are OK
      if (line.trim() === '') {
        continue;
      }

      // Check if this is still part of the section (indented)
      if (line.match(/^\s+/)) {
        lastItemLine = i + 1;
      } else {
        // Hit a new section or non-indented content
        break;
      }
    }

    return lastItemLine;
  }
}

/**
 * Command to create a new symbol
 */
export async function createSymbolCommand(
  symbolName: string,
  section: string,
  sourceUri: vscode.Uri
): Promise<void> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  // Determine the directory for the new .purpose file
  const sourceDir = path.dirname(sourceUri.fsPath);
  const purposeFileName = '.purpose';
  const purposePath = path.join(sourceDir, purposeFileName);

  const purposeUri = vscode.Uri.file(purposePath);

  // Check if file exists
  let content: string;
  try {
    const existingDoc = await vscode.workspace.openTextDocument(purposeUri);
    content = existingDoc.getText();

    // Add to existing file
    const edit = new vscode.WorkspaceEdit();
    const sectionPattern = new RegExp(`^${section}:\\s*$`, 'im');

    if (sectionPattern.test(content)) {
      // Find section and add item
      const lines = content.split('\n');
      let insertLine = 0;

      for (let i = 0; i < lines.length; i++) {
        if (sectionPattern.test(lines[i])) {
          // Find end of section
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim() === '' || lines[j].match(/^\s+/)) {
              insertLine = j + 1;
            } else {
              break;
            }
          }
          break;
        }
      }

      const snippet = `  ${symbolName}:\n    description: TODO - add description\n`;
      edit.insert(purposeUri, new vscode.Position(insertLine, 0), snippet);
    } else {
      // Add new section at end
      const lastLine = existingDoc.lineCount - 1;
      const snippet = `\n${section}:\n  ${symbolName}:\n    description: TODO - add description\n`;
      edit.insert(
        purposeUri,
        new vscode.Position(lastLine, existingDoc.lineAt(lastLine).text.length),
        snippet
      );
    }

    await vscode.workspace.applyEdit(edit);
  } catch {
    // Create new file
    content = `# Purpose file for ${path.basename(sourceDir)}\ndescription: TODO - add description\n\n${section}:\n  ${symbolName}:\n    description: TODO - add description\n`;

    const edit = new vscode.WorkspaceEdit();
    edit.createFile(purposeUri, { ignoreIfExists: true });
    edit.insert(purposeUri, new vscode.Position(0, 0), content);
    await vscode.workspace.applyEdit(edit);
  }

  // Open the file
  const doc = await vscode.workspace.openTextDocument(purposeUri);
  await vscode.window.showTextDocument(doc);
}
