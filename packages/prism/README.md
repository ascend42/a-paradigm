# @horizon/visualizer

> Dreamscape - Infinite canvas visualization for Horizon

The Dreamscape is an interactive infinite canvas where all project knowledge flows together, making complex relationships visible and explorable.

## Features

- **Infinite Canvas** - Pan, zoom, and explore your project's symbol graph
- **Symbol Visualization** - Features, components, gates, signals, and ideas as interactive nodes
- **Real-time Filtering** - Filter by symbol type, tags, or search
- **Multiple Themes** - Morning, daytime, and nighttime visual modes
- **Timeline** - Track project evolution over time

## Usage

The visualizer is served by the Horizon CLI:

```bash
# Install the CLI
npm install -g @horizon/cli

# Open the Dreamscape
horizon visualize
```

## Symbol Types

| Color | Symbol | Type |
|-------|--------|------|
| Cyan | `@` | Feature |
| Green | `#` | Component |
| Orange | `$` | Flow |
| Purple | `%` | State |
| Red | `^` | Gate |
| Pink | `!` | Signal |
| Gray | `?` | Idea |

## Development

```bash
# From the monorepo root
npm run dev:visualizer

# Opens at http://localhost:5173
```

## Documentation

See the [main repository](https://github.com/ascend42/a-paradigm) for full documentation.

## License

MIT
