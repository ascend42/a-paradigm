# Cid — The Captain Agent

> **Symbol:** `#cid` | **Status:** Approved — Implementation pending
> **Decision origin:** Paradigm Framework Audit (2026-04-02)
> **Architecture decision:** ADR-CID-001

---

## The Problem Being Solved

Paradigm's symbol system, `.purpose` files, and portal.yaml only provide value if agents actually navigate through them before working. Currently, that navigation is optional behavior in CLAUDE.md instructions. Agents may or may not call `paradigm_ripple` before touching a symbol. The context load is inconsistent. The `.purpose` ecosystem is maintained because the framework says to, not because agents see it paying off in real time.

The result: the system is underutilized, and maintenance has no visible feedback loop.

---

## What Cid Is

Cid is the **Captain agent** — the only Paradigm agent who runs **before and after** all other agents. He does not write code, review code, or design systems. He does two things:

1. **Pre-task: Charts the territory.** Before any agent touches anything, Cid searches the symbol graph, maps the blast radius, checks gates, finds protocols, surfaces warnings, and produces a **Context Brief** that every subsequent agent receives.

2. **Post-task: Updates the charts.** After all agents complete their work, Cid audits coverage, creates `.purpose` stubs for newly touched areas, delegates rich documentation to the Documentor, and writes the session debrief.

Cid is the reason the system is both **utilized** (pre-task: agents work from a map, not from scratch) and **maintained** (post-task: the map is updated before the session ends).

---

## Cid's Special Status

Cid is a **protected agent** — the only one in the roster that cannot be benched through the standard `paradigm agent bench` command. Benching Cid requires an explicit engine-level opt-out flag (`PARADIGM_SKIP_CAPTAIN=1`). This is intentional: Cid's value is only realized if he always runs.

All other agents are crew. Cid is the captain.

---

## The Orchestration Flow

```
Cid (pre-task: Context Brief)
         ↓
[Context Brief injected into every agent below]
         ↓
Advocate (Jinx) ← stress-tests assumptions
Architect (Apex) ← designs the solution
Builder ← implements
Reviewer ← checks code quality
Security ← validates auth and safety
Documentor (Scribe) ← updates .purpose and portal.yaml
         ↓
Cid (post-task: Debrief + coverage audit)
```

In **quick mode**: Cid brief → Advocate → Reviewer → Greenlight or escalate.

