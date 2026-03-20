/**
 * Claude IDE Adapter
 * Generates CLAUDE.md files for Claude-native contexts
 * (Claude Code, Claude API, Claude-native interfaces)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IDEAdapter, ParadigmFiles, GeneratedFile, McpConfig } from './types.js';
import {
  generateConventions,
  generateCommitConvention,
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

    // Header
    sections.push(`# ${projectName} - Claude Context`);
    sections.push('');
    sections.push('> **Paradigm v2.0** | For Claude Code, Claude API, and Claude-native interfaces');
    sections.push('>');
    sections.push('> **Author:** Matt Canoy ([@ascend42](https://github.com/ascend42)) | **Repo:** [github.com/ascend42/a-paradigm](https://github.com/ascend42/a-paradigm) | **npm:** [@a-company/paradigm](https://www.npmjs.com/package/@a-company/paradigm) | **Plugin:** `paradigm` via Claude Code marketplace');
    sections.push('');

    // Project overview
    sections.push('## Project Overview');
    sections.push('');
    if (config['agent-guidelines']?.overview) {
      sections.push(config['agent-guidelines'].overview);
    }
    sections.push('');

    // Quick orientation
    sections.push('## Quick Orientation');
    sections.push('');
    sections.push('```');
    sections.push('.paradigm/config.yaml  \u2192 Project configuration');
    sections.push('.paradigm/specs/       \u2192 Detailed specifications');
    sections.push('.paradigm/docs/        \u2192 Commands, patterns, troubleshooting');
    sections.push('.cursorrules           \u2192 IDE instructions (if using Cursor)');
    sections.push('portal.yaml            \u2192 Security/auth definitions');
    sections.push('.paradigm/lore/        \u2192 Project timeline and history');
    sections.push('```');
    sections.push('');

    // Symbol system
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

    // Conventions (from config)
    const conventionsSection = generateConventions(config);
    if (conventionsSection) {
      sections.push(conventionsSection);
    }

    // Commit convention
    sections.push(generateCommitConvention());

    // Agent Onboarding (compressed)
    sections.push('## Agent Onboarding');
    sections.push('');
    sections.push('**First session:** Call `paradigm_status` \u2192 read `.paradigm/config.yaml` \u2192 check `portal.yaml`');
    sections.push('');
    sections.push('**Before each task:** `paradigm_ripple` for impact, `paradigm_gates_for_route` for new endpoints');
    sections.push('');
    sections.push('**Resuming:** Call `paradigm_session_recover`');
    sections.push('');

    // Before Implementing (compressed)
    sections.push('## Before Implementing');
    sections.push('');
    sections.push('0. Call `paradigm_protocol_search` \u2014 if a protocol matches, follow it');
    sections.push('1. Complex task (3+ files)? \u2192 `paradigm_orchestrate_inline` mode="plan"');
    sections.push('2. Affects symbols? \u2192 `paradigm_ripple`');
    sections.push('3. Adds endpoints? \u2192 `paradigm_gates_for_route`');
    sections.push('');

    // Automatic Enforcement (compressed hooks table)
    sections.push('## Automatic Enforcement (Hooks)');
    sections.push('');
    sections.push('The stop hook **BLOCKS** if source files were modified without .purpose updates.');
    sections.push('');
    sections.push('| Hook | Behavior |');
    sections.push('|------|----------|');
    sections.push('| **Stop** | Blocks on: missing .purpose, missing portal.yaml gates, aspect drift, stale purposes |');
    sections.push('| **Pre-commit** | Auto-rebuilds index \u2014 never blocks |');
    sections.push('| **Post-write** | Advisory reminder for .purpose coverage |');
    sections.push('');
    sections.push('**If blocked:** Update .purpose files \u2192 update portal.yaml if needed \u2192 `paradigm_reindex` \u2192 finish');
    sections.push('');

    // Maintaining Paradigm Files (merged authoring rules)
    sections.push('## Maintaining Paradigm Files');
    sections.push('');
    sections.push('**You MUST update Paradigm files when making code changes:**');
    sections.push('');
    sections.push('- Add feature \u2192 create `.purpose` in directory');
    sections.push('- Add protected route \u2192 update `portal.yaml` with gates');
    sections.push('- Add signal/event \u2192 add to `.purpose`');
    sections.push('- Add multi-step flow \u2192 document as `$flow`');
    sections.push('- Rename/delete symbol \u2192 update all references');
    sections.push('- Record lore via `paradigm_lore_record` for sessions modifying 3+ files');
    sections.push('- Use Paradigm logger (`log.component()`, `log.gate()`, etc.) \u2014 never raw console.log');
    sections.push('');
    sections.push('**Auth requires portal.yaml** if your code has JWT, role checks, ownership checks, or protected endpoints.');
    sections.push('');

    // On-Demand Guidance (resource pointers)
    sections.push('## On-Demand Guidance');
    sections.push('');
    sections.push('Detailed guidance is available via MCP resources \u2014 load only what you need:');
    sections.push('');
    sections.push('| Topic | Resource |');
    sections.push('|-------|----------|');
    sections.push('| Logging rules & directory mapping | `paradigm://guidance/logging` |');
    sections.push('| Portal protocol & gate patterns | `paradigm://guidance/portal` |');
    sections.push('| MCP workflow & token budgets | `paradigm://guidance/mcp-workflow` |');
    sections.push('| Flow-first development | `paradigm://guidance/flows` |');
    sections.push('| Multi-agent orchestration | `paradigm://guidance/orchestration` |');
    sections.push('| Workspaces (multi-project) | `paradigm://guidance/workspaces` |');
    sections.push('| University (knowledge base) | `paradigm://guidance/university` |');
    sections.push('| Confidence calibration | `paradigm://guidance/calibration` |');
    sections.push('| Session checkpoints | `paradigm://guidance/checkpoints` |');
    sections.push('| Navigation & task recipes | `paradigm://guidance/navigation` |');
    sections.push('| Component types & hierarchy | `paradigm://guidance/component-types` |');
    sections.push('| Troubleshooting | `paradigm://guidance/troubleshooting` |');
    sections.push('');

    // Agent Contributions (from agent profiles with high-priority contributions)
    if (files.agents?.length) {
      const highPriority = files.agents.flatMap(a =>
        (a.context?.contributions || [])
          .filter(c => c.priority === 'high' && c.content)
          .map(c => ({ agent: a.id, section: c.section, content: c.content! }))
      );
      if (highPriority.length > 0) {
        sections.push('## Agent Contributions');
        sections.push('');
        for (const contrib of highPriority) {
          sections.push(`### ${contrib.section} (${contrib.agent})`);
          sections.push('');
          sections.push(contrib.content);
          sections.push('');
        }
      }
    }

    // Directory structure
    if (config['purpose-required']?.length) {
      sections.push('## Directory Structure');
      sections.push('');
      sections.push('`.purpose` files exist in:');
      for (const req of config['purpose-required']) {
        sections.push(`- \`${req.pattern}\``);
      }
      sections.push('');
    }

    // Footer
    sections.push('---');
    sections.push('');
    sections.push('*See `.paradigm/specs/` for specifications. Run `paradigm sync` to regenerate.*');

    return sections.filter(s => s !== undefined).join('\n');
  }

  /**
   * Generate MCP configuration for Claude
   */
  generateMcpConfig(rootDir: string): McpConfig {
    return {
      mcpServers: {
        paradigm: {
          command: 'paradigm-mcp',
          args: ['.'],
          cwd: rootDir,
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
    sections.push('`#` component | `$` flow | `^` gate | `!` signal | `~` aspect');
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
