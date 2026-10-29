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

If the argument is provided (e.g., `/paradigm:teach security for this repo, check rate limiting on auth routes`),
parse it directly. Otherwise, ask the user:
1. Which agent?
2. What should it learn?

## Step 2: Verify Agent Exists

```
paradigm_agent({op:'get', id: "<agent-id>" })
```

If the agent doesn't exist, suggest creating it:
"Agent '{id}' not found. Create with `/paradigm:agents onboard` first."

## Step 2b: Pick the Lesson's Home

Every lesson lives in one home (scoped learning):
- **repo**: committed with the project and shared with the team.
- **user**: just this person, in every project (`~/.paradigm`).

Read the home from the user's own words:
- "for this repo", "in this project" → **repo**, `home_source: "explicit"` (their words named it).
- "for me", "everywhere", "every project" → **user**, `home_source: "explicit"`.
- Bare "here" and "always" do not name a home ("here's the rule"; "always" is how often, not where). Ignore them.
- The lesson only names a repo symbol (`#component`, `$flow`, `^gate`, `!signal`, `~aspect`) or a repo path (`packages/...`, `src/...`) → it points to **repo**, but that is only inferred. In a public repository (`learning.visibility` public or unset), ask instead of recording it. In a private one, record repo with `home_source: "inferred"`.

If the words point both ways or nowhere, or a public repo leaves only an inferred repo home, ask ONE question, exactly:

```
This repo or just you?
```

Record the answer with `home_source: "explicit"`. Do not ask a second time.
If the user names the home outright (`--home repo`, "put it in the repo"), it is also `explicit`.

`paradigm_journal` (op `record`) can do the inference for you: pass the user's
words as `taught_text` and no `home`. It returns `ask: "This repo or just you?"`
and records nothing when the words do not settle it, or when they only infer a
repo home in a public repository. The commit guard then never surprises the
user with a lesson they taught.

## Step 3: Formulate the Journal Entry

Transform the user's instruction into a structured journal entry:

- **trigger**: `human_feedback` (this is explicit human teaching)
- **insight**: The user's instruction, expanded to be specific and actionable
- **confidence_after**: 0.90 (high — this is direct instruction from the human)
- **home**: from Step 2b (`repo` or `user`), with **home_source** `explicit` or `inferred`
- **transferable**: `false` when home is repo, `true` when home is user
- **pattern**: Extract an `applies_when` and `correct_approach` pair

Example: User says "security, always check rate limiting on auth routes"
→ insight: "Human instruction: when reviewing auth-related routes, always verify rate limiting is in place. Check for middleware ordering (rate limiter should be present), connection limits, and per-user throttling."
→ pattern: { id: "auth-rate-limiting", applies_when: "auth routes are created or modified", correct_approach: "verify rate limiting middleware exists, check ordering relative to auth gate, confirm per-user throttling" }

## Step 4: Record the Entry

```
paradigm_journal({op:'record',
  agent: "<agent-id>",
  trigger: "human_feedback",
  insight: "<expanded instruction>",
  project: "<project-name from config>",
  transferable: <false for repo, true for user>,
  home: "<repo|user>",
  home_source: "<explicit|inferred>",
  taught_text: "<the user's own words>",
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
paradigm_ambient({op:'promote', agent: "<agent-id>" })
```

Report whether the entry was promoted to the notebook.

## Step 6: Confirm

Always show the home that was picked. The record reply carries a
`confirmation` line; show it as given.

```
Taught: {agent-id}
  Home: {repo|user} ({you chose it | inferred from your wording})
  Pattern: {pattern-id}
  Applies when: {applies_when}
  Correct approach: {correct_approach}
  Promoted to notebook: {yes/no}

  This will appear in {agent-id}'s context in future sessions.
```

When the home was inferred, add one line: "Say 'just me' or 'this repo' to flip it."
If the user flips it, record the change as `explicit`. For a lesson already in
the repo notebooks, `paradigm teach --home repo` (keep it in the repo) or
`paradigm teach --home user` (move it to just you) does this.

In a public repository the commit guard refuses a repo lesson whose home was
only inferred, until the human confirms it with `paradigm teach --home repo`.
