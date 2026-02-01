# A-Company Website Vision

> **A-Company** — Tools for AI-Native Development

## The Big Picture

A-Company is the umbrella brand for developer tools designed for the AI era. Rather than fragmenting across multiple domains, everything lives under `a-company.org` — establishing credibility, compounding SEO, and creating a cohesive developer experience.

**Paradigm** is the flagship product: a framework that brings structure, authorization, and shared context to codebases so AI agents can actually understand them.

---

## Brand Positioning

### Tagline Options
- "Tools for AI-Native Development"
- "Structure for the AI Era"
- "Making Codebases AI-Ready"

### Core Message
> Modern AI agents are powerful but blind. They read thousands of tokens without understanding what matters. A-Company builds the tools that give AI the structure it needs to be truly effective.

### Target Audience
1. **Solo developers** using Cursor, Claude, Copilot
2. **Teams** adopting AI-assisted development
3. **Enterprises** wanting governance over AI context
4. **AI agent builders** needing structured project data

---

## Site Structure

```
a-company.org/
│
├── /                           # Homepage
│   └── Hero: "Tools for AI-Native Development"
│   └── Featured: Paradigm
│   └── Philosophy section
│   └── Newsletter signup
│
├── /paradigm                   # Paradigm Product Hub
│   ├── /                       # Paradigm landing page
│   ├── /docs                   # Full documentation
│   │   ├── /getting-started
│   │   ├── /commands
│   │   ├── /symbols
│   │   ├── /mcp
│   │   ├── /team
│   │   └── /migration
│   ├── /quickstart             # 5-minute setup guide
│   ├── /playground             # Interactive demo (stretch)
│   └── /changelog              # Version history
│
├── /tools                      # All Tools Overview
│   └── Grid of current/future tools
│
├── /blog                       # Content hub
│   ├── Tutorials
│   ├── Release notes
│   ├── AI development insights
│   └── Case studies
│
├── /about                      # Company/creator story
│
└── /community                  # Discord, GitHub, etc.
```

---

## Page-by-Page Blueprint

### Homepage (`/`)

**Hero Section**
```
A-COMPANY
Tools for AI-Native Development
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your AI assistant reads 10,000 tokens and still doesn't
understand your codebase. We fix that.

[Get Started with Paradigm] [View on GitHub]
```

**Featured Product: Paradigm**
- Quick visual explanation (3 pillars)
- Terminal animation showing `paradigm init`
- "Learn more →" link

**Philosophy Section**
- Why structured context matters
- The problem with current AI development
- Our approach

**Social Proof** (as it builds)
- GitHub stars
- User testimonials
- "Used by X developers"

---

### Paradigm Landing (`/paradigm`)

**Hero**
```
PARADIGM
Structure for AI-Native Development
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Give your AI the context it needs. Define features,
authorization, and relationships in a way both
humans and AI can understand.

[Quick Start] [Documentation] [GitHub]
```

**The Problem/Solution**
Visual comparison:
- ❌ Without Paradigm: AI guesses, hallucinates, misses context
- ✅ With Paradigm: AI queries structured symbols, understands gates, knows impact

**Three Pillars**
| Purpose | Portal | Premise |
|---------|--------|---------|
| Define what things are | Define who can access | Aggregate into knowledge |
| `.purpose` files | `portal.yaml` | Symbol graph |

**Quick Install**
```bash
# Install
npm install -g github:ascend42/a-horizon

# Initialize
paradigm init

# See the magic
paradigm beacon
```

