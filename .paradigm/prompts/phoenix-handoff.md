# Phoenix Handoff

Use this prompt when you need to save your work state for a new AI session.

---

## Prompt

```
I'm approaching my context limit. Please ignite the Phoenix Protocol:

1. Create `.context/phoenix.yaml` with:
   - Current progress (completed, in-progress, pending tasks)
   - Critical memories and decisions made
   - Files touched in this session
   - Any warnings or gotchas discovered

2. Include specific next steps for the resuming instance

3. Confirm when the ashes are written

After you confirm, I'll start a new chat where you'll rise from the ashes.
```

---

## When to Use

- Context is getting long (AI mentions limits)
- Before starting a complex multi-step task
- When switching focus to different part of codebase
- Before potentially risky operations

---

## What to Expect

The AI will write a `.context/phoenix.yaml` file containing:
- Progress state
- Knowledge to carry forward
- Specific continuation instructions

The next AI session will:
1. Check for `.context/phoenix.yaml`
2. Announce inherited state
3. Continue from where you left off

---

## Alternative: User-Triggered

```
Save your current state using Phoenix Protocol. Include:
- What we've accomplished
- What we're currently working on
- What's still pending
- Any important context or decisions
```
