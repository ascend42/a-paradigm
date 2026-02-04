# Paradigm Content Guide

A comprehensive guide for creating YouTube videos, blog posts, and tutorials about the Paradigm framework.

---

## Table of Contents

1. [Content Strategy](#content-strategy)
2. [YouTube Video Series](#youtube-video-series)
3. [Blog Post Series](#blog-post-series)
4. [Production Notes](#production-notes)
5. [Thumbnail & Visual Guidelines](#thumbnail--visual-guidelines)
6. [Call-to-Action Templates](#call-to-action-templates)

---

## Content Strategy

### Target Audiences

| Audience | Pain Point | Content Focus |
|----------|------------|---------------|
| **AI-curious developers** | "AI doesn't understand my project" | Agent efficiency, MCP, context |
| **Teams adopting AI tools** | "Everyone sets up Cursor differently" | Standardization, IDE sync |
| **Solo devs** | "I forget what I was working on" | Thread, Beacon, session continuity |
| **Auth-heavy app builders** | "Auth is a mess to debug" | Portal, visualization |

### Content Pillars

1. **Education** — What is Paradigm, why does it exist
2. **Tutorial** — Step-by-step guides, build-alongs
3. **Demo** — Live coding, showing features in action
4. **Comparison** — Before/after, with/without Paradigm

### Tone

- **Approachable** — No jargon gatekeeping
- **Practical** — Real problems, real solutions
- **Honest** — Acknowledge limitations, don't oversell
- **Developer-to-developer** — Peer conversation, not lecture

---

## YouTube Video Series

### Video 1: "What is Paradigm?" (5-7 min)

**Goal:** Introduce the problem and solution. Viewer should understand the core value proposition.

**Script Outline:**

```
0:00 - Hook (30s)
"Your AI assistant just read 50,000 lines of code... and still doesn't 
know what your app does. Let me show you why, and how to fix it."

0:30 - The Problem (90s)
- Context evaporates (show: asking AI about a feature, it doesn't know)
- Auth is a black box (show: messy middleware code)
- AI works blind (show: token usage, wasted context)

2:00 - The Solution (120s)
- Purpose: Define what things are
- Portal: Define who can access what
- Premise: Aggregate into queryable graph
- Quick visual of the three pillars

4:00 - Quick Demo (90s)
- Run paradigm init
- Show generated files
- Run paradigm visualize (brief glimpse of Prism)

5:30 - CTA (30s)
"Next video: We'll set this up from scratch and build something real."
```

**Key Visuals:**
- Side-by-side: AI without context vs. with Paradigm
- Three pillars diagram
- Brief Prism canvas shot

---

### Video 2: "Getting Started with Paradigm" (10-12 min)

**Goal:** Viewer can set up Paradigm in their own project after watching.

**Script Outline:**

```
0:00 - Hook (20s)
"60 seconds to structured AI context. Let's go."

0:20 - Prerequisites (60s)
- Node.js 18+
- A project (any language/framework)
- Brief mention: works with existing .cursorrules

1:20 - Installation (60s)
- npm install -g @a-company/paradigm
- paradigm --version

2:20 - paradigm init (180s)
- Run the command
- Walk through what's created
- Explain .paradigm/ structure
- Show detection of existing IDE files

5:20 - First .purpose file (180s)
- Create a simple feature definition
- Explain symbols (@, #, ^, !, $, %)
- Run paradigm status

8:20 - paradigm sync (120s)
- Generate IDE instructions
- Show .cursor/rules/ created
- Open in Cursor, show AI now has context

10:20 - Recap & CTA (60s)
"You now have structured context. Next: We'll dive deep into 
the symbol system - the shared language between you and AI."
```

**Key Visuals:**
- Terminal with clear commands
- File explorer showing created files
- Cursor IDE showing generated rules

---

### Video 3: "The Symbol System Explained" (8-10 min)

**Goal:** Viewer understands all 8 symbols and when to use each.

**Script Outline:**

```
0:00 - Hook (20s)
"8 symbols. One shared language. Let's decode them."

0:20 - Why symbols matter (60s)
- Prefixes that work everywhere
- Code, docs, AI prompts, visual tools
- Show: same symbol in different contexts

1:20 - The Symbols (5-6 min, ~45s each)

@ Feature
- User-facing capability
- Example: @checkout, @user-login
- When to use: "If a user would say 'I want to...'"

# Component
- Reusable code unit
- Example: #Button, #api-client
- When to use: Building block, used by features

^ Portal (Gate)
- Authorization checkpoint
- Example: ^authenticated, ^admin-only
- When to use: "Who can access this?"

! Signal
- Events and side effects
- Example: !login-failed, !payment-complete
- When to use: Something happened, notify something

$ Flow
- Multi-step process
- Example: $checkout-flow, $onboarding
- When to use: Spans multiple features/components

% State
- Data conditions
- Example: %user.authenticated, %cart.items
- When to use: Checking or referencing state

~ Aspect (deprecated marker)
- Cross-cutting or deprecated
- Example: ~legacy-api

? Idea
- Future possibilities
- Example: ?add-export-feature

7:20 - Live Demo (90s)
- Add symbols to a real .purpose file
- Run paradigm status to see them indexed
- Show in constellation

8:50 - CTA (30s)
"Now you speak the language. Next: Agent efficiency tools 
that make AI 10x more useful."
```

**Key Visuals:**
- Symbol reference card (on-screen graphic)
- Live coding adding symbols
- Constellation view showing symbols

---

### Video 4: "Agent Efficiency Tools" (10-12 min)

**Goal:** Viewer understands Beacon, Constellation, Ripple, Thread, Echo.

**Script Outline:**

```
0:00 - Hook (30s)
"What if your AI remembered yesterday's session? And knew 
what would break before making changes? Let's build that."

0:30 - The Problem (60s)
- AI has no memory between sessions
- AI doesn't know impact of changes
- You repeat context every conversation

1:30 - Beacon (120s)
- paradigm beacon
- Show the generated beacon.md
- Demo: AI reads beacon first, already oriented
- --json flag for machine consumption

3:30 - Constellation (120s)
- paradigm constellation
- Show constellation.json structure
- jq queries for specific data
- How AI uses this for relationships

5:30 - Ripple (120s)
- paradigm ripple @checkout
- Show upstream/downstream impact
- Demo: Ask AI "what would break?" - it queries ripple
- --json output

7:30 - Thread (120s)
- paradigm thread (show current state)
- paradigm thread save "Added login validation"
- paradigm thread todo "Write tests"
- paradigm thread note "User prefers Zod"
- Session continuity between AI interactions

9:30 - Echo (60s)
- paradigm echo AUTH_001
- Error-to-symbol mapping
- Quick debug workflow

10:30 - Putting It Together (60s)
- Show a real workflow using all tools
- AI queries beacon, uses ripple, saves to thread

11:30 - CTA (30s)
"Static context is so 2024. Next: MCP - dynamic context 
that Claude queries mid-conversation."
```

**Key Visuals:**
- Each tool's output
- Cursor showing AI using the tools
- Thread.md growing during a session

---

### Video 5: "MCP Server - Dynamic AI Context" (12-15 min)

**Goal:** Viewer can set up Claude Desktop with Paradigm MCP.

**Script Outline:**

```
0:00 - Hook (30s)
"What if Claude could ask YOUR PROJECT questions? Not just 
read static files - actually query it. That's MCP."

0:30 - Static vs Dynamic (90s)
- Static: Load everything upfront (~2000 tokens)
- Dynamic: Query only what's needed (~100 tokens per query)
- Diagram showing the difference

2:00 - What is MCP? (60s)
- Model Context Protocol (Anthropic standard)
- Resources: Read-only data
- Tools: Actions AI can invoke
- Any MCP client can use it

3:00 - Installing Claude Desktop (60s)
- Download from claude.ai/download
- Brief install walkthrough

4:00 - Configuration (180s)
- Find config file (macOS/Windows paths)
- Add paradigm MCP server
- Explain the JSON structure
- Restart Claude Desktop

7:00 - Live Demo (300s)
- Open Claude Desktop
- Verify tools are available
- "What features are in this project?" → paradigm_status
- "What would break if I removed ^authenticated?" → paradigm_ripple
- "Find all components related to checkout" → paradigm_search
- Show the tool calls happening

12:00 - Tips & Tricks (120s)
- Multiple projects
- Using with existing Paradigm setup
- When to use MCP vs static rules

14:00 - CTA (30s)
"Your AI now has live access to your project. Next: Let's 
see authorization in action with Portal Viewer."
```

**Key Visuals:**
- Claude Desktop interface
- Tool calls appearing in conversation
- Config file with syntax highlighting

---

### Video 6: "Portal - Visual Authorization" (10-12 min)

**Goal:** Viewer understands portal.yaml and can use Portal Viewer.

**Script Outline:**

```
0:00 - Hook (30s)
"Who can access what? If you can't answer instantly, 
your auth is a black box. Let's open it."

0:30 - The Problem (60s)
- Auth scattered across middleware
- Can't visualize permission relationships
- Debugging auth is painful

1:30 - portal.yaml Basics (180s)
- Create a portal.yaml
- Define ^authenticated gate
- Define ^admin-only with requires
- Explain keys, locks, prizes

4:30 - Connecting to Features (90s)
- Add gates to .purpose features
- Run paradigm status - see gates counted
- Show in constellation

6:00 - Portal Viewer (180s)
- paradigm portal watch
- Open the viewer
- Walk through a user journey
- Watch gates light up in real-time

9:00 - Debugging Demo (120s)
- Intentionally misconfigure a gate
- See the failure in viewer
- Fix and validate

11:00 - CTA (30s)
"Authorization as a first-class citizen. Next: Explore 
everything in Prism - the infinite canvas."
```

**Key Visuals:**
- Portal Viewer with gates lighting up
- Side-by-side: code and visualization
- Gate topology diagram

---

### Video 7: "Prism - The Infinite Canvas" (8-10 min)

**Goal:** Viewer can use Prism to explore their project visually.

**Script Outline:**

```
0:00 - Hook (20s)
"Your entire project, on an infinite canvas. Let's explore."

0:20 - Launch Prism (60s)
- paradigm visualize
- Browser opens
- Overview of the interface

1:20 - Constellation View (180s)
- Symbols as nodes
- Connections showing relationships
- Zoom, pan, select
- Filter by type

4:20 - Properties Panel (120s)
- Click a symbol
- See details, references, tags
- Navigate to related symbols

6:20 - Command Input (90s)
- Search for symbols
- Keyboard shortcuts
- Quick navigation

7:50 - Use Cases (90s)
- Onboarding: "Show me the shape of this project"
- Planning: "What depends on this feature?"
- Debugging: "Where is this component used?"

9:20 - CTA (30s)
"That's the full Paradigm experience. Check the description 
for the tutorial project where we build this from scratch."
```

**Key Visuals:**
- Full-screen Prism canvas
- Smooth navigation demos
- Before/after: code vs visual

---

## Blog Post Series

### Post 1: "Why Your AI Needs Better Context"

**Word count:** 1200-1500

**Outline:**
1. Hook: The context problem in AI-assisted development
2. The math: Token efficiency (2000 vs 100 tokens)
3. What context actually matters
4. Introducing Paradigm (brief)
5. CTA: Get started guide

**Key quote:** "Your AI reads everything and understands nothing. Structure changes that."

---

### Post 2: "From .cursorrules to Paradigm"

**Word count:** 1500-2000

**Outline:**
1. The evolution of AI context files
2. Problems with monolithic rules files
3. The Paradigm approach: structured source of truth
4. Migration walkthrough (with code)
5. Before/after comparison
6. CTA: paradigm init --migrate

**Key quote:** "Stop maintaining 5 copies of the same rules. One source, many outputs."

---

### Post 3: "The Symbol System: A Shared Language"

**Word count:** 2000-2500

**Outline:**
1. Why naming things matters
2. The 8 symbols deep dive (with examples)
3. Symbol naming conventions
4. Symbols in different contexts (code, docs, AI)
5. Building a symbol vocabulary for your project
6. CTA: Symbol reference card download

**Key quote:** "@checkout means the same thing in code, docs, and AI prompts. That's the point."

---

### Post 4: "MCP: The Future of AI Context"

**Word count:** 1800-2200

**Outline:**
1. What is Model Context Protocol
2. Static vs Dynamic context (with diagram)
3. Paradigm's MCP server explained
4. Setup tutorial (Claude Desktop)
5. Example conversations
6. The future: MCP everywhere
7. CTA: Full MCP guide

**Key quote:** "Static files are a snapshot. MCP is a live connection to your project."

---

### Post 5: "Authorization Topology with Portal"

**Word count:** 1500-2000

**Outline:**
1. The auth black box problem
2. Thinking in topology, not middleware
3. portal.yaml structure
4. Portal Viewer walkthrough
5. Testing and validation
6. CTA: Try portal watch

**Key quote:** "If you can't draw your auth, you don't understand your auth."

---

## Production Notes

### Video Structure Template

```
[Hook]         0:00 - 0:30   Grab attention, state the problem
[Problem]      0:30 - 2:00   Expand on pain point, relatable examples
[Solution]     2:00 - Main   The bulk - teaching, demo, walkthrough
[Recap]        -1:30         Summarize key points
[CTA]          -0:30         Next video, subscribe, links
```

### Screen Recording Setup

- **Resolution:** 1920x1080 minimum, 4K preferred
- **Terminal:** Dark theme, large font (16-18pt)
- **Editor:** Dark theme, hide unnecessary panels
- **Browser:** Clean profile, no bookmarks bar, dark mode

### Audio

- Clear voiceover, conversational tone
- Light background music (optional, very low)
- Sound effects for tool outputs (subtle)

### Code Examples

- Use the TaskFlow tutorial project for all demos
- Keep code snippets short (< 20 lines)
- Highlight the relevant parts

---

## Thumbnail & Visual Guidelines

### Thumbnail Templates

| Video | Main Visual | Text |
|-------|-------------|------|
| V1: What is Paradigm | Three pillars diagram | "AI Context Problem SOLVED" |
| V2: Getting Started | Terminal + check mark | "5 Min Setup" |
| V3: Symbol System | Symbol icons grid | "@ # ^ ! $ %" |
| V4: Agent Efficiency | Brain + lightning | "10x AI Productivity" |
| V5: MCP Server | Claude + connection | "Live AI Context" |
| V6: Portal | Lock/unlock visual | "Visual Auth" |
| V7: Prism | Canvas screenshot | "Infinite Canvas" |

### Color Palette

Use Paradigm's symbol colors:
- Feature blue (@) — #3b82f6
- Component green (#) — #22c55e
- Portal red (^) — #ef4444
- Signal yellow (!) — #eab308
- Flow purple ($) — #8b5cf6
- State cyan (%) — #06b6d4

### Typography

- **Titles:** Bold, clean sans-serif
- **Code:** JetBrains Mono or similar
- **Accents:** Symbol prefixes in their colors

---

## Call-to-Action Templates

### End of Video

```
"If this helped, hit subscribe - we're building the future of AI development.

Links in the description:
- GitHub repo
- Full documentation
- Discord community

Next video: [Title] - dropping [day]."
```

### End of Blog Post

```
---

## Get Started

```bash
npm install -g @a-company/paradigm
paradigm init
```

- [Full documentation](https://github.com/ascend42/a-paradigm#readme)
- [GitHub repository](https://github.com/ascend42/a-paradigm)
- [Discord community](https://discord.gg/paradigm) <!-- TODO: Update with actual Discord link -->

Questions? Drop a comment or find us on Discord.
```

### Social Media Teaser

```
Your AI doesn't understand your project.

Not because it's dumb.
Because it has no structure.

Paradigm gives your project a shared language:
@ Features
# Components
^ Gates
! Signals

One source of truth. Every IDE. Every AI.

[link]
```

---

*Last Updated: 2026-01-27*
