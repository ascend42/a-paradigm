# @a-company/paradigm-mcp

MCP (Model Context Protocol) server for Paradigm. Exposes symbols, gates, flows, and analysis tools to AI assistants like Claude.

## Features

- **Resources**: Query symbols, gates, flows, and project health
- **Tools**: Search, ripple analysis, related symbols, validation
- **Technology Agnostic**: Works with any language/framework
- **Standard Protocol**: Compatible with any MCP client

## Installation

```bash
npm install @a-company/paradigm-mcp
```

## Usage

### With Claude Desktop

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "paradigm": {
      "command": "npx",
      "args": ["@a-company/paradigm-mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Resources

| URI | Description |
|-----|-------------|
| `paradigm://symbols` | All symbols with counts |
| `paradigm://symbol/{symbol}` | Single symbol details |
| `paradigm://symbols/type/{type}` | Symbols by type |
| `paradigm://gates` | All gates from portal.yaml |
| `paradigm://flows` | All flow definitions |

### Tools

| Tool | Description |
|------|-------------|
| `paradigm_search` | Find symbols by query |
| `paradigm_ripple` | Analyze impact of changing a symbol |
| `paradigm_related` | Get symbols connected to a symbol |
| `paradigm_orchestrate_inline` | Plan and coordinate multi-agent tasks |
| `paradigm_agent_prompt` | Get full prompt for a specific agent |

### Orchestration Tools

**paradigm_orchestrate_inline** - Plan multi-agent task execution:

```javascript
// Plan mode: Get suggested agents and execution plan
paradigm_orchestrate_inline({
  task: "Build @payment-system with Stripe integration",
  mode: "plan"
})
// Returns: plan, suggestedAgents, estimated tokens

// Execute mode: Get full prompts for Task tool
paradigm_orchestrate_inline({
  task: "Build @payment-system with Stripe integration",
  mode: "execute"
})
// Returns: stage prompts ready for spawning subagents
```

The `plan` mode response includes:
- **suggestedAgents**: Agents matched by task triggers (ranked by confidence)
- **plan.stages**: Execution stages with parallel/sequential info
- **plan.estimatedTokens**: Token budget estimate

## Example Interaction

```
User: "What would break if I remove ^authenticated gate?"

AI calls: paradigm_ripple({ symbol: "^authenticated" })

AI: "Removing ^authenticated would affect 12 features including @checkout, @profile, and @settings..."
```

### Orchestration Example

```
User: "Add user authentication with JWT"

AI calls: paradigm_orchestrate_inline({ task: "Add user authentication with JWT", mode: "plan" })

AI: "I'll coordinate this with multiple agents:
  - security (high confidence) - for auth flow review
  - architect (medium) - for design
  - builder - for implementation

Let me get the execution prompts..."

AI calls: paradigm_orchestrate_inline({ task: "...", mode: "execute" })
AI spawns: Task tool for each agent stage
```

## License

MIT
