# @a-company/probe-core

> Visual discovery layer for AI agents

Enables AI agents to understand UI by mapping visual elements to code through the `paradigm probe` command.

## Installation

```bash
npm install @a-company/probe-core
```

## Usage

```typescript
import { 
  getProbeProtocol,
  buildProbeIndex 
} from '@a-company/probe-core';

// Get the probe protocol for AI agents
const protocol = getProbeProtocol();

// Build a probe index from project
const index = await buildProbeIndex('./src');
```

## Probe Protocol

The probe protocol allows AI agents to:

1. **Analyze screenshots** of running applications
2. **Map visual elements** to source code locations
3. **Understand component hierarchy** from UI
4. **Identify gaps** between designs and implementation

## CLI Usage

```bash
# Probe a running app screenshot
paradigm probe ui screenshot.png

# Probe a design mockup
paradigm probe design mockup.png

# Probe an error screenshot
paradigm probe error error.png
```

## Documentation

See the [main repository](https://github.com/ascend42/a-paradigm) for full documentation.

## License

MIT
