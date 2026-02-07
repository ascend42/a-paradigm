# Paradigm Framework - Website Outline

A comprehensive outline for designing the Paradigm framework website.

---

## Table of Contents

1. [Brand & Positioning](#1-brand--positioning)
2. [Site Architecture](#2-site-architecture)
3. [Homepage](#3-homepage)
4. [Product Pages](#4-product-pages)
5. [Documentation](#5-documentation)
6. [Use Cases](#6-use-cases)
7. [Community & Support](#7-community--support)
8. [Visual Design Notes](#8-visual-design-notes)

---

## 1. Brand & Positioning

### Tagline Options

- "Structure for AI-Native Development"
- "The Developer Tools Ecosystem for the AI Era"
- "Purpose. Portal. Premise. Paradigm."
- "From Chaos to Constellation"
- "Context That Travels"

### Core Value Proposition

Paradigm is a unified developer tools ecosystem that brings **structure**, **authorization**, and **shared context** to modern software projects — designed for both human developers and AI agents.

### Target Audiences

| Audience | Pain Point | Paradigm Solution |
|----------|------------|-------------------|
| **Solo Developers** | Context loss between sessions | Thread, Beacon, Constellation, History |
| **Teams** | Inconsistent understanding, lost knowledge | Purpose files, Portal topology, Wisdom system |
| **AI-Assisted Developers** | AI lacks project context | Symbol system, Navigator, Agent hints, CLI queries |
| **Enterprise** | Authorization complexity, audit trails | Portal validation, History tracking, Session reporting |
| **Open Source Maintainers** | Onboarding contributors | Beacon, Pathways, structured .purpose files |

### Competitive Positioning

| vs. | Paradigm Advantage |
|-----|-------------------|
| Plain documentation | Machine-readable, AI-queryable, symbol-indexed |
| Comments in code | Aggregated, cross-referenced, visualizable |
| Auth libraries | Topology-first, visual validation |
| Context files (.cursorrules) | Generated from structured source, IDE-agnostic |
| Tribal knowledge | Wisdom system preserves team patterns and antipatterns |

---

## 2. Site Architecture

### Primary Navigation

```
Home
├── Products
│   ├── Purpose (Structure)
│   ├── Portal (Authorization)
│   ├── Premise (Aggregation)
│   ├── Prism (Visualization)
│   └── MCP Server (AI Integration)
├── Features
│   ├── Symbol System
│   ├── Agent Efficiency
│   │   ├── Navigator
│   │   ├── Wisdom
│   │   └── History
│   ├── MCP Integration
│   ├── IDE Integration
│   ├── Multi-Agent Teams
│   └── CLI Tools
├── Docs
│   ├── Getting Started
│   ├── Guides
│   │   ├── MCP Setup (Claude Desktop)
│   │   └── Multi-Agent Teams
│   ├── CLI Reference
│   └── API Reference
├── Use Cases
├── Community
└── GitHub
```

### Footer Navigation

```
Products          Resources         Company          Connect
─────────         ─────────         ─────────        ─────────
Purpose           Documentation     About            GitHub
Portal            Tutorials         Blog             Discord
Premise           Examples          Changelog        Twitter
Prism             FAQ               License          Newsletter
MCP Server        MCP Setup Guide
```

---

## 3. Homepage

### Hero Section

**Headline:** "The Missing Layer Between Code and Context"

**Subheadline:** "Paradigm gives your project a shared language that humans, AI, and tools all understand."

**CTA Buttons:**
- Primary: "Get Started" → Installation guide
- Secondary: "See it in Action" → Demo/video

**Hero Visual:** Animated constellation of symbols (@ # ^ ! $ %) connecting and lighting up

### Problem Statement Section

**Headline:** "Modern Development Has a Context Problem"

**Three Pain Points:**

1. **Context Evaporates**
   - "What does this feature do? What auth does it need? AI doesn't know. New team members don't know. Sometimes YOU don't know."

2. **Authorization is a Black Box**
   - "Who can access what? Under what conditions? It's buried in middleware, scattered across files, impossible to visualize."

3. **AI Agents Work Blind**
   - "Your AI assistant reads thousands of tokens but misses the forest for the trees. It doesn't understand your project's shape."

### Solution Section

**Headline:** "Three Pillars. One Ecosystem."

| Pillar | Icon | Tagline | Description |
|--------|------|---------|-------------|
| **Purpose** | 🏠 | "The Interior Designer" | Define what things are and why they exist. Features, components, relationships. |
| **Portal** | 🚪 | "The Architect" | Define who can access what. Authorization topology, gate checks, signals. |
| **Premise** | 🧠 | "The Thinker" | Aggregate everything into a queryable, visual knowledge graph. |

### Symbol System Showcase

**Headline:** "A Shared Language for Everything"

Visual grid showing symbols with examples:

```
#checkout     Feature        User-facing capability
#Button       Component      Reusable code unit
^admin        Gate           Authorization checkpoint
!error        Signal         Event or side effect
$purchase     Flow           Multi-step process
%user.auth    State          Data condition
~legacy       Deprecated     Marked for removal
?idea         Idea           Future possibility
&stripe       Integration    External service
```

**Key Point:** "These symbols work everywhere — in code comments, documentation, AI prompts, and visual tools."

### Agent Efficiency Section

**Headline:** "Built for the AI Era"

**Subheadline:** "Paradigm doesn't just help humans. It's designed to make AI agents faster, more accurate, and context-aware."

| Feature | What It Does |
|---------|--------------|
| **Beacon** | Quick-start orientation file AI reads first |
| **Constellation** | Machine-readable symbol graph |
| **Navigator** | Pre-indexed project structure for targeted exploration |
| **Ripple** | Change impact analysis before modifications |
| **Thread** | Session continuity between AI interactions |
| **Echo** | Error-to-symbol mapping for debugging |
| **Wisdom** | Team patterns, antipatterns, and decisions |
| **History** | Implementation log with fragility tracking |
| **MCP Server** | Dynamic context for Claude Desktop — query symbols mid-conversation |

**Two Approaches Visual:**

| Static Context | Dynamic Context (MCP) |
|----------------|----------------------|
| Load everything upfront | Query only what's needed |
| ~2000 tokens per session | ~100 tokens per query |
| Stale if files change | Always current |
| IDE-specific | Works with Claude Desktop |

**Quote/Testimonial Placeholder:** "Paradigm cut my AI's token usage by 80% while making it 3x more accurate." — Developer testimonial

### Visualization Preview

**Headline:** "See Your Project's Shape"

Screenshot/animation of Prism visualizer showing:
- Constellation view with symbols as nodes
- Portal topology with gates lighting up
- Flow visualization with step sequences

**CTA:** "Try the Visualizer" → Prism demo

### IDE Integration Section

**Headline:** "Works With Your Tools"

Logos/icons for:
- Cursor
- GitHub Copilot
- Windsurf
- VS Code (via Copilot)
- Claude Desktop (via MCP)
- Claude Code (via CLAUDE.md)

**Key Point:** "One source of truth in `.paradigm/`, generates instructions for any IDE — plus dynamic MCP access for Claude Desktop."

**Two Integration Modes:**

| Mode | How It Works | Best For |
|------|--------------|----------|
| **Static (IDE Rules)** | `paradigm sync` generates instruction files | Cursor, Copilot, Windsurf |
| **Dynamic (MCP)** | MCP server exposes symbols on-demand | Claude Desktop, MCP clients |

### Getting Started Section

**Headline:** "Up and Running in 60 Seconds"

```bash
# Install
npm install -g github:ascend42/a-paradigm

# Initialize in your project
paradigm init

# Generate IDE instructions
paradigm sync

# Open the visualizer
paradigm visualize
```

**CTA:** "Read the Full Guide" → Docs

### Social Proof / Stats Section

Placeholder for:
- GitHub stars
- npm downloads
- Companies using Paradigm
- Community size

### Newsletter/CTA Section

**Headline:** "Stay in the Loop"

Email signup for updates, tutorials, and release notes.

---

## 4. Product Pages

### 4.1 Purpose Page

**Hero:** "Define What Things Are and Why They Exist"

**Core Concept:**
- `.purpose` files are YAML files that live alongside your code
- They define features, components, and their relationships
- They're human-readable AND machine-parseable

**Key Features:**
1. **Feature Definitions** — Name, description, gates, signals, components
2. **Component Registry** — Track reusable units and their usage
3. **Relationship Mapping** — See how everything connects
4. **Validation** — Ensure consistency with `paradigm lint`

**Example:**
```yaml
# features/checkout/.purpose
features:
  checkout:
    description: Complete purchase flow
    gates: [^authenticated, ^has-items]
    signals: ["!checkout-complete", "!payment-failed"]
    components: [#CheckoutForm, #PaymentProcessor]
```

**Benefits:**
- New team members understand features instantly
- AI agents know what they're working on
- Documentation stays in sync with code

### 4.2 Portal Page

**Hero:** "Authorization Topology, Not Just Middleware"

**Core Concept:**
- `portal.yaml` defines your authorization structure
- Gates are checkpoints, not just middleware
- Visual validation shows exactly what happened

**Key Features:**
1. **Gate Definitions** — Named authorization points with requirements
2. **Gate Relationships** — Express dependencies (`requires`)
3. **Runtime Validation** — SDK for checking gates with structured output
4. **Portal Viewer** — Real-time visualization of gate checks

**Example:**
```yaml
# portal.yaml
gates:
  authenticated:
    description: User must be logged in
    keys: [user.id]

  admin-only:
    description: Admin access required
    requires: [^authenticated]
    keys: [user.role == 'admin']
```

**Benefits:**
- See your entire auth topology at a glance
- Validate authorization flows visually
- AI agents understand permission boundaries

### 4.3 Premise Page

**Hero:** "Aggregate Everything Into One Knowledge Graph"

**Core Concept:**
- Premise combines Purpose + Portal + code analysis
- Builds a queryable symbol index
- Powers visualization and AI context

**Key Features:**
1. **Symbol Index** — Every symbol in one place
2. **Relationship Graph** — Who references whom
3. **Constellation Output** — Machine-readable JSON/YAML
4. **Ripple Analysis** — Impact analysis for any symbol

**Example:**
```bash
# Generate the constellation
paradigm constellation

# Query it with jq
jq '.stars["#checkout"]' .paradigm/constellation.json
```

**Benefits:**
- Understand your project's shape
- Track dependencies and impacts
- Feed precise context to AI agents

### 4.4 Prism Page

**Hero:** "The Infinite Canvas for Your Project"

**Core Concept:**
- Prism is the visual layer of Paradigm
- See symbols as a constellation
- Watch authorization in real-time

**Key Features:**
1. **Constellation View** — Symbols as connected nodes
2. **Portal Viewer** — Watch gates light up in real-time
3. **Session Recording** — Log test flows for QA
4. **Webhook Integration** — Report to Slack, Discord, etc.

**Screenshot Gallery:**
- Constellation with symbols
- Portal topology
- Session recording interface
- Webhook configuration

**CTA:** "Launch Prism" → `paradigm visualize`

### 4.5 MCP Server Page

**Hero:** "Dynamic Context for AI Assistants"

**Core Concept:**
- MCP (Model Context Protocol) is Anthropic's standard for AI tool integration
- Paradigm's MCP server exposes symbols dynamically, not statically
- Claude Desktop (or any MCP client) can query your project mid-conversation

**The Problem with Static Context:**
```
Traditional: AI loads .cursorrules → 2000 tokens → works on task
            (Even if only 5% is relevant)

With MCP:   AI needs info about #checkout →
            Calls paradigm_ripple("#checkout") →
            Gets 100 tokens of targeted context
```

**Key Features:**

1. **Resources (Read-Only Data)**

| Resource | What It Returns |
|----------|-----------------|
| `paradigm://symbols` | All symbols with counts |
| `paradigm://symbol/#checkout` | Single symbol details |
| `paradigm://symbols/type/gate` | All gates |
| `paradigm://gates` | Detailed gate definitions |
| `paradigm://flows` | All flow definitions |
| `paradigm://wisdom/preferences` | Team patterns |
| `paradigm://history/fragile` | Fragile symbols |

2. **Tools (Actions AI Can Invoke)**

| Tool | What It Does |
|------|--------------|
| `paradigm_search` | Find symbols by query |
| `paradigm_ripple` | Impact analysis ("what breaks if I change X?") |
| `paradigm_related` | Get connected symbols |
| `paradigm_status` | Project overview |
| `paradigm_navigate` | Targeted exploration via Navigator |
| `paradigm_wisdom_context` | Get team patterns before implementing |
| `paradigm_history_fragility` | Check stability before modifying |

**Setup (Claude Desktop):**
```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "paradigm": {
      "command": "paradigm-mcp",
      "args": ["."],
      "cwd": "/path/to/your/project"
    }
  }
}
```

**Example Conversation:**

> **You:** "What would break if I removed the ^authenticated gate?"
>
> **Claude:** *[calls paradigm_ripple]* "Removing ^authenticated would affect 12 features including #checkout, #profile, and #settings. Here's the full impact..."

**Benefits:**
- Token efficient — only fetch what's needed
- Always current — reads live project state
- Technology agnostic — works with any language/framework
- Standard protocol — any MCP client can use it

**CTA:** "Set Up MCP" → MCP Setup Guide

### 4.6 Navigator Page

**Hero:** "Targeted Exploration, Not Token Waste"

**Core Concept:**
- Navigator provides a pre-indexed project structure
- AI tools query for targeted paths instead of broad exploration
- Reduces exploration overhead by 90%+

**Key Features:**
1. **Structure Index** — Feature, component, gate locations pre-mapped
2. **Symbol-to-Path Lookup** — Direct navigation from symbol to file
3. **Skip Patterns** — Automatically avoid node_modules, dist, etc.
4. **Task Context** — Get relevant files for any task description

**Example:**
```typescript
// Instead of: glob **/*.ts (thousands of files)
paradigm_navigate({ intent: "find", target: "#checkout" })
// Returns: { paths: ["src/features/checkout/"], symbols: ["#checkout"] }
```

**Benefits:**
- 90% reduction in exploration tokens
- AI goes directly to relevant code
- No more wasted reads of irrelevant files

### 4.7 Wisdom Page

**Hero:** "Preserve What Your Team Knows"

**Core Concept:**
- Wisdom captures team knowledge indexed by symbols
- Antipatterns prevent repeated mistakes
- Decisions provide architectural context

**Key Features:**
1. **Preferences** — "What TO do" patterns per symbol
2. **Antipatterns** — "What NOT to do" with reasons
3. **Expertise** — Who knows what areas
4. **Decisions** — ADR-style records with rationale

**Example:**
```yaml
# .paradigm/wisdom/antipatterns.yaml
antipatterns:
  - id: "api-001"
    symbols: ["#api", "#api-client"]
    description: "Do NOT use axios interceptors for auth token refresh"
    reason: "Caused race conditions when multiple requests trigger refresh"
    alternative: "Use a token refresh queue with mutex"
```

**Benefits:**
- Institutional knowledge survives team changes
- AI agents avoid known pitfalls
- New developers learn from past mistakes

### 4.8 History Page

**Hero:** "Know What Changed and What Broke"

**Core Concept:**
- History tracks implementations, validations, and rollbacks
- Identifies fragile areas that need extra care
- Detects co-change patterns

**Key Features:**
1. **Implementation Log** — Append-only record of changes
2. **Fragility Scoring** — Identifies unstable symbols
3. **Co-Change Detection** — Symbols that often change together
4. **Validation Tracking** — Test results over time

**Example:**
```bash
# Check fragility before modifying
paradigm history fragile
# → #search: HIGH fragility (3 rollbacks in last 10 changes)

# See what changed together
paradigm history show #checkout
# → Often changes with #payment-form (89% correlation)
```

**Benefits:**
- Know which areas need extra testing
- Understand change patterns
- Full audit trail for any symbol

---

## 5. Documentation

### Structure

```
Getting Started
├── Installation
├── Quick Start
├── Minimal Setup
├── Core Concepts
└── Your First Project

Guides
├── Defining Features with Purpose
├── Setting Up Authorization with Portal
├── Building a Symbol Index with Premise
├── Visualizing with Prism
├── Integrating with Your IDE
├── Optimizing for AI Agents
├── Setting Up MCP with Claude Desktop
├── Multi-Agent Teams
└── TaskFlow Tutorial (Build-Along Project)

CLI Reference
├── paradigm init
├── paradigm sync
├── paradigm status
├── paradigm doctor
├── paradigm lint
├── paradigm visualize
├── paradigm constellation
├── paradigm beacon
├── paradigm ripple
├── paradigm thread
├── paradigm echo
├── paradigm cost
├── paradigm team
├── paradigm history
├── paradigm wisdom
├── paradigm hooks
├── paradigm mcp setup
└── paradigm scan auto

MCP Reference
├── Resources (paradigm://...)
├── Tools (paradigm_search, paradigm_ripple, etc.)
└── Configuration

Specifications
├── Symbol System
├── Purpose File Format
├── Portal File Format
├── Constellation Schema
├── Logger Pattern
├── Navigator Protocol
├── Wisdom Schema
├── History Schema
└── Probe Protocol

API Reference
├── @a-company/purpose-core
├── @a-company/portal-core
├── @a-company/portal-sdk
├── @a-company/premise-core
├── @a-company/probe-core
└── @a-company/paradigm-mcp
```

### Key Documentation Pages

#### Getting Started (Priority)

1. **Installation**
   - npm global install from GitHub
   - Verify with `paradigm --version`
   - System requirements

2. **Quick Start (5 min)**
   - `paradigm init`
   - Create first `.purpose` file
   - `paradigm sync`
   - `paradigm visualize`

3. **Minimal Setup**
   - Just `paradigm init` + `paradigm beacon`
   - Add `.purpose` files as needed
   - Start without full setup

4. **Core Concepts**
   - The symbol system explained
   - Purpose vs Portal vs Premise
   - How files are generated
   - IDE integration model

#### Guides (Tutorials)

1. **"Add Context to an Existing Project"**
   - Audit existing code
   - Create `.purpose` files
   - Define portal topology
   - Generate constellation

2. **"Set Up AI-Optimized Context"**
   - Generate beacon
   - Configure agent hints
   - Teach AI to query CLI
   - Session continuity with thread

3. **"Capture Team Wisdom"**
   - Initialize wisdom directory
   - Record antipatterns
   - Document decisions
   - Map expertise

4. **"Track Implementation History"**
   - Initialize history
   - Record implementations
   - Monitor fragility
   - Integrate with git hooks

---

## 6. Use Cases

### Use Case Pages

#### 1. "For Solo Developers"

**Headline:** "Never Lose Context Again"

**Pain Points:**
- Forget what you were working on
- AI repeats the same mistakes
- Hard to pick up after a break

**Solution:**
- Thread maintains session history
- Beacon orients you (and AI) instantly
- History tracks what changed
- Ripple shows what changed

#### 2. "For Teams"

**Headline:** "Shared Understanding Without Meetings"

**Pain Points:**
- Onboarding takes forever
- "Ask Sarah, she knows that code"
- Inconsistent feature understanding
- Knowledge lost when people leave

**Solution:**
- Purpose files document features
- Constellation shows relationships
- Wisdom preserves team knowledge
- Expertise mapping shows who knows what

#### 3. "For AI-Assisted Development"

**Headline:** "Make Your AI Actually Useful"

**Pain Points:**
- AI lacks project context
- Burns tokens reading everything
- Makes changes that break things
- Doesn't know your team's patterns

**Solution:**
- Navigator provides targeted exploration
- Wisdom teaches team patterns
- History warns about fragile areas
- MCP server for dynamic context

#### 4. "For Claude Desktop Users"

**Headline:** "Your Project, On-Demand"

**Pain Points:**
- Claude doesn't know your codebase
- Copy-pasting context is tedious
- Context gets stale as you work

**Solution:**
- MCP server exposes symbols dynamically
- Claude queries only what it needs
- Always up-to-date with your latest changes
- Ask "what would break if..." and get real answers

**Demo Conversation:**
> "Claude, what features depend on ^authenticated?"
> *Claude calls paradigm_ripple, returns targeted answer*

#### 5. "For Authorization-Heavy Apps"

**Headline:** "See Your Auth Topology"

**Pain Points:**
- Auth logic scattered everywhere
- Can't visualize permissions
- Debugging auth is painful

**Solution:**
- Portal defines topology
- Viewer shows real-time checks
- Reports for QA and compliance

---

## 7. Community & Support

### Community Page

**Sections:**
- Discord server (discussions, help)
- GitHub Discussions (feature requests, Q&A)
- Twitter/X (updates, tips)
- Newsletter (tutorials, releases)

### Contributing Guide

- How to contribute
- Development setup
- PR guidelines
- Issue templates

### Examples & Templates

**Example Projects:**
- ShopFlow (e-commerce, included in repo)
- SaaS Starter (multi-tenant, auth-heavy)
- API Backend (minimal, focused)
- Monorepo (workspaces, multiple packages)

---

## 8. Visual Design Notes

### Color Palette Suggestions

**Primary:** Deep space blue (#0a0f1a)
**Accent:** Constellation gold (#f5c542)
**Secondary Accents:**
- Feature blue (@) — #3b82f6
- Component green (#) — #22c55e
- Portal red (^) — #ef4444
- Signal yellow (!) — #eab308
- Flow purple ($) — #8b5cf6
- State cyan (%) — #06b6d4
- Deprecated gray (~) — #6b7280
- Integration orange (&) — #f97316

### Typography

**Headlines:** Bold, geometric sans-serif (e.g., Inter, Satoshi)
**Body:** Clean, readable sans-serif
**Code:** JetBrains Mono or similar

### Visual Motifs

1. **Constellation/Stars** — Symbols as stars in a night sky
2. **Glowing Connections** — Lines between related symbols
3. **Portals/Gates** — Doorway imagery for authorization
4. **Light Trails** — For flows and journeys
5. **Beacons** — Lighthouse/guiding light imagery
6. **Memory/History** — Timeline, journal imagery

### Animation Ideas

1. **Hero Animation:**
   - Symbols appear as stars
   - Connections draw between them
   - Colors pulse based on type

2. **Gate Check Animation:**
   - Portal glows checking (yellow)
   - Passes (green pulse)
   - Fails (red shake)

3. **Ripple Effect:**
   - Click a symbol
   - Waves propagate to connected symbols
   - Shows impact visually

4. **Navigator Animation:**
   - Query enters
   - Structure illuminates path
   - Target file highlights

### Responsive Considerations

- Mobile: Simplified navigation, stacked layouts
- Tablet: Two-column layouts
- Desktop: Full constellation visualizations

---

## 9. Content Priorities

### Phase 1 (Launch)

- [ ] Homepage (all sections)
- [ ] Getting Started guide
- [ ] Minimal Setup guide
- [ ] CLI Reference (core commands)
- [ ] GitHub README polish
- [ ] MCP Setup Guide

### Phase 2 (Post-Launch)

- [ ] Individual product pages (Purpose, Portal, Premise, Prism, MCP, Navigator, Wisdom, History)
- [ ] Use case pages
- [ ] Video tutorials (7-video series)
- [ ] TaskFlow tutorial project
- [ ] Example project gallery
- [ ] Multi-agent team documentation

### Phase 3 (Growth)

- [ ] Blog with tutorials
- [ ] Community showcase
- [ ] Enterprise features page
- [ ] Integration guides
- [ ] YouTube channel content

---

## 10. SEO & Metadata

### Key Search Terms

- "AI developer tools"
- "Authorization visualization"
- "Code context management"
- "AI coding assistant context"
- "Feature documentation"
- "Cursor rules generator"
- "Developer knowledge graph"
- "MCP server"
- "Model Context Protocol"
- "Claude Desktop integration"
- "Dynamic AI context"
- "Anthropic MCP tools"
- "Team knowledge management"
- "Code fragility tracking"

### Meta Descriptions

**Homepage:**
"Paradigm is a developer tools ecosystem that brings structure, authorization, and shared context to modern software projects — for humans and AI agents alike."

**Purpose:**
"Define features and components with .purpose files. Machine-readable context that keeps documentation in sync with code."

**Portal:**
"Visualize and validate authorization topology. See your gates, track permissions, debug auth flows."

**Premise:**
"Aggregate your project into a queryable knowledge graph. Power AI context with structured symbol data."

**MCP Server:**
"Dynamic context for Claude Desktop and MCP clients. Query your project's symbols, gates, and flows mid-conversation — only fetch what you need."

**Prism:**
"The infinite canvas for your project. Visualize symbols as constellations, watch authorization in real-time, explore relationships."

**Navigator:**
"Pre-indexed project structure for targeted AI exploration. 90% reduction in exploration tokens."

**Wisdom:**
"Preserve team knowledge indexed by symbols. Antipatterns, preferences, decisions, and expertise mapping."

**History:**
"Track implementations, validations, and rollbacks. Identify fragile areas and co-change patterns."

---

## 11. Technical Implementation Notes

### Recommended Stack

- **Framework:** Next.js or Astro (static generation for docs)
- **Styling:** Tailwind CSS
- **Documentation:** MDX or Markdoc
- **Search:** Algolia DocSearch or Pagefind
- **Analytics:** Plausible or Fathom (privacy-friendly)
- **Hosting:** Vercel or Cloudflare Pages

### Interactive Elements

- **Live Playground:** Embed Prism visualizer for demos
- **Code Blocks:** Syntax highlighting with copy button
- **CLI Snippets:** Runnable in terminal (with explanation)
- **Schema Explorer:** Interactive constellation viewer

---

## Appendix: Symbol Quick Reference

| Symbol | Name | Example | Description |
|--------|------|---------|-------------|
| `#` | Component | `#checkout`, `#Button` | Any documented code unit |
| `$` | Flow | `$purchase-flow` | Multi-step process with sequence |
| `^` | Gate | `^authenticated` | Authorization checkpoint |
| `!` | Signal | `!login-failed` | Event for side effects |
| `~` | Aspect | `~audit-required` | Rule with required code anchor |

---

*Document Version: 1.2*
*Last Updated: 2026-02-02*
*Added: Navigator, Wisdom, History systems; Multi-agent teams; Updated symbol definitions; Minimal setup guide*
