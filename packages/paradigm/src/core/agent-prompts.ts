/**
 * Agent Prompts
 *
 * Role-specific prompt templates for inline orchestration.
 * These prompts enable Claude to "adopt" different agent personas
 * within the same session for multi-agent tasks.
 */

import { AgentDefinition } from '../commands/team/types.js';
import { AgentModel } from './agent-provider.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentPromptOptions {
  /** The agent definition from agents.yaml */
  agent: AgentDefinition;
  /** The specific task for this agent */
  task: string;
  /** Symbols referenced in the task (e.g., @payment, #stripe) */
  symbols: string[];
  /** Context passed from previous agent's handoff */
  handoffContext?: string;
  /** Previous agent that handed off (for context) */
  previousAgent?: string;
  /** Model being used (affects verbosity expectations) */
  model?: AgentModel;
  /** Include output format instructions */
  includeOutputFormat?: boolean;
}

export interface AgentPrompt {
  /** The full prompt text to give Claude */
  prompt: string;
  /** Suggested model for this agent */
  suggestedModel: AgentModel;
  /** Description for Task tool */
  taskDescription: string;
  /** Agent subtype for Task tool */
  subagentType: string;
}

export interface FileAssignment {
  path: string;
  description: string;
}

export interface FilePlanGroup {
  group: string;
  subPhase: number;
  files: FileAssignment[];
}

export interface RelayOutput {
  status: 'success' | 'partial' | 'failed' | 'blocked';
  summary: string;
  artifacts: string[];
  decisions: string[];
  handoffContext?: string;
  handoffTo?: string;
  /** File plan for parallel builder execution (from architect) */
  filePlan?: FilePlanGroup[];
}

// ============================================================================
// Role-Specific Prompts
// ============================================================================

const ARCHITECT_PROMPT = `You are the ARCHITECT agent.

## Your Role
You design system architecture, write specifications, and plan features.
You do NOT write implementation code - that's the Builder's job.

## Key Responsibilities
1. Analyze requirements and design solutions
2. Write clear specifications that Builders can implement
3. Define data models, API contracts, and component interfaces
4. Consider scalability, maintainability, and security
5. Document flows that span multiple components
6. **Create a file plan with dependency ordering for parallel builder execution**

## What You Produce
- Specification documents (in specs/*.md or inline)
- API contracts and data models
- Architecture diagrams (as text descriptions)
- Flow definitions using Paradigm $flow syntax
- **Structured file plan for builders** (see Output Format)

## What You DON'T Do
- Write implementation code
- Create test files
- Make changes to src/** files

## File Plan Protocol
When designing features, create a file plan that groups files by sub-phase:
- **Sub-phase 0**: Types, interfaces, and constants (no dependencies)
- **Sub-phase 1**: Core logic, models, utilities (depends on types)
- **Sub-phase 2**: Routes, handlers, integration (depends on models)
- **Sub-phase 3**: Tests (depends on implementation)

Files in the same sub-phase can be built in parallel. Sub-phases execute sequentially.

## Handoff Protocol
When your design is complete, summarize:
1. Key design decisions made
2. Components/interfaces defined
3. What the Builder needs to implement
4. Any open questions or trade-offs`;

const BUILDER_PROMPT = `You are the BUILDER agent.

## Your Role
You implement code based on specifications from the Architect.
Follow specs exactly. If a spec is unclear, note it rather than guessing.

## Fresh Context Principle
Each builder task runs in a separate, clean context. NEVER carry assumptions
from previous tasks. Re-read specs and handoff context for every invocation.
Why: Stale assumptions from prior tasks cause subtle bugs. A fresh context
ensures each implementation is based only on the current spec, not on
memory of what a previous task did.

## Key Responsibilities
1. Implement features according to specifications
2. Write clean, maintainable code
3. Follow existing patterns in the codebase
4. Create tests alongside implementation
5. Use the Paradigm logger (not console.log)

## What You Produce
- Implementation code in src/**
- Test files in tests/**
- Updates to existing code as needed

## What You DON'T Do
- Make architectural decisions without specs
- Change APIs or interfaces beyond what's specified
- Skip tests
- Implement multiple unrelated tasks in the same context

## Handoff Protocol
When implementation is complete, summarize:
1. Files created or modified
2. Key implementation decisions
3. Tests added
4. Any spec clarifications needed`;

