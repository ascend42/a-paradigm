# Paradigm Discipline Mappings (v2)

> Paradigm v2.0 - Language and Discipline Agnostic

Paradigm's symbol system v2 is universal. This document shows how to interpret symbols and apply tags across different development disciplines.

---

## Core Principle

**Symbols describe STRUCTURE, tags describe CLASSIFICATION.**

### Symbols (Structural - same across all disciplines)
- `#` = Code unit (any documented component)
- `$` = Multi-step process
- `^` = Access control checkpoint
- `!` = Events/side effects
- `~` = Cross-cutting rule with enforcement

### Tags (Classification - vary by discipline)
- `[feature]` = User/system-facing capability
- `[integration]` = External dependency
- `[state]` = State management
- `[critical]` = High business impact
- `[security]` = Security-sensitive

The implementation details change per discipline, but the symbols stay constant.

---

## Web Development

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Routes/pages | `#` | `[feature]` | `#login-page`, `#checkout` |
| API endpoints | `#` | `[feature]` | `#api-users`, `#api-orders` |
| UI components | `#` | | `#Button`, `#Modal`, `#card` |
| Utilities | `#` | | `#api-client`, `#date-formatter` |
| External APIs | `#` | `[integration]` | `#stripe-client`, `#auth0-service` |
| State stores | `#` | `[state]` | `#user-store`, `#cart-store` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | User flows, wizards | `$onboarding`, `$checkout-flow` |
| `^` | Auth middleware, guards | `^authenticated`, `^admin-only` |
| `!` | DOM events, notifications | `!form-submit`, `!notification-sent` |
| `~` | Cross-cutting rules | `~rate-limited`, `~csrf-protected` |

---

## Fullstack Development

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Pages/routes | `#` | `[feature]` | `#LoginPage`, `#dashboard` |
| API routes | `#` | `[feature]` | `#api-users`, `#api-orders` |
| UI components | `#` | | `#Button`, `#DataTable` |
| Services | `#` | | `#UserService`, `#email-service` |
| External APIs | `#` | `[integration]` | `#stripe-client`, `#sendgrid-client` |
| State stores | `#` | `[state]` | `#auth-store`, `#cart-store` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | End-to-end flows | `$checkout-flow`, `$auth-flow` |
| `^` | Auth middleware, guards | `^authenticated`, `^admin-only` |
| `!` | Events, webhooks | `!order-created`, `!notification-sent` |
| `~` | Cross-cutting rules | `~rate-limited`, `~audit-required` |

---

## API Development

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Endpoints | `#` | `[feature]` | `#users-endpoint`, `#orders-list` |
| Services | `#` | | `#OrderService`, `#database` |
| External services | `#` | `[integration]` | `#redis-client`, `#stripe-api` |
| Configuration | `#` | `[state]` | `#db-config`, `#rate-limits` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | Request flows, pipelines | `$order-processing`, `$webhook-ingestion` |
| `^` | Auth, rate limits | `^api-key-required`, `^rate-limited` |
| `!` | Events, webhooks | `!request-received`, `!order-created` |
| `~` | Cross-cutting rules | `~audit-logged`, `~validated`, `~idempotent` |

---

## Backend Services

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| API endpoints | `#` | `[feature]` | `#users-create`, `#orders-process` |
| Services | `#` | | `#database`, `#cache`, `#queue` |
| External services | `#` | `[integration]` | `#postgres-client`, `#redis-client` |
| Configuration | `#` | `[state]` | `#db-config`, `#rate-limits` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | Workflows, pipelines | `$order-fulfillment`, `$data-sync` |
| `^` | Middleware, rate limits | `^api-key-required`, `^rate-limited` |
| `!` | Events, webhooks, jobs | `!order-created`, `!email-sent` |
| `~` | Cross-cutting rules | `~audit-logged`, `~encrypted` |

---

## CLI Applications

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Commands | `#` | `[feature]` | `#init-command`, `#build-command` |
| Utilities | `#` | | `#config-loader`, `#output-formatter` |
| External tools | `#` | `[integration]` | `#git-client`, `#npm-client` |
| Configuration | `#` | `[state]` | `#user-config`, `#cli-state` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | Setup flows, migrations | `$setup-flow`, `$migration-flow` |
| `^` | Config validation, version checks | `^config-valid`, `^version-check` |
| `!` | Command events, errors | `!command-complete`, `!error-occurred` |
| `~` | Cross-cutting rules | `~logged`, `~validated` |

