# Validate Gates

Use this prompt when you need to validate that authorization gates are working correctly by reading browser console output.

---

## Overview

Gate Validation allows you to verify authorization flows by:
1. Navigating to protected routes in the browser
2. Reading structured console output from gate checks
3. Validating decisions match expected behavior

---

## How to Validate

### Step 1: Set Up Test Scenarios

Before testing, identify what scenarios to validate:

```markdown
## Test Scenarios

| # | User State | Route | Expected Gate | Expected Decision |
|---|------------|-------|---------------|-------------------|
| 1 | Logged out | /dashboard | ^authenticated | DENY |
| 2 | Logged in, no subscription | /leads | ^subscription-required | DENY |
| 3 | Logged in, active plan | /leads | ^subscription-required | ALLOW |
| 4 | Regular user | /admin | ^admin-only | DENY |
| 5 | Admin user | /admin | ^admin-only | ALLOW |
```

### Step 2: Navigate and Observe

For each scenario:

1. **Set up the user state** (log in/out, set subscription status)
2. **Navigate to the target route** using browser tools
3. **Read the console output** looking for `🚪 PORTAL CHECK:` blocks

### Step 3: Parse Gate Check Output

Look for blocks like this in the console:

```
┌─────────────────────────────────────────────────────────
│ 🚪 PORTAL CHECK: ^subscription-required
│ ├─ Requires: active subscription, trial not exceeded
│ ├─ Context: { userId: "abc123", plan: null }
│ ├─ Decision: ❌ DENY
│ └─ Reason: No active subscription
└─────────────────────────────────────────────────────────
```

Extract:
- **Gate name**: `^subscription-required`
- **Decision**: `DENY` (indicated by ❌)
- **Reason**: `No active subscription`

### Step 4: Compare to Expectations

| Expected | Observed | Match? |
|----------|----------|--------|
| ^subscription-required | ^subscription-required | ✅ |
| DENY | DENY | ✅ |

### Step 5: Report Results

```markdown
## Gate Validation Results

### Scenario 1: Logged-out user → /dashboard
- **Gate**: ^authenticated
- **Expected**: DENY
- **Actual**: DENY
- **Reason**: "No authenticated user - redirecting to login"
- **Status**: ✅ PASS

### Scenario 2: User without subscription → /leads
- **Gate**: ^subscription-required  
- **Expected**: DENY
- **Actual**: DENY
- **Reason**: "No active subscription"
- **Status**: ✅ PASS

### Summary
- Total scenarios: 5
- Passed: 5
- Failed: 0
```

---

## Reading Console in Cursor

### Using Browser Tools

1. Use `mcp_cursor-ide-browser_browser_navigate` to go to the route
2. Use `mcp_cursor-ide-browser_browser_console_messages` to read console output
3. Look for lines containing `PORTAL CHECK` or `[GATE_RESULT]`

### Example Tool Usage

```
// Navigate to protected route
browser_navigate({ url: "http://localhost:5173/dashboard" })

// Wait for page to load
browser_wait_for({ time: 2 })

// Read console messages
browser_console_messages()
```

### Parsing Console Output

When you receive console messages, look for:

**Visual format:**
```
│ 🚪 PORTAL CHECK: ^gate-name
│ ├─ Decision: ✅ ALLOW
```

**JSON format (test mode):**
```
[GATE_RESULT] {"gate":"^gate-name","decision":"allow","reason":"..."}
```

---

## Common Validation Patterns

### Pattern 1: Authentication Check

```markdown
**Test**: Unauthenticated access to protected route

1. Ensure no active session (clear cookies or use incognito)
2. Navigate to /dashboard
3. Look for: ^authenticated → DENY
4. Verify redirect to /login or /auth
```

### Pattern 2: Subscription Gating

```markdown
**Test**: Free user accessing premium feature

1. Login as user without subscription
2. Navigate to /premium-feature
3. Look for: ^subscription-required → DENY
4. Verify redirect to /pricing or /upgrade
```

### Pattern 3: Role-Based Access

```markdown
**Test**: Non-admin accessing admin panel

1. Login as regular user (not admin)
2. Navigate to /admin/settings
3. Look for: ^admin-only → DENY
4. Verify redirect or 403 display
```

### Pattern 4: Successful Access

```markdown
**Test**: Authorized user accessing allowed route

1. Login as user with correct permissions
2. Navigate to the route
3. Look for: ^gate-name → ALLOW
4. Verify page content renders correctly
```

### Pattern 5: Multi-Gate Flow

```markdown
**Test**: Route requiring multiple gates

1. Setup: Login as subscribed admin
2. Navigate to /admin/billing
3. Expect multiple GATE CHECK blocks:
   - ^authenticated → ALLOW
   - ^subscription-required → ALLOW (or bypass)
   - ^admin-only → ALLOW
4. Verify all gates pass, page renders
```

---

## Troubleshooting

### No Gate Check Output

If you don't see `🚪 PORTAL CHECK` in the console:

1. **Check environment**: Gate validation may be disabled
   - Look for `VITE_ENABLE_PORTAL_VALIDATION=true` in `.env`
2. **Check implementation**: Route guard may not use `portal.check()`
3. **Check console level**: Browser console may be filtering messages

### Unexpected DENY

If a gate denies when you expect ALLOW:

1. **Check context data**: Look at the Context line in the output
2. **Verify user state**: Is the user actually logged in with correct permissions?
3. **Check requirements**: Are all requirements met?
4. **Read the reason**: The Reason line explains why it was denied

### Unexpected ALLOW

If a gate allows when you expect DENY:

1. **Check for bypass conditions**: Admins may bypass certain gates
2. **Check gate requirements**: Maybe the gate isn't checking what you think
3. **Verify user doesn't have elevated permissions**

---

## Validation Checklist Template

Copy and fill out for each validation session:

```markdown
## Gate Validation Session

**Date**: [DATE]
**Tester**: AI Agent
**Environment**: [localhost:5173 / staging / production]

### Pre-Conditions
- [ ] Gate validation is enabled
- [ ] Test user accounts are available
- [ ] Routes to test are identified

### Test Results

| # | Scenario | Gate | Expected | Actual | Reason | Status |
|---|----------|------|----------|--------|--------|--------|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |

### Summary
- **Total Tests**: 
- **Passed**: 
- **Failed**: 
- **Blocked**: 

### Issues Found
1. [Issue description]

### Notes
[Additional observations]
```

---

## Integration with Test Checklist

When validating gates as part of a broader test plan:

1. Refer to `TESTING_CHECKLIST.md` section "Gate Validation Methodology"
2. Update checklist items as you validate each gate
3. Log issues in the Issue Tracking table
4. Note any discrepancies between expected and actual behavior

---

## See Also

- [Gate Validation Specification](../specs/portal-validation.md) - Technical spec
- [Logger Specification](../specs/logger.md) - General Paradigm logging
- [Symbols Reference](../specs/symbols.md) - Symbol system including `^` gates
