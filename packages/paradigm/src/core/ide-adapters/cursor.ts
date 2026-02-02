/**
 * Cursor IDE Adapter
 * Generates .cursor/rules/*.mdc files (modern format)
 * 
 * The modern Cursor format uses multiple focused rule files with YAML frontmatter
 * for scoping. This is more efficient than a single .cursorrules file because
 * rules only load when relevant files are open.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IDEAdapter, ParadigmFiles, GeneratedFile, McpConfig } from './types.js';
import {
  generateOverview,
  generateSymbolSystem,
  generateLoggingRules,
  generateScanProtocol,
  generateConventions,
  generateUpdateRules,
  generateCommandsReference,
} from './base.js';

/**
 * Generate YAML frontmatter for .mdc files
 */
function frontmatter(description: string, options: { globs?: string; alwaysApply?: boolean } = {}): string {
  const lines = ['---', `description: ${description}`];
  
  if (options.globs) {
    lines.push(`globs: ${options.globs}`);
  }
  
  if (options.alwaysApply !== undefined) {
    lines.push(`alwaysApply: ${options.alwaysApply}`);
  }
  
  lines.push('---', '');
  return lines.join('\n');
}

export class CursorAdapter implements IDEAdapter {
  readonly name = 'cursor';
  readonly displayName = 'Cursor';
  readonly outputPath = '.cursor/rules';
  readonly multiFile = true;

  detect(rootDir: string): boolean {
    // Check for .cursor directory (Cursor workspace)
    if (fs.existsSync(path.join(rootDir, '.cursor'))) {
      return true;
    }
    
    // Check for existing .cursorrules file (legacy)
    if (fs.existsSync(path.join(rootDir, '.cursorrules'))) {
      return true;
    }
    
    // Check for .vscode (VS Code family, Cursor is based on it)
    if (fs.existsSync(path.join(rootDir, '.vscode'))) {
      return true;
    }
    
    return false;
  }

  /**
   * Generate single file content (legacy fallback)
   */
  generate(files: ParadigmFiles): string {
    // For backwards compatibility, return combined content
    const generatedFiles = this.generateFiles(files);
    return generatedFiles.map(f => `# ${f.path}\n\n${f.content}`).join('\n\n---\n\n');
  }

  /**
   * Generate multiple .mdc files for the modern Cursor format
   */
  generateFiles(files: ParadigmFiles): GeneratedFile[] {
    const { config, projectName } = files;
    const generatedFiles: GeneratedFile[] = [];

    // 1. Core rules (always apply)
    generatedFiles.push({
      path: 'paradigm-core.mdc',
      content: this.generateCoreRules(projectName, config),
    });

    // 2. Symbol system (always apply - fundamental to understanding)
    generatedFiles.push({
      path: 'paradigm-symbols.mdc',
      content: this.generateSymbolRules(config),
    });

    // 3. Logging rules (TypeScript/JavaScript files)
    const loggingContent = generateLoggingRules(config);
    if (loggingContent) {
      generatedFiles.push({
        path: 'paradigm-logging.mdc',
        content: this.generateLoggingMdc(config),
      });
    }

    // 4. Purpose file conventions
    generatedFiles.push({
      path: 'paradigm-purpose.mdc',
      content: this.generatePurposeMdc(),
    });

    // 5. Portal rules
    generatedFiles.push({
      path: 'paradigm-portal.mdc',
      content: this.generatePortalMdc(),
    });

    // 6. Commands reference (manual selection - not always needed)
    generatedFiles.push({
      path: 'paradigm-commands.mdc',
      content: this.generateCommandsMdc(),
    });

    // 7. Conventions (language-specific)
    generatedFiles.push({
      path: 'paradigm-conventions.mdc',
      content: this.generateConventionsMdc(config),
    });

    // 8. Agent Hints (when to query CLI)
    generatedFiles.push({
      path: 'paradigm-agent-hints.mdc',
      content: this.generateAgentHintsMdc(),
    });

    // 9. Navigator (AI exploration optimization)
    generatedFiles.push({
      path: 'paradigm-navigator.mdc',
      content: this.generateNavigatorMdc(),
    });

    return generatedFiles;
  }

