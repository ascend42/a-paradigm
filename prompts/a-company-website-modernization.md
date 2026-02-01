# A-Company Website Modernization Prompt

Use this prompt to update the a-company.org website to modern standards with Paradigm as the flagship product.

---

## Context for AI Assistant

I need to modernize the a-company.org website. It's currently out of date and needs to be rebuilt/updated to serve as the home for **Paradigm** — our AI-native developer tools framework.

### Reference Documents

Before making changes, read these files from the a-horizon repository:
- `A-COMPANY-WEBSITE-VISION.md` — Full website vision, structure, and content strategy
- `README.md` — Paradigm overview and features
- `CHANGELOG.md` — Latest features (v0.7.0)
- `DISTRIBUTION.md` — Installation methods (GitHub-direct, no npm)

### Current State

The a-company.org website is outdated and needs:
1. Modern framework (Astro + Starlight recommended)
2. Paradigm as the hero product
3. Proper documentation structure
4. Blog/content system
5. Modern styling (Tailwind, dark mode)

---

## Tasks

### 1. Audit Current State

First, explore the existing codebase:
- What framework is currently used?
- What content exists?
- What can be salvaged vs rebuilt?
- Check package.json for dependencies

### 2. Modernize Infrastructure

If not already using Astro, migrate to:

```bash
# Create new Astro project with Starlight
npm create astro@latest a-company-website -- --template starlight
cd a-company-website
npm install
```

Or if updating existing Astro:
```bash
npm update
npx @astrojs/upgrade
```

### 3. Implement Site Structure

Create this folder structure:

```
src/
├── pages/
│   ├── index.astro              # Homepage
│   ├── about.astro              # About A-Company
│   ├── tools.astro              # Tools overview
│   └── blog/
│       ├── index.astro          # Blog listing
│       └── [...slug].astro      # Blog posts
├── content/
│   ├── docs/                    # Paradigm documentation
│   │   ├── index.mdx            # Docs landing
│   │   ├── getting-started/
│   │   │   ├── installation.mdx
│   │   │   ├── quickstart.mdx
│   │   │   └── core-concepts.mdx
│   │   ├── commands/
│   │   │   ├── init.mdx
│   │   │   ├── sync.mdx
│   │   │   ├── beacon.mdx
│   │   │   ├── constellation.mdx
│   │   │   ├── ripple.mdx
│   │   │   ├── thread.mdx
│   │   │   ├── team.mdx
│   │   │   ├── lint.mdx
│   │   │   ├── cost.mdx
│   │   │   └── mcp.mdx
│   │   ├── symbols/
│   │   │   ├── overview.mdx
│   │   │   ├── features.mdx      # @ symbols
│   │   │   ├── components.mdx    # # symbols
│   │   │   ├── portals.mdx       # ^ symbols
│   │   │   ├── signals.mdx       # ! symbols
│   │   │   ├── flows.mdx         # $ symbols
│   │   │   └── state.mdx         # % symbols
│   │   ├── mcp/
│   │   │   ├── overview.mdx
│   │   │   ├── cursor-setup.mdx
│   │   │   ├── claude-setup.mdx
│   │   │   └── resources-tools.mdx
│   │   ├── team/
│   │   │   ├── overview.mdx
│   │   │   ├── agents.mdx
│   │   │   └── handoffs.mdx
│   │   └── migration/
│   │       ├── from-cursorrules.mdx
│   │       └── from-horizon.mdx
│   └── blog/
│       ├── 2026-02-01-paradigm-v0.7.0.mdx
│       └── ...
├── components/
│   ├── Hero.astro
│   ├── Terminal.astro           # Animated terminal component
│   ├── FeatureGrid.astro
│   ├── ThreePillars.astro
│   ├── InstallBlock.astro
│   └── SymbolTable.astro
└── styles/
    └── global.css
```

### 4. Homepage Content

Create a compelling homepage with:

**Hero Section:**
```
A-COMPANY
Tools for AI-Native Development

Your AI assistant reads 10,000 tokens and still doesn't
understand your codebase. We fix that.

[Get Started with Paradigm →]  [GitHub]
```

**Paradigm Feature Section:**
- Three pillars (Purpose, Portal, Premise)
- Terminal animation showing `paradigm init`
- Key features grid

**Install Block:**
```bash
# Install from GitHub
npm install -g github:ascend42/a-horizon

# Or run directly
npx github:ascend42/a-horizon init
```

### 5. Paradigm Landing Page (`/paradigm`)

Dedicated page with:
- Hero specific to Paradigm
- Problem/Solution comparison
- Feature deep-dives
- Quick start guide
- Links to documentation

### 6. Documentation Setup (Starlight)

Configure Starlight in `astro.config.mjs`:

```javascript
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Paradigm',
      logo: {
        src: './src/assets/paradigm-logo.svg',
      },
      social: {
        github: 'https://github.com/ascend42/a-horizon',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', link: '/docs/getting-started/installation/' },
            { label: 'Quick Start', link: '/docs/getting-started/quickstart/' },
            { label: 'Core Concepts', link: '/docs/getting-started/core-concepts/' },
          ],
        },
        {
          label: 'Commands',
          autogenerate: { directory: 'docs/commands' },
        },
        {
          label: 'Symbol System',
          autogenerate: { directory: 'docs/symbols' },
        },
        {
          label: 'MCP Integration',
          autogenerate: { directory: 'docs/mcp' },
        },
        {
          label: 'Multi-Agent Teams',
          autogenerate: { directory: 'docs/team' },
        },
        {
          label: 'Migration',
          autogenerate: { directory: 'docs/migration' },
        },
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
```

