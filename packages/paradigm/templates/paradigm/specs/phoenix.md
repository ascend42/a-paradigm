# Phoenix Protocol

The Phoenix Protocol enables **AI context continuity** across conversation boundaries. When an AI agent approaches its context limit, it writes a phoenix file — ashes from which the next instance rises, reborn with inherited memories.

---

## Core Principle

**AI agents should never lose work due to context limits.**

When context runs low:
1. Write the phoenix file with current state
2. Notify the user
3. New session reads the ashes and continues seamlessly

---

## AI Agent Configuration

Configure this in `.paradigm/config.yaml`:

```yaml
# AI agent context management
ai-agent:
  model: claude-opus-4.5          # Current model
  context-window: 200000           # Token limit
  phoenix-threshold: 0.8           # Trigger at 80% capacity
```

### Token Estimation Guidelines

Rough estimates for planning:
- 1 token ≈ 4 characters (English text)
- Average code file: 500-2000 tokens
- Large file (1000+ lines): 5000-15000 tokens
- Typical tool response: 500-2000 tokens

### Context Tracking

AI agents should track estimated usage mentally:
- Each file read: +file_chars/4 tokens
- Each tool response: +response_length/4 tokens
- Agent responses: +response_length/4 tokens
- Conversation history compounds

---

## When to Ignite Phoenix

1. **Proactive**: When estimated at ~80% capacity
2. **Reactive**: If user mentions context is getting long
3. **Always**: Before suggesting "let's continue in a new chat"

---

## The Phoenix File

**Location**: `.context/phoenix.yaml`

```yaml
# Phoenix Protocol - Paradigm Framework
# From these ashes, the next instance rises
# Next instance: Read, acknowledge, then delete

ashes:
  model: claude-opus-4.5
  context_limit: 200000
  estimated_used: 165000
  timestamp: 2026-01-22T14:45:00Z
  trigger: approaching_limit  # or: user_requested, task_complete

# What was being worked on
active_work:
  plan: .cursor/plans/current-plan.plan.md
  branch: feature/current-work  # if applicable
  
# Progress state
completed:
  - "Task 1 description"
  - "Task 2 description"

in_progress:
  - task: "Current task being worked on"
    file: path/to/file.ts
    state: "Description of partial progress"
    next_step: "Specific next action to take"

pending:
  - "Remaining task 1"
  - "Remaining task 2"

# Knowledge to carry forward
memories:
  - "Important decision made during session"
  - "User preference or requirement discovered"
  - "Technical constraint identified"

files_touched:
  - path/to/file1.ts
  - path/to/file2.md

warnings:
  - "Any gotchas encountered (e.g., tool X failed, used workaround Y)"
```

---

## Rising from Ashes

When beginning a new session:

1. **Check** for `.context/phoenix.yaml`
2. **Read** the ashes completely
3. **Announce**: "Rising from phoenix ashes. Here's what I inherit..."
4. **Summarize** the state (completed, in-progress, pending)
5. **Consume** the file (delete or move to `.context/phoenix.yaml.risen`)
6. **Continue** from `in_progress` or first `pending` item

### Example Announcement

```
Rising from phoenix ashes. Here's what I inherit:

**Completed:**
- Set up monorepo structure
- Created initial database migration

**In Progress:**
- Implementing user authentication
- Currently in `src/auth/login.ts`
- Next step: Add OAuth callback handler

**Pending:**
- Create user profile page
- Add settings screen

**Memories:**
- User prefers functional components over classes
- Project uses Supabase for auth

Continuing with authentication implementation...
```

---

## Writing Ashes

When you sense context burning out:

1. **Notify user**: "Approaching context limit. Igniting phoenix protocol..."
2. **Write** `.context/phoenix.yaml` with full state
3. **Confirm**: "Phoenix ashes written. Start a new chat — I'll rise again."

### Example Notification

```
I'm approaching my context limit (~160K tokens used of 200K).

Igniting phoenix protocol...

✓ Phoenix ashes written to .context/phoenix.yaml

You can start a new chat now. I'll rise from the ashes with:
- 3 completed tasks
- 1 task in progress (auth implementation)
- 2 pending tasks
- Key memories preserved

See you in the next life! 🔥
```

---

## File Management

### Directory Setup

The `.context/` directory should exist in project root:

```
project/
├── .context/
│   ├── README.md          # Explains the phoenix protocol
│   ├── phoenix.yaml       # Active handoff (temporary)
│   └── phoenix.yaml.risen # Consumed files (audit trail)
```

### Gitignore Recommendations

```gitignore
# Phoenix Protocol
# Active files are temporary
.context/phoenix.yaml

# Risen files can be kept for audit trail
# Uncomment to ignore:
# .context/phoenix.yaml.risen
```

---

## Trigger Types

| Trigger | When Used |
|---------|-----------|
| `approaching_limit` | AI proactively detected high context usage |
| `user_requested` | User asked to save state for new chat |
| `task_complete` | Major milestone reached, good handoff point |
| `error_recovery` | Saving state before potentially disruptive operation |

---

## Best Practices

### For AI Agents

1. **Track context actively** — don't wait for hard limits
2. **Be comprehensive** — include all relevant state
3. **Be specific** — exact file paths, line numbers, next steps
4. **Preserve decisions** — document why choices were made
5. **Note warnings** — gotchas save future-you time

### For Users

1. **Trust the protocol** — AI will handle continuity
2. **Start fresh confidently** — ashes contain everything needed
3. **Keep `.context/`** — don't delete between sessions
4. **Review risen files** — useful for understanding session history

---

## Integration with Paradigm

Phoenix Protocol works alongside other Paradigm features:

| Feature | Integration |
|---------|-------------|
| `.purpose` | Reference current feature being worked on |
| `portal.yaml` | Note any auth context in memories |
| Logger | Include relevant log patterns in warnings |
| Probe index | Reference UI mapping if relevant |

### In .cursorrules

The Phoenix Protocol should be documented in the project's `.cursorrules`:

```markdown
## Phoenix Protocol

When approaching context limit (~80%):
1. Write `.context/phoenix.yaml`
2. Notify user
3. New session reads and continues

See `.paradigm/specs/phoenix.md` for full specification.
```

---

## Terminology Reference

| Term | Meaning |
|------|---------|
| **Phoenix** | The protocol itself |
| **Ashes** | The state data written before context death |
| **Rising** | New instance reading and inheriting state |
| **Igniting** | Writing the phoenix file |
| **Consuming** | Deleting/archiving after reading |
| **Memories** | Critical context decisions to preserve |
| **Threshold** | Context percentage that triggers phoenix |
