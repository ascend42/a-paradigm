/**
 * MCP Orchestration Tools
 *
 * Enables inline multi-agent orchestration within a single Claude session.
 * Instead of spawning external processes, Claude adopts agent personas
 * and executes tasks sequentially with handoff context.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackToolCall } from './context.js';

// ============================================================================
// Types
// ============================================================================

interface AgentManifest {
  version: string;
  team: {
    name: string;
    default_agent: string;
    require_handoff: boolean;
  };
  orchestration?: {
    default_mode: 'faceted' | 'solo';
    budget?: {
      max_tokens?: number;
      max_cost_usd?: number;
      warn_at_percent?: number;
    };
    agent_limits?: Record<string, { max_tokens: number }>;
  };
  agents: Record<string, AgentDefinition>;
}

interface AgentDefinition {
  name: string;
  role: string;
  focus: {
    reads: string[];
    writes: string[];
  };
  triggers?: Array<{
    type: 'keyword' | 'symbol' | 'handoff';
    match?: string[];
    from?: string;
  }>;
  handoff_to?: string[];
  defaultModel?: 'opus' | 'sonnet' | 'haiku';
  context?: {
    include?: string[];
    exclude?: string[];
  };
  protocol?: {
    onFailure?: string;
    maxRetries?: number;
    requireApproval?: string[];
  };
}

interface ExecutionStage {
  stage: number;
  agents: Array<{
    name: string;
    task: string;
    dependsOn: string[];
    required: boolean;
  }>;
  canRunParallel: boolean;
}

// File plan types for parallel builder execution
interface FileAssignment {
  path: string;
  description: string;
}

interface FilePlanGroup {
  group: string;
  subPhase: number;
  files: FileAssignment[];
}

interface BuilderStage {
  subPhase: number;
  builders: Array<{
    agent: string;
    group: string;
    files: FileAssignment[];
    /** Files from earlier sub-phases that are now available */
    availableFiles: string[];
  }>;
}

interface ParallelBuilderPlan {
  hasFilePlan: boolean;
  stages: BuilderStage[];
  totalFiles: number;
  totalBuilders: number;
}

interface OrchestrationPlan {
  task: string;
  mode: 'faceted' | 'solo';
  stages: ExecutionStage[];
  symbols: string[];
  estimatedAgents: number;
  estimatedTokens: {
    min: number;
    max: number;
  };
}

interface AgentPromptResult {
  agent: string;
  model: 'opus' | 'sonnet' | 'haiku';
  prompt: string;
  taskDescription: string;
  subagentType: string;
  focusAreas: {
    reads: string[];
    writes: string[];
  };
}

// ============================================================================
// Constants
// ============================================================================

