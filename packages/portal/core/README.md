# @horizon/gate-core

> Gate configuration parsing and validation

Core library for working with `gate.yaml` files - the authorization topology format for defining access control rules.

## Installation

```bash
npm install @horizon/gate-core
```

## Usage

```typescript
import { 
  parseGateConfig, 
  validateGateConfig,
  findGateFiles 
} from '@horizon/gate-core';

// Find gate.yaml files
const files = await findGateFiles('./');

// Parse a gate configuration
const config = await parseGateConfig('./gate.yaml');

// Validate the configuration
const result = validateGateConfig(config);
if (!result.valid) {
  console.error(result.errors);
}
```

## Gate File Format

```yaml
gates:
  checkout:
    description: Checkout flow access
    requires:
      - authenticated
      - has_cart_items
    signals:
      - "!checkout-started"
      - "!checkout-completed"

  admin-panel:
    description: Admin dashboard access
    requires:
      - authenticated
      - role:admin
```

## Documentation

See the [main repository](https://github.com/ascend42/a-horizon) for full documentation.

## License

MIT
