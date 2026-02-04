# Add Portal Prompt

Use this prompt when you need to add authorization/access control.

---

## Prompt Template

```
I need to add authorization portal ^[PORTAL_NAME].

## Purpose
[What this portal protects and why]

## Requirements
- Who can pass: [conditions]
- Who is blocked: [conditions]
- When it applies: [routes/features]

## Behavior on Denial
- Response: [401/403/redirect]
- Signal to emit: ![signal-name]
- User feedback: [message/redirect]

## Related Symbols
- Features protected: @[feature-names]
- Existing portals to combine with: ^[portal-names]

## Additional Context
[Any other relevant info]
```

---

## Example

```
I need to add authorization portal ^premium-only.

## Purpose
Restrict certain features to users with an active premium subscription.

## Requirements
- Who can pass: Users with subscription.status === 'active' and subscription.tier === 'premium'
- Who is blocked: Free users, expired subscriptions, basic tier
- When it applies: @advanced-analytics, @bulk-export, @priority-support

## Behavior on Denial
- Response: 403 Forbidden
- Signal to emit: !premium-required
- User feedback: Redirect to /upgrade with message "This feature requires Premium"

## Related Symbols
- Features protected: @advanced-analytics, @bulk-export, @priority-support
- Existing portals to combine with: ^authenticated (must be logged in first)

## Additional Context
- Subscription data is in %user.subscription
- We use Stripe for billing
- Should work with existing ^authenticated portal (chain them)
```

---

## Portal Implementation Checklist

The AI should:

1. **Add to portal.yaml:**
   ```yaml
   # Either 'gates:' or 'portals:' key works
   gates:
     premium-only:
       description: Requires active premium subscription
       locks:
         - id: subscription-check
           keys:
             - user.subscription.status === 'active'
             - user.subscription.tier === 'premium'
       prizes:
         - id: premium-required
           oneTime: false
   ```

2. **Implement portal middleware:**
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
       
       log.gate('^premium-only').debug('Portal passed')
       return next()
   ```

3. **Apply to protected routes:**
   - Chain with existing ^authenticated
   - Apply before feature handlers

4. **Update .purpose files:**
   - Add portal reference to protected features

5. **Test scenarios:**
   - No subscription
   - Expired subscription
   - Basic tier
   - Active premium
   - Combined with other portals
