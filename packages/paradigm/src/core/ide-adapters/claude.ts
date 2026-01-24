/**
 * Claude IDE Adapter
 * Generates CLAUDE.md files for Claude-native contexts
 * (Claude Code, Claude API, Claude-native interfaces)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IDEAdapter, ParadigmFiles } from './types.js';
import {
  generateOverview,
  generateSymbolSystem,
  generateLoggingRules,
  generateConventions,
  generateUpdateRules,
} from './base.js';

export class ClaudeAdapter implements IDEAdapter {
  readonly name = 'claude';
  readonly displayName = 'Claude';
  readonly outputPath = 'CLAUDE.md';

  detect(rootDir: string): boolean {
    // Check for existing CLAUDE.md
    if (fs.existsSync(path.join(rootDir, 'CLAUDE.md'))) {
      return true;
    }
    
    return false;
  }

  generate(files: ParadigmFiles): string {
    const { config, projectName } = files;
    const sections: string[] = [];

    // Claude-specific header (optimized for Claude's preferences)
    sections.push(`# ${projectName} - Claude Context`);
    sections.push('');
    sections.push('> **Paradigm v1.0** | For Claude Code, Claude API, and Claude-native interfaces');
    sections.push('');

    // Project overview
    sections.push('## Project Overview');
    sections.push('');
    if (config['agent-guidelines']?.overview) {
      sections.push(config['agent-guidelines'].overview);
    }
    sections.push('');

    // Quick orientation (Claude prefers this concise format)
    sections.push('## Quick Orientation');
    sections.push('');
    sections.push('```');
    sections.push('.paradigm/config.yaml  → Project configuration');
    sections.push('.paradigm/specs/       → Detailed specifications');
    sections.push('.paradigm/docs/        → Commands, patterns, troubleshooting');
    sections.push('.cursorrules           → IDE instructions (if using Cursor)');
    sections.push('portal.yaml            → Security/auth definitions');
    sections.push('```');
    sections.push('');

    // Symbol system - compact format for Claude
    sections.push('## Symbol System');
    sections.push('');
    sections.push('Use these prefixes in documentation and commits:');
    sections.push('');
    sections.push('| Symbol | Meaning | Example |');
    sections.push('|--------|---------|---------|');
    
    const symbolSystem = config['symbol-system'];
    if (symbolSystem) {
      for (const [prefix, def] of Object.entries(symbolSystem)) {
        const example = def.examples?.[0] || `${prefix}example`;
        sections.push(`| \`${prefix}\` | ${def.name} | \`${example}\` |`);
      }
    }
    sections.push('');

    // Context discovery - key for Claude
    sections.push('## Context Discovery');
    sections.push('');
    sections.push('**Before making changes:**');
    sections.push('');
    sections.push('1. Check `.paradigm/config.yaml` for project configuration');
    sections.push('2. Read the `.purpose` file in the directory you\'re modifying');
    sections.push('3. Check `portal.yaml` if touching authentication');
    sections.push('4. Check `.paradigm/docs/patterns.md` for coding patterns');
    sections.push('');

    // Directory structure hint
    if (config['purpose-required']?.length) {
      sections.push('## Directory Structure');
      sections.push('');
      sections.push('`.purpose` files exist in:');
      for (const req of config['purpose-required']) {
        sections.push(`- \`${req.pattern}\``);
      }
      sections.push('');
    }

    // Logging rules
    const loggingSection = generateLoggingRules(config);
    if (loggingSection) {
      sections.push(loggingSection);
    }

    // Conventions
    const conventionsSection = generateConventions(config);
    if (conventionsSection) {
      sections.push(conventionsSection);
    }

    // Update rules
    const updateSection = generateUpdateRules(config);
    if (updateSection) {
      sections.push(updateSection);
    }

    // Commit message format
    sections.push('## Commit Messages');
    sections.push('');
    sections.push('Use symbols in commits:');
    sections.push('```');
    sections.push('feat(@feature): add new capability');
    sections.push('');
    sections.push('- Add @feature-name view');
    sections.push('- Create #component-name');
    sections.push('- Emit !signal-name on success');
    sections.push('```');
    sections.push('');

    // Claude-specific footer
    sections.push('---');
    sections.push('');
    sections.push('*See `.cursorrules` for IDE-specific instructions, `.paradigm/specs/` for detailed specifications.*');

    return sections.filter(s => s !== undefined).join('\n');
  }
}

export const claudeAdapter = new ClaudeAdapter();
