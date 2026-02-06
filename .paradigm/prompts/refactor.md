# Refactor Code Prompt (v2)

Use this prompt when you need to refactor existing code.

---

## Prompt Template

```
I need to refactor #[COMPONENT_NAME].

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
- Gates: ^[names if auth related]
- Flows: $[names if flow related]
- Signals: ![names]

## Tags Affected
- [feature], [integration], [state], etc.

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
- Maintain Paradigm logging throughout

## Constraints
- Must maintain same public API (other features depend on it)
- Can't change how #login and #checkout call the client
- Keep bundle size reasonable

## Symbols Involved
- Components: #api-client, #http-wrapper
- Features that use it: #login [feature], #checkout [feature], #profile [feature]
- Signals: !api-error, !network-retry

## Tags Affected
- [integration] - this is an integration component

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
   - Identify Paradigm symbols and tags

2. **Plan the refactor**
   - Propose new structure
   - Show which symbols change/move
   - Identify risk areas
   - Note any tag changes needed

3. **Maintain Paradigm patterns**
   - Keep logger calls in place using `log.component()`
   - Update .purpose files if structure changes
   - Ensure signals still emit correctly
   - Update tags if classification changes

4. **Execute incrementally**
   - Small, testable changes
   - Verify after each step
   - Run existing tests

5. **Update documentation**
   - Update .purpose files with new structure
   - Update tags if component classification changed
   - Update comments
   - Update any references

---

## v2 Symbol Reference

| Old Reference | New Reference |
|---------------|---------------|
| `@feature` | `#component` with `tags: [feature]` |
| `&integration` | `#component` with `tags: [integration]` |
| `%state` | `#component` with `tags: [state]` |

---

## Refactor .purpose File Update

When refactoring changes component structure, update the .purpose file:

```yaml
# Before refactor
#api-client:
  description: Handles all API calls
  tags: [integration]

# After refactor (split into modules)
#api-client:
  description: Main API client facade
  tags: [integration]
  components: [#http-wrapper, #retry-handler, #error-handler]

#http-wrapper:
  description: Low-level HTTP request handling
  tags: [integration]

#retry-handler:
  description: Automatic retry logic with backoff
  signals: ["!network-retry"]

#error-handler:
  description: Centralized error processing
  signals: ["!api-error"]
```
