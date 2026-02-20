# Paradigm University - Planned Changes

> Compiled during review session 2026-02-10. Do not implement until approved.

## V1 Content Removal

Remove all v1 references — the university teaches v2 only.

1. **para-101.json ~L76** — "The Five Symbols" lesson: full paragraph explaining v1 had `@`, `&`, `%` as separate symbols
2. **para-101.json ~L112** — Quiz question: "In Paradigm v1, features used `@`, integrations used `&`..."
3. **para-101.json ~L220** — "Tags & Classification" lesson: entire "Migration from v1 Symbols" subsection with mapping table
4. **para-101.json ~L38** — "Welcome to Paradigm" quiz: question referencing `%user-store` as v1 state
5. **para-201.json ~L286** — "Disciplines" lesson: "A key lesson from Paradigm v1 migration: hooks are components, not signals"
6. **reference.json ~L230-240** — Tag descriptions: four tags say "Replaces the v1 `X` symbol prefix"
7. **plsat/v2.0.json Q plsat-002** — Asks "In Paradigm v1, how would this have been represented?" (answer: `%user-store`)
8. **plsat/v2.0.json Q plsat-003** — Shows `log.feature(...)` and asks what's wrong (answer: v1 API)
9. **plsat/v2.0.json Q plsat-007** — References `?` prefix from v1, asks how to represent ideas in v2

## Logger Rethink

The logger should be presented as a philosophy/approach, not a concrete API with exact method signatures.

10. **para-101.json ~L286** — "The Paradigm Logger" lesson content teaches exact chaining syntax as API
11. **para-101.json ~L289** — Key concept: "Five logger methods: component, gate, signal, flow, aspect"
12. **para-101.json ~L292** — Key concept: "Never use raw console.log — always use the Paradigm logger"
13. **para-101.json ~L297** — Quiz tests exact `log.component('#payment-service').info(...)` syntax
14. **para-101.json ~L310** — Quiz: "middleware/ should use which logger method?" — tests directory-to-method mapping as fact
15. **para-101.json ~L336** — Quiz frames logger as a direct replacement for console.log
16. **reference.json ~L13-50** — Every symbol entry has exact `"logger": "log.component('#name').level('message')"` template
17. **para-201.json ~L291** — "Disciplines affect... logger suggestions" — frames tool as dictating exact methods
18. **para-201.json ~L332** — Explanation ties discipline to "which log method to use in each directory"
19. **plsat/v2.0.json Q plsat-003** — Tests exact method name (`log.feature()` wrong, `log.component()` right)
20. **plsat/v2.0.json Q plsat-005** — Tests directory-to-logger method mapping as strict rule

## Routing & Navigation

21. **URL routing** — Lesson/subsection navigation doesn't update the URL; route is only `/course/:courseId` with no `:lessonId` segment
22. **Progress resets on back** — Browser back button navigates away from the course entirely; returning loses lesson position
24. **Quiz completion** — Finishing a quiz should advance to the next lesson, not dead-end

## Command References

23. **`paradigm init` → `paradigm shift`** — 10 occurrences across 5 files:
    - para-101.json ~L497 (Step 1 lesson content)
    - para-101.json ~L499 (key concept)
    - para-101.json ~L424 (explanation)
    - para-101.json ~L523 (quiz answer)
    - para-301.json ~L369 (quiz option)
    - para-401.json ~L536 (lesson content)
    - para-401.json ~L563 (quiz answer)
    - para-401.json ~L569 (explanation)
    - plsat/v2.0.json ~L57 (exam scenario)
    - reference.json ~L164 (command reference)

## Quiz Content

25. **para-101.json Q3 ~L112** — Replace v1-framed question ("In Paradigm v1, features used `@`...") with a pure v2 question about tag classification

## Gates/Portal Conceptual Reframe

Gates are currently taught as tightly coupled to web authentication (JWT, role-based access, protected HTTP routes, "static sites don't need it"). The concept should be broadened: gates are general-purpose **gatekeepers** that check the state of defined conditions. Auth is one use case, not the definition.

Examples of non-auth gates: feature flags, environment checks, license validation, rate limits, data prerequisites, system health, build/deploy gates, subscription status.

This is a pervasive framing issue across the entire university — not a few isolated fixes:

