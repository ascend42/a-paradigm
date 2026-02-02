# Refactor Code Prompt

Use this prompt when you need to refactor existing code.

---

## Prompt Template

```
I need to refactor [COMPONENT/FEATURE/AREA].

## Current State
[Describe current implementation]

## Problems
- [Problem 1]
- [Problem 2]
- [Problem 3]

## Goals
- [Goal 1]
- [Goal 2]
- [Goal 3]

## Constraints
- [Constraint 1 - e.g., must maintain backward compatibility]
- [Constraint 2 - e.g., can't change API]

## Symbols Involved
- Components: #[names]
- Features: @[names]
- State: %[names]

## Additional Context
[Any other relevant info]
```

---

## Example

```
I need to refactor #api-client.

## Current State
The API client is a single 500-line file with all endpoints, error handling, and retry logic mixed together.

## Problems
- Hard to test individual endpoints
- Retry logic is duplicated
- No consistent error handling
- Adding new endpoints requires touching many places

## Goals
- Split into logical modules
- Centralized error handling
- Reusable retry logic
- Easy to add new endpoints
- Maintain Horizon logging throughout

## Constraints
- Must maintain same public API (other features depend on it)
- Can't change how @login and @checkout call the client
- Keep bundle size reasonable

## Symbols Involved
- Components: #api-client, #http-wrapper
- Features that use it: @login, @checkout, @profile
- Signals: !api-error, !network-retry

## Additional Context
- Currently using fetch
- Consider axios or ky if it helps
- We have 15 endpoints total
```

---

## Refactoring Checklist

The AI should:

1. **Analyze current implementation**
   - Read all related files
   - Understand dependencies
   - Identify Horizon symbols

2. **Plan the refactor**
   - Propose new structure
   - Show which symbols change/move
   - Identify risk areas

3. **Maintain Horizon patterns**
   - Keep logger calls in place
   - Update .purpose files if structure changes
   - Ensure signals still emit correctly

4. **Execute incrementally**
   - Small, testable changes
   - Verify after each step
   - Run existing tests

5. **Update documentation**
   - Update .purpose files
   - Update comments
   - Update any references
