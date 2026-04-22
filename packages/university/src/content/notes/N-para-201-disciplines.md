---
id: N-para-201-disciplines
title: Disciplines
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-201
  - disciplines-define-how
  - 14-disciplines-web
  - auto-detection-at-init
symbols: []
difficulty: beginner
estimatedMinutes: 7
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-201.json
---

## How Symbols Map Across Domains

A Paradigm `discipline` defines how directory patterns and code structures map to symbol types in a specific development domain. A web frontend project organizes code differently from a backend API, which differs from a CLI tool. Disciplines capture these differences so that tooling — the navigator, the logging conventions, gate recommendations, and auto-scan — works correctly regardless of your tech stack.

## Auto-Detection

When you run `paradigm shift` or `paradigm init`, Paradigm automatically detects the discipline from your project structure. It examines `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, and other project markers to infer the best match. The detected discipline is written to `.paradigm/config.yaml`:

```yaml
discipline: fullstack    # auto-detected from Next.js in package.json
```

Detection heuristics include: monorepo markers (workspaces), framework deps (Next.js → fullstack, React alone → web, Express alone → api), Python ML deps (PyTorch → ml), Rust crate deps (clap → cli, axum → api, bevy → game), and more. You can always override the detected value.

## The 14 Disciplines

Paradigm supports 14 disciplines, each with tailored symbol mappings, purpose-required paths, and scan patterns:

| Discipline | When to Use | Key Directories |
|------------|-------------|------------------|
| `web` | Frontend-only (React, Vue, Svelte) | `components/`, `pages/`, `hooks/`, `stores/` |
| `backend` | General backend (fallback) | `services/`, `routes/`, `models/` |
| `fullstack` | SSR or combined frontend+backend (Next.js, Django) | `components/`, `pages/`, `api/`, `services/` |
| `api` | API-only (Express, FastAPI, Gin) | `routes/`, `endpoints/`, `controllers/` |
| `cli` | CLI tools (Node bin, Click, clap) | `commands/`, `cmd/` |
| `ml` | Machine learning (PyTorch, TF, scikit-learn) | `models/`, `experiments/`, `pipelines/` |
| `mobile` | Mobile apps (React Native, Flutter) | `screens/`, `widgets/`, `navigation/` |
| `game` | Game dev (Bevy, Godot, Unity) | `gameplay/`, `entities/`, `systems/` |
| `embedded` | Embedded/IoT (embedded-hal, PlatformIO) | `drivers/`, `hal/`, `protocols/` |
| `devops` | Infrastructure (Terraform, Ansible) | `modules/`, `pipelines/`, `scripts/` |
| `data` | Data engineering (dbt, Airflow, Spark) | `models/`, `dags/`, `transforms/` |
| `library` | Reusable packages (npm, PyPI, crates) | `src/`, `lib/` |
| `monorepo` | Multi-package repos (workspaces, Nx) | `packages/`, `apps/`, `libs/` |
| `custom` | User-defined mappings | Whatever you configure |

## Web Discipline

In a web project, the primary units are routes, components, and pages:

| Directory | Symbol | Rationale |
|-----------|--------|-----------|
| `routes/`, `pages/`, `views/` | `#` component | User-facing entry points |
| `components/` | `#` component | Reusable UI elements |
| `hooks/` | `#` component | Shared logic (hooks are code units, not signals) |
| `stores/`, `state/` | `#` component (tag: `[state]`) | Client-side state |
| `middleware/` | `^` gate | Route guards and auth checks |
| `api/` | `#` component | API client wrappers |

An important distinction: **hooks are components, not signals**. A frontend hook like `useAuth` encapsulates logic — it is `#useAuth`, a component. The `!` signal prefix is reserved for events that trigger decoupled side effects.

## Backend / API Discipline

In a backend or API project, the primary units are services, controllers, and models:

| Directory | Symbol | Rationale |
|-----------|--------|-----------|
| `services/` | `#` component | Business logic |
| `controllers/`, `handlers/` | `#` component | Request handlers |
| `models/`, `entities/` | `#` component (tag: `[state]`) | Data models |
| `middleware/`, `guards/` | `^` gate | Auth and validation |
| `events/`, `listeners/` | `!` signal | Event emitters and handlers |
| `jobs/`, `workers/` | `#` component | Background processing |
| `integrations/`, `clients/` | `#` component (tag: `[integration]`) | External service wrappers |

The `api` discipline is like `backend` but focused on HTTP endpoints (adds `endpoints/`, `controllers/`, `webhooks/`).

