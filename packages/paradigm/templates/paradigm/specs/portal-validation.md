# Portal Validation Specification

The Portal Validation system enables **AI agents to validate authorization flows** by reading structured console output. This creates a feedback loop where applications emit parseable logs and AI agents verify decisions match expectations.

---

## Core Principle

**Portals are self-documenting. Every gate check emits a structured log that explains what was checked, why, and what decision was made.**

This enables:
- **No test code required** - Logs ARE the tests
- **Self-documenting** - Logs explain what happened and why
- **Real browser validation** - Not mocked or simulated
- **Context awareness** - AI understands nuance and edge cases
- **Continuous validation** - Every navigation is a test

---

## Output Format

### Visual Block (Human + AI Readable)

Every portal check emits a boxed output to the console:

```
┌─────────────────────────────────────────────────────────
│ 🚪 PORTAL CHECK: ^subscription-required
│ ├─ Requires: active subscription, trial not exceeded
│ ├─ Context: { userId: "abc123", plan: "growth", isTrialing: false }
│ ├─ Decision: ✅ ALLOW
│ └─ Reason: Subscription valid - growth plan active
└─────────────────────────────────────────────────────────
```

#### Block Structure

| Line | Content | Purpose |
|------|---------|---------|
| Header | `🚪 PORTAL CHECK: ^gate-name` | Identifies the gate being checked |
| Requires | `├─ Requires: requirement1, requirement2` | Documents what the gate needs |
| Context | `├─ Context: { ... }` | Shows data used in the decision |
| Decision | `├─ Decision: ✅ ALLOW` or `❌ DENY` | The outcome |
| Reason | `└─ Reason: Human-readable explanation` | Why this decision was made |

### JSON Line (Machine Readable)

When `TEST_MODE` is enabled, each portal check also emits a parseable JSON line:

```
[GATE_RESULT] {"gate":"^subscription-required","requires":["active subscription","trial not exceeded"],"context":{"userId":"abc123","plan":"growth"},"decision":"allow","reason":"Subscription valid - growth plan active","timestamp":"2026-01-24T12:00:00.000Z","duration":15}
```

#### JSON Schema

```typescript
interface GateResult {
  gate: string;           // Gate identifier (e.g., "^subscription-required")
  requires: string[];     // List of requirements
  context: object;        // Context data used in decision
  decision: 'allow' | 'deny' | 'pending';
  reason: string;         // Human-readable explanation
  timestamp: string;      // ISO 8601 timestamp
  duration?: number;      // Milliseconds to evaluate (optional)
}
```

---

## Decision Types

| Decision | Icon | Meaning |
|----------|------|---------|
| `allow` | ✅ | Access granted - user may proceed |
| `deny` | ❌ | Access denied - user blocked/redirected |
| `pending` | ⏳ | Async check in progress (will resolve to allow/deny) |

---

## API Design

### Fluent Builder Pattern

```typescript
import { portal } from '@paradigm/portal-validator';

// Full fluent API
const gate = portal.check('^subscription-required')
  .requires('active subscription', 'trial not exceeded', 'monthly limit not exceeded')
  .context({ 
    userId: user.id,
    plan: subscription?.plan,
    isTrialing: subscription?.status === 'trialing',
  });

// Decision based on evaluation
if (!subscription || subscription.status !== 'active') {
  gate.deny('No active subscription');
  return <Navigate to="/select-plan" />;
}

gate.allow('Subscription valid - ' + subscription.plan + ' plan active');
```

### Quick Methods

For simple cases without detailed requirements:

```typescript
// Quick allow
portal.allow('^public-access', 'Route is public', { path });

// Quick deny
portal.deny('^authenticated', 'No session', { path });
```

---

## AI Validation Protocol

### Step 1: Navigate to Protected Route

The AI agent navigates to a route that should trigger portal checks:

```
Navigate to /dashboard
```

### Step 2: Read Console Output

The AI agent reads the browser console, looking for `🚪 PORTAL CHECK:` entries or `[GATE_RESULT]` JSON lines.

### Step 3: Parse Gate Results

