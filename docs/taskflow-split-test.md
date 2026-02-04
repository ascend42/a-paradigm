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
