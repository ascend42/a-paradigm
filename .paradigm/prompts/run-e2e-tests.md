# Run Gate E2E Tests

> Paradigm Prompt - AI Agent Guide for Gate E2E Testing

Use this prompt when executing Gate-Driven E2E tests to validate authorization flows.

---

## Context

You are validating authorization flows using the Portal Validation system. The application emits structured console logs (`^gate` checks) that document every authorization decision. Your job is to navigate to protected routes and verify that gate checks match expectations.

## Prerequisites

Before starting, ensure:
- [ ] Application is running at the specified URL (usually `localhost:5173` or `localhost:3000`)
- [ ] Portal Validation is enabled (`VITE_ENABLE_PORTAL_VALIDATION=true`)
- [ ] Test scenarios are defined in `tests/scenarios/*.yaml` or `tests/test-scenarios.yaml`
- [ ] Test user credentials are available for each tier/role

## Reference Documentation

- `specs/portal-validation.md` - Console output format
- `specs/portal-e2e-testing.md` - Testing methodology
- `portal.yaml` - Authorization topology

---

## Execution Protocol

### Step 1: Read Test Scenarios

Load test scenarios from the project:

```yaml
# tests/scenarios/auth-flows.yaml
scenarios:
  - id: unauthenticated-protected-route
    user:
      authenticated: false
    steps:
      - navigate: /leads
        expect:
          gate: ^authenticated
          decision: DENY
          redirectTo: /login
```

### Step 2: Set Up User State

For each scenario, configure the user state:

#### Unauthenticated User
1. Navigate to `/logout` (if logout endpoint exists)
2. Or clear cookies/localStorage
3. Verify no session active

#### Authenticated User
1. Navigate to `/login`
2. Enter test credentials for specified tier/role
3. Submit login form
4. Wait for redirect to protected route
5. Verify session active

### Step 3: Execute Test Steps

For each step in the scenario:

#### Navigation Steps
```
navigate: /leads
```
1. Use `browser_navigate` to go to the URL
2. Wait for page load (`waitForLoadState('networkidle')`)
3. Read console messages

#### Click Steps
```
click: [data-testid="submit-button"]
```
1. Use `browser_click` with the selector
2. Wait for any navigation or state change
3. Read console messages

#### Type Steps
```
type:
  selector: [data-testid="email"]
  text: user@example.com
```
1. Use `browser_type` with selector and text
2. Continue to next step

### Step 4: Parse Gate Check Results

Read console output and find gate checks.

#### Visual Format
Look for lines containing:
```
┌─────────────────────────────────────────────────────────
│ 🚪 PORTAL CHECK: ^subscription-required
│ ├─ Requires: active subscription
│ ├─ Context: { userId: "abc", plan: "growth" }
│ ├─ Decision: ✅ ALLOW
│ └─ Reason: Subscription valid
└─────────────────────────────────────────────────────────
```

Extract:
- **Gate**: Text after "PORTAL CHECK:" (e.g., `^subscription-required`)
- **Decision**: Look for `✅ ALLOW` or `❌ DENY`
- **Reason**: Text after "Reason:"

#### JSON Format (Test Mode)
Look for lines starting with `[GATE_RESULT]`:
```
[GATE_RESULT] {"gate":"^authenticated","decision":"deny","reason":"No session"}
```

Parse the JSON after the prefix.

### Step 5: Compare to Expectations

For each expected result:

```yaml
expect:
  gate: ^authenticated
  decision: DENY
  redirectTo: /login
```

1. Find the gate check for the specified gate
2. Compare `decision` (ALLOW/DENY)
3. If `redirectTo` specified and decision is DENY, verify current URL

### Step 6: Generate Report

Create a summary table:

```markdown
## Gate E2E Test Results

**Date**: 2026-01-25
**Environment**: localhost:5173
**Total Scenarios**: 8
**Passed**: 7
**Failed**: 1

### Results

| Scenario | Step | Gate | Expected | Actual | Status |
|----------|------|--------|----------|--------|--------|
| unauthenticated-protected | /leads | ^authenticated | DENY | DENY | ✅ |
| starter-basic-access | /leads | ^subscription-required | ALLOW | ALLOW | ✅ |
| starter-agency-denied | /admin/team | ^agency-required | DENY | DENY | ✅ |
| growth-agency-access | /admin/team | ^agency-required | DENY | ALLOW | ❌ |

### Failures

#### growth-agency-access

- **Step**: Navigate to /admin/team
- **Expected**: ^agency-required → DENY
- **Actual**: ^agency-required → ALLOW
- **Issue**: Growth user should not access agency features
- **Console Output**:
  ```
  🚪 PORTAL CHECK: ^agency-required
  ├─ Requires: agency subscription
  ├─ Context: { tier: "growth" }
  ├─ Decision: ✅ ALLOW
  └─ Reason: [ERROR] Check bypassed
  ```
```

