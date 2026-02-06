# Add Gate Prompt (v2)

Use this prompt when you need to add authorization/access control.

---

## Prompt Template

```
I need to add authorization gate ^[GATE_NAME].

## Purpose
[What this gate protects and why]

## Requirements
- Who can pass: [conditions]
- Who is blocked: [conditions]
- When it applies: [routes/features]

## Behavior on Denial
- Response: [401/403/redirect]
- Signal to emit: ![signal-name]
- User feedback: [message/redirect]

## Related Symbols
- Features protected: #[feature-names]
- Existing gates to combine with: ^[gate-names]

## Tags
[security, compliance, etc.]

## Additional Context
[Any other relevant info]
```

---

## Example

```
I need to add authorization gate ^premium-only.

## Purpose
Restrict certain features to users with an active premium subscription.

## Requirements
- Who can pass: Users with subscription.status === 'active' and subscription.tier === 'premium'
- Who is blocked: Free users, expired subscriptions, basic tier
- When it applies: #advanced-analytics, #bulk-export, #priority-support

## Behavior on Denial
- Response: 403 Forbidden
- Signal to emit: !premium-required
- User feedback: Redirect to /upgrade with message "This feature requires Premium"

## Related Symbols
- Features protected: #advanced-analytics, #bulk-export, #priority-support
- Existing gates to combine with: ^authenticated (must be logged in first)

## Tags
[security, subscription]

## Additional Context
- Subscription data is in #user-store
- We use Stripe for billing
- Should work with existing ^authenticated gate (chain them)
```

---

## Gate Implementation Checklist

The AI should:

1. **Add to portal.yaml:**
   ```yaml
   gates:
     ^premium-only:
       description: Requires active premium subscription
       tags: [security, subscription]
       anchors:  # Link to implementation (recommended)
         - src/middleware/premium.ts:10-35
       locks:
         - id: subscription-check
           keys:
             - user.subscription.status === 'active'
             - user.subscription.tier === 'premium'
       prizes:
         - id: premium-required
           oneTime: false
   ```

2. **Implement gate middleware:**
   ```
   function requirePremium(request, next):
       log.gate('^premium-only').debug('Checking ^premium-only')

       if not user.subscription or user.subscription.status !== 'active':
           log.gate('^premium-only').warn('Access denied - not premium', {
               userId: user.id,
               subscriptionStatus: user.subscription?.status
           })
           log.signal('!premium-required').info('Premium upgrade prompt', {
               userId: user.id,
               feature: request.path
           })
           return forbidden("Premium subscription required")

       log.gate('^premium-only').debug('Gate passed')
       return next()
   ```

3. **Apply to protected routes:**
   - Chain with existing ^authenticated
   - Apply before feature handlers

4. **Update .purpose files:**
   - Add gate reference to protected features
   ```yaml
   #advanced-analytics:
     description: Advanced analytics dashboard
     tags: [feature, premium]
     gates: [^authenticated, ^premium-only]
   ```

5. **Test scenarios:**
   - No subscription
   - Expired subscription
   - Basic tier
   - Active premium
   - Combined with other gates

---

## Gate Anchors (v2 Feature)

In v2, gates can have optional anchors pointing to their implementation code:

```yaml
^premium-only:
  description: Requires active premium subscription
  anchors:
    - src/middleware/premium.ts:10-35    # Middleware implementation
    - src/guards/subscription.ts:5-20    # Guard function
```

Anchor format: `file.ts:15` (single line), `file.ts:15-20` (range)

This helps AI agents:
- Find the enforcement code quickly
- Verify gate logic matches description
- Update implementation when requirements change

---

## v2 Symbol Reference

| Old Reference | New Reference |
|---------------|---------------|
| `@feature protected` | `#feature` with `gates: [^gate-name]` |
| `%user.subscription` | `#user-store` with `tags: [state]` |