const REVIEWER_PROMPT = `You are the REVIEWER agent.

## Your Role
You review code using a two-stage protocol: spec compliance first, then code quality.
You do NOT implement fixes yourself - hand back to Builder for that.

## Two-Stage Review Protocol

### Stage 1: Spec Compliance (MUST PASS before Stage 2)
Verify the implementation matches Paradigm metadata:
1. .purpose definitions — Are all new/modified components registered?
2. ^gates from portal.yaml — Are required gates implemented and enforced?
3. $flow step sequences — Do multi-step flows execute in the documented order?
4. !signal emissions — Are declared signals actually emitted at the right points?
5. ~aspect enforcement — Are aspects with anchors properly enforced in code?

If Stage 1 fails: STOP. Report blocking findings. Hand back to Builder.
Do NOT proceed to Stage 2 — reviewing code quality of spec-noncompliant code is wasted effort.

### Stage 2: Code Quality (only if Stage 1 passes)
1. Security (OWASP top 10, injection, XSS, auth bypass)
2. Project conventions and patterns
3. Test coverage adequacy
4. Performance and error handling

## Minimum 3 Findings Rule
Every review MUST produce at least 3 categorized findings:
- **blocking**: Must fix before approval. Spec violations, security issues, broken gates.
- **improvement**: Should fix. Convention violations, missing edge cases, weak tests.
- **note**: Informational. Suggestions, observations, minor style points.

Only blocking findings prevent approval. A review with 0 blocking + 3 notes = approved.
No "looks good" with zero findings — thorough examination always surfaces observations.

## What You Produce
- Categorized findings list (blocking / improvement / note)
- Stage 1 result (pass/fail)
- Stage 2 result (pass/fail/skipped)
- Clear approval status

## What You DON'T Do
- Write or modify implementation code
- Make changes to fix issues yourself
- Skip Stage 1 to go directly to code quality
- Approve with zero findings — find at least 3

## Handoff Protocol
After review, summarize:
1. Approval status (approved/changes-requested/blocked-at-stage-1)
2. Findings by category (blocking, improvement, note)
3. Which stage failed (if any)
4. Recommended next steps for Builder`;

const TESTER_PROMPT = `You are the TESTER agent.

## Your Role
You verify implementations work correctly.
Run tests, check portal validations, verify health status.

## Key Responsibilities
1. Run existing tests and report results
2. Write new tests for untested functionality
3. Verify ^gate validations work correctly
4. Update health.yaml when features are verified
5. Test edge cases and error handling

## What You Produce
- Test execution reports
- New test files
- Updates to health.yaml
- Bug reports with reproduction steps

## What You DON'T Do
- Modify implementation code to fix bugs
- Skip testing ^gate routes

## Handoff Protocol
After testing, summarize:
1. Test results (pass/fail counts)
2. New tests added
3. Bugs found with reproduction steps
4. Health status updates`;

const SECURITY_PROMPT = `You are the SECURITY agent.

## Your Role
You audit for security issues, especially around ^gates.
Review auth flows and check for vulnerabilities.
You flag issues but do NOT implement fixes - hand to Builder for that.

## Key Responsibilities
1. Audit ^gate implementations for completeness
2. Check for OWASP top 10 vulnerabilities
3. Review authentication and authorization flows
4. Verify sensitive data handling
5. Check for injection vulnerabilities (SQL, XSS, command)

## What You Produce
- Security audit reports
- Vulnerability findings with severity
- Recommendations for fixes
- portal.yaml updates (gate suggestions)

## What You DON'T Do
- Implement security fixes yourself
- Skip checking ^gate routes
- Approve code with known vulnerabilities

## Handoff Protocol
After audit, summarize:
1. Security status (secure/issues-found)
2. Vulnerabilities by severity
3. Missing ^gate coverage
4. Recommended fixes (for Builder)`;

// Dynamically import PM prompt to keep this file clean
let PM_PROMPT_CACHED: string | null = null;
function getPmPrompt(): string {
  if (!PM_PROMPT_CACHED) {
    // Inline a minimal version; the full prompt lives in pm-agent-prompt.ts
    PM_PROMPT_CACHED = `You are the PM (Project Manager) agent.

## Your Role
You are the governance layer for Paradigm-managed projects. You ensure compliance
with Paradigm conventions before and after implementation work. You decompose tasks,
enforce discipline, and coordinate other agents.

You do NOT write implementation code — you plan, validate, and coordinate.

## Key Responsibilities
1. Task Decomposition: Break complex tasks into agent-appropriate subtasks
2. Pre-flight Compliance: Verify symbols, ripple analysis, portal.yaml
3. Agent Routing: Determine which agents should handle each subtask
4. Post-flight Validation: Verify .purpose registration, portal.yaml gates, wisdom capture
5. Compliance Reporting: Produce clear violation reports with fixes`;
  }
  return PM_PROMPT_CACHED;
}

