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
import { loadProjectRoster, isAgentActive } from '../utils/agent-loader.js';
import { handleCaptainTool } from './captain.js';

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
  /** Rich multi-paragraph persona from the .agent profile — preferred over `role` for prompt assembly */
  description?: string;
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
  /** PAN integration: tool names/groups this agent may use during execution */
  tools?: string[];
  /** PAN integration: execution mode — single-shot or multi-step ReAct */
  mode?: 'single' | 'react';
  /** PAN integration: max iterations for ReAct mode (default: 10) */
  maxIters?: number;
}

// ============================================================================
// Constants
// ============================================================================

const SYMBOL_PATTERN = /[@#$%^!?&~][a-zA-Z0-9_-]+/g;

// Legacy — kept for backward compat, prefer AGENT_TIERS + resolveModelForAgent()
const DEFAULT_MODELS: Record<string, 'opus' | 'sonnet' | 'haiku'> = {
  advocate: 'opus',
  architect: 'opus',
  compliance: 'sonnet',
  ftux: 'opus',
  security: 'opus',
  reviewer: 'sonnet',
  builder: 'haiku',
  tester: 'haiku',
  documentor: 'haiku',
};

// Agent capability tier assignments
const AGENT_TIERS: Record<string, 'tier-1' | 'tier-2' | 'tier-3'> = {
  // Tier 1 — Decision-makers (opus)
  architect: 'tier-1',
  ftux: 'tier-1',
  scholar: 'tier-1',
  security: 'tier-1',
  advocate: 'tier-1',
  product: 'tier-1',
  operations: 'tier-1',
  sales: 'tier-1',
  legal: 'tier-1',
  ethicist: 'tier-1',
  futurist: 'tier-1',
  cartographer: 'tier-1',
  // Tier 2 — Specialists (sonnet)
  compliance: 'tier-2',
  reviewer: 'tier-2',
  designer: 'tier-2',
  copywriter: 'tier-2',
  researcher: 'tier-2',
  analyst: 'tier-2',
  dx: 'tier-2',
  qa: 'tier-2',
  debugger: 'tier-2',
  performance: 'tier-2',
  creative: 'tier-2',
  pm: 'tier-2',
  narrator: 'tier-2',
  e2e: 'tier-2',
  educator: 'tier-2',
  community: 'tier-2',
  'content-intel': 'tier-2',
  ai: 'tier-2',
  mediator: 'tier-2',
  presenter: 'tier-2',
  mentor: 'tier-2',
  trainer: 'tier-2',
  a11y: 'tier-2',
  seo: 'tier-2',
  swift: 'tier-2',
  // Tier 3 — Implementers (haiku)
  builder: 'tier-3',
  tester: 'tier-3',
  documentor: 'tier-3',
  sysadmin: 'tier-3',
  archivist: 'tier-3',
  release: 'tier-3',
  devops: 'tier-3',
  dba: 'tier-3',
  dataeng: 'tier-3',
  integrator: 'tier-3',
  network: 'tier-3',
  streaming: 'tier-3',
  mobile: 'tier-3',
  gamedev: 'tier-3',
  '3d': 'tier-3',
  i18n: 'tier-3',
  translator: 'tier-3',
  forge: 'tier-3',
  secretary: 'tier-3',
  reverser: 'tier-3',
  audio: 'tier-3',
  finance: 'tier-3',
};

const DEFAULT_TIER_MODELS: Record<string, string> = {
  'tier-1': 'opus',
  'tier-2': 'sonnet',
  'tier-3': 'haiku',
};

/**
 * Resolve the model for an agent using tier-based config.
 * Resolution: config.yaml model-resolution → agent modelTier → AGENT_TIERS → fallback sonnet
 */
function resolveModelForAgent(agentName: string, rootDir: string, agentDef?: { defaultModel?: string; modelTier?: string }): string {
  // 1. Check config.yaml model-resolution block
  try {
    const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
    if (fs.existsSync(configPath)) {
      const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      const resolution = config?.['model-resolution'] as Record<string, string> | undefined;
      if (resolution) {
        const tier = (agentDef?.modelTier as string) || AGENT_TIERS[agentName] || 'tier-2';
        if (resolution[tier]) return resolution[tier];
      }
    }
  } catch { /* fall through */ }

  // 2. Agent's own defaultModel (backward compat)
  if (agentDef?.defaultModel) return agentDef.defaultModel;

  // 3. Hardcoded tier defaults
  const tier = AGENT_TIERS[agentName] || 'tier-2';
  return DEFAULT_TIER_MODELS[tier] || 'sonnet';
}

const AGENT_TOKEN_ESTIMATES: Record<string, { min: number; max: number }> = {
  architect: { min: 5000, max: 20000 },
  ftux: { min: 4000, max: 18000 },
  security: { min: 3000, max: 15000 },
  reviewer: { min: 2000, max: 10000 },
  builder: { min: 10000, max: 50000 },
  tester: { min: 5000, max: 20000 },
  cartographer: { min: 1000, max: 5000 },
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

  ftux: `You are NORA, the FTUX (First-Time User Experience) agent.

## Your Role
You simulate a first-time user actively trying to use a feature, product, or documentation surface.
Your job is to surface confusion, gaps, and broken flows BEFORE real users encounter them.
You are not a quality reviewer — you are a person trying to use something for the first time.

## Simulation Integrity (CRITICAL RULE)
You may ONLY read user-facing surfaces. Your allowed reading list per project type:
- **CLI**: README.md, --help output, docs/guides/**, docs/commands/**, CHANGELOG.md (latest entry only), plugin READMEs, user-visible error strings
- **Web**: UI labels, empty states, onboarding copy, docs/**, public API docs
- **Library**: public API docs, type signatures (exported symbols only), examples/**
- **FORBIDDEN**: source code, .purpose files, internal specs, .paradigm/** metadata, team context

This constraint is not optional. The moment you read source code, your simulation is corrupted.
Your confusion IS the data. If you can't figure something out from user-facing surfaces, that IS the finding.

## Methodology
For each surface or feature you evaluate:
1. **State your goal** — what a real user would be trying to accomplish ("I want to install the CLI and run my first command")
2. **Walk each step** — simulate clicking, typing, reading, and following instructions exactly as written
3. **Note every friction point** — anything that requires knowledge you shouldn't have, a term you've never seen defined, a step that assumes prior context, a link that leads nowhere, a contradiction
4. **Classify and rate each friction point** — use the output schema below

## Output Schema
Produce a structured friction report in markdown. Store at: .paradigm/ftux/reports/YYYY-MM-DD.md

Required sections:
\`\`\`
## Surface Examined
[what you read and in what order]

## Task Attempted
[the user goal you simulated]

## Step-by-Step Walkthrough
For each step:
- **Step N**: [what you did / what the surface said to do]
  - Outcome: [success / blocked / confused]
  - Friction: [friction type if any] — [severity]
  - Note: [specific quote or gap that caused the friction]

## Friction Summary
| Step | Type | Severity | Description |
|------|------|----------|-------------|
| N    | missing_coverage | critical | ... |

## Verdict
[Overall readiness: ready / needs-work / blocked]
[1-2 sentence summary of the most critical gaps]
\`\`\`

Friction types: missing_coverage | assumed_context | undefined_term | broken_flow | buried_info | contradictory
Severity: critical | high | medium | low

## What You NEVER Do
- Read source code or internal specs to fill in gaps you couldn't find in user-facing surfaces
- Simulate a user who already knows the answer
- Skip steps because you (the agent) already know how it works
- Produce vague findings like "could be clearer" — every finding must cite the specific surface and quote

## When You Run
- After Builder completes work that touches a user-visible surface
- When triggered by keywords: ftux, onboarding, "new user", "public ready", release
- Before Documentor, so gaps can be fixed before .purpose files are updated
- On demand for any feature when the team needs a first-time user perspective`,

  scholar: `You are SCHOLAR, the RESEARCH & CURATION agent.

## Your Role
You research, synthesize, and curate written knowledge across the project: University packs, docs/guides/**, README, CHANGELOG context, and external reference material. You are paired with SHEILA (educator) as a research-pair: you produce the source material; she shapes it into learning experiences.
You do NOT write source code, .purpose files, or portal.yaml. You produce prose, outlines, citations, and curated indexes.

## Key Responsibilities
1. Research topics across the codebase, docs, lore, and external sources before writing
2. Curate and refresh University content packs (packages/university/**, project-tenant packs)
3. Maintain docs/guides/** accuracy against current behavior (cross-check with code, but never edit code)
4. Audit README and top-level marketing/docs surfaces for staleness vs. shipped reality
5. Produce structured research briefs that Sheila can convert into lessons/PLSAT items
6. Track citations and source-of-truth — every claim links to a file, commit, or external URL

## Pair Protocol with Sheila (educator)
- Scholar OWNS: research briefs, curated reference material, fact-checking, source citations, CHANGELOG/lore digestion
- Sheila OWNS: lesson structure, learning objectives, PLSAT question authoring, pedagogical sequencing
- Handoff direction: Scholar → Sheila (research brief → lesson). Sheila may request follow-up research; Scholar replies with a citation pack, not a finished lesson.
- Shared notebooks: yes (read-write) — research patterns + content-gap signals compound across both agents

## Methodology
1. Scope the question — restate what's being researched and why (single sentence)
2. Survey existing material — read .paradigm/lore, CHANGELOG, relevant docs/guides, related packs
3. Cross-reference reality — confirm claims against current code via read-only inspection
4. Cite everything — every assertion gets a path:line or URL
5. Hand off — produce a research brief with: topic, summary, key facts (cited), open questions, suggested learning angles for Sheila

## What You Produce
- Research briefs (markdown, in .paradigm/research/ or inline handoff)
- Curated University content (packages/university/** content files — prose only)
- docs/guides/** updates (prose accuracy, not structure overhauls)
- README content suggestions (handed to Documentor for any structural change)
- Citation packs for Sheila

## Forbidden Actions
- Writing source code (.ts, .js, .swift, .rs, .py)
- Editing .purpose files or portal.yaml (Documentor's domain)
- Authoring PLSAT questions or lesson structures (Sheila's domain)
- Making claims without a path:line or URL citation
- Updating CHANGELOG entries (release process owns that)
- Refactoring docs structure unilaterally — propose to Documentor`,

  swift: `You are SWIFT, the SWIFT-LANGUAGE ECOSYSTEM agent.

## Your Role
You bring deep Swift/SwiftUI/Apple-platform expertise to any project that contains Swift code. You operate as an ecosystem specialist alongside macro-role agents (architect, builder, reviewer) — they own role; you own language idiom and platform reality.
You auto-roster when paradigm shift detects *.swift files or a Package.swift / *.xcodeproj.

## Ecosystem Expertise
What you know that a generic Builder doesn't:
- Swift 6 strict concurrency: actor isolation, @MainActor placement on protocols, Sendable, region-based isolation
- SwiftUI lifecycle: @Observable vs ObservableObject, @State/@Binding/@Environment scoping, view-identity bugs
- Apple platform APIs: AppKit/UIKit interop, AX (Accessibility), AVFoundation, Vision, Metal
- Swift Package Manager: target graphs, conditional dependencies, resource bundling, plugin targets
- Build/codesign reality: entitlements, sandbox rules, notarization, .app bundle layout
- Native concurrency idioms: structured concurrency, AsyncSequence, TaskGroup, cancellation propagation
- Conductor codebase patterns specifically — packages/conductor/ is the canonical Swift surface in this monorepo

## Notebook Compounding (cross-project)
Your notebook accumulates patterns that recur across every Swift project you visit:
- Concurrency pitfalls observed and their fixes (actor reentrancy, MainActor escape hatches)
- SwiftUI re-render traps (identity instability, @Observable migration gotchas)
- SPM target-graph patterns that work / fail
- Apple SDK quirks per OS version
- Test patterns: XCTest vs swift-testing migration notes
Notebooks live globally (~/.paradigm/notebooks/swift/) and compound per-ecosystem, not per-project.

## Methodology
1. Detect Swift surface — confirm files, target type (app/library/CLI/plugin), platform, Swift version
2. Apply ecosystem lens — review the architect's plan or builder's draft for language-idiom violations
3. Annotate with Swift-specific guidance — concurrency, lifecycle, platform-API choice
4. Hand back to macro role — Swift advises; Builder writes the code unless explicitly assigned

## What You Produce
- Swift-idiom annotations on specs and PRs
- Concurrency-correctness review notes
- SPM/Xcode build configuration guidance
- Platform-API recommendations with version constraints
- Code (when explicitly assigned as builder for a Swift task)

## Forbidden Actions
- Editing non-Swift source (TypeScript, Python, Rust) — hand to the appropriate ecosystem or builder
- Making cross-package architectural decisions without Architect involvement
- Editing .purpose / portal.yaml (Documentor)
- Suggesting Objective-C bridges when a pure-Swift path exists, unless platform requires it
- Approving code that compiles under Swift 5 mode if project is Swift 6 strict-concurrency
- Skipping the platform-version check before recommending an API`,

  compliance: `You are the COMPLIANCE agent (Rune).

## Your Role
You plan symbols before implementation and validate coverage after.
You are the Paradigm symbol system expert. You ensure every component has
aspects, every multi-step process has a flow, every event has a signal,
and every aspect has a valid anchor.

## When You Run
1. BEFORE the builder: create the symbol skeleton from the architect's plan
2. AFTER the builder: validate symbol coverage and produce a compliance report

## Key Responsibilities
1. Enumerate all symbols needed for the planned work
2. Create symbol stubs via MCP tools (purpose_add_component, purpose_add_flow, etc.)
3. Enforce 1:1 minimum component-to-aspect ratio
4. Create $flows when logic spans 3+ components
5. Create !signals for events that trigger side effects
6. Validate aspect anchors after implementation
7. Produce a Symbol Plan (pre-build) and Compliance Report (post-build)

## What You Produce
- **Symbol Plan**: list of every #component, $flow, !signal, ~aspect to create
- **Compliance Report**: coverage ratios, anchor integrity, blocking findings

## What You ONLY Use
- paradigm_search, paradigm_ripple, paradigm_status
- paradigm_purpose_init / paradigm_purpose_add_component / paradigm_purpose_add_flow
- paradigm_purpose_add_signal / paradigm_purpose_add_aspect / paradigm_purpose_add_gate
- paradigm_purpose_validate / paradigm_purpose_link
- paradigm_aspect_check / paradigm_aspect_drift / paradigm_aspect_confirm
- paradigm_flow_check / paradigm_flows_affected
- paradigm_reindex

## What You NEVER Do
- Modify source code (.ts, .swift, .js, .py files)
- Write implementation code
- Skip the pre-build symbol plan
- Approve code with missing aspects (1:1 ratio is mandatory)

## Promotion Protocol

When enforcement is currently "none" AND the user's messages show readiness signals:
- They reference \`#component\`, \`$flow\`, \`^gate\`, \`!signal\`, or \`~aspect\` syntax
- They ask about authentication, authorization, or route protection
- They ask about dependencies between modules or packages
- The session has touched 3 or more source files
- They name a discrete feature ("the checkout feature", "the auth flow")

**Your Action:**
1. Check enforcement level via \`paradigm_enforcement_configure\` (action: "status")
2. If level is "none" AND readiness signals are present, present this invitation to the user:

---
Paradigm's symbol system (#components, $flows, ^gates, !signals, ~aspects) can help document and enforce architecture across sessions. Enforcement is currently **none** — all checks are off.

Would you like to enable symbol tracking?
- \`minimal\` — warn-only, no blocking. Good starting point.
- \`balanced\` — blocks on missing purpose files, warns on everything else.
- \`snooze\` — ask again in 7 days.
- \`never\` — don't ask again.

Tell me your choice and I'll call \`paradigm_compliance_promote\`.
---

3. Wait for the user's choice and call \`paradigm_compliance_promote\` with their response
4. If they choose "minimal" or "balanced", proceed with your normal symbol plan for the current task
5. If they choose "snooze" or "never", continue without further mention

**Self-regulate:** Fire this invitation at most ONCE per session. Do not re-ask if already presented this session.`,

  advocate: `You are the ADVOCATE agent (Jinx).

## Your Role
You are the devil's advocate — you stress-test assumptions, find edge cases,
and challenge happy-path thinking before implementation begins. Your job is
to break plans before code breaks in production.

## Key Responsibilities
1. Identify hidden assumptions in the task description
2. Surface edge cases and failure modes the team hasn't considered
3. Challenge "obvious" decisions — what if the opposite is true?
4. Flag scale, dependency, and integration risks
5. Run a mental pre-mortem: imagine the feature failed — what went wrong?

## What You Produce
- A concise list of risks, assumptions, and edge cases
- A verdict: GREENLIGHT (proceed) or ESCALATE (needs full orchestration)
- Specific questions the team should answer before building

## What You DON'T Do
- Write implementation code
- Block progress without justification — you challenge, not obstruct
- Repeat concerns already addressed in the task description
- Produce lengthy analysis — be sharp and concise`,

  cartographer: `You are ATLAS, the CARTOGRAPHER agent.

## Your Role
You maintain and audit the project's architectural layer map (.paradigm/arch.yaml).
You read the map, compute drift between declared architecture and live symbols, and
render diagrams. You are advisory-only — you never block progress, never write source
code, and never modify .purpose files or portal.yaml.

## Key Responsibilities
1. Load arch.yaml and summarize the tier structure for the team
2. Compute drift: unassigned components (in symbol index but not in any tier) and
   missing_purpose entries (in arch.yaml but not indexed)
3. Render Mermaid diagrams of the architecture on request
4. Surface architectural drift as advisory findings — not as blocking errors
5. Recommend how to resolve drift without implementing

## When You Run
- After the Builder stage, when arch.yaml exists in the project
- On demand when the user asks for an architecture overview or diagram

## What You Produce
- Tier summary: component counts per tier, tech stack per tier
- Drift report: unassigned symbols, stale map entries
- Mermaid diagram string ready for copy-paste
- Advisory recommendations for resolving drift (never blocking)

## What You NEVER Do
- Block a build or deployment because of architectural drift
- Write source code
- Modify .purpose files, portal.yaml, or arch.yaml directly
- Produce lengthy analysis — be sharp, summarize, and hand off`,
};

// ============================================================================
// Tool Definitions
// ============================================================================

export function getOrchestrationToolsList() {
  return [
    {
      name: 'paradigm_orchestrate_inline',
      description: `REQUIRED before implementing features. Start with mode="quick" for fast pre-check, or mode="plan" for full orchestration planning.

Plans and coordinates multi-agent task execution within the same session.
- mode: "quick" - Lightweight pre-implementation check (~3-4k tokens). Jinx (advocate) stress-tests assumptions, reviewer checks feasibility. Returns greenlight or escalates to full orchestration. Satisfies enforcement.
- mode: "plan" - See suggested agents, estimated tokens, and get orchestration plan
- mode: "execute" - Get full prompts and execution strategy for any IDE

After getting prompts, launch agents using the Task tool. Stages marked canRunParallel: true can be launched simultaneously in a single message.

**Orchestration modes:** Two execution models depending on environment:
- Faceted (default): Each agent launches as an isolated Task tool context — separate memory, separate prompt, true multi-agent. Requires Claude Code (Task tool support).
- Sequential (solo): Agents run in the same session context one after another. Same memory throughout. Works in Cursor and other IDEs without Task tool support.
The active mode is set via \`orchestration.default_mode\` in agents.yaml (defaults to "faceted").

When to use this tool:
- mode="quick": Before any implementation — fast sanity check that satisfies orchestration-required enforcement
- mode="plan": Task affects 3+ files, involves security, or mentions multiple symbols
- mode="execute": Ready to implement, need full agent prompts

Examples:
- "Fix the login bug" → quick (greenlight or escalate)
- "Add user authentication with JWT" → plan → architect + security + builder + tester
- "Should I use soft delete or hard delete?" → plan → architect only (analysis)
- "Refactor the payment module" → plan → architect + builder`,
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The task to orchestrate (e.g., "Build @payment-system with Stripe integration")',
          },
          mode: {
            type: 'string',
            enum: ['quick', 'plan', 'execute'],
            description: 'Mode: "quick" for lightweight pre-check (advocate + reviewer), "plan" returns suggested agents and plan, "execute" returns prompts ready for Task tool',
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
      aliases: ['plan', 'coordinate', 'team', 'multi-agent', 'orchestrate', 'agents', 'spawn agents'],
    },
    {
      name: 'paradigm_agent_prompt',
      description: 'Get the complete prompt for a specific agent to execute a task. Use this when you need to spawn an agent via the Task tool with full context.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            enum: ['advocate', 'architect', 'builder', 'cartographer', 'compliance', 'ftux', 'scholar', 'swift', 'tester', 'reviewer', 'security', 'documentor'],
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

  // Write orchestration marker for stop hook enforcement
  try {
    const markerPath = path.join(ctx.rootDir, '.paradigm', '.orchestrated');
    fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8');
  } catch { /* best-effort */ }

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

  // Process pending events and check for high-urgency nominations
  let activeNominations: Array<{ agent: string; urgency: string; brief: string }> = [];
  try {
    const { processPendingEvents, loadNominations } = await import('../utils/nomination-engine.js');
    processPendingEvents(ctx.rootDir);
    const nominations = loadNominations(ctx.rootDir, { pending_only: true, limit: 10 });
    activeNominations = nominations
      .filter(n => n.urgency === 'high' || n.urgency === 'critical')
      .map(n => ({ agent: n.agent, urgency: n.urgency, brief: n.brief }));
  } catch { /* non-fatal */ }

  // Classify the task for intelligent agent selection
  const classification = classifyTaskLocal(task);

  // ========================================================================
  // Quick-check mode: lightweight advocate + reviewer pre-check
  // ========================================================================
  if (mode === 'quick') {
    return handleQuickCheck(task, symbols, classification, activeNominations, manifest, ctx);
  }

  // Plan the agent sequence (pass classification for intelligent defaults)
  const plan = planAgentSequence(task, manifest.agents, agentOverride, classification, manifest.orchestration, ctx.rootDir);

  if (mode === 'plan') {
    // Get agent suggestions based on triggers
    const suggestedAgents = suggestAgentsForTask(task, manifest.agents);

    // Generate cost preview
    const costPreview = generateCostPreviewLocal(plan, classification);

    // Gather notebook entry counts per agent (non-fatal)
    let notebookKnowledge: Record<string, { totalEntries: number; relevantEntries: number }> | undefined;
    try {
      const { loadNotebookEntries } = await import('../utils/notebook-loader.js');
      const symbolConcepts = symbols.map(s => s.replace(/^[#$^!~@&%?]/, '').toLowerCase());
      const counts: Record<string, { totalEntries: number; relevantEntries: number }> = {};
      const seenAgents = new Set<string>();
      for (const stage of plan.stages) {
        for (const agentStep of stage.agents) {
          if (seenAgents.has(agentStep.name)) continue;
          seenAgents.add(agentStep.name);
          const allEntries = loadNotebookEntries(agentStep.name, ctx.rootDir);
          const relevantEntries = symbolConcepts.length > 0
            ? loadNotebookEntries(agentStep.name, ctx.rootDir, { concepts: symbolConcepts })
            : allEntries;
          if (allEntries.length > 0) {
            counts[agentStep.name] = {
              totalEntries: allEntries.length,
              relevantEntries: relevantEntries.length,
            };
          }
        }
      }
      if (Object.keys(counts).length > 0) {
        notebookKnowledge = counts;
      }
    } catch { /* non-fatal */ }

    // Build collaboration graph from handoff_to edges among planned agents
    const planAgentNames = plan.stages.flatMap(s => s.agents.map(a => a.name));
    const collaborationEdges = buildCollaborationSubgraph(planAgentNames, manifest.agents);
    const collaborationGraph = collaborationEdges.length > 0 ? {
      edges: collaborationEdges,
      note: 'Shows which agents hand off to which based on agents.yaml handoff_to. Stage ordering was derived from this graph.',
    } : undefined;

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
      ...(collaborationGraph ? { collaborationGraph } : {}),
      ...(notebookKnowledge ? {
        notebookKnowledge,
        notebookNote: 'Agents with relevant notebook entries will have curated knowledge injected into their prompts during execute mode.',
      } : {}),
      ...(activeNominations.length > 0 ? {
        activeNominations,
        nominationNote: `${activeNominations.length} high-urgency agent nomination(s) pending. These agents have been flagged by the system for attention on this project.`,
      } : {}),
      instructions: [
        'Review task classification and cost preview above',
        'Review suggested agents based on task triggers',
        ...(collaborationGraph ? ['Review collaboration graph — stage ordering was derived from agent handoff_to edges'] : []),
        ...(notebookKnowledge ? ['Review notebook knowledge — agents with relevant entries will receive curated snippets in execute mode'] : []),
        ...(activeNominations.length > 0 ? ['Review active nominations — agents flagged by the system may need to be included'] : []),
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
  let agentProfiles: Map<string, { enrichment: string; nickname?: string; description?: string }> = new Map();
  try {
    const { loadAgentProfile, buildProfileEnrichment } = await import('../utils/agent-loader.js');
    const { loadDecisions } = await import('../utils/decision-loader.js');
    const { loadJournalEntries } = await import('../utils/journal-loader.js');
    const { loadNominations } = await import('../utils/nomination-engine.js');
    const { loadAgentState: loadState } = await import('../utils/agent-state.js');
    const { loadNotebookEntries } = await import('../utils/notebook-loader.js');

    // Load ambient context once (shared across all agents)
    const recentDecisions = loadDecisions(ctx.rootDir, { status: 'active', limit: 5 })
      .map(d => ({ title: d.title, decision: d.decision.slice(0, 150) }));
    const pendingNominations = loadNominations(ctx.rootDir, { pending_only: true, limit: 10 })
      .map(n => ({ urgency: n.urgency, brief: n.brief }));

    // Derive concept keywords from symbols for notebook filtering
    const symbolConcepts = symbols.map(s => s.replace(/^[#$^!~@&%?]/, '').toLowerCase());

    for (const stage of plan.stages) {
      for (const agentStep of stage.agents) {
        if (!agentProfiles.has(agentStep.name)) {
          const profile = loadAgentProfile(ctx.rootDir, agentStep.name);
          if (profile) {
            // Skip agents not on this project's roster
            if (!isAgentActive(agentStep.name, ctx.rootDir)) continue;

            // Load per-agent journal insights
            const journalInsights = loadJournalEntries(agentStep.name, {
              transferable: true,
              limit: 5,
            }).map(j => ({ trigger: j.trigger, insight: j.insight.slice(0, 150) }));

            // Load agent's project state for continuity
            const agentProjectState = loadState(agentStep.name, ctx.rootDir);

            // Load notebook entries filtered by task symbols, sorted by confidence then recency
            let notebookEntries: Array<{ context: string; snippet: string; concepts: string[] }> | undefined;
            try {
              const rawEntries = loadNotebookEntries(agentStep.name, ctx.rootDir,
                symbolConcepts.length > 0 ? { concepts: symbolConcepts } : undefined
              );
              if (rawEntries.length > 0) {
                // Sort by confidence (desc), then recency (desc), take top 5
                const sorted = rawEntries
                  .sort((a, b) => b.confidence - a.confidence || new Date(b.updated).getTime() - new Date(a.updated).getTime())
                  .slice(0, 5);
                notebookEntries = sorted.map(e => ({
                  context: e.context,
                  snippet: e.snippet,
                  concepts: e.concepts,
                }));

                // Record which notebook entries were injected (non-blocking, pure data collection)
                try {
                  const { recordNotebookReference } = await import('../utils/session-work-log.js');
                  recordNotebookReference(
                    ctx.rootDir,
                    agentStep.name,
                    sorted.map(e => e.id)
                  );
                } catch { /* non-fatal */ }

                // Increment appliedCount for each injected entry (drives popularity scoring)
                try {
                  const { incrementApplied } = await import('../utils/notebook-loader.js');
                  for (const e of sorted) {
                    incrementApplied(agentStep.name, e.id, ctx.rootDir);
                  }
                } catch { /* non-fatal */ }
              }
            } catch { /* notebook loading is non-fatal */ }

            let enrichment = buildProfileEnrichment(profile, symbols, notebookEntries, {
              recentDecisions,
              journalInsights,
              pendingNominations,
            }, agentProjectState ? {
              lastSession: agentProjectState.lastSession,
              pendingWork: agentProjectState.pendingWork,
              recentPatterns: agentProjectState.recentPatterns,
              sessionsOnProject: agentProjectState.sessionsOnProject,
            } : undefined);

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
            // Carry the rich persona description even when enrichment is empty —
            // it drives the role prompt for non-core archetypes (see buildAgentPromptInternal).
            agentProfiles.set(agentStep.name, {
              enrichment: enrichment.trim() ? enrichment : '',
              nickname: profile.nickname,
              description: profile.description,
            });
          }
        }
      }
    }
  } catch {
    // .agent profile loading is optional — falls back to agents.yaml behavior
  }

  // Run Cid's pre-task brief (non-fatal — agents proceed without it if brief fails)
  let captainBriefText: string | undefined;
  try {
    const briefResult = await handleCaptainTool('paradigm_captain_brief', {
      taskDescription: task,
      symbols,
      depth: 'standard',
    }, ctx);
    if (briefResult.handled) {
      const briefData = JSON.parse(briefResult.text);
      captainBriefText = briefData.renderedBrief;
    }
  } catch {
    // Captain brief failure is non-fatal — agents proceed without it
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
      const profileData = agentProfiles.get(agentStep.name);
      const agentDef: AgentDefinition = {
        name: manifestAgent?.name || agentStep.name,
        role: manifestAgent?.role || ROLE_PROMPTS[agentStep.name] || `${agentStep.name} agent`,
        description: profileData?.description,
        focus: manifestAgent?.focus || { reads: ['**/*'], writes: ['**/*'] },
        defaultModel: resolveModelForAgent(agentStep.name, ctx.rootDir, manifestAgent),
        triggers: manifestAgent?.triggers,
        handoff_to: manifestAgent?.handoff_to,
        context: manifestAgent?.context,
        protocol: manifestAgent?.protocol,
      };

      const promptResult = buildAgentPromptInternal({
        agent: agentDef,
        task: agentStep.task,
        symbols,
        dependsOn: agentStep.dependsOn,
        profileEnrichment: profileData?.enrichment,
        nickname: profileData?.nickname,
        captainBrief: captainBriefText,
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

  // Record agent state for each participating agent
  try {
    const { recordAgentSession } = await import('../utils/agent-state.js');
    const sessionTracker = await import('../utils/session-tracker.js');
    const sessionId = sessionTracker.default?.session?.sessionId || orchestrationId;

    for (const stage of stagePrompts) {
      for (const agent of stage.agents) {
        recordAgentSession(agent.agent, ctx.rootDir, {
          sessionId,
          summary: `${agent.attribution || agent.agent}: ${(agent.taskDescription || task).slice(0, 200)}`,
          symbolsTouched: symbols,
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
    ...(activeNominations.length > 0 ? { activeNominations } : {}),
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

    // Mandatory final steps: Cid debrief closes the session, Loid runs the learning pass
    finalStep: {
      mandatory: true,
      description: 'FINAL STEPS (mandatory, in order):',
      steps: [
        {
          order: 1,
          action: 'Call paradigm_captain_debrief',
          args: {
            orchestrationId: `${orchestrationId} (use the orchestrationId from this response)`,
            sessionSummary: '(summarize what was accomplished)',
            touchedFiles: '(list all files modified during this session)',
            newSymbols: '(optional: list any new symbols registered)',
          },
        },
        {
          order: 2,
          action: 'Take the sessionInsights from the debrief result and call paradigm_ambient_learn_postflight',
          args: {
            sessionId: `${orchestrationId} (use the orchestrationId from this response)`,
            context: '(pass the sessionInsights object from the debrief result here)',
          },
          note: "This is Loid's learning pass — she processes what the crew learned and ensures it compounds.",
        },
        {
          order: 3,
          action: 'Session is complete.',
        },
      ],
      note: 'Step 1 closes the session, updates .purpose coverage, records lore, and clears the stop hook. Step 2 runs Loid\'s learning pass on the session insights. Both steps are required — the session is NOT complete until both run.',
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
      orchestrationThread,
      instructions: [
        'After each agent completes, call paradigm_symphony_send to report progress. This makes the work visible in Conductor.',
        'Use intent "context" for analysis, "proposal" for recommendations, "decision" for decisions made',
        `Set threadRoot to "${orchestrationThread}" so all contributions are in one thread`,
        'Include the symbols array from the agent relay output',
      ],
      perAgentInstruction: `When each agent finishes, run: paradigm_symphony_send threadId="${orchestrationThread}" intent="task-complete" text="[agentName] Summary of completed work" symbols=[touched symbols]`,
      exampleCall: {
        intent: 'context',
        text: '[architect] Rate limiter should be placed before ^authenticated gate to prevent unauthenticated flood',
        threadRoot: orchestrationThread,
        symbols: ['#rate-limiter', '^authenticated'],
      },
    },
  };

  const text = JSON.stringify(result, null, 2);
  trackToolCall(text.length, 'paradigm_orchestrate_inline');
  return { handled: true, text };
}

// ============================================================================
// Quick-Check Handler
// ============================================================================

async function handleQuickCheck(
  task: string,
  symbols: string[],
  classification: TaskClassification,
  activeNominations: Array<{ agent: string; urgency: string; brief: string }>,
  manifest: AgentManifest,
  ctx: ProjectContext
): Promise<{ handled: boolean; text: string }> {
  const taskLower = task.toLowerCase();

  // Run Cid's quick brief (search + navigate only — lightweight)
  let quickBriefSummary: { coverage: string; warnings: string[] } | undefined;
  try {
    const briefResult = await handleCaptainTool('paradigm_captain_brief', {
      taskDescription: task,
      symbols,
      depth: 'quick',
    }, ctx);
    if (briefResult.handled) {
      const briefData = JSON.parse(briefResult.text);
      quickBriefSummary = {
        coverage: `${briefData.coverage?.label || 'unknown'} (${Math.round((briefData.coverage?.score || 0) * 100)}%)`,
        warnings: briefData.warnings || [],
      };
    }
  } catch {
    // Quick brief failure is non-fatal
  }

  // Determine if this should auto-escalate to full orchestration
  const escalationSignals: string[] = [];

  // Security-adjacent tasks always escalate
  if (classification.securityRequired) {
    escalationSignals.push('security-adjacent task (auth, gates, permissions detected)');
  }

  // High complexity escalates
  if (classification.complexity === 'high') {
    escalationSignals.push(`high complexity task (type: ${classification.type})`);
  }

  // Many symbols in scope escalates
  if (symbols.length >= 4) {
    escalationSignals.push(`${symbols.length} symbols in scope — cross-cutting change`);
  }

  // Critical nominations escalate
  const criticalNominations = activeNominations.filter(n => n.urgency === 'critical');
  if (criticalNominations.length > 0) {
    escalationSignals.push(`${criticalNominations.length} critical agent nomination(s) pending`);
  }

  // Build advocate (Jinx) quick analysis
  const advocateAnalysis: {
    assumptions: string[];
    risks: string[];
    edgeCases: string[];
    questions: string[];
  } = { assumptions: [], risks: [], edgeCases: [], questions: [] };

  // Assumption detection
  if (taskLower.includes('simple') || taskLower.includes('just') || taskLower.includes('only')) {
    advocateAnalysis.assumptions.push('Task framed as simple — verify no hidden complexity');
  }
  if (taskLower.includes('always') || taskLower.includes('never')) {
    advocateAnalysis.assumptions.push('Absolute language detected — edge cases likely exist');
  }
  if (!taskLower.includes('error') && !taskLower.includes('fail') && !taskLower.includes('invalid')) {
    advocateAnalysis.assumptions.push('No error/failure handling mentioned — what happens when it fails?');
  }

  // Risk detection
  if (symbols.some(s => s.startsWith('$'))) {
    advocateAnalysis.risks.push('Flow symbols detected — multi-step changes have ordering/rollback risk');
  }
  if (symbols.some(s => s.startsWith('^'))) {
    advocateAnalysis.risks.push('Gate symbols detected — authorization changes require security review');
    if (!escalationSignals.some(s => s.includes('security'))) {
      escalationSignals.push('gate symbols in scope — security review recommended');
    }
  }
  if (classification.matchedKeywords.some(k => ['migration', 'database', 'schema'].includes(k))) {
    advocateAnalysis.risks.push('Data migration risk — irreversible changes need rollback plan');
  }
  if (classification.matchedKeywords.some(k => ['delete', 'remove', 'drop'].includes(k))) {
    advocateAnalysis.risks.push('Destructive operation — verify nothing depends on removed items');
  }

  // Edge cases from task patterns
  if (taskLower.includes('add') || taskLower.includes('new')) {
    advocateAnalysis.edgeCases.push('New feature — how does it interact with existing features?');
  }
  if (taskLower.includes('refactor') || taskLower.includes('rename')) {
    advocateAnalysis.edgeCases.push('Refactor — all callers updated? Integration tests cover the change?');
  }
  if (taskLower.includes('fix') || taskLower.includes('bug')) {
    advocateAnalysis.edgeCases.push('Bug fix — does the fix address the root cause or just the symptom?');
  }

  // Questions based on what's missing
  if (!taskLower.includes('test')) {
    advocateAnalysis.questions.push('How will this be tested?');
  }
  if (symbols.length === 0) {
    advocateAnalysis.questions.push('No symbols referenced — which components are actually affected?');
  }

  // Reviewer quick feasibility check
  const reviewerCheck: {
    concerns: string[];
    suggestions: string[];
  } = { concerns: [], suggestions: [] };

  // Check if symbols exist in the manifest
  for (const sym of symbols) {
    const cleanSym = sym.replace(/^[#$^!~@&%?]/, '');
    if (!manifest.agents[cleanSym] && sym.startsWith('#')) {
      // This is a component symbol, not an agent — that's fine
    }
  }

  // Check classification for reviewer concerns
  if (classification.costMultiplier.max > 1.0) {
    reviewerCheck.concerns.push(`Higher-than-average complexity (${classification.costMultiplier.min}x-${classification.costMultiplier.max}x baseline) — consider breaking into smaller tasks`);
  }

  // Load notebook insights for advocate if available
  let advocateInsights: string[] = [];
  try {
    const { loadNotebookEntries } = await import('../utils/notebook-loader.js');
    const symbolConcepts = symbols.map(s => s.replace(/^[#$^!~@&%?]/, '').toLowerCase());
    const entries = loadNotebookEntries('advocate', ctx.rootDir,
      symbolConcepts.length > 0 ? { concepts: symbolConcepts } : undefined
    );
    if (entries.length > 0) {
      advocateInsights = entries
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3)
        .map(e => e.snippet);
    }
  } catch { /* non-fatal */ }

  // Determine verdict
  const shouldEscalate = escalationSignals.length >= 2 ||
    escalationSignals.some(s => s.includes('security') || s.includes('critical'));
  const verdict = shouldEscalate ? 'escalate' : 'greenlight';

  const result = {
    mode: 'quick',
    task,
    verdict,
    classification: {
      type: classification.type,
      complexity: classification.complexity,
      securityRequired: classification.securityRequired,
    },
    advocate: {
      agent: 'Jinx (advocate)',
      ...(advocateAnalysis.assumptions.length > 0 ? { assumptions: advocateAnalysis.assumptions } : {}),
      ...(advocateAnalysis.risks.length > 0 ? { risks: advocateAnalysis.risks } : {}),
      ...(advocateAnalysis.edgeCases.length > 0 ? { edgeCases: advocateAnalysis.edgeCases } : {}),
      ...(advocateAnalysis.questions.length > 0 ? { questions: advocateAnalysis.questions } : {}),
      ...(advocateInsights.length > 0 ? { notebookInsights: advocateInsights } : {}),
    },
    reviewer: {
      agent: 'reviewer',
      ...(reviewerCheck.concerns.length > 0 ? { concerns: reviewerCheck.concerns } : {}),
      ...(reviewerCheck.suggestions.length > 0 ? { suggestions: reviewerCheck.suggestions } : {}),
    },
    ...(escalationSignals.length > 0 ? { escalationSignals } : {}),
    ...(activeNominations.length > 0 ? { activeNominations } : {}),
    ...(quickBriefSummary ? { captainBrief: quickBriefSummary } : {}),
    symbols,
    instructions: verdict === 'greenlight'
      ? [
        'Quick check passed — proceed with implementation.',
        'Orchestration enforcement is satisfied.',
        advocateAnalysis.questions.length > 0
          ? `Address Jinx's questions during implementation: ${advocateAnalysis.questions.join('; ')}`
          : 'No open questions from advocate.',
      ]
      : [
        'Quick check recommends full orchestration.',
        `Escalation reasons: ${escalationSignals.join('; ')}`,
        'Call paradigm_orchestrate_inline mode="plan" for full agent planning.',
        'Orchestration enforcement is satisfied regardless of verdict.',
      ],
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
    defaultModel: resolveModelForAgent(agentName, ctx.rootDir, manifestAgent),
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
    const { loadNotebookEntries } = await import('../utils/notebook-loader.js');

    const profile = loadAgentProfile(ctx.rootDir, agentName);
    if (profile) {
      nickname = profile.nickname;
      // The rich persona drives the role prompt for non-core archetypes (see buildAgentPromptInternal)
      agentDef.description = profile.description;

      // Load ambient context
      const recentDecisions = loadDecisions(ctx.rootDir, { status: 'active', limit: 5 })
        .map(d => ({ title: d.title, decision: d.decision.slice(0, 150) }));
      const journalInsights = loadJournalEntries(agentName, { transferable: true, limit: 5 })
        .map(j => ({ trigger: j.trigger, insight: j.insight.slice(0, 150) }));
      const pendingNominations = loadNominations(ctx.rootDir, { pending_only: true, limit: 10 })
        .map(n => ({ urgency: n.urgency, brief: n.brief }));

      // Load notebook entries filtered by task symbols, sorted by confidence then recency
      let notebookEntries: Array<{ context: string; snippet: string; concepts: string[] }> | undefined;
      try {
        const symbolConcepts = symbols.map(s => s.replace(/^[#$^!~@&%?]/, '').toLowerCase());
        const rawEntries = loadNotebookEntries(agentName, ctx.rootDir,
          symbolConcepts.length > 0 ? { concepts: symbolConcepts } : undefined
        );
        if (rawEntries.length > 0) {
          const sorted = rawEntries
            .sort((a, b) => b.confidence - a.confidence || new Date(b.updated).getTime() - new Date(a.updated).getTime())
            .slice(0, 5);
          notebookEntries = sorted.map(e => ({
            context: e.context,
            snippet: e.snippet,
            concepts: e.concepts,
          }));

          // Record which notebook entries were injected (non-blocking, pure data collection)
          try {
            const { recordNotebookReference } = await import('../utils/session-work-log.js');
            recordNotebookReference(ctx.rootDir, agentName, sorted.map(e => e.id));
          } catch { /* non-fatal */ }
        }
      } catch { /* notebook loading is non-fatal */ }

      let enrichment = buildProfileEnrichment(profile, symbols, notebookEntries, {
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
// Collaboration Graph Utilities
// ============================================================================

/**
 * Build a collaboration graph from selected agents' handoff_to edges.
 * Returns edges that exist between selected agents only (subgraph).
 */
function buildCollaborationSubgraph(
  selectedAgents: string[],
  agents: Record<string, AgentDefinition>
): { from: string; to: string }[] {
  const selectedSet = new Set(selectedAgents);
  const edges: { from: string; to: string }[] = [];

  for (const name of selectedAgents) {
    const agent = agents[name];
    if (!agent?.handoff_to) continue;
    for (const target of agent.handoff_to) {
      if (selectedSet.has(target)) {
        edges.push({ from: name, to: target });
      }
    }
  }

  return edges;
}

/**
 * Derive stage ordering from the handoff_to directed graph using topological sort.
 *
 * - Agents with no incoming edges from other selected agents -> stage 0 (entry points)
 * - Agents whose dependencies are all in earlier stages -> next stage
 * - Mutual handoffs (A->B and B->A) -> same stage (parallel)
 * - Falls back to null if no handoff_to edges exist among selected agents
 */
function deriveStagesFromHandoffGraph(
  selectedAgents: string[],
  agents: Record<string, AgentDefinition>
): Map<string, number> | null {
  const edges = buildCollaborationSubgraph(selectedAgents, agents);

  // If no handoff edges exist among selected agents, signal fallback
  if (edges.length === 0) return null;

  // Detect mutual edges and collapse them into the same equivalence class
  const mutualPairs = new Set<string>();
  const edgeSet = new Set(edges.map(e => `${e.from}->${e.to}`));
  for (const edge of edges) {
    if (edgeSet.has(`${edge.to}->${edge.from}`)) {
      const pair = [edge.from, edge.to].sort().join(',');
      mutualPairs.add(pair);
    }
  }

  // Build equivalence classes for mutual handoffs (agents that should be parallel)
  const equivalenceMap = new Map<string, string>(); // agent -> canonical representative
  for (const pair of mutualPairs) {
    const [a, b] = pair.split(',');
    const canonA = equivalenceMap.get(a) || a;
    const canonB = equivalenceMap.get(b) || b;
    const canonical = canonA < canonB ? canonA : canonB;
    // Remap everything pointing to canonB to canonical
    for (const [key, val] of equivalenceMap) {
      if (val === canonA || val === canonB) equivalenceMap.set(key, canonical);
    }
    equivalenceMap.set(a, canonical);
    equivalenceMap.set(b, canonical);
  }
  // Agents not in any mutual pair map to themselves
  for (const name of selectedAgents) {
    if (!equivalenceMap.has(name)) equivalenceMap.set(name, name);
  }

  // Build DAG on equivalence classes (skip mutual edges)
  const canonicals = [...new Set(equivalenceMap.values())];
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, Set<string>>();
  for (const c of canonicals) {
    incomingCount.set(c, 0);
    outgoing.set(c, new Set());
  }

  for (const edge of edges) {
    const fromCanon = equivalenceMap.get(edge.from)!;
    const toCanon = equivalenceMap.get(edge.to)!;
    // Skip self-edges (mutual pairs collapsed into same canonical)
    if (fromCanon === toCanon) continue;
    if (!outgoing.get(fromCanon)!.has(toCanon)) {
      outgoing.get(fromCanon)!.add(toCanon);
      incomingCount.set(toCanon, (incomingCount.get(toCanon) || 0) + 1);
    }
  }

  // Kahn's algorithm for topological sort with stage levels
  const stageMap = new Map<string, number>(); // canonical -> stage
  const queue: string[] = [];

  for (const c of canonicals) {
    if ((incomingCount.get(c) || 0) === 0) {
      queue.push(c);
      stageMap.set(c, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentStage = stageMap.get(current) || 0;

    for (const neighbor of outgoing.get(current) || []) {
      const newCount = (incomingCount.get(neighbor) || 1) - 1;
      incomingCount.set(neighbor, newCount);
      // Stage is max of all incoming stages + 1
      const candidateStage = currentStage + 1;
      stageMap.set(neighbor, Math.max(stageMap.get(neighbor) || 0, candidateStage));
      if (newCount === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If cycle detected (some nodes never reached), fall back
  if (stageMap.size < canonicals.length) return null;

  // Map back from canonical stages to individual agent stages
  const result = new Map<string, number>();
  for (const name of selectedAgents) {
    const canonical = equivalenceMap.get(name)!;
    result.set(name, stageMap.get(canonical) || 0);
  }

  return result;
}

// ============================================================================
// Planning Logic
// ============================================================================

function planAgentSequence(
  task: string,
  agents: Record<string, AgentDefinition>,
  agentOverride?: string[],
  classification?: TaskClassification,
  orchestrationConfig?: AgentManifest['orchestration'],
  rootDir?: string,
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

  // Derive stage ordering from handoff_to graph when available
  const selectedNames = plannedAgents.map(a => a.name);
  const graphStages = deriveStagesFromHandoffGraph(selectedNames, agents);
  if (graphStages) {
    // Reassign stages and dependsOn based on the handoff graph
    for (const agent of plannedAgents) {
      agent.stage = graphStages.get(agent.name) || 0;
      // Rebuild dependsOn: agents that hand off TO this agent and are in earlier stages
      const incomingFrom: string[] = [];
      for (const otherName of selectedNames) {
        if (otherName === agent.name) continue;
        const otherDef = agents[otherName];
        if (otherDef?.handoff_to?.includes(agent.name)) {
          const otherStage = graphStages.get(otherName) || 0;
          if (otherStage < agent.stage) {
            incomingFrom.push(otherName);
          }
        }
      }
      if (incomingFrom.length > 0) {
        agent.dependsOn = incomingFrom;
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

  // Add documentor as the final stage unless the task is analysis-only or
  // there are no builder/tester agents (no code changes expected)
  const hasCodeAgents = plannedAgents.some(a => a.name === 'builder' || a.name === 'tester');
  const isAnalysis = classification?.type === 'analysis';
  const skipDocumentor = isAnalysis || !hasCodeAgents;

  let documentorAdded = false;
  if (!skipDocumentor) {
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
    documentorAdded = true;
  }

  // Estimate tokens
  let minTokens = 0;
  let maxTokens = 0;
  for (const agent of plannedAgents) {
    const estimate = AGENT_TOKEN_ESTIMATES[agent.name] || { min: 5000, max: 20000 };
    minTokens += estimate.min;
    maxTokens += estimate.max;
  }
  // Add documentor estimate if included
  if (documentorAdded) {
    minTokens += 2000;
    maxTokens += 8000;
  }

  // Read orchestration mode from agents.yaml config, fall back to 'faceted'
  const configMode = orchestrationConfig?.default_mode || 'faceted';

  return {
    task,
    mode: configMode,
    stages,
    symbols,
    estimatedAgents: plannedAgents.length + (documentorAdded ? 1 : 0),
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
  /** Rendered Context Brief from Cid (captain), injected after profileEnrichment */
  captainBrief?: string;
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

  // Captain's Context Brief (injected into every agent)
  if (options.captainBrief) {
    parts.push(options.captainBrief);
    parts.push('');
  }

  // Role prompt. Precedence:
  // 1. Battle-tested hardcoded constant (ROLE_PROMPTS[name]) — wins for the core 5 + pm
  // 2. Rich multi-paragraph persona from the .agent profile (agent.description) — drives the ~62 others
  // 3. One-line role summary from agents.yaml (agent.role) — fallback
  // 4. Generic builder prompt — last resort
  const rolePrompt = ROLE_PROMPTS[agent.name] || agent.description || agent.role || ROLE_PROMPTS.builder;
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
  const model = agent.defaultModel || DEFAULT_TIER_MODELS[AGENT_TIERS[agent.name] || 'tier-2'] || 'sonnet';

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
      const model = DEFAULT_TIER_MODELS[AGENT_TIERS[agentStep.name] || 'tier-2'] || 'sonnet';
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
    const model = DEFAULT_TIER_MODELS[AGENT_TIERS[agent] || 'tier-2'] || 'sonnet';
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

  // Collaboration boost: if agent A is suggested and A's handoff_to includes agent B,
  // add B as a collaboration suggestion if it has any relevant triggers
  const suggestedNames = new Set(suggestions.map(s => s.name));
  const collaborationSuggestions: AgentSuggestion[] = [];

  for (const suggestion of suggestions) {
    const agent = agents[suggestion.name];
    if (!agent?.handoff_to) continue;

    for (const targetName of agent.handoff_to) {
      if (suggestedNames.has(targetName) || !agents[targetName]) continue;

      // Check if the target agent has any relevant triggers for this task
      const targetAgent = agents[targetName];
      const targetMatches: string[] = [];
      for (const trigger of targetAgent.triggers || []) {
        if (trigger.type === 'keyword' && trigger.match) {
          for (const keyword of trigger.match) {
            if (taskLower.includes(keyword.toLowerCase())) {
              targetMatches.push(`keyword:${keyword}`);
            }
          }
        }
        if (trigger.type === 'symbol' && trigger.match) {
          for (const pattern of trigger.match) {
            const matchingSymbols = symbols.filter((s) => {
              if (pattern.endsWith('*')) return s.startsWith(pattern.slice(0, -1));
              return s === pattern;
            });
            for (const s of matchingSymbols) {
              targetMatches.push(`symbol:${s}`);
            }
          }
        }
      }

      // Add as collaboration suggestion with boosted confidence
      if (targetMatches.length > 0) {
        suggestedNames.add(targetName);
        const roleFirstLine = targetAgent.role.split('\n')[0].trim();
        const roleSnippet = roleFirstLine.length > 50 ? roleFirstLine.slice(0, 47) + '...' : roleFirstLine;

        collaborationSuggestions.push({
          name: targetName,
          reason: roleSnippet,
          confidence: targetMatches.length >= 2 ? 'high' : 'medium',
          triggers_matched: [...targetMatches, `collaboration:handoff_from:${suggestion.name}`],
        });
      }
    }
  }

  // Merge collaboration suggestions
  suggestions.push(...collaborationSuggestions);

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
