# Implementation Guides

This directory contains detailed implementation guides for major Paradigm features and architectural changes.

## Available Guides

### [MCP-First Migration v1.4.0](./mcp-first-migration-v1.4.0.md)

**Status:** Ready for Implementation  
**Complexity:** Medium (4-6 hours)  
**Impact:** High (76% template size reduction)

Migrates Paradigm to MCP-first architecture with integrated cost tracking:
- Templates: 260KB → 61KB
- Prompts, specs, docs served via MCP on-demand
- Session cost tracking and smart handoff recommendations

**Phases:**
1. MCP Resources (2-3h)
2. Cost Tracking (1-2h)
3. Template Cleanup (30m)
4. Documentation (1h)
5. Testing (1h)

**Prerequisites:**
- Existing MCP infrastructure (already in place)
- Understanding of MCP resource patterns
- TypeScript/Node.js build tools

**Handoff Ready:** ✅ Complete specification for Claude Opus

---

## Guide Format

Each guide includes:
- **Executive Summary** - Quick overview and impact
- **Architecture Overview** - Visual diagrams and comparisons
- **Phase-by-Phase Implementation** - Step-by-step instructions with code
- **Testing & Validation** - Comprehensive test scenarios
- **Rollback Plan** - Safety net if issues arise
- **Success Criteria** - Clear definition of done

## Creating New Guides

When creating implementation guides:
1. Write for another AI agent (Claude Opus/Sonnet)
2. Include complete code examples (not just outlines)
3. Provide architecture diagrams (mermaid)
4. Include rollback procedures
5. Define clear success metrics
6. Estimate time for each phase

## Usage

These guides are designed to be:
- **Handed off** to other AI agents for execution
- **Referenced** during implementation
- **Used for onboarding** new team members
- **Archived** as implementation history

---

**Last Updated:** 2026-02-04  
**Maintainer:** Paradigm Core Team
