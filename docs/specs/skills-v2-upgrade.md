# Skills v2 Upgrade — Design Spec

> **Branch:** `skills-v2-upgrade`
> **Date:** 2026-03-05
> **Status:** Design phase

---

## Current State

Paradigm has 10 plugin skills in `plugins/paradigm/skills/`:

| Skill | Purpose | Complexity |
|-------|---------|------------|
| `init` | Initialize Paradigm in a project | Medium — creates files, runs scans |
| `shift` | Full one-command setup | High — init + scan + hooks + CLAUDE.md + doctor |
| `preflight` | Pre-task compliance checks | High — 8 steps, multiple MCP calls, report generation |
| `postflight` | Post-task compliance checks | High — mirrors preflight |
| `lore` | Record session lore | Medium — git analysis + MCP call |
| `sentinel` | Incident triage | High — 7 steps, cross-referencing, live API calls |
| `observe` | View live logs/metrics/traces | Medium — curl calls to Sentinel API |
| `doctor` | Health check | Medium — multiple validation calls |
| `protocol` | Search/record protocols | Low — MCP call with formatting |
| `scan` | Rebuild symbol index | Low — single MCP call |

All currently use **basic frontmatter only** (`name` + `description`). None use:
- `context: fork`
- `agent` routing
- `allowed-tools`
- `!`command`` shell injection
- `$ARGUMENTS[N]` positional args
- `hooks` (skill-scoped)
- `model` override
- `disable-model-invocation`
- Supporting files (templates, scripts, checklists)

---

## What Skills v2 Enables

### 1. Forked Context (`context: fork`)

**What it does:** Runs the skill in an isolated subagent. The skill content becomes the prompt. No access to conversation history.

**Why it matters for Paradigm:** Heavy skills like `preflight`, `postflight`, `sentinel`, and `shift` consume significant main-context tokens with their multi-step workflows. Forking them means:
- Main conversation stays clean — user only sees the final report
- Skill can do 8+ MCP tool calls without cluttering history
- Failures in the skill don't pollute the main context
- Multiple skills could theoretically run in parallel

**Candidates:**
| Skill | Fork? | Rationale |
|-------|-------|-----------|
| `preflight` | Yes | 8 steps, generates a report — perfect for fork |
| `postflight` | Yes | Mirror of preflight |
| `sentinel` | Yes | 7 steps, heavy cross-referencing |
| `observe` | Yes | Read-only data fetching |
| `doctor` | Yes | Multiple validation checks, returns report |
| `lore` | No | Needs conversation context to know what happened |
| `init` | No | Interactive — needs user input for choices |
| `shift` | No | Interactive — multiple prompts, error recovery |
| `scan` | No | Single MCP call, trivial |
| `protocol` | No | Needs conversation context for what to search |

### 2. Agent Routing (`agent` field)

**What it does:** When `context: fork` is set, specifies which agent type executes the skill. Options: `Explore`, `Plan`, `general-purpose`, or any custom agent from `.claude/agents/`.

**Paradigm opportunity:** Define custom Paradigm agents that skills route to:

| Skill | Agent | Why |
|-------|-------|-----|
| `preflight` | `paradigm:architect` | Already exists — read-only analysis |
| `postflight` | `paradigm:reviewer` | Already exists — compliance checking |
| `sentinel` | `paradigm:reviewer` | Read-only incident analysis |
| `observe` | `Explore` | Built-in, read-only exploration |
| `doctor` | `paradigm:reviewer` | Validation and reporting |

This means the forked skill runs with the right agent persona — a reviewer doing postflight makes natural sense.

### 3. Shell Injection (`!`command``)

**What it does:** Runs shell commands *before* the skill content is sent to Claude. Output replaces the placeholder.

**This is transformative for Paradigm.** Currently, every skill's first steps are "call paradigm_status", "run git diff", etc. With shell injection, that data is pre-loaded:

```yaml
---
name: preflight
context: fork
agent: paradigm:architect
---

## Current Project State
!`npx paradigm-mcp status 2>/dev/null || echo "MCP not available"`

## Recent Git Changes
!`git diff --stat HEAD 2>/dev/null`

## Current Symbols
!`cat .paradigm/scan-index.json 2>/dev/null | head -100`

Now analyze this context and run the preflight checks...
```

**Benefits:**
- Saves 2-4 MCP tool calls per skill invocation (400-1200 tokens)
- Data is available immediately — no round-trip delays
- Skill starts with rich context instead of blank slate

**Candidates for injection:**

| Skill | What to inject |
|-------|---------------|
| `preflight` | git status, scan-index summary, portal.yaml existence check |
| `postflight` | git diff --stat, modified files list, .purpose file coverage |
| `lore` | git diff --stat, git log --oneline -10, recent commits |
| `sentinel` | curl to Sentinel stats endpoint (if running) |
| `observe` | curl to Sentinel logs endpoint (if running) |
| `doctor` | .paradigm/config.yaml, scan-index.json existence checks |
| `scan` | current scan-index.json age/size |

