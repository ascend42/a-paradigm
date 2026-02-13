/**
 * Claude IDE Adapter
 * Generates CLAUDE.md files for Claude-native contexts
 * (Claude Code, Claude API, Claude-native interfaces)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IDEAdapter, ParadigmFiles, GeneratedFile, McpConfig } from './types.js';
import {
  generateLoggingRules,
  generateConventions,
  generateUpdateRules,
  generateNavigationSection,
  generateTerminalGuidance,
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

    // Claude-specific header (optimized for Claude's preferences)
    sections.push(`# ${projectName} - Claude Context`);
    sections.push('');
    sections.push('> **Paradigm v2.0** | For Claude Code, Claude API, and Claude-native interfaces');
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

    // Before Implementing section - enforcement language
    sections.push('## Before Implementing (Every Task)');
    sections.push('');
    sections.push('1. **Is this task complex?** (3+ files, security + implementation, multiple features)');
    sections.push('   → Call `paradigm_orchestrate_inline` with mode="plan" BEFORE writing code');
    sections.push('2. **Does it affect existing symbols?** → Call `paradigm_ripple`');
    sections.push('3. **Does it add API endpoints?** → Call `paradigm_gates_for_route`');
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
    sections.push('| **Building a feature (3+ files)** | `paradigm_orchestrate_inline` mode="plan" |');
    sections.push('| **Task involves security + code** | `paradigm_orchestrate_inline` mode="plan" |');
    sections.push('| **Finishing work session** | `paradigm_reindex` to rebuild static index |');
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

    // Multi-Agent Orchestration section
    sections.push('## Multi-Agent Orchestration');
    sections.push('');
    sections.push('Paradigm supports multi-agent orchestration via `paradigm team` commands:');
    sections.push('');
    sections.push('### Commands');
    sections.push('');
    sections.push('| Command | Description |');
    sections.push('|---------|-------------|');
    sections.push('| `paradigm team spawn <agent> --task "..."` | Spawn a single agent |');
    sections.push('| `paradigm team orchestrate "task"` | AI orchestrator coordinates agents |');
    sections.push('| `paradigm team orchestrate "task" --solo` | Single Claude mode (no splitting) |');
    sections.push('| `paradigm team orchestrate "task" --compare` | A/B test solo vs faceted |');
    sections.push('| `paradigm team agents suggest "task"` | Suggest agents based on task triggers |');
    sections.push('| `paradigm team providers` | Show available providers |');
    sections.push('| `paradigm team providers --set X` | Set preferred provider |');
    sections.push('| `paradigm team models` | View/configure agent model assignments |');
    sections.push('| `paradigm team models --refresh` | Re-discover models from environment |');
    sections.push('');
    sections.push('### Agent Suggestions');
    sections.push('');
    sections.push('Before orchestrating, you can preview which agents will be involved:');
    sections.push('');
    sections.push('```bash');
    sections.push('paradigm team agents suggest "Add user authentication with JWT"');
    sections.push('```');
    sections.push('');
    sections.push('Or via MCP (returns `suggestedAgents` in plan mode):');
    sections.push('```');
    sections.push('paradigm_orchestrate_inline({ task: "...", mode: "plan" })');
    sections.push('```');
    sections.push('');

    // Flow-First Development section
    sections.push('## Flow-First Development');
    sections.push('');
    sections.push('**Define flows BEFORE implementing features that span multiple steps.**');
    sections.push('');
    sections.push('### When to Define Flows');
    sections.push('');
    sections.push('Create a flow ($symbol) when your feature:');
    sections.push('- Has multiple authorization gates');
    sections.push('- Spans multiple components or services');
    sections.push('- Emits events that trigger other actions');
    sections.push('- Needs clear documentation of the "happy path"');
    sections.push('');
    sections.push('### Flow Definition');
    sections.push('');
    sections.push('Define flows in `.paradigm/flows.yaml`:');
    sections.push('');
    sections.push('```yaml');
    sections.push('version: "1.0"');
    sections.push('flows:');
    sections.push('  $task-creation:');
    sections.push('    name: Task Creation Flow');
    sections.push('    trigger: "POST /api/tasks"');
    sections.push('    steps:');
    sections.push('      - type: gate');
    sections.push('        symbol: ^authenticated');
    sections.push('      - type: gate');
    sections.push('        symbol: ^project-member');
    sections.push('      - type: action');
    sections.push('        symbol: "#create-task"');
    sections.push('      - type: signal');
    sections.push('        symbol: "!task-created"');
    sections.push('    successSignal: "!task-created"');
    sections.push('```');
    sections.push('');
    sections.push('### Flow-First Protocol');
    sections.push('');
    sections.push('1. **Define the flow first** - What gates, actions, and signals?');
    sections.push('2. **Validate** - Call `paradigm_flow_validate` to check completeness');
    sections.push('3. **Implement** - Each step becomes a clear implementation target');
    sections.push('');

    // Flow Validation section
    sections.push('## Flow Validation');
    sections.push('');
    sections.push('**Validate flows before and after implementing:**');
    sections.push('');
    sections.push('```');
    sections.push('# Validate specific flow');
    sections.push('paradigm_flow_validate({ flowId: "$task-creation" })');
    sections.push('');
    sections.push('# Validate all flows');
    sections.push('paradigm_flow_validate({})');
    sections.push('');
    sections.push('# Deep check (verify implementation exists)');
    sections.push('paradigm_flow_validate({ checkImplementation: true })');
    sections.push('```');
    sections.push('');
    sections.push('**After modifying symbols, check affected flows:**');
    sections.push('');
    sections.push('```');
    sections.push('# Check what flows are affected by #tasks');
    sections.push('paradigm_flows_affected({ symbol: "#tasks" })');
    sections.push('```');
    sections.push('');

    // Commit message format (shared v2 convention with Symbols: trailer)
    sections.push(generateCommitConvention());

    // Automatic Enforcement section
    sections.push('## Automatic Enforcement (Claude Code Hooks)');
    sections.push('');
    sections.push('This project uses Claude Code hooks for paradigm compliance. These are installed');
    sections.push('automatically via `paradigm shift` or `paradigm hooks install`.');
    sections.push('');
    sections.push('| Hook | Type | Behavior |');
    sections.push('|------|------|----------|');
    sections.push('| **Stop hook** | Stop | **BLOCKS** you from finishing if source files were modified without .purpose updates |');
    sections.push('| **Pre-commit hook** | PreToolUse (Bash) | Auto-rebuilds index before `git commit` — never blocks |');
    sections.push('| **Post-write hook** | PostToolUse (Edit/Write) | Advisory reminder when editing files without .purpose coverage |');
    sections.push('');
    sections.push('**If the Stop hook blocks you:**');
    sections.push('1. Update the nearest `.purpose` file for each modified code area');
    sections.push('2. Update `portal.yaml` if you added routes or gates');
    sections.push('3. Call `paradigm_reindex` to rebuild the static index');
    sections.push('4. Then finish your session');
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
    sections.push('**You MUST update Paradigm files when making code changes. The Stop hook will block you if you don\'t:**');
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
