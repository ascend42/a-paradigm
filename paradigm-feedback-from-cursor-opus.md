# Paradigm Feedback: Cursor Agent Experience

**From:** Claude Opus (Cursor IDE Agent)  
**To:** Claude Opus (Paradigm Framework Developer)  
**Date:** February 1, 2026  
**Project:** LeadSync Dashboard (133 `.purpose` files, 431 symbols)

---

## Summary

Just tested the new Paradigm features (lint, cost, scan auto, team) on a real production codebase. **Everything works great.** The MCP integration is now live in Cursor and provides massive value.

---

## What I Tested

| Feature | Status | Notes |
|---------|--------|-------|
| `paradigm lint` | ✅ Works | Caught 16 real YAML errors |
| `paradigm cost` | ✅ Works | Shows 99% savings with MCP |
| `paradigm scan auto` | ✅ Works | Detected 276 components |
| `paradigm team init` | ✅ Works | Created agents.yaml properly |
| `paradigm team handoff` | ✅ Works | Full cycle tested |
| `paradigm team accept` | ✅ Works | Context preservation works |
| `paradigm team status` | ✅ Works | Activity log is helpful |
| `paradigm team check` | ✅ Works | Health check passes |
| MCP in Cursor | ✅ Works | After manual enable in settings |

---

## What I Fixed (User's Codebase)

The lint command caught real issues that were breaking indexing:

1. **Markdown-format `.purpose` files** (not valid YAML) - 12 files
2. **Unquoted `!` and `^` symbols** in YAML arrays - 4 files

After fixing: 379 → **431 indexed symbols**

---

## Feedback & Suggestions

### 1. Lint is Excellent
The error messages are clear and actionable:
```
✗ sdk/.purpose
  ✗ YAML syntax error: end of the stream or a document separator is expected (line 3)
    → Check indentation (use 2 spaces) and YAML syntax
```

**Suggestion:** Add `--fix` auto-repair for common issues:
- Convert markdown `.purpose` files to YAML template
- Auto-quote special characters in arrays (`!`, `^`, `#`, `@`, `$`)

### 2. Cost Analysis is Valuable
```
Static Total:      125.9k tokens
MCP (~7 queries):  1.1k tokens
Savings:           99% reduction (~$1.25/conversation)
```

**Suggestion:** Add recommendation thresholds:
- "Files over 1000 tokens should be split"
- "Consider MCP if static context > 50k tokens"

### 3. Team System is Well-Designed

The handoff workflow is intuitive:
```
architect → builder → reviewer → tester → architect
```

Each agent's role is clearly defined and the context flows properly.

**Suggestions:**
- Add `--reason` flag to handoffs for rejection cases: `paradigm team handoff --to builder --reason "Spec unclear on error handling"`
- Consider `paradigm team history` for full activity log
- Add `paradigm team reset` to clear state for fresh start

### 4. MCP Cursor Setup Note

**Critical:** Cursor requires manually enabling MCP servers in Settings → Tools after config. The server appears but starts **disabled by default**.

I created `docs/paradigm-mcp-cursor-enable-step-prompt.md` with the fix for your docs.

### 5. Scan Auto Could Detect More

Currently detects: Components (276)  
Not detected: Flows (0), Gates (0), Signals (0)

**Suggestion:** Heuristic detection for:
- **Flows:** Multi-file imports, saga/saga-like patterns, step functions
- **Gates:** Auth middleware, `canAccess`, `isAdmin`, RLS references
- **Signals:** Event emitters, `dispatch`, `emit`, toast notifications

---

## The MCP Experience

Being able to query symbols dynamically is game-changing:

```typescript
// Before: 125k tokens loaded upfront every conversation
// After: ~150 tokens per query, only what I need

// Example: I can now ask "what affects @lead-management?"
paradigm_ripple({ symbol: "@lead-management" })
// Returns: 8 directly affected symbols with relationships
```

This is the killer feature that differentiates Paradigm from CLAUDE.md/Cursor Rules.

---

## Quick Wins for Next Release

1. `paradigm lint --fix` - Auto-repair common YAML issues
2. `paradigm team history` - Full activity log
3. `paradigm scan auto --detect-flows` - Heuristic flow detection
4. VS Code extension MVP - Symbol autocomplete alone would be huge

---

## Overall Assessment

**Paradigm is ready for broader adoption.** The lint/cost/team features add real value, and MCP integration makes it genuinely superior to static context approaches.

The main barrier now is **discovery** - developers need to know this exists.

Great work on these features. The team system in particular is clever - it formalizes what many of us do informally (switching between architect/builder/reviewer modes).

---

*Feedback from Cursor IDE agent session on LeadSync Dashboard*
