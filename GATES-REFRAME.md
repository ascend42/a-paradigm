# Gates Conceptual Reframe — Framework Level

> Gates should be general-purpose **gatekeepers** that check the state of defined conditions.
> Auth is one use case, not the definition.

## The Shift

**Current framing:** Gates = authorization checkpoints for protected HTTP routes
**Proposed framing:** Gates = condition checkers that verify defined state before proceeding

### Non-auth gate examples
- Feature flags (`^feature-enabled`)
- Environment checks (`^production-ready`, `^database-migrated`)
- License/subscription validation (`^license-valid`)
- Rate limits (`^under-rate-limit`)
- Data prerequisites (`^cart-not-empty`, `^profile-complete`)
- System health (`^service-healthy`, `^queue-available`)
- Build/deploy gates (`^tests-passing`, `^code-reviewed`)
- Configuration checks (`^api-key-configured`)

---

## Framework Files Requiring Changes

### Core Documentation

1. **CLAUDE.md ~L18** — "portal.yaml → Security/auth definitions" → should describe gates broadly
2. **CLAUDE.md ~L26** — "Check if portal.yaml exists (for auth gates)"
3. **CLAUDE.md ~L43** — Gate defined as "Authorization checkpoint"
4. **CLAUDE.md ~L92-142** — Entire "Portal Protocol (Authorization)" section — framed as auth-only
5. **CLAUDE.md ~L128-132** — Workflow assumes HTTP routes and 403 responses
6. **CLAUDE.md ~L149** — "Check portal.yaml for existing auth gates"
7. **CLAUDE.md ~L277** — "paradigm_gates_for_route for auth gates"
8. **CLAUDE.md ~L463-479** — Maintenance table ties gates exclusively to protected routes, ownership, roles
9. **CLAUDE.md ~L473-479** — "CRITICAL: Authorization requires portal.yaml" — overly narrow

### Specs

10. **.paradigm/config.yaml ~L59-62** — Gate description: "Authorization/validation checkpoints" (half right)
11. **.paradigm/config.yaml ~L127-130** — Gate directory mapping only lists auth-adjacent dirs (middleware, auth, guards, policies)
12. **.paradigm/specs/symbols-v2.md ~L43** — Gate: "Authorization/validation checkpoint"
13. **.paradigm/specs/symbols-v2.md ~L115-144** — Gate section + patterns table (Identity/Role/Ownership/State/External)
14. **.paradigm/specs/symbols.md ~L29, L129-158** — Same auth-centric gate definition and patterns
15. **.paradigm/specs/portal-validation.md ~L1-221** — Entire spec assumes auth flows (login redirects, 403s, subscription gating)
16. **.paradigm/specs/disciplines.md ~L16, L49** — Gate = "Access control checkpoint", "Auth middleware, guards"

### Prompts

17. **.paradigm/prompts/add-gate.md** — "when you need to add authorization/access control" — should say "when you need to add a condition check"
18. **.paradigm/prompts/debug-auth.md** — Entire prompt assumes gates = auth debugging
19. **.paradigm/prompts/validate-portals.md** — Entirely about testing authorization flows

### Docs

20. **.paradigm/docs/patterns.md ~L52-91** — Gate pattern section: "Gates are authorization checkpoints"
21. **.paradigm/docs/ai-maintenance-protocol.md ~L52-65** — Gate updates triggered by auth middleware detection (authenticate, requireAdmin, checkOwnership)

### MCP Tools

22. **packages/paradigm-mcp/src/tools/index.ts ~L170-187** — `paradigm_gates_for_route` tool is HTTP-route-specific by design
23. **packages/paradigm-mcp tool descriptions** — Gate tools assume portal.yaml = route protection

### Portal Packages

24. **packages/portal-core/README.md** — "authorization topology format for defining access control rules"
25. **packages/portal-sdk/README.md** — "enforce authorization rules defined in portal.yaml"

### IDE Adapters / Generated Files

26. **.github/copilot-instructions.md ~L25-26** — "When adding authorization, update portal.yaml"
27. **packages/paradigm/src/ IDE adapters** — Generated CLAUDE.md, .cursor rules, copilot instructions all inherit auth framing

### README

28. **README.md ~L14** — "authorization" listed as core Paradigm value prop
29. **README.md ~L31** — Portal: "Define who can access what, under what conditions"

### Example Files

30. **packages/sentinel/portal.yaml** — Example portal.yaml with auth gates (API key, admin role)

---

## Portal.yaml Schema Implications

The current portal.yaml structure is HTTP-route-centric:

```yaml
routes:
  "GET /api/resource": [^authenticated]
  "DELETE /api/resource/:id": [^authenticated, ^resource-owner]
```

A broader framing might need:
- Non-route gates (check conditions outside of HTTP context)
- Gate triggers beyond "route hit" (before deploy, before data mutation, on schedule)
- The `check:` field currently assumes `req.user` patterns — needs to support arbitrary expressions

## Rename `prizes` Field

The `prizes` field on gates triggers side effects when a gate passes. "Prizes" implies gamification/rewards — doesn't fit a general-purpose gatekeeper. Needs a more generic name.

**Decision: rename `prizes` → `effects`** — neutral, describes what happens ("side effects on pass"), no gamification or auth baggage.

This is a **schema-level change** — affects portal.yaml format, portal-core parser, portal-sdk, MCP tools (`paradigm_portal_add_gate` has a `prizes` param), and all documentation/examples.

**Current usage in codebase:** v2 requires `prizes: []` on each gate in portal.yaml.

## Discipline-Aware Gate Failure Behavior

Gate pass/fail is universal, but what happens on failure is discipline-specific. Currently hardcoded to HTTP:

| Discipline | Gate Failure Behavior |
|-----------|----------------------|
| Web/API | Return 401/403 status codes |
| Mobile | Navigate to login, show dialog, disable UI element |
| CLI | Exit with error code, print message |
| Build/CI | Block pipeline, fail the step |
| Desktop | Show permission dialog, gray out action |
| Game | Lock content, show upgrade prompt |
| Embedded | Reject command, enter safe mode |

The disciplines spec (`.paradigm/specs/disciplines.md`) should define gate failure patterns per platform. University content should teach the concept as platform-agnostic with discipline-specific examples.

## MCP Tool Implications

- `paradigm_gates_for_route` is fundamentally HTTP-centric — may need a more general `paradigm_gates_for_action` or similar
- Gate suggestion logic is based on route patterns (`/api/:resource/:id`)

---

## Decision Needed

This reframe has two possible scopes:

**A. Broadened messaging only** — Keep the underlying portal.yaml structure route-based, but teach gates as a broader concept and show non-auth examples alongside auth ones.

**B. Full structural reframe** — Redesign portal.yaml to support non-route gates, rename/extend MCP tools, update the SDK. Significantly more work.

The university content should be updated to match whichever direction is chosen.