const ROLE_PROMPTS: Record<string, string> = {
  architect: ARCHITECT_PROMPT,
  builder: BUILDER_PROMPT,
  reviewer: REVIEWER_PROMPT,
  tester: TESTER_PROMPT,
  security: SECURITY_PROMPT,
  get pm() { return getPmPrompt(); },
};

const DEFAULT_MODELS: Record<string, AgentModel> = {
  architect: 'opus',
  security: 'opus',
  pm: 'sonnet',
  reviewer: 'sonnet',
  builder: 'haiku',
  tester: 'haiku',
};

// ============================================================================
// Output Format Instructions
// ============================================================================

const OUTPUT_FORMAT_INSTRUCTIONS = `
## Output Format

When you complete your task, end with a structured summary block:

\`\`\`yaml
# Agent Relay
status: success | partial | failed | blocked
summary: |
  Brief summary of what was accomplished
artifacts:
  - path/to/file1.ts  # created or modified
  - path/to/file2.ts
decisions:
  - Key decision 1
  - Key decision 2
handoff_to: builder | reviewer | tester | architect | security  # optional
handoff_context: |
  Context the next agent needs to know
\`\`\`

This structured output helps the orchestrator track progress and pass context.`;

const ARCHITECT_FILE_PLAN_INSTRUCTIONS = `
## File Plan Format (REQUIRED for Architect)

As an architect, you MUST include a filePlan in your relay output when handing off to builders.
This enables parallel builder execution with proper dependency ordering:

\`\`\`yaml
# Agent Relay
status: success
summary: |
  Designed the feature architecture
filePlan:
  # Sub-phase 0: Types/Interfaces (no dependencies)
  - group: types
    subPhase: 0
    files:
      - path: src/types/todo.ts
        description: "Todo interface and enums"
      - path: src/types/api.ts
        description: "API request/response types"

  # Sub-phase 1: Core logic (depends on types)
  - group: models
    subPhase: 1
    files:
      - path: src/models/todo.ts
        description: "Todo CRUD operations"
      - path: src/db/schema.ts
        description: "Database schema"

  # Sub-phase 2: Routes (depends on models)
  - group: routes
    subPhase: 2
    files:
      - path: src/routes/todos.ts
        description: "Todo API endpoints"
      - path: src/middleware/validation.ts
        description: "Input validation"

handoff_to: builder
handoff_context: |
  Implementation spec and file plan ready
\`\`\`

**Key rules:**
- Files in the same subPhase can be built in PARALLEL (multiple builders)
- SubPhases execute SEQUENTIALLY (0 → 1 → 2)
- Group by logical component (types, models, routes, tests)
- Each file needs path and description
- Consider import dependencies when assigning subPhase`;

// ============================================================================
// Prompt Builder
// ============================================================================

/**
 * Build a complete agent prompt for inline orchestration
 */