const SYMBOL_PATTERN = /[@#$%^!?&~][a-zA-Z0-9_-]+/g;

const DEFAULT_MODELS: Record<string, 'opus' | 'sonnet' | 'haiku'> = {
  architect: 'opus',
  security: 'opus',
  reviewer: 'sonnet',
  builder: 'haiku',
  tester: 'haiku',
};

const AGENT_TOKEN_ESTIMATES: Record<string, { min: number; max: number }> = {
  architect: { min: 5000, max: 20000 },
  security: { min: 3000, max: 15000 },
  reviewer: { min: 2000, max: 10000 },
  builder: { min: 10000, max: 50000 },
  tester: { min: 5000, max: 20000 },
};

// ============================================================================
// Role Prompts
// ============================================================================

const ROLE_PROMPTS: Record<string, string> = {
  architect: `You are the ARCHITECT agent.

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
- **Structured file plan for builders** (see File Plan Protocol)

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

Files in the same sub-phase can be built in parallel. Sub-phases execute sequentially.`,

  builder: `You are the BUILDER agent.

## Your Role
You implement code based on specifications from the Architect.
Follow specs exactly. If a spec is unclear, note it rather than guessing.

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
- Skip tests`,

  reviewer: `You are the REVIEWER agent.

## Your Role
You review code for correctness, security, and adherence to specs.
Check that all ^gate requirements are met.
You do NOT implement fixes yourself - hand back to Builder for that.

## Key Responsibilities
1. Verify implementation matches specifications
2. Check for security issues (OWASP top 10)
3. Ensure ^gate requirements are properly implemented
4. Verify code follows project conventions
5. Check test coverage

## What You Produce
- Review comments (inline or as a list)
- Approval or change requests
- Security findings

## What You DON'T Do
- Write or modify implementation code
- Make changes to fix issues yourself
- Skip security review for ^gate routes`,

  tester: `You are the TESTER agent.

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
- Skip testing ^gate routes`,

  security: `You are the SECURITY agent.

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
- Approve code with known vulnerabilities`,
};

// ============================================================================
// Tool Definitions
// ============================================================================

export function getOrchestrationToolsList() {
  return [
    {
      name: 'paradigm_orchestrate_inline',
      description: 'Plan a multi-agent task for inline execution. Returns an execution plan with stages and agent prompts. Use this to coordinate complex tasks across multiple agent roles (architect, builder, tester, etc.) within the same session.',
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The task to orchestrate (e.g., "Build @payment-system with Stripe integration")',
          },
          mode: {
            type: 'string',
            enum: ['plan', 'execute'],
            description: 'Mode: "plan" returns the execution plan, "execute" returns prompts ready for Task tool',
          },
          agents: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Override which agents to use (e.g., ["architect", "builder"])',
          },
        },
        required: ['task'],
      },
    },
    {
      name: 'paradigm_agent_prompt',
      description: 'Get the complete prompt for a specific agent to execute a task. Use this when you need to spawn an agent via the Task tool with full context.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            enum: ['architect', 'builder', 'tester', 'reviewer', 'security'],
            description: 'The agent role to get prompt for',
          },
          task: {
            type: 'string',
            description: 'The specific task for this agent',
          },
          handoffContext: {
            type: 'string',
            description: 'Optional: Context passed from a previous agent',
          },
          previousAgent: {
            type: 'string',
            description: 'Optional: Name of the agent that handed off',
          },
        },
        required: ['agent', 'task'],
      },
    },
  ];
}

// ============================================================================
// Tool Handlers
// ============================================================================

export async function handleOrchestrationTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ handled: boolean; text: string }> {
  if (name === 'paradigm_orchestrate_inline') {
    return handleOrchestrateInline(args, ctx);
  }

  if (name === 'paradigm_agent_prompt') {
    return handleAgentPrompt(args, ctx);
  }

  return { handled: false, text: '' };
}

// ============================================================================
// Orchestrate Inline Handler
// ============================================================================

