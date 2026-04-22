---
id: N-para-701-per-project-rosters
title: 'Lesson 5: Per-Project Rosters'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-701
  - rosteryaml-at-paradigmrosteryaml
  - no-rosteryaml-
  - project-type-detection
symbols: []
difficulty: beginner
estimatedMinutes: 6
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## The Problem: 54 Agents Everywhere

Without project-level rosters, all 54 global agents are available to every project. This creates three problems:

1. **Noise** — The orchestrator considers 54 agents when planning, even though a backend API project does not need a designer, copywriter, or SEO agent. More candidates means more evaluation time and potentially irrelevant agents being included in plans.

2. **Irrelevance** — Agents that have no domain expertise for the project (gamedev on a SaaS app, legal on an open-source tool) waste attention by scoring events and producing nominations that will never be acted on.

3. **Global benching is broken** — Before rosters, benching an agent (setting `benched: true` on the `.agent` file) was a global operation. Benching the gamedev agent for your SaaS project also benched it for your game project. There was no per-project control.

## The Solution: roster.yaml

The `roster.yaml` file at `.paradigm/roster.yaml` lists exactly which agents are active on this project:

```yaml
# .paradigm/roster.yaml
version: "1.0"
project: dealoracle
type: saas-web-app

active:
  - architect
  - builder
  - reviewer
  - tester
  - security
  - documentor
  - designer          # Mika
  - copywriter         # Wren
  - performance        # Bolt
  - devops             # Atlas
  - dba                # Vault
  - e2e                # Ghost
  - dx                 # Helix
  - seo                # Beacon
  - pm                 # Yuki
  - product            # North
  - advocate           # Jinx
  - debugger           # Trace
  - release            # Ship
```

Agents not listed are not active on this project. They still exist globally at `~/.paradigm/agents/` but the orchestrator will not consider them when planning work for this project.

## Backward Compatibility

The key design decision: **no roster.yaml = all agents available**. Existing projects that never created a roster continue working exactly as before. The `isAgentActive()` function implements this:

```typescript
function isAgentActive(agentId: string, rootDir: string): boolean {
  const roster = loadProjectRoster(rootDir);
  if (!roster) return true;  // No roster = all active
  return roster.includes(agentId);
}
```

This ensures zero breaking changes. You opt into roster filtering by creating the file. Until then, the system behaves as it always has.

## Project Type Detection

When running `paradigm shift` (the project initialization command), the system auto-detects the project type from filesystem signals:

```typescript
function detectProjectType(cwd: string): ProjectType {
  const signals = {
    hasPackageJson: exists('package.json'),
    hasSupabase: exists('supabase/'),
    hasNextConfig: exists('next.config.*'),
    hasSwiftPackage: exists('Package.swift'),
    hasGodotProject: exists('project.godot'),
    hasCargoToml: exists('Cargo.toml'),
    hasPubspecYaml: exists('pubspec.yaml'),
    hasPrisma: exists('prisma/'),
    hasDockerfile: exists('Dockerfile'),
  };

  if (signals.hasGodotProject) return 'game';
  if (signals.hasSwiftPackage) return 'ios-app';
  if (signals.hasPubspecYaml) return 'flutter-app';
  if (signals.hasSupabase && signals.hasNextConfig) return 'saas-web-app';
  if (signals.hasNextConfig) return 'web-app';
  if (signals.hasCargoToml) return 'rust-project';
  if (signals.hasPrisma || signals.hasDockerfile) return 'backend-api';
  return 'generic';
}
```

Detected types include `saas-web-app`, `web-app`, `backend-api`, `ios-app`, `flutter-app`, `game`, `rust-project`, and `generic`. Each type maps to a suggested roster.

## Suggested Rosters by Type

Each project type has a pre-defined suggested roster. These are starting points, not mandatory configurations:

