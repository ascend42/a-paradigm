# @horizon/gate-sdk

> Runtime SDK for checking gates in applications

Use gates at runtime to enforce authorization rules defined in your `gate.yaml`.

## Installation

```bash
npm install @horizon/gate-sdk
```

## Usage

```typescript
import { createGateClient, checkGate } from '@horizon/gate-sdk';

// Initialize the client with your gate config
const client = await createGateClient('./gate.yaml');

// Check if a gate allows access
const canCheckout = await client.check('checkout', {
  user: currentUser,
  context: { cartItems: cart.items }
});

if (canCheckout.allowed) {
  // Proceed with checkout
} else {
  // Handle denial
  console.log(canCheckout.reason);
}
```

### With Decorators

```typescript
import { Gate } from '@horizon/gate-sdk/decorators';

class CheckoutService {
  @Gate('checkout')
  async processCheckout(userId: string) {
    // Only runs if gate passes
  }
}
```

## Documentation

See the [main repository](https://github.com/ascend42/a-horizon) for full documentation.

## License

MIT