async function handleOrchestrateInline(
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ handled: boolean; text: string }> {
  const task = args.task as string;
  const mode = (args.mode as string) || 'execute';
  const agentOverride = args.agents as string[] | undefined;

  // Load agents manifest
  const manifest = loadAgentsManifest(ctx.rootDir);
  if (!manifest) {
    const text = JSON.stringify({
      error: 'No agents.yaml found',
      suggestion: 'Run `paradigm team init` to set up multi-agent orchestration',
    }, null, 2);
    trackToolCall(text.length, 'paradigm_orchestrate_inline');
    return { handled: true, text };
  }

  // Extract symbols from task
  const symbols = extractSymbols(task);

  // Plan the agent sequence
  const plan = planAgentSequence(task, manifest.agents, agentOverride);

  if (mode === 'plan') {
    // Return just the plan
    const text = JSON.stringify({
      task,
      mode: 'plan',
      plan,
      instructions: [
        'Review this plan before executing',
        'Call again with mode="execute" to get agent prompts',
        'Or use paradigm_agent_prompt for individual agents',
      ],
    }, null, 2);
    trackToolCall(text.length, 'paradigm_orchestrate_inline');
    return { handled: true, text };
  }

  // Execute mode: return full prompts for each stage
  const stagePrompts: Array<{
    stage: number;
    canRunParallel: boolean;
    agents: AgentPromptResult[];
  }> = [];

  for (const stage of plan.stages) {
    const agentPrompts: AgentPromptResult[] = [];

    for (const agentStep of stage.agents) {
      const agentDef = manifest.agents[agentStep.name];
      if (!agentDef) continue;

      const promptResult = buildAgentPromptInternal({
        agent: agentDef,
        task: agentStep.task,
        symbols,
        dependsOn: agentStep.dependsOn,
      });

      agentPrompts.push(promptResult);
    }

    stagePrompts.push({
      stage: stage.stage,
      canRunParallel: stage.canRunParallel,
      agents: agentPrompts,
    });
  }

  // Generate orchestration ID for tracking
  const orchestrationId = `orch-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

  // Log to orchestrations directory
  logOrchestration(ctx.rootDir, orchestrationId, task, plan);

  const result = {
    orchestrationId,
    task,
    mode: 'execute',
    symbols,
    totalAgents: plan.estimatedAgents,
    stages: stagePrompts,
    executionInstructions: [
      'Execute stages in order (stage 0, then stage 1, etc.)',
      'Agents within a stage can be run in parallel using multiple Task tool calls',
      'Pass handoff context between stages',
      'After each agent completes, look for the Agent Relay block in their response',
    ],
    taskToolExample: {
      note: 'Use the Task tool with these parameters for each agent:',
      example: {
        description: stagePrompts[0]?.agents[0]?.taskDescription || 'Agent task',
        prompt: '(see agent prompts above)',
        subagent_type: 'general-purpose',
      },
    },
  };

  const text = JSON.stringify(result, null, 2);
  trackToolCall(text.length, 'paradigm_orchestrate_inline');
  return { handled: true, text };
}

// ============================================================================
// Agent Prompt Handler
// ============================================================================

async function handleAgentPrompt(
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ handled: boolean; text: string }> {
  const agentName = args.agent as string;
  const task = args.task as string;
  const handoffContext = args.handoffContext as string | undefined;
  const previousAgent = args.previousAgent as string | undefined;

  // Load agents manifest
  const manifest = loadAgentsManifest(ctx.rootDir);

  // Get agent definition (from manifest or use defaults)
  const agentDef: AgentDefinition = manifest?.agents[agentName] || {
    name: agentName,
    role: ROLE_PROMPTS[agentName] || ROLE_PROMPTS.builder,
    focus: {
      reads: ['**/*'],
      writes: ['**/*'],
    },
    defaultModel: DEFAULT_MODELS[agentName] || 'sonnet',
  };

  // Extract symbols from task
  const symbols = extractSymbols(task);

  // Build the prompt
  const promptResult = buildAgentPromptInternal({
    agent: agentDef,
    task,
    symbols,
    handoffContext,
    previousAgent,
  });

  const result = {
    agent: agentName,
    model: promptResult.model,
    prompt: promptResult.prompt,
    taskToolParams: {
      description: promptResult.taskDescription,
      prompt: promptResult.prompt,
      subagent_type: promptResult.subagentType,
      model: promptResult.model,
    },
    focusAreas: promptResult.focusAreas,
    usage: 'Use the Task tool with the taskToolParams to spawn this agent',
  };

  const text = JSON.stringify(result, null, 2);
  trackToolCall(text.length, 'paradigm_agent_prompt');
  return { handled: true, text };
}

// ============================================================================
// Planning Logic
// ============================================================================

function planAgentSequence(
  task: string,
  agents: Record<string, AgentDefinition>,
  agentOverride?: string[]
): OrchestrationPlan {
  const symbols = extractSymbols(task);
  const taskLower = task.toLowerCase();

  const stages: ExecutionStage[] = [];
  const plannedAgents: Array<{
    name: string;
    task: string;
    dependsOn: string[];
    required: boolean;
    stage: number;
  }> = [];

  // If agent override is provided, use those agents in sequence
  if (agentOverride && agentOverride.length > 0) {
    for (let i = 0; i < agentOverride.length; i++) {
      const agentName = agentOverride[i];
      if (agents[agentName]) {
        plannedAgents.push({
          name: agentName,
          task: `${agentName === 'architect' ? 'Design' : agentName === 'builder' ? 'Implement' : agentName === 'tester' ? 'Test' : 'Process'}: ${task}`,
          dependsOn: i > 0 ? [agentOverride[i - 1]] : [],
          required: true,
          stage: i,
        });
      }
    }
  } else {
    // Analyze task to determine agent sequence
    const hasDesign = taskLower.includes('design') || taskLower.includes('architect') ||
                      taskLower.includes('plan') || taskLower.includes('spec');
    const hasSecurity = taskLower.includes('auth') || taskLower.includes('security') ||
                        taskLower.includes('gate') || symbols.some((s) => s.startsWith('^'));
    const hasImplementation = taskLower.includes('build') || taskLower.includes('implement') ||
                              taskLower.includes('create') || taskLower.includes('add') ||
                              taskLower.includes('fix');
    const hasReview = taskLower.includes('review') || taskLower.includes('check');
    const hasTest = taskLower.includes('test') || taskLower.includes('verify') ||
                    taskLower.includes('validate');

    // Stage 0: Independent analysis (can run in parallel)
    if (hasDesign && agents['architect']) {
      plannedAgents.push({
        name: 'architect',
        task: `Design and specify: ${task}`,
        dependsOn: [],
        required: true,
        stage: 0,
      });
    }

    if (hasSecurity && agents['security']) {
      plannedAgents.push({
        name: 'security',
        task: `Review security aspects of: ${task}`,
        dependsOn: [],
        required: false,
        stage: 0,
      });
    }

    // Stage 1: Implementation (depends on design if present)
    if (hasImplementation && agents['builder']) {
      const dependsOn = hasDesign && agents['architect'] ? ['architect'] : [];
      plannedAgents.push({
        name: 'builder',
        task: `Implement: ${task}`,
        dependsOn,
        required: true,
        stage: dependsOn.length > 0 ? 1 : 0,
      });
    }

    // Stage 2: Review and Test (can run in parallel after implementation)
    const builderInPlan = plannedAgents.some(p => p.name === 'builder');
    const reviewStage = builderInPlan ? 2 : (hasDesign ? 1 : 0);

    if (hasReview && agents['reviewer']) {
      plannedAgents.push({
        name: 'reviewer',
        task: `Review: ${task}`,
        dependsOn: builderInPlan ? ['builder'] : [],
        required: false,
        stage: reviewStage,
      });
    }

    if (hasTest && agents['tester']) {
      plannedAgents.push({
        name: 'tester',
        task: `Test and validate: ${task}`,
        dependsOn: builderInPlan ? ['builder'] : [],
        required: false,
        stage: reviewStage,
      });
    }

    // Default flow if no specific agents matched
    if (plannedAgents.length === 0) {
      if (agents['architect']) {
        plannedAgents.push({ name: 'architect', task: `Design: ${task}`, required: true, stage: 0, dependsOn: [] });
      }
      if (agents['builder']) {
        plannedAgents.push({
          name: 'builder',
          task: `Implement: ${task}`,
          required: true,
          stage: agents['architect'] ? 1 : 0,
          dependsOn: agents['architect'] ? ['architect'] : [],
        });
      }
      if (agents['tester']) {
        plannedAgents.push({
          name: 'tester',
          task: `Test: ${task}`,
          required: false,
          stage: agents['builder'] ? 2 : (agents['architect'] ? 1 : 0),
          dependsOn: agents['builder'] ? ['builder'] : [],
        });
      }
    }
  }

  // Group by stage
  const stageMap = new Map<number, typeof plannedAgents>();
  for (const agent of plannedAgents) {
    const existing = stageMap.get(agent.stage) || [];
    existing.push(agent);
    stageMap.set(agent.stage, existing);
  }

  // Build stages array
  const sortedStages = Array.from(stageMap.keys()).sort((a, b) => a - b);
  for (const stageNum of sortedStages) {
    const stageAgents = stageMap.get(stageNum) || [];
    stages.push({
      stage: stageNum,
      agents: stageAgents.map(a => ({
        name: a.name,
        task: a.task,
        dependsOn: a.dependsOn,
        required: a.required,
      })),
      canRunParallel: stageAgents.length > 1,
    });
  }

  // Estimate tokens
  let minTokens = 0;
  let maxTokens = 0;
  for (const agent of plannedAgents) {
    const estimate = AGENT_TOKEN_ESTIMATES[agent.name] || { min: 5000, max: 20000 };
    minTokens += estimate.min;
    maxTokens += estimate.max;
  }

  return {
    task,
    mode: 'faceted',
    stages,
    symbols,
    estimatedAgents: plannedAgents.length,
    estimatedTokens: { min: minTokens, max: maxTokens },
  };
}

// ============================================================================
// Prompt Building
// ============================================================================

interface PromptBuildOptions {
  agent: AgentDefinition;
  task: string;
  symbols: string[];
  dependsOn?: string[];
  handoffContext?: string;
  previousAgent?: string;
}

function buildAgentPromptInternal(options: PromptBuildOptions): AgentPromptResult {
  const { agent, task, symbols, handoffContext, previousAgent } = options;

  const parts: string[] = [];

  // Role prompt
  const rolePrompt = ROLE_PROMPTS[agent.name] || agent.role || ROLE_PROMPTS.builder;
  parts.push(rolePrompt);
  parts.push('');
  parts.push('---');
  parts.push('');

  // Task section
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

  // Handoff context
  if (handoffContext) {
    parts.push('## Context from Previous Agent');
    if (previousAgent) {
      parts.push(`*Handed off from ${previousAgent}:*`);
    }
    parts.push('');
    parts.push(handoffContext);
    parts.push('');
  }

  // Focus areas
  parts.push('## Focus Areas');
  parts.push('');
  parts.push(`**Read from:** ${agent.focus.reads.join(', ')}`);
  parts.push(`**Write to:** ${agent.focus.writes.join(', ')}`);
  parts.push('');

  // Output format
  parts.push(`## Output Format

When you complete your task, end with a structured summary block:

\`\`\`yaml
# Agent Relay
status: success | partial | failed | blocked
summary: |
  Brief summary of what was accomplished
artifacts:
  - path/to/file1.ts  # created or modified
decisions:
  - Key decision 1
handoff_to: builder | reviewer | tester | architect | security  # optional
handoff_context: |
  Context the next agent needs to know
\`\`\`

This structured output helps track progress and pass context between agents.`);

  const prompt = parts.join('\n');
  const model = agent.defaultModel || DEFAULT_MODELS[agent.name] || 'sonnet';

  return {
    agent: agent.name,
    model,
    prompt,
    taskDescription: `${agent.name}: ${task.slice(0, 50)}${task.length > 50 ? '...' : ''}`,
    subagentType: 'general-purpose',
    focusAreas: agent.focus,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractSymbols(text: string): string[] {
  const matches = text.match(SYMBOL_PATTERN) || [];
  return [...new Set(matches)];
}

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

function loadAgentsManifest(rootDir: string): AgentManifest | null {
  const manifestPath = path.join(rootDir, '.paradigm', 'agents.yaml');

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return yaml.load(content) as AgentManifest;
  } catch {
    return null;
  }
}

