# Session 1: Build + Feature Sprint

> Build TaskFlow from scratch, then immediately add three features. Warm session — full context.

## Tech Stack

- Node.js + Express + TypeScript
- SQLite via better-sqlite3
- JWT authentication

## Data Model

**Users** — id, name, email, role (user or admin)
**Projects** — id, name, description, created_by
**Project Members** — project_id, user_id, role (admin or member)
**Tasks** — id, project_id, title, description, status, assignee_id, due_date, created_by
**Comments** — id, task_id, author_id, body

## Seed Data

Create on startup. This data is reused across all sessions — get it right.

| Entity | ID | Details |
|--------|----|---------|
| User | user-admin | role: admin (system-level) |
| User | user-alice | role: user |
| User | user-bob | role: user |
| User | user-charlie | role: user |
| User | user-outsider | role: user, not in any project |
| Project | project-1 | "Alpha Project", created by alice |
| Project | project-2 | "Beta Project", created by bob |
| Membership | — | alice is **admin** of project-1 |
| Membership | — | bob is **member** of project-1 |
| Membership | — | charlie is **member** of project-1 |
| Membership | — | bob is **admin** of project-2 |
| Membership | — | alice is **member** of project-2 |
| Task | task-1 | In project-1, assigned to bob, created by alice |
| Task | task-2 | In project-2, assigned to alice, created by bob |
| Comment | comment-1 | On task-1, authored by alice |
| Comment | comment-2 | On task-1, authored by charlie |

## Token File

On startup, generate JWT tokens for **all** seed users and write to `tokens.json`:

```json
{
  "user-admin": "<jwt>",
  "user-alice": "<jwt>",
  "user-bob": "<jwt>",
  "user-charlie": "<jwt>",
  "user-outsider": "<jwt>"
}
```

## API Endpoints

### Projects
- `GET /api/projects` — list user's projects (authenticated)
- `POST /api/projects` — create project (authenticated, creator becomes admin)
- `GET /api/projects/:id` — get project (project member only)
- `PUT /api/projects/:id` — update project (project admin only)
- `DELETE /api/projects/:id` — delete project (project admin only)

### Tasks
- `GET /api/projects/:id/tasks` — list tasks (project member)
- `POST /api/projects/:id/tasks` — create task (project member)
- `GET /api/tasks/:id` — get task (project member)
- `PUT /api/tasks/:id` — update task (**task assignee only**)
- `DELETE /api/tasks/:id` — delete task (project admin)

### Comments
- `GET /api/tasks/:id/comments` — list comments (project member)
- `POST /api/tasks/:id/comments` — create comment (project member)
- `PUT /api/comments/:id` — update comment (comment author only)
- `DELETE /api/comments/:id` — delete comment (comment author only)

**Critical:** `PUT /api/tasks/:id` is restricted to the task's **current assignee only**. Project admins cannot update tasks they aren't assigned to. This rule is tested throughout the study.

## Feature Sprint

After the baseline API is working, add these three features in the same session:

### 1. Audit Logging

Add audit logging for all task mutations (create, update, delete).

- Create an `audit_logs` table: id, user_id, action, entity_id, before_state (JSON), after_state (JSON), timestamp
- Log every task create, update, and delete
- Add `GET /api/audit-logs` — system admin only — returns all audit log entries

### 2. Task Templates

Project admins can create reusable task templates. Members can use them.

- `POST /api/projects/:id/templates` — create template (project admin only, returns 201)
- `GET /api/projects/:id/templates` — list templates (project member)
- `DELETE /api/templates/:id` — delete template (project admin only)

Template fields: id, project_id, title, description, created_by

Modify `POST /api/projects/:id/tasks` to accept an optional `template_id`. When provided, use the template's title and description as defaults.

### 3. Assignment Notifications

When a task is assigned to a user, create an in-app notification.

- Create a `notifications` table: id, user_id, type, message, task_id, project_id, read, created_at
- When a task is created with an `assignee_id`, insert a notification with type `task-assigned`
- When a task is updated and the `assignee_id` changes, insert a notification for the new assignee
- Add `GET /api/notifications` — returns the authenticated user's notifications

## Validation

Run `bash case-study/verify.sh 1` — all 13 tests must pass.

## Report

Write to `results/session-1-report.md` using the template from `protocol.md`.
