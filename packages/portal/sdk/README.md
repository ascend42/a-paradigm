# @a-company/portal-sdk

> Runtime SDK for checking gates in applications

Use gates at runtime to enforce authorization rules defined in your `portal.yaml`.

## Installation

```bash
npm install @a-company/portal-sdk
```

## Usage

```typescript
import { createGateClient, checkGate } from '@a-company/portal-sdk';

// Initialize the client with your portal config
const client = await createGateClient('./portal.yaml');

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
import { Gate } from '@a-company/portal-sdk/decorators';

class CheckoutService {
  @Gate('checkout')
  async processCheckout(userId: string) {
    // Only runs if gate passes
  }
}
```

## Documentation

See the [main repository](https://github.com/ascend42/a-paradigm) for full documentation.

## License

MIT
