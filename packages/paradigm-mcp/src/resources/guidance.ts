/**
 * MCP Guidance Resources - On-demand behavioral guidance
 *
 * These resources contain content that was previously baked into CLAUDE.md.
 * Moving them to on-demand resources reduces the base context from ~856 lines
 * to ~150 lines while keeping all guidance accessible when needed.
 *
 * Resources:
 * - paradigm://guidance - List all available guidance topics
 * - paradigm://guidance/{topic} - Get specific guidance content
 */

import type { ProjectContext } from '../utils/index-loader.js';
import { trackResourceRead } from '../tools/context.js';

interface GuidanceTopic {
  name: string;
  description: string;
  tokens: number;
}

/**
 * All guidance topics with their content generators
 */
const GUIDANCE_TOPICS: Record<string, { description: string; generate: () => string }> = {

  'logging': {
    description: 'Paradigm logger usage, symbol-to-method mapping by directory',
    generate: () => `# Paradigm Logging Guide

**IMPORTANT:** Use the Paradigm logger instead of raw console.log/print.

## Usage Pattern

\`\`\`typescript
log.component('#login-handler').info('Starting login', { email });
log.component('#database').debug('Query executed', { duration });
log.gate('^authenticated').warn('Access denied', { userId });
log.signal('!login-success').info('User authenticated');
log.flow('$checkout').info('Flow step reached');
log.aspect('~audit-required').info('Audit triggered');
\`\`\`

## Symbol Mapping by Directory

| Directory | Symbol | Logger Method |
|-----------|--------|---------------|
| \`features/**\` | \`#\` | \`log.component()\` |
| \`routes/**\` | \`#\` | \`log.component()\` |
| \`api/**\` | \`#\` | \`log.component()\` |
| \`endpoints/**\` | \`#\` | \`log.component()\` |
| \`commands/**\` | \`#\` | \`log.component()\` |
| \`models/**\` | \`#\` | \`log.component()\` |
| \`components/**\` | \`#\` | \`log.component()\` |
| \`lib/**\` | \`#\` | \`log.component()\` |
| \`utils/**\` | \`#\` | \`log.component()\` |
| \`services/**\` | \`#\` | \`log.component()\` |
| \`core/**\` | \`#\` | \`log.component()\` |
| \`drivers/**\` | \`#\` | \`log.component()\` |
| \`systems/**\` | \`#\` | \`log.component()\` |
| \`integrations/**\` | \`#\` | \`log.component()\` |
| \`external/**\` | \`#\` | \`log.component()\` |
| \`vendors/**\` | \`#\` | \`log.component()\` |
| \`stores/**\` | \`#\` | \`log.component()\` |
| \`state/**\` | \`#\` | \`log.component()\` |
| \`reducers/**\` | \`#\` | \`log.component()\` |
| \`config/**\` | \`#\` | \`log.component()\` |
| \`middleware/**\` | \`^\` | \`log.gate()\` |
| \`auth/**\` | \`^\` | \`log.gate()\` |
| \`guards/**\` | \`^\` | \`log.gate()\` |
| \`policies/**\` | \`^\` | \`log.gate()\` |
| \`events/**\` | \`!\` | \`log.signal()\` |
| \`handlers/**\` | \`!\` | \`log.signal()\` |
| \`listeners/**\` | \`!\` | \`log.signal()\` |
| \`hooks/**\` | \`!\` | \`log.signal()\` |
| \`flows/**\` | \`$\` | \`log.flow()\` |
| \`sagas/**\` | \`$\` | \`log.flow()\` |
| \`workflows/**\` | \`$\` | \`log.flow()\` |
| \`pipelines/**\` | \`$\` | \`log.flow()\` |
| \`aspects/**\` | \`~\` | \`log.aspect()\` |
| \`rules/**\` | \`~\` | \`log.aspect()\` |
| \`constraints/**\` | \`~\` | \`log.aspect()\` |

See \`.paradigm/specs/logger.md\` for full specification.`,
  },

  'portal': {
    description: 'Portal protocol — authorization, gates, portal.yaml structure and workflow',
    generate: () => `# Portal Protocol (Authorization)

**Portal.yaml is REQUIRED when the project has protected routes.**

## When to Create portal.yaml

Create \`portal.yaml\` in project root when:
- Adding any endpoint that requires authentication
- Adding role-based access (admin, member, owner)
- Adding resource ownership checks (user can only edit their own data)

## portal.yaml Structure

\`\`\`yaml
# Gate keys are bare ids (no ^ prefix). The ^ prefix is for gate
# *references* — in routes, flow steps, code, and prose.
version: "2.0"
gates:
  authenticated:
    description: User must be logged in
    check: req.user != null
  project-admin:
    description: User must be admin of the project
    check: project.admins.includes(req.user.id)
  comment-author:
    description: User must be the comment author
    check: comment.authorId === req.user.id

routes:
  "GET /api/projects/:id":
    gates: [^authenticated, ^project-member]
    prizes: []
  "PUT /api/projects/:id":
    gates: [^authenticated, ^project-admin]
    prizes: []
  "DELETE /api/comments/:id":
    gates: [^authenticated, ^comment-author]
    prizes: []
\`\`\`

## When Adding New Endpoints

**ALWAYS update portal.yaml when adding routes:**

1. Call \`paradigm_gates_for_route\` to get suggestions
2. Add the route to portal.yaml with required gates
3. Implement the gate checks in your middleware/code
4. Test that unauthorized access returns 403

> **Portal.yaml is a documentation contract, not a runtime enforcement layer.** Paradigm's compliance checker validates that gates are declared in portal.yaml and referenced in .purpose files — it does not verify that your code actually enforces them. Step 3 (implementing gate checks) is your responsibility.

## Common Gate Patterns

| Pattern | Gate Name | Description |
|---------|-----------|-------------|
| Any logged-in user | \`^authenticated\` | Basic auth check |
| Resource membership | \`^{resource}-member\` | User is member of resource |
| Resource admin | \`^{resource}-admin\` | User is admin of resource |
| Resource owner | \`^{resource}-owner\` | User owns the resource |
| Author only | \`^{resource}-author\` | User created the resource |`,
  },

  'mcp-workflow': {
    description: 'MCP tool workflow — when to call which tool, token budgets, MCP vs file reads',
    generate: () => `# MCP Workflow Protocol

**Query before modifying** — Use MCP tools for token-efficient, fresh data:

## Before Doing X, Call Y

| Before doing this... | Call this tool |
|---------------------|----------------|
| **Implementing a common pattern** | \`paradigm_protocol_search\` for existing protocol |
| **Completed repeatable work** | \`paradigm_protocol_record\` to capture the pattern |
| Modifying a symbol | \`paradigm_ripple\` with the symbol |
| Understanding code | \`paradigm_navigate\` with explore intent |
| Checking dependencies | \`paradigm_related\` for connections |
| Getting oriented | \`paradigm_status\` for project overview |
| **Adding API endpoint** | \`paradigm_gates_for_route\` for auth gates |
| **Validating changes** | \`paradigm_flows_affected\` for flow impact |
| **Getting test data** | \`paradigm_test_fixtures\` for fixtures |
| **Building a feature (3+ files)** | \`paradigm_orchestrate_inline\` mode="plan" |
| **Task involves security + code** | \`paradigm_orchestrate_inline\` mode="plan" |
| **Tracking work items** | \`paradigm_task_create\` / \`paradigm_task_list\` |
| **Recording reflections** | \`paradigm_lore_record\` with \`arc:*\` tags |
| **Sending message to agents** | \`paradigm_symphony_send\` to compose + route |
| **Finishing work session** | \`paradigm_reindex\` to rebuild static index |
| **Cross-project impact** | \`paradigm_ripple\` with \`includeWorkspace: true\` |

## Token Budget Reference

| Operation | Typical Tokens | Use When |
|-----------|---------------|----------|
| \`paradigm_status\` | ~100 | Starting a session |
| \`paradigm_search\` | ~150 | Looking for symbols |
| \`paradigm_navigate\` | ~200 | Finding code locations |
| \`paradigm_ripple\` | ~300 | Before modifying symbols |
| \`paradigm_gates_for_route\` | ~150 | Adding API endpoints |
| \`paradigm_task_create\` | ~100 | Creating a work item |
| \`paradigm_lore_record\` | ~150 | Adding a lore entry |
| \`paradigm_symphony_peek\` | ~15 | Near-free inbox check |
| \`response_format: 'concise'\` | ~50% fewer | On any tool that supports it |
| File read (small) | ~500 | Need exact code |
| File read (large) | ~2000+ | Prefer MCP; use sparingly |

## MCP vs File Reads

| Need | Use MCP | Use File Read |
|------|---------|---------------|
| Find symbol | \`paradigm_navigate\` | Never |
| Check impact | \`paradigm_ripple\` | Never |
| Read implementation | MCP first | Then specific file |
| Write code | N/A | Existing patterns |
| Check team wisdom | \`paradigm_wisdom_context\` | Never |

**Rule**: MCP for discovery, files for implementation.

## MCP Tool Caching

Paradigm caches results for \`paradigm_search\`, \`paradigm_status\`, and \`paradigm_navigate\` with a 30-second TTL.
After \`paradigm_reindex\`, the cache is cleared.

## MCP Resources (On-Demand Content)

| Resource | URI | Content |
|----------|-----|---------|
| Prompts | \`paradigm://prompts\` | Task templates |
| Commands | \`paradigm://docs/commands\` | CLI command reference |
| Guidance | \`paradigm://guidance/{topic}\` | Behavioral guidance |
| Disciplines | \`paradigm://specs/disciplines\` | Symbol mappings by domain |`,
  },

  'flows': {
    description: 'Flow-first development — when to define flows, flows.yaml format, validation',
    generate: () => `# Flow-First Development

**Define flows BEFORE implementing features that span multiple steps.**

## When to Define Flows

Create a flow ($symbol) when your feature:
- Has multiple authorization gates
- Spans multiple components or services
- Emits events that trigger other actions
- Needs clear documentation of the "happy path"

## Flow Definition

Define flows in \`.paradigm/flows.yaml\`:

\`\`\`yaml
version: "1.0"
flows:
  $task-creation:
    name: Task Creation Flow
    trigger: "POST /api/tasks"
    steps:
      - type: gate
        symbol: ^authenticated
      - type: gate
        symbol: ^project-member
      - type: action
        symbol: "#create-task"
      - type: signal
        symbol: "!task-created"
    successSignal: "!task-created"
\`\`\`

## Flow-First Protocol

1. **Define the flow first** — What gates, actions, and signals?
2. **Validate** — Call \`paradigm_flow_check\` to check completeness
3. **Implement** — Each step becomes a clear implementation target

## Flow Validation

\`\`\`
paradigm_flow_check({ flowId: "$task-creation" })   # Specific flow
paradigm_flow_check({})                              # All flows
paradigm_flow_check({ checkImplementation: true })   # Deep check
\`\`\`

After modifying symbols, check affected flows:
\`\`\`
paradigm_flows_affected({ symbol: "#tasks" })
\`\`\``,
  },

  'orchestration': {
    description: 'Maestro team orchestration — attributed responses, ambient context, learning loop, bench/activate, documentor agent',
    generate: () => `# Maestro Team Orchestration

The Maestro model: the active Claude Code session orchestrates domain-specific subagents, makes their contributions visible as distinct attributed messages, and learns from feedback to improve agent performance over time.

## How Maestro Works

1. **Evaluate expertise** — Which agents have the highest confidence scores on relevant symbols?
2. **Load ambient context** — Recent team decisions, journal insights, and pending nominations are injected into each agent's prompt via \`buildProfileEnrichment()\`.
3. **Spawn subagents** — Each agent receives its full profile: personality, expertise history, transferable patterns, notebook entries, and ambient context.
4. **Present attributed responses** — Each agent's response appears with a \`[role]\` or \`[nickname (role)]\` prefix. Do NOT synthesize — show distinct contributions.
5. **Record to Symphony** — Each contribution is written as a Symphony message to \`thr-orch-*\` thread for Conductor/Platform visibility.
6. **Learn from feedback** — At session end, Maestro reads the session work log and writes targeted journal entries per agent.

## Attributed Responses

When presenting agent responses, use the \`attribution\` field from orchestration output:
- \`[architect]\` — default format
- \`[George (architect)]\` — if agent has a \`nickname\` in its profile

Do NOT combine or summarize multiple agents into one response. Each agent speaks for itself.

## Agent Roster

| Agent | Model | Role |
|-------|-------|------|
| architect | opus | Design, specifications, file plans |
| builder | haiku | Implementation from specs |
| security | opus | Auth, permissions, vulnerability review |
| reviewer | sonnet | Code quality, patterns, conventions |
| tester | haiku | Test coverage, assertions |
| documentor | haiku | .purpose, portal.yaml, symbol updates (always final stage) |

### Bench / Activate

Silence a noisy agent without deleting its profile:
- \`paradigm agent bench security\` — Maestro and nomination engine skip this agent
- \`paradigm agent activate security\` — restore to active orchestration
- \`paradigm agent roster\` — see active vs benched with stats

### Documentor Agent

The documentor always runs as the **final orchestration stage**. It:
- Reviews what other agents changed
- Updates .purpose files, portal.yaml, and symbol registrations
- Uses only \`paradigm_purpose_*\` and \`paradigm_portal_*\` MCP tools
- Runs \`paradigm_reindex\` when done
- Never modifies source code

This relieves all other agents of Paradigm file maintenance.

## Session Work Log

During a session, a running log captures:
- **Agent contributions** — what each agent was asked to do (from orchestration)
- **User verdicts** — accepted / dismissed / revised, with reason (from ambient engage)

Stored at \`.paradigm/events/session-log.jsonl\`. Read by Maestro at postflight.

## Learning Loop

At session end (via postflight skill Step 8b):

1. **Read session work log** — cross-reference contributions with verdicts
2. **Write journal entries** — targeted feedback per agent:
   - Accepted → \`human_feedback\` trigger, high confidence, extractable pattern
   - Dismissed → \`correction_received\` trigger, low confidence, explains what was wrong
   - Revised → \`correction_received\` trigger, medium confidence, includes delta
3. **Adjust thresholds** — \`paradigm_ambient_learn\` per agent
4. **Promote to notebooks** — \`paradigm_ambient_promote\` auto-promotes high-confidence journal entries

Journal entries with patterns flow through to notebooks, which appear in future \`buildProfileEnrichment()\` calls. This is how agents accumulate domain knowledge.

## Training New Behaviors

To teach an agent a new skill (e.g., "documentor should also draft CHANGELOG entries"):
1. Tell the agent during the session — Maestro records the instruction
2. The postflight pass writes a \`human_feedback\` journal entry with the new behavior
3. On promotion, it becomes a notebook entry
4. Next session, \`buildProfileEnrichment()\` injects that knowledge into the agent's context

No configuration needed — the learning pipeline IS the training mechanism.

## Neverland Validation

Track learning progress with \`paradigm_ambient_health\`:
- Per-agent: acceptance rate, threshold, expertise count, notebook count
- Aggregate: average accept rate, total expertise, total notebooks
- Health status: cold-start → accumulating → calibrating → mature
- Target: >80% routing accuracy by session 10, >70% acceptance rate

## MCP Tools

| Tool | Purpose |
|------|---------|
| \`paradigm_orchestrate_inline\` | Plan (mode=plan) or execute (mode=execute) multi-agent orchestration |
| \`paradigm_agent_prompt\` | Get enriched prompt for a single agent |
| \`paradigm_agent_list\` | List all agents with expertise + bench status |
| \`paradigm_agent_bench\` | Bench an agent |
| \`paradigm_agent_activate\` | Activate a benched agent |
| \`paradigm_ambient_health\` | Neverland validation metrics |
| \`paradigm_context_compose\` | Compose full ambient context for an agent |`,
  },

  'workspaces': {
    description: 'Multi-project workspaces — setup, cross-project tools, reindexing',
    generate: () => `# Workspaces (Multi-Project)

Paradigm supports multi-project workspaces via \`.paradigm-workspace\` files.

## Setup

1. In your first project: \`paradigm shift --workspace "workspace-name"\`
2. In each additional project: \`paradigm shift --workspace "workspace-name"\`

## .paradigm-workspace Format

\`\`\`yaml
version: "1.0"
name: my-workspace
members:
  - name: backend
    path: ./packages/paradigm
    role: api
    exports: ["#*-api", "^*"]
  - name: frontend
    path: ./packages/site
    role: client
\`\`\`

## Cross-Project Tools

| Tool | Workspace Parameter | Behavior |
|------|-------------------|----------|
| \`paradigm_search\` | \`includeWorkspace: true\` | Search sibling indices |
| \`paradigm_ripple\` | \`includeWorkspace: true\` | Cross-project impact analysis |
| \`paradigm_navigate\` | Automatic | Falls back to siblings |
| \`paradigm_gates_for_route\` | Automatic | Learns from sibling portal.yaml |
| \`paradigm_workspace_reindex\` | N/A | Rebuild all member indices |`,
  },

  'university': {
    description: 'Project university — content types, MCP tools, CLI commands, PLSAT',
    generate: () => `# Project University

Every project can maintain a university at \`.paradigm/university/\` — a structured knowledge base.

## Content Types

| Type | Prefix | Format | Purpose |
|------|--------|--------|---------|
| Note | \`N-\` | Markdown + YAML frontmatter | Architecture docs, guides |
| Policy | \`P-\` | Markdown + YAML frontmatter | Code review process, checklists |
| Quiz | \`Q-\` | YAML | Knowledge checks with grading |
| Learning Path | \`LP-\` | YAML | Ordered sequences + quizzes |
| Diploma | \`D-\` | YAML (auto-generated) | Completion records |

## Key MCP Tools

| Tool | Description |
|------|-------------|
| \`paradigm_university_search\` | Search by type, tag, difficulty, symbol |
| \`paradigm_university_get\` | Fetch full content by ID |
| \`paradigm_university_create\` | Create new content (agent-authored) |
| \`paradigm_university_update\` | Update existing content |
| \`paradigm_university_onboard\` | Get recommended onboarding sequence |
| \`paradigm_university_validate\` | Validate content integrity |`,
  },

  'calibration': {
    description: 'Confidence calibration — recording confidence, assessing correctness, querying stats',
    generate: () => `# Confidence Calibration

Lore entries support a confidence-assessment loop for building reliability maps.

## Recording Confidence

Attach a confidence score (0.0-1.0) when recording lore:

\`\`\`
paradigm_lore_record({
  title: "...", summary: "...", symbols_touched: [...],
  confidence: 0.85
})
\`\`\`

## Assessing Correctness

After the fact, humans assess whether the work was correct:

\`\`\`
paradigm_lore_assess({ id: "L-2026-03-15-...", verdict: "correct" })
\`\`\`

Verdicts: \`correct\` (1.0), \`partial\` (0.5), \`incorrect\` (0.0).
The system computes \`assessment_delta = impliedScore - confidence\`.

## Querying Calibration

\`\`\`
paradigm_lore_calibration({ symbol: "#auth-middleware", groupBy: "symbol" })
\`\`\`

Returns: accuracy rate, avg confidence, calibration score, verdict breakdown, and insights.

## Key Distinctions

- **review** = meta-quality of the work session (completeness 1-5, quality 1-5)
- **assessment** = correctness verdict on decisions made (correct/partial/incorrect)
- **confidence** = agent's predicted probability of being correct (0.0-1.0)`,
  },

  'checkpoints': {
    description: 'Session checkpoints — phase transitions, crash recovery, checkpoint format',
    generate: () => `# Session Checkpoints

**Auto-recovery**: Recovery data is automatically surfaced on your first Paradigm tool call.

Save checkpoints when transitioning between workflow phases:

| Phase | Trigger | What to Capture |
|-------|---------|-----------------|
| \`planning\` | After reading requirements | Plan, approach, key decisions |
| \`implementing\` | After starting code changes | Modified files, symbols, decisions |
| \`validating\` | After implementation | All modified files, test plan |
| \`complete\` | Task finished | Summary, final file list |

## Usage

\`\`\`
paradigm_session_checkpoint({
  phase: "implementing",
  context: "Adding JWT auth middleware",
  modifiedFiles: ["src/middleware/auth.ts"],
  symbolsTouched: ["^authenticated", "#project-routes"],
  decisions: ["Using RS256 for JWT signing"]
})
\`\`\`

Keep it lightweight: \`phase\` + \`context\` are required, everything else is optional.`,
  },

  'troubleshooting': {
    description: 'Common issues and solutions for Paradigm',
    generate: () => `# Troubleshooting

| Issue | Solution |
|-------|----------|
| "Symbol not found" | Run \`paradigm scan\` to rebuild index |
| "Navigator not found" | Run \`paradigm scan\` to generate navigator.yaml |
| Empty search results | Check that .purpose files define symbols |
| High context usage | Call \`paradigm_handoff_prepare\` |
| Gate suggestions missing | Check that portal.yaml exists and defines gates |
| "Flow index not found" | Run \`paradigm scan\` and add flows to .purpose files |
| "Fixtures not found" | Create \`.paradigm/fixtures.yaml\` with test data |
| Aspect anchors drifted | Run \`paradigm drift check --auto-heal\` |
| Undeclared gates in code | Run \`paradigm portal check\` |
| Purpose-required violation | Create .purpose files in directories matching config patterns |

## Validation Commands

- \`paradigm doctor\` — Health check for inconsistencies
- \`paradigm scan\` — Rebuild index
- \`paradigm portal check\` — Find undeclared gates
- \`paradigm drift check\` — Detect aspect anchor drift`,
  },

  'component-types': {
    description: 'Component types and hierarchy — type vs tag, .purpose file examples, parent field',
    generate: () => `# Component Types

Components (#) support an optional \`type\` field describing their structural role.

## .purpose File Example

\`\`\`yaml
components:
  GazeRouter:
    description: Maps gaze coordinates to dispatch targets
    type: router
    parent: "#InputOrchestrator"
  KalmanFilter2D:
    description: Smooths noisy gaze signal
    type: filter
    parent: "#GazeRouter"
\`\`\`

## Type vs Tag

- **\`type\`** = structural role (view, service, tool, router, filter) — one per component
- **\`tags\`** = behavioral and domain classification (feature, integration, state, critical) — many per component

## MCP Usage

- \`paradigm_search\` accepts \`componentType\` filter to find all components of a given type
- \`paradigm_status\` shows component type breakdown
- \`paradigm_purpose_add_component\` accepts \`type\` and \`parent\` parameters`,
  },

  'navigation': {
    description: 'Exploration protocol, task recipes, MCP navigation tools',
    generate: () => `# Navigation & Exploration

## Exploration Protocol

**INSTEAD OF:** Broad exploration (expensive token usage)

**DO THIS:**
1. Read \`.paradigm/navigator.yaml\` for structure map
2. Find relevant symbol → go to path
3. Read only needed files

## Task Recipes

**Adding a feature:**
1. Check \`navigator.yaml\` → \`structure.features.paths\`
2. Read existing feature as template
3. Create in same location

**Modifying a component:**
1. Look up symbol in \`navigator.yaml\` → \`symbols\`
2. Go directly to the path
3. Check \`paradigm_ripple\` for impact

## MCP Navigation Tools

- \`paradigm_navigate({ intent: "find", target: "#checkout" })\` — locate symbol
- \`paradigm_navigate({ intent: "explore", target: "auth" })\` — browse area
- \`paradigm_navigate({ intent: "context", task: "add login" })\` — task context

## PM Governance

| When | Tool | Purpose |
|------|------|---------|
| Starting any task | \`paradigm_pm_preflight\` | Get compliance plan |
| Finishing any task | _(handled by stop hook)_ | Auto-checks compliance |`,
  },

};

