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

## UI/Layout

26. **Header nav not centered** — "Campus / Courses / PLSAT / Library / Certificates" group is visually off-center
27. **Courses link behavior** — Clicking "Courses" in header goes to first course instead of course picker/listing view
