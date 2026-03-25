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
- [~] Purpose Files — 56 files, good structure. **Fix:** mixed v1/v2 versions, no migration guidance
- [~] Portal — only 1 gate defined. **Fix:** eat our own cooking — define gates for MCP server, platform server, university API routes
- [x] Scan & Index — robust auto-generation, integrity checking, aspect graph materialization
- [ ] Ripple Analysis — **Fix:** no standalone MCP tool (buried in preflight, 2-hop hardcoded). Extract to real tool with configurable depth + aspect graph BFS
- [~] Drift Detection — two-layer detection works. **Fix:** document auto-heal confidence threshold

## 2. Agent System
- [ ] 54 Agent Profiles (quality, consistency, behavior specificity)
- [ ] Per-Project Rosters (roster.yaml, activation UX)
- [ ] Notebooks (global quality, project-scoped bootstrapping)
- [ ] Agent State (persistence, resume accuracy)
- [ ] Model Tier Resolution (config, environment detection)
- [ ] Expertise Tracking (confidence scoring, decay, accuracy)

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
