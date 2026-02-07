# TaskFlow: Build-Along Tutorial Project

A step-by-step tutorial project that demonstrates all Paradigm features by building a task management application.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Episode Guide](#episode-guide)
3. [Feature Matrix](#feature-matrix)
4. [Starter Repository Structure](#starter-repository-structure)
5. [Teaching Moments](#teaching-moments)
6. [AI Interaction Scripts](#ai-interaction-scripts)

---

## Project Overview

### What We're Building

**TaskFlow** — A task management application with:
- Tasks with CRUD operations
- Projects for organizing tasks
- User authentication
- Admin dashboard
- Notifications

### Why TaskFlow?

| Reason | Benefit |
|--------|---------|
| **Relatable domain** | Everyone knows task apps |
| **Complex enough** | Needs authorization, flows, signals |
| **Simple enough** | Buildable in a tutorial series |
| **All symbols natural** | Each symbol type has a clear use case |

### What We'll Demonstrate

| Paradigm Feature | TaskFlow Application |
|------------------|---------------------|
| `.purpose` files | Defining features, components |
| `portal.yaml` | Authorization gates (public, auth, owner, admin) |
| Symbol system | 5 operational symbols + tag bank in context |
| Beacon | AI orientation at session start |
| Constellation | Querying symbol relationships |
| Ripple | Impact analysis before changes |
| Thread | Session continuity |
| MCP Server | Claude Desktop integration |
| Portal Viewer | Visual auth debugging |
| Prism | Exploring the project visually |

---

## Episode Guide

### Episode 1: Project Setup

**Video:** "Getting Started with Paradigm" (Video 2)
**Duration:** 10-12 minutes
**Goal:** Initialize a new project with Paradigm

#### Starting Point
```
Empty directory
```

#### Steps

1. **Create the project**
   ```bash
   mkdir taskflow && cd taskflow
   npm init -y
   ```

2. **Install Paradigm**
   ```bash
   npm install -g @a-company/paradigm
   paradigm --version
   ```

3. **Initialize Paradigm**
   ```bash
   paradigm init
   ```
   - Walk through what's created
   - Explain `.paradigm/` structure
   - Show `config.yaml`

4. **Explore the structure**
   ```
   taskflow/
   ├── .paradigm/
   │   ├── config.yaml
   │   ├── specs/
   │   ├── docs/
   │   └── prompts/
   ├── .purpose       # Empty, we'll fill this
   └── package.json
   ```

5. **First status check**
   ```bash
   paradigm status
   ```
   - Shows: 0 features, 0 components
   - "We'll change that next"

#### End State
```
Initialized Paradigm project with .paradigm/ directory
```

#### AI Interaction Demo
```
You: "What files were created by paradigm init?"
AI: [Reads beacon, explains structure]
```

#### Milestone Checkpoint
- [ ] `paradigm status` runs without errors
- [ ] `.paradigm/` directory exists
- [ ] `config.yaml` is present

---

### Episode 2: Defining Features

**Video:** "The Symbol System Explained" (Video 3)
**Duration:** 8-10 minutes
**Goal:** Create a comprehensive `.purpose` file with features

#### Starting Point
```
Episode 1 end state
```

#### Steps

1. **Plan features with AI**
   ```
   You: "Help me plan the features for a task management app"
   AI: [Suggests features, uses # prefix with [feature] tag]
   ```

2. **Create root `.purpose`**
   ```yaml
   # .purpose
   version: 1.0.0
   description: TaskFlow - A task management application
   
   features:
     task-management:
       description: "Create, update, delete, and organize tasks"
       components: [#TaskForm, #TaskList, #TaskCard]
       gates: [^authenticated]
       signals: ["!task-created", "!task-completed", "!task-deleted"]
       flows: [$task-creation-flow]
   ```

3. **Add more features**
   ```yaml
     project-organization:
       description: "Group tasks into projects"
       components: [#ProjectCard, #ProjectList, #ProjectSelector]
       gates: [^authenticated]
       signals: ["!project-created"]
   
     user-authentication:
       description: "Login, logout, session management"
       components: [#LoginForm, #LogoutButton, #AuthProvider]
       gates: [^public]
       signals: ["!login-success", "!login-failed", "!logout"]
       flows: [$auth-flow]
   
     admin-dashboard:
       description: "User management and system settings"
       components: [#UserManager, #SettingsPanel]
       gates: [^admin]
       signals: ["!user-banned", "!settings-updated"]
   
     notifications:
       description: "Alert users about task updates"
       components: [#NotificationBell, #NotificationList]
       gates: [^authenticated]
       signals: ["!notification-sent", "!notification-read"]
   ```

4. **Add components section**
   ```yaml
   components:
     TaskForm:
       description: "#TaskForm: Form for creating/editing tasks"
       used-by: [#task-management]
   
     TaskList:
       description: "#TaskList: Displays list of tasks with filters"
       used-by: [#task-management]
   
     TaskCard:
       description: "#TaskCard: Individual task display card"
       used-by: [#task-management]
   
     # ... more components
   ```

5. **Run paradigm status**
   ```bash
   paradigm status
   ```
   - Shows: 5 features, 12 components
   - "Now our AI knows what we're building"

6. **Generate constellation**
   ```bash
   paradigm constellation
   ```
   - Show the JSON output
   - Query with jq: `jq '.stars["#task-management"]'`

#### End State
```yaml
# Complete .purpose with:
# - 5 features
# - 12+ components
# - Symbol references (gates, signals, flows)
```

#### AI Interaction Demo
```
You: "What components are used by #task-management?"
AI: [Queries constellation, returns accurate list]
```

#### Milestone Checkpoint
- [ ] `paradigm status` shows 5 features
- [ ] `paradigm constellation` generates JSON
- [ ] All symbols use correct prefixes

---

### Episode 3: Setting Up Authorization

**Video:** "Portal - Visual Authorization" (Video 6)
**Duration:** 10-12 minutes
**Goal:** Create portal.yaml with gate definitions

#### Starting Point
```
Episode 2 end state
```

#### Steps

1. **Create portal.yaml**
   ```yaml
   # portal.yaml
   version: 1.0.0
   
   gates:
     public:
       description: "^public: No authentication required"
       keys: []  # Always passes
   
     authenticated:
       description: "^authenticated: User must be logged in"
       keys:
         - user.id != null
   
     task-owner:
       description: "^task-owner: User owns this task"
       requires: [^authenticated]
       keys:
         - task.userId == user.id
   
     project-member:
       description: "^project-member: User is a member of this project"
       requires: [^authenticated]
       keys:
         - user.id IN project.memberIds
   
     admin:
       description: "^admin: User has admin role"
       requires: [^authenticated]
       keys:
         - user.role == 'admin'
   ```

2. **Validate the portal**
   ```bash
   paradigm portal validate
   ```
   - Should pass with no errors
   - Explain validation rules

3. **Connect gates to features**
   - Update `.purpose` to reference gates
   - Show relationship in constellation

4. **Run paradigm status**
   ```bash
   paradigm status
   ```
   - Now shows: 5 features, 12 components, 5 gates

5. **Use ripple to analyze**
   ```bash
   paradigm ripple ^authenticated
   ```
   - Shows: 4 features depend on this gate
   - "If we change auth, these break"

#### End State
```yaml
# portal.yaml with:
# - 5 gates defined
# - Proper requires chains
# - Connected to features
```

#### AI Interaction Demo
```
You: "What would break if I made ^authenticated require email verification?"
AI: [Calls paradigm_ripple, explains impact on 4 features]
```

#### Milestone Checkpoint
- [ ] `paradigm portal validate` passes
- [ ] `paradigm status` shows gates
- [ ] `paradigm ripple ^authenticated` shows dependencies

---

### Episode 4: Building with AI Context

**Video:** "Agent Efficiency Tools" (Video 4)
**Duration:** 10-12 minutes
**Goal:** Use Beacon, Thread, Ripple in a real coding session

#### Starting Point
```
Episode 3 end state + basic React/Next.js scaffolding
```

#### Steps

1. **Generate beacon**
   ```bash
   paradigm beacon
   ```
   - Show beacon.md content
   - Explain how AI uses it

2. **Start a coding session**
   ```
   You: "I want to implement the task creation feature"
   AI: [Reads beacon, knows about #task-management]
   ```

3. **AI checks impact before coding**
   ```
   AI: [Runs paradigm ripple #task-management]
   "Before I make changes, let me check what this connects to..."
   ```

4. **Implement with proper signals**
   ```typescript
   // Example implementation
   async function createTask(data: TaskInput) {
     const task = await db.tasks.create(data);
     log.signal('!task-created').info('Task created', { taskId: task.id });
     return task;
   }
   ```

5. **Track progress with thread**
   ```bash
   paradigm thread save "Implemented task creation"
   paradigm thread todo "Add validation"
   paradigm thread todo "Write tests"
   paradigm thread note "Using Zod for validation"
   ```

6. **Show thread state**
   ```bash
   paradigm thread
   ```
   - Trail shows what was done
   - Loose ends show TODOs
   - Breadcrumbs show notes

7. **End session, start new**
   - Close Cursor
   - Reopen, start new chat
   - AI reads thread, picks up where left off

#### End State
```
# Working task creation with:
# - Proper signals emitted
# - Thread tracking progress
# - AI-assisted development
```

#### AI Interaction Demo
```
Session 1:
You: "Implement task creation for #task-management"
AI: [Implements, tracks in thread]

Session 2:
You: "What was I working on?"
AI: [Reads thread] "You implemented task creation. 
     Still TODO: validation and tests."
```

#### Milestone Checkpoint
- [ ] `paradigm beacon` generates orientation file
- [ ] `paradigm thread` shows session history
- [ ] AI successfully uses context from thread

---

### Episode 5: MCP Deep Dive

**Video:** "MCP Server - Dynamic AI Context" (Video 5)
**Duration:** 12-15 minutes
**Goal:** Set up Claude Desktop with Paradigm MCP

#### Starting Point
```
Episode 4 end state
```

#### Steps

1. **Install Claude Desktop**
   - Download from claude.ai/download
   - Install and launch

2. **Configure MCP**
   ```json
   // ~/Library/Application Support/Claude/claude_desktop_config.json
   {
     "mcpServers": {
       "taskflow": {
         "command": "npx",
         "args": ["@a-company/paradigm-mcp"],
         "cwd": "/path/to/taskflow"
       }
     }
   }
   ```

3. **Restart Claude Desktop**

4. **Verify connection**
   ```
   You: "What Paradigm tools do you have?"
   Claude: "I have access to: paradigm_search, paradigm_ripple..."
   ```

5. **Live demo: Project overview**
   ```
   You: "Give me an overview of the TaskFlow project"
   Claude: [Calls paradigm_status]
   "TaskFlow has 5 features, 12 components, 5 gates..."
   ```

6. **Live demo: Impact analysis**
   ```
   You: "What would break if I removed ^authenticated?"
   Claude: [Calls paradigm_ripple]
   "Removing ^authenticated would affect 4 features: 
    #task-management, #project-organization, #admin-dashboard, #notifications"
   ```

7. **Live demo: Finding code**
   ```
   You: "Find all components related to tasks"
   Claude: [Calls paradigm_search with query="task"]
   "#TaskForm, #TaskList, #TaskCard"
   ```

8. **Compare to static context**
   - Show token usage: ~100 per query vs ~2000 upfront
   - "Only fetch what you need"

#### End State
```
# Claude Desktop connected via MCP
# Can query TaskFlow symbols dynamically
```

#### AI Interaction Demo
```
Claude: "I can see TaskFlow has:
- 5 features including #task-management and #admin-dashboard
- 5 gates with ^authenticated being the most used
- 12 components

What would you like to work on?"
```

#### Milestone Checkpoint
- [ ] Claude Desktop shows MCP tools
- [ ] `paradigm_status` returns project info
- [ ] `paradigm_ripple` shows accurate dependencies

---

### Episode 6: Visual Debugging

**Video:** "Prism - The Infinite Canvas" (Video 7)
**Duration:** 8-10 minutes
**Goal:** Use Portal Viewer and Prism to explore and debug

#### Starting Point
```
Episode 5 end state + some running code
```

#### Steps

1. **Start Portal Viewer**
   ```bash
   paradigm portal watch
   ```
   - Opens in browser
   - Shows gate topology

2. **Walk through a user journey**
   - Simulate: Login → View tasks → Create task → View project
   - Watch gates light up in real-time

3. **Find an auth bug**
   - Intentionally misconfigure: Remove ^authenticated from a feature
   - See the failure in viewer
   - "Why did this fail? Let's trace it"

4. **Fix and validate**
   - Add the gate back
   - Re-run journey
   - All gates pass

5. **Open Prism visualizer**
   ```bash
   paradigm visualize
   ```
   - Full canvas view
   - Show all symbols as nodes

6. **Explore relationships**
   - Click #task-management
   - See connections to components, gates, signals
   - Navigate to related symbols

7. **Use for planning**
   ```
   You: "I want to add task comments. What does that touch?"
   AI: [Looking at Prism] "#task-management, probably needs new
       #CommentForm component, ^task-owner or ^project-member gate"
   ```

#### End State
```
# Complete TaskFlow project with:
# - Visual authorization validation
# - Full symbol graph in Prism
# - All Paradigm features demonstrated
```

#### AI Interaction Demo
```
You: "Looking at Prism, what's the most connected feature?"
AI: "#task-management has the most connections -
     3 components, 1 gate, 3 signals, 1 flow.
     It's the core of the application."
```

#### Milestone Checkpoint
- [ ] Portal Viewer shows all gates
- [ ] Gates light up during simulated journey
- [ ] Prism shows complete symbol graph

---

## Feature Matrix

### TaskFlow Symbols by Type

| Type | Symbol | Description |
|------|--------|-------------|
| **# Component** | #task-management | Core task CRUD `[feature]` |
| | #project-organization | Project grouping `[feature]` |
| | #user-authentication | Auth system `[feature]` |
| | #admin-dashboard | Admin features `[feature]` |
| | #notifications | Alert system `[feature]` |
| **# Component** | #TaskForm | Task create/edit form |
| | #TaskList | Task list display |
| | #TaskCard | Individual task card |
| | #ProjectCard | Project display card |
| | #ProjectList | Project list |
| | #ProjectSelector | Project dropdown |
| | #LoginForm | Login form |
| | #LogoutButton | Logout button |
| | #AuthProvider | Auth context |
| | #UserManager | Admin user management |
| | #SettingsPanel | Settings UI |
| | #NotificationBell | Notification indicator |
| | #NotificationList | Notification list |
| **^ Gate** | ^public | No auth required |
| | ^authenticated | Must be logged in |
| | ^task-owner | Must own the task |
| | ^project-member | Must be in project |
| | ^admin | Must be admin |
| **! Signal** | !task-created | Task was created |
| | !task-completed | Task marked done |
| | !task-deleted | Task was deleted |
| | !project-created | Project was created |
| | !login-success | Login succeeded |
| | !login-failed | Login failed |
| | !logout | User logged out |
| | !user-banned | Admin banned user |
| | !settings-updated | Settings changed |
| | !notification-sent | Notification sent |
| | !notification-read | Notification read |
| **$ Flow** | $task-creation-flow | Create task process |
| | $auth-flow | Authentication process |
| | $project-onboarding | New project setup |

---

## Starter Repository Structure

```
taskflow-tutorial/
├── README.md                    # Tutorial index
├── episodes/
│   ├── 01-setup/
│   │   ├── START/               # Empty, just npm init
│   │   │   └── package.json
│   │   └── END/                 # After paradigm init
│   │       ├── .paradigm/
│   │       ├── .purpose
│   │       └── package.json
│   ├── 02-features/
│   │   ├── START/               # Copy of 01/END
│   │   └── END/                 # With full .purpose
│   ├── 03-authorization/
│   │   ├── START/               # Copy of 02/END
│   │   └── END/                 # With portal.yaml
│   ├── 04-building/
│   │   ├── START/               # With basic React scaffold
│   │   └── END/                 # With implementation
│   ├── 05-mcp/
│   │   ├── START/               # Copy of 04/END
│   │   ├── END/                 # MCP configured
│   │   └── claude-config.json   # Example config
│   └── 06-visual/
│       ├── START/               # Copy of 05/END
│       └── END/                 # Complete project
└── solutions/
    └── taskflow/                # Full working app
        ├── .paradigm/
        ├── .purpose
        ├── portal.yaml
        ├── src/
        └── package.json
```

---

## Teaching Moments

### Intentional Mistakes to Make

These mistakes are introduced intentionally to show how Paradigm catches issues:

#### 1. Missing Gate Reference
```yaml
# Mistake: Define ^task-owner but forget to add to feature
features:
  task-management:
    gates: [^authenticated]  # Missing ^task-owner!
```
**How Paradigm catches it:** `paradigm doctor` shows unused gate

#### 2. Circular Gate Dependency
```yaml
# Mistake: ^a requires ^b, ^b requires ^a
gates:
  a:
    requires: [^b]
  b:
    requires: [^a]  # Circular!
```
**How Paradigm catches it:** `paradigm portal validate` errors

#### 3. Orphaned Symbol
```yaml
# Mistake: Reference a feature that doesn't exist
components:
  TaskCard:
    used-by: [#old-feature]  # Doesn't exist!
```
**How Paradigm catches it:** `paradigm ripple #old-feature` shows no connections

#### 4. Stale Documentation
```
# Mistake: Change feature implementation but not .purpose
# Add new signal in code but don't document it
```
**How it manifests:** AI doesn't know about the new signal
**How to fix:** Update .purpose, run `paradigm beacon --refresh`

---

## AI Interaction Scripts

### Episode 2: Planning Features

```
You: "I'm building a task management app called TaskFlow. 
      Help me plan the features using Paradigm symbols."

AI: "Let's define the core features for TaskFlow:

1. #task-management - Core task operations (CRUD, status)
2. #project-organization - Grouping tasks into projects
3. #user-authentication - Login/logout/session
4. #admin-dashboard - Admin-only features
5. #notifications - Alerting users

Each feature should reference:
- Components it uses (#)
- Gates it requires (^)
- Signals it emits (!)

Want me to draft the .purpose file?"
```

### Episode 4: Session Continuity

```
[Session 1]
You: "Implement task creation for #task-management"

AI: "I'll implement task creation. Let me first check what 
     this connects to...
     
     [Runs paradigm ripple #task-management]

     #task-management uses #TaskForm, #TaskList, #TaskCard
     and requires ^authenticated.
     
     [Implements createTask function]
     
     I've implemented task creation with !task-created signal.
     Saving progress...
     
     [Runs paradigm thread save 'Implemented task creation']"

[Session 2 - New Chat]
You: "What was I working on?"

AI: "[Reads thread.md]
     
     Last session you implemented task creation for #task-management.
     
     Still TODO:
     - Add validation (you noted: using Zod)
     - Write tests
     
     Want to continue with validation?"
```

### Episode 5: MCP Queries

```
You: "What would happen if I removed the ^authenticated gate?"

Claude: [Calls paradigm_ripple with symbol="^authenticated"]

"Removing ^authenticated would have significant impact:

DIRECTLY AFFECTED (4 features):
- #task-management - Would become public
- #project-organization - Would become public
- #admin-dashboard - Would lose auth chain (^admin requires ^authenticated)
- #notifications - Would become public

INDIRECTLY AFFECTED (1 feature):
- #admin-dashboard via ^admin dependency

RECOMMENDATION: High impact change. If you need public task
viewing, consider creating a separate #public-tasks feature
with ^public gate instead of removing ^authenticated."
```

---

*Last Updated: 2026-01-27*
