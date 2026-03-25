# Paradigm Polish Checklist

> v5.14.0 — Entered polish phase. Core features working, gaining external awareness.
> Go section by section. For each: assess current state, identify rough edges, fix them.

## Status Key
- [ ] Not started
- [~] In progress
- [x] Polished

---

## 1. Core Framework
- [x] Symbol System — 515+ symbols, strict validation, no issues
- [x] Purpose Files — 57 files, all v2.0.0. Migration docs at .paradigm/docs/purpose-migration.md
- [x] Portal — 4 gates, 94 routes across 3 portal.yaml files (root, university, sentinel)
- [x] Scan & Index — robust auto-generation, integrity checking, aspect graph materialization
- [x] Ripple Analysis — standalone paradigm_ripple MCP tool, BFS with configurable depth (1-5), core tier
- [x] Drift Detection — three-layer resolution documented, thresholds in config.yaml (0.85 auto, 0.7 suggest)

## 2. Agent System
- [x] 54 Agent Profiles — All have nicknames, builder enriched (36→115 lines), behaviors concrete
- [x] Per-Project Rosters — CLI: `paradigm agents roster` (show/init/add/remove), --json support
- [x] Notebooks — Wired into orchestration execute + prompt (top 5 by concept relevance). 272 global + 29 project entries now surfaced.
- [~] Agent State — Tracked and injected, working. Future: staleness handling could be stronger
- [x] Model Tier Resolution — All 54 agents in AGENT_TIERS (was 21/54). 9 opus, 23 sonnet, 22 haiku
- [x] Expertise Tracking — Confidence decay implemented (60-day half-life, 7-day grace). EMA + verdicts working. "(aging)" tag on stale entries

## 3. Orchestration (Maestro)
- [ ] Multi-Agent Orchestration (plan quality, stage composition)
- [ ] ToolRegistry (tiered loading, feature detection caching)
- [ ] Collaboration Graph (pairs_well_with effectiveness)
- [ ] Documentor (always-last enforcement, coverage)
- [ ] Symphony Visibility (live thread rendering)

## 4. Ambient Learning
- [ ] Nomination Engine (scoring, threshold tuning)
- [ ] Teacher Model (journal quality, promotion accuracy)
- [ ] Journal → Notebook Pipeline (promotion criteria, dedup)
- [ ] Stale Expiry (7-day pending, confidence decay)

## 5. Enforcement
- [ ] Habits (seed habits, custom habits, graduation tiers)
- [ ] Stop Hook (blocking accuracy, false positive rate)
- [ ] Pre-commit Hook (index rebuild reliability)
- [ ] Post-write Hook (advisory quality, event batching)
- [ ] Compliance Check (single-process consolidation, speed)

## 6. Conductor (Native macOS)
- [ ] Overlay Panel (layout, visual hierarchy)
- [ ] Container Mode (tiling, grid presets, persistence)
- [ ] Session Manager (project discovery, checkpoint resume)
- [ ] ConductorTheme (token coverage, view adoption)
- [ ] ConductorEnvironment (all views migrated)
- [ ] Accessibility (labels, VoiceOver, minimum font sizes)
- [ ] Multimodal Input (vision, gesture, voice stability)
- [ ] Task Protocol (dashboard, health, lifecycle)
- [ ] Symphony Live (thread rendering, agent identity)

## 7. Platform UI (Web)
- [ ] Overview Section (stats accuracy, real-time)
- [ ] Lore Section (thread view, detail panel, search)
- [ ] Graph Section (auto-layout, symbol visualization)
- [ ] Canvas Section (Craft.js, Sprint 0 status)
- [ ] Git Section (diff viewer, commit log, file tree)
- [ ] Sentinel Section (live events, pattern display)
- [ ] University Section (currently "Coming Soon" — wire up)
- [ ] Symphony Section (thread sidebar, polling efficiency)
- [ ] Docs Section (symbol search, page rendering)
- [ ] Ambient Section (nominations, events, stats)
- [ ] Team Section (roster, orchestration, messages)
- [ ] Command Palette (search quality, extensibility)
- [ ] Shared Components (StatCard, Badge, EmptyState adoption)
- [ ] CSS Tokens (full migration, light mode coverage)
- [ ] Error Handling (boundaries, store error surfacing)
- [ ] Data Fetching (AbortController, cache, dedup)

## 8. Symphony
- [ ] Inter-Agent Messaging (reliability, delivery guarantees)
- [ ] File Requests (approve/deny UX, security)
- [ ] Thread Management (resolve, decision tracking)
- [ ] Cross-Machine Relay (stability, auth)

## 9. Sentinel (Observability)
- [ ] Semantic Error Patterns (pattern quality, confidence)
- [ ] Adapters (Express, Fastify, Hono coverage)
- [ ] Web Dashboard (UI polish, usability)
- [ ] Live View (Conductor integration, latency)
- [ ] Triage (resolution suggestions, accuracy)

## 10. University
- [ ] Course Content (accuracy vs current Paradigm version)
- [ ] PLSAT Certification (exam quality, scoring)
- [ ] Quiz System (question quality, explanations)
- [ ] University UI (wire into Platform, not "Coming Soon")
- [ ] Diploma Tracking (completion flow, display)

## 11. CLI
- [ ] Command Discovery (help output, grouping, quickstart)
- [ ] explain-files (completeness, formatting)
- [ ] compliance-check (speed, output quality)
- [ ] shift (project setup flow, roster suggestion)
- [ ] cli-output Convention (adoption across commands)
- [ ] Error Messages (recovery suggestions, consistency)
- [ ] Startup Performance (lazy loading coverage)

## 12. Plugin (Claude Code)
- [ ] 18 Skills (accuracy, instruction quality)
- [ ] 3 Hooks (reliability, false positive rate)
- [ ] 6 Core Agents (profile quality, prompt effectiveness)
- [ ] Version Tracking (plugin.json sync, content hash)

## 13. Personas
- [ ] MCP Tools (11 tools, usability)
- [ ] Persona Definitions (journey quality, gate coverage)
- [ ] Coverage Analysis (accuracy, reporting)

## 14. Lore
- [ ] Record / Search / Assess (UX, performance)
- [ ] Timeline (chronological accuracy, arc tracking)
- [ ] Confidence Calibration (scoring, review flow)

## 15. Wisdom
- [ ] Decision Records (capture quality, retrieval)
- [ ] Antipatterns (usefulness, context)
- [ ] Expert Context (injection accuracy, relevance)

## 16. Workspaces
- [ ] Multi-Project Support (stability, cross-project refs)

## 17. Documentation & Onboarding
- [ ] CLAUDE.md (accuracy, completeness)
- [ ] AGENTS.md (agent definitions, sync with profiles)
- [ ] README.md (first impression, getting started)
- [ ] docs/specs/ (up to date with shipped features)
- [ ] nevr.land agent-architecture.md (current with latest)

## 18. Build & Release
- [ ] npm Publishing (3 packages, version rules)
- [ ] Plugin Deployment (push = update, version sync)
- [ ] Conductor Binary (swift build, distribution)
- [ ] CHANGELOG (complete, accurate)
- [ ] CI/CD (none yet — should there be?)

---

## Notes

_Use this space for cross-cutting observations as we go through each section._