  /**
   * Core rules - project overview and fundamentals
   */
  private generateCoreRules(projectName: string, config: ParadigmFiles['config']): string {
    const overview = generateOverview(config);
    
    return frontmatter('Paradigm core rules - project overview and fundamentals', { alwaysApply: true }) +
      `# Paradigm - ${projectName}\n\n` +
      overview + '\n\n' +
      generateUpdateRules(config);
  }

  /**
   * Symbol system rules
   */
  private generateSymbolRules(config: ParadigmFiles['config']): string {
    return frontmatter('Paradigm symbol system - understand @features, #components, ^portals, etc.', { alwaysApply: true }) +
      generateSymbolSystem(config);
  }

  /**
   * Logging rules for TypeScript/JavaScript
   */
  private generateLoggingMdc(config: ParadigmFiles['config']): string {
    return frontmatter('Paradigm logger usage for TypeScript/JavaScript code', { 
      globs: '**/*.{ts,tsx,js,jsx}',
      alwaysApply: false,
    }) +
      generateLoggingRules(config);
  }

  /**
   * Purpose file conventions
   */
  private generatePurposeMdc(): string {
    return frontmatter('Purpose file conventions - .purpose file format and usage', {
      globs: '**/.purpose',
      alwaysApply: false,
    }) +
      `# Purpose Files

Purpose files (\`.purpose\`) define the context for directories.

## Format

\`\`\`yaml
# Directory context
description: What this directory contains and why

# Features (@ symbol)
features:
  feature-name:
    description: What this feature does
    gates: [^gate1, ^gate2]       # Required portals
    signals: [!signal1]           # Events emitted
    components: [#Component1]     # Components used

# Components (# symbol)  
components:
  ComponentName:
    description: What this component does
    used-by: [@feature1, @feature2]
\`\`\`

## Symbol References

- Reference features: \`@feature-name\`
- Reference components: \`#ComponentName\`
- Reference portals: \`^portal-name\`
- Reference signals: \`!signal-name\`
- Reference flows: \`$flow-name\`
`;
  }

  /**
   * Portal rules
   */
  private generatePortalMdc(): string {
    return frontmatter('Portal (gate) configuration rules', {
      globs: '**/portal.yaml',
      alwaysApply: false,
    }) +
      `# Portal Configuration

Portal files (\`portal.yaml\`) define authorization topology.

## Format

\`\`\`yaml
version: "1.0"

gates:
  gate-name:
    description: What this gate protects
    locks:
      - id: lock-id
        description: Requirement description
        keys:
          - expression: "user.authenticated"
            description: User must be logged in
    prizes:
      - id: prize-id
        oneTime: true
        metadata:
          event: "gate_passed"

flows:
  flow-name:
    description: User journey
    gates: [gate1, gate2, gate3]
\`\`\`

## Portal Validation

Use the Portal Validator for authorization checks:

\`\`\`typescript
import { portal } from '@a-company/portal-sdk/validator';

const gate = portal.check('^gate-name')
  .requires('requirement description')
  .context({ userId, role });

if (!condition) {
  gate.deny('Reason for denial');
  return redirect('/unauthorized');
}

gate.allow('Access granted');
\`\`\`
`;
  }

  /**
   * Commands reference
   */
  private generateCommandsMdc(): string {
    return frontmatter('Paradigm CLI commands reference', { alwaysApply: false }) +
      generateCommandsReference();
  }

  /**
   * Conventions
   */
  private generateConventionsMdc(config: ParadigmFiles['config']): string {
    return frontmatter('Paradigm coding conventions', {
      globs: '**/*.{ts,tsx,js,jsx}',
      alwaysApply: false,
    }) +
      generateConventions(config);
  }

