# @a-company/paradigm-logger — Public API Contract

> **Stability: Stable** — All types and interfaces documented here are public API.
> Breaking changes require a major version bump.

## Types

### `LogLevel`
```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
```

### `LogData`
```typescript
type LogData = Record<string, unknown>;
```

### `SymbolType`
```typescript
type SymbolType = 'component' | 'gate' | 'signal' | 'flow' | 'aspect' | 'raw';
```

## Interfaces

### `SymbolLogger`
Per-symbol logger instance. Returned by `log.component()`, `log.gate()`, `log.signal()`, `log.flow()`, `log.aspect()`.

```typescript
interface SymbolLogger {
  debug(message: string, data?: LogData): void;
  info(message: string, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
  start(message: string, data?: LogData): DurationTracker;
}
```

### `DurationTracker`
Returned by `SymbolLogger.start()`. Measures operation duration.

```typescript
interface DurationTracker {
  success(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
  end(level: LogLevel, message: string, data?: LogData): void;
}
```

### `LogTransport`
Implement this to route log entries to external systems (Sentinel, file, etc.).

```typescript
interface LogTransport {
  send(entry: {
    level: LogLevel;
    symbol: string;
    symbolType: SymbolType;
    message: string;
    data?: LogData;
    correlationId?: string;
    timestamp: string;
  }): void;
}
```

### `LoggerOptions`
Configuration for `ParadigmLogger` constructor.

```typescript
interface LoggerOptions {
  level?: LogLevel;        // Default: from LOG_LEVEL env or 'debug'/'info'
  symbols?: string[];      // Filter to specific symbols
  format?: 'pretty' | 'json';  // Output format
  output?: (line: string) => void;  // Custom output sink
  transports?: LogTransport[];      // Additional transports
}
```

## Usage

```typescript
import { ParadigmLogger } from '@a-company/paradigm-logger';

const log = new ParadigmLogger({ format: 'pretty' });

log.component('#user-service').info('User created', { userId: '123' });
log.gate('^authenticated').warn('Access denied', { route: '/admin' });
log.signal('!order-placed').info('New order', { orderId: 'abc' });

const tracker = log.component('#db').start('Query executing');
// ... do work ...
tracker.success('Query complete', { rows: 42 });
```

## Versioning

This package follows semver. The types above are the stable public contract:
- **Patch**: Bug fixes, no API changes
- **Minor**: New methods/fields (backward-compatible)
- **Major**: Removed or changed existing methods/fields
