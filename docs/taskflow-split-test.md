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

### Tech Stack

Use these for both test versions to keep it controlled:

- **Runtime:** Node.js
- **Framework:** Express
- **Database:** SQLite (no setup required)
- **Auth:** JWT tokens
- **Real-time:** WebSocket (ws library)
- **Language:** TypeScript

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

### Required API Endpoints

The AI must implement these endpoints. Use these for validation.

#### Projects
| Method | Endpoint | Auth Required | Expected |
|--------|----------|---------------|----------|
| GET | `/api/projects` | `^authenticated` | 200: user's projects |
| POST | `/api/projects` | `^authenticated` | 201: new project |
| GET | `/api/projects/:id` | `^project-member` | 200: project details |
| PUT | `/api/projects/:id` | `^project-admin` | 200: updated project |
| DELETE | `/api/projects/:id` | `^project-admin` | 204: deleted |

#### Tasks
| Method | Endpoint | Auth Required | Expected |
|--------|----------|---------------|----------|
| GET | `/api/projects/:id/tasks` | `^project-member` | 200: task list |
| POST | `/api/projects/:id/tasks` | `^project-member` | 201: new task |
| GET | `/api/tasks/:id` | `^project-member` | 200: task details |
| PUT | `/api/tasks/:id` | `^task-assignee` | 200: updated task |
| DELETE | `/api/tasks/:id` | `^project-admin` | 204: deleted |

#### Comments
| Method | Endpoint | Auth Required | Expected |
|--------|----------|---------------|----------|
| GET | `/api/tasks/:id/comments` | `^project-member` | 200: comment list |
| POST | `/api/tasks/:id/comments` | `^project-member` | 201: new comment |
| PUT | `/api/comments/:id` | `^comment-author` | 200: updated comment |
| DELETE | `/api/comments/:id` | `^comment-author` | 204: deleted |

### Test Seed Data

Create this data at startup for consistent testing:

```json
{
  "users": [
    { "id": "user-admin", "email": "admin@test.com", "role": "org-admin" },
    { "id": "user-alice", "email": "alice@test.com" },
    { "id": "user-bob", "email": "bob@test.com" },
    { "id": "user-outsider", "email": "outsider@test.com" }
  ],
  "projects": [
    {
      "id": "project-1",
      "name": "Test Project",
      "members": [
        { "userId": "user-alice", "role": "admin" },
        { "userId": "user-bob", "role": "member" }
      ]
    }
  ],
  "tasks": [
    {
      "id": "task-1",
      "projectId": "project-1",
      "title": "Sample Task",
      "assignees": ["user-bob"]
    }
  ],
  "comments": [
    {
      "id": "comment-1",
      "taskId": "task-1",
      "authorId": "user-alice",
      "body": "This is a test comment"
    }
  ]
}
```

### Auth Test Matrix

Run these requests to validate authorization is implemented correctly:

| Request | As User | Expected | Tests Gate |
|---------|---------|----------|------------|
| `GET /api/projects/project-1` | outsider | 403 | `^project-member` |
| `GET /api/projects/project-1` | alice | 200 | `^project-member` |
| `PUT /api/projects/project-1` | bob | 403 | `^project-admin` |
| `PUT /api/projects/project-1` | alice | 200 | `^project-admin` |
| `DELETE /api/projects/project-1` | bob | 403 | `^project-admin` |
| `PUT /api/tasks/task-1` | alice | 403 | `^task-assignee` |
| `PUT /api/tasks/task-1` | bob | 200 | `^task-assignee` |
| `DELETE /api/comments/comment-1` | bob | 403 | `^comment-author` |
| `DELETE /api/comments/comment-1` | alice | 200 | `^comment-author` |
| `DELETE /api/projects/project-1` | admin | 200 | `^org-admin` override |

**Scoring:** Each correct response = 1 point. Max = 10 points.

---

## Copy-Paste Prompts

Use these exact prompts for consistent testing across AI models.

### Initial Build Prompt

Copy this entire block to start the test:

```
Build a project management API called "TaskFlow" with the following spec:

## Tech Stack
- Node.js + Express + TypeScript
- SQLite database
- JWT authentication
- WebSocket for real-time

## Features
1. Projects - CRUD, team membership (members vs admins)
2. Tasks - CRUD within projects, assignees, status, due dates
3. Comments - Threaded on tasks, @mention support
4. Notifications - For assignments and mentions
5. Activity Feed - Timeline of actions per project

## Required Endpoints

### Projects
- GET /api/projects - list user's projects (authenticated)
- POST /api/projects - create project (authenticated)
- GET /api/projects/:id - get project (project member only)
- PUT /api/projects/:id - update project (project admin only)
- DELETE /api/projects/:id - delete project (project admin only)

### Tasks
- GET /api/projects/:id/tasks - list tasks (project member)
- POST /api/projects/:id/tasks - create task (project member)
- GET /api/tasks/:id - get task (project member)
- PUT /api/tasks/:id - update task (task assignee or admin)
- DELETE /api/tasks/:id - delete task (project admin)

### Comments
- GET /api/tasks/:id/comments - list comments (project member)
- POST /api/tasks/:id/comments - create comment (project member)
- PUT /api/comments/:id - update comment (comment author only)
- DELETE /api/comments/:id - delete comment (comment author only)

## Seed Data (create on startup)

Users:
- user-admin (org admin, can access everything)
- user-alice (admin of project-1)
- user-bob (member of project-1, assignee of task-1)
- user-outsider (not in any project)

Project:
- project-1: "Test Project" with alice as admin, bob as member

Task:
- task-1: in project-1, assigned to bob

Comment:
- comment-1: on task-1, authored by alice

## Validation

After building, these requests must return the correct status:

1. GET /api/projects/project-1 as outsider → 403
2. GET /api/projects/project-1 as alice → 200
3. PUT /api/projects/project-1 as bob → 403
4. PUT /api/projects/project-1 as alice → 200
5. PUT /api/tasks/task-1 as alice → 403 (not assignee)
6. PUT /api/tasks/task-1 as bob → 200 (is assignee)
7. DELETE /api/comments/comment-1 as bob → 403 (not author)
8. DELETE /api/comments/comment-1 as alice → 200 (is author)

Build this now. Tell me when it's ready to test.
```

---

### Pivot 1 Prompt (Cross-Cutting Change)

```
Add audit logging to all task state changes. I want to know who changed what and when.

Requirements:
- Log task creates, updates, and deletes
- Capture: user ID, action type, timestamp, task ID, before/after state
- Store in an audit_logs table

Validation:
1. Create a task as bob → check audit log has entry with action="create"
2. Update the task as bob → check audit log has entry with action="update"
3. Delete the task as alice (admin) → check audit log has entry with action="delete"
4. All entries should have correct user_id and timestamp
```

---

### Pivot 2 Prompt (New Feature + Auth)

```
Add a task templates feature. Project admins can create templates, regular members can use them.

Requirements:
- New endpoints:
  - POST /api/projects/:id/templates (admin only) - create template
  - GET /api/projects/:id/templates (member) - list templates
  - DELETE /api/templates/:id (admin only) - delete template
- Modify POST /api/projects/:id/tasks to accept optional template_id
- When template_id provided, copy title/description from template

Validation:
1. POST /api/projects/project-1/templates as bob → 403
2. POST /api/projects/project-1/templates as alice → 201
3. GET /api/projects/project-1/templates as bob → 200
4. POST /api/projects/project-1/tasks with template_id as bob → 201 (task has template's title)
```

---

### Pivot 3 Prompt (Auth Bug Fix)

```
Bug report: Users can delete comments they don't own. Fix this.

Current behavior: Any project member can delete any comment
Expected behavior: Only the comment author can delete their comment

Validation:
1. DELETE /api/comments/comment-1 as bob → 403 (alice is author)
2. DELETE /api/comments/comment-1 as alice → 200
3. Create new comment as bob, delete as bob → 200
4. Create new comment as bob, delete as alice → 403
```

---

### Pivot 4 Prompt (Multi-Feature Flow)

