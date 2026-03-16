# Paradigm 4.0 — Technical Specification

> **The Context Engineering Framework**
>
> **Status:** Spec Draft | **Authors:** ascend + opus
> **Date:** 2026-03-16 | **Target:** 4.0.0

---

## 1. What Paradigm Is

Paradigm is a **context engineering framework** — a system that structures, manages, and optimizes the context that AI agents consume to produce correct, high-quality work.

It is not a copilot. It is not an IDE plugin. It is not a prompt library. It is the **knowledge graph underneath all of those things** — the substrate that makes agents intelligent about *your* codebase, *your* patterns, *your* team's decisions, and *your* accumulated expertise.

Every AI coding tool has the same fundamental problem: the model starts blank. Paradigm solves this by giving agents structured memory, persistent identity, earned expertise, and a living map of the system they're working in.

---

## 2. Core Philosophies

### 2.1 Context Is the Only Lever

LLMs are stateless. The context window is the only input that determines output quality. Everything Paradigm does serves one purpose: **make the context window as correct, complete, and compact as possible.**

- MCP tools return ~100-300 tokens vs ~2000+ for file reads — 10x efficiency
- Symbols compress meaning: `#auth-middleware` carries more signal than a file path
- .purpose files are structured context, not documentation
- The graduated knowledge architecture (L0-L4) keeps expensive context small and loads the rest on demand

### 2.2 Agents Should Learn, Not Reset

Every session starting from zero is a failure of infrastructure, not a limitation of AI. Paradigm gives agents:

- **Persistent identity** (.agent files that travel across projects)
- **Earned expertise** (confidence scores that accumulate from real work via lore)
- **Transferable patterns** (solutions learned in one project that apply in others)
- **Personality** (behavioral preferences that shape how an agent approaches work)

An architect agent that has designed 14 auth systems should *know* it's good at auth systems. Paradigm makes this possible.

### 2.3 Specs Are Source Code, Code Is a Projection

The specification — the intent, the constraints, the flow — is the primary artifact. Code is a lossy projection of that intent. You can't recover the "why" from reading code alone.

Paradigm treats specifications as first-class: .purpose files, flows, gates, aspects, protocols. These are the truth. The code implements them. When they diverge, the spec wins.

### 2.4 Structure Enables Freedom

Paradigm is opinionated so agents don't have to guess. Five symbols (#, $, ^, !, ~) cover every structural concept. Gates enforce authorization. Flows document multi-step processes. Aspects anchor cross-cutting rules to code. This structure doesn't constrain — it eliminates the ambiguity that causes agents to hallucinate or explore aimlessly.

### 2.5 The System Gets Cheaper as It Gets Smarter

Knowledge enters expensive (CLAUDE.md, loaded every session) and graduates to cheaper enforcement as confidence proves it:

```
Level 0: CLAUDE.md — always loaded, shrinks over time
Level 1: Skills — loaded on demand by symbol/description match
Level 2: Protocols — loaded on demand by paradigm_protocol_search
Level 3: Aspects + Gates — enforced structurally, checked by hooks
Level 4: Hooks — zero-token enforcement, no AI involvement
```

New knowledge enters at L0/L1. Proven knowledge graduates to L3/L4. The system grows in capability without growing in cost.

### 2.6 Human Leverage at the Highest Point

A bad line of code is a bad line of code. A bad line of a plan leads to hundreds of bad lines of code. Paradigm's orchestration puts human review at the plan level (architect output) where leverage is highest, not at the code level where it's lowest.

### 2.7 Privacy Is Non-Negotiable

All agent data, expertise, and notebooks are private by default. Sharing is opt-in, per-entry, with anonymization. Proprietary codebase knowledge never leaks. Universal patterns can be extracted and shared without exposing business logic.

---

## 3. The Seven Pillars

### Pillar 1: The Symbol System

The atomic unit of Paradigm. Five symbols that classify every structural concept:

| Symbol | Meaning | Example |
|--------|---------|---------|
| `#` | Component | `#PaymentService`, `#auth-middleware` |
| `$` | Flow | `$checkout-flow`, `$onboarding` |
| `^` | Gate | `^authenticated`, `^project-admin` |
| `!` | Signal | `!payment-complete`, `!login-success` |
| `~` | Aspect | `~audit-required`, `~rate-limited` |

Plus a tag bank for behavioral/domain classification. Symbols are the vocabulary. Tags are the adjectives.

