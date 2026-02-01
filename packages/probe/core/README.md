# @horizon/scan-core

> Visual discovery layer for AI agents

Enables AI agents to understand UI by mapping visual elements to code through the `horizon scan` command.

## Installation

```bash
npm install @horizon/scan-core
```

## Usage

```typescript
import { 
  getScanProtocol,
  buildScanIndex 
} from '@horizon/scan-core';

// Get the scan protocol for AI agents
const protocol = getScanProtocol();

// Build a scan index from project
const index = await buildScanIndex('./src');
```

## Scan Protocol

The scan protocol allows AI agents to:

1. **Analyze screenshots** of running applications
2. **Map visual elements** to source code locations
3. **Understand component hierarchy** from UI
4. **Identify gaps** between designs and implementation

## CLI Usage

```bash
# Scan a running app screenshot
horizon scan ui screenshot.png

# Scan a design mockup
horizon scan design mockup.png

# Scan an error screenshot
horizon scan error error.png
```

## Documentation

See the [main repository](https://github.com/ascend42/a-paradigm) for full documentation.

## License

MIT
