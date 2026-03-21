---
name: handoff
description: Prepare a context handoff summary for the next session or agent. Use when the user says "prepare handoff", "I'm done for now", "hand this off", or when context usage is high and work needs to continue later.
context: fork
agent: Explore
allowed-tools: Read, Grep, Glob
---

# Session Handoff

You are preparing a structured handoff so the next session (or agent) can
continue this work without losing context.

## Current State

Git status:
!`git status --short 2>/dev/null`

Recent commits:
!`git log --oneline -10 2>/dev/null`

Current branch:
!`git branch --show-current 2>/dev/null`

Uncommitted changes:
!`git diff --stat HEAD 2>/dev/null`

## Step 1: Summarize Work Done

Based on the git state above:
1. What was the task or goal?
2. What was accomplished?
3. What files were modified and why?

## Step 2: Identify Remaining Work

1. What still needs to be done?
2. Are there any open issues or blockers?
3. Which files need further attention?

## Step 3: Capture Decisions

List any decisions made during this session:
- Architectural choices
- Trade-offs considered
- Patterns chosen over alternatives

## Step 3b: Agent Performance Summary

If agents were used during this session (orchestration, subagents), summarize:
1. Which agents contributed and what they did
2. Any threshold adjustments from `paradigm_ambient_learn`
3. Journal entries promoted to notebooks via `paradigm_ambient_promote`
4. Agent acceptance/dismissal rates if available

Include this in the handoff so the next session knows which agents are warmed up.

## Step 4: Note Risks & Gotchas

1. What could go wrong if the next session isn't careful?
2. Are there fragile areas that need attention?
3. Any known issues to watch out for?

## Step 5: Prepare Handoff

Call `paradigm_handoff_prepare` with the gathered context:

```
paradigm_handoff_prepare({
  summary: "<what was done>",
  nextSteps: ["<step 1>", "<step 2>", ...],
  decisions: ["<decision 1>", "<decision 2>", ...],
  risks: ["<risk 1>", ...],
  filesModified: [<list from git>],
  symbolsTouched: [<relevant symbols>]
})
```

## Step 6: Present to User

```
Handoff Summary
===============

Session: <branch> — <date>

Completed:
  - <what was done>

Next Steps:
  1. <most important next action>
  2. <second action>
  ...

Key Decisions:
  - <decision and rationale>

Risks:
  - <things to watch out for>

Files to Review:
  - <files that need attention>

To resume: The next session will automatically receive this
context via paradigm_session_recover.
```