/**
 * Estimate tokens from text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Get guidance resources list for MCP
 */
export function getGuidanceResourcesList() {
  return [
    {
      uri: 'paradigm://guidance',
      name: 'Guidance Topics',
      description: 'List all available on-demand guidance topics (logging, portal, flows, orchestration, etc.)',
      mimeType: 'application/json',
    },
    {
      uri: 'paradigm://guidance/{topic}',
      name: 'Guidance Content',
      description: `Get guidance for a topic. Available: ${Object.keys(GUIDANCE_TOPICS).join(', ')}`,
      mimeType: 'text/markdown',
    },
  ];
}

/**
 * Handle guidance resource reads
 */
export async function handleGuidanceResource(
  resourcePath: string,
  _ctx: ProjectContext
): Promise<{ handled: boolean; text: string; mimeType: string }> {
  const uri = `paradigm://${resourcePath}`;

  // paradigm://guidance - List all topics
  if (resourcePath === 'guidance') {
    const topics: GuidanceTopic[] = Object.entries(GUIDANCE_TOPICS).map(([name, topic]) => {
      const content = topic.generate();
      return {
        name,
        description: topic.description,
        tokens: estimateTokens(content),
      };
    });

    const result = JSON.stringify({
      count: topics.length,
      totalTokens: topics.reduce((sum, t) => sum + t.tokens, 0),
      note: 'These guidance topics were previously baked into CLAUDE.md. Load on-demand to save context.',
      topics: topics.map(t => ({
        ...t,
        uri: `paradigm://guidance/${t.name}`,
      })),
    }, null, 2);

    trackResourceRead(result.length, uri);
    return { handled: true, text: result, mimeType: 'application/json' };
  }

  // paradigm://guidance/{topic} - Get specific topic
  if (resourcePath.startsWith('guidance/') && resourcePath !== 'guidance/') {
    const topicName = decodeURIComponent(resourcePath.replace('guidance/', ''));
    const topic = GUIDANCE_TOPICS[topicName];

    if (!topic) {
      const available = Object.keys(GUIDANCE_TOPICS);
      const errorResult = JSON.stringify({
        error: `Unknown guidance topic: "${topicName}"`,
        available,
      }, null, 2);
      trackResourceRead(errorResult.length, uri);
      return { handled: true, text: errorResult, mimeType: 'application/json' };
    }

    const content = topic.generate();
    trackResourceRead(content.length, uri);
    return { handled: true, text: content, mimeType: 'text/markdown' };
  }

  return { handled: false, text: '', mimeType: 'application/json' };
}
