# Pathway: Trace a Flow

Use this prompt when you need to understand or debug a multi-step process.

---

## Prerequisites

Before tracing, gather context:

1. **Check the constellation** for flow definitions:
   - File: `.paradigm/constellation.json`
   - Look in `orbits` section for `$flow-name` sequences

2. **Read the beacon** for overview:
   - File: `.paradigm/beacon.md`
   - See which flows exist in the project

3. **Check ripple effects:**
   - Run: `paradigm ripple $[flow-name]`
   - Understand what symbols are part of this flow

---

## Prompt Template

```
Walk me through the $[FLOW_NAME] flow.

## What I Want to Understand
- [Specific question 1]
- [Specific question 2]

## Context
[Why you're asking - debugging issue, planning changes, etc.]

## Current Observation (if debugging)
- Step that's failing: [step name]
- Error/behavior: [what's happening]
- Relevant logs: [if available]
```

---

## Example

```
Walk me through the $checkout-flow.

## What I Want to Understand
- What happens between payment submission and order confirmation?
- Where does inventory get reserved?
- What signals are emitted at each step?

## Context
Customers are reporting that sometimes orders show as "pending" indefinitely.
Need to understand where the flow might be getting stuck.

## Current Observation
- Step that's failing: Somewhere between payment and confirmation
- Error/behavior: Order stays in "pending" status, no confirmation email
- Relevant logs:
```
14:30:00 $checkout-flow INFO Step completed {"from":"payment","to":"processing"}
14:30:01 #payment-processor INFO Payment authorized {"orderId":"123"}
14:30:01 !payment-success INFO Payment processed {"orderId":"123"}
# ... nothing after this
```
```

---

## Finding Flow Definitions

### 1. Check the Constellation

```bash
paradigm constellation
```

Look in `.paradigm/constellation.json`:

```json
{
  "orbits": {
    "$checkout-flow": {
      "sequence": ["@cart", "@shipping", "@payment", "@confirmation"]
    }
  }
}
```

### 2. Find in .purpose Files

Flows are often defined in feature .purpose files:
- Look in `src/features/` directories
- Search for `flows:` sections

### 3. Check portal.yaml

Flows may reference gate sequences:
- File: `portal.yaml`
- Look for `flows:` section

---

## What the AI Will Do

1. **Map the flow:**
   - Find $flow definition in .purpose files or portal.yaml
   - Identify all steps and transitions
   - List components involved at each step

2. **Document each step:**
   ```
   $checkout-flow
   
   Step 1: @cart
   - Component: #CartPage
   - Entry: User clicks "Checkout"
   - Exit signal: !checkout-started
   - Next: @shipping
   
   Step 2: @shipping
   - Component: #ShippingForm
   - Portal: ^authenticated
   - Validates: address, shipping method
   - Exit signal: !shipping-confirmed
   - Next: @payment
   
   ...
   ```

3. **Identify checkpoints:**
   - Portals that must pass
   - Signals that should emit
   - State changes expected

4. **Debug assistance:**
   - Where logs should appear
   - What's missing from the trace
   - Likely failure points

---

## Flow Debugging Tips

### 1. Enable Full Logging

```bash
LOG_LEVEL=debug PARADIGM_SYMBOLS=$,!,@
```

### 2. Check for Step Signals

Each step should emit a signal on entry/exit:
- Missing signal = step didn't complete
- Look for: `!step-started`, `!step-completed`

### 3. Verify State Transitions

```
%order.status should change at each step:
  @cart      → "cart"
  @shipping  → "shipping"
  @payment   → "payment"
  @confirm   → "confirmed"

Stuck status = process interrupted
```

### 4. Look for Error Signals

Common failure signals:
- `!payment-failed`
- `!inventory-unavailable`
- `!validation-error`

### 5. Check External Services

If flow involves external services:
- Payment processor responses
- Email service confirmations
- Inventory system updates

---

## After Tracing

1. **Update the thread:**
   ```bash
   paradigm thread save "Traced $checkout-flow - found issue at payment step"
   ```

2. **Add echoes for errors found:**
   - Edit: `.paradigm/echoes.yaml`
   - Map error codes to symbols

3. **Document findings:**
   ```bash
   paradigm thread note "Payment webhook not triggering order completion"
   ```
