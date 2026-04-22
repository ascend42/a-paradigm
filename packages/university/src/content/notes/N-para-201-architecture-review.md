---
id: N-para-201-architecture-review
title: Putting It All Together
type: note
author: paradigm
created: '2026-04-22'
updated: '2026-04-22'
tags:
  - course
  - para-201
  - feature-building-follows
  - implementation-comes-last
  - check-existing-aspects
symbols: []
difficulty: beginner
estimatedMinutes: 4
prerequisites: []
category: paradigm-core
origin: imported
source: courses/para-201.json
---

## Building a Complete Feature

You have learned flows, gates, aspects, disciplines, naming conventions, component patterns, signal patterns, and cross-cutting concerns. Now let us walk through building a complete feature from scratch, using every tool in the Paradigm toolkit. The feature: **a team invitation system** where team admins can invite new members via email.

## Step 1: Identify Components

Start by listing the code units you will need:

```yaml
#invitation-service:
  description: Creates and manages team invitations
  tags: [feature, teams]

#invitation-email:
  description: Sends invitation emails via SendGrid
  tags: [integration, sendgrid, email]

#invitation-token:
  description: Generates and validates secure invitation tokens
  tags: [infrastructure, security]

#invitation-store:
  description: Persists invitations with status tracking
  tags: [state, teams]
```

Four components — one feature, one integration, one infrastructure, one state. Each has a clear responsibility and appropriate tags.

## Step 2: Define the Flow

The invitation process spans all four components in sequence:

```yaml
$team-invitation-flow:
  description: Admin invites a user, email is sent, user accepts and joins team
  steps:
    - component: "#invitation-service"
      action: create-invitation
      description: Validates admin permissions and creates invitation record
    - component: "#invitation-token"
      action: generate-token
      description: Creates a cryptographically secure token with 7-day expiry
    - component: "#invitation-store"
      action: persist-invitation
      description: Saves invitation with pending status
    - component: "#invitation-email"
      action: send-invite
      description: Sends email with accept link containing the token
  signals: ["!invitation-sent", "!invitation-accepted"]
  gates: ["^authenticated", "^team-admin"]
```

## Step 3: Add Gates

Two gates are needed. First, check `portal.yaml` for existing gates. `^authenticated` likely exists. `^team-admin` may need to be created:

```yaml
# In portal.yaml
gates:
  ^team-admin:
    description: User must be an admin of the specified team
    check: team.admins.includes(req.user.id)
    type: role
    requires: [^authenticated]
    effects: []

routes:
  "POST /api/teams/:id/invitations": [^authenticated, ^team-admin]
  "POST /api/invitations/:token/accept": [^authenticated]
  "GET /api/teams/:id/invitations": [^authenticated, ^team-admin]
  "DELETE /api/invitations/:id": [^authenticated, ^team-admin]
```

Notice that accepting an invitation only requires `^authenticated` — any logged-in user with a valid token can accept. But creating, listing, and deleting invitations requires `^team-admin`.

## Step 4: Define Signals

```yaml
!invitation-sent:
  description: An invitation email was successfully sent to a prospective team member
  emitters: ["#invitation-service"]
  category: business
  data:
    invitationId: string
    teamId: string
    email: string

!invitation-accepted:
  description: A user accepted a team invitation and joined the team
  emitters: ["#invitation-service"]
  category: business
  data:
    invitationId: string
    teamId: string
    userId: string
```

These business signals enable decoupled side effects — an analytics tracker can listen for `!invitation-accepted` to track conversion rates, and a notification service can alert existing team members.

## Step 5: Apply Aspects

Check which aspects apply to the new components:

- `~audit-required` applies to `#*Service` → `#invitation-service` is covered. Ensure the audit middleware is applied.
- `~rate-limited` applies to `#*-handler` → Not directly applicable here (no handler component), but the API route should go through the rate limiter.
- `~validated` applies to `#*-handler` → The invitation endpoint should validate input (email format, team existence).

## Step 6: Write the .purpose File

Assemble everything into `src/invitations/.purpose`:

```yaml
name: Team Invitations
description: Team admin invitation system with email delivery and token-based acceptance
context:
  - Invitation tokens expire after 7 days
  - Maximum 50 pending invitations per team
  - Uses SendGrid for email delivery

components:
  #invitation-service:
    description: Creates and manages team invitations
    file: invitation-service.ts
    tags: [feature, teams]
    flows: ["$team-invitation-flow"]
    signals: ["!invitation-sent", "!invitation-accepted"]
    gates: ["^authenticated", "^team-admin"]
    aspects: ["~audit-required"]
  # ... (remaining components)

flows:
  $team-invitation-flow:
    # ... (as defined above)

signals:
  !invitation-sent:
    # ... (as defined above)
  !invitation-accepted:
    # ... (as defined above)
```

## Step 7: Validate

Before writing any implementation code, validate the Paradigm definitions:

1. `paradigm_purpose_validate` — Checks the .purpose file for schema errors.
2. `paradigm_flow_check` — Verifies the flow references valid components.
3. `paradigm_aspect_check` — Confirms aspect anchors are valid for applied aspects.
4. `paradigm_ripple` — Shows what existing code is affected by the new components.

## The Pattern

Every feature follows this pattern: **identify components** → **define flows** → **add gates** → **define signals** → **apply aspects** → **write .purpose** → **validate** → **implement**. The implementation comes last — after the architecture is documented and validated. This front-loaded documentation pays dividends: AI agents can navigate the new feature immediately, security is defined before code, and the team has a clear map of what will be built.
