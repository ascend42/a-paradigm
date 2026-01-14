/**
 * Windsurf IDE Adapter
 * Generates .windsurfrules files
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IDEAdapter, HorizonFiles } from './types.js';
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

export class WindsurfAdapter implements IDEAdapter {
  readonly name = 'windsurf';
  readonly displayName = 'Windsurf';
  readonly outputPath = '.windsurfrules';

  detect(rootDir: string): boolean {
    // Check for existing windsurf rules
    if (fs.existsSync(path.join(rootDir, '.windsurfrules'))) {
      return true;
    }
    
    // Check for windsurf-specific markers
    if (fs.existsSync(path.join(rootDir, '.windsurf'))) {
      return true;
    }
    
    return false;
  }

  generate(files: HorizonFiles): string {
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

export const windsurfAdapter = new WindsurfAdapter();