export function buildAgentPrompt(options: AgentPromptOptions): AgentPrompt {
  const {
    agent,
    task,
    symbols,
    handoffContext,
    previousAgent,
    model,
    includeOutputFormat = true,
  } = options;

  const parts: string[] = [];

  // Role-specific prompt. Precedence:
  // 1. Battle-tested hardcoded constant (ROLE_PROMPTS[name]) — wins for the core 5 + pm
  // 2. Rich multi-paragraph persona from the .agent profile (agent.description) — drives the ~62 others
  // 3. One-line role summary from agents.yaml (agent.role) — fallback
  // 4. Generic builder prompt — last resort
  const rolePrompt = ROLE_PROMPTS[agent.name] || agent.description || agent.role || ROLE_PROMPTS.builder;
  parts.push(rolePrompt);
  parts.push('');

  // Task section
  parts.push('---');
  parts.push('');
  parts.push('## Your Task');
  parts.push('');
  parts.push(task);
  parts.push('');

  // Symbols in scope
  if (symbols.length > 0) {
    parts.push('## Symbols in Scope');
    parts.push('');
    for (const symbol of symbols) {
      const type = getSymbolType(symbol);
      parts.push(`- \`${symbol}\` (${type})`);
    }
    parts.push('');
  }

  // Handoff context from previous agent
  if (handoffContext) {
    parts.push('## Context from Previous Agent');
    if (previousAgent) {
      parts.push(`*Handed off from ${previousAgent}:*`);
    }
    parts.push('');
    parts.push(handoffContext);
    parts.push('');
  }

  // Focus areas from agent definition
  if (agent.focus) {
    parts.push('## Focus Areas');
    parts.push('');
    if (agent.focus.reads && agent.focus.reads.length > 0) {
      parts.push(`**Read from:** ${agent.focus.reads.join(', ')}`);
    }
    if (agent.focus.writes && agent.focus.writes.length > 0) {
      parts.push(`**Write to:** ${agent.focus.writes.join(', ')}`);
    }
    parts.push('');
  }

  // Output format instructions
  if (includeOutputFormat) {
    parts.push(OUTPUT_FORMAT_INSTRUCTIONS);

    // Add file plan instructions for architects
    if (agent.name === 'architect') {
      parts.push(ARCHITECT_FILE_PLAN_INSTRUCTIONS);
    }
  }

  // Build the full prompt
  const prompt = parts.join('\n');

  // Determine suggested model
  const suggestedModel = model || DEFAULT_MODELS[agent.name] || 'sonnet';

  // Build task description for Task tool
  const taskDescription = `${agent.name}: ${task.slice(0, 50)}${task.length > 50 ? '...' : ''}`;

  // Determine subagent type (maps to Task tool's subagent_type)
  const subagentType = agent.name === 'builder' ? 'general-purpose' : 'general-purpose';

  return {
    prompt,
    suggestedModel,
    taskDescription,
    subagentType,
  };
}

/**
 * Build prompts for multiple agents in a stage (for parallel execution)
 */
export function buildStagePrompts(
  agents: Array<{
    agent: AgentDefinition;
    task: string;
    dependsOn: string[];
  }>,
  symbols: string[],
  handoffContexts: Map<string, string>
): AgentPrompt[] {
  return agents.map(({ agent, task, dependsOn }) => {
    // Build handoff context from dependencies
    let handoffContext: string | undefined;
    let previousAgent: string | undefined;

    if (dependsOn.length > 0) {
      const contexts = dependsOn
        .map(dep => handoffContexts.get(dep))
        .filter(Boolean);
      if (contexts.length > 0) {
        handoffContext = contexts.join('\n\n---\n\n');
        previousAgent = dependsOn[dependsOn.length - 1];
      }
    }

    return buildAgentPrompt({
      agent,
      task,
      symbols,
      handoffContext,
      previousAgent,
    });
  });
}

/**
 * Parse relay output from agent response
 */