function logOrchestration(
  rootDir: string,
  orchestrationId: string,
  task: string,
  plan: OrchestrationPlan
): void {
  const orchestrationsDir = path.join(rootDir, '.paradigm', 'orchestrations');

  // Ensure directory exists
  if (!fs.existsSync(orchestrationsDir)) {
    fs.mkdirSync(orchestrationsDir, { recursive: true });
  }

  const logPath = path.join(orchestrationsDir, `${orchestrationId}.yaml`);
  const logContent = {
    id: orchestrationId,
    task,
    created: new Date().toISOString(),
    status: 'pending',
    mode: plan.mode,
    symbols: plan.symbols,
    estimatedAgents: plan.estimatedAgents,
    estimatedTokens: plan.estimatedTokens,
    stages: plan.stages,
  };

  try {
    fs.writeFileSync(logPath, yaml.dump(logContent));
  } catch {
    // Silently fail if we can't write the log
  }
}

// ============================================================================
// File Plan Parsing & Builder Stage Planning
// ============================================================================

/**
 * Parse file plan from architect's relay output (YAML content)
 */
function parseFilePlan(yamlContent: string): FilePlanGroup[] | undefined {
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
        // Save last file from previous group
        if (currentFile.path) {
          currentGroup.files.push({
            path: currentFile.path,
            description: currentFile.description || '',
          });
          currentFile = {};
        }
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
        // Save previous file if exists
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
 * Parse file plan from full response text (looks for yaml block)
 */
function parseFilePlanFromResponse(response: string): FilePlanGroup[] | undefined {
  const yamlMatch = response.match(/```yaml\s*\n# Agent Relay\n([\s\S]*?)```/);
  if (!yamlMatch) {
    return undefined;
  }
  return parseFilePlan(yamlMatch[1]);
}

/**
 * Plan builder stages from architect's file plan
 *
 * Takes the file plan and creates BuilderStage[] where:
 * - Sub-phases execute sequentially
 * - Builders within a sub-phase execute in parallel
 * - Each builder gets narrowed context (only assigned files + available files)
 */
function planBuilderStages(filePlan: FilePlanGroup[] | undefined): ParallelBuilderPlan {
  // Fallback: single builder (current behavior)
  if (!filePlan || filePlan.length === 0) {
    return {
      hasFilePlan: false,
      stages: [{
        subPhase: 0,
        builders: [{
          agent: 'builder',
          group: 'all',
          files: [],
          availableFiles: [],
        }],
      }],
      totalFiles: 0,
      totalBuilders: 1,
    };
  }

  // Group by subPhase
  const subPhases = new Map<number, FilePlanGroup[]>();
  for (const group of filePlan) {
    const existing = subPhases.get(group.subPhase) || [];
    existing.push(group);
    subPhases.set(group.subPhase, existing);
  }

  // Create stages in order
  const stages: BuilderStage[] = [];
  const sortedPhases = [...subPhases.keys()].sort((a, b) => a - b);
  let availableFiles: string[] = [];
  let totalBuilders = 0;
  let totalFiles = 0;

  for (const phase of sortedPhases) {
    const groups = subPhases.get(phase)!;
    const builders: BuilderStage['builders'] = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      totalFiles += group.files.length;
      totalBuilders++;

      builders.push({
        agent: `builder-${phase}-${i}`,
        group: group.group,
        files: group.files,
        availableFiles: [...availableFiles],
      });
    }

    stages.push({
      subPhase: phase,
      builders,
    });

    // After this phase completes, its files become available to next phases
    for (const group of groups) {
      for (const file of group.files) {
        availableFiles.push(file.path);
      }
    }
  }

  return {
    hasFilePlan: true,
    stages,
    totalFiles,
    totalBuilders,
  };
}

