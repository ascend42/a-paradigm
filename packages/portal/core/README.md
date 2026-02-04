# @a-company/portal-core

> Portal configuration parsing and validation

Core library for working with `portal.yaml` files - the authorization topology format for defining access control rules.

## Installation

```bash
npm install @a-company/portal-core
```

## Usage

```typescript
import { 
  parsePortalConfig, 
  validatePortalConfig,
  findPortalFiles 
} from '@a-company/portal-core';

// Find portal.yaml files
const files = await findPortalFiles('./');

// Parse a portal configuration
const config = await parsePortalConfig('./portal.yaml');

// Validate the configuration
const result = validatePortalConfig(config);
if (!result.valid) {
  console.error(result.errors);
}
```

## Portal File Format

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

See the [main repository](https://github.com/ascend42/a-paradigm) for full documentation.

## License

MIT
