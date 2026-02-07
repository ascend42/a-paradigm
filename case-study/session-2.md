# Session 2: Adversarial Requirements

> New session — no prior conversation history. The codebase from session 1 persists.

## Context

You are picking up an existing project management API called TaskFlow. Orient yourself from the code and any project documentation.

**Important setup note:** Charlie (user-charlie) has been removed from project-1 between sessions. His user account still exists, but his project membership has been revoked. His comments and other data remain in the system. You must handle this — either add charlie's removal to the DB setup/migration, or implement it as a startup step. Charlie should NOT appear as a current member of project-1, but his historical data (comments, etc.) must be preserved.

## Features to Add

### 1. Task Reassignment

Add `POST /api/tasks/:id/assign` — project admins can reassign tasks.

Requirements:
- Only **project admins** can use this endpoint
- Accepts `{"assignee_id": "user-id"}` in the request body
- Updates the task's assignee and returns the updated task
- Non-admin project members get 403
- Non-members get 403

**Critical constraint:** `PUT /api/tasks/:id` MUST remain restricted to the task's current assignee only. Do NOT widen the PUT authorization. This is tested.

### 2. Bulk Status Update

Add `PATCH /api/projects/:id/tasks/status` — project admins can update status on multiple tasks at once.

Request body: `{"task_ids": ["task-1", "task-3"], "status": "done"}`

Requirements:
- **Project admin only** — members get 403
- All task_ids must belong to the specified project (reject or ignore cross-project IDs)
- Returns 200 on success
- Does NOT bypass the assignee-only constraint on `PUT /api/tasks/:id` — that endpoint remains assignee-only

The spec is intentionally silent on some edge cases. Use your judgment.

### 3. Orphan Cleanup Report

Add `POST /api/admin/cleanup` — system admin finds orphaned resources.

An "orphan" is data left behind by removed members:
- Comments authored by users no longer in the project
- Tasks assigned to users no longer in the project

Requirements:
- **System admin only** — return 403 for non-admins
- Returns a JSON report listing orphaned resources found
- The report should include charlie's comment on task-1 (comment-2) since charlie is no longer a project-1 member
- **Non-destructive** — does NOT delete or modify any data. Returns the report only.
- Original data must remain intact after the endpoint is called

## Regression Guards

These existing behaviors MUST still work after your changes:

1. `PUT /api/tasks/:id` returns 403 for non-assignees (even admins)
2. Tasks in project-2 cannot be affected by project-1 endpoints (cross-project isolation)

## Validation

Run `bash case-study/verify.sh 2` — all 24 tests must pass (13 from session 1 + 11 new).

## Report

Write to `results/session-2-report.md` using the template from `protocol.md`.