/**
 * Build narrowed prompt for a parallel builder
 * Each builder gets only the context it needs for its assigned files
 */
function buildParallelBuilderPrompt(
  baseBuilderPrompt: string,
  assignedFiles: FileAssignment[],
  availableFiles: string[],
  architectSpec: string,
  groupName: string
): string {
  const parts: string[] = [];

  // Start with base builder prompt
  parts.push(baseBuilderPrompt);
  parts.push('');
  parts.push('---');
  parts.push('');

  // Specific assignment
  parts.push('## Your Assignment');
  parts.push('');
  parts.push(`You are responsible for implementing the **${groupName}** group.`);
  parts.push('');
  parts.push('### Files to Create:');
  for (const file of assignedFiles) {
    parts.push(`- \`${file.path}\`: ${file.description}`);
  }
  parts.push('');

  // Available files (from earlier sub-phases)
  if (availableFiles.length > 0) {
    parts.push('### Available Files (already created):');
    parts.push('These files exist and you can import from them:');
    for (const file of availableFiles) {
      parts.push(`- \`${file}\``);
    }
    parts.push('');
  }

  // Architect spec
  if (architectSpec) {
    parts.push('### Architect Specification:');
    parts.push(architectSpec);
    parts.push('');
  }

  // Instructions
  parts.push('### Instructions:');
  parts.push('1. Create ONLY the files assigned to you');
  parts.push('2. You can import from available files (already created)');
  parts.push('3. Follow the architect\'s specification exactly');
  parts.push('4. End with the standard Agent Relay block');

  return parts.join('\n');
}
