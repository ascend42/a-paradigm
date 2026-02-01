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

## Example Interaction

```
User: "What would break if I remove ^authenticated gate?"

AI calls: paradigm_ripple({ symbol: "^authenticated" })

AI: "Removing ^authenticated would affect 12 features including @checkout, @profile, and @settings..."
```

## License

MIT