### 4. Tool Restrictions (`allowed-tools`)

**What it does:** Limits which tools the skill can use without asking permission.

**Paradigm application:**

| Skill | Allowed Tools | Rationale |
|-------|--------------|-----------|
| `preflight` | MCP tools, Read, Grep, Glob | Read-only analysis, no writes |
| `postflight` | MCP tools, Read, Grep, Glob | Read-only compliance check |
| `sentinel` | MCP tools, Read, Bash(curl *) | Read-only + Sentinel API calls |
| `observe` | MCP tools, Bash(curl *) | Only needs Sentinel API |
| `doctor` | MCP tools, Read, Glob | Validation only |
| `scan` | MCP tools | Single tool call |
| `lore` | MCP tools, Bash(git *) | Needs git info + lore record |
| `init` | MCP tools, Read, Write, Bash | Creates files |
| `shift` | MCP tools, Read, Write, Bash | Full setup |
| `protocol` | MCP tools, Read | Search + read |

This prevents accidental writes during read-only skills and makes the intent explicit.

### 5. Supporting Files

**What it does:** Skills can include templates, examples, scripts, and reference docs alongside SKILL.md.

**Paradigm opportunity:**

```
preflight/
├── SKILL.md              # Main instructions
├── report-template.md    # Template for the preflight report
└── checklist.md          # Standard compliance checklist

postflight/
├── SKILL.md
├── report-template.md
└── violation-guide.md    # How to fix common violations

lore/
├── SKILL.md
├── examples/
│   ├── good-entry.md     # Example of a well-written lore entry
│   └── bad-entry.md      # Example of what NOT to do
└── templates/
    ├── agent-session.md
    ├── decision.md
    └── incident.md

sentinel/
├── SKILL.md
├── triage-template.md    # Standard triage report format
└── resolution-guide.md   # Resolution strategy reference
```

**Benefits:**
- Report templates ensure consistent output format
- Examples improve entry quality (especially for lore)
- Reference docs loaded on-demand, not always in context
- Supporting files can be updated independently of SKILL.md

### 6. Positional Arguments (`$ARGUMENTS[N]`)

**What it does:** Access specific arguments by position.

**Paradigm applications:**

```yaml
# /paradigm:sentinel INC-042
# → $0 = "INC-042"
Investigate incident $0 using the triage protocol.

# /paradigm:protocol "add-api-endpoint"
# → $0 = "add-api-endpoint"
Search for protocol matching "$0".

# /paradigm:lore "feat: add payment flow"
# → $0 = "feat: add payment flow"
Use "$0" as the lore entry title.
```

### 7. Invocation Control

| Skill | `disable-model-invocation` | `user-invocable` | Rationale |
|-------|---------------------------|-------------------|-----------|
| `init` | `true` | `true` | User should explicitly choose to init |
| `shift` | `true` | `true` | Destructive-ish — creates files, installs hooks |
| `scan` | `true` | `true` | Explicit rebuild action |
| `preflight` | `false` | `true` | Claude should suggest before complex tasks |
| `postflight` | `false` | `true` | Claude should suggest after implementation |
| `lore` | `false` | `true` | Claude should suggest at session end |
| `sentinel` | `false` | `true` | Claude should suggest on errors |
| `observe` | `false` | `true` | Claude should suggest when monitoring |
| `doctor` | `false` | `true` | Claude should suggest when things seem wrong |
| `protocol` | `false` | `true` | Claude should suggest before common patterns |

### 8. Skill-Scoped Hooks

**What it does:** Hooks that only fire when a specific skill is active.

**Paradigm opportunity:**
- `preflight` hook: auto-checkpoint session as "planning" phase after completion
- `postflight` hook: auto-record lore if violations found
- `sentinel` hook: auto-log triage sessions for audit trail

---

## New Skills to Add

Skills v2 also enables skills that weren't practical before:

### `/paradigm:ripple <symbol>`
```yaml
---
name: ripple
description: Analyze impact of changing a symbol
context: fork
agent: paradigm:architect
allowed-tools: Read, Grep, Glob
---
Analyze the impact of changing $0...
```

### `/paradigm:review`
```yaml
---
name: review
description: Review recent changes for Paradigm compliance
context: fork
agent: paradigm:reviewer
allowed-tools: Read, Grep, Glob
---
!`git diff --stat HEAD~1`
!`git log --oneline -1`
Review these changes...
```

### `/paradigm:handoff`
```yaml
---
name: handoff
description: Prepare context handoff for next session
context: fork
agent: Explore
---
!`git diff --stat`
Prepare a handoff summary...
```

### `/paradigm:graph`
```yaml
---
name: graph
description: Generate and open the symbol graph visualization
disable-model-invocation: true
---
!`npx paradigm graph generate default`
Open the symbol graph...
```

---

## Migration Plan

