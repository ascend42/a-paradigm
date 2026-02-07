# Pathway: Debug Authentication

Use this prompt when you're having issues with authentication or authorization.

---

## Prerequisites

Before debugging, gather context:

1. **Check the echo for error codes:**
   - File: `.paradigm/echoes.yaml`
   - Run: `paradigm echo AUTH_REQUIRED` (or relevant error code)

2. **Review gate definitions:**
   - File: `portal.yaml`
   - Look for the `^gate-name` that's failing

3. **Check ripple effects:**
   - Run: `paradigm ripple ^authenticated` (or relevant gate)
   - Understand what depends on this gate

---

## Prompt Template

```
Help me debug the authentication/authorization flow.

## Issue
[Describe what's happening]

## Expected Behavior
[What should happen]

## Actual Behavior
[What's actually happening]

## Relevant Symbols
- Component: #[component-name]
- Gates: ^[gate-name]
- Signals seen: ![signal-name]

## Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Log Output (if available)
```
[Paste relevant log lines]
```

## Additional Context
[Any other relevant info]
```

---

## Example

```
Help me debug the authentication flow.

## Issue
Users are being logged out unexpectedly after 5 minutes.

## Expected Behavior
Users should stay logged in until they explicitly log out or after 24 hours of inactivity.

## Actual Behavior
The ^authenticated gate fails after ~5 minutes, redirecting to login.

## Relevant Symbols
- Component: #login-handler
- Gates: ^authenticated
- Signals seen: !session-expired (appearing in logs)

## Steps to Reproduce
1. Log in with valid credentials
2. Wait 5 minutes without activity
3. Try to access /dashboard
4. Redirected to /login

## Log Output
```
10:00:00 #login-handler INFO Starting login {"email":"user@example.com"}
10:00:01 !login-success INFO User authenticated {"userId":"123"}
10:05:02 ^authenticated WARN Access denied - session expired {"userId":"123"}
10:05:02 !session-expired WARN Session expired {"userId":"123"}
```

## Additional Context
- Using JWT tokens stored in httpOnly cookies
- Token expiry set to 24h in config
- Issue started after last deployment
```

---

## Debugging Steps

### 1. Check Gate Configuration

Review the gate definition:
- File: `portal.yaml`
- Look for: `^authenticated` gate definition

```yaml
# Expected in portal.yaml
gates:
  authenticated:
    description: User must be logged in
    locks:
      - id: session-valid
        keys:
          - expression: "user.session.valid"
```

### 2. Filter Logs to Auth Symbols

```bash
PARADIGM_SYMBOLS=#login-handler,^authenticated,!session-expired LOG_LEVEL=debug
```

### 3. Trace the Auth Flow

Run ripple analysis:
```bash
paradigm ripple ^authenticated
```

This shows:
- What components depend on this gate
- What signals are related
- Where the gate is defined

### 4. Check the Constellation

```bash
paradigm constellation
```

Then look in `.paradigm/constellation.json` for:
- `^authenticated` relationships
- What `requiredBy` this gate

---

## Common Issues

| Issue | Likely Cause | Check |
|-------|--------------|-------|
| Session expires early | Token expiry mismatch | JWT exp claim vs config |
| Gate always fails | Missing context | Check keys expression |
| Intermittent failures | Clock skew | Server time sync |
| After deployment | Code change | Git diff on auth files |

---

## After Debugging

1. **Update echoes if new error pattern found:**
   - Edit: `.paradigm/echoes.yaml`
   
2. **Document the fix:**
   ```bash
   paradigm thread save "Fixed ^authenticated session expiry issue"
   ```

3. **Add breadcrumb for future:**
   ```bash
   paradigm thread note "JWT expiry must match cookie maxAge"
   ```