### Pillar 2: Structured Context (.purpose + portal.yaml)

Every directory has a `.purpose` file that declares what lives there — components, flows, gates, signals, aspects — with descriptions, types, tags, and relationships. `portal.yaml` declares the authorization topology. Together they form a machine-readable map of the entire system.

### Pillar 3: Institutional Memory (Lore + Wisdom + History)

Three layers of project memory:

- **Lore** — What happened: sessions, decisions, milestones, retrospectives. With confidence scores and assessment verdicts for calibration.
- **Wisdom** — What we've learned: antipatterns, architectural decisions, expert knowledge. The accumulated judgment of the team.
- **History** — What changed: implementation events, validation results, fragility scores. The factual record.

### Pillar 4: Agent Intelligence (Identity + Expertise + Orchestration)

Agents are not disposable. They have:

- **Identity** (.agent files) — personality, expertise, transferable patterns, per-project contexts
- **Expertise** — per-symbol confidence scores, accumulated from real work via lore
- **Orchestration** — multi-agent coordination with architect, builder, reviewer, tester, security roles
- **Enrichment** — agent prompts include personality and expertise context automatically

### Pillar 5: Observability (Sentinel)

Symbol-aware observability that connects runtime behavior to the structural map:

- Structured logging with symbol-typed methods (log.component, log.gate, log.signal)
- Incident detection, pattern matching, and triage
- Traces and spans with Paradigm symbol correlation
- Live dashboard for real-time system health

### Pillar 6: Enforcement (Gates + Aspects + Hooks)

Compliance isn't advisory — it's structural:

- **Gates** (^) — authorization checks declared in portal.yaml, enforced in code
- **Aspects** (~) — cross-cutting rules anchored to specific code locations
- **Hooks** — zero-token enforcement: stop hooks block completion if .purpose files aren't updated, pre-commit hooks rebuild the index, post-write hooks remind about coverage
- **Drift detection** — aspect anchors auto-heal when code shifts

### Pillar 7: Collaboration (Symphony + University + Workspace)

Multi-agent, multi-human, multi-project:

- **Symphony** — agent-to-agent messaging, cross-machine networking via WebSocket relay, file pipeline with trust config
- **University** — per-project knowledge base with courses, quizzes, learning paths, diplomas
- **Workspace** — multi-project symbol awareness, cross-project ripple analysis, sibling index search

---

## 4. What's New in 4.0

### 4.1 Agent Identity Maturation

**Phase 0 (3.47.0 — SHIPPED):** .agent files, expertise auto-update from lore, MCP tools, CLI commands, orchestration enrichment.

**Phase 1: Agent Notebooks**
Curated snippet libraries distilled from lore. Not documentation, not RAG — distilled experience with context, snippet, provenance, applied-count, and confidence.

- Notebooks emerge from work: after N similar tasks, pattern detected, auto-extracted
- Each entry: when to use (context), what to do (snippet), where learned (provenance)
- Transferable with concept-level adaptation (TypeScript snippet → Rust concept → new entry)
- MCP tools: `paradigm_notebook_search`, `paradigm_notebook_add`, `paradigm_notebook_promote`
- CLI: `paradigm notebook list`, `paradigm notebook show`, `paradigm notebook export`

**Phase 2: Model Cascading**
Orchestrator computes minimum viable model per task using complexity scoring:

```
complexity < 0.3  → haiku (notebook-ready, protocol-clear)
complexity 0.3-0.6 → sonnet (protocol exists, moderate scope)
complexity 0.6-0.85 → opus (multi-file, architectural)
complexity > 0.85 → opus + human review (novel, high-risk)
```

Scoring factors: novelty, scope, risk, confidence, context quality. Self-improving: cascade outcomes feed back into scoring. Projected: 4x faster, 8x cheaper for 60%+ of routine tasks.

**Phase 3: Knowledge Graduation**
Confidence-driven promotion through the leveling framework:

- Protocol success rate > 90% over 10+ invocations → aspect candidate
- Aspect never violated in 50+ sessions → hook candidate
- Hook blocking frequently → missing skill needed (upward signal)
- Ripple becomes the skill router: `paradigm_ripple` returns `skills_to_load`

### 4.2 Dynamic Tool Loading

**Problem:** Paradigm exposes 40+ MCP tools. Research shows every model performs worse with more tools. 46 tools crashed an 8B model entirely.