### Phase 1: Frontmatter Enrichment (Low Risk)
Add v2 frontmatter fields to all existing skills without changing behavior:
- `allowed-tools` on all skills
- `disable-model-invocation` on init, shift, scan
- `$ARGUMENTS` usage where applicable

**Files changed:** 10 SKILL.md files (frontmatter only)
**Risk:** None — additive changes, backward compatible

### Phase 2: Shell Injection (Medium Risk)
Add `!`command`` preprocessing to skills that benefit:
- `lore`: inject git diff and recent commits
- `doctor`: inject config.yaml and scan-index checks
- `postflight`: inject git diff and modified files

**Files changed:** 3-5 SKILL.md files
**Risk:** Low — shell commands are read-only, fail gracefully

### Phase 3: Forked Context (Medium Risk)
Add `context: fork` + `agent` routing to heavy skills:
- `preflight` → fork with `paradigm:architect`
- `postflight` → fork with `paradigm:reviewer`
- `sentinel` → fork with `paradigm:reviewer`
- `doctor` → fork with `paradigm:reviewer`

**Files changed:** 4 SKILL.md files
**Risk:** Medium — forked context means no conversation history. Skills must be self-contained.
**Testing:** Run each forked skill in 3 different projects, compare output quality to non-forked version.

### Phase 4: Supporting Files
Add templates, examples, and reference docs:
- Report templates for preflight, postflight, sentinel
- Lore entry examples and templates
- Resolution guides for sentinel

**Files added:** ~15 supporting files
**Risk:** None — additive

### Phase 5: New Skills
Add new skills enabled by v2:
- `ripple`, `review`, `handoff`, `graph`

**Files added:** 4 new SKILL.md directories
**Risk:** Low — net new, no existing behavior changed

---

## Potential Gains

### Token Efficiency
| Optimization | Savings |
|-------------|---------|
| Shell injection replaces 2-4 MCP calls per skill | ~400-1200 tokens/invocation |
| Forked context keeps main conversation clean | ~2000-5000 tokens saved per heavy skill |
| Supporting files loaded on-demand | ~500-1000 tokens saved (not always in context) |
| **Total per heavy skill invocation** | **~3000-7000 tokens** |

### User Experience
- Forked skills return clean, structured reports
- Main conversation isn't cluttered with intermediate MCP calls
- Shell injection makes skills faster (no round-trip for basic data)
- Tool restrictions prevent accidental writes during analysis skills

### Developer Experience (Plugin Authors)
- Supporting files make skills maintainable and composable
- Templates ensure consistent output across invocations
- Invocation control prevents unintended triggers
- Skill-scoped hooks enable tight lifecycle integration

### Architectural Alignment
- Paradigm already has agent types (architect, builder, reviewer, tester, security)
- Skills v2 `agent` routing maps directly to these existing roles
- This is the natural convergence of Paradigm's agent model with Claude Code's skill system

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `context: fork` loses conversation context | Skills that need to know "what we just did" won't work forked | Only fork analysis/reporting skills, keep interactive skills inline |
| Shell injection fails silently | Skill starts with missing data | Use `|| echo "unavailable"` fallbacks, design skills to work without injected data |
| `allowed-tools` too restrictive | Skill can't complete its task | Test each skill's tool needs thoroughly, err toward permissive initially |
| Agent type mismatch | Wrong persona for the task | Map each skill to its natural agent role, test output quality |
| Claude Code version compatibility | Users on older Claude Code won't have v2 features | Unknown frontmatter fields are ignored — skills degrade gracefully to v1 behavior |

---

## Future Vision

### Short-term (This Branch)
- All 10 existing skills upgraded with v2 frontmatter
- 3-5 skills forked with agent routing
- Shell injection on 4+ skills
- Supporting files for the 3 heaviest skills
- 2-4 new skills added

### Medium-term (Next Release Cycle)
- Paradigm's custom agents (`.claude/agents/`) packaged with the plugin
- Skill-scoped hooks for automatic session tracking
- `/paradigm:batch` — leverage Claude Code's /batch for multi-package operations
- Dynamic skill generation from `.purpose` files (auto-create review skills per component)

### Long-term (Paradigm v4 Vision)
- **Skills as the primary interface** — MCP tools become the engine, skills become the UX
- **Composable skill chains** — `/paradigm:preflight` → implement → `/paradigm:postflight` as a single workflow
- **Project-specific skill generation** — `paradigm shift` generates custom skills based on project structure
- **Skill telemetry** — track which skills are used, how often, and their token impact
- **Community skill marketplace** — users share Paradigm skill packs for specific domains (API development, frontend, DevOps)

This upgrade positions Paradigm to be the **structured knowledge layer** that Claude Code's skill system has been waiting for. Claude Code provides the execution framework (forking, agent routing, injection). Paradigm provides the domain knowledge (symbols, gates, flows, compliance). Together, they're more than either alone.

---

*This document is the source of truth for the skills-v2-upgrade branch.*