  /**
   * Agent Hints - when to query CLI commands
   */
  private generateAgentHintsMdc(): string {
    return frontmatter('Paradigm CLI queries for AI agents - prefer CLI over reading large files', {
      alwaysApply: true
    }) +
      `# Agent CLI Queries (Token-Efficient)

Instead of reading large context files, query Paradigm CLI on-demand for fresh, precise data.

## When to Query

| Before doing this... | Run this command |
|---------------------|------------------|
| Modifying a symbol | \`paradigm ripple @symbol --json\` |
| Debugging an error | \`paradigm echo ERROR_CODE --json\` |
| Starting a session | \`paradigm thread --json\` |
| Understanding relationships | \`paradigm constellation\` |
| Getting oriented | \`paradigm beacon --json\` |

## Query Patterns

### Before Changing Code

\`\`\`bash
# See what depends on what you're changing
paradigm ripple @checkout --json

# Output includes: upstream deps, downstream effects, flow membership
\`\`\`

### When Debugging

\`\`\`bash
# Look up error context
paradigm echo AUTH_REQUIRED --json

# Then check ripple effects of the related symbol
paradigm ripple ^authenticated --json
\`\`\`

### Starting Work

\`\`\`bash
# Check previous session context
paradigm thread --json

# Quick orientation
paradigm beacon --json
\`\`\`

### Querying Constellation

\`\`\`bash
# Get specific symbol
jq '.stars["@checkout"]' .paradigm/constellation.json

# Find what requires a portal
jq '[.stars | to_entries[] | select(.value.portals[]? == "^authenticated") | .key]' .paradigm/constellation.json

# List all flows
jq '.orbits | keys' .paradigm/constellation.json
\`\`\`

## Benefits

- **Fresh data**: Always current, not stale from file generation
- **Precise**: Only get the data you need
- **Token-efficient**: ~100 tokens per query vs ~2000 upfront
`;
  }

  /**
   * Navigator rules - AI exploration optimization
   */
  private generateNavigatorMdc(): string {
    return frontmatter('Paradigm Navigator - efficient codebase exploration', {
      alwaysApply: true
    }) +
      `# Paradigm Navigator

## Exploration Protocol

Before exploring this codebase:

1. **Read \`.paradigm/navigator.yaml\`** for the structure map
2. **Query by symbol** - lookup paths directly from the symbols map
3. **Respect skip patterns** - avoid node_modules, dist, .git, etc.

## Navigation Strategy

**INSTEAD OF:** Broad exploration (expensive token usage)

**DO THIS:**
1. Read \`.paradigm/navigator.yaml\` for project structure
2. Find relevant symbol → go directly to path
3. Read only needed files

## Using MCP Navigate Tool

\`\`\`
# Find a specific symbol
paradigm_navigate({ intent: "find", target: "@checkout" })

# Explore an area
paradigm_navigate({ intent: "explore", target: "authentication" })

# Get context for a task
paradigm_navigate({ intent: "context", task: "add Apple Pay" })
\`\`\`

## Task Recipes

### Adding a Feature
1. Check \`navigator.yaml\` → \`structure.features.paths\`
2. Read an existing feature as template
3. Create in the same location

### Modifying a Component
1. Look up symbol in \`navigator.yaml\` → \`symbols\`
2. Go directly to the path
3. Use \`paradigm_ripple\` to check impact

### Understanding Dependencies
1. Use \`paradigm_navigate({ intent: "context", task: "..." })\`
2. Read suggested files in order
3. Skip patterns in the \`skip\` array

## Key Files (Quick Reference)

Always available in \`navigator.yaml\`:
- \`key_files.config\` - Configuration files
- \`key_files.entry\` - Entry points
- \`key_files.types\` - Type definitions
`;
  }

  /**
   * Generate MCP configuration for Cursor
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
}

export const cursorAdapter = new CursorAdapter();
