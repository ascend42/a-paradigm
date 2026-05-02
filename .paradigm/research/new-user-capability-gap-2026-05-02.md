# Research Brief: New-User Capability Gap
**Date:** 2026-05-02
**Author:** Scholar (research agent)
**Commission:** Nora (ftux) friction finding F-01 + F-03 — in-session capability summary absent; init/shift doc contradiction

---

## Scope

This brief answers five questions raised by Nora's first-time-user friction analysis:

1. Does any existing MCP resource serve as a capability summary?
2. What does `paradigm_navigate` return on a fresh project?
3. What does `paradigm_status` return on a fresh project?
4. Is the `paradigm init` vs `paradigm shift` contradiction (F-03) real?
5. What does `paradigm://context/agent-protocol` actually contain?

Sources verified by direct file read, with line citations throughout.

---

## Finding 1 — No MCP resource functions as a capability summary

There are three candidate surfaces in the MCP resource layer.

**`paradigm://context/agent-protocol`**
Source: `packages/paradigm-mcp/src/resources/context.ts:46–99`

This resource exists and is labeled "IMPORTANT: Read this first. Workflow instructions for using Paradigm MCP tools effectively." Its content is a *query-before-modify* workflow table plus a seven-tool summary table:

```
| paradigm_status      | Project overview and health      |
| paradigm_search      | Find symbols by name/description |
| paradigm_ripple      | Impact analysis before changes   |
| paradigm_related     | Symbol dependencies              |
| paradigm_navigate    | Codebase exploration             |
| paradigm_session_health | Session health monitoring     |
| paradigm_handoff_prepare | Prepare context handoff      |
```
(context.ts:83–94)

The framing is "how to use tools correctly" not "what Paradigm is capable of doing for you." A new-session user asking "what can Paradigm do?" would receive operating instructions for an assumed workflow, not a capability surface. The seven-tool list covers fewer than 15% of the 50+ registered tools.

**`paradigm://guidance/*` topics**
Source: `packages/paradigm-mcp/src/resources/guidance.ts:25–690`

Eleven topic entries exist: `logging`, `portal`, `mcp-workflow`, `flows`, `orchestration`, `workspaces`, `university`, `calibration`, `checkpoints`, `troubleshooting`, `component-types`, `navigation`. These are domain-narrow behavioral guides. There is no top-level `what-is-paradigm` or `capabilities` entry. `paradigm://guidance` (guidance.ts:729–748) returns a JSON list of topic names with token estimates — a discovery index, not a capability summary.

The `mcp-workflow` topic (guidance.ts:151–218) is the closest approximation: it contains a "Before Doing X, Call Y" table covering 15 tools plus a token budget reference table. Still framed as workflow protocol rather than capability.

**`llms.txt`**
Source: `llms.txt` (root)

