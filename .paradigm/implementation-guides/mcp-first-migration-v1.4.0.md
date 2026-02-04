# MCP-First Migration & Cost Tracking - v1.4.0 Implementation Guide

> **Handoff Document for Claude Opus**
> 
> This guide contains the complete implementation plan for migrating Paradigm to an MCP-first architecture with integrated cost tracking. Follow the phases sequentially, testing as you go.

---

## Executive Summary

**Goal:** Reduce `.paradigm/` template size from 260KB to 61KB (76% reduction) by moving reference content to on-demand MCP resources, while adding intelligent session cost tracking.

**Impact:**
- Templates: 260KB → 61KB (37,490 tokens saved per project)
- Cost savings: ~$0.11 per full read
- Better signal-to-noise: Only essential content loaded upfront
- Smart handoffs: MCP tracks usage and recommends handoffs

**Timeline:** ~4-6 hours
- Phase 1: MCP Resources (2-3 hours)
- Phase 2: Cost Tracking (1-2 hours)
- Phase 3: Template Cleanup (30 min)
- Phase 4: Documentation (1 hour)
- Phase 5: Testing (1 hour)

---

## Architecture Overview

### Before: Upfront Loading (260KB)

```
New Project Init
  ↓
.paradigm/ created (260KB)
  ├── prompts/ (86KB) ← All 10 prompt templates
  ├── specs/ (82KB) ← All specifications
  ├── docs/ (50KB) ← All documentation
  └── config.yaml (6KB)
  ↓
AI Agent reads everything
  ↓
~65,000 tokens loaded
```

### After: MCP-First (61KB + On-Demand)

```
New Project Init
  ↓
.paradigm/ created (61KB)
  ├── specs/ (42KB) ← Core specs only
  ├── docs/ (25KB) ← Project-specific only
  └── config.yaml (6KB)
  ↓
AI Agent reads essentials (~16K tokens)
  ↓
Queries MCP when needed:
  - paradigm://prompts/add-feature (850 tokens)
  - paradigm://specs/disciplines (1,450 tokens)
  - paradigm://docs/commands (3,500 tokens)
  ↓
MCP tracks all reads/calls
  ↓
Smart handoff recommendations
```

---

## Phase 1: Implement MCP Resources (2-3 hours)

### 1.1 Create Prompts Resource Handler

**File:** `packages/paradigm-mcp/src/resources/prompts.ts`

```typescript
/**
 * MCP Resource Handler for Paradigm Prompts
 * 
 * Serves 10 task template prompts on-demand instead of
 * loading them upfront in every project.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectContext } from '../types/index.js';

// Prompt metadata
const PROMPTS = [
  { name: 'add-feature', description: 'Add a new @feature to the project', size: 3467 },
  { name: 'add-gate', description: 'Add authorization ^gate to portal.yaml', size: 3060 },
  { name: 'debug-auth', description: 'Debug authentication and portal issues', size: 3640 },
  { name: 'implement-ftux', description: 'Build first-time user experience flow', size: 19199 },
  { name: 'implement-sandbox', description: 'Create freemium sandbox mode', size: 17270 },
  { name: 'read-docs', description: 'Read and understand Paradigm documentation', size: 1885 },
  { name: 'refactor', description: 'Refactor code while maintaining symbols', size: 2152 },
  { name: 'run-e2e-tests', description: 'Set up portal-driven E2E testing', size: 9306 },
  { name: 'trace-flow', description: 'Trace $flow through the codebase', size: 4242 },
  { name: 'validate-portals', description: 'Validate portal.yaml configuration', size: 7157 },
];

/**
 * List available prompt resources
 */
export function getPromptsResourcesList() {
  return [
    {
      uri: 'paradigm://prompts',
      name: 'Available Task Prompts',
      description: 'List of all task template prompts',
      mimeType: 'application/json',
    },
    ...PROMPTS.map(p => ({
      uri: `paradigm://prompts/${p.name}`,
      name: formatPromptName(p.name),
      description: p.description,
      mimeType: 'text/markdown',
    })),
  ];
}

/**
 * Handle prompt resource requests
 */