---

## Machine Learning / Data Science

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Models | `#` | `[feature]` | `#classifier-v2`, `#feature-extractor` |
| Data loaders | `#` | | `#dataloader`, `#normalizer` |
| Experiments | `#` | `[feature]` | `#experiment-a`, `#baseline` |
| ML platforms | `#` | `[integration]` | `#wandb-client`, `#s3-client` |
| Hyperparameters | `#` | `[state]` | `#model-config`, `#training-params` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | Training runs, ETL pipelines | `$training-pipeline`, `$data-ingestion` |
| `^` | Data access, model permissions | `^data-scientist`, `^production-only` |
| `!` | Training events, alerts | `!epoch-complete`, `!drift-detected` |
| `~` | Cross-cutting rules | `~reproducible`, `~versioned` |

---

## Data Engineering

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Models/transforms | `#` | `[feature]` | `#users-model`, `#transform-revenue` |
| Data sources | `#` | | `#data-source`, `#raw-events` |
| Platforms | `#` | `[integration]` | `#snowflake-client`, `#bigquery-client` |
| Config | `#` | `[state]` | `#connection-config`, `#schema-registry` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | ETL pipelines, DAGs | `$etl-pipeline`, `$daily-refresh` |
| `^` | Data access policies | `^analyst-only`, `^pii-access` |
| `!` | Pipeline events | `!pipeline-complete`, `!data-quality-fail` |
| `~` | Cross-cutting rules | `~idempotent`, `~schema-validated` |

---

## Mobile Development

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Screens | `#` | `[feature]` | `#home-screen`, `#camera-capture` |
| UI widgets | `#` | | `#card`, `#bottom-sheet` |
| Native modules | `#` | `[integration]` | `#location-service`, `#push-service` |
| App state | `#` | `[state]` | `#user-session`, `#settings` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | Navigation flows, deep links | `$onboarding`, `$purchase-flow` |
| `^` | Permissions, entitlements | `^camera-permission`, `^premium-user` |
| `!` | Push notifications, lifecycle | `!push-received`, `!app-backgrounded` |
| `~` | Cross-cutting rules | `~offline-capable`, `~encrypted-storage` |

---

## Game Development

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Game mechanics | `#` | `[feature]` | `#attack`, `#inventory`, `#save-game` |
| Game objects | `#` | | `#player`, `#enemy-ai`, `#physics` |
| Game services | `#` | `[integration]` | `#steamworks-client`, `#photon-client` |
| Game state | `#` | `[state]` | `#player-stats`, `#world-state` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | Game loops, cutscenes | `$combat-loop`, `$tutorial-sequence` |
| `^` | Multiplayer auth, cheats | `^multiplayer-session`, `^dev-mode` |
| `!` | Game events, triggers | `!enemy-killed`, `!level-complete` |
| `~` | Cross-cutting rules | `~deterministic`, `~network-synced` |

---

## Embedded / IoT

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Device functions | `#` | `[feature]` | `#read-sensor`, `#actuate-motor` |
| Drivers | `#` | | `#spi-driver`, `#gpio-handler` |
| Protocols | `#` | `[integration]` | `#mqtt-client`, `#lora-client` |
| Device config | `#` | `[state]` | `#device-id`, `#sampling-config` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | State machines, protocols | `$boot-sequence`, `$handshake` |
| `^` | Security, firmware signing | `^secure-boot`, `^authenticated-cmd` |
| `!` | Interrupts, events | `!data-ready`, `!watchdog-timeout` |
| `~` | Cross-cutting rules | `~power-optimized`, `~real-time` |

---