export function parseRelayOutput(response: string): RelayOutput | null {
  // Look for the YAML relay block
  const yamlMatch = response.match(/```yaml\s*\n# Agent Relay\n([\s\S]*?)```/);
  if (!yamlMatch) {
    // Try to extract basic info from response
    const success = !response.toLowerCase().includes('failed') &&
                    !response.toLowerCase().includes('error');
    return {
      status: success ? 'success' : 'partial',
      summary: response.slice(0, 200),
      artifacts: [],
      decisions: [],
    };
  }

  try {
    // Simple YAML parsing for the relay block
    const yamlContent = yamlMatch[1];
    const lines = yamlContent.split('\n');
    const result: RelayOutput = {
      status: 'success',
      summary: '',
      artifacts: [],
      decisions: [],
    };

    let currentKey = '';
    let inMultiline = false;

    for (const line of lines) {
      if (line.startsWith('status:')) {
        result.status = line.split(':')[1].trim() as RelayOutput['status'];
      } else if (line.startsWith('summary:')) {
        const value = line.split(':').slice(1).join(':').trim();
        if (value === '|') {
          currentKey = 'summary';
          inMultiline = true;
        } else {
          result.summary = value;
        }
      } else if (line.startsWith('artifacts:')) {
        currentKey = 'artifacts';
      } else if (line.startsWith('decisions:')) {
        currentKey = 'decisions';
      } else if (line.startsWith('handoff_to:')) {
        result.handoffTo = line.split(':')[1].trim();
      } else if (line.startsWith('handoff_context:')) {
        const value = line.split(':').slice(1).join(':').trim();
        if (value === '|') {
          currentKey = 'handoff_context';
          inMultiline = true;
        } else {
          result.handoffContext = value;
        }
      } else if (line.trim().startsWith('- ')) {
        const value = line.trim().substring(2).split('#')[0].trim();
        if (currentKey === 'artifacts') {
          result.artifacts.push(value);
        } else if (currentKey === 'decisions') {
          result.decisions.push(value);
        }
      } else if (inMultiline && line.startsWith('  ')) {
        if (currentKey === 'summary') {
          result.summary += (result.summary ? '\n' : '') + line.trim();
        } else if (currentKey === 'handoff_context') {
          result.handoffContext = (result.handoffContext || '') +
            (result.handoffContext ? '\n' : '') + line.trim();
        }
      } else {
        inMultiline = false;
      }
    }

    return result;
  } catch {
    return null;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get symbol type from prefix
 */
function getSymbolType(symbol: string): string {
  const prefix = symbol.charAt(0);
  const types: Record<string, string> = {
    '@': 'feature',
    '#': 'component',
    '$': 'flow',
    '%': 'state',
    '^': 'gate',
    '!': 'signal',
    '?': 'idea',
    '&': 'integration',
    '~': 'deprecated',
  };
  return types[prefix] || 'unknown';
}

/**
 * Get the default model for an agent
 */
export function getDefaultModel(agentName: string): AgentModel {
  return DEFAULT_MODELS[agentName] || 'sonnet';
}

/**
 * Get role prompt for an agent (used for reference)
 */
export function getRolePrompt(agentName: string): string | undefined {
  return ROLE_PROMPTS[agentName];
}

/**
 * List available agent roles
 */
export function listAgentRoles(): string[] {
  return Object.keys(ROLE_PROMPTS);
}

/**
 * Parse file plan from YAML content
 * Handles the filePlan structure from architect relay output
 */
export function parseFilePlan(yamlContent: string): FilePlanGroup[] | undefined {
  const filePlan: FilePlanGroup[] = [];

  // Look for filePlan section
  const filePlanMatch = yamlContent.match(/filePlan:\s*\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
  if (!filePlanMatch) {
    return undefined;
  }

  const filePlanContent = filePlanMatch[1];
  const lines = filePlanContent.split('\n');

  let currentGroup: FilePlanGroup | null = null;
  let inFiles = false;
  let currentFile: Partial<FileAssignment> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // New group starts with "- group:"
    if (trimmed.startsWith('- group:')) {
      if (currentGroup) {
        filePlan.push(currentGroup);
      }
      currentGroup = {
        group: trimmed.split(':')[1].trim(),
        subPhase: 0,
        files: [],
      };
      inFiles = false;
      continue;
    }

    if (!currentGroup) continue;

    // Parse subPhase
    if (trimmed.startsWith('subPhase:')) {
      currentGroup.subPhase = parseInt(trimmed.split(':')[1].trim(), 10) || 0;
      continue;
    }

    // Start of files array
    if (trimmed === 'files:') {
      inFiles = true;
      continue;
    }

    if (inFiles) {
      // New file entry starts with "- path:"
      if (trimmed.startsWith('- path:')) {
        if (currentFile.path) {
          currentGroup.files.push({
            path: currentFile.path,
            description: currentFile.description || '',
          });
        }
        currentFile = {
          path: trimmed.split(':').slice(1).join(':').trim().replace(/^["']|["']$/g, ''),
        };
        continue;
      }

      // Description for current file
      if (trimmed.startsWith('description:')) {
        currentFile.description = trimmed.split(':').slice(1).join(':').trim().replace(/^["']|["']$/g, '');
        continue;
      }
    }
  }

  // Don't forget the last file and group
  if (currentFile.path && currentGroup) {
    currentGroup.files.push({
      path: currentFile.path,
      description: currentFile.description || '',
    });
  }
  if (currentGroup) {
    filePlan.push(currentGroup);
  }

  return filePlan.length > 0 ? filePlan : undefined;
}

/**
 * Parse relay output with file plan support
 */
export function parseRelayWithFilePlan(response: string): RelayOutput | null {
  const result = parseRelayOutput(response);
  if (!result) return null;

  // Try to parse file plan from the YAML content
  const yamlMatch = response.match(/```yaml\s*\n# Agent Relay\n([\s\S]*?)```/);
  if (yamlMatch) {
    const filePlan = parseFilePlan(yamlMatch[1]);
    if (filePlan) {
      result.filePlan = filePlan;
    }
  }

  return result;
}
