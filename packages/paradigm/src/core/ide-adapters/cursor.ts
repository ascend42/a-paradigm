/**
 * Cursor IDE Adapter
 * Generates .cursorrules files
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IDEAdapter, ParadigmFiles } from './types.js';
import {
  generateHeader,
  generateOverview,
  generateSymbolSystem,
  generateLoggingRules,
  generateScanProtocol,
  generateConventions,
  generateUpdateRules,
  generateCommandsReference,
  generateFooter,
} from './base.js';

export class CursorAdapter implements IDEAdapter {
  readonly name = 'cursor';
  readonly displayName = 'Cursor';
  readonly outputPath = '.cursorrules';

  detect(rootDir: string): boolean {
    // Check for .cursor directory (Cursor workspace)
    if (fs.existsSync(path.join(rootDir, '.cursor'))) {
      return true;
    }
    
    // Check for existing .cursorrules file
    if (fs.existsSync(path.join(rootDir, '.cursorrules'))) {
      return true;
    }
    
    // Check for .vscode (VS Code family, Cursor is based on it)
    if (fs.existsSync(path.join(rootDir, '.vscode'))) {
      return true;
    }
    
    return false;
  }

  generate(files: ParadigmFiles): string {
    const { config, projectName } = files;
    const sections: string[] = [];

    // Header
    sections.push(generateHeader(projectName, this.displayName));

    // Overview
    sections.push(generateOverview(config));

    // Symbol system
    sections.push(generateSymbolSystem(config));

    // Logging rules
    const loggingSection = generateLoggingRules(config);
    if (loggingSection) {
      sections.push(loggingSection);
    }

    // Scan protocol
    const scanSection = generateScanProtocol(config);
    if (scanSection) {
      sections.push(scanSection);
    }

    // Update rules
    sections.push(generateUpdateRules(config));

    // Conventions
    sections.push(generateConventions(config));

    // Commands reference
    sections.push(generateCommandsReference());

    // Footer
    sections.push(generateFooter());

    return sections.filter(s => s.trim()).join('\n');
  }
}

export const cursorAdapter = new CursorAdapter();