**Solution:** Context-aware tool subsets. On MCP server init, load only the tools relevant to the current project configuration and task context:

- **Core tier** (always loaded, ~10 tools): search, ripple, navigate, status, related, gates_for_route, reindex, context_check, session tools
- **Feature tier** (loaded if project uses feature): lore tools, symphony tools, university tools, persona tools, sentinel tools, agent tools
- **Advanced tier** (loaded on demand): graph, heatmap, pipeline, conductor, platform tools

Detection via `.paradigm/config.yaml` features list. MCP `tools/list` returns only active tiers. Agents can request tier activation via `paradigm_tool_activate`.

### 4.3 Agent Permission Scoping

**Problem:** The Copilot RCE (CVE-2025-53773) proved agents that can modify their own config are fundamentally unsafe.

**Solution:** `.agent` files gain a `permissions` block:

```yaml
permissions:
  paths:
    read: ["**/*"]
    write: ["src/**", "tests/**"]
    deny: [".paradigm/agents/*", "portal.yaml", ".env*"]
  tools:
    allow: ["paradigm_search", "paradigm_navigate", "paradigm_ripple"]
    deny: ["paradigm_purpose_*"]  # can't modify metadata
  dangerous_actions:
    require_approval: true  # human must approve destructive ops
```

Enforcement: orchestrator checks permissions before dispatching. Hooks validate that agents haven't modified denied paths. Integrity hash on .agent files detects tampering.

### 4.4 Response Format Parameter

**Problem:** Anthropic's own guidance recommends concise/detailed response modes. Agents waste tokens on detailed responses when they only need a signal.

**Solution:** Add `response_format` enum to high-traffic tools:

- `paradigm_search`: concise returns symbol+type only, detailed adds descriptions+paths
- `paradigm_ripple`: concise returns impact level + count, detailed adds full dependency tree
- `paradigm_navigate`: concise returns paths only, detailed adds context
- `paradigm_agent_expertise`: concise returns top agent + confidence, detailed adds full rankings

Default: concise. Agents request detailed when they need it.

### 4.5 Context Health Scoring

**Problem:** Context rot is real and measurable. Agents don't know when their context is degraded.

**Solution:** `paradigm_context_health` tool that evaluates:

- Session token usage vs window size
- Tool call count and repetition patterns (circular behavior detection)
- Time since last compaction/checkpoint
- Number of files read vs MCP queries (ratio indicates exploration bloat)
- Conflicting information signals (same symbol described differently)

Returns a health score (0-100) with specific recommendations:
- "Compact now — session at 73% capacity with no checkpoint in 45 minutes"
- "Circular behavior detected — 3 repeated searches for #auth-middleware"
- "Context distraction risk — 47 files read, consider MCP queries instead"

### 4.6 Specs as First-Class Symbols

**Problem:** Specs live in `.paradigm/specs/` but aren't integrated into the symbol system. No ripple analysis, no lore tracking, no confidence scoring.

**Solution:** Specs become symbols with a new convention:

- Specs declared in `.purpose` files as components with `type: spec`
- `paradigm_ripple` on a spec shows all flows, components, and gates it defines
- Lore entries can reference specs: "Implemented per spec #auth-spec-v2"
- When a spec changes, affected symbols get flagged
- Confidence on specs: how well has implementation matched specification?

### 4.7 Agent Registry (paradigm.dev/agents)

**The npm for agents.** A public registry where users publish and install trained agent profiles.

**What gets published:**
- Agent personality configuration
- Transferable patterns with success rates (anonymized)
- Notebook entries at concept level (not raw snippets)
- Expertise profiles (symbol categories, not project-specific symbols)

**What never gets published:**
- Project-specific symbols or paths
- File contents or code snippets
- Credentials, environment details, business logic
- Per-project context blocks

**Architecture:**
```
paradigm agent publish architect --scope public
  → anonymizes project references
  → extracts concept-level patterns
  → publishes to registry.useparadigm.dev

paradigm agent install security-auditor
  → downloads profile + patterns + notebook entries
  → merges into ~/.paradigm/agents/security-auditor.agent
  → expertise available immediately
```

**Community features:**
- Download counts, star ratings, usage stats
- Verified publishers (CI proves patterns work)
- Dependency on paradigm version (compat ranges)
- Fork + extend (install as base, customize locally)

**Revenue model:** Free for public agents. Paid tier for private team registries (enterprise).

### 4.8 Automated Review Pipeline