**Feature Grid**
- Symbol System (@, #, ^, !, $, %)
- Multi-Agent Orchestration
- MCP Integration
- IDE Support (Cursor, Copilot, etc.)
- Cost Analysis
- Auto-Scan

**Testimonials/Use Cases**
(Build over time)

---

### Documentation (`/paradigm/docs`)

**Structure:**

```
Getting Started
├── Installation
├── Your First Project
├── Core Concepts
└── 5-Minute Quickstart

Commands Reference
├── init, sync, doctor
├── beacon, constellation, ripple
├── thread, echo
├── team (multi-agent)
├── lint, cost, scan
└── mcp

Symbol System
├── Overview
├── @ Features
├── # Components
├── ^ Portals (Gates)
├── ! Signals
├── $ Flows
└── % State

MCP Integration
├── What is MCP?
├── Setup Guide
├── Cursor Configuration
├── Claude Desktop Configuration
├── Available Resources & Tools
└── Example Workflows

Multi-Agent Orchestration
├── Concept
├── Agent Roles
├── Handoff Protocol
├── Team Commands
└── Best Practices

Migration
├── From .cursorrules
├── From Horizon
└── From scratch
```

**Doc Page Template:**
```markdown
# Command Name

Brief description of what it does.

## Usage

\`\`\`bash
paradigm command [options]
\`\`\`

## Options

| Flag | Description | Default |
|------|-------------|---------|
| --flag | What it does | value |

## Examples

\`\`\`bash
# Example 1
paradigm command --flag

# Example 2
paradigm command --other-flag
\`\`\`

## Related

- [Other Command](/paradigm/docs/commands/other)
- [Concept](/paradigm/docs/concepts/thing)
```

---

### Blog (`/blog`)

**Content Categories:**

1. **Release Notes**
   - "Paradigm v0.7.0: Multi-Agent Orchestration"
   - "Introducing Cost Analysis"

2. **Tutorials**
   - "Setting Up Paradigm in 5 Minutes"
   - "Making Your React App AI-Ready"
   - "Multi-Agent Workflows with Paradigm"

3. **Insights**
   - "Why AI Needs Structure, Not Just Context"
   - "The Token Economy: How Much Does AI Context Cost?"
   - "The Future of AI-Assisted Development"

4. **Case Studies**
   - "How X Reduced AI Hallucinations by 80%"
   - (Build these as users adopt)

---

## Visual Design Direction

### Color Palette
- **Primary**: Deep purple/magenta (matches CLI banner)
- **Secondary**: Cyan/teal (accent)
- **Background**: Dark mode default (dev-friendly)
- **Text**: High contrast white/gray

### Typography
- **Headings**: Mono or geometric sans (JetBrains Mono, Inter)
- **Body**: Clean sans-serif
- **Code**: JetBrains Mono or Fira Code

### Visual Elements
- Terminal windows (real output, not mockups)
- Syntax-highlighted code blocks
- Animated diagrams for concepts
- Constellation/graph visualizations

---

## Technical Implementation

### Recommended Stack

```
Framework:    Astro (static + islands)
Docs:         Starlight (Astro plugin)
Styling:      Tailwind CSS
Animations:   Framer Motion or CSS
Code blocks:  Shiki (built into Astro)
Search:       Pagefind (static search)
Hosting:      Vercel or Cloudflare Pages
Analytics:    Plausible or Fathom (privacy-first)
```

### Why Astro + Starlight?
- Fast static output
- Great DX for documentation
- Built-in search, navigation, versioning
- Islands architecture for interactive bits
- SEO-optimized out of the box

### Repository Structure

```
a-company-website/
├── src/
│   ├── pages/
│   │   ├── index.astro           # Homepage
│   │   ├── about.astro
│   │   ├── tools.astro
│   │   └── blog/
│   │       ├── index.astro
│   │       └── [...slug].astro
│   ├── content/
│   │   ├── docs/                 # Paradigm docs (MDX)
│   │   └── blog/                 # Blog posts (MDX)
│   ├── components/
│   │   ├── Hero.astro
│   │   ├── Terminal.astro
│   │   ├── FeatureGrid.astro
│   │   └── ...
│   └── layouts/
├── public/
│   ├── og-images/
│   └── assets/
├── astro.config.mjs
└── package.json
```

---

## SEO Strategy

### Target Keywords

**Primary:**
- "AI development tools"
- "AI code context"
- "AI agent framework"
- "Cursor IDE setup"
- "Claude MCP server"

**Long-tail:**
- "how to give AI context about my codebase"
- "cursor rules best practices"
- "multi-agent AI development"
- "reduce AI token usage"

### Content SEO

1. **Docs double as SEO pages**
   - Each command page targets "paradigm [command]"
   - Concept pages target educational queries

2. **Blog builds authority**
   - Tutorial posts rank for "how to" queries
   - Insight posts attract backlinks

3. **Technical structure**
   - Clean URLs (`/paradigm/docs/commands/beacon`)
   - Proper meta tags, OG images
   - Schema markup for software

---

## Launch Phases

### Phase 1: MVP (Ship Fast)
- [ ] Homepage with Paradigm hero
- [ ] Paradigm landing page
- [ ] Docs: Getting started + command reference
- [ ] GitHub links, installation instructions
- [ ] Basic blog with v0.7.0 announcement

### Phase 2: Polish
- [ ] Full documentation coverage
- [ ] Interactive terminal demos
- [ ] More blog content
- [ ] Search functionality
- [ ] Community links (Discord?)

### Phase 3: Growth
- [ ] Case studies
- [ ] Video content
- [ ] Playground/sandbox
- [ ] Newsletter
- [ ] Additional tools under A-Company

---

## Content Priorities (What to Write First)

1. **Getting Started Guide** — Most important page
2. **Symbol System Overview** — Core concept
3. **Commands Reference** — Practical documentation
4. **MCP Setup Guide** — Key differentiator
5. **v0.7.0 Announcement** — Launch blog post
6. **Why AI Needs Structure** — Thought leadership

---

## Success Metrics

### Traffic
- Organic search growth
- GitHub referrals
- Direct visits (brand awareness)

### Engagement
- Docs page depth
- Time on site
- GitHub stars/forks

### Conversion
- CLI installs (track via GitHub API)
- MCP setups (harder to track)
- Community joins

---

## Summary

**The Play:**
1. Build a-company.org as the home for AI-native dev tools
2. Launch with Paradigm as the flagship, fully documented
3. Use blog for SEO and thought leadership
4. Expand with more tools under the A-Company umbrella

**Why This Works:**
- Single domain compounds authority
- Professional "company" presence
- Scalable for future products
- No domain hunting headaches

**Next Steps:**
1. Finalize a-company.org domain/hosting
2. Set up Astro + Starlight
3. Port/write core documentation
4. Ship MVP
5. Announce on socials

---

*"A-Company: Because AI shouldn't have to guess."*
