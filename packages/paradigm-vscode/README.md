# Paradigm for VS Code

Rich IDE support for the [Paradigm](https://github.com/ascend42/a-paradigm) symbol system and `.purpose` files.

## Features

### Symbol Highlighting

Paradigm symbols are highlighted across all supported file types:

- `@feature` - Features (functions, capabilities)
- `#component` - Components (classes, modules)
- `^gate` - Gates (authorization, permissions)
- `!signal` - Signals (events, notifications)
- `$flow` - Flows (processes, workflows)
- `%state` - State (data, configuration)
- `?idea` - Ideas (proposals, drafts)
- `~deprecated` - Deprecated items
- `&integration` - External integrations

### Hover Information

Hover over any symbol to see:
- Symbol type and description
- File where it's defined
- Referenced symbols
- Symbols that use this one
- Tags

### Go-to-Definition

**F12** or **Cmd/Ctrl+Click** on any symbol to jump to its definition.

### Find All References

**Shift+F12** to find all places where a symbol is used.

### Diagnostics

Real-time validation for `.purpose` files:
- YAML syntax errors
- Schema validation errors
- Undefined symbol warnings
- Deprecated symbol notices

### Document Outline

Navigate `.purpose` files using the Outline view:
- Features, components, gates, signals, flows, states
- Organized by section

### Workspace Symbol Search

**Cmd/Ctrl+T** to search all symbols across the workspace.

### CodeLens

Reference counts shown above symbol definitions in `.purpose` files:
- Click to find all references

### Symbol Autocomplete

Type a symbol prefix (`@`, `#`, `^`, etc.) to get autocomplete suggestions.

### Quick Fixes

Undefined symbols offer quick fixes:
- Add to current `.purpose` file
- Create in new `.purpose` file

## Supported Files

- `.purpose` - Purpose definition files
- `.yaml` / `.yml` - YAML files (including `portal.yaml`)
- `.md` - Markdown documentation
- `.ts` / `.tsx` - TypeScript files
- `.js` / `.jsx` - JavaScript files

## Commands

- **Paradigm: Rebuild Symbol Index** - Manually rebuild the symbol index
- **Paradigm: Show Symbol Info** - Look up a symbol by name
- **Paradigm: Find Symbol References** - Find all references to current symbol

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `paradigm.enableCodeLens` | `true` | Show reference counts above symbols |
| `paradigm.enableDiagnostics` | `true` | Show validation errors for .purpose files |
| `paradigm.enableAutoComplete` | `true` | Enable symbol autocomplete suggestions |
| `paradigm.symbolHighlighting` | `true` | Enable syntax highlighting for symbols |

## Requirements

- VS Code 1.85.0 or later
- A project using the Paradigm framework (`.purpose` files or `portal.yaml`)

## Installation

### From VS Code Marketplace

Search for "Paradigm" in the Extensions view.

### From VSIX

1. Download the `.vsix` file from releases
2. In VS Code: Extensions → ... → Install from VSIX

### From Source

```bash
cd packages/paradigm-vscode
npm install
npm run build
npx vsce package
```

## License

MIT
