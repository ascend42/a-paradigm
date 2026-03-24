/**
 * MCP Orchestration Tools
 *
 * Enables inline multi-agent orchestration within a single Claude session.
 * Instead of spawning external processes, Claude adopts agent personas
 * and executes tasks sequentially with handoff context.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackToolCall } from './context.js';
import { loadProjectRoster } from '../utils/agent-loader.js';

// Import task classification and cost estimation (via dynamic import to avoid circular deps)
type TaskClassification = {
  type: string;
  complexity: string;
  recommendedAgents: string[];
  securityRequired: boolean;
  costMultiplier: { min: number; max: number };
  matchedKeywords: string[];
  symbols: string[];
};

type CostPreview = {
  agents: Array<{
    name: string;
    model: string;
    estimatedTokens: number;
    estimatedCost: number;
  }>;
  totalEstimatedCost: number;
  comparisonToBaseline: string;
};

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
  /** Display prefix for attributed responses: "[nickname (role)]" or "[role]" */
  attribution: string;
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
  documentor: 'haiku',
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
- Implement multiple unrelated tasks in the same context`,

  reviewer: `You are the REVIEWER agent.

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
- Approve with zero findings — find at least 3`,

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

  documentor: `You are the DOCUMENTOR agent.

## Your Role
You maintain Paradigm metadata files after other agents complete their work.
You are the ONLY agent responsible for .purpose files, portal.yaml, and symbol registrations.
Other agents focus on their domain — you handle all Paradigm compliance.

## Key Responsibilities
1. Review what other agents changed (read git diff, session work log)
2. Update .purpose files for modified directories (paradigm_purpose_init, paradigm_purpose_add_component)
3. Update portal.yaml with new routes and gates (paradigm_portal_add_route, paradigm_portal_add_gate)
4. Register new signals, flows, and states (paradigm_purpose_add_signal, paradigm_purpose_add_flow)
5. Run paradigm_reindex when done to rebuild the symbol index
6. Ask peers via Symphony what symbols they touched if unclear

## What You ONLY Use
- paradigm_purpose_init / paradigm_purpose_add_component / paradigm_purpose_add_flow
- paradigm_purpose_add_gate / paradigm_purpose_add_signal / paradigm_purpose_add_state
- paradigm_portal_add_route / paradigm_portal_add_gate
- paradigm_reindex
- paradigm_search (to find existing symbols)
- paradigm_ripple (to check impact)

## What You NEVER Do
- Modify source code (.ts, .js, .py, .rs files)
- Write implementation code
- Change application logic
- Skip .purpose coverage for new code directories`,
};

// ============================================================================
// Tool Definitions
// ============================================================================

export function getOrchestrationToolsList() {
  return [
    {
      name: 'paradigm_orchestrate_inline',
      description: `REQUIRED before implementing features. Call with mode="plan" to get the right agents and cost estimate. Skipping this for complex tasks leads to missed security reviews and wasted tokens.

Plans and coordinates multi-agent task execution within the same session.
- mode: "plan" - See suggested agents, estimated tokens, and get orchestration plan
- mode: "execute" - Get full prompts and execution strategy for any IDE

After getting prompts, launch agents using the Task tool. Stages marked canRunParallel: true can be launched simultaneously in a single message.

When to use this tool:
- Task affects 3+ files
- Task involves security/auth AND implementation
- Task mentions multiple features (@symbols)
- Building a new feature end-to-end