```
When a task is assigned to someone, send them a Slack notification.

Requirements:
- Add Slack webhook URL to project settings
- When task is created with assignees OR assignees are added via update:
  - Send Slack message: "You've been assigned to: {task title}"
- Only notify newly assigned users (not existing ones on update)

Validation:
1. Create task with assignee → Slack webhook called
2. Update task to add new assignee → Slack webhook called for new assignee only
3. Update task without changing assignees → no Slack call
4. Project without Slack webhook → no error, just skip
```

---

### Pivot 5 Prompt (Pattern Question)

```
I need to clean up old completed tasks. Should I soft delete or hard delete them?

Look at the existing codebase and tell me:
1. What pattern is currently used for deletions?
2. What are the implications of each approach?
3. What do you recommend for this codebase and why?
```

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

### Prompts

Pivot 1 (Cross-cutting): 
"Add audit logging to all task state changes. I want to know who changed what and when."

Pivot 2 (New feature + auth):
"Add a task templates feature. Project admins should be able to create templates, and regular members can use them to quickly create tasks."

Pivot 3 (Auth bug):
"Bug: Users can delete comments they don't own. Can you fix this?"

Pivot 4 (Multi-feature flow):
"When a task is assigned to someone, send them a Slack notification."

Pivot 5 (Pattern question):
"I need to clean up old completed tasks. Should I soft delete or hard delete them?"

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

### Validation Checklists

#### Pivot 1: Audit Logging

- [ ] Creates, updates, AND deletes are all logged (not just one)
- [ ] Log captures: user ID, action, timestamp, before/after state
- [ ] Hooked into task service/routes (not just one endpoint)

```bash
# Quick test: Create a task, update it, delete it
# Check audit log has 3 entries with correct user/action/time
```

#### Pivot 2: Task Templates

- [ ] Template CRUD endpoints exist
- [ ] `POST /templates` requires admin (returns 403 for members)
- [ ] `POST /tasks` accepts template_id parameter
- [ ] Members can create tasks from templates

```bash
# Quick test:
# As member: POST /templates → should 403
# As admin: POST /templates → should 201
# As member: POST /tasks with template_id → should 201
```

#### Pivot 3: Auth Bug Fix

- [ ] `DELETE /comments/:id` checks ownership
- [ ] Returns 403 when non-author tries to delete
- [ ] Author can still delete their own comment

```bash
# Quick test:
# User A creates comment
# User B tries DELETE → should 403
# User A tries DELETE → should 200
```

#### Pivot 4: Slack Notifications

- [ ] Fires when task is assigned (not just created)
- [ ] Hooks into existing notification/integration system
- [ ] Slack config is externalized (not hardcoded)

```bash
# Quick test:
# Assign task to user with Slack connected
# Check Slack webhook was called (or mock it)
```

#### Pivot 5: Pattern Question

- [ ] AI checked existing codebase for delete patterns
- [ ] Gave a definitive answer (not "it depends")
- [ ] Reasoning references project conventions or created one

*This pivot is subjective — you're testing whether the AI understood the codebase enough to make a consistent recommendation.*

### Automated Validation (Optional)

For rigorous testing, write a small test file before each pivot:

```typescript
// pivot-3-validation.test.ts
describe('Comment deletion auth', () => {
  it('allows authors to delete', async () => {
    const comment = await createComment({ authorId: 'user-a' });
    const res = await request(app)
      .delete(`/comments/${comment.id}`)
      .set('Authorization', 'Bearer user-a-token');
    expect(res.status).toBe(200);
  });

  it('blocks non-authors', async () => {
    const comment = await createComment({ authorId: 'user-a' });
    const res = await request(app)
      .delete(`/comments/${comment.id}`)
      .set('Authorization', 'Bearer user-b-token');
    expect(res.status).toBe(403);
  });
});
```

The pivot is "complete" when tests pass.

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

- Tech stack is fixed to keep the comparison controlled
- File structure is not specified — let the AI decide
- Code patterns are not specified — observe what the AI creates
- The goal is to test how well the AI understands and navigates the codebase

---

*See [full study results](../.paradigm/docs/agentic-efficiency-study.md) for detailed analysis.*