| Project Type | Typical Size | Notable Inclusions | Notable Exclusions |
|---|---|---|---|
| saas-web-app | ~24 agents | Full stack: designer, dba, seo, sales, legal | gamedev, 3d, audio, streaming |
| web-app | ~15 agents | Frontend-focused: designer, seo, a11y | dba, sales, legal |
| backend-api | ~13 agents | Backend-focused: dba, dx, performance | designer, copywriter, seo |
| ios-app | ~12 agents | Mobile: mobile (Swift), a11y, performance | dba, seo, devops |
| game | ~11 agents | Game-specific: gamedev, 3d, audio | seo, legal, sales, dba |
| flutter-app | ~11 agents | Cross-platform: mobile, a11y | dba, seo, devops |
| generic | ~8 agents | Core only: architect through documentor + debugger + qa | All specialists |

The `generic` roster is intentionally minimal: architect, builder, reviewer, tester, security, documentor, debugger, and qa. These 8 agents provide the baseline quality coverage (design, build, review, test, secure, document, debug, validate) that every project needs.

## CLI Commands for Roster Management

Roster management is done through the CLI:

```bash
# Interactive roster setup (suggests based on project type)
paradigm agents roster

# Activate specific agents
paradigm agents activate designer copywriter security devops dba

# Deactivate agents
paradigm agents deactivate gamedev 3d audio streaming

# List active agents for this project
paradigm agents list              # Shows only active roster
paradigm agents list --all        # Shows all global + active status

# Activate a pod (all agents in the pod)
paradigm agents activate --pod ship-pod
```

Activate and deactivate modify the `roster.yaml` file — they never modify global `.agent` files. This is the key architectural decision: the roster is a project-level filter over global agents. Agents are not "installed" or "removed" per project; they are "active" or "inactive" based on whether they appear in the roster.

## Orchestrator Integration

The orchestrator's planning phase reads the roster before selecting agents:

```typescript
function getActiveAgents(rootDir: string): string[] {
  const rosterPath = path.join(rootDir, '.paradigm', 'roster.yaml');
  if (fs.existsSync(rosterPath)) {
    const roster = yaml.load(fs.readFileSync(rosterPath, 'utf8'));
    return roster.active || [];
  }
  // Fallback: all global agents (backward compat)
  return getAllGlobalAgents().map(a => a.id);
}
```

The returned list gates which agents are considered during orchestration planning. If the security agent is not in the roster, it will not be included in orchestration plans, will not receive event notifications, and will not self-nominate contributions. It is effectively invisible on this project.

## paradigm shift Integration

During `paradigm shift` (first-time project setup), the roster step runs after team initialization:

```
Step 2b/6: Agent roster setup...

  Detected project type: SaaS web app (React + Supabase + Vercel)

  Suggested roster (20 agents):
    Core:       architect, builder, reviewer, tester, security, documentor
    Design:     designer (Mika), copywriter (Wren), a11y (Aria)
    Data:       dba (Vault), performance (Bolt), analyst (Sage)
    Infra:      devops (Atlas), seo (Beacon), release (Ship)
    Product:    pm (Yuki), product (North)
    Quality:    e2e (Ghost), qa (Shield), advocate (Jinx)

  Accept suggested roster? [Y/n]

  Roster saved to .paradigm/roster.yaml (20 agents active)
```

The human can accept the suggestion, modify it, or skip (which creates no roster file, keeping all agents active). On existing projects, running `paradigm shift` again offers to create a roster based on the detected type.

## Why Rosters Are Not Agent Behavior

Rosters are a filtering mechanism, not a behavior modifier. An agent's `.agent` file defines who it is (personality, expertise, behaviors, attention). The roster defines whether it is active on this project. If the designer is not in the roster, it does not mean the designer "knows" it is inactive — it simply is not invoked.

This separation is important: when you activate the designer on a project, it arrives with its full personality, expertise, notebooks, and transferable patterns intact. Nothing about the agent changed. The roster just opened the door.
