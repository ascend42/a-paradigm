# Paradigm Distribution Strategy

## Current Status (Post-npm issues)

### Primary Distribution: GitHub Direct

```bash
# Install globally
npm install -g github:ascend42/a-paradigm
bun add -g github:ascend42/a-paradigm

# Run without installing
npx github:ascend42/a-paradigm <command>
bunx github:ascend42/a-paradigm <command>
```

**Pros:**
- Zero registry auth needed
- Works immediately after git push
- Users always get latest from main (or can pin to tags)

**Cons:**
- Longer install command
- No npm version badges
- Builds from source (slightly slower first install)

---

## Future: JSR (jsr.io) Migration

When ready for a polished registry experience:

### 1. Setup JSR Account
- Go to https://jsr.io
- Sign in with GitHub
- Create `@paradigm` scope

### 2. Add JSR Config
Create `jsr.json` in each publishable package:

```json
{
  "name": "@paradigm/cli",
  "version": "2.0.0",
  "exports": "./dist/index.js"
}
```

### 3. Publish
```bash
npx jsr publish
```

### 4. Users Install
```bash
npx jsr add @paradigm/cli
bunx jsr add @paradigm/cli
deno add @paradigm/cli
```

---

## Website Strategy

### Recommended: Separate Repo

Create `paradigm-website` repo for:
- Marketing site (paradigm.dev or similar)
- Documentation
- Interactive demos

**Stack suggestion:**
- **Astro** or **Next.js** for static + dynamic
- **Starlight** (Astro) for docs - great DX, built-in search
- **Vercel** or **Cloudflare Pages** for hosting

### Website Structure

```
paradigm-website/
├── src/
│   ├── pages/
│   │   ├── index.astro          # Landing page
│   │   ├── docs/                # Documentation
│   │   │   ├── getting-started.md
│   │   │   ├── commands/
│   │   │   ├── concepts/
│   │   │   └── mcp/
│   │   ├── playground/          # Interactive demos
│   │   └── blog/                # Updates, tutorials
│   └── components/
├── public/
│   └── og-images/
└── astro.config.mjs
```

### Key Pages

1. **Landing Page**
   - Hero: "Structure for AI-Native Development"
   - Problem/Solution (3 pillars)
   - Quick install command
   - Live terminal demo (asciinema or similar)
   - Testimonials/use cases

2. **Docs**
   - Getting Started (5 min quickstart)
   - Commands Reference
   - Symbol System Guide
   - MCP Integration
   - Multi-Agent Orchestration
   - Migrating from X

3. **Playground** (stretch goal)
   - Try Paradigm in browser
   - Sample project explorer
   - Symbol graph visualization

### Domain Options
- `paradigm.dev` (if available)
- `useparadigm.dev`
- `getparadigm.dev`
- `paradigm-tools.dev`

---

## Release Workflow

### Current (GitHub-only)

1. Make changes
2. `git add -A && git commit`
3. `git push origin main`
4. Users get latest with `npm i -g github:ascend42/a-paradigm`

### With Tags (Versioning)

```bash
# Tag a release
git tag v2.0.0
git push origin v2.0.0

# Users can pin version
npm install -g github:ascend42/a-paradigm#v2.0.0
```

### GitHub Releases

Create releases for:
- Changelog visibility
- Pre-built binaries (optional)
- Release notes

```bash
# Create release via CLI
gh release create v2.0.0 --notes "See CHANGELOG.md for details"
```

---

## Marketing Launch Checklist

### Pre-Launch
- [ ] Website live with docs
- [ ] GitHub README polished
- [ ] Example project complete (shopflow)
- [ ] Video walkthrough (optional)
- [ ] Twitter/X thread drafted

### Launch Day
- [ ] Announce on Twitter/X
- [ ] Post on Hacker News
- [ ] Post on Reddit (r/programming, r/webdev, r/cursor)
- [ ] Dev.to article
- [ ] Discord communities

### Post-Launch
- [ ] Gather feedback
- [ ] Address issues quickly
- [ ] Plan v2.1.0 based on feedback

---

## Immediate Next Steps

1. **Push current changes** (README update)
2. **Tag v2.0.0** for stable reference
3. **Create GitHub Release** with changelog
4. **Test installation** from GitHub
5. **Create paradigm-website repo** (when ready)

---

## Installation Testing

After pushing, verify these work:

```bash
# Fresh install test
npm install -g github:ascend42/a-paradigm
paradigm --version
paradigm --help

# Direct execution test
npx github:ascend42/a-paradigm init --dry-run

# Bun test
bun add -g github:ascend42/a-paradigm
```
