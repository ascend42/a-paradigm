# @a-company/paradigm-logger

> Symbol-typed structured logging for Paradigm v2

## Installation

```bash
npm install @a-company/paradigm-logger
```

## Usage

```typescript
import { log } from '@a-company/paradigm-logger';

// Component — any documented code unit
log.component('#user-service').info('User created', { userId });
log.component('#database').debug('Query executed', { duration });

// Gate — authorization checkpoints
log.gate('^authenticated').warn('Access denied', { userId });
log.gate('^admin-only').info('Admin access granted');

// Signal — events and side effects
log.signal('!payment-completed').info('Payment processed', { amount });
log.signal('!login-failed').error('Invalid credentials', { email });

// Flow — multi-step processes
log.flow('$checkout').info('Step completed', { step: 2, total: 4 });
log.flow('$onboarding').debug('User reached final step');

// Aspect — cross-cutting rules
log.aspect('~audit-required').debug('Audit logged', { operation });
log.aspect('~rate-limited').warn('Rate limit approaching', { remaining: 5 });

// Raw — untyped symbol
log.raw('custom-prefix').info('Custom log entry');
```

## API

### `ParadigmLogger`

Create a custom logger instance:

```typescript
import { ParadigmLogger } from '@a-company/paradigm-logger';

const log = new ParadigmLogger({
  level: 'info',           // 'debug' | 'info' | 'warn' | 'error'
  format: 'pretty',        // 'pretty' | 'json'
  symbols: ['#', '^'],     // Filter to specific symbol types
  output: (line) => {},    // Custom output handler
});
```

### Symbol Methods

| Method | Symbol | Prefix |
|--------|--------|--------|
| `log.component(symbol)` | Component | `#` |
| `log.gate(symbol)` | Gate | `^` |
| `log.signal(symbol)` | Signal | `!` |
| `log.flow(symbol)` | Flow | `$` |
| `log.aspect(symbol)` | Aspect | `~` |
| `log.raw(symbol)` | Raw | (none) |

Each returns a `SymbolLogger` with `.debug()`, `.info()`, `.warn()`, `.error()`, and `.start()` methods.

### Duration Tracking

```typescript
const tracker = log.component('#api-handler').start('Processing request', { path: '/api/users' });

// ... do work ...

tracker.success('Request completed', { statusCode: 200 });
// or
tracker.error('Request failed', { statusCode: 500 });
```

### Correlation IDs

```typescript
import { withCorrelation, createCorrelationId } from '@a-company/paradigm-logger';

const correlationId = createCorrelationId();
withCorrelation(correlationId, () => {
  // All logs within this callback include the correlation ID
  log.component('#handler').info('Processing');
});
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Minimum log level | `debug` (dev), `info` (prod) |
| `PARADIGM_LOG_FORMAT` | Output format (`pretty` or `json`) | `pretty` (dev), `json` (prod) |
| `PARADIGM_SYMBOLS` | Comma-separated symbol prefixes to include | all |
| `NODE_ENV` | Affects defaults for level and format | — |

## License

MIT
