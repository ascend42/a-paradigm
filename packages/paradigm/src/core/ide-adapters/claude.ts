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
  generateTerminalGuidance,
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

    // Terminal guidance (OS-specific)
    sections.push(generateTerminalGuidance());

    // Agent Onboarding section (new for agentic workflows)
    sections.push('## Agent Onboarding');
    sections.push('');
    sections.push('**First Session:**');
    sections.push('1. Call `paradigm_status` for project overview');
    sections.push('2. Read `.paradigm/config.yaml` for conventions');
    sections.push('3. Check if `portal.yaml` exists (for auth gates)');
    sections.push('');
    sections.push('**Before Each Task:**');
    sections.push('1. `paradigm_wisdom_context` for symbols you\'ll modify');
    sections.push('2. `paradigm_ripple` to check impact');
    sections.push('3. `paradigm_history_fragility` for stability warnings');
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

    // First actions for new sessions - explicit onboarding checklist
    sections.push('## First Actions for New Sessions');
    sections.push('');
    sections.push('1. **Orient:** Call `paradigm_status` to see project overview and available symbols');
    sections.push('2. **Verify:** Check `.paradigm/config.yaml` for discipline and conventions');
    sections.push('3. **Locate:** Use `paradigm_navigate` with "context" intent for your task');
    sections.push('4. **Review:** Read the nearest `.purpose` file before making changes');
    sections.push('5. **Check:** Call `paradigm_gates_for_route` before adding API endpoints');
    sections.push('');

    // Portal Protocol - CRITICAL for auth-aware development
    sections.push('## Portal Protocol (Authorization)');
    sections.push('');
    sections.push('**Portal.yaml is REQUIRED when the project has protected routes.**');
    sections.push('');
    sections.push('### When to Create portal.yaml');
    sections.push('');
    sections.push('Create `portal.yaml` in project root when:');
    sections.push('- Adding any endpoint that requires authentication');
    sections.push('- Adding role-based access (admin, member, owner)');
    sections.push('- Adding resource ownership checks (user can only edit their own data)');
    sections.push('');
    sections.push('### Portal.yaml Structure');
    sections.push('');
    sections.push('```yaml');
    sections.push('version: "1.0"');
    sections.push('gates:');
    sections.push('  ^authenticated:');
    sections.push('    description: User must be logged in');
    sections.push('    check: req.user != null');
    sections.push('  ^project-admin:');
    sections.push('    description: User must be admin of the project');
    sections.push('    check: project.admins.includes(req.user.id)');
    sections.push('  ^comment-author:');
    sections.push('    description: User must be the comment author');
    sections.push('    check: comment.authorId === req.user.id');
    sections.push('');
    sections.push('routes:');
    sections.push('  "GET /api/projects/:id": [^authenticated, ^project-member]');
    sections.push('  "PUT /api/projects/:id": [^authenticated, ^project-admin]');
    sections.push('  "DELETE /api/comments/:id": [^authenticated, ^comment-author]');
    sections.push('```');
    sections.push('');
    sections.push('### When Adding New Endpoints');
    sections.push('');
    sections.push('**ALWAYS update portal.yaml when adding routes:**');
    sections.push('');
    sections.push('1. Call `paradigm_gates_for_route` to get suggestions');
    sections.push('2. Add the route to portal.yaml with required gates');
    sections.push('3. Implement the gate checks in your middleware/code');
    sections.push('4. Test that unauthorized access returns 403');
    sections.push('');
    sections.push('### Common Gate Patterns');
    sections.push('');
    sections.push('| Pattern | Gate Name | Description |');
    sections.push('|---------|-----------|-------------|');
    sections.push('| Any logged-in user | `^authenticated` | Basic auth check |');
    sections.push('| Resource membership | `^{resource}-member` | User is member of resource |');
    sections.push('| Resource admin | `^{resource}-admin` | User is admin of resource |');
    sections.push('| Resource owner | `^{resource}-owner` | User owns the resource |');
    sections.push('| Author only | `^{resource}-author` | User created the resource |');
    sections.push('');

    // Context discovery - key for Claude
    sections.push('## Context Discovery');
    sections.push('');
    sections.push('**Before making changes:**');
    sections.push('');
    sections.push('1. Check `.paradigm/config.yaml` for project configuration');
    sections.push('2. Read the `.purpose` file in the directory you\'re modifying');
    sections.push('3. Check `portal.yaml` for existing auth gates');
    sections.push('4. Check `.paradigm/docs/patterns.md` for coding patterns');
    sections.push('');

    // Navigation section for AI exploration
    sections.push(generateNavigationSection(config));

    // Context monitoring protocol
    sections.push('## Context Monitoring Protocol');
    sections.push('');
    sections.push('**Periodically check context usage** by calling `paradigm_context_check` (every 10-15 tool calls or when user asks).');
    sections.push('');
    sections.push('**When recommendation is NOT "continue":**');
    sections.push('1. Inform user: "Context usage is at ~X%. Recommend handoff soon."');
    sections.push('2. Offer to prepare handoff summary');
    sections.push('3. If urgent (>85%), prioritize completing current task then handoff');
    sections.push('');
    sections.push('**To handoff:**');
    sections.push('1. Call `paradigm_handoff_prepare` with summary and next steps');
    sections.push('2. User runs: `paradigm team handoff --to <agent> --summary "..."`');
    sections.push('3. New session accepts with: `paradigm team accept <id>`');
    sections.push('');

    // MCP Workflow Protocol (agent hints for query-before-modify)
    sections.push('## MCP Workflow Protocol');
    sections.push('');
    sections.push('**Query before modifying** - Use MCP tools for token-efficient, fresh data:');
    sections.push('');
    sections.push('| Before doing this... | Call this tool |');
    sections.push('|---------------------|----------------|');
    sections.push('| Modifying a symbol | `paradigm_ripple` with the symbol |');
    sections.push('| Understanding code | `paradigm_navigate` with explore intent |');
    sections.push('| Checking dependencies | `paradigm_related` for connections |');
    sections.push('| Getting oriented | `paradigm_status` for project overview |');
    sections.push('| **Adding API endpoint** | `paradigm_gates_for_route` for auth gates |');
    sections.push('| **Validating changes** | `paradigm_flows_affected` for flow impact |');
    sections.push('| **Getting test data** | `paradigm_test_fixtures` for fixtures |');
    sections.push('');
    sections.push('**Benefits**: ~100 tokens per query vs ~2000 for reading files. Always fresh data from live index.');
    sections.push('');
    sections.push('**Authorization workflow:**');
    sections.push('1. Adding endpoint? → Call `paradigm_gates_for_route`');
    sections.push('2. Get suggested gates → Add them to `portal.yaml`');
    sections.push('3. Implement gate checks → Test 403 responses');
    sections.push('');

    // Token budget reference
    sections.push('## Token Budget Reference');
    sections.push('');
    sections.push('| Operation | Typical Tokens | Use When |');
    sections.push('|-----------|---------------|----------|');
    sections.push('| `paradigm_status` | ~100 | Starting a session |');
    sections.push('| `paradigm_search` | ~150 | Looking for symbols |');
    sections.push('| `paradigm_navigate` | ~200 | Finding code locations |');
    sections.push('| `paradigm_ripple` | ~300 | Before modifying symbols |');
    sections.push('| `paradigm_gates_for_route` | ~150 | Adding API endpoints |');
    sections.push('| File read (small) | ~500 | Need exact code |');
    sections.push('| File read (large) | ~2000+ | Avoid if possible |');
    sections.push('| Full .purpose + config | ~1500 | Initial orientation |');
    sections.push('');
    sections.push('**Tip**: Prefer MCP queries over file reads. Check `paradigm_session_stats` for actual usage.');
    sections.push('');

    // MCP vs File Read decision guide
    sections.push('### When to Use MCP vs File Reads');
    sections.push('');
    sections.push('| Need | Use MCP | Use File Read |');
    sections.push('|------|---------|---------------|');
    sections.push('| Find symbol | `paradigm_navigate` | Never |');
    sections.push('| Check impact | `paradigm_ripple` | Never |');
    sections.push('| Read implementation | MCP first | Then specific file |');
    sections.push('| Write code | N/A | Existing patterns |');
    sections.push('| Check team wisdom | `paradigm_wisdom_context` | Never |');
    sections.push('');
    sections.push('**Rule**: MCP for discovery, files for implementation.');
    sections.push('');

    // MCP Resources section
    sections.push('## MCP Resources (On-Demand Content)');
    sections.push('');
    sections.push('Reference content is served via MCP resources instead of being stored locally:');
    sections.push('');
    sections.push('| Resource | URI | Content |');
    sections.push('|----------|-----|---------|');
    sections.push('| Prompts | `paradigm://prompts` | Task templates (add-feature, refactor, etc.) |');
    sections.push('| Commands | `paradigm://docs/commands` | CLI command reference |');
    sections.push('| Queries | `paradigm://docs/queries` | jq query examples |');
    sections.push('| Disciplines | `paradigm://specs/disciplines` | Symbol mappings by domain |');
    sections.push('| Scan | `paradigm://specs/scan` | Visual discovery protocol |');
    sections.push('');
    sections.push('**Usage**: Read resources with `paradigm://prompts/{name}` (e.g., `paradigm://prompts/add-feature`).');
    sections.push('');
    sections.push('**Session Tracking**: Call `paradigm_session_stats` to see token usage and cost breakdown.');
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

    // Flow Validation section
    sections.push('## Flow Validation');
    sections.push('');
    sections.push('**After modifying symbols, validate affected flows:**');
    sections.push('');
    sections.push('1. Call `paradigm_flows_affected` with the symbol you modified');
    sections.push('2. Get test fixtures with `paradigm_test_fixtures`');
    sections.push('3. Run suggested validation commands or test manually');
    sections.push('');
    sections.push('**Example workflow:**');
    sections.push('');
    sections.push('```');
    sections.push('# Check what flows are affected by @tasks');
    sections.push('paradigm_flows_affected({ symbol: "@tasks" })');
    sections.push('');
    sections.push('# Get test user for auth testing');
    sections.push('paradigm_test_fixtures({ category: "users", name: "member" })');
    sections.push('');
    sections.push('# Get payload for creating a task');
    sections.push('paradigm_test_fixtures({ category: "payloads", name: "createTask" })');
    sections.push('');
    sections.push('# Run validation command from flows_affected response');
    sections.push('```');
    sections.push('');
    sections.push('**Testable Flow Format in .purpose:**');
    sections.push('');
    sections.push('```yaml');
    sections.push('flows:');
    sections.push('  $task-creation:');
    sections.push('    description: "Full task creation flow"');
    sections.push('    trigger: "POST /api/projects/:id/tasks"');
    sections.push('    steps:');
    sections.push('      - id: validate');
    sections.push('        action: "Check project membership"');
    sections.push('        symbol: "^project-member"');
    sections.push('        expect: "403 if not member"');
    sections.push('      - id: create');
    sections.push('        action: "Create task record"');
    sections.push('        symbol: "@tasks"');
    sections.push('    validation:');
    sections.push('      command: "npm test -- --grep \'task creation\'"');
    sections.push('```');
    sections.push('');

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

    // Troubleshooting section
    sections.push('## Troubleshooting');
    sections.push('');
    sections.push('| Issue | Solution |');
    sections.push('|-------|----------|');
    sections.push('| "Symbol not found" | Run `paradigm scan` to rebuild index |');
    sections.push('| "Navigator not found" | Run `paradigm scan` to generate navigator.yaml |');
    sections.push('| Empty search results | Check that .purpose files define symbols |');
    sections.push('| High context usage | Call `paradigm_handoff_prepare` |');
    sections.push('| Gate suggestions missing | Check that portal.yaml exists and defines gates |');
    sections.push('| "Flow index not found" | Run `paradigm scan` and add flows to .purpose files |');
    sections.push('| "Fixtures not found" | Create `.paradigm/fixtures.yaml` with test data |');
    sections.push('');

    // Maintaining Paradigm files section
    sections.push('## Maintaining Paradigm Files');
    sections.push('');
    sections.push('**After completing code changes, update Paradigm files if needed:**');
    sections.push('');
    sections.push('| Change Type | Action Required |');
    sections.push('|-------------|-----------------|');
    sections.push('| Add feature | Create `.purpose` in feature directory |');
    sections.push('| Add ANY protected route | Create/update `portal.yaml` with gates |');
    sections.push('| Add ownership check | Add `^{resource}-owner` gate to `portal.yaml` |');
    sections.push('| Add role-based access | Add `^{role}` gate to `portal.yaml` |');
    sections.push('| Add signal/event | Add to emitting feature\'s `.purpose` |');
    sections.push('| Add multi-step flow | Document as `$flow` in `.purpose` |');
    sections.push('| Rename/delete symbol | Update all `.purpose` references |');
    sections.push('| Learn antipattern | Add to `.paradigm/wisdom/antipatterns.yaml` |');
    sections.push('');
    sections.push('**CRITICAL: Authorization requires portal.yaml**');
    sections.push('');
    sections.push('If your code has ANY of these, `portal.yaml` MUST exist:');
    sections.push('- JWT/session authentication');
    sections.push('- Role checks (admin, member, etc.)');
    sections.push('- Ownership checks (user can only edit own resources)');
    sections.push('- Protected API endpoints');
    sections.push('');
    sections.push('**Validation**: Run `paradigm doctor` to check for inconsistencies.');
    sections.push('');
    sections.push('See `.paradigm/docs/ai-maintenance-protocol.md` for detailed guidance.');
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
