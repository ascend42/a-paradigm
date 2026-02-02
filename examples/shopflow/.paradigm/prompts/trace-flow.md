# Trace Flow Prompt

Use this prompt when you need to understand or debug a multi-step process.

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

## What the AI Will Do

1. **Map the flow:**
   - Find $flow definition in .purpose files
   - Identify all steps and transitions
   - List components involved at each step

2. **Document each step:**
   ```
   $checkout-flow
   
   Step 1: cart
   - Component: #CartPage
   - Entry: User clicks "Checkout"
   - Exit signal: !checkout-started
   - Next: shipping
   
   Step 2: shipping
   - Component: #ShippingForm
   - Gate: ^authenticated
   - Validates: address, shipping method
   - Exit signal: !shipping-confirmed
   - Next: payment
   
   ...
   ```

3. **Identify checkpoints:**
   - Gates that must pass
   - Signals that should emit
   - State changes expected

4. **Debug assistance:**
   - Where logs should appear
   - What's missing from the trace
   - Likely failure points

---

## Flow Debugging Tips

1. **Enable full logging:**
   ```bash
   LOG_LEVEL=debug HORIZON_SYMBOLS=$,!,@
   ```

2. **Check for step signals:**
   - Each step should emit a signal on entry/exit
   - Missing signal = step didn't complete

3. **Verify state transitions:**
   - %order.status should change at each step
   - Stuck status = process interrupted

4. **Look for error signals:**
   - !payment-failed
   - !inventory-unavailable
   - !validation-error

5. **Check external services:**
   - Payment processor responses
   - Email service confirmations
   - Inventory system updates
