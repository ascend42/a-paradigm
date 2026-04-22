---
id: N-para-401-provider-cascade
title: Provider Cascade
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-401
  - six-providers-claude
  - cascade-tries-providers
  - three-configuration-methods
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-401.json
---

## Provider Cascade

Orchestrated agents need somewhere to run. Paradigm supports multiple **execution providers** -- the systems that actually run the agent prompts and return results. Since not every environment has the same providers available (some teams use the Anthropic API directly, others use Claude Code, others use Cursor), Paradigm implements a **cascade** that tries providers in priority order until one works.

The default cascade order is:

### Anthropic / Claude Ecosystem

1. **`claude`** -- Direct Anthropic API. Requires `ANTHROPIC_API_KEY` environment variable. The most flexible option with full control over model selection and parameters.

2. **`claude-code-teams`** -- Claude Code Agent Teams (experimental). Supports parallel agent execution natively. Only available with Claude Code Teams subscription.

3. **`claude-code`** -- Claude Code Task tool. Uses the Task tool within a Claude Code session. Requires a Max subscription. Runs agents as sub-tasks within the current session.

5. **`claude-cli`** -- Spawns separate `claude` CLI processes. Each agent runs as an independent CLI invocation. Available when the Claude CLI is installed.

### Cursor Ecosystem

4. **`cursor-cli`** -- Cursor's agent CLI. Auto-detected when running inside the Cursor IDE. Spawns agents through Cursor's built-in agent system.

### Universal

6. **`manual`** -- File-based handoffs. Always available as a fallback. Writes agent prompts to files that a human (or another tool) can execute. This is the universal fallback that works in every environment.

### Configuration

You can set the preferred provider in three ways (listed in priority order):

```bash
# Environment variable (highest priority)
export PARADIGM_AGENT_PROVIDER=claude-code

# Config file (.paradigm/config.yaml)
agent-provider: claude-code

# CLI command
paradigm team providers --set claude-code
```

Setting a preferred provider does not disable the cascade -- it just changes the starting point. If your preferred provider is unavailable (e.g., API key expired), the cascade continues to the next available option.

To see which providers are currently available in your environment, run:

```bash
paradigm team providers
# Shows: claude (available), claude-code (available), cursor-cli (not detected), ...
```

### Model Discovery

Different providers expose different models. `paradigm team models` shows the current model assignments per agent role and which provider serves them. If you add a new API key or install a new tool, run `paradigm team models --refresh` to re-discover available models.

The cascade design means Paradigm orchestration works everywhere -- from a fully-equipped development machine with API keys and IDE integrations, down to a bare terminal where only manual file-based handoffs are possible. The fallback is always there.
