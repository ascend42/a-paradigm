---
id: context-tracking
title: Context Tracking System
version: 0.1.0
updated: 2026-02-02
tags: [mcp, context, handoff, session]
canonical_for: [context-tracking, session-management]
related:
  - ./team.md (handoff commands)
  - ./navigator.md (exploration context)
---

# Context Tracking System

The Context Tracking system provides **session-aware context monitoring** via MCP, helping AI agents know when to perform handoffs before running out of context space.

---

## Problem

AI agents working in long sessions face context window limits:
- Claude models have 200K token context windows
- Long sessions gradually fill the context
- Agents cannot directly detect their own token usage
- Abrupt context exhaustion loses work continuity

---

## Solution

The MCP server tracks session interactions and provides:
- **Session statistics** - tool calls, resource reads, duration
- **Token estimation** - approximate MCP contribution to context
- **Handoff recommendations** - when to initiate handoff
- **Handoff preparation** - generate handoff summaries

---

## MCP Tools

### paradigm_context_check

Check if context handoff is recommended.

**Parameters:**
- `estimatedTotalTokens` (optional): Your estimate of total conversation tokens
- `contextWindowSize` (optional): Context window size (default: 200,000)

**Returns:**
```json
{
  "recommendation": "continue" | "consider-handoff" | "handoff-recommended" | "handoff-urgent",
  "message": "Human-readable guidance",
  "stats": {
    "sessionDurationMinutes": 15,
    "mcpToolCalls": 23,
    "mcpResourceReads": 5,
    "estimatedMcpTokens": 12000,
    "usagePercent": 45
  },
  "signals": ["Additional context signals"],
  "action": "Next recommended action"
}
```

**Recommendation Thresholds:**
| Usage | Recommendation |
|-------|----------------|
| < 50% | `continue` |
| 50-70% | `consider-handoff` |
| 70-85% | `handoff-recommended` |
| > 85% | `handoff-urgent` |

### paradigm_handoff_prepare

Prepare a handoff summary for session continuity.

**Parameters:**
- `summary` (required): Brief summary of work done
- `nextSteps` (optional): List of next steps
- `agent` (optional): Target agent role

**Returns:**
```json
{
  "handoff": {
    "id": "h1a2b3c",
    "summary": "...",
    "nextSteps": [...],
    "sessionStats": {...}
  },
  "instructions": ["Step-by-step handoff instructions"],
  "cliCommand": "paradigm team handoff --to ..."
}
```

### paradigm_session_stats

Get current session statistics.

**Returns:**
```json
{
  "session": {
    "startTime": "2026-02-02T10:00:00Z",
    "durationMinutes": 25
  },
  "interactions": {
    "toolCalls": 30,
    "resourceReads": 8
  },
  "tokens": {
    "estimatedMcpTokens": 15000
  }
}
```

### paradigm_session_recover

Load previous session breadcrumbs for continuity. Call this at the start of a new session to understand what was done before.

**Parameters:** None

**Returns (when breadcrumbs exist):**
```json
{
  "found": true,
  "previousSession": {
    "sessionId": "s1a2b3c",
    "startTime": "2026-02-14T10:00:00Z",
    "lastActivity": "2026-02-14T11:30:00Z",
    "age": "2 hours ago"
  },
  "context": {
    "symbolsModified": ["#auth-handler", "^authenticated"],
    "filesExplored": ["src/middleware/auth.ts"]
  },
  "recentActions": [
    {
      "time": "2026-02-14T11:28:00Z",
      "action": "tool-call",
      "tool": "paradigm_ripple",
      "symbol": "#auth-handler",
      "summary": "Ripple analysis on #auth-handler"
    }
  ],
  "suggestion": "Last work involved #auth-handler. Consider checking its current state with paradigm_ripple."
}
```

**Returns (when no breadcrumbs):**
```json
{
  "found": false,
  "message": "No previous session breadcrumbs found.",
  "tip": "Session breadcrumbs are saved to .paradigm/session-breadcrumbs.json during active sessions."
}
```

**Notes:**
- Breadcrumbs are automatically recorded for every MCP tool call during a session
- The breadcrumb file (`.paradigm/session-breadcrumbs.json`) persists between sessions
- Up to 50 breadcrumbs are retained (oldest trimmed automatically)

---

## MCP Resources

### paradigm://context/session

Current session statistics (passive read).

### paradigm://context/handoff-guide

Markdown guide for when and how to perform handoffs.

---

## AI Agent Protocol

### Session Recovery

At the start of a new session, call `paradigm_session_recover` to load previous session breadcrumbs:

```
1. Call paradigm_session_recover
2. If found: true:
   - Review recentActions for context
   - Note symbolsModified and filesExplored
   - Follow the suggestion for next steps
3. If found: false:
   - No previous session — start fresh with paradigm_status
```

### Periodic Checks

For long sessions, periodically call `paradigm_context_check`:

```
After every 10-15 significant interactions:
1. Call paradigm_context_check
2. If recommendation != "continue":
   - Inform user of recommendation
   - Offer to prepare handoff
3. Continue working
```

### Handoff Flow

When handoff is recommended:

```
1. Call paradigm_handoff_prepare with:
   - Summary of completed work
   - List of next steps
   - Files modified

2. Present handoff to user

3. User runs CLI command:
   paradigm team handoff --to <agent> --summary "..."

4. New session accepts:
   paradigm team accept <id>
```

---

## Limitations

1. **No Direct Token Access**: The MCP server cannot access actual conversation token counts from the AI model
2. **Estimation Only**: Token counts are approximations based on MCP responses
3. **Session-Scoped**: Stats reset when MCP server restarts
4. **User Cooperation**: Handoff requires user to start new session

---

## Integration with Team System

Context tracking complements the Team system:

| System | Purpose |
|--------|---------|
| Context Tracking | Detect when handoff is needed |
| Team Handoff | Execute the handoff |
| Team Accept | Continue in new session |

Typical flow:
```
paradigm_context_check → paradigm_handoff_prepare → paradigm team handoff → new session → paradigm team accept
```

---

## Best Practices

1. **Check Periodically**: Don't wait until context is full
2. **Summarize Well**: Include specific file paths and symbols
3. **List Next Steps**: Make it easy to continue
4. **Reference Symbols**: Use #component, ^gate, !signal prefixes
5. **Note Blockers**: Document any unresolved issues
