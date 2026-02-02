/**
 * Claude IDE Adapter
 * Generates CLAUDE.md files for Claude-native contexts
 * (Claude Code, Claude API, Claude-native interfaces)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IDEAdapter, ParadigmFiles, GeneratedFile, McpConfig } from './types.js';
import {
  generateOverview,
  generateSymbolSystem,
  generateLoggingRules,
  generateConventions,
  generateUpdateRules,
  generateNavigationSection,
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

    // Navigation section for AI exploration
    sections.push(generateNavigationSection(config));

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

  /**
   * Generate MCP configuration for Claude
   */
  generateMcpConfig(): McpConfig {
    return {
      mcpServers: {
        paradigm: {
          command: 'npx',
          args: ['@a-company/paradigm-mcp'],
        },
      },
    };
  }

  /**
   * Generate nested CLAUDE.md files for directories with .purpose files
   */
  generateNestedContexts(rootDir: string, files: ParadigmFiles): GeneratedFile[] {
    const generatedFiles: GeneratedFile[] = [];

    // Find all .purpose files
    const purposeFiles = findPurposeFiles(rootDir);

    for (const purposePath of purposeFiles) {
      const dirPath = path.dirname(purposePath);
      const relativePath = path.relative(rootDir, dirPath);

      // Skip root directory (handled by main CLAUDE.md)
      if (relativePath === '' || relativePath === '.') continue;

      // Read .purpose file
      const purposeContent = fs.readFileSync(purposePath, 'utf8');
      const contextContent = this.generateDirectoryContext(relativePath, purposeContent, files);

      generatedFiles.push({
        path: path.join(relativePath, 'CLAUDE.md'),
        content: contextContent,
      });
    }

    return generatedFiles;
  }

  /**
   * Generate context for a specific directory
   */
  private generateDirectoryContext(
    dirPath: string,
    purposeContent: string,
    files: ParadigmFiles
  ): string {
    const sections: string[] = [];
    const dirName = path.basename(dirPath);

    sections.push(`# ${dirName} - Directory Context`);
    sections.push('');
    sections.push(`> Part of ${files.projectName} | See root CLAUDE.md for project overview`);
    sections.push('');

    // Include purpose file content
    sections.push('## Purpose');
    sections.push('');
    sections.push('```yaml');
    sections.push(purposeContent.trim());
    sections.push('```');
    sections.push('');

    // Quick reference
    sections.push('## Quick Reference');
    sections.push('');
    sections.push(`- **Path**: \`${dirPath}\``);
    sections.push('- **Config**: See `.paradigm/config.yaml`');
    sections.push('- **Patterns**: See `.paradigm/docs/patterns.md`');
    sections.push('');

    // Symbol system reminder (compact)
    sections.push('## Symbols');
    sections.push('');
    sections.push('`@` feature | `#` component | `$` flow | `%` state | `^` gate | `!` signal | `?` idea');
    sections.push('');

    sections.push('---');
    sections.push('');
    sections.push('*Auto-generated by `paradigm sync claude`. Edit .purpose file to update.*');

    return sections.join('\n');
  }
}

/**
 * Recursively find all .purpose files
 */
function findPurposeFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      // Skip node_modules, .git, etc.
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        walk(fullPath);
      } else if (entry.name === '.purpose') {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

export const claudeAdapter = new ClaudeAdapter();