For visual blocks:
1. Find lines starting with `│ 🚪 PORTAL CHECK:`
2. Extract gate name after the colon
3. Find `Decision:` line and extract ✅/❌ and ALLOW/DENY
4. Find `Reason:` line for explanation

For JSON lines:
1. Find lines starting with `[GATE_RESULT]`
2. Parse JSON after the prefix
3. Access `.decision` and `.reason` directly

### Step 4: Validate Against Expectations

Compare observed decision to expected outcome:

| Scenario | Expected | Observed | Result |
|----------|----------|----------|--------|
| Logged-out user → /dashboard | DENY | DENY | ✅ Pass |
| Admin user → /admin | ALLOW | ALLOW | ✅ Pass |
| Regular user → /admin | DENY | ALLOW | ❌ Fail |

### Step 5: Report Findings

The AI agent reports validation results:

```markdown
## Portal Validation Results

| Gate | Expected | Actual | Status |
|------|----------|--------|--------|
| ^authenticated | ALLOW | ALLOW | ✅ |
| ^subscription-required | ALLOW | ALLOW | ✅ |
| ^admin-only | DENY | DENY | ✅ |

All 3 portal checks passed.
```

---

## Common Validation Scenarios

### Scenario 1: Authentication Flow

```markdown
Test: Unauthenticated user accessing protected route

1. Clear session/logout
2. Navigate to /dashboard
3. Expect: ^authenticated → DENY, reason contains "no session" or "not logged in"
4. Expect: Redirect to /login or /auth
```

### Scenario 2: Subscription Gating

```markdown
Test: User without subscription accessing premium feature

1. Login as user without active subscription
2. Navigate to /leads
3. Expect: ^subscription-required → DENY
4. Expect: Redirect to /select-plan
```

### Scenario 3: Role-Based Access

```markdown
Test: Non-admin accessing admin route

1. Login as regular user
2. Navigate to /admin/settings
3. Expect: ^admin-only → DENY
4. Expect: Redirect or 403 page
```

### Scenario 4: Multi-Gate Flow

```markdown
Test: Successful access through multiple gates

1. Login as subscribed admin user
2. Navigate to /admin/billing
3. Expect: ^authenticated → ALLOW
4. Expect: ^subscription-required → ALLOW (or bypass for admin)
5. Expect: ^admin-only → ALLOW
6. Expect: Page renders successfully
```

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORTAL_VALIDATION` | Enable portal logging | `true` in dev, `false` in prod |
| `PORTAL_TEST_MODE` | Emit JSON lines for parsing | `false` |
| `PORTAL_LOG_LEVEL` | Minimum level to show | `debug` in dev, `warn` in prod |

### Framework-Specific Variables

| Framework | Enable Logging | Test Mode |
|-----------|----------------|-----------|
| Vite/React | `VITE_ENABLE_PORTAL_VALIDATION` | `VITE_TEST_MODE` |
| Next.js | `NEXT_PUBLIC_PORTAL_VALIDATION` | `NEXT_PUBLIC_TEST_MODE` |
| Node.js | `PORTAL_VALIDATION` | `PORTAL_TEST_MODE` |

---

## Implementation Checklist

When implementing Portal Validation in a project:

- [ ] Import or create portal validator utility
- [ ] Wrap all route guards with `portal.check()`
- [ ] Document requirements with `.requires()`
- [ ] Include relevant context with `.context()`
- [ ] Call `.allow()` or `.deny()` with clear reasons
- [ ] Configure environment variables
- [ ] Test with AI agent reading console

---

## Best Practices

### 1. Be Specific with Gate Names

```typescript
// Good - specific and descriptive
portal.check('^subscription-required')
portal.check('^admin-only')
portal.check('^agency-feature')

// Bad - vague
portal.check('^auth')
portal.check('^check')
```

### 2. Document All Requirements

```typescript
// Good - clear requirements
portal.check('^checkout')
  .requires('authenticated user', 'items in cart', 'valid payment method')

// Bad - no requirements documented
portal.check('^checkout')
```

### 3. Include Relevant Context

```typescript
// Good - includes debugging info
.context({ 
  userId: user.id,
  cartItems: cart.length,
  hasPaymentMethod: !!paymentMethod,
})

