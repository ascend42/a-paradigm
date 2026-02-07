# Debug Authentication Prompt

Use this prompt when you're having issues with authentication or authorization.

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
10:00:00 #login-handler INFO Starting #login-handler {"email":"user@example.com"}
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

## Debugging Tips

1. **Filter logs to auth-related symbols:**
   ```bash
   PARADIGM_SYMBOLS=#,^,! LOG_LEVEL=debug
   ```

2. **Check portal definitions in `portal.yaml`**

3. **Trace the flow:**
   - #login-handler → token creation
   - ^authenticated → token validation
   - !session-expired → why triggered?

4. **Common issues:**
   - Token expiry mismatch
   - Clock skew between servers
   - Cookie domain/path issues
   - Missing refresh token logic
