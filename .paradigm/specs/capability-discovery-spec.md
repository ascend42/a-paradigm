# Capability Discovery Spec

**ID:** spec-capability-discovery  
**Status:** approved  
**Author:** architect  
**Date:** 2026-05-02  
**Tracks:** F-01 (capability summary gap, HIGH), F-03 (init/shift doc drift, MEDIUM)

---

## Problem Statement

A user inside an active Claude session who asks "what can paradigm do?" gets no purpose-built answer. The two most likely entry points both fail:

- `paradigm_status` — description promises "available features" but returns only symbol counts and project health. No capability content.
- `paradigm://context/agent-protocol` — exists but is a workflow guide listing 7 of 50+ tools; has no capability framing; an agent only reads it if it already knows to list MCP resources.

There is no path from the "what can paradigm do?" moment to a usable answer.

---

## Decision: Minimal-Leverage Approach

Two changes. No new schema types, no new resource categories.

### Change 1 — Add capability preamble to `paradigm://context/agent-protocol`

**Why this resource, not a new one:** `paradigm://context/agent-protocol` is already listed first in `getContextResourcesList()` with the label "IMPORTANT: Read this first." It is the highest-surface-area resource for agents that do list resources. Adding capability content here requires no new URI, no new routing, and no new registration plumbing.

**What changes:** Prepend a "What Paradigm Is" section before the existing "Query Before Modify" workflow content. The section answers: what it does, what the tool surface is (50+ tools by category), what enforcement looks like, and where to go next.

**Source content:** README.md lines 419–431 ("For AI Agents: Quick Context") is structurally correct and already written for AI consumption. Lift the structural lines; drop the marketing-tone claims (e.g., "8.5x reduction"). Rewrite as neutral, factual statements.

**Preamble content (draft for Builder):**

```markdown
## What Paradigm Is

Paradigm adds a metadata layer (`.purpose` files + `portal.yaml`) to any codebase so AI agents can query architecture context via MCP instead of reading source files directly.

**What it does**
- Tracks codebase symbols: `#components`, `$flows`, `^gates`, `!signals`, `~aspects`
- Answers queries about structure, dependencies, authorization, and history without file reads
- Enforces coverage: hooks block sessions that modify code without updating `.purpose` files

**Tool surface (50+ tools)**
- Navigation: `paradigm_status`, `paradigm_search`, `paradigm_navigate`, `paradigm_related`
- Impact: `paradigm_ripple`, `paradigm_flows_affected`
- Authorization: `paradigm_gates_for_route`, `paradigm_portal_add_gate`
- History: `paradigm_history_context`, `paradigm_lore_record`, `paradigm_lore_search`
- Agents: `paradigm_agent_list`, `paradigm_orchestrate_inline`, `paradigm_ambient_events`
- Compliance: `paradigm_aspect_check`, `paradigm_protocol_search`
- Session: `paradigm_session_health`, `paradigm_handoff_prepare`

**Setup** (if not already initialized)
Run `paradigm shift` — auto-detects language/framework, creates `.paradigm/` config, scaffolds `.purpose` and `portal.yaml`, installs hooks.

