/**
 * DiagnosticsProvider - Validates .purpose files and reports errors
 */

import * as vscode from 'vscode';
import type { IndexService } from '../services/index-service.js';
import { findSymbolsInDocument } from '../services/index-service.js';
import {
  parsePurposeFileDetailed,
  validatePurposeFile,
  type ParseError,
  type ValidationIssue,
} from '@a-company/purpose-core';
import * as fs from 'fs';
import * as path from 'path';

export class DiagnosticsProvider implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  constructor(private indexService: IndexService) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('paradigm');

    // Subscribe to document events
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.validateDocument(doc)),
      vscode.workspace.onDidSaveTextDocument((doc) => this.validateDocument(doc)),
      vscode.workspace.onDidChangeTextDocument((e) => this.validateDocument(e.document)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.clearDiagnostics(doc))
    );

    // Subscribe to index updates
    this.disposables.push(
      indexService.onDidUpdateIndex(() => this.validateAllOpenDocuments())
    );

    // Validate all open documents on init
    this.validateAllOpenDocuments();
  }

  private async validateDocument(document: vscode.TextDocument): Promise<void> {
    if (!this.isPurposeFile(document)) {
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];

    // Parse the file
    const content = document.getText();
    const parseResult = parsePurposeFileDetailed(document.uri.fsPath);

    // Add parse errors
    for (const error of parseResult.detailedErrors) {
      const line = error.line ?? 0;
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
        error.message,
        this.getSeverity(error.type)
      );
      diagnostic.source = 'paradigm';
      diagnostic.code = error.type;
      diagnostics.push(diagnostic);
    }

    // If YAML is valid, run semantic validation
    if (parseResult.isYamlValid && parseResult.data) {
      const validation = validatePurposeFile(parseResult.data);

      for (const issue of validation.issues) {
        const line = issue.line ?? 0;
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
          issue.message,
          issue.type === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = 'paradigm';
        diagnostics.push(diagnostic);
      }
    }

    // Check for undefined symbol references
    const symbolsInDoc = findSymbolsInDocument(document);
    for (const { symbol, range } of symbolsInDoc) {
      // Skip symbols that are being defined (YAML keys)
      const line = document.lineAt(range.start.line).text;
      const beforeSymbol = line.substring(0, range.start.character).trim();

      // If the symbol appears right after a YAML key pattern, it's likely a reference, not a definition
      if (beforeSymbol.endsWith(':') || beforeSymbol.endsWith('-') || beforeSymbol.endsWith('[') || beforeSymbol === '') {
        // Check if symbol exists in index
        const entry = this.indexService.lookup(symbol);
        if (!entry) {
          // Check if it's defined locally in this file
          const symbolName = symbol.substring(1);
          const localDef = this.isDefinedLocally(document, symbolName);

          if (!localDef) {
            const diagnostic = new vscode.Diagnostic(
              range,
              `Unknown symbol '${symbol}' - not defined in any .purpose or portal.yaml file`,
              vscode.DiagnosticSeverity.Warning
            );
            diagnostic.source = 'paradigm';
            diagnostic.code = 'undefined-symbol';
            diagnostics.push(diagnostic);
          }
        } else if (entry.type === 'aspect') {
          // Warn about deprecated symbols
          const diagnostic = new vscode.Diagnostic(
            range,
            `Symbol '${symbol}' is marked as deprecated`,
            vscode.DiagnosticSeverity.Information
          );
          diagnostic.source = 'paradigm';
          diagnostic.code = 'deprecated-symbol';
          diagnostics.push(diagnostic);
        }
      }
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private isDefinedLocally(document: vscode.TextDocument, symbolName: string): boolean {
    const text = document.getText();
    // Check for YAML key definition
    const keyPattern = new RegExp(`^\\s*${symbolName}:\\s*`, 'im');
    const idPattern = new RegExp(`id:\\s*['"]?${symbolName}['"]?`, 'im');
    return keyPattern.test(text) || idPattern.test(text);
  }

  private getSeverity(errorType: string): vscode.DiagnosticSeverity {
    switch (errorType) {
      case 'yaml':
        return vscode.DiagnosticSeverity.Error;
      case 'schema':
        return vscode.DiagnosticSeverity.Error;
      case 'file':
        return vscode.DiagnosticSeverity.Error;
      default:
        return vscode.DiagnosticSeverity.Warning;
    }
  }

  private isPurposeFile(document: vscode.TextDocument): boolean {
    return (
      document.fileName.endsWith('.purpose') ||
      document.fileName.endsWith('portal.yaml') ||
      (document.fileName.endsWith('.yaml') && document.fileName.includes('.paradigm'))
    );
  }

  private validateAllOpenDocuments(): void {
    for (const document of vscode.workspace.textDocuments) {
      if (this.isPurposeFile(document)) {
        this.validateDocument(document);
      }
    }
  }

  private clearDiagnostics(document: vscode.TextDocument): void {
    this.diagnosticCollection.delete(document.uri);
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
