# University Revamp — Spec

> Philosophy-first learning. 3 comprehensive tests. 1 master exam.

## Problem

Current university is tool-oriented: "this does that." Courses teach mechanics (how to call `paradigm_ripple`) rather than philosophy (why symbols matter, what makes a good flow, how to think about aspects).

Students pass the PLSAT by memorizing tool signatures, not by understanding the system.

## Vision

Three tiers of understanding, each with a comprehensive exam:

### Tier 1: Foundations
**"What is Paradigm and why does it exist?"**

Core philosophies:
- **Symbols as contracts** — `#`, `$`, `^`, `!`, `~` aren't syntax, they're commitments. A `^gate` means "this authorization check exists." A `$flow` means "this sequence is documented and validated."
- **Purpose-driven architecture** — `.purpose` files aren't documentation, they're the source of truth that tools read. No `.purpose` = the code doesn't exist to Paradigm.
- **Declarative over imperative** — you declare what should be true (portal.yaml, personas, aspects), and the system validates reality against declarations.
- **Ripple as responsibility** — changing a symbol means understanding everything it touches. Ripple isn't a tool, it's a discipline.

**Exam 1: Foundations Test**
- Scenario-based questions: "A developer adds a new API endpoint but doesn't update portal.yaml. What breaks? What catches it? Why?"
- Symbol design questions: "Given this feature description, define the symbols, flows, and gates."
- Philosophy questions: "Why does Paradigm require .purpose files instead of just reading source code?"

### Tier 2: Practice
**"How do the pieces connect?"**

Core practices:
- **Flow-first development** — define the flow before writing code. The flow IS the spec.
- **Aspect discipline** — aspects must have code anchors because unanchored rules are wishes, not constraints.
- **Portal as contract** — every gate in portal.yaml is a promise to users about authorization. Breaking a gate breaks trust.
- **Personas as empathy** — imagining real users walking through your product. Personas formalize the act of caring about user experience.
- **Sentinel as memory** — your application forgets what happened. Sentinel doesn't. Events are the proof that your declarations held.

**Exam 2: Practice Test**
- Integration scenarios: "Given this portal.yaml and these personas, identify the coverage gap."
- Debugging scenarios: "A persona journey fails at step 3 with this Sentinel assertion output. What went wrong? What would you fix?"
- Architecture scenarios: "Design the symbol topology for a multi-tenant SaaS with 3 user roles."

### Tier 3: Mastery
**"When do you break the rules?"**

Core wisdom:
- **When NOT to create a flow** — not everything is a flow. Simple CRUD doesn't need `$create-user-flow`.
- **When aspects are overhead** — small projects don't need 200 aspects. When does the graph help vs hurt?
- **When to trust the tools vs override them** — ripple says "low impact" but you know it's not. When do you override?
- **Multi-agent orchestration** — when to split, when to solo, how to handoff without losing context.
- **Paradigm at scale** — 500+ symbols, 50+ personas, 20+ flows. What patterns emerge? What breaks?

**Exam 3: Master Exam (PLSAT v4)**
- Open-ended design: "You're building a marketplace with buyers, sellers, and admins. Design the full Paradigm topology: symbols, flows, gates, personas, aspects. Justify your decisions."
- Debugging from Sentinel data: "Here are 50 Sentinel events from a failed persona chain. Reconstruct what happened and propose fixes."
- Trade-off analysis: "This project has 15 aspects but only 3 are enforced in code. Is this a problem? When? Why?"
- Anti-pattern recognition: "Review this .paradigm/ setup and identify what's wrong."

## Structure

```
University/
  tier-1-foundations/
    lesson-1-symbols-as-contracts.md
    lesson-2-purpose-driven-architecture.md
    lesson-3-declarative-over-imperative.md
    lesson-4-ripple-as-responsibility.md
    exam-1-foundations.json

  tier-2-practice/
    lesson-1-flow-first-development.md
    lesson-2-aspect-discipline.md
    lesson-3-portal-as-contract.md
    lesson-4-personas-as-empathy.md
    lesson-5-sentinel-as-memory.md
    exam-2-practice.json

  tier-3-mastery/
    lesson-1-when-not-to.md
    lesson-2-paradigm-at-scale.md
    lesson-3-multi-agent-orchestration.md
    lesson-4-wisdom-and-lore.md
    exam-3-master.json
```

## Migration

- Existing PARA-101 through PARA-501 content folds into Tier 1 and Tier 2
- PLSAT v3.0 becomes Exam 2 (Practice Test) with scenario upgrades
- New Exam 3 (Master) replaces PLSAT as the final certification
- Existing quiz questions are converted from "what does X do" to "why does X matter"

## Version

This would be a `@a-company/university` major version bump (3.7.0 → 4.0.0).