export async function handlePromptsResource(
  resourcePath: string,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean; bytes?: number }> {
  
  // paradigm://prompts - List all prompts
  if (resourcePath === 'prompts') {
    const text = JSON.stringify({
      count: PROMPTS.length,
      total_bytes: PROMPTS.reduce((sum, p) => sum + p.size, 0),
      prompts: PROMPTS.map(p => ({
        name: p.name,
        description: p.description,
        uri: `paradigm://prompts/${p.name}`,
        size_bytes: p.size,
        estimated_tokens: Math.ceil(p.size / 4),
      })),
      usage: 'Fetch specific prompt with paradigm://prompts/{name}',
    }, null, 2);
    
    return {
      handled: true,
      text,
      bytes: text.length,
    };
  }
  
  // paradigm://prompts/{name} - Specific prompt content
  if (resourcePath.startsWith('prompts/')) {
    const promptName = resourcePath.replace('prompts/', '');
    const prompt = PROMPTS.find(p => p.name === promptName);
    
    if (!prompt) {
      const text = JSON.stringify({
        error: 'Prompt not found',
        available: PROMPTS.map(p => p.name),
      }, null, 2);
      
      return {
        handled: true,
        text,
        bytes: text.length,
      };
    }
    
    const content = await loadPromptContent(promptName, ctx);
    
    if (!content) {
      const text = `Error: Could not load prompt content for ${promptName}`;
      return {
        handled: true,
        text,
        bytes: text.length,
      };
    }
    
    return {
      handled: true,
      text: content,
      bytes: content.length,
    };
  }
  
  return { handled: false, text: '' };
}

/**
 * Load prompt content from Paradigm package templates
 * 
 * This reads from the installed @a-company/paradigm package,
 * not from the project's .paradigm/ directory.
 */
async function loadPromptContent(name: string, ctx: ProjectContext): Promise<string | null> {
  // Try multiple locations (handles different installation scenarios)
  const possiblePaths = [
    // Local development (npm link)
    path.join(ctx.rootDir, '../..', 'packages/paradigm/templates/paradigm/prompts', `${name}.md`),
    // node_modules installation
    path.join(ctx.rootDir, 'node_modules/@a-company/paradigm/templates/paradigm/prompts', `${name}.md`),
    // Workspace installation
    path.join(ctx.rootDir, '../../node_modules/@a-company/paradigm/templates/paradigm/prompts', `${name}.md`),
  ];
  
  for (const templatePath of possiblePaths) {
    try {
      return fs.readFileSync(templatePath, 'utf8');
    } catch {
      continue;
    }
  }
  
  return null;
}

/**
 * Format prompt name for display
 */
function formatPromptName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
```

**Test:**
```bash
# Build MCP package
cd packages/paradigm-mcp
npm run build

# Test manually (TODO: set up proper test project)
# Should be able to query paradigm://prompts and get list
```

### 1.2 Create Specs Resource Handler

**File:** `packages/paradigm-mcp/src/resources/specs.ts`

```typescript
/**
 * MCP Resource Handler for Paradigm Specs
 * 
 * Serves reference specifications on-demand.
 * Core specs (logger, symbols, purpose, navigator) stay in templates.
 * These are "nice to have" reference materials.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectContext } from '../types/index.js';

// Reference spec metadata
const SPECS = [
  { name: 'disciplines', description: 'Development best practices and guidelines', size: 5821 },
  { name: 'scan', description: 'How paradigm probe/index works', size: 4834 },
  { name: 'context-tracking', description: 'Session context monitoring details', size: 4608 },
];

/**
 * List spec resources
 */
export function getSpecsResourcesList() {
  return SPECS.map(spec => ({
    uri: `paradigm://specs/${spec.name}`,
    name: formatSpecName(spec.name),
    description: spec.description,
    mimeType: 'text/markdown',
  }));
}

/**
 * Handle spec resource requests
 */
export async function handleSpecsResource(
  resourcePath: string,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean; bytes?: number }> {
  
  const specName = resourcePath.replace('specs/', '');
  const spec = SPECS.find(s => s.name === specName);
  
  if (!spec) {
    return { handled: false, text: '' };
  }
  
  const content = await loadSpecContent(specName, ctx);
  
  if (!content) {
    const text = `Error: Could not load spec content for ${specName}`;
    return {
      handled: true,
      text,
      bytes: text.length,
    };
  }
  
  return {
    handled: true,
    text: content,
    bytes: content.length,
  };
}

/**
 * Load spec content from Paradigm package templates
 */
async function loadSpecContent(name: string, ctx: ProjectContext): Promise<string | null> {
  const possiblePaths = [
    path.join(ctx.rootDir, '../..', 'packages/paradigm/templates/paradigm/specs', `${name}.md`),
    path.join(ctx.rootDir, 'node_modules/@a-company/paradigm/templates/paradigm/specs', `${name}.md`),
    path.join(ctx.rootDir, '../../node_modules/@a-company/paradigm/templates/paradigm/specs', `${name}.md`),
  ];
  
  for (const templatePath of possiblePaths) {
    try {
      return fs.readFileSync(templatePath, 'utf8');
    } catch {
      continue;
    }
  }
  
  return null;
}