**Problem:** The reviewer agent exists but requires manual orchestration.

**Solution:** `paradigm review` command and CI integration:

```bash
paradigm review                    # Review staged changes
paradigm review --pr 123           # Review a pull request
paradigm review --ci               # CI mode (exits non-zero on blocking findings)
```

Two-stage protocol (already designed):
1. **Spec compliance** — .purpose coverage, gate enforcement, flow integrity, signal emissions, aspect anchoring
2. **Code quality** — security (OWASP), conventions, test coverage, error handling

Output: structured findings (blocking/improvement/note) with minimum 3 findings.

### 4.9 Deep Knowledge Scan

**Problem:** Cold-starting a new project requires extensive manual .purpose file creation.

**Solution:** `paradigm scan --learn` using multi-agent fleet:

- **Structure agent** — file tree, module boundaries, export/import graph
- **Pattern agent** — recurring code patterns, naming conventions, architectural style
- **Security agent** — auth patterns, input validation, data handling
- **Test agent** — test coverage, test patterns, fixture conventions

Output: auto-generated .purpose files, suggested protocols, detected aspects, recommended gates. Human reviews and approves. Solves the cold-start problem.

### 4.10 Integrity & Tamper Detection

**Problem:** .paradigm/ files are trusted by agents. A malicious contributor could inject instructions.

**Solution:**
- SHA-256 integrity manifest at `.paradigm/integrity.json`
- Generated by `paradigm scan` / `paradigm reindex`
- Hooks verify manifest before agent session starts
- Tampered files flagged with warning, not silently loaded
- `.agent` files include integrity hash that prevents self-modification

---

## 5. Migration Path (3.x → 4.0)

### What Stays Unchanged
- All 5 symbols (#, $, ^, !, ~) and tag system
- .purpose file format
- portal.yaml format
- All existing MCP tools (but some move to feature tiers)
- agents.yaml manifest
- Lore, wisdom, history storage
- Symphony messaging
- Sentinel observability
- University content

### What Gets Added
- .agent files (Phase 0 already shipped in 3.47.0)
- Agent notebooks (Phase 1)
- Model cascading (Phase 2)
- Knowledge graduation (Phase 3)
- Dynamic tool loading
- Agent permissions
- Response format parameter
- Context health scoring
- Spec symbols
- Agent registry
- Review pipeline
- Deep scan
- Integrity checking

### What Gets Refactored
- CLAUDE.md — shrinks dramatically, becomes identity + symbol system + how to start. Everything else loads on demand.
- Tool registration — moves from monolithic to tiered
- Orchestration — gains model cascading and notebook context
- README — complete rewrite as context engineering framework positioning

### Breaking Changes
- Tool tier system means some tools aren't available by default (agents request activation)
- CLAUDE.md size reduction changes what's in initial context
- Agent permission scoping may restrict previously unrestricted agent behavior

### Versioning
- 4.0.0 — core framework + dynamic tools + agent notebooks + permissions + review pipeline
- 4.1.0 — model cascading + context health + spec symbols
- 4.2.0 — agent registry + deep scan + integrity checking
- 4.3.0 — knowledge graduation + skill derivation

---

## 6. Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Agent expertise accuracy | >80% calibration score | Lore confidence vs assessment verdicts |
| Token efficiency | 30% reduction vs 3.x | Session stats before/after dynamic tool loading |
| Cold-start time | <5 minutes to productive | Time from `paradigm shift` to first meaningful agent output |
| Review pipeline catch rate | >50% of blocking issues found pre-human | Comparison of automated vs human review findings |
| Model cascade savings | 4x faster, 8x cheaper for routine tasks | Cost tracking on haiku vs opus task completion |
| Community adoption | 100 published agents in registry within 6 months | Registry download stats |

---

## 7. Non-Goals for 4.0

- **IDE integration beyond MCP** — Paradigm works through MCP, not IDE-specific plugins (VS Code extension is supplementary, not primary)
- **Replacing CI/CD** — Paradigm informs CI, doesn't replace it
- **Model training** — Paradigm structures context, doesn't fine-tune models
- **Real-time collaboration UI** — Symphony handles messaging; shared editing is out of scope
- **Non-software domains** — While the philosophy applies broadly, 4.0 stays focused on software development. Community finds general-purpose uses.

---

*This spec is the technical reference for Paradigm 4.0. For the positioning, branding, and content strategy, see the companion content brief (maintained in the parallel session).*