---

## Example Execution

### Scenario: Starter User Basic Access

**Scenario Definition**:
```yaml
- id: starter-basic-access
  user:
    authenticated: true
    email: test-starter@example.com
    tier: starter
  steps:
    - navigate: /leads
      expect:
        gate: ^subscription-required
        decision: ALLOW
```

**Execution**:

1. **Login as starter user**
   - Navigate to `/login`
   - Type `test-starter@example.com` in email field
   - Type password in password field
   - Click login button
   - Wait for redirect to `/leads`

2. **Navigate to /leads**
   - Browser already at /leads after login
   - Read console messages
   - Find gate check:
     ```
     🚪 PORTAL CHECK: ^subscription-required
     ├─ Decision: ✅ ALLOW
     └─ Reason: Starter subscription active
     ```

3. **Compare**
   - Expected: ALLOW
   - Actual: ALLOW
   - Result: ✅ PASS

---

## Test User Credentials

Typically stored in environment variables or test config:

| Tier/Role | Email | Password |
|-----------|-------|----------|
| Unauthenticated | - | - |
| Starter | test-starter@example.com | TestPassword123! |
| Growth | test-growth@example.com | TestPassword123! |
| Agency | test-agency@example.com | TestPassword123! |
| Admin | test-admin@example.com | TestPassword123! |
| Super Admin | test-super@example.com | TestPassword123! |

---

## Common Gate Checks

| Gate | Requires | Routes |
|--------|----------|--------|
| `^authenticated` | Valid session | All protected routes |
| `^public-only` | No session | /login, /signup, / |
| `^subscription-required` | Active subscription | /leads, /oracle |
| `^admin` | Admin role | /admin/* |
| `^super-admin` | Super admin role | /admin/server-* |
| `^agency-required` | Agency tier | /admin/team, /client-accounts |

---

## Troubleshooting

### Gate Check Not Found in Logs

1. **Gate validation not enabled**: Set `VITE_ENABLE_PORTAL_VALIDATION=true`
2. **Route doesn't have gate check**: Add `portal.check()` to route guard
3. **Check completed before console read**: Add wait after navigation

### Wrong Decision

1. **User state not set correctly**: Verify login completed
2. **Cached session**: Clear auth state before test
3. **RLS policy issue**: Check database permissions

### Redirect Not Working

1. **Redirect is async**: Wait for navigation to complete
2. **Different redirect target**: Check route guard logic
3. **Modal instead of redirect**: Some flows show modal, not redirect

---

## Coverage Analysis

After running tests, analyze coverage:

1. **List all gates** from `portal.yaml`
2. **Find tested gates** from scenario files
3. **Identify gaps**:
   - Gates without any test
   - Gates only tested for ALLOW (not DENY)
   - Gates only tested for DENY (not ALLOW)

```markdown
## Coverage Report

| Gate | Tested | ALLOW Test | DENY Test |
|--------|--------|------------|-----------|
| ^authenticated | ✅ | ✅ | ✅ |
| ^subscription-required | ✅ | ✅ | ✅ |
| ^admin | ✅ | ✅ | ✅ |
| ^agency-required | ✅ | ❌ | ✅ |
| ^super-admin | ❌ | ❌ | ❌ |

**Coverage**: 4/5 gates tested (80%)
**Recommendation**: Add tests for ^super-admin
```

---

## Browser Tools Reference

The AI agent uses Cursor's browser tools for validation:

| Tool | Purpose | Example |
|------|---------|---------|
| `browser_navigate` | Navigate to URL | `browser_navigate("/leads")` |
| `browser_type` | Enter text in field | `browser_type(ref="email", text="user@example.com")` |
| `browser_click` | Click element | `browser_click(ref="submit")` |
| `browser_wait_for` | Wait for load | `browser_wait_for(time=2)` |
| `browser_console_messages` | Read console | Returns all console output |
| `browser_snapshot` | Get page state | Returns accessibility tree |

### Typical Validation Flow

```
1. browser_navigate("/login")
2. browser_snapshot() - get form element refs
3. browser_type(ref="email", text="test-starter@example.com")
4. browser_type(ref="password", text="TestPassword123!")
5. browser_click(ref="submit")
6. browser_wait_for(time=2)
7. browser_navigate("/leads")
8. browser_console_messages() - read gate checks
9. [Parse output and validate against expectations]
```

---

## Checklist

Before submitting test results:

- [ ] All scenarios executed
- [ ] Console output captured for each step
- [ ] Gate decisions extracted and compared
- [ ] Failures documented with context
- [ ] Coverage analysis completed
- [ ] Recommendations provided for gaps