## Fullstack Discipline

The fullstack discipline combines both mappings. Paradigm determines which mapping to use based on the directory path:

```
src/
  client/     → Web discipline mappings apply
  server/     → Backend discipline mappings apply
  shared/     → Common mappings (# for all code units)
```

Auto-detected for SSR frameworks like Next.js, Nuxt, SvelteKit, or when both React and Express are present.

## Domain-Specific Disciplines

**ML**: Scans `models/`, `experiments/`, `notebooks/`. Pipelines map to `$` flows. Training events map to `!` signals.

**Data**: Scans `dbt/`, `dags/`, `transforms/`. ETL pipelines are `$` flows. Data quality checks are `!` signals.

**Game**: Scans `gameplay/`, `entities/`, `systems/`. Game loops are `$` flows. Game events are `!` signals.

**Embedded**: Scans `drivers/`, `hal/`, `protocols/`. State machines are `$` flows. Interrupts are `!` signals.

## Why Disciplines Matter

Disciplines affect four things:

1. **Symbol mappings** — Each discipline populates the `logging.symbol-mapping` section in config.yaml with directory-to-symbol mappings appropriate for your domain.
2. **Navigator generation** — `paradigm scan` uses the discipline to categorize directories and suggest symbol types for undocumented code.
3. **Gate recommendations** — `paradigm_gates_for_route` uses the discipline to understand which routes exist and what patterns apply.
4. **Auto-scan patterns** — `paradigm scan --auto` adds discipline-specific file patterns (e.g., ML scans `.ipynb` notebooks, game scans `.gd` scripts).

With auto-detection, most projects get the right discipline without any manual configuration.

## Custom Mappings

If your project does not fit a standard discipline, you can override mappings in `config.yaml`:

```yaml
discipline: backend
custom-mappings:
  "workers/": "#"       # Override default if needed
  "policies/": "^"      # Treat policies as gates
  "sagas/": "$"         # Treat sagas as flows
```

Custom mappings extend (not replace) the discipline defaults. Or set `discipline: custom` and define everything yourself.

## Stack Presets

Disciplines tell Paradigm *what kind* of project you have (web, backend, mobile). Stack presets go one level deeper — they tell Paradigm *which framework* you are using. A stack preset layers framework-specific configuration on top of the discipline.

Paradigm ships 16 stack presets:

| Preset | Discipline | What It Adds |
|--------|------------|-------------|
| `nextjs` | fullstack | `app/` routes, server actions, RSC patterns |
| `remix` | fullstack | loader/action patterns, nested routes |
| `sveltekit` | fullstack | `+page.svelte`, `+server.ts` patterns |
| `nuxt` | fullstack | `composables/`, auto-imports |
| `react-spa` | web | CRA/Vite SPA patterns, `hooks/`, `contexts/` |
| `vue-spa` | web | Composition API, Pinia stores |
| `express` | api | `app.get/post`, middleware chains |
| `fastapi` | api | `@app.get`, Pydantic models, dependency injection |
| `django` | fullstack | `views.py`, `models.py`, `urls.py` |
| `flask` | api | `@app.route`, blueprints |
| `gin-go` | api | `r.GET`, handler groups |
| `axum-rs` | api | Axum extractors, tower middleware |
| `swift-ios` | mobile | SwiftUI views, `@Observable`, navigation |
| `kotlin-android` | mobile | Jetpack Compose, ViewModels, Hilt |
| `react-native` | mobile | Expo/bare RN, navigation, native modules |
| `flutter` | mobile | Widgets, BLoC/Riverpod, platform channels |

Stack presets are auto-detected during `paradigm init` from your dependencies and project files. You can also specify one explicitly:

```bash
paradigm init --stack nextjs
```

The detected stack is written to config.yaml:

```yaml
discipline: fullstack
stack: nextjs
```

Stack presets add three things on top of the discipline:
1. **Refined symbol mappings** — Framework-specific directories (e.g., `app/api/` for Next.js route handlers)
2. **Purpose-required paths** — Directories that should have `.purpose` files for the framework to work well with Paradigm
3. **Scan hints** — Framework-specific patterns for component detection, route patterns, auth patterns, and state management

To see all available presets:

```bash
paradigm presets
paradigm presets --discipline mobile   # Filter by discipline
```

Stack presets solve the cold-start problem: when you run `paradigm init` on an existing Next.js project, the preset knows to look for `app/` routes, server components, and API handlers — producing meaningful `.purpose` scaffolding instead of generic stubs.
