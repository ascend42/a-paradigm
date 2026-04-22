---
id: N-para-701-agent-roster
title: 'Lesson 1: The Agent Roster'
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-701
  - 54-agents-organized
  - each-agent-has
  - the-orchestrator-selects
symbols: []
difficulty: beginner
estimatedMinutes: 5
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-701.json
---

## 54 Agents, 7 Tiers

Paradigm ships with 54 named agents organized into seven functional tiers. Each agent is a narrow specialist with a defined personality, expertise domain, attention patterns, and collaboration graph. The roster is not a menu of interchangeable generalists — it is a team of specialists who are each the best at one thing.

The seven tiers group agents by function:

**Builders** — Agents that produce code and artifacts. The builder agent writes implementation code. Mika (designer) produces UI/UX designs. Wren (copywriter) writes user-facing text. Ghost (e2e) writes end-to-end tests. The tester writes unit and integration tests. These agents produce output that becomes part of the codebase.

**Reviewers** — Agents that evaluate what builders produce. The reviewer checks code quality and Paradigm compliance. Shield (qa) designs test strategy and validates acceptance criteria. Jinx (advocate) is the devil's advocate who stress-tests assumptions and finds edge cases nobody considered. Bolt (performance) reviews for performance regressions.

**Strategists** — Agents that plan and decide. The architect designs systems and leads orchestration. North (product) owns the product vision and prioritization. Yuki (pm) manages tickets and tracking. Scout (researcher) conducts competitive analysis and market research. Clause (legal) handles compliance and legal review.

**Intelligence** — Agents that gather and analyze information. Sage (analyst) performs data analysis. Beacon (seo) handles search optimization. Lens (content-intel) analyzes content strategy. Oracle (ai) specializes in AI/ML patterns and prompt engineering. Cipher (reverser) reverse-engineers systems and protocols.

**Infrastructure** — Agents that manage the platform and deployment. Atlas (devops) owns CI/CD, deployment, and monitoring. Vault (dba) manages databases, migrations, and query optimization. Root (sysadmin) handles system administration. Wire (network) specializes in networking and protocols. Ship (release) manages release coordination.

**Meta** — Agents that manage other agents. Loid (forge) designs and builds new agents — she understands the full .agent profile schema and recommends team compositions. Sensei (trainer) trains agents by reviewing their performance and curating notebook entries. The documentor maintains .purpose files and portal.yaml after other agents finish their work. Bridge (mediator) resolves disagreements between agents.

**Human Ops** — Agents that support the human directly. Sunday (secretary) is a personal operations agent who tracks goals, schedules, and commitments across all projects. Obi (mentor) provides career guidance. Sheila (educator) creates learning materials for humans. Leila (operations) handles business operations.

## Named Agents Have Personalities

Every agent has a unique nickname and personality configuration. Jinx is confrontational and aggressive — her job is to argue against the current approach. Mika is opinionated and precise — she leads design discussions and will challenge decisions. Sunday is proactive and conservative — she watches the human's commitments across all contexts. Atlas is methodical and conservative — he does not take risks with infrastructure.

These are not cosmetic names. The personality (style, risk tolerance, verbosity) shapes how the agent behaves during orchestration. A `deliberate` architect thinks carefully before responding. A `rapid` builder moves fast. A `confrontational` advocate pushes back on every assumption.

## How the Orchestrator Picks Agents

When `paradigm_orchestrate_inline` runs in plan mode, it evaluates which agents are relevant to the task. The selection process considers:

1. **Task classification** — What kind of work is this? A new feature needs builders, reviewers, and possibly security. A refactor needs the architect and reviewer. An incident needs devops, debugger, and security.

2. **Symbol matching** — Which symbols does the task touch? Each agent has attention patterns (symbols, paths, concepts, signals) that define what they notice. If the task involves `^authenticated` gates, the security agent's symbol pattern `^*` matches. If it touches `src/design/**` files, Mika's path patterns match.

3. **Attention threshold** — Each agent scores events against their attention patterns. Only agents whose relevance score meets their threshold are included. Security has a low threshold (0.45) because missing a security issue is expensive. The builder has a higher threshold (0.75) because it should only be included when directly relevant.

4. **Roster filtering** — If the project has a `roster.yaml`, only agents listed there are considered. A game project does not need SEO or legal agents. A backend API does not need a designer.

The orchestrator then stages agents in dependency order: the architect plans first, builders implement, the reviewer and security check, the documentor updates Paradigm files last.

## Why Narrow Specialists Beat Broad Generalists

A single "coding agent" that tries to build, review, test, and document produces mediocre results across all dimensions. The specialist model works because:

- **Expertise compounds** — The security agent's confidence on `#portal-gates` is 0.95 because that is all it focuses on. A generalist's confidence would be 0.5 across many domains.
- **Attention is focused** — The security agent watches gate symbols, auth paths, and security concepts. It does not waste attention on typography or test fixtures.
- **Collaboration is explicit** — The architect pairs with security to validate auth models. The builder pairs with the tester to verify implementation. These pairs are defined in the agent's collaboration graph, not left to chance.
- **Accountability is clear** — When a security issue ships, the security agent's acceptance rate drops. When a design is inconsistent, Mika's patterns need updating. Each agent owns a specific quality dimension.

The full roster provides coverage across code quality, security, performance, accessibility, design, testing, documentation, and business strategy. Most projects activate 15-25 agents depending on the domain. The orchestrator handles routing — the human never manually assigns agents to tasks.

| Tier | Count | Example Agents |
|---|---|---|
| Builders | ~10 | builder, designer (Mika), copywriter (Wren), tester, e2e (Ghost) |
| Reviewers | ~6 | reviewer, qa (Shield), advocate (Jinx), performance (Bolt) |
| Strategists | ~8 | architect, product (North), pm (Yuki), researcher (Scout) |
| Intelligence | ~7 | analyst (Sage), seo (Beacon), content-intel (Lens), ai (Oracle) |
| Infrastructure | ~8 | devops (Atlas), dba (Vault), sysadmin (Root), release (Ship) |
| Meta | ~6 | forge (Loid), trainer (Sensei), documentor, mediator (Bridge) |
| Human Ops | ~9 | secretary (Sunday), mentor (Obi), educator (Sheila), operations (Leila) |