function formatSpecName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
```

### 1.3 Create Docs Resource Handler

**File:** `packages/paradigm-mcp/src/resources/docs.ts`

```typescript
/**
 * MCP Resource Handler for Paradigm Docs
 * 
 * Serves reference documentation on-demand.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectContext } from '../types/index.js';

const DOCS = [
  { name: 'commands', description: 'Quick reference for all paradigm CLI commands', size: 13876 },
  { name: 'queries', description: 'How to query Paradigm effectively', size: 4305 },
];

/**
 * List docs resources
 */
export function getDocsResourcesList() {
  return DOCS.map(doc => ({
    uri: `paradigm://docs/${doc.name}`,
    name: formatDocName(doc.name),
    description: doc.description,
    mimeType: 'text/markdown',
  }));
}

/**
 * Handle docs resource requests
 */
export async function handleDocsResource(
  resourcePath: string,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean; bytes?: number }> {
  
  const docName = resourcePath.replace('docs/', '');
  const doc = DOCS.find(d => d.name === docName);
  
  if (!doc) {
    return { handled: false, text: '' };
  }
  
  const content = await loadDocContent(docName, ctx);
  
  if (!content) {
    const text = `Error: Could not load doc content for ${docName}`;
    return {
      handled: true,
      text,
      bytes: text.length,
    };
  }
  
  return {
    handled: true,
    text: content,
    bytes: content.length,
  };
}

async function loadDocContent(name: string, ctx: ProjectContext): Promise<string | null> {
  const possiblePaths = [
    path.join(ctx.rootDir, '../..', 'packages/paradigm/templates/paradigm/docs', `${name}.md`),
    path.join(ctx.rootDir, 'node_modules/@a-company/paradigm/templates/paradigm/docs', `${name}.md`),
    path.join(ctx.rootDir, '../../node_modules/@a-company/paradigm/templates/paradigm/docs', `${name}.md`),
  ];
  
  for (const templatePath of possiblePaths) {
    try {
      return fs.readFileSync(templatePath, 'utf8');
    } catch {
      continue;
    }
  }
  
  return null;
}

function formatDocName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
```

### 1.4 Register New Resources

**File:** `packages/paradigm-mcp/src/resources/index.ts`

Add at top:
```typescript
import { getPromptsResourcesList, handlePromptsResource } from './prompts.js';
import { getSpecsResourcesList, handleSpecsResource } from './specs.js';
import { getDocsResourcesList, handleDocsResource } from './docs.js';
```

In `ListResourcesRequestSchema` handler, add to resources array:
```typescript
...getPromptsResourcesList(),
...getSpecsResourcesList(),
...getDocsResourcesList(),
```

In `ReadResourceRequestSchema` handler, add before the final `throw new Error`:
```typescript
// Try prompts resources
if (resourcePath.startsWith('prompts')) {
  const result = await handlePromptsResource(resourcePath, ctx);
  if (result.handled) {
    // Track resource read for cost tracking
    if (result.bytes) {
      trackResourceRead('prompts', result.bytes);
    }
    
    return {
      contents: [{
        uri,
        mimeType: resourcePath === 'prompts' ? 'application/json' : 'text/markdown',
        text: result.text,
      }],
    };
  }
}

// Try specs resources
if (resourcePath.startsWith('specs/')) {
  const result = await handleSpecsResource(resourcePath, ctx);
  if (result.handled) {
    if (result.bytes) {
      trackResourceRead('specs', result.bytes);
    }
    
    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text: result.text,
      }],
    };
  }
}

// Try docs resources
if (resourcePath.startsWith('docs/')) {
  const result = await handleDocsResource(resourcePath, ctx);
  if (result.handled) {
    if (result.bytes) {
      trackResourceRead('docs', result.bytes);
    }
    
    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text: result.text,
      }],
    };
  }
}
```

---

## Phase 2: Cost Tracking Implementation (1-2 hours)

### 2.1 Create Session Tracker

**File:** `packages/paradigm-mcp/src/utils/session-tracker.ts`

```typescript
/**
 * Session Cost Tracker
 * 
 * Tracks all MCP interactions (resource reads, tool calls) and
 * provides cost estimates and handoff recommendations.
 */

interface ResourceUsage {
  type: 'prompts' | 'specs' | 'docs' | 'symbols' | 'gates' | 'wisdom' | 'history' | 'context';
  reads: number;
  bytes: number;
  tokens: number;
}

interface ToolUsage {
  name: string;
  calls: number;
  bytes: number;
  tokens: number;
}

