# Paradigm Discipline Mappings

> Paradigm v1.0 - Language and Discipline Agnostic

Paradigm's symbol system is universal. This document shows how to interpret symbols across different development disciplines.

---

## Core Principle

**Symbols describe WHAT, not HOW.**

- `@` = User/system-facing capability
- `#` = Reusable building block
- `$` = Multi-step process
- `%` = State/configuration
- `^` = Access control
- `!` = Events/side effects
- `?` = Future possibilities
- `~` = Deprecated
- `&` = External dependency

The implementation details change per discipline, but the meaning stays constant.

---

## Web Development

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `@` | Routes, pages, user actions | `@login`, `@checkout`, `@dashboard` |
| `#` | UI components, utilities | `#Button`, `#api-client`, `#modal` |
| `$` | User flows, wizards | `$onboarding`, `$checkout-flow` |
| `%` | Client state, stores | `%user`, `%cart`, `%theme` |
| `^` | Auth middleware, guards | `^authenticated`, `^admin-only` |
| `!` | DOM events, notifications | `!form-submit`, `!notification-sent` |
| `&` | APIs, SDKs, CDNs | `&stripe`, `&firebase`, `&auth0` |

---

## Backend Services

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `@` | API endpoints, RPC methods | `@users.create`, `@orders.process` |
| `#` | Services, repositories, utils | `#database`, `#cache`, `#queue` |
| `$` | Workflows, sagas, pipelines | `$order-fulfillment`, `$data-sync` |
| `%` | Config, feature flags | `%db-connection`, `%rate-limits` |
| `^` | Middleware, rate limits | `^api-key-required`, `^rate-limited` |
| `!` | Events, webhooks, jobs | `!order-created`, `!email-sent` |
| `&` | Databases, queues, caches | `&postgres`, `&redis`, `&rabbitmq` |

---

## Machine Learning / Data Science

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `@` | Models, pipelines, experiments | `@classifier-v2`, `@feature-extraction` |
| `#` | Data loaders, transforms, utils | `#dataloader`, `#normalizer`, `#metrics` |
| `$` | Training runs, ETL pipelines | `$training-pipeline`, `$data-ingestion` |
| `%` | Hyperparameters, configs | `%learning-rate`, `%batch-size` |
| `^` | Data access, model permissions | `^data-scientist`, `^production-only` |
| `!` | Training events, alerts | `!epoch-complete`, `!drift-detected` |
| `&` | ML platforms, data sources | `&wandb`, `&s3`, `&bigquery` |

---

## Mobile Development

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `@` | Screens, user actions | `@home-screen`, `@camera-capture` |
| `#` | UI widgets, native modules | `#card`, `#location-service` |
| `$` | Navigation flows, deep links | `$onboarding`, `$purchase-flow` |
| `%` | App state, preferences | `%user-session`, `%settings` |
| `^` | Permissions, entitlements | `^camera-permission`, `^premium-user` |
| `!` | Push notifications, lifecycle | `!push-received`, `!app-backgrounded` |
| `&` | Native SDKs, services | `&firebase`, `&admob`, `&healthkit` |

---

## Game Development

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `@` | Game mechanics, player actions | `@attack`, `@inventory-open`, `@save-game` |
| `#` | Game objects, systems | `#player`, `#enemy-ai`, `#physics` |
| `$` | Game loops, cutscenes | `$combat-loop`, `$tutorial-sequence` |
| `%` | Game state, player stats | `%player-health`, `%score`, `%level` |
| `^` | Multiplayer auth, cheats | `^multiplayer-session`, `^dev-mode` |
| `!` | Game events, triggers | `!enemy-killed`, `!level-complete` |
| `&` | Game services, engines | `&steamworks`, `&unity`, `&photon` |

---

## Embedded / IoT

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `@` | Device functions, commands | `@read-sensor`, `@actuate-motor` |
| `#` | Drivers, HAL layers | `#spi-driver`, `#gpio-handler` |
| `$` | State machines, protocols | `$boot-sequence`, `$handshake` |
| `%` | Device config, registers | `%device-id`, `%sampling-rate` |
| `^` | Security, firmware signing | `^secure-boot`, `^authenticated-cmd` |
| `!` | Interrupts, events | `!data-ready`, `!watchdog-timeout` |
| `&` | Peripherals, protocols | `&i2c`, `&mqtt`, `&lora` |

---

## Infrastructure / DevOps

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `@` | Operations, runbooks | `@deploy`, `@rollback`, `@scale` |
| `#` | Terraform modules, scripts | `#vpc-module`, `#backup-script` |
| `$` | CI/CD pipelines, workflows | `$release-pipeline`, `$disaster-recovery` |
| `%` | Environment config | `%prod-secrets`, `%feature-flags` |
| `^` | IAM, security policies | `^admin-access`, `^vpc-restricted` |
| `!` | Alerts, incidents | `!high-cpu`, `!deployment-failed` |
| `&` | Cloud services, tools | `&aws`, `&kubernetes`, `&datadog` |

---

## Custom Disciplines

Projects can define their own discipline mapping in `.paradigm/config.yaml`:

```yaml
discipline: custom

# Custom symbol interpretations
symbol-interpretations:
  "@": "Patient treatments"
  "#": "Medical protocols"
  "$": "Care pathways"
  "%": "Patient state"
  "^": "HIPAA compliance"
  "!": "Clinical alerts"
  "&": "EHR systems"
```

---

## Directory Mapping by Discipline

### Generic (works for most)
```yaml
symbol-mapping:
  "src/core/**": "#"
  "src/features/**": "@"
  "src/services/**": "#"
  "src/state/**": "%"
  "src/events/**": "!"
  "src/integrations/**": "&"
```

### ML Project
```yaml
symbol-mapping:
  "models/**": "@"
  "data/**": "#"
  "pipelines/**": "$"
  "config/**": "%"
  "experiments/**": "@"
```

### Game Project
```yaml
symbol-mapping:
  "gameplay/**": "@"
  "systems/**": "#"
  "entities/**": "#"
  "state/**": "%"
  "events/**": "!"
```

---

*Paradigm is the protocol. Your discipline is the implementation.*
