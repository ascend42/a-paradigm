# TaskFlow Split Test Specification

> A minimal spec for testing AI agent performance with and without Paradigm.

## TaskFlow Spec

**What it is:** A project management API where teams organize work into projects and tasks.

### Features

1. **Projects** - Create, read, update, delete projects. Users join projects as members or admins.

2. **Tasks** - Create tasks within projects. Tasks have title, description, status, assignees, and due dates. Tasks can depend on other tasks.

3. **Comments** - Threaded comments on tasks. Support @mentions to notify users.

4. **Notifications** - Users receive notifications for assignments, mentions, and due dates. Real-time and email digest options.

5. **Activity Feed** - Timeline of all actions across a project (task created, comment added, status changed, etc.)

6. **Search** - Full-text search across projects, tasks, and comments.

7. **Reports** - Project analytics: tasks by status, burndown charts, team workload.

8. **Integrations** - Webhooks for external systems. Slack notifications. GitHub issue sync.

### Authorization Rules

- Only authenticated users can access the API
- Only project members can view/interact with a project
- Only project admins can change project settings or delete the project
- Only task assignees (or admins) can change task status
- Only comment authors can edit/delete their own comments
- Org admins can access everything

### Flows

**When a task is created:**
1. Validate user is project member
2. Save task
3. Notify assignees
4. Update activity feed
5. Fire webhooks
6. Index for search

**When someone is @mentioned in a comment:**
1. Parse the mention
2. Create notification for mentioned user
3. Update activity feed
4. Send real-time event

---

## The Test

Build this app twice — once with Paradigm, once without. Then execute the pivots below.

### Setup

**Control version (no Paradigm):**
- Standard README with architecture overview
- Basic AI instructions file
- JSDoc comments in code
- No .purpose files, no portal.yaml, no MCP tools

**Paradigm version:**
- Run `paradigm shift` after initial scaffold
- Define features in `.purpose` files
- Define auth gates in `portal.yaml`
- Let AI use MCP tools for navigation

### Pivots

| # | Pivot | Prompt |
|---|-------|--------|
| 1 | Cross-cutting change | "Add audit logging to all task state changes" |
| 2 | New feature + auth | "Add task templates - admins create, members use" |
| 3 | Auth bug fix | "Fix: users can delete comments they don't own" |
| 4 | Multi-feature flow | "Add Slack notifications when tasks are assigned" |
| 5 | Pattern question | "Should I soft delete or hard delete old tasks?" |

### Measurements

| Metric | How to Measure |
|--------|----------------|
| Time to complete | Stopwatch from prompt to working solution |
| Context efficiency | Count files read / tokens used (if available) |
| Accuracy | Did AI identify all auth gates? All affected features? |
| Pattern consistency | Does solution match existing codebase patterns? |

### Scoring Rubric

| Criteria | Points |
|----------|--------|
| Identified correct files/locations | 0-3 |
| Identified all authorization requirements | 0-3 |
| Understood cross-feature dependencies | 0-3 |
| Solution matches existing patterns | 0-3 |

---

## Expected Results

Based on initial testing:

| Metric | Without Paradigm | With Paradigm |
|--------|------------------|---------------|
| Time to complete | ~12 minutes | ~7 minutes |
| Context per task | ~14,000 tokens | ~1,500 tokens |
| Auth gates missed | Common | Rare |

**Key insight:** The Paradigm version has more files (`.purpose`, `portal.yaml`, etc.) but completes faster because structured context beats raw context.

---

## Notes

- No tech stack specified — let the AI choose
- No file structure specified — let the AI decide
- No code patterns specified — observe what the AI creates
- The goal is to test how well the AI understands and navigates the codebase, not prescribe implementation

---

*See [full study results](../.paradigm/docs/agentic-efficiency-study.md) for detailed analysis.*
