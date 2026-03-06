---
name: protocol
description: Search for or record a repeatable implementation protocol. Use when the user says "check protocol", "record protocol", "any protocol for this", or before starting implementation of a common pattern.
allowed-tools: Read, Grep, Glob
argument-hint: "[task description or protocol name]"
---

# Protocol — Repeatable Implementation Patterns

You are working with Paradigm Protocols — step-by-step implementation patterns
with exact file references, learned from previous completed work. Protocols save
agents from re-discovering patterns that have already been captured.

## Step 1: Determine Intent

Ask yourself: is the user trying to **find** an existing protocol, or **record** a new one?

### Finding a Protocol (before implementing)

1. Call `paradigm_protocol_search` with the task description:
   ```
   paradigm_protocol_search({ task: "add a new settings page" })
   ```

2. If a match is found:
   - Show the user the protocol name, steps, and exemplar
   - Follow the steps — read the exemplar file and template files
   - Skip broad codebase exploration

3. If no match is found:
   - Tell the user no protocol exists for this pattern
   - Proceed with normal implementation
   - After completing the work, suggest recording a protocol

### Recording a Protocol (after implementing)

1. Gather the steps you followed during implementation:
   - Which files did you create? (→ `create` steps with `template_from`)
   - Which files did you modify? (→ `modify` steps with `reference`)
   - Which commands did you run? (→ `run` steps)
   - What's the best exemplar file?

2. Call `paradigm_protocol_record`:
   ```
   paradigm_protocol_record({
     name: "Add a new MCP tool",
     description: "Create a new tool file, loader, register in index.ts",
     trigger: ["add tool", "new mcp tool", "create tool"],
     tags: ["mcp", "tools"],
     symbols: ["#protocol-tools"],
     exemplar: "packages/paradigm-mcp/src/tools/lore.ts",
     steps: [
       { action: "create", target: "packages/paradigm-mcp/src/tools/{name}.ts", template_from: "packages/paradigm-mcp/src/tools/lore.ts", notes: "Follow the tools pattern" },
       { action: "create", target: "packages/paradigm-mcp/src/utils/{name}-loader.ts", template_from: "packages/paradigm-mcp/src/utils/lore-loader.ts", notes: "Loader with types" },
       { action: "modify", target: "packages/paradigm-mcp/src/tools/index.ts", reference: "imports section", notes: "Add import for new tool" },
       { action: "modify", target: "packages/paradigm-mcp/src/tools/index.ts", reference: "tools array", notes: "Spread getXxxToolsList()" },
       { action: "modify", target: "packages/paradigm-mcp/src/tools/index.ts", reference: "dispatch section", notes: "Add startsWith handler" },
       { action: "verify", notes: "Run npm run build in paradigm-mcp" }
     ]
   })
   ```

3. Confirm to the user that the protocol was recorded.

## Step 2: Validate (Optional)

If the user asks to check protocol health:
```
paradigm_protocol_validate({})
```

This checks all protocols for broken references, stale exemplars, and reports health.

## When to Proactively Suggest This

- **Before implementation**: If the task sounds like it might match a common pattern
  (add a page, add a route, add a component), search for protocols first
- **After implementation**: If you created 2+ new files following existing patterns,
  suggest recording a protocol for future agents
