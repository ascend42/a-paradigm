---
id: N-para-701-arch-mcp-tools
title: 'Lesson 13: The arch MCP Tools'
type: note
author: paradigm
created: '2026-04-28'
updated: '2026-04-28'
tags:
  - course
  - para-701
  - arch-tools
  - mcp-tools
symbols: []
difficulty: intermediate
estimatedMinutes: 5
prerequisites:
  - N-para-701-atlas-agent
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## Overview

Paradigm exposes two MCP tools for architectural map queries. Both are read-only and operate on `.paradigm/arch.yaml`. They are available whenever the `arch.yaml` file exists — the tool registry auto-detects the file and activates the arch tool module.

The two tools are:
- `paradigm_arch_status` — tier summary + drift report
- `paradigm_arch_diagram` — Mermaid diagram string

There is also a CLI interface with the same functionality: `paradigm arch status` and `paradigm arch diagram`.

## paradigm_arch_status

**Purpose:** Get a complete summary of the architectural map, including tier details and drift report.

**Token cost:** ~200 tokens

**Input:** No required fields. The tool reads `arch.yaml` from the project root automatically.

**Output when arch.yaml exists:**
```json
{
  "exists": true,
  "version": "1.0",
  "tierCount": 3,
  "tiers": [
    {
      "id": "frontend",
      "label": "Frontend",
      "responsibility": "User interface and client-side logic",
      "framework": "React",
      "componentCount": 8,
      "components": ["#auth-form", "#dashboard-view", "..."]
    }
  ],
  "links": [
    { "from": "frontend", "to": "backend", "via": "REST API" }
  ],
  "drift": {
    "unassigned": ["#analytics-service", "#export-worker"],
    "missing_purpose": ["#legacy-gateway"],
    "clean": false
  }
}
```

**Output when arch.yaml is missing:**
```json
{
  "exists": false,
  "message": "No arch.yaml found. Create .paradigm/arch.yaml to start mapping your architecture."
}
```

**When to call it:**
- At the start of an architectural review session
- After a large feature build to check for tier drift
- When a stakeholder asks for an architecture overview
- As part of a Context Brief when the task involves cross-tier work

## paradigm_arch_diagram

**Purpose:** Render the architectural map as a Mermaid diagram string.

**Token cost:** ~150 tokens

**Input:** Optional `format` field (only `"mermaid"` is supported; default: `"mermaid"`).

**Output when arch.yaml exists:**
```json
{
  "format": "mermaid",
  "diagram": "graph TD\n  frontend[\"Frontend\\n(User interface)\"]\n  backend[\"Backend\\n(Business logic)\"]\n  database[\"Database\\n(Persistence)\"]\n  frontend -->|\"REST API\"| backend\n  backend -->|\"Prisma ORM\"| database"
}
```

**Output when arch.yaml is missing:**
```json
{
  "error": "No arch.yaml found. Cannot render diagram."
}
```

**When to call it:**
- To generate a diagram for inclusion in a pull request description
- When onboarding a new team member who needs a visual of the system
- When preparing architecture documentation
- After adding new tiers or links to verify the diagram renders correctly

## Choosing the Right Tool

| Goal | Tool to Use |
|---|---|
| "How many tiers do we have, and what are they?" | `paradigm_arch_status` |
| "Which new components are not yet in a tier?" | `paradigm_arch_status` → check `drift.unassigned` |
| "Which components in arch.yaml no longer exist?" | `paradigm_arch_status` → check `drift.missing_purpose` |
| "Generate a diagram I can paste into Confluence" | `paradigm_arch_diagram` |
| "Is the architecture clean (no drift)?" | `paradigm_arch_status` → check `drift.clean` |

Call `paradigm_arch_status` first in any architectural session. Call `paradigm_arch_diagram` when you need a visual. There is no need to call both unless you want both the summary data and the diagram string.

## The CLI Interface

The same functionality is available from the terminal:

```bash
# Show tier summary (default subcommand)
paradigm arch status
paradigm arch          # same as above

# Output as JSON for scripting
paradigm arch status --json

# Print Mermaid diagram to stdout
paradigm arch diagram
paradigm arch diagram | pbcopy   # macOS: copy to clipboard
```

The CLI is useful for quick checks, for integrating into CI scripts that report on architectural health, and for generating diagrams in automated documentation workflows.

## Tool Detection

Both tools are registered in the `feature` tier of the MCP tool registry. They activate automatically when `.paradigm/arch.yaml` exists in the project root. If the file does not exist, the tools are not listed in the tool registry and do not consume token budget in tool-list payloads.

This means:
- Projects without `arch.yaml` will never see arch tools in their tool list
- Projects with `arch.yaml` always have both tools available without any configuration
- Creating `arch.yaml` is the only setup required to activate Atlas's full toolset
