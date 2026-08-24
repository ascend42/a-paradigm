---
name: teach
description: Teach an agent a new behavior or pattern. Writes a journal entry that promotes to the agent's notebook for future sessions. Use when the user says "teach", "train agent", "agent should know", "remember this for agent", or wants to give an agent specific instructions.
---

# Teach an Agent

You are recording a new behavior or pattern for an agent. This writes a
journal entry that will promote to the agent's notebook, appearing in
future session context via buildProfileEnrichment.

## Step 1: Identify Agent and Instruction

Parse the user's request to determine:
- **Agent ID**: which agent to teach (architect, builder, security, reviewer, tester, documentor)
- **Instruction**: what the agent should learn

If the argument is provided (e.g., `/paradigm:teach security always check rate limiting on auth routes`),
parse it directly. Otherwise, ask the user:
1. Which agent?
2. What should it learn?

## Step 2: Verify Agent Exists

```
paradigm_agent_get({ id: "<agent-id>" })
```

If the agent doesn't exist, suggest creating it:
"Agent '{id}' not found. Create with `/paradigm:agents onboard` first."

## Step 3: Formulate the Journal Entry

Transform the user's instruction into a structured journal entry:

- **trigger**: `human_feedback` (this is explicit human teaching)
- **insight**: The user's instruction, expanded to be specific and actionable
- **confidence_after**: 0.90 (high — this is direct instruction from the human)
- **transferable**: true if the pattern applies beyond this project, false if project-specific
- **pattern**: Extract an `applies_when` and `correct_approach` pair

Example: User says "security, always check rate limiting on auth routes"
→ insight: "Human instruction: when reviewing auth-related routes, always verify rate limiting is in place. Check for middleware ordering (rate limiter should be present), connection limits, and per-user throttling."
→ pattern: { id: "auth-rate-limiting", applies_when: "auth routes are created or modified", correct_approach: "verify rate limiting middleware exists, check ordering relative to auth gate, confirm per-user throttling" }

## Step 4: Record the Entry

```
paradigm_journal_record({
  agent: "<agent-id>",
  trigger: "human_feedback",
  insight: "<expanded instruction>",
  project: "<project-name from config>",
  transferable: <true|false>,
  confidence_before: 0.5,
  confidence_after: 0.90,
  pattern: {
    id: "<pattern-id>",
    applies_when: "<when this applies>",
    correct_approach: "<what to do>"
  },
  tags: ["<relevant-tags>", "human-taught"]
})
```

## Step 5: Auto-Promote

Since this is a high-confidence human instruction (0.90 ≥ 0.80 threshold),
trigger immediate promotion:

```
paradigm_ambient_promote({ agent: "<agent-id>" })
```

Report whether the entry was promoted to the notebook.

## Step 6: Confirm

```
Taught: {agent-id}
  Pattern: {pattern-id}
  Applies when: {applies_when}
  Correct approach: {correct_approach}
  Promoted to notebook: {yes/no}

  This will appear in {agent-id}'s context in future sessions.
```
