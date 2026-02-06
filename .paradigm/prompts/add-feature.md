# Pathway: Add a New Feature (v2)

Use this prompt when you want to add a new user-facing feature to the project.

---

## Prerequisites

Before starting, gather context:

1. **Get project orientation:**
   - Run: `paradigm beacon` or use MCP tool `paradigm_status`

2. **Check for similar features:**
   - Run: `paradigm constellation` or use MCP tool `paradigm_search`
   - Look for patterns in existing `#component` symbols with `[feature]` tag

3. **Review existing .purpose files** for format reference:
   - Example: Look in `src/features/` directories for `.purpose` files

---

## Prompt Template

```
I want to add a new #[FEATURE_NAME] feature.

## Description
[What the feature does - user perspective]

## Requirements
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

## Related Symbols
- Gates needed: [^gate-name if auth required]
- Signals to emit: ["!success-signal", "!failure-signal"]
- Components to use/create: [#ComponentName]
- Aspects to apply: [~audit-required if needed]

## Tags
[feature, critical, etc.]

## Additional Context
[Any extra context, constraints, or preferences]
```

---

## Example

```
I want to add a new #password-reset feature.

## Description
Allow users to reset their password via email verification.

## Requirements
- User enters email address
- System sends reset link with token
- Token expires after 1 hour
- User sets new password
- User is logged in after reset

## Related Symbols
- Gates needed: ^rate-limited (prevent abuse)
- Signals to emit: !reset-requested, !reset-completed, !reset-failed
- Components to use/create: #PasswordResetForm, #EmailInput

## Tags
[feature, security]

## Additional Context
- Use existing email service (#email-service)
- Follow same validation as #signup
```

---

## Implementation Steps

1. **Create the feature directory:**
   ```bash
   mkdir src/features/[feature-name]
   ```

2. **Add a .purpose file (v2 format):**
   ```yaml
   # src/features/[feature-name]/.purpose
   version: "2.0"
   description: What this feature does

   # Components use # prefix with tags for classification
   #[feature-name]:
     description: Detailed description
     tags: [feature, critical]      # Classification via tags
     anchors:                        # Optional code references
       - src/features/[feature-name]/index.ts:1-50
     gates: [^authenticated]         # Gates required
     flows: [$checkout-flow]         # Flows this triggers
     signals: ["!success", "!failed"]  # Events emitted
     components: [#MyComponent]      # UI components used
   ```

3. **Define gates (if authorization needed):**
   - Edit: `portal.yaml`
   - Reference: See `^authenticated` pattern for example

4. **Implement the feature:**
   - Follow Paradigm logger patterns
   - Emit signals at key points
   - Use `log.component('#feature-name').info()` for logging

5. **Update the constellation:**
   ```bash
   paradigm constellation
   ```

6. **Verify:**
   ```bash
   paradigm doctor
   ```

---

## What the AI Will Do

1. Create/update `.purpose` file with `#component` and `[feature]` tag
2. Implement feature following Paradigm patterns
3. Add Paradigm logger calls using `log.component()`
4. Emit appropriate signals with `log.signal()`
5. Create necessary components
6. Update `portal.yaml` if authorization needed
7. Add tests (if applicable)

---

## After Adding the Feature

1. **Update the thread:**
   ```bash
   paradigm thread save "Added #[feature-name] feature"
   ```

2. **Refresh the beacon:**
   ```bash
   paradigm beacon --refresh
   ```

3. **Check ripple effects:**
   ```bash
   paradigm ripple #[feature-name]
   ```

---

## v2 Symbol Reference

| Old Symbol | New Approach |
|------------|--------------|
| `@feature-name` | `#feature-name` with `tags: [feature]` |
| `&integration` | `#integration-name` with `tags: [integration]` |
| `%state` | `#state-name` with `tags: [state]` |
| `?idea` | `#idea-name` with `tags: [idea]` |
