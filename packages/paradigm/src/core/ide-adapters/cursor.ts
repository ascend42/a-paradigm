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
import * as os from 'os';
import * as yaml from 'js-yaml';
import type { IDEAdapter, ParadigmFiles, GeneratedFile, McpConfig } from './types.js';
import {
  generateOverview,
  generateSymbolSystem,
  generateLoggingRules,
  generateConventions,
  generateUpdateRules,
  generateCommandsReference,
  generateCommitConvention,
  generateCheckpointProtocol,
  generateHabitsSection,
  generateLoreSection,
  generateLlmsTxtSection,
} from './base.js';
import type { AgentsManifest } from '../../commands/team/types.js';

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
  generateFiles(files: ParadigmFiles, rootDir?: string): GeneratedFile[] {
    const { config, projectName } = files;
    const generatedFiles: GeneratedFile[] = [];

    // 1. Core rules (always apply)
    generatedFiles.push({
      path: 'paradigm-core.mdc',
      content: this.generateCoreRules(projectName, config),
    });

    // 2. Workflow protocol (always apply - the most important compliance file)
    generatedFiles.push({
      path: 'paradigm-workflow.mdc',
      content: this.generateWorkflowMdc(),
    });

    // 3. Symbol system (always apply - fundamental to understanding)
    generatedFiles.push({
      path: 'paradigm-symbols.mdc',
      content: this.generateSymbolRules(config),
    });

    // 4. Logging rules (TypeScript/JavaScript files)
    const loggingContent = generateLoggingRules(config);
    if (loggingContent) {
      generatedFiles.push({
        path: 'paradigm-logging.mdc',
        content: this.generateLoggingMdc(config),
      });
    }

    // 5. Purpose file conventions
    generatedFiles.push({
      path: 'paradigm-purpose.mdc',
      content: this.generatePurposeMdc(),
    });

    // 6. Portal rules
    generatedFiles.push({
      path: 'paradigm-portal.mdc',
      content: this.generatePortalMdc(),
    });

    // 7. Commands reference (manual selection - not always needed)
    generatedFiles.push({
      path: 'paradigm-commands.mdc',
      content: this.generateCommandsMdc(),
    });

    // 8. Conventions (language-specific)
    generatedFiles.push({
      path: 'paradigm-conventions.mdc',
      content: this.generateConventionsMdc(config),
    });

    // 9. Agent Hints (MCP-first queries)
    generatedFiles.push({
      path: 'paradigm-agent-hints.mdc',
      content: this.generateAgentHintsMdc(),
    });

    // 10. Navigator (AI exploration optimization)
    generatedFiles.push({
      path: 'paradigm-navigator.mdc',
      content: this.generateNavigatorMdc(),
    });

    // 11. Context Monitoring (session management)
    generatedFiles.push({
      path: 'paradigm-context.mdc',
      content: this.generateContextMdc(),
    });

    // 12. Orchestration Protocol (multi-agent workflow)
    // Load agents manifest if rootDir is provided
    const agentsManifest = rootDir ? this.loadAgentsManifest(rootDir) : null;
    generatedFiles.push({
      path: 'paradigm-orchestration.mdc',
      content: this.generateOrchestrationMdc(agentsManifest),
    });

    // 13. Flow-First Development (flow validation and planning)
    generatedFiles.push({
      path: 'paradigm-flows.mdc',
      content: this.generateFlowsMdc(),
    });

    // 14. Practices - habits, lore, llms.txt (Phase 5/6 content)
    generatedFiles.push({
      path: 'paradigm-practices.mdc',
      content: this.generatePracticesMdc(),
    });

    // 15. Commit conventions (always apply)
    generatedFiles.push({
      path: 'paradigm-commits.mdc',
      content: this.generateCommitsMdc(),
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
      '> **Author:** Matt Canoy ([@ascend42](https://github.com/ascend42)) | **Repo:** [github.com/ascend42/a-paradigm](https://github.com/ascend42/a-paradigm) | **npm:** [@a-company/paradigm](https://www.npmjs.com/package/@a-company/paradigm)\n\n' +
      `## CRITICAL RULES (Non-Negotiable)

1. **You MUST update the nearest \`.purpose\` file when you change behavior.** No exceptions.
2. **You MUST call \`paradigm_session_recover\` at session start and \`paradigm_pm_postflight\` when finishing.** See \`paradigm-workflow.mdc\` for the full protocol.
3. **You MUST call \`paradigm_ripple\` before modifying any documented symbol.** Check impact before changing code.

Violating these rules means your changes are non-compliant. The \`paradigm-workflow.mdc\` file contains the complete workflow — follow it.\n\n` +
      overview + '\n\n' +
      generateUpdateRules(config);
  }

  /**
   * Symbol system rules
   */
  private generateSymbolRules(config: ParadigmFiles['config']): string {
    return frontmatter('Paradigm symbol system - understand #components, $flows, ^gates, !signals, ~aspects', { alwaysApply: true }) +
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

# Components (# symbol) — all documented code units
components:
  component-name:
    description: What this component does
    tags: [feature]                # Classification via tag bank
    gates: [^gate1, ^gate2]       # Required gates
    signals: [!signal1]           # Events emitted
    used-by: [#other-component]
\`\`\`

## Symbol References (v2)

- Reference components: \`#component-name\`
- Reference flows: \`$flow-name\`
- Reference gates: \`^gate-name\`
- Reference signals: \`!signal-name\`
- Reference aspects: \`~aspect-name\`
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
   * Agent Hints - MCP-first queries for AI agents
   */
  private generateAgentHintsMdc(): string {
    return frontmatter('Paradigm MCP tool queries for AI agents - use MCP tools instead of reading large files or running CLI commands', {
      alwaysApply: true
    }) +
      `# Agent MCP Queries (Token-Efficient)

**Use MCP tool calls, NOT CLI commands.** MCP tools return structured data directly — no shell overhead, no parsing, no latency.

## When to Query

| Before doing this... | Call this MCP tool |
|---------------------|-------------------|
| Modifying a symbol | \`paradigm_ripple({ symbol: "#symbol" })\` |
| Debugging / searching | \`paradigm_search({ query: "ERROR_CODE" })\` |
| Starting a session | \`paradigm_session_recover()\` |
| Understanding relationships | \`paradigm_navigate({ intent: "find", target: "#symbol" })\` |
| Getting oriented | \`paradigm_status()\` |
| Checking impact on flows | \`paradigm_flows_affected({ symbol: "#symbol" })\` |
| Adding API endpoints | \`paradigm_gates_for_route({ method: "POST", path: "/api/resource" })\` |

## Query Patterns

### Before Changing Code

\`\`\`
// See what depends on what you're changing
paradigm_ripple({ symbol: "#checkout" })

// Returns: upstream deps, downstream effects, flow membership
\`\`\`

### When Debugging

\`\`\`
// Search for error context
paradigm_search({ query: "AUTH_REQUIRED" })

// Then check ripple effects of the related symbol
paradigm_ripple({ symbol: "^authenticated" })
\`\`\`

### Starting Work

\`\`\`
// Load previous session context (MUST do this at session start)
paradigm_session_recover()

// Quick project orientation
paradigm_status()
\`\`\`

### Finding Code Locations

\`\`\`
// Find a specific symbol
paradigm_navigate({ intent: "find", target: "#checkout" })

// Explore an area of code
paradigm_navigate({ intent: "explore", target: "authentication" })

// Get context for a task
paradigm_navigate({ intent: "context", task: "add Apple Pay" })
\`\`\`

## Why MCP Over CLI

- **No shell overhead**: Direct structured responses, no \`--json\` flags or \`jq\` parsing
- **Fresh data**: Always current, not stale from file generation
- **Precise**: Only get the data you need
- **Token-efficient**: ~100-300 tokens per query vs ~2000 for file reads
- **No latency**: No process spawn — MCP tools respond directly
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
paradigm_navigate({ intent: "find", target: "#checkout" })

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
   * Context monitoring rules - session management and handoff
   */
  private generateContextMdc(): string {
    return frontmatter('Session recovery and handoff - call paradigm_session_recover at session start, paradigm_context_check periodically during long sessions, paradigm_handoff_prepare when context is high.') +
      `# Context Monitoring Protocol

## Session Start (EVERY new session)

Call \`paradigm_session_recover\` to load previous session breadcrumbs.
Returns: symbols modified, files explored, recent actions, and suggestions.

## Periodic Checks

**Every 10-15 tool calls** (or when user asks about context), call:

\`\`\`
paradigm_context_check()
\`\`\`

This returns a recommendation: \`continue\`, \`consider-handoff\`, \`handoff-recommended\`, or \`handoff-urgent\`.

## When to Handoff

| Usage | Recommendation | Action |
|-------|----------------|--------|
| <50% | continue | Keep working |
| 50-70% | consider-handoff | Plan stopping point |
| 70-85% | handoff-recommended | Prepare handoff soon |
| >85% | handoff-urgent | Handoff after current task |

## When Recommendation is NOT "continue"

1. **Inform user**: "Context usage is at ~X%. Recommend handoff soon."
2. **Offer to prepare**: Ask if user wants handoff summary
3. **If urgent (>85%)**: Prioritize completing current task, then handoff

## Handoff Process

1. Call \`paradigm_handoff_prepare\` with:
   - Summary of work completed
   - List of next steps
   - Target agent role

2. User runs CLI command:
   \`\`\`bash
   paradigm team handoff --to <agent> --summary "..."
   \`\`\`

3. New session accepts:
   \`\`\`bash
   paradigm team accept <handoff-id>
   \`\`\`

## Session Stats

Get current stats anytime:
\`\`\`
paradigm_session_stats()
\`\`\`

${generateCheckpointProtocol()}`;
  }

  /**
   * Workflow protocol - the single most important compliance file.
   * Contains session bookends, task-size guide, essential MCP tools, and non-negotiable rules.
   */
  private generateWorkflowMdc(): string {
    return frontmatter('Paradigm workflow protocol - MUST follow for every task. Session bookends, task-size compliance, essential MCP tools.', {
      alwaysApply: true,
    }) +
      `# Paradigm Workflow Protocol

**This file defines the non-negotiable workflow for every task. Follow it.**

## Session Bookends (MUST Do)

### Session Start
\`\`\`
paradigm_session_recover()
\`\`\`
Call this FIRST in every session. Returns previous context, modified symbols, and suggestions.

### Session End
\`\`\`
paradigm_pm_postflight({ summary: "what you did" })
\`\`\`
Call this LAST before finishing. Catches missing .purpose files, missing gates, and compliance gaps.

## Task-Size Compliance Guide

Not every task needs the full ceremony. Match your effort to the scope:

### Single-file bug fix (1 file changed)
1. Session bookends (start + end)
2. That's it — fix the bug, run postflight

### Multi-file fix (2-3 files changed)
1. Session bookends
2. \`paradigm_ripple({ symbol: "#affected-symbol" })\` before changing
3. Update nearest \`.purpose\` file if behavior changed
4. Postflight

### Feature build (3+ files, new behavior)
1. Session bookends
2. \`paradigm_pm_preflight({ task: "description" })\` — get compliance plan
3. \`paradigm_ripple\` for each symbol you'll modify
4. Implement the feature
5. Create/update \`.purpose\` files for new directories
6. Update \`portal.yaml\` if adding protected routes
7. \`paradigm_pm_postflight\` — verify compliance
8. \`paradigm_lore_record\` — record what you learned

## The One Non-Negotiable Rule

**You MUST update the nearest \`.purpose\` file when you change behavior.**

- Adding a feature? Create a \`.purpose\` in the feature directory.
- Modifying a component? Update its \`.purpose\` description, gates, or signals.
- Deleting code? Remove the symbol from \`.purpose\`.
- Not sure? Run \`paradigm_pm_postflight\` — it will tell you what's missing.

## Essential MCP Tools (Use These, NOT CLI Commands)

| Tool | When | Cost |
|------|------|------|
| \`paradigm_session_recover\` | Session start | ~100 tokens |
| \`paradigm_ripple\` | Before modifying any symbol | ~300 tokens |
| \`paradigm_navigate\` | Finding code locations | ~200 tokens |
| \`paradigm_pm_preflight\` | Before starting a feature (3+ files) | ~200 tokens |
| \`paradigm_pm_postflight\` | After finishing any task | ~200 tokens |
| \`paradigm_reindex\` | After creating/modifying .purpose files | ~100 tokens |
| \`paradigm_gates_for_route\` | Before adding API endpoints | ~150 tokens |
| \`paradigm_lore_record\` | After completing a feature (record learnings) | ~100 tokens |

## Red Flags — STOP and Check

If you find yourself doing any of these, STOP:

- **Modifying 3+ files without calling \`paradigm_ripple\`** → Check impact first
- **Adding routes without checking \`paradigm_gates_for_route\`** → Get gate suggestions
- **Finishing without running \`paradigm_pm_postflight\`** → You'll miss compliance gaps
- **Creating directories without a \`.purpose\` file** → Every directory needs context
`;
  }

  /**
   * Practices - habits compliance, lore recording, llms.txt (Phase 5/6 content)
   */
  private generatePracticesMdc(): string {
    return frontmatter('Paradigm practices - habits, lore recording, and llms.txt. Apply when finishing tasks, recording history, or checking compliance.', {
      alwaysApply: false,
    }) +
      `# Paradigm Practices\n\n` +
      generateHabitsSection() + '\n\n' +
      generateLoreSection() + '\n\n' +
      generateLlmsTxtSection();
  }

  /**
   * Load agents manifest from .paradigm/agents.yaml
   */
  private loadAgentsManifest(rootDir: string): AgentsManifest | null {
    const agentsPath = path.join(rootDir, '.paradigm', 'agents.yaml');
    if (!fs.existsSync(agentsPath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(agentsPath, 'utf-8');
      return yaml.load(content) as AgentsManifest;
    } catch {
      return null;
    }
  }

  /**
   * Orchestration protocol rules - multi-agent workflow
   */
  private generateOrchestrationMdc(agentsManifest: AgentsManifest | null): string {
    // Build agent list from manifest (handle malformed agents.yaml gracefully)
    let agentList = '(Run `paradigm team init` to configure agents)';
    if (agentsManifest) {
      const agents = agentsManifest.agents || (agentsManifest as unknown as Record<string, unknown>).roles;
      if (agents && typeof agents === 'object') {
        try {
          agentList = Object.entries(agents as unknown as Record<string, Record<string, unknown>>)
            .map(([name, agent]) => {
              const roleText = (agent.role || agent.description || '') as string;
              const roleFirstLine = roleText.split('\n')[0].trim() || name;
              const writes = (agent.focus as Record<string, unknown>)?.writes;
              const writesStr = Array.isArray(writes) ? writes.join(', ') : 'any';
              const model = agent.defaultModel || 'sonnet';
              return `- **${name}** (${model}): ${roleFirstLine} (writes: ${writesStr})`;
            })
            .join('\n');
        } catch {
          // Fall through to default
        }
      }
    }

    // Detect OS for terminal guidance
    const platform = os.platform();
    const isWindows = platform === 'win32';
    const terminalGuidance = isWindows
      ? `## Terminal Syntax (Windows)

This project runs on **Windows**. Use appropriate syntax:

| Operation | Windows Syntax |
|-----------|----------------|
| Chain commands | \`cmd1 ; cmd2\` or \`cmd1 && cmd2\` (PowerShell) |
| Path separator | \`\\\` (backslash) |
| Environment vars | \`$env:VAR\` (PowerShell) or \`%VAR%\` (CMD) |
| Null device | \`$null\` (PowerShell) or \`NUL\` (CMD) |
| List files | \`dir\` or \`Get-ChildItem\` |
| Remove files | \`del\` or \`Remove-Item\` |

**IMPORTANT:** Do NOT use Unix-style commands like \`rm\`, \`cat\`, \`grep\` directly.`
      : `## Terminal Syntax (${platform === 'darwin' ? 'macOS' : 'Linux'})

This project runs on **${platform === 'darwin' ? 'macOS' : 'Linux'}**. Use appropriate syntax:

| Operation | Unix Syntax |
|-----------|-------------|
| Chain commands | \`cmd1 && cmd2\` (stop on error) or \`cmd1 ; cmd2\` (always continue) |
| Path separator | \`/\` (forward slash) |
| Environment vars | \`$VAR\` or \`\${VAR}\` |
| Null device | \`/dev/null\` |
| List files | \`ls\` |
| Remove files | \`rm\` |

**IMPORTANT:** Do NOT use Windows-style commands like \`dir\`, \`del\`, or \`%VAR%\`.`;

    return frontmatter('Multi-agent orchestration - use when task affects 3+ files, involves security AND implementation, or spans multiple features. Call paradigm_orchestrate_inline for planning.') +
      `# Paradigm Orchestration Protocol

${terminalGuidance}

## CRITICAL: When to Use Orchestration

**ALWAYS call \`paradigm_orchestrate_inline\` FIRST when:**
- Task affects 3+ files
- Task involves security/auth AND implementation
- Task mentions multiple features (#symbols)
- Building a new feature end-to-end
- User explicitly requests multi-agent workflow

## Workflow

1. **Plan first:** \`paradigm_orchestrate_inline({ task: "...", mode: "plan" })\`
   - Review suggested agents and estimated tokens
   - Check if parallel execution is possible

2. **Execute:** \`paradigm_orchestrate_inline({ task: "...", mode: "execute" })\`
   - Get full prompts and execution strategy
   - Note which stages can run in parallel

3. **Follow the plan sequentially:**
   - For each stage/agent, adopt that role's prompt and focus areas
   - Stage 0 (architect): Design and spec only — do NOT write implementation code
   - Stage 1 (builder): Implement following the architect's design
   - Stage 2 (tester/reviewer): Verify and test the implementation
   - Pass context between phases as if handing off to a teammate

4. **For true parallel execution**, suggest user runs:
   \`paradigm team orchestrate "task description"\`

5. **Record history:** \`paradigm_history_record({ type: "implement", symbols: [...], description: "..." })\`

## Available Agents

${agentList}

## Red Flags - STOP and Orchestrate

If you find yourself:
- Implementing 5+ files without planning → STOP, call orchestrate
- Adding auth without security review → STOP, involve security agent
- Writing code without specs → STOP, involve architect first
- Making cross-cutting changes → STOP, plan the stages

## DO NOT Skip Orchestration

Complex tasks need specialist agents. One agent trying to do everything leads to:
- Missed security gates
- Inconsistent patterns
- Poor test coverage
- Context overflow

## CLI Shortcut

You can also suggest agents via CLI:
\`\`\`bash
paradigm team agents suggest "Add user authentication with JWT"
\`\`\`
`;
  }

  /**
   * Flow-First Development rules
   */
  private generateFlowsMdc(): string {
    return frontmatter('Flow-first development - apply when implementing features spanning multiple steps, requiring gates, or emitting signals. Define $flows before coding.') +
      `# Flow-First Development

## What are Flows?

Flows ($symbols) are composable sequences of gates, actions, and signals that represent the "happy path" for a feature.

\`\`\`yaml
# .paradigm/flows.yaml
flows:
  $task-creation:
    name: Task Creation Flow
    description: Complete flow for creating a new task
    trigger: "POST /api/tasks"
    steps:
      - type: gate
        symbol: ^authenticated
        description: User must be logged in
      - type: gate
        symbol: ^project-member
        description: User must be member of target project
      - type: action
        symbol: "#validate-task-input"
        description: Validate task data
      - type: action
        symbol: "#create-task"
        description: Create task in database
      - type: signal
        symbol: "!task-created"
        description: Emit success event
    successSignal: "!task-created"
    failureSignal: "!task-creation-failed"
\`\`\`

## When to Define Flows

**BEFORE implementing features that:**
- Span multiple steps or components
- Require authorization gates
- Emit signals/events
- Integrate with external systems

## Flow-First Protocol

1. **Define the flow first** in \`.paradigm/flows.yaml\`:
   - What gates must pass?
   - What actions occur in what order?
   - What signals are emitted?

2. **Validate before implementing:**
   \`\`\`
   paradigm_flow_validate({ flowId: "$task-creation" })
   \`\`\`
   - Ensures all gates are declared in portal.yaml
   - Checks for missing symbols

3. **Implement following the flow:**
   - Each step becomes a clear implementation target
   - Gates → middleware/authorization checks
   - Actions → business logic functions
   - Signals → event emitters/hooks

## Flow Validation

Call \`paradigm_flow_validate\` to check flows:

\`\`\`
// Validate specific flow
paradigm_flow_validate({ flowId: "$task-creation" })

// Validate all flows
paradigm_flow_validate({ checkImplementation: true })
\`\`\`

**What gets checked:**
- All ^gates are declared in portal.yaml
- All #actions reference existing components
- All !signals are documented

## Benefits

1. **Clear implementation targets** - Each flow step is a discrete unit
2. **Gate coverage** - All authorization points are explicit
3. **Testability** - Flows can be tested step-by-step
4. **Documentation** - The flow IS the documentation
5. **Parallel work** - Different team members can implement different steps

## Red Flags

**STOP and define a flow if:**
- You're implementing a "happy path" without documenting it
- You're adding gates without knowing the full sequence
- You're emitting signals without knowing what listens
- You're modifying existing flows without checking validation

## MCP Tools

| Tool | Purpose |
|------|---------|
| \`paradigm_flow_validate\` | Validate flow definitions |
| \`paradigm_flows_affected\` | Check which flows are impacted by symbol changes |

## CLI Commands

\`\`\`bash
# Validate all flows
paradigm flow validate --all

# Validate specific flow
paradigm flow validate $task-creation
\`\`\`
`;
  }

  /**
   * Commit convention rules
   */
  private generateCommitsMdc(): string {
    return frontmatter('Paradigm commit conventions with Symbols: trailer - apply when creating git commits for history tracking.') +
      generateCommitConvention();
  }

  /**
   * Generate MCP configuration for Cursor
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
}

export const cursorAdapter = new CursorAdapter();
