---
name: lore
description: Record a lore entry for the current session. Use when the user says "record lore", "log what we did", "save session history", or proactively at the end of a significant work session (3+ files modified).
allowed-tools: Bash(git *), Read, Grep, Glob
---

# Record Lore Entry

You are recording a lore entry — a structured record of what happened in this
session for the project timeline. This is important for team continuity and
the stop hook will block if significant work happened without a lore entry.

## Step 1: Gather Session Context

Collect information about what was done in this session.

Git changes:
!`git diff --stat HEAD 2>/dev/null`

Recent commits:
!`git log --oneline -10 2>/dev/null`

If the user provided a title via arguments, use it: $ARGUMENTS

The git data above is pre-loaded — no need to run those commands again.

3. **Symbols touched**: Think about which Paradigm symbols (#, $, ^, !, ~) were
   involved in the work. If unsure, call `paradigm_search` with keywords from
   the work done.

4. **Session summary**: Synthesize what was accomplished — features added, bugs
   fixed, refactoring done, decisions made.

## Step 2: Determine Entry Type

Choose the most appropriate lore entry type:

| Type | When to use |
|---|---|
| `agent-session` | Default for AI-assisted work sessions |
| `human-note` | When the user is documenting something manually |
| `decision` | When an architectural or design decision was made |
| `review` | When reviewing code, PRs, or designs |
| `incident` | When responding to a bug, outage, or error |
| `milestone` | When a significant project milestone was reached |

Default to `agent-session` unless the work clearly fits another type.

## Step 3: Compose the Entry

Structure the lore entry with:

- **title**: Short, descriptive title (imperative form: "Add payment integration",
  not "Added payment integration")
- **summary**: 2-4 sentences describing what was done and why
- **type**: From the table above
- **symbols_touched**: Array of Paradigm symbols involved (e.g., `["#payment-form", "$checkout-flow", "^authenticated"]`)
- **tags**: Relevant tags (e.g., `["feature", "frontend"]`, `["bugfix", "auth"]`)

## Step 4: Record the Entry

Call `paradigm_lore_record` with the composed entry:

```
paradigm_lore_record({
  type: "agent-session",
  title: "Add payment form validation",
  summary: "Implemented client-side validation for the payment form including card number, expiry, and CVV fields. Added error messages and real-time feedback. Updated the checkout flow to block submission on invalid input.",
  symbols_touched: ["#payment-form", "$checkout-flow"],
  tags: ["feature", "frontend", "validation"]
})
```

## Step 5: Confirm to User

After recording, tell the user:
- The lore entry has been recorded
- Show the title and type
- Mention it's saved in `.paradigm/lore/entries/`
- The stop hook will now pass the lore check

## When to Proactively Suggest This

You should proactively suggest recording lore when:
- The session is ending and 3+ source files were modified
- A significant decision was made during the session
- An incident was investigated and resolved
- A milestone was reached (feature complete, first deployment, etc.)

## Entry Quality Guidelines

Good lore entries:
- Focus on **what** and **why**, not just **how**
- Include all affected symbols for searchability
- Are written for a future developer who needs context
- Use specific language, not vague descriptions

Bad lore entries:
- "Updated some files" — too vague
- "Fixed bug" — which bug? what was the root cause?
- Only listing file names without explaining the change