Examples:
- "Add user authentication with JWT" → architect + security + builder + tester
- "Should I use soft delete or hard delete?" → architect only (analysis)
- "Fix the login bug" → security + builder
- "Refactor the payment module" → architect + builder`,
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
            description: 'Mode: "plan" returns suggested agents and plan, "execute" returns prompts ready for Task tool',
          },
          agents: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Override which agents to use (e.g., ["architect", "builder"])',
          },
        },
        required: ['task'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
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

  // Filter agents by project roster (if roster.yaml exists)
  const roster = loadProjectRoster(ctx.rootDir);
  if (roster && manifest.agents) {
    const filtered: Record<string, AgentDefinition> = {};
    for (const [id, def] of Object.entries(manifest.agents)) {
      if (roster.includes(id)) filtered[id] = def;
    }
    manifest.agents = filtered;
  }

  // Extract symbols from task
  const symbols = extractSymbols(task);

  // Classify the task for intelligent agent selection
  const classification = classifyTaskLocal(task);

  // Plan the agent sequence (pass classification for intelligent defaults)
  const plan = planAgentSequence(task, manifest.agents, agentOverride, classification);

  if (mode === 'plan') {
    // Get agent suggestions based on triggers
    const suggestedAgents = suggestAgentsForTask(task, manifest.agents);

    // Generate cost preview
    const costPreview = generateCostPreviewLocal(plan, classification);

    // Return the plan with suggestions and cost preview
    const text = JSON.stringify({
      task,
      mode: 'plan',
      classification: {
        type: classification.type,
        complexity: classification.complexity,
        securityRequired: classification.securityRequired,
        costMultiplier: classification.costMultiplier,
      },
      plan,
      suggestedAgents,
      costPreview,
      instructions: [
        'Review task classification and cost preview above',
        'Review suggested agents based on task triggers',
        'Call again with mode="execute" to get full prompts and execution strategy',
        'Stages marked canRunParallel: true can be launched simultaneously',
        'After each agent completes, pass handoff context to the next stage',
      ],
    }, null, 2);
    trackToolCall(text.length, 'paradigm_orchestrate_inline');
    return { handled: true, text };
  }

  // Execute mode: return full prompts for each stage
  // Load .agent profiles with full ambient context for enrichment (non-fatal)
  let agentProfiles: Map<string, { enrichment: string; nickname?: string }> = new Map();
  try {
    const { loadAgentProfile, buildProfileEnrichment } = await import('../utils/agent-loader.js');
    const { loadDecisions } = await import('../utils/decision-loader.js');
    const { loadJournalEntries } = await import('../utils/journal-loader.js');
    const { loadNominations } = await import('../utils/nomination-engine.js');

    // Load ambient context once (shared across all agents)
    const recentDecisions = loadDecisions(ctx.rootDir, { status: 'active', limit: 5 })
      .map(d => ({ title: d.title, decision: d.decision.slice(0, 150) }));
    const pendingNominations = loadNominations(ctx.rootDir, { pending_only: true, limit: 10 })
      .map(n => ({ urgency: n.urgency, brief: n.brief }));

    for (const stage of plan.stages) {
      for (const agentStep of stage.agents) {
        if (!agentProfiles.has(agentStep.name)) {
          const profile = loadAgentProfile(ctx.rootDir, agentStep.name);
          if (profile) {
            // Skip benched agents — Maestro does not consult them
            if (profile.benched) continue;

            // Load per-agent journal insights
            const journalInsights = loadJournalEntries(agentStep.name, {
              transferable: true,
              limit: 5,
            }).map(j => ({ trigger: j.trigger, insight: j.insight.slice(0, 150) }));

            let enrichment = buildProfileEnrichment(profile, symbols, undefined, {
              recentDecisions,
              journalInsights,
              pendingNominations,
            });

            // Append permission constraints if set
            if (profile.permissions) {
              const constraints: string[] = ['\n## Permission Constraints'];
              if (profile.permissions.paths?.deny?.length) {
                constraints.push(`**Denied paths:** ${profile.permissions.paths.deny.join(', ')}`);
              }
              if (profile.permissions.paths?.write?.length) {
                constraints.push(`**Writable paths:** ${profile.permissions.paths.write.join(', ')}`);
              }
              if (profile.permissions.tools?.deny?.length) {
                constraints.push(`**Denied tools:** ${profile.permissions.tools.deny.join(', ')}`);
              }
              if (profile.permissions.dangerous_actions?.length) {
                constraints.push(`**Requires approval for:** ${profile.permissions.dangerous_actions.join(', ')}`);
              }
              enrichment += '\n' + constraints.join('\n');
            }
            if (enrichment.trim()) {
              agentProfiles.set(agentStep.name, {
                enrichment,
                nickname: profile.nickname,
              });
            }
          }
        }
      }
    }
  } catch {
    // .agent profile loading is optional — falls back to agents.yaml behavior
  }

  const stagePrompts: Array<{
    stage: number;
    canRunParallel: boolean;
    agents: AgentPromptResult[];
  }> = [];

  for (const stage of plan.stages) {
    const agentPrompts: AgentPromptResult[] = [];

    for (const agentStep of stage.agents) {
      const manifestAgent = manifest.agents[agentStep.name];
      const agentDef: AgentDefinition = {
        name: manifestAgent?.name || agentStep.name,
        role: manifestAgent?.role || ROLE_PROMPTS[agentStep.name] || `${agentStep.name} agent`,
        focus: manifestAgent?.focus || { reads: ['**/*'], writes: ['**/*'] },
        defaultModel: manifestAgent?.defaultModel || DEFAULT_MODELS[agentStep.name] || 'sonnet',
        triggers: manifestAgent?.triggers,
        handoff_to: manifestAgent?.handoff_to,
        context: manifestAgent?.context,
        protocol: manifestAgent?.protocol,
      };

      const profileData = agentProfiles.get(agentStep.name);
      const promptResult = buildAgentPromptInternal({
        agent: agentDef,
        task: agentStep.task,
        symbols,
        dependsOn: agentStep.dependsOn,
        profileEnrichment: profileData?.enrichment,
        nickname: profileData?.nickname,
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

  // Log agent contributions to session work log
  try {
    const { appendSessionWorkEntry } = await import('../utils/session-work-log.js');
    for (const stage of stagePrompts) {
      for (const agent of stage.agents) {
        appendSessionWorkEntry(ctx.rootDir, {
          timestamp: new Date().toISOString(),
          type: 'agent-contribution',
          agent: agent.agent,
          contribution: agent.taskDescription?.slice(0, 200) || task.slice(0, 200),
          attribution: agent.attribution,
          symbols,
        });
      }
    }
  } catch { /* non-fatal */ }

  // Emit orchestration thread to Symphony for live visibility in Conductor
  const orchestrationThread = `thr-orch-${orchestrationId}`;
  try {
    const symphony = await import('../utils/symphony-loader.js');
    const projectName = path.basename(ctx.rootDir);
    const maestroId = `${projectName}/maestro`;

    // Register maestro agent if needed
    try {
      const identity = symphony.getMyIdentity(ctx.rootDir);
      if (!identity) {
        symphony.registerAgent(ctx.rootDir, 'maestro', 'Maestro (orchestrator)');
      }
    } catch { /* non-fatal */ }

    // Create orchestration thread
    symphony.createThread(`Orchestration: ${task.slice(0, 80)}`, {
      id: maestroId,
      name: 'Maestro',
      type: 'agent' as const,
      project: projectName,
      role: 'orchestrator',
    });

    // Rename thread to use thr-orch- prefix for SymphonyThreadWatcher
    const threadsDir = path.join(os.homedir(), '.paradigm', 'score', 'threads');
    const existingThreads = fs.readdirSync(threadsDir).filter(f => f.endsWith('.json')).sort();
    const latestThread = existingThreads[existingThreads.length - 1];
    if (latestThread) {
      const oldPath = path.join(threadsDir, latestThread);
      const newPath = path.join(threadsDir, `${orchestrationThread}.json`);
      const threadData = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
      threadData.id = orchestrationThread;
      fs.writeFileSync(newPath, JSON.stringify(threadData, null, 2), 'utf8');
      if (oldPath !== newPath) fs.unlinkSync(oldPath);
    }

    // Emit task assignment notes for each agent in each stage
    for (const stage of stagePrompts) {
      for (const agent of stage.agents) {
        const note = symphony.buildMessage({
          threadRoot: orchestrationThread,
          sender: { id: maestroId, name: 'Maestro', type: 'agent' as const, project: projectName, role: 'orchestrator' },
          intent: 'task' as any,
          text: `[Maestro] Stage ${stage.stage}: Assigned to ${agent.attribution || agent.agent} — ${agent.taskDescription || task}`,
          symbols,
          metadata: { task: { stage: stage.stage, canRunParallel: stage.canRunParallel } } as any,
        });
        symphony.routeMessage(note);
      }
    }
  } catch { /* Symphony emission is non-fatal */ }

  const result = {
    orchestrationId,
    task,
    mode: 'execute',
    symbols,
    totalAgents: plan.estimatedAgents,
    stages: stagePrompts,

    // IDE-agnostic execution instructions
    executionInstructions: [
      'Execute stages in order (stage 0, then stage 1, etc.)',
      'Agents within a stage can be run in parallel if your environment supports it',
      'Pass handoff context between stages',
      'Present each agent response as an attributed message using the attribution prefix (e.g., "[architect] Rate limiter should go before ^authenticated")',
      'Do NOT synthesize agent responses — show them as distinct contributions from each agent',
      'After all agents in a stage complete, reconcile their outputs before proceeding to the next stage',
    ],

    // Symphony thread for live visibility in Conductor
    symphony: {
      orchestrationThread,
      instruction: 'After each agent completes, call paradigm_symphony_send to report progress. This makes the work visible in Conductor.',
      perAgentInstruction: `When each agent finishes, run: paradigm_symphony_send threadId="${orchestrationThread}" intent="task-complete" text="[agentName] Summary of completed work" symbols=[touched symbols]`,
    },

    // Claude Code: Use Task tool for parallel agent spawning
    claudeCode: {
      method: 'Task tool',
      example: {
        description: stagePrompts[0]?.agents[0]?.taskDescription || 'Agent task',
        prompt: '(see agent prompts above)',
        subagent_type: 'general-purpose',
      },
      parallel: 'Launch multiple Task calls in one message for parallel stages',
    },

    // Cursor / other IDEs: Sequential self-orchestration
    sequential: {
      method: 'Execute each role in sequence within this session',
      steps: plan.stages.map((s, i) => ({
        stage: i,
        rolePrompt: `Adopt the ${s.agents[0]?.name} role. Focus ONLY on: ${s.agents.map(a => a.task).join(', ')}`,
        constraint: i === 0 ? 'Design/plan only — do NOT write implementation code' :
                    i === plan.stages.length - 1 ? 'Verify and test — do NOT change implementation' :
                    'Implement following the design from the previous stage',
      })),
    },

    // CLI delegation: For true parallelism from any environment
    cli: {
      method: 'paradigm team orchestrate',
      command: `paradigm team orchestrate "${task}"`,
      note: 'Spawns independent agent processes — works from any terminal',
    },

    // Symphony: Record agent contributions as team thread messages
    symphony: {
      enabled: true,
      orchestrationThread: `thr-${orchestrationId}`,
      instructions: [
        'After each agent completes, call paradigm_symphony_send to record the contribution',
        'Use intent "context" for analysis, "proposal" for recommendations, "decision" for decisions made',
        `Set threadRoot to "thr-${orchestrationId}" so all contributions are in one thread`,
        'Include the symbols array from the agent relay output',
        'This creates a visible team thread that Conductor and other sessions can observe',
      ],
      exampleCall: {
        intent: 'context',
        text: '[architect] Rate limiter should be placed before ^authenticated gate to prevent unauthenticated flood',
        threadRoot: `thr-${orchestrationId}`,
        symbols: ['#rate-limiter', '^authenticated'],
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

  // Check if agent is on the project roster (if roster exists)
  const rosterForPrompt = loadProjectRoster(ctx.rootDir);
  if (rosterForPrompt && !rosterForPrompt.includes(agentName)) {
    const text = JSON.stringify({
      warning: `Agent "${agentName}" is not on this project's roster`,
      suggestion: `Run paradigm_agent_activate id="${agentName}" to add it, or check .paradigm/roster.yaml`,
      activeRoster: rosterForPrompt,
    }, null, 2);
    trackToolCall(text.length, 'paradigm_agent_prompt');
    return { handled: true, text };
  }

  // Get agent definition — merge manifest with defaults to handle partial definitions
  const manifestAgent = manifest?.agents[agentName];
  const agentDef: AgentDefinition = {
    name: manifestAgent?.name || agentName,
    role: manifestAgent?.role || ROLE_PROMPTS[agentName] || ROLE_PROMPTS.builder,
    focus: manifestAgent?.focus || { reads: ['**/*'], writes: ['**/*'] },
    defaultModel: manifestAgent?.defaultModel || DEFAULT_MODELS[agentName] || 'sonnet',
    triggers: manifestAgent?.triggers,
    handoff_to: manifestAgent?.handoff_to,
    context: manifestAgent?.context,
    protocol: manifestAgent?.protocol,
  };

  // Extract symbols from task
  const symbols = extractSymbols(task);

  // Load .agent profile with ambient context for enrichment (non-fatal)
  let profileEnrichment: string | undefined;
  let nickname: string | undefined;
  try {
    const { loadAgentProfile, buildProfileEnrichment } = await import('../utils/agent-loader.js');
    const { loadDecisions } = await import('../utils/decision-loader.js');
    const { loadJournalEntries } = await import('../utils/journal-loader.js');
    const { loadNominations } = await import('../utils/nomination-engine.js');

    const profile = loadAgentProfile(ctx.rootDir, agentName);
    if (profile) {
      nickname = profile.nickname;

      // Load ambient context
      const recentDecisions = loadDecisions(ctx.rootDir, { status: 'active', limit: 5 })
        .map(d => ({ title: d.title, decision: d.decision.slice(0, 150) }));
      const journalInsights = loadJournalEntries(agentName, { transferable: true, limit: 5 })
        .map(j => ({ trigger: j.trigger, insight: j.insight.slice(0, 150) }));
      const pendingNominations = loadNominations(ctx.rootDir, { pending_only: true, limit: 10 })
        .map(n => ({ urgency: n.urgency, brief: n.brief }));

      let enrichment = buildProfileEnrichment(profile, symbols, undefined, {
        recentDecisions,
        journalInsights,
        pendingNominations,
      });

      // Append permission constraints if set
      if (profile.permissions) {
        const constraints: string[] = ['\n## Permission Constraints'];
        if (profile.permissions.paths?.deny?.length) {
          constraints.push(`**Denied paths:** ${profile.permissions.paths.deny.join(', ')}`);
        }
        if (profile.permissions.paths?.write?.length) {
          constraints.push(`**Writable paths:** ${profile.permissions.paths.write.join(', ')}`);
        }
        if (profile.permissions.tools?.deny?.length) {
          constraints.push(`**Denied tools:** ${profile.permissions.tools.deny.join(', ')}`);
        }
        if (profile.permissions.dangerous_actions?.length) {
          constraints.push(`**Requires approval for:** ${profile.permissions.dangerous_actions.join(', ')}`);
        }
        enrichment += '\n' + constraints.join('\n');
      }
      if (enrichment.trim()) profileEnrichment = enrichment;
    }
  } catch {
    // .agent profile loading is optional
  }

  // Build the prompt
  const promptResult = buildAgentPromptInternal({
    agent: agentDef,
    task,
    symbols,
    handoffContext,
    previousAgent,
    profileEnrichment,
    nickname,
  });

  const result = {
    agent: agentName,
    model: promptResult.model,
    prompt: promptResult.prompt,
    attribution: promptResult.attribution,
    taskToolParams: {
      description: promptResult.taskDescription,
      prompt: promptResult.prompt,
      subagent_type: promptResult.subagentType,
      model: promptResult.model,
    },
    focusAreas: promptResult.focusAreas,
    usage: 'Use the Task tool with the taskToolParams to spawn this agent. Present the response with the attribution prefix.',
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
  agentOverride?: string[],
  classification?: TaskClassification
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

    // Default flow if no specific agents matched — use classification's recommendedAgents
    if (plannedAgents.length === 0) {
      const recommended = classification?.recommendedAgents || ['architect', 'builder', 'tester'];
      const taskVerbs: Record<string, string> = {
        architect: 'Design',
        security: 'Review security of',
        builder: 'Implement',
        tester: 'Test',
        reviewer: 'Review',
      };

      let currentStage = 0;
      let previousAgent: string | null = null;

      for (const agentName of recommended) {
        if (!agents[agentName]) continue;

        const dependsOn = previousAgent ? [previousAgent] : [];
        const verb = taskVerbs[agentName] || 'Process';
        const isRequired = agentName === 'architect' || agentName === 'builder';

        plannedAgents.push({
          name: agentName,
          task: `${verb}: ${task}`,
          required: isRequired,
          stage: currentStage,
          dependsOn,
        });

        previousAgent = agentName;
        currentStage++;
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

  // Always add documentor as the final stage (updates .purpose, portal.yaml, symbols)
  const lastStageNum = sortedStages.length > 0 ? sortedStages[sortedStages.length - 1] + 1 : 0;
  stages.push({
    stage: lastStageNum,
    agents: [{
      name: 'documentor',
      task: 'Review all changes made by previous agents. Update .purpose files, portal.yaml, and symbol registrations using only paradigm_purpose_* and paradigm_portal_* MCP tools. Run paradigm_reindex when done. Do NOT modify source code.',
      dependsOn: plannedAgents.map(a => a.name),
      required: true,
    }],
    canRunParallel: false,
  });

  // Estimate tokens
  let minTokens = 0;
  let maxTokens = 0;
  for (const agent of plannedAgents) {
    const estimate = AGENT_TOKEN_ESTIMATES[agent.name] || { min: 5000, max: 20000 };
    minTokens += estimate.min;
    maxTokens += estimate.max;
  }
  // Add documentor estimate
  minTokens += 2000;
  maxTokens += 8000;

  return {
    task,
    mode: 'faceted',
    stages,
    symbols,
    estimatedAgents: plannedAgents.length + 1, // +1 for documentor
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
  /** Pre-built personality + expertise text from .agent profile */
  profileEnrichment?: string;
  /** Optional display nickname from .agent profile */
  nickname?: string;
}

function buildAgentPromptInternal(options: PromptBuildOptions): AgentPromptResult {
  const { agent, task, symbols, handoffContext, previousAgent } = options;

  const parts: string[] = [];

  // Agent identity enrichment (from .agent profile if available)
  if (options.profileEnrichment) {
    parts.push(options.profileEnrichment);
    parts.push('---');
    parts.push('');
  }

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
  if (agent.focus?.reads || agent.focus?.writes) {
    parts.push('## Focus Areas');
    parts.push('');
    parts.push(`**Read from:** ${agent.focus?.reads?.join(', ') || '**/*'}`);
    parts.push(`**Write to:** ${agent.focus?.writes?.join(', ') || '**/*'}`);
    parts.push('');
  }

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

  // Build attribution prefix: "[nickname (role)]" or "[role]"
  const attribution = options.nickname
    ? `[${options.nickname} (${agent.name})]`
    : `[${agent.name}]`;

  return {
    agent: agent.name,
    model,
    prompt,
    taskDescription: `${agent.name}: ${task.slice(0, 50)}${task.length > 50 ? '...' : ''}`,
    subagentType: 'general-purpose',
    attribution,
    focusAreas: agent.focus || { reads: ['**/*'], writes: ['**/*'] },
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

// ============================================================================
// Task Classification (Local Implementation)
// ============================================================================

/** Keywords that indicate an analysis task (no code changes) */
const ANALYSIS_KEYWORDS = [
  'should', 'what', 'how', 'why', 'recommend', 'analyze', 'compare',
  'evaluate', 'assess', 'review', 'explain', 'describe', 'investigate',
  'which', 'best practice', 'trade-off', 'pros and cons',
];

/** Keywords that indicate documentation task */
const DOCUMENTATION_KEYWORDS = [
  'document', 'write docs', 'readme', '.purpose', 'purpose file',
  'jsdoc', 'tsdoc', 'comments', 'docstring', 'api docs',
];

/** Keywords that indicate a bug fix */
const BUGFIX_KEYWORDS = [
  'bug', 'fix', 'broken', 'not working', 'issue', 'error', 'crash',
  'fails', 'failing', 'wrong', 'incorrect', 'regression', 'patch',
];

/** Keywords that indicate refactoring */
const REFACTOR_KEYWORDS = [
  'rename', 'refactor', 'migrate', 'restructure', 'move', 'reorganize',
  'clean up', 'cleanup', 'consolidate', 'extract', 'inline', 'simplify',
];

/** Keywords that indicate security-sensitive operations */
const SECURITY_KEYWORDS = [
  'auth', 'permission', 'admin', 'delete', 'purge', 'password',
  'credential', 'token', 'secret', 'key', 'encrypt', 'decrypt',
  'ownership', 'transfer', 'privilege', 'escalation', 'impersonation',
  'takeover', 'rbac', 'acl', 'role', 'guard', 'middleware',
  'session', 'cookie', 'csrf', 'xss', 'injection', 'sanitize',
];

/**
 * Local task classification for MCP tool
 */
function classifyTaskLocal(task: string): TaskClassification {
  const taskLower = task.toLowerCase();
  const symbols = extractSymbols(task);

  // Check keywords
  const matchesKeywords = (keywords: string[]) =>
    keywords.filter(k => taskLower.includes(k.toLowerCase()));

  const analysisMatches = matchesKeywords(ANALYSIS_KEYWORDS);
  const documentationMatches = matchesKeywords(DOCUMENTATION_KEYWORDS);
  const bugfixMatches = matchesKeywords(BUGFIX_KEYWORDS);
  const refactorMatches = matchesKeywords(REFACTOR_KEYWORDS);
  const securityMatches = matchesKeywords(SECURITY_KEYWORDS);

  // Determine type
  let type: string;
  let matchedKeywords: string[];

  if (analysisMatches.length > 0 && bugfixMatches.length === 0 && refactorMatches.length === 0) {
    type = 'analysis';
    matchedKeywords = analysisMatches;
  } else if (documentationMatches.length > 0 && bugfixMatches.length === 0) {
    type = 'documentation';
    matchedKeywords = documentationMatches;
  } else if (bugfixMatches.length > 0) {
    type = 'bugfix';
    matchedKeywords = bugfixMatches;
  } else if (refactorMatches.length > 0) {
    type = 'refactor';
    matchedKeywords = refactorMatches;
  } else {
    type = 'feature';
    matchedKeywords = [];
  }

  // Determine complexity
  let complexity: string = 'medium';
  const wordCount = task.split(/\s+/).length;
  if (symbols.length >= 5 || wordCount >= 100) complexity = 'high';
  else if (symbols.length <= 1 && wordCount < 30) complexity = 'low';

  // Security check
  const securityRequired = securityMatches.length > 0 || symbols.some(s => s.startsWith('^'));

  // Recommended agents based on type
  const agentMapping: Record<string, string[]> = {
    analysis: ['architect'],
    documentation: ['architect'],
    bugfix: ['security', 'builder'],
    refactor: ['architect', 'builder'],
    feature: ['architect', 'security', 'builder', 'tester'],
  };

  const costMultiplierMapping: Record<string, { min: number; max: number }> = {
    analysis: { min: 0.3, max: 0.5 },
    documentation: { min: 0.25, max: 0.45 },
    bugfix: { min: 0.5, max: 0.8 },
    refactor: { min: 0.6, max: 0.85 },
    feature: { min: 0.8, max: 1.2 },
  };

  return {
    type,
    complexity,
    recommendedAgents: agentMapping[type] || ['architect', 'builder'],
    securityRequired,
    costMultiplier: costMultiplierMapping[type] || { min: 0.8, max: 1.0 },
    matchedKeywords,
    symbols,
  };
}

// ============================================================================
// Cost Preview (Local Implementation)
// ============================================================================

/** Model pricing per 1M tokens */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  opus: { input: 15.00, output: 75.00 },
  sonnet: { input: 3.00, output: 15.00 },
  haiku: { input: 0.25, output: 1.25 },
};

/** Base token estimates per agent */
const AGENT_BASE_TOKENS: Record<string, { input: number; output: number }> = {
  architect: { input: 8000, output: 4000 },
  security: { input: 6000, output: 3000 },
  reviewer: { input: 5000, output: 2000 },
  builder: { input: 15000, output: 10000 },
  tester: { input: 8000, output: 5000 },
};

/**
 * Generate cost preview for orchestration plan
 */
function generateCostPreviewLocal(
  plan: OrchestrationPlan,
  classification: TaskClassification
): CostPreview {
  const agents: CostPreview['agents'] = [];
  let totalCost = 0;

  // Get complexity multiplier
  const complexityMultiplier = classification.complexity === 'high' ? 1.5 :
    classification.complexity === 'low' ? 0.6 : 1.0;

  // Calculate costs for each agent in the plan
  for (const stage of plan.stages) {
    for (const agentStep of stage.agents) {
      const base = AGENT_BASE_TOKENS[agentStep.name] || { input: 5000, output: 3000 };
      const model = DEFAULT_MODELS[agentStep.name] || 'sonnet';
      const pricing = MODEL_PRICING[model];

      const input = Math.round(base.input * complexityMultiplier);
      const output = Math.round(base.output * complexityMultiplier);
      const total = input + output;

      const cost = (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output;

      agents.push({
        name: agentStep.name,
        model,
        estimatedTokens: total,
        estimatedCost: Math.round(cost * 10000) / 10000, // Round to 4 decimal places
      });

      totalCost += cost;
    }
  }

  // Calculate baseline (full team)
  let baselineCost = 0;
  for (const [agent, base] of Object.entries(AGENT_BASE_TOKENS)) {
    const model = DEFAULT_MODELS[agent] || 'sonnet';
    const pricing = MODEL_PRICING[model];
    baselineCost += (base.input / 1_000_000) * pricing.input + (base.output / 1_000_000) * pricing.output;
  }

  const ratio = baselineCost > 0 ? totalCost / baselineCost : 1;

  return {
    agents,
    totalEstimatedCost: Math.round(totalCost * 10000) / 10000,
    comparisonToBaseline: `${ratio.toFixed(2)}x`,
  };
}

// ============================================================================
// Agent Suggestion
// ============================================================================

interface AgentSuggestion {
  name: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  triggers_matched: string[];
}

/**
 * Suggest agents for a task based on triggers in agents.yaml
 */
function suggestAgentsForTask(
  task: string,
  agents: Record<string, AgentDefinition>
): AgentSuggestion[] {
  const suggestions: AgentSuggestion[] = [];
  const taskLower = task.toLowerCase();
  const symbols = extractSymbols(task);

  for (const [name, agent] of Object.entries(agents)) {
    const matched: string[] = [];

    for (const trigger of agent.triggers || []) {
      if (trigger.type === 'keyword' && trigger.match) {
        for (const keyword of trigger.match) {
          if (taskLower.includes(keyword.toLowerCase())) {
            matched.push(`keyword:${keyword}`);
          }
        }
      }
      if (trigger.type === 'symbol' && trigger.match) {
        for (const pattern of trigger.match) {
          const matchingSymbols = symbols.filter((s) => {
            if (pattern.endsWith('*')) {
              return s.startsWith(pattern.slice(0, -1));
            }
            return s === pattern;
          });
          for (const s of matchingSymbols) {
            matched.push(`symbol:${s}`);
          }
        }
      }
    }

    if (matched.length > 0) {
      const keywordCount = matched.filter((m) => m.startsWith('keyword:')).length;
      const symbolCount = matched.filter((m) => m.startsWith('symbol:')).length;
      const hasMultipleTypes = keywordCount > 0 && symbolCount > 0;
      const confidence: 'high' | 'medium' | 'low' =
        matched.length >= 3 || hasMultipleTypes ? 'high' :
        matched.length >= 2 ? 'medium' : 'low';

      const roleFirstLine = agent.role.split('\n')[0].trim();
      const roleSnippet = roleFirstLine.length > 50 ? roleFirstLine.slice(0, 47) + '...' : roleFirstLine;

      suggestions.push({
        name,
        reason: roleSnippet,
        confidence,
        triggers_matched: matched,
      });
    }
  }

  // Sort by confidence score
  const scoreMap = { high: 3, medium: 2, low: 1 };
  return suggestions.sort((a, b) => scoreMap[b.confidence] - scoreMap[a.confidence]);
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
