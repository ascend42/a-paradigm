---
id: N-para-501-task-management
title: Task Management
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-501
  - tasks-are-persistent
  - auto-generated-ids-t-date-sequence
  - three-priority-levels
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-501.json
---

## Why Tasks Exist

AI agent sessions are stateless. You can discuss a plan, identify five things that need doing, and then the session ends. The next session starts blank — those five items are gone. Sticky notes on a monitor do not help when your developer is a language model.

Paradigm's Task Management system provides a persistent scratch pad that survives context windows. Tasks are lightweight, date-partitioned YAML entries that capture what needs doing, how urgent it is, and what project knowledge relates to it. They are not a full project management system — they are the missing short-term memory between sessions.

The key difference from lore: lore records what happened (past tense). Tasks record what should happen (future tense). Together they form a complete timeline — memory of the past and intention for the future.

## Anatomy of a Task

Every task follows a consistent structure:

```yaml
id: T-2026-02-26-001
blurb: "Add rate limiting to the /api/payments endpoint"
priority: high
status: open
tags: [security, payments]
related_lore: [L-2026-02-25-003]
created: "2026-02-26T10:15:00Z"
updated: "2026-02-26T10:15:00Z"
```

The `id` field is auto-generated: `T-{date}-{sequence}`, following the same date-partitioned pattern as lore entries. The `blurb` is the only required field — a concise description of what needs to be done. Everything else is optional but useful.

Three priority levels exist: `high` (do this soon), `medium` (do this eventually), and `low` (nice to have). Tasks without an explicit priority default to `medium`.

Three statuses track lifecycle: `open` (needs doing), `done` (completed), and `shelved` (parked for later — not abandoned, just deferred).

## Storage: Date-Partitioned YAML

Tasks live in `.paradigm/tasks/entries/` organized by creation date:

```
.paradigm/tasks/
  entries/
    2026-02-25/
      T-2026-02-25-001.yaml
      T-2026-02-25-002.yaml
    2026-02-26/
      T-2026-02-26-001.yaml
```

Date partitioning keeps directories small. Each task is a standalone YAML file, making them easy to read, edit, and version-control. The date in the path matches the date in the task ID.

## The Five MCP Tools

**`paradigm_task_create`** — Create a new task. The `blurb` field is required — a short description of what needs to be done. Optional fields include `priority` (high/medium/low), `tags` (for categorization and filtering), and `related_lore` (linking to lore entries that provide context). The task is written to the correct date directory with an auto-incremented ID and starts with status `open`.

**`paradigm_task_list`** — List tasks with filters. Filter by `status` (open/done/shelved/all), `priority` (high/medium/low), or `tag`. Results are sorted by priority (high first) then by date (newest first). Without filters, it returns all open tasks.

**`paradigm_task_update`** — Update any field on an existing task by ID. You can change the blurb, priority, status, tags, or related_lore. Only specified fields are modified — everything else is preserved.

**`paradigm_task_done`** — Shorthand to mark a task as complete. Pass the task ID and the status changes to `done` with an updated timestamp. This is equivalent to `paradigm_task_update` with `status: done` but more ergonomic for the common case.

**`paradigm_task_shelve`** — Shorthand to shelve a task for later. Pass the task ID and the status changes to `shelved`. Shelved tasks are not deleted — they remain searchable and can be reopened by updating their status back to `open`.

## Session Recovery Integration

The top 5 open tasks are automatically surfaced during session recovery. When a new session starts and the agent calls any Paradigm MCP tool, the recovery data includes the highest-priority open tasks alongside the usual breadcrumbs and checkpoint data.

This means every session begins with awareness of outstanding work. The agent does not need to ask "what should I work on?" — the task list is already there, sorted by priority. This is the scratch-pad-that-survives pattern: write tasks in one session, see them in the next.

## When to Create Tasks

Create tasks when:
- You identify work that cannot be completed in the current session
- A code review surfaces follow-up items
- You discover a bug or improvement while working on something else
- The user mentions something that should be tracked but is not the current focus
- A handoff needs to communicate specific next steps

Do not use tasks for:
- Tracking completed work (that is what lore is for)
- Long-term roadmap items (use your project management tool)
- Architectural decisions (use lore entries with type `decision`)

Tasks are ephemeral intentions — they should be created quickly, completed or shelved promptly, and never allowed to accumulate into a backlog of hundreds. If your task list grows beyond 20-30 open items, it is time to triage: shelve the low-priority items and focus on what matters.
