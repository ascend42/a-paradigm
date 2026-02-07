# Paradigm Discipline Mappings

> Paradigm v2.0 - Language and Discipline Agnostic

Paradigm's symbol system is universal. This document shows how to interpret symbols across different development disciplines.

---

## Core Principle

**Symbols describe WHAT, not HOW.**

- `#` = Any documented code unit (component, feature, service, integration)
- `$` = Multi-step process
- `^` = Access control / authorization checkpoint
- `!` = Events / side effects
- `~` = Cross-cutting rule with code anchor

Classification is handled by **tags**: `[feature]`, `[integration]`, `[state]`, `[idea]`, `[deprecated]`.

The implementation details change per discipline, but the meaning stays constant.

---

## Web Development

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `#` | Routes, pages, user actions, UI components, utilities | `#login-handler` `[feature]`, `#checkout` `[feature]`, `#Button`, `#api-client` |
| `$` | User flows, wizards | `$onboarding`, `$checkout-flow` |
| `^` | Auth middleware, guards | `^authenticated`, `^admin-only` |
| `!` | DOM events, notifications | `!form-submit`, `!notification-sent` |
| `~` | Cross-cutting rules | `~rate-limited`, `~cached` |

---

## Backend Services

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `#` | API endpoints, services, repositories, utils | `#users-create` `[feature]`, `#database`, `#cache`, `#postgres-client` `[integration]` |
| `$` | Workflows, sagas, pipelines | `$order-fulfillment`, `$data-sync` |
| `^` | Middleware, rate limits | `^api-key-required`, `^rate-limited` |
| `!` | Events, webhooks, jobs | `!order-created`, `!email-sent` |
| `~` | Cross-cutting rules | `~audit-required`, `~validated` |

---

## Machine Learning / Data Science

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `#` | Models, data loaders, transforms, utils | `#classifier-v2` `[feature]`, `#dataloader`, `#normalizer`, `#wandb-client` `[integration]` |
| `$` | Training runs, ETL pipelines | `$training-pipeline`, `$data-ingestion` |
| `^` | Data access, model permissions | `^data-scientist`, `^production-only` |
| `!` | Training events, alerts | `!epoch-complete`, `!drift-detected` |
| `~` | Cross-cutting rules | `~reproducible`, `~versioned` |

---

## Mobile Development

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `#` | Screens, user actions, UI widgets, native modules | `#home-screen` `[feature]`, `#camera-capture` `[feature]`, `#card`, `#firebase-client` `[integration]` |
| `$` | Navigation flows, deep links | `$onboarding`, `$purchase-flow` |
| `^` | Permissions, entitlements | `^camera-permission`, `^premium-user` |
| `!` | Push notifications, lifecycle | `!push-received`, `!app-backgrounded` |
| `~` | Cross-cutting rules | `~encrypted`, `~cached` |

---

## Game Development

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `#` | Game mechanics, player actions, game objects, systems | `#attack` `[feature]`, `#inventory` `[feature]`, `#player`, `#enemy-ai`, `#steamworks-client` `[integration]` |
| `$` | Game loops, cutscenes | `$combat-loop`, `$tutorial-sequence` |
| `^` | Multiplayer auth, cheats | `^multiplayer-session`, `^dev-mode` |
| `!` | Game events, triggers | `!enemy-killed`, `!level-complete` |
| `~` | Cross-cutting rules | `~save-validated`, `~anti-cheat` |

---

## Embedded / IoT

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `#` | Device functions, commands, drivers, HAL layers | `#read-sensor` `[feature]`, `#spi-driver`, `#gpio-handler`, `#mqtt-client` `[integration]` |
| `$` | State machines, protocols | `$boot-sequence`, `$handshake` |
| `^` | Security, firmware signing | `^secure-boot`, `^authenticated-cmd` |
| `!` | Interrupts, events | `!data-ready`, `!watchdog-timeout` |
| `~` | Cross-cutting rules | `~validated`, `~encrypted` |

---

## Infrastructure / DevOps

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `#` | Operations, runbooks, terraform modules, scripts | `#deploy` `[feature]`, `#vpc-module`, `#backup-script`, `#aws-client` `[integration]` |
| `$` | CI/CD pipelines, workflows | `$release-pipeline`, `$disaster-recovery` |
| `^` | IAM, security policies | `^admin-access`, `^vpc-restricted` |
| `!` | Alerts, incidents | `!high-cpu`, `!deployment-failed` |
| `~` | Cross-cutting rules | `~immutable-infra`, `~audit-required` |

---

## Custom Disciplines

Projects can define their own discipline mapping in `.paradigm/config.yaml`:

```yaml
discipline: custom

# Custom symbol interpretations
symbol-interpretations:
  "#": "Medical protocols, patient treatments, EHR integrations"
  "$": "Care pathways"
  "^": "HIPAA compliance"
  "!": "Clinical alerts"
  "~": "Regulatory enforcement rules"
```

---

## Directory Mapping by Discipline

### Generic (works for most)
```yaml
symbol-mapping:
  "src/core/**": "#"
  "src/features/**": "#"
  "src/services/**": "#"
  "src/state/**": "#"
  "src/events/**": "!"
  "src/integrations/**": "#"
  "src/middleware/**": "^"
  "src/aspects/**": "~"
```

### ML Project
```yaml
symbol-mapping:
  "models/**": "#"
  "data/**": "#"
  "pipelines/**": "$"
  "config/**": "#"
  "experiments/**": "#"
```

### Game Project
```yaml
symbol-mapping:
  "gameplay/**": "#"
  "systems/**": "#"
  "entities/**": "#"
  "events/**": "!"
```

---

*Paradigm is the protocol. Your discipline is the implementation.*
