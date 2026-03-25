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
- [x] Multi-Agent Orchestration — Mode config wired in (was hardcoded faceted). Classification drives agent selection.
- [x] ToolRegistry — Feature detection cached (5-min TTL). Tier ambiguity fixed (graph/heatmap→feature, conductor/platform/pipeline→advanced).
- [x] Collaboration Graph — handoff_to wired into planning via topological sort. Collaboration boost in agent suggestion. Graph shown in plan output.
- [x] Documentor — Skipped for analysis tasks and no-code plans. Always-last for code tasks. Saves 2-8k tokens.
- [x] Symphony Visibility — Already polished. Full integration, event bridge, structured threads.

## 4. Ambient Learning
- [x] Nomination Engine — 4-dimension scoring, stale JSONL pruning on write (>100 entries), configurable TTL
- [x] Teacher Model — Automated postflight: verdicts → journals (accepted→human_feedback, dismissed→confidence_miss, revised→correction_received). Wired into stop hook via --learn flag.
- [x] Journal → Notebook Pipeline — human_feedback now promotable alongside pattern_discovered. Pipeline solid.
- [x] Stale Expiry — Configurable TTL in config.yaml (nomination-ttl-days: 7, debate-ttl-days: 14). File pruning implemented.

## 5. Enforcement
- [x] Habits — 16 seed habits, graduation system, 12 check types, 30s cache. Solid.
- [x] Stop Hook — Fixed 3 false positive sources: route detection skips comments/tests, source counting is directory-aware, freshness has git mtime fallback
- [x] Pre-commit Hook — Simple, never blocks, auto-stages indexes. Solid.
- [x] Post-write Hook — Legacy afterFileEdit gutted to no-op. postToolUse is sole tracking hook now.
- [x] Compliance Check — Consolidated, --learn flag, structured violations with file/source/severity

## 6. Conductor (Native macOS)
- [x] Overlay Panel — 4 collapsible DisclosureGroup regions (Input, Sessions, Team, Monitoring)
- [x] Container Mode — Grid preset persists via @AppStorage. 6 presets working.
- [x] Session Manager — Discovery + checkpoint resume solid. projectCard still a function (minor).
- [x] ConductorTheme — ~100% adoption across 25 views. 8 semantic tokens + font constants.
- [x] ConductorEnvironment — MainOverlayView + ContainerView migrated. Both use @EnvironmentObject.
- [x] Accessibility — 17+ labels added across 14 views. Zero sub-8pt fonts. All status dots labeled.
- [~] Multimodal Input — Architecture solid, @MainActor safe. Event prioritization unclear (minor).
- [x] Task Protocol — Kanban layout, lifecycle complete, health monitoring. No changes needed.
- [x] Symphony Live — Agent colors deterministic (Unicode scalar sum). Thread rendering polished.

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