This file is a symbol dump for *this repository* (a-paradigm's own `.purpose` data: gates, flows, routes, conventions). It describes the project's authorization topology and symbol conventions. It is not a framework capability summary. A new user reading it would see Paradigm's own gates and routes, not an explanation of what Paradigm does. Confusion risk: the filename suggests an AI-readable capabilities manifest (the emerging `llms.txt` convention from anthropic.com), but the content is project-local symbol data.

**Verdict:** No existing MCP resource serves as a session-level capability summary. The closest artifact is the `agent-protocol` resource's 7-tool table, which covers a subset of tools and carries no narrative about what the framework does or why.

---

## Finding 2 — `paradigm_navigate` is a codebase navigator, not a capability surface

Source: `packages/paradigm-mcp/src/tools/navigate.ts`

The tool accepts three intents — `find`, `explore`, `context` — and dispatches against `navigator.yaml` or an auto-generated minimal config (navigate.ts:89–98). The output schema is:

```
{ intent, target/task, paths, symbols, skip, suggested_order, explanation? }
```
(navigate.ts:157–166)

On a fresh project with no `.purpose` files, `generateMinimalNavigator()` returns an empty structure config and empty symbol map (navigate.ts:256–332). The tool then returns `paths: []` plus a recovery array: `["Try a different search term", "Use paradigm_search ...", "Check .purpose files exist", "Run paradigm scan ..."]` (navigate.ts:176–182).

There is zero capability-discovery content in any code path. The tool's description (`'Navigate the codebase efficiently. Use "find" to locate a symbol, "explore" to browse an area...'`) is accurate and purpose-limited.

---

## Finding 3 — `paradigm_status` returns project-health metrics, not framework capabilities

Source: `packages/paradigm-mcp/src/tools/index.ts:760–864`

The tool returns a JSON object containing:
- `project` — project name
- `symbolSystem` — "v2"
- `counts` — symbol counts by type (components, flows, gates, signals, aspects)
- `total` — total symbol count
- `componentTypes` — breakdown by structural type (when present)
- `examples` — up to 3 example symbols per type
- `hasPortalYaml` — boolean
- `purposeFiles` — count
- Optional fields: `purposeHealthScore`, `protocols`, `notebookReferences`, `complianceHealth`
- `note` — a static note about Symbol System v2 tag classification
- `environment` — os, shell, terminal syntax note

On a fresh project, `counts` will show zeros or near-zeros, `examples` will be empty, and all optional health fields will be absent. The output communicates project-level state, not framework-level capability.

**Description-vs-implementation drift (bonus finding for Architect):** The registered tool description reads: `'Get project overview - call this at session start for orientation. Shows symbol counts, project health, **and available features**.'` (tools/index.ts:463, emphasis added). The implementation returns no "available features" field. This is description drift. Extending `paradigm_status` to deliver on its own description — adding a concise framework-capability section when symbol count is low — is one candidate minimum-leverage fix.

---

## Finding 4 — The `paradigm init` vs `paradigm shift` contradiction (F-03) is real and multi-site

This is not a single doc inconsistency. It spans four files and at least seven specific locations.

**README.md** — `paradigm shift` is the canonical one command:
- Line 28: `"That's it. paradigm shift scaffolds everything your AI assistant needs..."` (follows the bash block at lines 23–27)
- Lines 33–63: `paradigm shift` output sample showing 6 steps, 9 created/updated files

**docs/guides/quick-start.md** — still uses the legacy 6-step `paradigm init` sequence throughout:
- Line 25–29 (Super Quick Setup): `paradigm init --quick && paradigm sync --all && paradigm mcp setup --client all && paradigm constellation && paradigm beacon && paradigm doctor`
- Line 141 (Full Setup section): same 6-step command
- Line 110 (Key Commands table): `paradigm init --quick — Initialize .paradigm/ directory`
- Line 243 (Troubleshooting section): `paradigm init --quick --force`

**docs/guides/mcp-setup.md** — mixes both:
- Line 70 (Prerequisites): `"Run paradigm init if you haven't already"`
- Line 549 (Next Steps at document close): `"Run paradigm shift to generate .paradigm/, .purpose, and portal.yaml"`

These are not equivalent commands. `paradigm shift` is a superset that runs init + scan + sync + hooks install. A new user following quick-start.md runs six commands, then reads the README and sees a one-command alternative that also installs enforcement hooks, which the quick-start sequence does not mention at all.

**Net friction**: A user who reads README first runs `paradigm shift`. A user who reads quick-start.md (the canonical onboarding doc linked from README line 389) runs six separate commands, missing hook installation. The contradiction is not cosmetic.

---

## Finding 5 — `paradigm://context/agent-protocol` content summary

Source: `packages/paradigm-mcp/src/resources/context.ts:46–99`

Full content structure:
1. **Query Before Modify** — a 4-row table mapping "before doing X / call this tool" (ripple, status, navigate, related)
2. **Example Workflow** — 4 numbered steps (status → navigate → ripple → session_health)
3. **Benefits** — 3 bullets (fresh data, precise, token-efficient)
4. **Context Monitoring** — `paradigm_session_health` thresholds (<50% / 50–70% / 70–85% / >85%)
5. **Available Tools Summary** — 7-row table (status, search, ripple, related, navigate, session_health, handoff_prepare)

The resource is designed for agents who have already decided to use Paradigm and need to use it correctly. It is not designed for agents (or users) who need to understand what Paradigm can do for them. It answers "how do I use these tools" not "why would I call any of these tools."

The "Available Tools Summary" lists 7 of the 50+ registered tools. It omits: all `paradigm_lore_*` tools, `paradigm_orchestrate_inline`, `paradigm_protocol_*`, `paradigm_task_*`, `paradigm_decision_*`, `paradigm_symphony_*`, `paradigm_aspect_*`, `paradigm_journal_*`, `paradigm_wisdom_*`, and all ambient/captain/university tools.

---

## Candidate Insertion Points for Architect

Four surfaces could host the missing capability summary. Each has different tradeoffs.

| Surface | What changes | Who benefits | Risk |
|---------|-------------|-------------|------|
| Extend `paradigm://context/agent-protocol` | Add a "What Paradigm does" preamble + expanded tool list | All MCP clients; agents reading at session start | Grows an already-read resource; may bury workflow content |
| New `paradigm://capabilities` resource | Dedicated surface for "what can paradigm do" | Claude Desktop / agents that enumerate resources | Requires user to know to ask for it; not auto-surfaced |
| Add `framework_capabilities` field to `paradigm_status` response | Appears on first `paradigm_status` call; already the session-start recommendation | All clients; triggered by standard orientation call | Increases status response size; cache invalidation needed |
| Extend generated CLAUDE.md template (via `paradigm shift`) | Every new project gets a capability section in its CLAUDE.md | New projects only; existing projects need re-shift | Static; stales when new tools ship |

**Pre-existing content ready to lift:** README.md lines 419–431 ("For AI Agents: Quick Context") is a near-complete capability summary already written in AI-targeted prose. It covers what Paradigm does, token savings, setup, MCP tools (with 5 examples), and enforcement. It is in the wrong delivery surface for an in-session query. Lifting this content into an MCP resource would require minimal creative work.

---

## Summary of Gaps

| Gap | Severity | Files Affected |
|-----|----------|---------------|
| No MCP resource answers "what can paradigm do?" | High (F-01) | resources/context.ts, resources/guidance.ts |
| `agent-protocol` lists 7/50+ tools | Medium | resources/context.ts:83-94 |
| `paradigm_status` description says "available features" but returns none | Medium (drift) | tools/index.ts:463 |
| `paradigm_navigate` returns nothing useful on a fresh project | Low (by design, but unhelpful) | tools/navigate.ts:176-182 |
| quick-start.md still uses 6-step `paradigm init` sequence | High (F-03) | docs/guides/quick-start.md:25-29, :110, :141, :243 |
| mcp-setup.md contradicts itself within one document | Medium (F-03) | docs/guides/mcp-setup.md:70, :549 |
| `llms.txt` is project-symbol data, not a capabilities manifest | Low (naming confusion risk) | llms.txt |

---

```yaml
# Agent Relay
status: success
summary: |
  All five research questions answered from primary sources (direct file reads
  with line citations). No existing MCP resource serves as a session-level
  capability summary. The closest artifacts (agent-protocol 7-tool table,
  mcp-workflow guidance topic) are framed as workflow protocols, not capability
  surfaces. The init/shift contradiction is real and spans 7 specific locations
  across 3 files. A ready-to-lift capability summary already exists in README
  lines 419-431 — it just needs a delivery surface.
artifacts:
  - .paradigm/research/new-user-capability-gap-2026-05-02.md
decisions:
  - "paradigm://context/agent-protocol is a workflow guide, not a capability summary — framing and tool coverage are both wrong for the use case"
  - "paradigm_status tool description claims 'available features' but the implementation returns none — description drift flagged for Architect"
  - "paradigm_navigate returns empty paths + recovery hints on a fresh project — no capability content by design"
  - "F-03 is real: quick-start.md uses the legacy paradigm init 6-step sequence at lines 25-29, 110, 141, 243; mcp-setup.md line 70 says init, line 549 says shift"
  - "README.md lines 419-431 already contains a near-complete AI-targeted capability summary — lift, do not rewrite"
  - "llms.txt is this repo's own symbol data, not a framework capabilities file — naming is a confusion risk"
handoff_context: |
  Four candidate insertion points for the capability fix are enumerated in the
  "Candidate Insertion Points" table, each with tradeoffs. The minimum-leverage
  option is likely either: (a) extend paradigm://context/agent-protocol with
  a capability preamble lifting README 419-431 content, or (b) add a
  framework_capabilities field to paradigm_status that fires when symbol
  count is zero or when response_format is "detailed" on a fresh project.
  
  The F-03 (init vs shift) fix is a pure doc edit: quick-start.md and
  mcp-setup.md need to replace the 6-step paradigm init sequence with
  paradigm shift, citing the hook-installation gap as the reason the old
  sequence is incomplete (not just longer).
  
  Both fixes are independent and can be planned/shipped in any order.
```
