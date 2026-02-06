# Pathway: Add a New Feature

Use this prompt when you want to add a new user-facing feature to the project.

---

## Prerequisites

Before starting, gather context:

1. **Read the beacon** for project orientation:
   - File: `.paradigm/beacon.md`

2. **Check the constellation** for similar features:
   - File: `.paradigm/constellation.json`
   - Look for patterns in existing `@feature` symbols

3. **Review existing .purpose files** for format reference:
   - Example: Look in `src/features/` directories for `.purpose` files

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
- Signals to emit: ["!success-signal", "!failure-signal"]
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

## Implementation Steps

1. **Create the feature directory:**
   ```bash
   mkdir src/features/[feature-name]
   ```

2. **Add a .purpose file:**
   ```yaml
   # src/features/[feature-name]/.purpose
   description: What this feature does
   
   # Record format (recommended)
   features:
     [feature-name]:
       description: Detailed description
       gates: [^authenticated]      # Portals required
       flows: [$checkout-flow]      # Flows this triggers
       signals: ["!success", "!failed"] # Events emitted
       states: [%user.cart]         # State dependencies
       components: [#MyComponent]   # UI components used
   
   # Array format (also supported)
   features:
     - id: [feature-name]
       description: Detailed description
       gates: [^authenticated]
   ```

3. **Define portals (if authorization needed):**
   - Edit: `portal.yaml`
   - Reference: See `^authenticated` pattern for example

4. **Implement the feature:**
   - Follow Paradigm logger patterns
   - Emit signals at key points

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

1. Create/update `.purpose` file with feature definition
2. Implement feature following Paradigm patterns
3. Add Paradigm logger calls at entry/exit points
4. Emit appropriate signals
5. Create necessary components
6. Update `portal.yaml` if authorization needed
7. Add tests (if applicable)

---

## After Adding the Feature

1. **Update the thread:**
   ```bash
   paradigm thread save "Added @[feature-name] feature"
   ```

2. **Refresh the beacon:**
   ```bash
   paradigm beacon --refresh
   ```

3. **Check ripple effects:**
   ```bash
   paradigm ripple @[feature-name]
   ```