In **plan mode**: Cid brief → Orchestration planner (Cid's brief informs which agents are needed).

In **execute mode**: Cid brief → All planned agents → Cid debrief.

---

## The Context Brief

The Context Brief is a structured block, 200–400 tokens, prepended to every agent's prompt. It gives every agent the same map before they act.

### Schema

```typescript
interface ContextBrief {
  // What territory are we operating in
  territory: {
    directories: string[];        // Directories in scope
    files: string[];              // Key files identified
    estimatedScope: 'tiny' | 'small' | 'medium' | 'large';
  };

  // Relevant symbols found
  symbols: Array<{
    id: string;                   // e.g. "#session-manager"
    type: 'component' | 'flow' | 'gate' | 'signal' | 'aspect';
    description: string;
    file?: string;
  }>;

  // Blast radius from ripple analysis
  blastRadius: {
    affectedFiles: string[];
    affectedSymbols: string[];
    affectedFlows: string[];
    affectedGates: string[];
    fragileSymbols: string[];     // High-fragility symbols in the blast radius
  };

  // Auth requirements for any routes in scope
  gates: Array<{
    route: string;
    gate: string;
    declared: boolean;            // Is it in portal.yaml?
  }>;

  // Matched stored procedure, if any
  protocol: {
    matched: boolean;
    id?: string;
    name?: string;
    steps?: string[];
  };

  // Antipatterns and warnings for this area
  warnings: string[];

  // How reliable is this brief?
  coverage: {
    score: number;                // 0.0 - 1.0
    label: 'sparse' | 'partial' | 'reliable' | 'comprehensive';
    note: string;                 // Human-readable explanation
  };

  // Relevant past sessions
  loreRefs: Array<{
    id: string;
    summary: string;
    relevance: string;
  }>;
}
```

### Rendered format (injected into agent prompts)

```
━━━ CONTEXT BRIEF (Cid) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Territory:     packages/auth/, packages/session/
Symbols:       #session-manager, #auth-middleware, ^authenticated
Blast Radius:  6 files · 2 flows · 1 gate · ⚠ #token-store (fragile)
Gates:         POST /api/session → ^authenticated (declared ✓)
Protocol:      add-protected-route (matched — 4 steps)
Warnings:      "Session tokens must not be stored in localStorage — ADR-003"
Coverage:      78% — brief is reliable

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## MCP Tools

### `paradigm_captain_brief`

Runs Cid's pre-task context discovery pipeline. Called automatically by the orchestration engine before agent prompts are assembled. Can also be called manually by any agent or developer.

**Input:**
```typescript
{
  taskDescription: string;    // The task to brief for
  symbols?: string[];         // Optional: pre-known symbols to anchor the search
  depth?: 'quick' | 'standard' | 'deep';  // Default: standard
}
```

**Pipeline (in order):**
1. Extract keyword clusters from `taskDescription`
2. `paradigm_search` for each cluster (top 5 symbols per cluster)
3. `paradigm_navigate` with full task description
4. `paradigm_ripple` on top 3–5 returned symbols
5. `paradigm_gates_for_route` if any route patterns are detected
6. `paradigm_wisdom_context` on affected symbols
7. `paradigm_protocol_search` for the task description
8. `paradigm_lore_search` for recent sessions in affected areas
9. Compute coverage confidence score from `.purpose` density in affected directories
10. Assemble and return `ContextBrief`

**Output:** `ContextBrief` (see schema above)

**Side effects:**
- Writes `.paradigm/.cid-session` with brief metadata (used by stop hook)

---

### `paradigm_captain_debrief`

Runs Cid's post-task maintenance pass. Called automatically by the orchestration engine after all agents complete. Can also be called manually.

**Input:**
```typescript
{
  orchestrationId: string;    // The orchestration run ID
  sessionSummary: string;     // What was accomplished
  touchedFiles: string[];     // Files modified this session
  newSymbols?: string[];      // New symbols registered
  notes?: string;             // Optional additional notes from orchestrating session
}
```

**Pipeline (in order):**
1. For each touched directory: check `.purpose` file exists and has content
2. For any touched directory without adequate `.purpose`: create stub with context from brief
3. For any new routes detected: check `portal.yaml` coverage
4. For areas needing rich documentation: queue delegation to Documentor
5. Record session to lore (`paradigm_lore_record`)
6. Update coverage confidence scores in `.paradigm/config.yaml`
7. Write `.paradigm/.cid-briefed` marker (signals stop hook to skip full suite)
8. Return `DebriefReport`

**Output:**
```typescript
{
  coverageAdded: string[];        // Directories where stubs were created
  delegatedToDocumentor: string[]; // Areas queued for rich docs
  loreEntryId: string;            // Lore entry written
  coverageScore: {
    before: number;
    after: number;
    delta: number;
  };
  stopHookCleared: boolean;       // Whether .cid-briefed marker was written
}
```

---

## Orchestration Engine Changes

### Pre-stage injection (execute mode)

Before assembling any agent prompt in execute mode:

```typescript
// 1. Run Cid's brief
const brief = await runCaptainBrief(task, symbols, ctx);

// 2. Render brief as text block
const briefBlock = renderContextBrief(brief);

// 3. Inject into every agent's prompt via buildAgentPromptInternal
// Add 'captainBrief' field to PromptBuildOptions
// Rendered after profileEnrichment, before role prompt
```

### Post-stage instruction

After all stage prompts are assembled and returned, append to the execution instructions:

```
FINAL STEP (mandatory): After all agents complete, run:
paradigm_captain_debrief({
  orchestrationId: "<id>",
  sessionSummary: "<what was accomplished>",
  touchedFiles: ["<list of files modified>"]
})
This closes the session, updates coverage, and clears the stop hook.
```

### Quick mode

In quick mode, Cid's brief runs first (lightweight: search + navigate only, no deep ripple):
`Cid brief (quick) → Advocate (Jinx) → Reviewer → Greenlight/Escalate`

---

## Stop Hook Integration

The stop hook (`paradigm-common.sh`) checks for the `.cid-briefed` marker:

```sh
# Check if Cid completed a debrief this session
CID_SESSION=".paradigm/.cid-session"
CID_BRIEFED=".paradigm/.cid-briefed"

if [ -f "$CID_BRIEFED" ]; then
  # Cid ran debrief — only run the route-without-portal check
  run_check_route_portal_coverage
  exit $VIOLATION_COUNT
fi

# Cid was not invoked — run full 13-check compliance suite
run_full_compliance_suite
```

The marker is written by `paradigm_captain_debrief`. It contains:
```yaml
timestamp: "2026-04-02T23:45:00Z"
sessionId: "orch-1234abc"
touchedFiles: [...]
coverageScore: 0.82
```

The marker is cleared at session start (when `.paradigm/.cid-session` is created fresh) so it cannot carry over between sessions.

---

## Cid's Delegation to Documentor

When Cid's debrief detects areas needing rich documentation (not just stubs), he does not write it himself. He queues the work:

```typescript
// In paradigm_captain_debrief
if (areaRequiresRichDocs) {
  appendToPendingReview(ctx.rootDir, {
    path: directory,
    reason: 'captain-debrief',
    priority: 'high',
    context: briefSummaryForArea
  });
}
```

The Documentor's proactive coverage behavior picks this up from `.paradigm/.pending-review`. Cid creates stubs to pass enforcement. Documentor fills them with substance.

---

## Coverage Confidence Score

Cid computes a coverage score for the affected area as part of every brief:

```
score = (directories with non-empty .purpose) / (total affected directories)
```

Thresholds:
- `0.0 – 0.3` → `sparse` — "Brief may be significantly incomplete. Builder should explore directly."
- `0.3 – 0.6` → `partial` — "Brief covers key symbols. Some areas uncharted."
- `0.6 – 0.85` → `reliable` — "Brief is reliable for this task."
- `0.85 – 1.0` → `comprehensive` — "Area is fully mapped."

This score is recorded in lore per session and tracked in `.paradigm/config.yaml` under `coverage.scores`. Teams can watch their coverage score improve over time as the `.purpose` ecosystem matures.

---

## What This Solves From the Audit

| Audit Finding | How Cid Addresses It |
|---|---|
| E1 — Stop hook commit bypass | Cid debrief runs post-task regardless of commit state. Stop hook only checks the marker. |
| E2 — Binary blocking | Stop hook becomes a fallback; Cid owns enforcement for orchestrated sessions. |
| D4 — 6-8 tool calls overhead | Cid consolidates all pre-task discovery into one structured phase. |
| R3 — .purpose presence vs. adequacy | Cid checks content quality, not just presence. Creates stubs AND delegates for rich docs. |
| R2 — Self-referential credibility | Coverage score is an externally observable metric. Teams see it change. |
| The circular dependency | Coverage score makes the value of .purpose investment legible in real time. |

---

## Implementation Checklist

- [ ] Create `packages/paradigm-mcp/src/tools/captain.ts` with `paradigm_captain_brief` and `paradigm_captain_debrief`
- [ ] Define `ContextBrief` and `DebriefReport` types in `packages/paradigm-mcp/src/types/captain.ts`
- [ ] Register captain tools in `packages/paradigm-mcp/src/tools/index.ts` (core tier — always loaded)
- [ ] Add `captainBrief` field to `PromptBuildOptions` in `orchestration.ts`
- [ ] Call `paradigm_captain_brief` before assembling stage prompts in execute mode
- [ ] Inject rendered brief into `buildAgentPromptInternal` after `profileEnrichment`
- [ ] Append Cid debrief instruction to execution instructions in execute mode
- [ ] Add Cid pre-stage to quick mode
- [ ] Update `plugins/paradigm/scripts/paradigm-common.sh` with `.cid-briefed` check
- [ ] Update `plugins/paradigm-cursor/scripts/paradigm-common.sh` with same
- [ ] Run `generate-hooks.mjs` to regenerate `generated-hooks.ts`
- [ ] Create `cid.agent` file at `~/.paradigm/agents/cid.agent`
- [ ] Add `cid` to core agent roster in agents.yaml / config.yaml
- [ ] Write architecture decision (ADR-CID-001)
- [ ] Record lore entry for this session
- [ ] Build and link all packages