---
```

The existing workflow content ("Query Before Modify", "Example Workflow", etc.) follows unchanged after this preamble.

**Note for Builder:** The existing "Available Tools Summary" table at the bottom of agent-protocol (lines 84–94 of the current resource) lists only 7 tools with no indication the full surface is 50+. This is a related inaccuracy. Either expand it to a category-grouped list matching the preamble above, or replace it with a pointer: "See preamble above for full tool surface." Do not leave it contradicting the new preamble.

---

### Change 2 — Add a discovery pointer to `paradigm_status` output

**Why this is necessary:** The realistic first contact for any agent is `paradigm_status` — it is called at session start and is referenced in CLAUDE.md, the plugin, and the agent protocol itself. F-01 is most acute here because `paradigm_status` description says "available features" but the JSON payload contains none.

**What changes:** Add a single field to the `paradigm_status` JSON output:

```json
"capabilities": "paradigm://context/agent-protocol"
```

This field appears unconditionally (not only on empty projects — see "Explicitly Rejected" below). It is a plain string URI, not a nested object. It does not add bulk; it closes the loop from the actual entry point to the actual content.

Also update the `paradigm_status` tool description to remove "available features" (which it does not return) and replace with: "Get project overview — call this at session start for orientation. Shows symbol counts, project health, and a pointer to the capability guide."

**Files to change:**
- `packages/paradigm-mcp/src/tools/index.ts` — status tool description (line 463) + JSON output (around line 868 where the JSON is built)

---

## F-03: Init/Shift Documentation Drift

### Problem

`quick-start.md` uses `paradigm init --quick` at lines 28, 38, 53, 110, 141, and 243. `mcp-setup.md` line 70 says "Run `paradigm init`". Both contradict the README and the current UX where `paradigm shift` is the entry command.

`paradigm shift` supports `--quick` (skip slow operations) and `--force` (reinitialize) — these flags transfer directly.

### Fix

**quick-start.md:** Replace all occurrences of `paradigm init --quick` with `paradigm shift --quick`. Replace standalone `paradigm init` with `paradigm shift`. Update the compound command at lines 28 and 141 — the `paradigm init --quick && paradigm sync --all && paradigm mcp setup --client all && paradigm constellation && paradigm beacon && paradigm doctor` chain. `paradigm shift` subsumes init, sync-all, and doctor, but `constellation` and `beacon` are **not** called by shift (confirmed: no reference in `shift.ts` or `shift-files.ts`). Replace the chain with `paradigm shift && paradigm constellation && paradigm beacon`.

Verify the `--force` variant at line 243 (`paradigm init --quick --force`) maps to `paradigm shift --quick --force` — both flags exist on shift, so this is a direct replacement.

Update the `--quick` explanation at line 53: "skips slow operations (scan)" is correct for shift's `--quick` flag; the explanation can stay with minor wording edits.

**mcp-setup.md:** Replace `paradigm init` at line 70 with `paradigm shift`. No other changes needed — line 179 and line 549 already use `paradigm shift` correctly.

**Files to change:**
- `docs/guides/quick-start.md` — 6 occurrences
- `docs/guides/mcp-setup.md` — 1 occurrence (line 70)

---

## Explicitly Rejected Options

**Option 2 — New `paradigm://capabilities` resource**
Rejected as duplicative once Change 1 lands. Discoverability is not improved: an agent that doesn't list resources won't find a new URI any more easily than the existing one. Reserve for v+1 if option 1 underperforms.

**Option 3 — `framework_capabilities` field on `paradigm_status` when symbol count is zero**
Rejected. F-01 occurs on projects with symbols — a new *user* on an existing project triggers the same gap. The zero-symbol conditional gates out the majority case. A one-line pointer (Change 2) achieves the same routing without the conditional and without staling.

**Option 4 — Extend generated CLAUDE.md template via `paradigm shift`**
Rejected. Content stales over releases; the template represents setup-time state, not runtime capability. The current CLAUDE.md already routes to MCP resources. Adding more pointers there is low-leverage and diverges from the MCP-as-source-of-truth principle.

---

## Summary: Files Builder Touches

| File | Change |
|------|--------|
| `packages/paradigm-mcp/src/resources/context.ts` | Add capability preamble before workflow content; update or replace the 7-tool table at end |
| `packages/paradigm-mcp/src/tools/index.ts` | Add `capabilities` field to status JSON output; update tool description string at line 463 |
| `docs/guides/quick-start.md` | Replace `paradigm init --quick` with `paradigm shift --quick` at 6 locations; collapse compound init chains to `paradigm shift` |
| `docs/guides/mcp-setup.md` | Replace `paradigm init` with `paradigm shift` at line 70 |

**Build required after code changes:** `npm run build` in `packages/paradigm-mcp/`

---

## User Experience After This Change

**Before:** Agent asks "what can paradigm do?" → calls `paradigm_status` → gets symbol counts → no capability answer → falls back to tool dump or install pitch.

**After:** Agent calls `paradigm_status` → sees `"capabilities": "paradigm://context/agent-protocol"` → reads resource → gets structured answer: what paradigm does, tool categories with representative tool names, setup command, enforcement model. The question is answered in two MCP calls, both already in the standard workflow.