interface SessionStats {
  session_id: string;
  start_time: number;
  elapsed_ms: number;
  context_window_size: number;
  
  resources: Map<string, ResourceUsage>;
  tools: Map<string, ToolUsage>;
  
  total_bytes: number;
  total_tokens: number;
  context_percentage: number;
  
  estimated_cost_usd: number;
}

class SessionTracker {
  private stats: SessionStats;
  
  // Claude Sonnet 3.5 pricing
  private readonly INPUT_COST_PER_MILLION = 3.00;
  private readonly CONTEXT_WINDOW_SIZE = 200000; // 200K tokens
  private readonly BYTES_PER_TOKEN = 4; // Conservative estimate
  
  constructor() {
    this.stats = {
      session_id: generateSessionId(),
      start_time: Date.now(),
      elapsed_ms: 0,
      context_window_size: this.CONTEXT_WINDOW_SIZE,
      
      resources: new Map(),
      tools: new Map(),
      
      total_bytes: 0,
      total_tokens: 0,
      context_percentage: 0,
      
      estimated_cost_usd: 0,
    };
  }
  
  /**
   * Track a resource read
   */
  trackResourceRead(type: string, bytes: number) {
    const tokens = Math.ceil(bytes / this.BYTES_PER_TOKEN);
    
    const existing = this.stats.resources.get(type) || {
      type: type as any,
      reads: 0,
      bytes: 0,
      tokens: 0,
    };
    
    existing.reads++;
    existing.bytes += bytes;
    existing.tokens += tokens;
    
    this.stats.resources.set(type, existing);
    this.updateTotals();
  }
  
  /**
   * Track a tool call
   */
  trackToolCall(toolName: string, responseBytes: number) {
    const tokens = Math.ceil(responseBytes / this.BYTES_PER_TOKEN);
    
    const existing = this.stats.tools.get(toolName) || {
      name: toolName,
      calls: 0,
      bytes: 0,
      tokens: 0,
    };
    
    existing.calls++;
    existing.bytes += responseBytes;
    existing.tokens += tokens;
    
    this.stats.tools.set(toolName, existing);
    this.updateTotals();
  }
  
  /**
   * Update totals and derived metrics
   */
  private updateTotals() {
    this.stats.elapsed_ms = Date.now() - this.stats.start_time;
    
    // Sum resources
    let resourceTokens = 0;
    for (const resource of this.stats.resources.values()) {
      resourceTokens += resource.tokens;
    }
    
    // Sum tools
    let toolTokens = 0;
    for (const tool of this.stats.tools.values()) {
      toolTokens += tool.tokens;
    }
    
    this.stats.total_tokens = resourceTokens + toolTokens;
    this.stats.total_bytes = this.stats.total_tokens * this.BYTES_PER_TOKEN;
    
    this.stats.context_percentage = (this.stats.total_tokens / this.stats.context_window_size) * 100;
    
    this.stats.estimated_cost_usd = (this.stats.total_tokens / 1_000_000) * this.INPUT_COST_PER_MILLION;
  }
  
  /**
   * Get current session stats
   */
  getStats(): SessionStats {
    this.updateTotals();
    return JSON.parse(JSON.stringify(this.stats)); // Deep clone
  }
  
  /**
   * Get handoff recommendation
   */
  getHandoffRecommendation(): {
    status: 'continue' | 'consider-handoff' | 'handoff-recommended' | 'handoff-urgent';
    reason: string;
    context_percentage: number;
    total_interactions: number;
  } {
    this.updateTotals();
    
    const totalInteractions = 
      Array.from(this.stats.resources.values()).reduce((sum, r) => sum + r.reads, 0) +
      Array.from(this.stats.tools.values()).reduce((sum, t) => sum + t.calls, 0);
    
    const pct = this.stats.context_percentage;
    
    if (pct >= 85) {
      return {
        status: 'handoff-urgent',
        reason: `Context ${pct.toFixed(1)}% full (>85%). Handoff immediately after current task.`,
        context_percentage: pct,
        total_interactions: totalInteractions,
      };
    } else if (pct >= 70) {
      return {
        status: 'handoff-recommended',
        reason: `Context ${pct.toFixed(1)}% full (70-85%). Prepare handoff soon.`,
        context_percentage: pct,
        total_interactions: totalInteractions,
      };
    } else if (pct >= 50) {
      return {
        status: 'consider-handoff',
        reason: `Context ${pct.toFixed(1)}% full (50-70%). Plan a stopping point.`,
        context_percentage: pct,
        total_interactions: totalInteractions,
      };
    }
    
    return {
      status: 'continue',
      reason: `Context ${pct.toFixed(1)}% full (<50%). Continue working.`,
      context_percentage: pct,
      total_interactions: totalInteractions,
    };
  }
  
