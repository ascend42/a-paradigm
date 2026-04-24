/**
 * Windsurf IDE Adapter
 * Generates .windsurfrules files
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IDEAdapter, ParadigmFiles } from './types.js';
import {
  generateHeader,
  generateOverview,
  generateSymbolSystem,
  generateLoggingRules,
  generateProbeProtocol,
  generateConventions,
  generateUpdateRules,
  generateCommandsReference,
  generateCommitConvention,
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

    // Probe protocol (canonical key in v2+ templates; was `scan` pre-rename)
    const probeSection = generateProbeProtocol(config);
    if (probeSection) {
      sections.push(probeSection);
    }

    // Update rules
    sections.push(generateUpdateRules(config));

    // Conventions
    sections.push(generateConventions(config));

    // Commit conventions
    sections.push(generateCommitConvention());

    // Commands reference
    sections.push(generateCommandsReference());

    // Footer
    sections.push(generateFooter());

    return sections.filter(s => s.trim()).join('\n');
  }
}

export const windsurfAdapter = new WindsurfAdapter();
