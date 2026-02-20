# Paradigm University — Implementation Plan

> Interactive academia-themed learning platform for the Paradigm framework.
> Courses, quizzes, the PLSAT certification exam, and a reference library.

## Context

Paradigm is public but has no structured learning resources beyond raw specs and docs. The University provides an interactive web UI (following the Sentinel pattern) where anyone can learn Paradigm through courses, quizzes, and a versioned certification exam (the PLSAT). As the framework evolves, new sections get added and certificates track which PLSAT version was completed.

---

## Architecture

New package at `packages/university/` mirroring Sentinel's dual-build architecture:

- **Server**: Express serves static UI + content API endpoints (`tsup` build)
- **UI**: Vite + React + Zustand with academia theme (`vite build` -> `ui/dist/`)
- **Content**: Static JSON files bundled in `src/content/` — no database, no external deps
- **Progress**: LocalStorage-based (per-browser, no auth required)
- **CLI**: `paradigm university` command (like `paradigm sentinel`) — dynamic import, port option, auto-open

### Key Reference Files

| File | Pattern |
|------|---------|
| `packages/sentinel/src/server/index.ts` | Express + static serving + SPA fallback |
| `packages/sentinel/ui/vite.config.ts` | Vite config with API proxy |
| `packages/sentinel/tsup.config.ts` | Dual entry point build |
| `packages/paradigm/src/commands/sentinel.ts` | CLI command implementation |
| `packages/paradigm/src/index.ts` ~line 1228 | Command registration |

---

## Content Structure

### Courses (PARA 101-401)