  /**
   * Get cost breakdown
   */
  getCostBreakdown() {
    this.updateTotals();
    
    return {
      session: {
        id: this.stats.session_id,
        elapsed: formatDuration(this.stats.elapsed_ms),
        total_tokens: this.stats.total_tokens,
        estimated_cost_usd: this.stats.estimated_cost_usd,
      },
      resources: Array.from(this.stats.resources.values())
        .sort((a, b) => b.tokens - a.tokens)
        .map(r => ({
          type: r.type,
          reads: r.reads,
          tokens: r.tokens,
          cost_usd: (r.tokens / 1_000_000) * this.INPUT_COST_PER_MILLION,
        })),
      tools: Array.from(this.stats.tools.values())
        .sort((a, b) => b.tokens - a.tokens)
        .map(t => ({
          name: t.name,
          calls: t.calls,
          tokens: t.tokens,
          avg_tokens_per_call: Math.ceil(t.tokens / t.calls),
          cost_usd: (t.tokens / 1_000_000) * this.INPUT_COST_PER_MILLION,
        })),
    };
  }
}

// Singleton instance
let sessionTracker: SessionTracker | null = null;

export function getSessionTracker(): SessionTracker {
  if (!sessionTracker) {
    sessionTracker = new SessionTracker();
  }
  return sessionTracker;
}

export function trackResourceRead(type: string, bytes: number) {
  getSessionTracker().trackResourceRead(type, bytes);
}

