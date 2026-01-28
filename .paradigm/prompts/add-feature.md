# Add Feature Prompt

Use this prompt when you want to add a new user-facing feature to the project.

---

## Prompt Template

```
I want to add a new @[FEATURE_NAME] feature.

## Description
[What the feature does - user perspective]

## Requirements
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

## Related Symbols
- Portals needed: [^portal-name if auth required]
- Signals to emit: [!success-signal, !failure-signal]
- State affected: [%state.property]
- Components to use/create: [#ComponentName]

## Additional Context
[Any extra context, constraints, or preferences]
```

---

## Example

```
I want to add a new @password-reset feature.

## Description
Allow users to reset their password via email verification.

## Requirements
- User enters email address
- System sends reset link with token
- Token expires after 1 hour
- User sets new password
- User is logged in after reset

## Related Symbols
- Portals needed: ^rate-limited (prevent abuse)
- Signals to emit: !reset-requested, !reset-completed, !reset-failed
- State affected: %user.authenticated (after successful reset)
- Components to use/create: #PasswordResetForm, #EmailInput

## Additional Context
- Use existing email service (#email-service)
- Follow same validation as @signup
```

---

## What the AI Will Do

1. Create/update `.purpose` file with feature definition
2. Implement feature following Paradigm patterns
3. Add Paradigm logger calls at entry/exit points
4. Emit appropriate signals
5. Create necessary components
6. Update `portal.yaml` if authorization needed
7. Add tests (if applicable)
