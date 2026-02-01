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
| **Solo Developers** | Context loss between sessions | Thread, Beacon, Constellation |
| **Teams** | Inconsistent understanding of features/auth | Purpose files, Portal topology |
| **AI-Assisted Developers** | AI lacks project context | Symbol system, Agent hints, CLI queries |
| **Enterprise** | Authorization complexity, audit trails | Portal validation, Session reporting |
| **Open Source Maintainers** | Onboarding contributors | Beacon, Pathways, structured .purpose files |

### Competitive Positioning

| vs. | Paradigm Advantage |
|-----|-------------------|
| Plain documentation | Machine-readable, AI-queryable |
| Comments in code | Aggregated, cross-referenced, visualizable |
| Auth libraries | Topology-first, visual validation |
| Context files (.cursorrules) | Generated from structured source, IDE-agnostic |

---

## 2. Site Architecture

### Primary Navigation

```
Home
├── Products
│   ├── Purpose (Structure)
│   ├── Portal (Authorization)
│   ├── Premise (Aggregation)
│   └── Prism (Visualization)
├── Features
│   ├── Symbol System
│   ├── Agent Efficiency
│   ├── IDE Integration
│   └── CLI Tools
├── Docs
│   ├── Getting Started
│   ├── Guides
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
@checkout     Feature        User-facing capability
#Button       Component      Reusable code unit
^admin        Portal         Authorization gate
!error        Signal         Event or side effect
$purchase     Flow           Multi-step process
%user.auth    State          Data condition
```

**Key Point:** "These symbols work everywhere — in code comments, documentation, AI prompts, and visual tools."

### Agent Efficiency Section

**Headline:** "Built for the AI Era"

**Subheadline:** "Paradigm doesn't just help humans. It's designed to make AI agents faster, more accurate, and context-aware."

| Feature | What It Does |
|---------|--------------|
| **Beacon** | Quick-start orientation file AI reads first |
| **Constellation** | Machine-readable symbol graph |
| **Ripple** | Change impact analysis before modifications |
| **Thread** | Session continuity between AI interactions |
| **Echo** | Error-to-symbol mapping for debugging |

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

**Key Point:** "One source of truth in `.paradigm/`, generates instructions for any IDE."

### Getting Started Section

**Headline:** "Up and Running in 60 Seconds"

```bash
# Install
npm install -g @a-company/paradigm

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
4. **Validation** — Ensure consistency with `paradigm purpose validate`

**Example:**
```yaml
# features/checkout/.purpose
features:
  checkout:
    description: Complete purchase flow
    gates: [^authenticated, ^has-items]
    signals: [!checkout-complete, !payment-failed]
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
jq '.stars["@checkout"]' .paradigm/constellation.json
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

---

## 5. Documentation

### Structure

```
Getting Started
├── Installation
├── Quick Start
├── Core Concepts
└── Your First Project

Guides
├── Defining Features with Purpose
├── Setting Up Authorization with Portal
├── Building a Symbol Index with Premise
├── Visualizing with Prism
├── Integrating with Your IDE
└── Optimizing for AI Agents

CLI Reference
├── paradigm init
├── paradigm sync
├── paradigm status
├── paradigm doctor
├── paradigm visualize
├── paradigm constellation
├── paradigm beacon
├── paradigm ripple
├── paradigm thread
├── paradigm echo
├── paradigm purpose validate
├── paradigm portal validate
├── paradigm portal watch
└── paradigm portal report

Specifications
├── Symbol System
├── Purpose File Format
├── Portal File Format
├── Constellation Schema
├── Logger Pattern
└── Probe Protocol

API Reference
├── @a-company/purpose-core
├── @a-company/portal-core
├── @a-company/portal-sdk
├── @a-company/premise-core
└── @a-company/probe-core
```

### Key Documentation Pages

#### Getting Started (Priority)

1. **Installation**
   - npm global install
   - Verify with `paradigm --version`
   - System requirements

2. **Quick Start (5 min)**
   - `paradigm init`
   - Create first `.purpose` file
   - `paradigm sync`
   - `paradigm visualize`

3. **Core Concepts**
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

3. **"Visual Authorization Testing"**
   - Configure portal.yaml
   - Run portal watch
   - Walk through flows
   - Export reports

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
- Ripple shows what changed

#### 2. "For Teams"

**Headline:** "Shared Understanding Without Meetings"

**Pain Points:**
- Onboarding takes forever
- "Ask Sarah, she knows that code"
- Inconsistent feature understanding

**Solution:**
- Purpose files document features
- Constellation shows relationships
- Anyone can understand any area

#### 3. "For AI-Assisted Development"

**Headline:** "Make Your AI Actually Useful"

**Pain Points:**
- AI lacks project context
- Burns tokens reading everything
- Makes changes that break things

**Solution:**
- Agent hints teach query patterns
- JSON output for precise data
- Ripple analysis before changes

#### 4. "For Authorization-Heavy Apps"

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

### Responsive Considerations

- Mobile: Simplified navigation, stacked layouts
- Tablet: Two-column layouts
- Desktop: Full constellation visualizations

---

## 9. Content Priorities

### Phase 1 (Launch)

- [ ] Homepage (all sections)
- [ ] Getting Started guide
- [ ] CLI Reference (core commands)
- [ ] GitHub README polish

### Phase 2 (Post-Launch)

- [ ] Individual product pages
- [ ] Use case pages
- [ ] Video tutorials
- [ ] Example project gallery

### Phase 3 (Growth)

- [ ] Blog with tutorials
- [ ] Community showcase
- [ ] Enterprise features page
- [ ] Integration guides

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

### Meta Descriptions

**Homepage:**
"Paradigm is a developer tools ecosystem that brings structure, authorization, and shared context to modern software projects — for humans and AI agents alike."

**Purpose:**
"Define features and components with .purpose files. Machine-readable context that keeps documentation in sync with code."

**Portal:**
"Visualize and validate authorization topology. See your gates, track permissions, debug auth flows."

**Premise:**
"Aggregate your project into a queryable knowledge graph. Power AI context with structured symbol data."

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

| Symbol | Name | Domain | Example | Description |
|--------|------|--------|---------|-------------|
| `@` | Feature | Purpose | `@checkout` | User-facing capability |
| `#` | Component | Purpose | `#Button` | Reusable code unit |
| `^` | Portal | Portal | `^authenticated` | Authorization gate |
| `!` | Signal | Portal | `!login-failed` | Event or side effect |
| `$` | Flow | Shared | `$purchase-flow` | Multi-step process |
| `%` | State | Purpose | `%user.authenticated` | Data condition |
| `~` | Aspect | Purpose | `@login~validation` | Cross-cutting concern |
| `?` | Idea | Premise | `?add-export` | Future possibility |

---

*Document Version: 1.0*
*Last Updated: 2026-01-27*
