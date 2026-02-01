# Paradigm Signals Enhancement Proposal

## Current State

The Paradigm framework currently indexes:
- `@` Features (185)
- `#` Components (149)
- `$` Flows (8)
- `%` States (5)
- `^` Gates (15)

**Missing**: `!` Signals (0) - despite being used extensively in the codebase.

## Problem

Signals (`!symbol`) are defined in two ways, neither of which is indexed:

### 1. Markdown Format in `.purpose` Files (Not Parsed)
```markdown
## Signals
- !sdk-key-generated: New SDK credentials created
- !sdk-key-rotated: API secret rotated
```

### 2. Inline in Code (Not Extracted)
```typescript
log.signal('!sdk-credentials-generated').info('SDK credentials created');
log.signal('!zapier-webhook').debug('Processing webhook');
```

## Proposed Solution

### Option A: Add `signals:` Section to `.purpose` Schema

Support a structured YAML `signals:` section in `.purpose` files:

```yaml
# In .purpose file
signals:
  sdk-credentials-generated:
    description: "New SDK credentials (client_key + api_secret) created for client account"
    category: sdk
    emitters:
      - src/pages/SDKSettings/hooks/useSDKCredentials.ts
    related: ["@sdk-settings", "^sdk-admin"]

  conversion-sent:
    description: "Conversion event successfully sent to ad platform CAPI"
    category: conversion
    emitters:
      - src/lib/conversionTracking.ts
    platforms: [facebook, google, tiktok, snapchat]
    related: ["$conversion-tracking-flow", "@conversion-tracking"]
```

### Option B: Extract from Code (Automatic)

Regex-extract `log.signal('!signal-name')` calls from TypeScript files:
- Pattern: `log\.signal\(['"]!([^'"]+)['"]\)`
- Group signals by file location
- Generate descriptions from log message context

### Option C: Hybrid (Recommended)

1. **Auto-extract** signal names from `log.signal()` calls
2. **Enrich** with metadata from `.purpose` files when available
3. **Warn** on orphaned signals (in code but not documented)

## Signal Categories

Organize signals by domain:

| Category | Signals | Description |
|----------|---------|-------------|
| `auth` | `!login-success`, `!login-failed`, `!session-expired` | Authentication events |
| `billing` | `!subscription-created`, `!subscription-cancelled`, `!payment-failed` | Stripe/billing events |
| `lead` | `!lead-created`, `!lead-updated`, `!lead-deleted` | Lead lifecycle events |
| `conversion` | `!conversion-sent`, `!conversion-failed`, `!conversion-matched` | CAPI events |
| `sdk` | `!sdk-credentials-generated`, `!sdk-track-received`, `!sdk-identity-matched` | SDK events |
| `integration` | `!oauth-connected`, `!oauth-disconnected`, `!webhook-received` | External integrations |
| `system` | `!rate-limit-exceeded`, `!error-logged` | System-level events |

## Schema Extension

Add to `.purpose` file schema:

```yaml
# signals: map of signal definitions
signals:
  <signal-id>:
    description: string        # What this signal represents
    category: string           # Category for grouping (auth, billing, lead, etc.)
    severity: string           # info | warn | error (default: info)
    emitters: string[]         # Files that emit this signal
    related: string[]          # Related symbols (@features, ^gates, $flows)
    data: object               # Expected payload shape (optional)
```

## Index Output

`paradigm index` should generate in `scan-index.json`:

```json
{
  "signals": {
    "sdk-credentials-generated": {
      "id": "sdk-credentials-generated",
      "symbol": "!sdk-credentials-generated",
      "name": "SDK Credentials Generated",
      "description": "New SDK credentials created for client account",
      "category": "sdk",
      "severity": "info",
      "emitters": [
        "src/pages/SDKSettings/hooks/useSDKCredentials.ts:96"
      ],
      "related": ["@sdk-settings", "^sdk-admin"]
    },
    "zapier-webhook": {
      "id": "zapier-webhook",
      "symbol": "!zapier-webhook",
      "name": "Zapier Webhook",
      "description": "Zapier webhook processing event",
      "category": "integration",
      "emitters": [
        "src/lib/conversionTracking.ts:304",
        "src/lib/conversionTracking.ts:313"
      ],
      "related": ["$conversion-tracking-flow"]
    }
  }
}
```

## Status Command Update

```
Symbol Index
────────────────────────────────────────
  @ Features     185
  # Components   149
  $ Flows          8
  % States         5
  ^ Gates         15
  ! Signals       26  ← NEW
────────────────────────────────────────
  Total:          388
```

## Current Signals in Codebase

Extracted from `log.signal()` calls:

### SDK Signals
- `!sdk-credentials-generated` - New SDK credentials created
- `!sdk-secret-rotated` - API secret rotated
- `!sdk-domains-updated` - Allowed domains list changed
- `!sdk-features-updated` - SDK feature flags changed
- `!sdk-credentials-deleted` - SDK credentials deleted

### Conversion/Webhook Signals
- `!zapier-webhook` - Zapier webhook processing (send/receive)
- `!conversion-sent` - Conversion event sent to ad platform
- `!conversion-failed` - Conversion event failed

### System Signals
- `!eventLogger` - Internal event logging

### Signals Referenced in `.purpose` (Not Yet Emitted)
- `!sdk-key-generated` - Alias for `!sdk-credentials-generated`
- `!sdk-key-rotated` - Alias for `!sdk-secret-rotated`
- `!form-captured` - SDK captured form submission
- `!conversion-matched` - Click ID matched for attribution
- `!conversion-forwarded` - Event forwarded to CAPI

## Implementation Priority

1. **Schema Update**: Add `signals:` section support to `.purpose` parser
2. **Auto-Extraction**: Scan `log.signal()` calls during indexing
3. **Status Display**: Show signal count in `paradigm status`
4. **Validation**: Warn on undocumented signals in code

## Migration Path

1. Add `signals:` sections to key `.purpose` files (root, SDK, conversion tracking)
2. Run `paradigm index` to generate initial signal index
3. Review orphaned signals and document as needed