// Bad - no context
.context({})
```

### 4. Write Clear Reasons

```typescript
// Good - explains the decision
gate.deny('Cart is empty - at least one item required for checkout');
gate.allow('All checkout requirements met');

// Bad - vague reasons
gate.deny('Failed');
gate.allow('OK');
```

### 5. Handle Edge Cases

```typescript
// Good - handles async/loading states
if (isLoading) {
  return gate.pending('Checking subscription status...');
}

// Document bypass conditions
if (isSuperAdmin) {
  gate.allow('Super admin bypass - subscription check skipped');
  return children;
}
```

---

## Integration with Paradigm Logger

Portal Validation extends the Paradigm Logger's `^portal` symbol type:

```typescript
// Standard Paradigm logging
log.portal('^checkout').info('User entered checkout');

// Portal Validation (structured decision output)
portal.check('^checkout')
  .requires('authenticated', 'has cart items')
  .context({ userId, cartItems: cart.length })
  .allow('Checkout access granted');
```

Both work together:
- Use `log.portal()` for general portal-related logging
- Use `portal.check()` for authorization decisions that need validation

---

## Reference Implementations

See working implementations:
- **TypeScript (Browser)**: `@paradigm/portal-validator` - CSS styled console output
- **TypeScript (Node.js)**: ANSI colored output with JSON mode
- **React**: Hook-based `usePortalCheck()` for route guards

---

## Platform Considerations

> **Note**: This specification is primarily designed for **web applications**. Mobile platforms require adaptations.

### Web (Primary Target)

The visual block format with styled console output works in:
- Chrome, Firefox, Safari, Edge DevTools
- Cursor browser tools (`browser_console_messages()`)
- Playwright/Puppeteer console capture

### Mobile Adaptations

Mobile platforms **cannot display styled console output**. Use JSON-only format:

```typescript
// Mobile portal validator configuration
const portal = createPortalValidator({
  outputFormat: 'json-only',  // No visual blocks
  logTarget: 'native',         // Use native logging
});

// Output goes to native logs:
// Android: Logcat with tag "PORTAL"
// iOS: os_log with subsystem "com.app.portal"
```

#### React Native

```typescript
// Use console.log which bridges to native
portal.check('^authenticated')
  .context({ userId })
  .allow('Session valid');
// Outputs to Metro bundler console AND native logs
```

#### Flutter

```dart
// Use debugPrint or developer.log
import 'dart:developer' as developer;

void logPortalCheck(String gate, String decision, String reason) {
  developer.log(
    '{"gate":"$gate","decision":"$decision","reason":"$reason"}',
    name: 'PORTAL',
  );
}
```

#### iOS Native

```swift
import os.log

let portalLog = OSLog(subsystem: "com.app.portal", category: "gate")

func logPortalCheck(gate: String, decision: String, reason: String) {
    os_log(
        "[GATE_RESULT] {\"gate\":\"%{public}@\",\"decision\":\"%{public}@\",\"reason\":\"%{public}@\"}",
        log: portalLog,
        type: .info,
        gate, decision, reason
    )
}
```

#### Android Native

```kotlin
import android.util.Log

fun logPortalCheck(gate: String, decision: String, reason: String) {
    Log.i("PORTAL", """[GATE_RESULT] {"gate":"$gate","decision":"$decision","reason":"$reason"}""")
}
```

### AI Agent Limitations

| Capability | Web | Mobile |
|------------|-----|--------|
| Read console in real-time | ✅ | ❌ |
| Parse portal checks | ✅ | ⚠️ (from log files) |
| Automated testing | ✅ Playwright | ⚠️ Detox/Appium |
| Visual block format | ✅ | ❌ |
| JSON format | ✅ | ✅ |

For mobile, AI agents can:
- Generate test scenarios
- Review test code
- Analyze log files (post-execution)
- Validate JSON output format

---

## Changelog

| Version | Changes |
|---------|---------|
| 1.0 | Initial specification |
| 1.1 | Added platform considerations for mobile |