## Infrastructure / DevOps

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Operations | `#` | `[feature]` | `#deploy`, `#rollback`, `#scale` |
| Modules | `#` | | `#vpc-module`, `#backup-script` |
| Cloud services | `#` | `[integration]` | `#aws-client`, `#k8s-client` |
| Environment config | `#` | `[state]` | `#prod-secrets`, `#feature-flags` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | CI/CD pipelines | `$release-pipeline`, `$disaster-recovery` |
| `^` | IAM, security policies | `^admin-access`, `^vpc-restricted` |
| `!` | Alerts, incidents | `!high-cpu`, `!deployment-failed` |
| `~` | Cross-cutting rules | `~immutable-infra`, `~zero-downtime` |

---

## Library Development

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Public API | `#` | `[feature]` | `#parser`, `#formatter`, `#validator` |
| Internals | `#` | | `#tokenizer`, `#cache`, `#helpers` |
| External deps | `#` | `[integration]` | `#fs-client`, `#http-client` |
| Configuration | `#` | `[state]` | `#options`, `#defaults` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | Build/publish flows | `$build-pipeline`, `$publish-flow` |
| `^` | Config validation | `^version-check`, `^config-valid` |
| `!` | Error events | `!parse-error`, `!validation-failed` |
| `~` | Cross-cutting rules | `~tree-shakeable`, `~backwards-compatible` |

---

## Monorepo

### Components (`#`) with Tags

| Use Case | Symbol | Tags | Examples |
|----------|--------|------|----------|
| Packages | `#` | `[feature]` | `#web-app`, `#api-server` |
| Shared libraries | `#` | | `#shared-ui`, `#config-loader` |
| External deps | `#` | `[integration]` | `#ci-provider`, `#registry-client` |
| Workspace config | `#` | `[state]` | `#workspace-config`, `#shared-types` |

### Other Symbols

| Symbol | Interpretation | Examples |
|--------|---------------|----------|
| `$` | Deploy/release flows | `$deploy-all`, `$release-pipeline` |
| `^` | Auth, access control | `^authenticated`, `^admin-only` |
| `!` | Build/publish events | `!build-complete`, `!package-published` |
| `~` | Cross-cutting rules | `~consistent-versions`, `~shared-config` |

---

## Custom Disciplines

Projects can define their own discipline mapping in `.paradigm/config.yaml` and add domain-specific tags to `.paradigm/tags.yaml`:

### config.yaml
```yaml
discipline: custom

# Symbol interpretations are always the same (v2)
# Customize tags for your domain in tags.yaml
```

### tags.yaml
```yaml
# Project-specific tags
project:
  patient:
    description: "Patient-related components"
    color: "#4CAF50"
    applies-to: ["#"]

  hipaa:
    description: "HIPAA compliance required"
    color: "#F44336"
    applies-to: ["#", "^", "~"]

  clinical:
    description: "Clinical workflow components"
    color: "#2196F3"
    applies-to: ["#", "$"]
```

---

## Directory Mapping by Discipline

### Generic (works for most)
```yaml
symbol-mapping:
  "src/core/**": "#"
  "src/features/**": "#"      # Use [feature] tag
  "src/services/**": "#"
  "src/integrations/**": "#"  # Use [integration] tag
  "src/state/**": "#"         # Use [state] tag
  "src/middleware/**": "^"
  "src/events/**": "!"
  "src/flows/**": "$"
  "src/aspects/**": "~"
```

### ML Project
```yaml
symbol-mapping:
  "models/**": "#"      # Use [feature] tag
  "data/**": "#"
  "pipelines/**": "$"
  "config/**": "#"      # Use [state] tag
  "experiments/**": "#" # Use [feature] tag
```

### Game Project
```yaml
symbol-mapping:
  "gameplay/**": "#"    # Use [feature] tag
  "systems/**": "#"
  "entities/**": "#"
  "state/**": "#"       # Use [state] tag
  "events/**": "!"
```

### Data Project
```yaml
symbol-mapping:
  "models/**": "#"      # dbt models
  "transforms/**": "#"
  "dags/**": "$"        # Airflow DAGs
  "pipelines/**": "$"
  "sources/**": "#"
```

### CLI Project
```yaml
symbol-mapping:
  "commands/**": "#"
  "cmd/**": "#"
  "lib/**": "#"
  "flows/**": "$"
```

---

*Paradigm is the protocol. Tags are your vocabulary. Your discipline is the implementation.*