| Course | Title | Topics |
|--------|-------|--------|
| PARA 101 | Foundations | 5 symbols (#$^!~), purpose files, tags, logger basics |
| PARA 201 | Architecture | Flows, gates, aspects with anchors, portal.yaml, disciplines |
| PARA 301 | Operations | History, wisdom, ripple analysis, doctor, sync, sentinel |
| PARA 401 | Orchestration | Multi-agent coordination, MCP tools, context handoffs, PM governance |

Each course has ~8-12 lessons. Each lesson has:
- Explanation text (markdown rendered)
- Key concepts highlighted
- 3-5 quiz questions at the end

### Quiz Types

- **Multiple choice** (A-E) — "Which symbol represents a gate?"
- **Ordering** — "Put these flow steps in the correct order"
- **Scenario** — "A developer adds a route without updating portal.yaml. What tool catches this?"
- **Code identification** — "What's wrong with this logger call?"

### The PLSAT (Paradigm Licensure Standardized Assessment Test)

- 50 questions, 45-minute timer
- Pulls from all 4 course areas (weighted: 101=20%, 201=30%, 301=25%, 401=25%)
- ABCDE multiple choice with scenario-based questions
- 80% pass threshold -> certificate generated
- **Versioned**: v2.0 (current), tracks framework version
- Certificate shows: name, score, date, PLSAT version, pass/fail

---

## File Plan

### Package Foundation

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/university/package.json` | Package config (deps: express, cors) |
| Create | `packages/university/tsup.config.ts` | Server build (2 entry points) |
| Create | `packages/university/tsconfig.json` | TypeScript config |

### Server

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/university/src/index.ts` | Barrel export |
| Create | `packages/university/src/server/index.ts` | Express app: static UI + content API |
| Create | `packages/university/src/server/routes/courses.ts` | GET /api/courses, GET /api/courses/:id |
| Create | `packages/university/src/server/routes/plsat.ts` | GET /api/plsat (exam questions) |

### Content (Static JSON)

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/university/src/content/courses/para-101.json` | Foundations course + quiz questions |
| Create | `packages/university/src/content/courses/para-201.json` | Architecture course + quiz questions |
| Create | `packages/university/src/content/courses/para-301.json` | Operations course + quiz questions |
| Create | `packages/university/src/content/courses/para-401.json` | Orchestration course + quiz questions |
| Create | `packages/university/src/content/plsat/v2.0.json` | PLSAT v2.0 exam (50 questions) |
| Create | `packages/university/src/content/reference.json` | Quick reference cards (symbols, commands, tools) |

### UI Foundation

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/university/ui/package.json` | Vite + React + Zustand deps |
| Create | `packages/university/ui/tsconfig.json` | UI TypeScript config |
| Create | `packages/university/ui/tsconfig.node.json` | Vite config TypeScript |
| Create | `packages/university/ui/vite.config.ts` | Vite config (port 3839, API proxy) |
| Create | `packages/university/ui/index.html` | HTML entry point |

### UI Source

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/university/ui/src/main.tsx` | React entry, render App |
| Create | `packages/university/ui/src/App.tsx` | Router: Home, Course, Quiz, PLSAT, Reference, Certificate |
| Create | `packages/university/ui/src/types.ts` | TypeScript types (Course, Lesson, Question, PLSATResult, Certificate) |

### UI Styles

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/university/ui/src/styles/academia.css` | Academia theme |

### UI Views

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/university/ui/src/views/HomeView.tsx` | Campus landing: course catalog, progress overview, university seal |
| Create | `packages/university/ui/src/views/CourseView.tsx` | Lesson reader with sidebar nav, markdown rendering |
| Create | `packages/university/ui/src/views/QuizView.tsx` | Per-lesson quiz with immediate feedback |
| Create | `packages/university/ui/src/views/PLSATView.tsx` | Timed exam: 50 questions, countdown, submit, results |
| Create | `packages/university/ui/src/views/ReferenceView.tsx` | Quick reference cards (symbols, commands, MCP tools) |
| Create | `packages/university/ui/src/views/CertificateView.tsx` | Printable PLSAT certificate with seal, version, score |

### UI Components

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/university/ui/src/components/Header.tsx` | Nav bar with university crest, nav links |
| Create | `packages/university/ui/src/components/QuestionCard.tsx` | ABCDE question rendering with explanation reveal |
| Create | `packages/university/ui/src/components/ProgressRing.tsx` | Circular progress indicator for courses |
| Create | `packages/university/ui/src/components/Timer.tsx` | PLSAT countdown timer (45 min) |
| Create | `packages/university/ui/src/components/Seal.tsx` | SVG university seal: "Universitas Paradigmatica -- Lux in Codice" |

### UI State

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/university/ui/src/store/progressStore.ts` | LocalStorage: completed lessons, quiz scores, course progress |
| Create | `packages/university/ui/src/store/plsatStore.ts` | LocalStorage: PLSAT attempts, certificates (name, score, version, date) |
| Create | `packages/university/ui/src/store/coursesStore.ts` | Fetched course data from API |

### CLI Integration

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/paradigm/src/commands/university.ts` | CLI command implementation (mirrors sentinel.ts) |
| Modify | `packages/paradigm/src/index.ts` | Register `paradigm university` command (~line 1236, after sentinel) |

**Total: ~35 new files, 1 modified file.**

---

## Content Schema

### Course JSON

```json
{
  "id": "para-101",
  "title": "PARA 101: Foundations",
  "description": "The building blocks of Paradigm",
  "lessons": [
    {
      "id": "symbols-intro",
      "title": "The Five Symbols",
      "content": "## Markdown content...",
      "keyConcepts": ["#component", "$flow", "^gate", "!signal", "~aspect"],
      "quiz": [
        {
          "id": "q1",
          "question": "Which symbol represents an authorization checkpoint?",
          "choices": { "A": "#", "B": "$", "C": "^", "D": "!", "E": "~" },
          "correct": "C",
          "explanation": "^ (caret) represents a gate — an authorization checkpoint that must be passed before accessing protected resources."
        }
      ]
    }
  ]
}
```

### PLSAT JSON

```json
{
  "version": "2.0",
  "frameworkVersion": "2.0",
  "timeLimit": 2700,
  "passThreshold": 0.8,
  "questions": [
    {
      "id": "plsat-001",
      "course": "para-101",
      "scenario": "A developer adds a new Express route POST /api/payments that requires the user to be logged in and have admin privileges.",
      "question": "What should be done FIRST?",
      "choices": {
        "A": "Write the route handler",
        "B": "Call paradigm_gates_for_route to get gate suggestions",
        "C": "Update the README",
        "D": "Create a new .purpose file",
        "E": "Run paradigm doctor"
      },
      "correct": "B",
      "explanation": "Before implementing any protected endpoint, call paradigm_gates_for_route to get suggested gates. This ensures the route is properly gated in portal.yaml before any code is written."
    }
  ]
}
```

### Certificate (LocalStorage)

```json
{
  "name": "Student Name",
  "score": 43,
  "total": 50,
  "percentage": 86,
  "passed": true,
  "plsatVersion": "2.0",
  "frameworkVersion": "2.0",
  "date": "2026-02-07T00:00:00Z"
}
```

---

## Academia Theme

- **Font**: Crimson Pro (serif, Google Fonts) for headings, Inter for body
- **Colors**:
  - Parchment background: `#F5F1E8`
  - Burgundy primary: `#6B1C23`
  - Gold accent: `#C5A572`
  - Ink text: `#2C1810`
  - Cream cards: `#FDF8F0`
- **University Seal**: SVG circle with laurel wreath, open book icon, "Universitas Paradigmatica" outer ring, "Lux in Codice" ribbon (motto: "Light in Code")
- **Decorative**: Subtle parchment texture, gold dividers, serif chapter numbers
- **Certificate**: Formal layout with seal watermark, ornate border, signature line

---

## Execution Phases

### Phase 1: Package Foundation
Create `packages/university/` with package.json, tsup.config, tsconfig. Establish server entry point with Express + static serving + SPA fallback (copy Sentinel pattern).

### Phase 2: Content Authoring
Write all 4 course JSON files (PARA 101-401) with lessons and per-lesson quiz questions. Write PLSAT v2.0 exam (50 questions). Write reference cards JSON.

### Phase 3: Server Routes
Content API routes: GET /api/courses, GET /api/courses/:id, GET /api/plsat, GET /api/reference.

### Phase 4: UI Foundation
Vite setup, React entry, App with React Router, types, academia CSS theme.

### Phase 5: Core Views
HomeView (campus landing), CourseView (lesson reader), ReferenceView (quick ref cards).

### Phase 6: Quiz & PLSAT
QuizView (per-lesson), PLSATView (timed exam), QuestionCard component, Timer component, progress/plsat stores.

### Phase 7: Certificate & Polish
CertificateView (printable), Seal SVG, ProgressRing, Header nav. Final styling pass.

### Phase 8: CLI Integration + Build
Create `packages/paradigm/src/commands/university.ts`, register in index.ts, build both server and UI, verify end-to-end.

---

## Versioning Strategy

The PLSAT is versioned alongside the framework:

| Framework Version | PLSAT Version | Changes |
|-------------------|---------------|---------|
| v2.0 | v2.0 | Initial: 50 questions covering symbols, flows, gates, MCP, orchestration |
| v2.1+ | v2.1+ | New sections added as framework grows; old certificates remain valid for their version |

Certificates display both the PLSAT version and the framework version at time of completion. Users can retake the PLSAT when new versions are released.

---

## Verification

```bash
# Build
cd packages/university && npm run build:core && npm run build:ui

# Test server standalone
node packages/university/dist/server/index.js

# Test via CLI
paradigm university --port 3839

# Verify in browser:
# - Home page shows course catalog with progress rings
# - Each course has navigable lessons with markdown content
# - Per-lesson quizzes work with ABCDE choices and explanations
# - PLSAT exam has 45-min timer, 50 questions, score calculation
# - Certificate generates on 80%+ pass with version tracking
# - Reference cards show symbols, commands, MCP tools
# - All LocalStorage persistence works across page reloads
# - Academia theme renders correctly (serif fonts, parchment, seal)

# Build from root
npm run build
```