### 7. Styling

Use dark mode by default with purple/cyan accent colors (matching Paradigm CLI):

```css
/* src/styles/custom.css */
:root {
  --sl-color-accent-low: #3b1d5c;
  --sl-color-accent: #9333ea;
  --sl-color-accent-high: #c084fc;
  --sl-color-white: #ffffff;
  --sl-color-gray-1: #eceef2;
  --sl-color-gray-2: #c0c2c7;
  --sl-color-gray-3: #888b96;
  --sl-color-gray-4: #545861;
  --sl-color-gray-5: #353841;
  --sl-color-gray-6: #24272f;
  --sl-color-black: #17181c;
}

:root[data-theme='dark'] {
  --sl-color-bg: var(--sl-color-black);
}
```

### 8. Key Content to Create

**Priority 1 (MVP):**
- [ ] Homepage
- [ ] `/paradigm` landing page
- [ ] Installation guide
- [ ] 5-minute quickstart
- [ ] Commands reference (at least init, sync, beacon)
- [ ] Symbol system overview

**Priority 2 (Polish):**
- [ ] Full command documentation
- [ ] MCP setup guides (Cursor, Claude)
- [ ] Multi-agent team docs
- [ ] Blog with v0.7.0 announcement

**Priority 3 (Growth):**
- [ ] Interactive terminal component
- [ ] Playground/sandbox
- [ ] Case studies
- [ ] Video tutorials

### 9. Installation Content

**Critical:** Update all installation instructions to use GitHub-direct:

```bash
# Global install
npm install -g github:ascend42/a-horizon
bun add -g github:ascend42/a-horizon

# Run without installing
npx github:ascend42/a-horizon <command>
bunx github:ascend42/a-horizon <command>
```

**NOT** npm registry (currently not published there).

### 10. MCP Documentation

Create comprehensive MCP guides:

**Cursor Setup (`/docs/mcp/cursor-setup.mdx`):**
```markdown
# MCP Setup for Cursor

## Quick Setup

\`\`\`bash
paradigm mcp setup --client cursor
\`\`\`

## Manual Setup

1. Open Cursor Settings
2. Navigate to MCP section
3. Add server configuration...

[Full instructions]
```

**Claude Desktop Setup (`/docs/mcp/claude-setup.mdx`):**
```markdown
# MCP Setup for Claude Desktop

## Configuration File

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

\`\`\`json
{
  "mcpServers": {
    "paradigm": {
      "command": "npx",
      "args": ["github:ascend42/a-horizon", "mcp", "serve"],
      "cwd": "/path/to/your/project"
    }
  }
}
\`\`\`

## Available Resources & Tools

| Resource | Description |
|----------|-------------|
| paradigm://symbols | All project symbols |
| paradigm://gates | Authorization gates |
...
```

### 11. Blog System

Set up content collections for blog:

```javascript
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.date(),
    author: z.string().default('A-Company'),
    tags: z.array(z.string()).optional(),
  }),
});

export const collections = { blog };
```

Create first blog post: **"Introducing Paradigm v0.7.0"**
- Multi-agent orchestration
- Lint command with auto-fix
- Cost analysis
- Auto-scan
- MCP improvements

### 12. SEO Setup

Add to each page:
- Proper meta titles/descriptions
- Open Graph images
- Schema markup for software

```astro
---
// src/pages/paradigm.astro
const title = "Paradigm - Structure for AI-Native Development";
const description = "Give your AI the context it needs. Define features, authorization, and relationships in a way both humans and AI can understand.";
---
<html>
  <head>
    <title>{title}</title>
    <meta name="description" content={description} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:image" content="/og/paradigm.png" />
  </head>
  ...
</html>
```

---

## Checklist

- [ ] Audit current codebase
- [ ] Set up Astro + Starlight (or update existing)
- [ ] Create folder structure
- [ ] Build homepage with Paradigm hero
- [ ] Create Paradigm landing page
- [ ] Write Getting Started docs
- [ ] Write Commands reference
- [ ] Write Symbol System guide
- [ ] Write MCP setup guides
- [ ] Set up blog with v0.7.0 post
- [ ] Configure dark theme with brand colors
- [ ] Add SEO meta tags
- [ ] Test locally
- [ ] Deploy to Vercel/Cloudflare

---

## Reference: Key Features to Document

From Paradigm v0.7.0:

**Commands:**
- `paradigm init` - Initialize with smart detection
- `paradigm sync` - Generate IDE instructions
- `paradigm beacon` - AI orientation file
- `paradigm constellation` - Symbol graph
- `paradigm ripple` - Impact analysis
- `paradigm thread` - Session continuity
- `paradigm team` - Multi-agent orchestration
- `paradigm lint` - Validate .purpose files
- `paradigm cost` - Token usage analysis
- `paradigm scan auto` - Auto-generate .purpose
- `paradigm mcp setup` - Configure MCP for AI clients

**Symbol System:**
- `@` Features
- `#` Components
- `^` Portals (gates)
- `!` Signals
- `$` Flows
- `%` State

**IDE Support:**
- Cursor (.cursor/rules/)
- GitHub Copilot (.github/instructions/)
- Windsurf (.windsurfrules)
- Claude (CLAUDE.md)

---

## Final Notes

- Keep installation instructions GitHub-direct (not npm)
- Dark mode default (developer-friendly)
- Mobile responsive
- Fast load times (Astro handles this)
- Clear navigation between docs sections

The goal is a professional, comprehensive site that positions A-Company as the home for AI-native developer tools, with Paradigm as the flagship product.