28. **reference.json ~L29** — Gate symbol described as "authorization checkpoint that controls access to resources"
29. **reference.json ~L32** — Gate "when" field: "When access must be restricted — authentication, role checks, ownership validation"
30. **para-101.json ~L79** — Key concept: "^ Gate — authorization checkpoint"
31. **para-101.json ~L95** — Explanation frames gates purely as auth: "verifying that a user has the right to access a resource"
32. **para-101.json ~L430-477** — Entire "Portal.yaml" lesson: framed as auth-only ("Gate types: auth, role, ownership", "Required whenever the app has protected endpoints", quiz Q "When is portal.yaml NOT needed?" answer: "fully public static site")
33. **para-101.json ~L442-451** — Authorization workflow: "call paradigm_gates_for_route → add to portal.yaml → implement checks → test 403 responses" — assumes web/HTTP context
34. **para-201.json ~L75-81** — Gates lesson key concepts: "Four gate types: auth, role, ownership, state-precondition" — state-precondition is the closest to the broader vision but it's listed as one of four auth-adjacent types
35. **para-201.json ~L220-279** — "Portal Protocol" lesson: entirely about security-before-implementation, 401/403 status codes, auth middleware
36. **plsat/v2.0.json Q plsat-004** — Portal.yaml scenario assumes JWT authentication context
37. **plsat/v2.0.json Q plsat-009** — Tests portal.yaml route entry syntax (auth-centric)
38. **plsat/v2.0.json Q plsat-013** — Gate composition question (auth gates only)
39. **plsat/v2.0.json multiple Qs** — Many questions assume gates = HTTP route protection

42. **para-201.json "The Prizes Field" section** — rename `prizes` → `effects` (decided)
44. **Gate failure behavior is taught as HTTP-only** — Questions like "Which HTTP status code should a failed auth gate return?" (para-201 Q3) assume web context. Gate failure responses should be discipline-aware: HTTP returns 401/403, mobile navigates to login or disables UI, CLI exits with error code, build pipeline blocks deploy, etc. The university should teach that the *concept* of pass/fail is universal but the *implementation* varies by platform.

**Note:** This is potentially a broader framework-level conceptual shift, not just a university content fix. The university should reflect whatever the framework decides gates are. See `/GATES-REFRAME.md` for broader framework implications.

## UI/Layout

40. **Header nav not centered** — "Campus / Courses / PLSAT / Library / Certificates" group is visually off-center
41. **Courses link behavior** — Clicking "Courses" in header goes to first course instead of course picker/listing view
43. **Code blocks excessive line spacing** — Dark code/file preview blocks (e.g. portal.yaml in "Prizes Field") have too much vertical space between lines; likely CSS on `<pre>`/`<code>` elements
45. **para-201.json Aspects Q1** — "All API handlers must validate input against Zod schemas" — too implementation-specific, assumes knowledge of Zod. Rewrite to be generalized/philosophical (e.g. "a rule that all handlers must validate input" without naming a specific library). Apply this principle broadly: quiz questions should test Paradigm concepts, not specific tech stacks.
46. **para-201.json Case Study Q1** — Team invitation token question is correct but overly HTTP/web-specific; consider generalizing or replacing

## Quiz & Exam Structure

47. ~~**Add passage-based question groups**~~ — **DONE (v3.0)** — Added 2 passage groups to PLSAT v3.0: Portal Review (3 questions analyzing a portal.yaml) and Purpose File Review (3 questions analyzing a .purpose file). Server flattens passages for the client; UI renders passage blocks above grouped questions in exam and review modes.

49. **Remove all "v1" and "v2" version labels from PLSAT** — There is no v1 vs v2 distinction for learners, it's just Paradigm. Scenarios saying "Paradigm v2" (e.g. plsat-001 L12: "a team that uses Paradigm v2") should just say "Paradigm." Explanations referencing "In Paradigm v2..." (L22, L52, L112) should just state the fact without versioning. This is in addition to the v1-specific questions already tracked in items 7-9.

48. ~~**PLSAT question variants**~~ — **DONE (v3.0)** — Added variant system to PLSAT v3.0. Server randomly selects one variant per slot per attempt. 5 questions have 2 variants each (plsat-001, 003, 006, 011, 014). v3.0 schema supports adding more variants incrementally.
