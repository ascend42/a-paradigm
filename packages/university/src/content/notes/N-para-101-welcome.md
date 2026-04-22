---
id: N-para-101-welcome
title: Welcome to Paradigm
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-101
  - meta-framework-for-ai-assisted
  - structured-context-over
  - five-operational-symbols
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-101.json
---

## What Is Paradigm?

Paradigm is a **meta-framework for structured AI-assisted development**. It is not a code framework like React or Express — it does not ship components, generate boilerplate, or impose a runtime. Instead, Paradigm organizes *how AI agents understand your code*. It provides a shared vocabulary of symbols, a directory-level documentation format, and a set of specifications that let any AI assistant — whether Claude, Cursor, or another tool — navigate even large codebases with precision and minimal token waste.

The core insight behind Paradigm is simple: AI agents are powerful, but they struggle when dropped into an undocumented codebase. They spend thousands of tokens exploring directories, guessing at relationships, and re-reading files they have already seen. Paradigm solves this by giving the codebase *structured context* — lightweight metadata files that describe what lives where, how pieces relate, and what rules apply.

## The Three Pillars

Paradigm rests on three pillars:

1. **Symbols** — A set of five prefixed identifiers (`#`, `$`, `^`, `!`, `~`) that classify every meaningful unit in your project. A payment service is `#PaymentService`. An authorization check is `^authenticated`. A business event is `!order-placed`. Symbols are the vocabulary AI agents use to talk about your code.

2. **Purpose Files** — YAML files named `.purpose` that live in directories alongside your source code. They declare which components, flows, gates, signals, and aspects exist in that directory. They are the map AI agents read before they touch any code.

3. **Specifications** — Files in the `.paradigm/` directory that define project-wide configuration, tag taxonomies, agent roles, navigation maps, and team wisdom. They are the rulebook that keeps every agent aligned with your team's conventions.

## Why It Matters

Without structured context, an AI agent working on a checkout feature might:
- Spend 2,000+ tokens reading irrelevant files looking for the payment service
- Miss an authorization gate that protects the endpoint
- Accidentally duplicate a signal that another component already emits
- Use `console.log` instead of the team's structured logger

With Paradigm, that same agent calls `paradigm_navigate` to find `#PaymentService` in ~100 tokens, checks `paradigm_ripple` to see what depends on it, reads the `.purpose` file to understand the directory, and follows the team's logging convention. The result is faster, safer, and more consistent code changes.

## What You Will Learn

In this course you will learn the five symbols and when to use each one, how to write and read `.purpose` files, how to classify symbols with tags, how to use the Paradigm logger, how the `.paradigm/` directory is organized, how `portal.yaml` secures your routes, and how to set up a new project from scratch.
