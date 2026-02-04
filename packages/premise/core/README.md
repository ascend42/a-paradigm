# @a-company/premise-core

> Symbol aggregation and project knowledge management

Aggregates symbols from Purpose and Portal files into a unified knowledge graph for the Prism visualizer.

## Installation

```bash
npm install @a-company/premise-core
```

## Usage

```typescript
import { 
  aggregateFromDirectory,
  buildSymbolIndex 
} from '@a-company/premise-core';

// Aggregate all symbols from a project
const result = await aggregateFromDirectory('./');

console.log(`Found ${result.symbols.length} symbols`);
console.log(`From ${result.purposeFiles.length} .purpose files`);
console.log(`And ${result.portalFiles.length} portal.yaml files`);

// Build a searchable index
const index = buildSymbolIndex(result.symbols);

// Find symbols by type
const features = index.byType.get('feature');
const gates = index.byType.get('gate');
```

## Symbol Types

| Symbol | Type | Source |
|--------|------|--------|
| `@` | feature | .purpose |
| `#` | component | .purpose |
| `$` | flow | .purpose |
| `%` | state | .purpose |
| `~` | deprecated | .purpose |
| `^` | gate | portal.yaml |
| `!` | signal | portal.yaml |
| `?` | idea | .premise |

## Documentation

See the [main repository](https://github.com/ascend42/a-paradigm) for full documentation.

## License

MIT
