---
id: N-para-101-tags-and-classification
title: Tags & Classification
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-101
  - tags-classify-components
  - tags-are-defined
  - three-sections-core
symbols: []
difficulty: beginner
estimatedMinutes: 3
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-101.json
---

## Beyond Symbols: The Tag Bank

Paradigm's five symbols classify code by *role* — component, flow, gate, signal, aspect. But within each role, you often need finer distinctions. Is this component a user-facing feature or a third-party integration? Is it critical infrastructure or an experimental idea? Paradigm handles this with a unified **tag system**.

Tags are plain strings in brackets that you attach to any symbol. They live in the `tags` array on a symbol definition:

```yaml
components:
  #checkout:
    description: Shopping cart checkout experience
    tags: [feature, critical, payments]

  #stripe-service:
    description: Stripe API client wrapper
    tags: [integration, stripe, payments]

  #cart-store:
    description: In-memory shopping cart state
    tags: [state, ephemeral]
```

## The Tag Bank File

Tags are not arbitrary strings — they are defined in `.paradigm/tags.yaml`, which serves as the project's tag bank. The tag bank has three sections:

```yaml
core:          # Universal tags, defined by Paradigm itself
  feature:     { description: "User-facing functionality" }
  integration: { description: "Third-party service connection" }
  state:       { description: "Data store or state container" }
  critical:    { description: "Failure causes major user impact" }
  deprecated:  { description: "Scheduled for removal" }
  idea:        { description: "Experimental, not yet approved" }

project:       # Team-defined tags specific to this project
  payments:    { description: "Related to payment processing" }
  onboarding:  { description: "Part of the new-user experience" }

suggested:     # AI-proposed tags awaiting human approval
  webhook-handler: { description: "Processes incoming webhooks" }
```

The **core** section contains tags that apply to any project. The **project** section contains tags your team has defined for this specific codebase. The **suggested** section is where AI agents can propose new tags using the `paradigm_tags_suggest` tool — a human reviews and promotes them to the project section.

## How Tags Work in Practice

Here is how tags differentiate components that serve different roles:

| Role | How to Tag |
|-----------|---------------|
| User-facing feature | `#checkout` with `tags: [feature]` |
| Third-party service | `#stripe-service` with `tags: [integration, stripe]` |
| Data store | `#cart-store` with `tags: [state]` |
| Experimental prototype | `#new-widget` with `tags: [idea]` |
| Scheduled for removal | `#legacy-handler` with `tags: [deprecated]` |

This means fewer concepts to remember and no ambiguity. A Stripe payment service is `#stripe-service` with `tags: [integration, stripe]` — clear, searchable, and consistent.

## Using Tags Effectively

Tags are most powerful when they are **consistent and searchable**. Follow these guidelines:

- **Use existing tags before inventing new ones.** Check `paradigm_tags({ action: "list" })` to see what is available.
- **Keep tags lowercase and kebab-case.** `webhook-handler`, not `WebhookHandler` or `WEBHOOK_HANDLER`.
- **Use 2-4 tags per symbol.** One tag is too vague; ten tags is noise.
- **Tag for discoverability.** Ask: "What would I search for to find this component?" Those search terms are your tags.
- **Let AI propose tags.** If you notice a pattern (e.g., five components all handle webhooks), use `paradigm_tags_suggest` to propose a `webhook-handler` tag.

## Querying by Tags

The Paradigm MCP tools support tag-based discovery. When you call `paradigm_search` with a tag name, it returns all symbols bearing that tag. This makes it easy to ask questions like "show me everything tagged `critical`" or "find all `integration` components."
