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
- [x] Overview Section — Stats auto-refresh every 15s, skips when hidden
- [x] Lore Section — DetailPanel decomposed (358→52 lines, 5 sub-components). Thread/search solid.
- [~] Graph Section — Symbol visualization works. Auto-layout missing (nice-to-have).
- [x] Canvas Section — Working. Hardcoded colors replaced with tokens.
- [x] Git Section — Solid. No issues found.
- [x] Sentinel Section — Solid. Color maps replaced with CSS tokens (3 tabs).
- [~] University Section — Still "Coming Soon" — no platform server API routes exist. Needs backend first.
- [x] Symphony Section — Solid. Polling efficient with conditional tabs.
- [x] Docs Section — Solid. Search + multi-type page rendering.
- [x] Ambient Section — Using shared StatCard. SSE + polling. Visibility-aware.
- [x] Team Section — 17 hardcoded colors replaced. Visibility-aware polling.
- [x] Command Palette — Cmd+K, search, arrow nav, number shortcuts.
- [x] Shared Components — StatCard adopted in Overview + Ambient. Badge + EmptyState created.
- [x] CSS Tokens — 60+ hex colors replaced. 12 new accent tokens + 5 graph node tokens. Light mode works.
- [x] Error Handling — ErrorBoundary per section. Store errors caught (not yet surfaced to UI).
- [x] Data Fetching — 23 AbortControllers across 7 stores. Section-visibility polling.

## 8. Symphony
- [x] Inter-Agent Messaging — Guaranteed delivery via ack tracking, JSONL persistence, dedup set
- [x] File Requests — Approve/deny/redact. Hard-deny patterns (.env, *.key) enforced
- [x] Thread Management — Full resolution with decision extraction, participant tracking
- [x] Cross-Machine Relay — HMAC auth, exponential backoff, keepalive. Cross-network guides documented (Tailscale/ngrok/SSH)

## 9. Sentinel (Observability)
- [x] Semantic Error Patterns — Confidence scoring, source tracking, resolution strategies
- [x] Adapters — Express, Fastify, Hono all clean
- [x] Web Dashboard — Comprehensive routes for incidents, patterns, symbols, logs, metrics, traces
- [x] Live View — Conductor integration via WebSocket
- [x] Triage — AI-powered pattern suggestions, symbol filtering, resolution context

## 10. University
- [x] Course Content — 7 courses (PARA 101-701) accurate with v5.x. Scenario-based quizzes.
- [x] PLSAT Certification — Complete. 99 questions, 90 minutes, 90% threshold (fixed this session).
- [x] Quiz System — Multi-choice with explanations. Deep questions in PARA 701.
- [~] University UI — Still "Coming Soon" in Platform. No platform server API routes exist. Needs backend.
- [x] Diploma Tracking — Completion and certification records working.

## 11. CLI
- [x] Command Discovery — 230 commands, clear descriptions. explain-files added this session.
- [x] explain-files — Categorized config file guide with existence checks
- [x] compliance-check — Single-process, --learn flag, structured violations
- [x] shift — Project setup with roster suggestion, model resolution
- [x] cli-output Convention — Helpers created, 3 commands converted as examples
- [~] Error Messages — Present but could suggest fixes more often (e.g., "Run paradigm init"). Minor.
- [x] Startup Performance — All commands lazy-loaded. treeshake + minify enabled.

## 12. Plugin (Claude Code)
- [x] 18 Skills — All accurate and production-ready. Clear step-by-step instructions.
- [x] 3 Hooks — Stop (blocking), pre-commit (advisory), post-write (advisory). Legacy hook gutted.
- [x] 6 Core Agents — Current with nicknames (Apex, Kit, Judge, Aegis, Probe, Scribe).
- [x] Version Tracking — plugin.json synced at 5.21.0. Content hash in place.

## 13. Personas
- [x] MCP Tools — 11 tools, Sentinel integration, dry-run mode
- [x] Persona Definitions — Stored in YAML index, execution engine with chain support
- [x] Coverage Analysis — getPersonaCoverage + getAffectedPersonas working

## 14. Lore
- [x] Record / Search / Assess — 57 entries spanning 25 days. 8 types, symbol/date/author filtering.
- [x] Timeline — Chronological with arc tracking. Active arcs visible.
- [x] Confidence Calibration — Assessment verdicts (correct/partial/incorrect) wired to expertise.

## 15. Wisdom
- [x] Decision Records — Infrastructure solid (caching, TTL, global/local merge)
- [~] Antipatterns — Only 1 antipattern + 1 decision recorded. System works but **underused**.
- [x] Expert Context — Injection into agent prompts via wisdom_context tool

## 16. Workspaces
- [x] Multi-Project Support — Stable. npm workspaces with 6 workspace paths.

## 17. Documentation & Onboarding
- [x] CLAUDE.md — Accurate with v5.21. Logging convention updated. Agent onboarding clear.
- [x] AGENTS.md — 150+ lines, symbol system, navigation, PM governance, workflow protocol.
- [x] README.md — Professional. Problem statement, 3-pillar solution, benchmark data.
- [x] docs/specs/ — 16 specs, all post-v5.0. No stale v1 references.
- [x] nevr.land agent-architecture.md — Updated this session with v5.12-5.14 changes.

## 18. Build & Release
- [x] npm Publishing — 3 packages synced at 5.21.0. publish:all script available.
- [x] Plugin Deployment — Push to GitHub = update. Version synced.
- [x] Conductor Binary — swift build -c release. Clean build.
- [x] CHANGELOG — Complete through v5.21.0. Keep a Changelog format.
- [x] CI/CD — release.yml + ci.yml workflows exist.

---

## Summary

**Polish sprint complete.** 18 sections assessed, 10 releases shipped (v5.12.0 → v5.21.0).

**Remaining [~] items (minor, non-blocking):**
- University UI needs platform server API routes before it can be wired into Platform
- CLI error messages could be more prescriptive (suggest fixes)
- Multimodal input event prioritization unclear
- Graph auto-layout is a nice-to-have
- Wisdom system is underused (1 decision, 1 antipattern) — populate over time
