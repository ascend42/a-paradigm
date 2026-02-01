# @horizon/dream-core

> Symbol aggregation and project knowledge management

Aggregates symbols from Purpose and Gate files into a unified knowledge graph for the Dreamscape visualizer.

## Installation

```bash
npm install @horizon/dream-core
```

## Usage

```typescript
import { 
  aggregateFromDirectory,
  buildSymbolIndex 
} from '@horizon/dream-core';

// Aggregate all symbols from a project
const result = await aggregateFromDirectory('./');

console.log(`Found ${result.symbols.length} symbols`);
console.log(`From ${result.purposeFiles.length} .purpose files`);
console.log(`And ${result.gateFiles.length} gate.yaml files`);

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
| `~` | aspect | .purpose |
| `^` | gate | gate.yaml |
| `!` | signal | gate.yaml |
| `?` | idea | .dream |

## Documentation

See the [main repository](https://github.com/ascend42/a-paradigm) for full documentation.

## License

MIT