export function trackToolCall(toolName: string, responseBytes: number) {
  getSessionTracker().trackToolCall(toolName, responseBytes);
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
```

### 2.2 Update Context Tools

**File:** `packages/paradigm-mcp/src/tools/context.ts`

Update `paradigm_context_check` to use real session data:

```typescript
import { getSessionTracker } from '../utils/session-tracker.js';

// In handleContextTool function, for paradigm_context_check:
case 'paradigm_context_check': {
  const tracker = getSessionTracker();
  const recommendation = tracker.getHandoffRecommendation();
  const stats = tracker.getStats();
  
  return {
    handled: true,
    text: JSON.stringify({
      recommendation: recommendation.status,
      reason: recommendation.reason,
      session: {
        elapsed: formatDuration(stats.elapsed_ms),
        total_interactions: recommendation.total_interactions,
      },
      context: {
        tokens_used: stats.total_tokens,
        window_size: stats.context_window_size,
        percentage: recommendation.context_percentage.toFixed(1),
      },
      cost: {
        estimated_usd: stats.estimated_cost_usd.toFixed(4),
      },
      next_check: 'Call again in 10-15 tool calls or when user asks',
    }, null, 2),
  };
}
```

Add new tool `paradigm_session_stats`:

```typescript
case 'paradigm_session_stats': {
  const tracker = getSessionTracker();
  const breakdown = tracker.getCostBreakdown();
  
  return {
    handled: true,
    text: JSON.stringify({
      session: breakdown.session,
      breakdown: {
        by_resource: breakdown.resources,
        by_tool: breakdown.tools,
      },
      insights: generateInsights(breakdown),
    }, null, 2),
  };
}

function generateInsights(breakdown: any) {
  const insights = [];
  
  // Most expensive resources
  const topResource = breakdown.resources[0];
  if (topResource) {
    insights.push(`Most used resource: ${topResource.type} (${topResource.reads} reads, ${topResource.tokens} tokens)`);
  }
  
  // Most called tool
  const topTool = breakdown.tools[0];
  if (topTool) {
    insights.push(`Most called tool: ${topTool.name} (${topTool.calls} calls, avg ${topTool.avg_tokens_per_call} tokens)`);
  }
  
  return insights;
}
```

### 2.3 Update Tool Registration

**File:** `packages/paradigm-mcp/src/tools/index.ts`

Add `paradigm_session_stats` to tool list:

```typescript
{
  name: 'paradigm_session_stats',
  description: 'Get detailed session statistics including cost breakdown by resource and tool',
  inputSchema: {
    type: 'object',
    properties: {},
  },
},
```

Update all tool call handlers to track usage:

```typescript
// At the end of each tool case, before return:
const responseText = JSON.stringify(...);
trackToolCall(name, responseText.length);
return {
  content: [{ type: 'text', text: responseText }],
};
```

---

## Phase 3: Template Cleanup (30 min)

### 3.1 Remove Files from Templates

**Delete these directories/files:**

```bash
cd packages/paradigm/templates/paradigm

# Remove prompts (86KB)
rm -rf prompts/

# Remove reference docs (18KB)
rm docs/commands.md
rm docs/queries.md

# Remove reference specs (16KB)
rm specs/disciplines.md
rm specs/scan.md
rm specs/context-tracking.md

# Remove echoes (0.7KB) - already has paradigm echo tool
rm echoes.yaml
```

**Keep these files (61KB):**
- `config.yaml`
- `specs/logger.md`
- `specs/symbols.md`
- `specs/purpose.md`
- `specs/navigator.md`
- `specs/history.md`
- `specs/wisdom.md`
- `specs/context.md`
- `docs/patterns.md`
- `docs/troubleshooting.md`
- `docs/error-patterns.md`
- `docs/decisions/`

### 3.2 Update Documentation Index

**File:** `packages/paradigm/templates/paradigm/docs/.index.yaml`

Replace content with:

```yaml
# Documentation Index
# This file helps AI agents navigate the docs directory efficiently

title: Paradigm Documentation
description: Reference documentation for Paradigm CLI and workflows

entries:
  - file: patterns.md
    title: Coding Patterns
    description: Recommended patterns for using Paradigm symbols and logger
    
  - file: troubleshooting.md
    title: Troubleshooting Guide
    description: Solutions for common issues

  - file: error-patterns.md
    title: Error Handling Patterns
    description: Standard error handling and response formats
    
  - dir: decisions/
    title: Architecture Decision Records
    description: Historical decisions and their rationale

# MCP Resources (not in .paradigm/, query on-demand)
mcp_resources:
  prompts:
    uri: paradigm://prompts
    description: Task template prompts (10 available)
    examples:
      - paradigm://prompts/add-feature
      - paradigm://prompts/refactor
      - paradigm://prompts/debug-auth
      
  specs:
    uri: paradigm://specs/{name}
    description: Reference specifications
    available:
      - disciplines
      - scan
      - context-tracking
      
  docs:
    uri: paradigm://docs/{name}
    description: CLI documentation
    available:
      - commands
      - queries

# Reading order for new agents
reading_order:
  - patterns.md              # Project coding patterns
  - troubleshooting.md       # Project debugging
  - paradigm://prompts       # Task templates (MCP)
```

---

## Phase 4: Documentation Updates (1 hour)

### 4.1 Update CLAUDE.md Template

**File:** `packages/paradigm/src/core/ide-adapters/claude.ts`

In the `generateClaudeMd` function, add section after "Symbol System":

```markdown
## MCP Resources: On-Demand Content

Paradigm uses MCP resources for efficient, on-demand content loading.

### Task Prompts (paradigm://prompts)

Query specific prompts only when needed:

| URI | Use Case | ~Tokens |
|-----|----------|---------|
| \`paradigm://prompts/add-feature\` | Adding new @features | 850 |
| \`paradigm://prompts/refactor\` | Refactoring code | 550 |
| \`paradigm://prompts/debug-auth\` | Debugging auth issues | 900 |
| \`paradigm://prompts/trace-flow\` | Tracing $flows | 1,050 |

**Full list:** Query \`paradigm://prompts\` for all 10 available prompts.

### Reference Specs (paradigm://specs/{name})

- \`paradigm://specs/disciplines\` - Development best practices
- \`paradigm://specs/scan\` - Visual discovery details
- \`paradigm://specs/context-tracking\` - Context monitoring

### CLI Reference (paradigm://docs/{name})

- \`paradigm://docs/commands\` - Quick command reference
- \`paradigm://docs/queries\` - Query guide

For detailed command docs, see \`docs/commands/*.md\` in GitHub repository.

### Why MCP Resources?

**Before:** Load 260KB upfront (~65K tokens)
**Now:** Load 61KB essentials (~16K tokens) + query on-demand

**Savings:** ~49K tokens per session start (~$0.15)

### Session Cost Tracking

Paradigm MCP tracks your session usage:

\`\`\`
paradigm_context_check()
→ Shows: tokens used, context %, handoff recommendation

paradigm_session_stats()
→ Shows: cost breakdown by resource/tool
\`\`\`

**Handoff triggers:**
- <50% context: Continue working
- 50-70%: Plan stopping point
- 70-85%: Prepare handoff soon
- >85%: Handoff after current task
```

### 4.2 Update Cursor Rules

**File:** `packages/paradigm/src/core/ide-adapters/cursor.ts`

Add similar content to `paradigm-core.mdc` generation.

### 4.3 Update README

**File:** `README.md`

Add after "Quick Start" section:

```markdown
## Lean Templates, Powerful MCP

Paradigm uses an MCP-first architecture for optimal efficiency:

**Before (v1.3.0):**
- Template size: 260KB
- AI loads everything upfront
- ~65,000 tokens per session start

**Now (v1.4.0):**
- Template size: 61KB (76% smaller)
- AI queries content on-demand via MCP
- ~16,000 tokens for essentials
- ~$0.15 saved per session

### MCP Resources

Query content when needed instead of loading upfront:

```bash
# Task prompts
paradigm://prompts/add-feature
paradigm://prompts/refactor

# Reference specs
paradigm://specs/disciplines
paradigm://specs/scan

# CLI docs
paradigm://docs/commands
```

### Session Cost Tracking

MCP tracks your usage and recommends handoffs:

```bash
# Check context usage
paradigm_context_check()

# Get cost breakdown
paradigm_session_stats()
```
```

### 4.4 Update CHANGELOG

**File:** `CHANGELOG.md`

Add to `[1.4.0] - 2026-02-XX` section:

```markdown
## [1.4.0] - 2026-02-XX

### Added

- **MCP-First Architecture** - Templates reduced from 260KB to 61KB (76% reduction)
  - Moved prompts to MCP resources (10 task templates, 86KB)
  - Moved reference specs to MCP resources (disciplines, scan, context-tracking, 16KB)
  - Moved reference docs to MCP resources (commands.md, queries.md, 18KB)
  - Templates now contain only project-essential content (61KB)
  - AI queries content on-demand: `paradigm://prompts/{name}`, `paradigm://specs/{name}`, `paradigm://docs/{name}`
  - Token savings: ~37K tokens per project (~$0.11 per full read, ~$0.15 per session)

- **Session Cost Tracking** - MCP tracks resource reads and tool calls
  - Real-time token usage tracking (resources + tools)
  - Cost estimation based on Claude Sonnet 3.5 pricing ($3/M input tokens)
  - Context percentage monitoring (200K token window)
  - Smart handoff recommendations based on actual usage
  - New MCP tool: `paradigm_session_stats()` - Detailed cost breakdown

- **Enhanced Context Monitoring** - `paradigm_context_check` now uses real session data
  - Shows actual tokens used (not estimates)
  - Tracks resource reads by type (prompts, specs, docs, symbols, etc.)
  - Tracks tool calls with response sizes
  - Provides cost breakdown by resource and tool
  - Recommends handoff at: 50% (consider), 70% (recommended), 85% (urgent)

### Changed

- **Template structure** - Only essential files remain in `.paradigm/`
  - Core specs: logger, symbols, purpose, navigator, history, wisdom, context
  - Project docs: patterns, troubleshooting, error-patterns
  - Config: config.yaml
  - Removed: prompts/, echoes.yaml, reference specs, reference docs

- **MCP resource additions** - 12 new on-demand resources
  - `paradigm://prompts` - List all prompts
  - `paradigm://prompts/{name}` - 10 specific prompts
  - `paradigm://specs/{name}` - 3 reference specs
  - `paradigm://docs/{name}` - 2 reference docs

### Migration

**For new projects:** No action needed - `paradigm init` creates lean templates.

**For existing projects (optional cleanup):**
```bash
# Remove files that are now MCP resources
rm -rf .paradigm/prompts
rm .paradigm/docs/commands.md .paradigm/docs/queries.md
rm .paradigm/specs/disciplines.md .paradigm/specs/scan.md
rm .paradigm/specs/context-tracking.md .paradigm/echoes.yaml

# Query via MCP instead
paradigm://prompts/add-feature
paradigm://specs/disciplines
```

### Performance

- Session start: 65K tokens → 16K tokens (75% reduction)
- Cost per session: ~$0.20 → ~$0.05 (75% savings)
- Context quality: Higher (only essential content loaded)
- Query latency: <100ms for on-demand resources
```

---

## Phase 5: Testing & Validation (1 hour)

### 5.1 Build Packages

```bash
# Build MCP package
cd packages/paradigm-mcp
npm run build

# Build CLI (with cleaned templates)
cd ../paradigm
npm run build

# Verify template size
du -sh templates/paradigm
# Should show ~61KB (was 260KB)
```

### 5.2 Test in Fresh Project

```bash
# Create test project
cd /tmp
mkdir paradigm-test && cd paradigm-test
npm init -y

# Initialize Paradigm
paradigm init --quick

# Check .paradigm/ size
du -sh .paradigm
# Should be ~61KB

# Verify files removed
ls .paradigm/prompts/          # Should not exist
ls .paradigm/docs/commands.md  # Should not exist
ls .paradigm/specs/disciplines.md  # Should not exist
```

### 5.3 Test MCP Resources

```bash
# Set up MCP
paradigm mcp setup --client claude

# In Claude Desktop or MCP client, test:
# 1. List prompts
paradigm://prompts

# 2. Get specific prompt
paradigm://prompts/add-feature

# 3. Get spec
paradigm://specs/disciplines

# 4. Get doc
paradigm://docs/commands
```

### 5.4 Test Cost Tracking

In Claude/MCP client:

```
1. Call paradigm_context_check()
   → Should show: 0% context, "continue" status

2. Read paradigm://prompts/add-feature
   → MCP tracks ~850 tokens

3. Call paradigm_ripple(@feature)
   → MCP tracks response size

4. Call paradigm_session_stats()
   → Should show: resource reads, tool calls, cost breakdown

5. Call paradigm_context_check() again
   → Should show updated percentage
```

### 5.5 Validation Checklist

**Template Size:**
- [ ] `du -sh packages/paradigm/templates/paradigm` shows ~61KB
- [ ] prompts/ directory removed
- [ ] docs/commands.md removed
- [ ] docs/queries.md removed
- [ ] specs/disciplines.md removed
- [ ] specs/scan.md removed
- [ ] specs/context-tracking.md removed
- [ ] echoes.yaml removed

**MCP Resources:**
- [ ] `paradigm://prompts` returns list of 10 prompts
- [ ] `paradigm://prompts/add-feature` returns prompt content
- [ ] `paradigm://specs/disciplines` returns spec content
- [ ] `paradigm://docs/commands` returns doc content

**Cost Tracking:**
- [ ] `paradigm_context_check()` returns session stats
- [ ] `paradigm_session_stats()` returns cost breakdown
- [ ] Resource reads tracked (check bytes/tokens)
- [ ] Tool calls tracked (check bytes/tokens)
- [ ] Handoff recommendations work (test at different %s)

**Documentation:**
- [ ] CLAUDE.md includes MCP resource section
- [ ] README explains MCP-first architecture
- [ ] CHANGELOG documents v1.4.0 changes
- [ ] Cursor rules updated with MCP guidance

---

## Rollback Plan

If critical issues arise:

1. **Revert template cleanup:**
   ```bash
   git revert <template-cleanup-commit>
   npm run build --workspace=@a-company/paradigm
   ```

2. **Keep MCP resources** - They're additive, no harm in keeping them

3. **Projects work with either:**
   - Local files in `.paradigm/`
   - MCP resources via `paradigm://`
   - Both simultaneously (MCP takes precedence)

---

## Version Bump

Update version in all packages:

```bash
# packages/paradigm/package.json
"version": "1.4.0"

# packages/paradigm-mcp/package.json
"version": "1.4.0"

# packages/paradigm/src/index.ts
const VERSION = '1.4.0';
```

Rebuild and commit:

```bash
npm run build --workspace=@a-company/paradigm
npm run build --workspace=@a-company/paradigm-mcp

git add -A
git commit -m "feat: MCP-first architecture with cost tracking (v1.4.0)"
```

---

## Success Criteria

- [ ] Templates: 260KB → 61KB (verified with `du -sh`)
- [ ] MCP resources: 12 new resources (prompts, specs, docs)
- [ ] Cost tracking: Session stats and handoff recommendations working
- [ ] All tests pass
- [ ] Documentation complete
- [ ] Clean git history (logical commits)

---

## Post-Launch: v1.5.0 Roadmap

**Enhanced Cost Analytics:**
1. Session replay/audit trail
2. Cost attribution with optimization suggestions
3. Predictive handoff warnings
4. Team analytics dashboard
5. Per-symbol cost tracking
6. Historical cost trends

**Target:** Q1 2026

---

## Notes for Opus

**File locations:**
- MCP package: `packages/paradigm-mcp/`
- CLI package: `packages/paradigm/`
- Templates: `packages/paradigm/templates/paradigm/`

**Build commands:**
```bash
# Build MCP
npm run build --workspace=@a-company/paradigm-mcp

# Build CLI
npm run build --workspace=@a-company/paradigm

# Build both
npm run build
```

**Testing:**
- Create test project in `/tmp/`
- Use `paradigm init --quick` to avoid prompts
- Test MCP in Claude Desktop (easiest) or Continue

**Questions?**
- Check existing MCP resources in `packages/paradigm-mcp/src/resources/`
- Follow patterns from `wisdom.ts`, `history.ts`, `context.ts`
- Session tracker is new - create from scratch following outline

**Estimated time:** 4-6 hours total

Good luck! 🚀
