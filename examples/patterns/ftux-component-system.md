# FTUX Component System Specification

> Paradigm v1.0 - First Time User Experience (FTUX) System

The FTUX Component System provides a standardized approach for targeting components in guided user experiences. This enables product teams to create onboarding flows, feature discovery, and contextual help without modifying application code.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    FTUX SYSTEM ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │ Component   │    │   Event     │    │      Journey        │  │
│  │  Registry   │───▶│   Builder   │───▶│     Designer        │  │
│  │ (IDs + Meta)│    │ (Effects)   │    │  (Sequences)        │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│         │                  │                     │              │
│         ▼                  ▼                     ▼              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              DATABASE (ftux_* tables)                       ││
│  │  - ftux_component_registry (targetable components)          ││
│  │  - ftux_events (individual FTUX moments)                    ││
│  │  - ftux_journeys (multi-step flows)                         ││
│  │  - ftux_user_completions (progress tracking)                ││
│  └─────────────────────────────────────────────────────────────┘│
│         │                  │                     │              │
│         ▼                  ▼                     ▼              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Runtime   │    │   Wrapper   │    │    Progress         │  │
│  │  Discovery  │    │  Component  │    │    Tracker          │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### Component IDs

Every targetable component has a unique identifier:

- **Format**: `kebab-case` (e.g., `add-lead-button`, `client-switcher`)
- **Scope**: Unique within the application
- **Registration**: Centralized registry (database or constants file)

### Data Attribute

Components are targeted via the `data-ftux-id` attribute:

```html
<Button data-ftux-id="add-lead-button">Add Lead</Button>
```

The FTUX runtime discovers components by querying `[data-ftux-id]`.

### Component Registry

Maps component IDs to metadata:

| Field | Purpose |
|-------|---------|
| `component_id` | Unique identifier (e.g., `add-lead-button`) |
| `page_identifier` | Route or page context (e.g., `leads-page`) |
| `description` | Human-readable purpose |
| `component_path` | Source file path (optional, for dev) |
| `is_active` | Enable/disable targeting |

---

## Component Responsibilities

| Component | Responsibility | Who Maintains |
|-----------|---------------|---------------|
| **Component Registry** | Store all targetable component IDs | Developers add IDs when creating components |
| **Event Builder** | Configure what effect shows on which component | Product/UX team via admin UI |
| **Journey Designer** | Group events into sequences, set triggers | Product/UX team via admin UI |
| **FTUXWrapper** | Render effects on targeted components | Framework (once implemented) |
| **Progress Tracker** | Track user completion, show progress | Framework (once implemented) |
| **Analytics** | Report on journey completion rates | Framework (once implemented) |

---

## Database Schema

### Required Tables

```sql
-- Component Registry: Store all FTUX-targetable components
CREATE TABLE ftux_component_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id TEXT UNIQUE NOT NULL,        -- e.g., 'add-lead-button'
  page_identifier TEXT,                      -- e.g., 'leads-page'
  description TEXT,                          -- Human-readable description
  component_path TEXT,                       -- e.g., 'src/components/AddLeadButton.tsx'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Events: Individual FTUX moments
CREATE TABLE ftux_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id TEXT NOT NULL,                -- References component_registry
  effect_type TEXT NOT NULL,                 -- highlight, standout, tooltip, pulse
  effect_params JSONB DEFAULT '{}',          -- Custom styling parameters
  tooltip_text TEXT,                         -- Message to display
  tooltip_direction TEXT DEFAULT 'auto',     -- top, bottom, left, right, auto
  conditions JSONB DEFAULT '{}',             -- When to show (tier, integration, etc.)
  action_text TEXT,                          -- CTA button text
  action_url TEXT,                           -- CTA navigation target
  dismiss_trigger TEXT DEFAULT 'click',      -- click, cta, timer
  priority INTEGER DEFAULT 0,                -- Higher = shown first
  journey_id UUID REFERENCES ftux_journeys(id) ON DELETE SET NULL,
  journey_order INTEGER DEFAULT 0,           -- Order within journey
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Journeys: Multi-step onboarding flows
CREATE TABLE ftux_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id TEXT UNIQUE NOT NULL,           -- e.g., 'window-shopper', 'new-signup'
  name TEXT NOT NULL,                        -- Display name
  description TEXT,
  trigger_conditions JSONB DEFAULT '{}',     -- When to start this journey
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,                -- Higher = takes precedence
  show_progress BOOLEAN DEFAULT true,        -- Show step counter
  dismissible BOOLEAN DEFAULT true,          -- Allow skip
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- User Completions: Track progress per user
CREATE TABLE ftux_user_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,                     -- REFERENCES auth.users if using Supabase
  ftux_event_id UUID REFERENCES ftux_events(id) ON DELETE CASCADE NOT NULL,
  journey_id UUID REFERENCES ftux_journeys(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  dismissed BOOLEAN DEFAULT false,
  UNIQUE(user_id, ftux_event_id)
);

-- Indexes for performance
CREATE INDEX idx_ftux_events_component_id ON ftux_events(component_id);
CREATE INDEX idx_ftux_events_journey_id ON ftux_events(journey_id);
CREATE INDEX idx_ftux_completions_user_id ON ftux_user_completions(user_id);
CREATE INDEX idx_ftux_completions_journey ON ftux_user_completions(journey_id);
```

### RLS Policies (Supabase Example)

```sql
-- Users can read active events and journeys
CREATE POLICY "Users can read active ftux_events"
  ON ftux_events FOR SELECT
  USING (is_active = true);

CREATE POLICY "Users can read active ftux_journeys"
  ON ftux_journeys FOR SELECT
  USING (is_active = true);

-- Users can manage their own completions
CREATE POLICY "Users manage own completions"
  ON ftux_user_completions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Super admins can manage everything
CREATE POLICY "Super admins manage ftux"
  ON ftux_events FOR ALL
  USING (public.is_super_admin(auth.uid()));
```

---

## Effect Types

| Effect | Visual | CSS Implementation | Use Case |
|--------|--------|-------------------|----------|
| `highlight` | Ring + glow | `ring-2 ring-primary shadow-lg shadow-primary/20` | Draw attention |
| `standout` | Elevation + scale | `scale-105 shadow-xl z-50` | Call to action |
| `tooltip` | Speech bubble | Positioned tooltip with arrow | Explain feature |
| `pulse` | Animation | `animate-pulse` or custom keyframes | Indicate interaction |

### Effect Parameters

```typescript
interface EffectParams {
  // Highlight
  ringColor?: string;      // Tailwind color or hex
  ringWidth?: number;      // Ring width in pixels
  glowOpacity?: number;    // 0-1 glow intensity
  
  // Standout
  scale?: number;          // e.g., 1.05
  elevation?: 'sm' | 'md' | 'lg' | 'xl';
  
  // Tooltip
  maxWidth?: number;       // Max tooltip width
  showArrow?: boolean;     // Display arrow pointer
  
  // Pulse
  duration?: number;       // Animation duration in ms
  iterations?: number | 'infinite';
}
```

---

## Implementation Patterns

### Pattern A: Data Attribute (Simplest)

Just add the attribute — works with any component:

```tsx
<Button data-ftux-id="add-lead-button">Add Lead</Button>
<Input data-ftux-id="search-input" placeholder="Search..." />
```

**Pros**: Zero code changes, works with third-party components
**Cons**: No auto-registration

### Pattern B: HOC (Auto-Registration)

Wraps component with FTUX capability and auto-registers in dev:

```tsx
import { withFTUXId } from '@/components/FTUXId';

// Define component normally
const AddLeadButtonBase = (props) => (
  <Button {...props}>Add Lead</Button>
);

// Wrap with FTUX targeting
export const AddLeadButton = withFTUXId(
  'add-lead-button',    // Component ID
  'leads-page',         // Page identifier
  'Primary action to add a new lead',  // Description
  'src/components/AddLeadButton.tsx'   // Optional file path
)(AddLeadButtonBase);

// Usage - ftuxProps automatically applied
<AddLeadButton onClick={handleClick} />
```

**Pros**: Auto-registration, type-safe
**Cons**: Requires wrapping each component

### Pattern C: Hook (Flexible)

Use in any functional component:

```tsx
import { useFTUXId } from '@/components/FTUXId';

function SearchBar() {
  const ftuxProps = useFTUXId(
    'search-bar',
    'header',
    'Main search input in header'
  );
  
  return (
    <div {...ftuxProps}>
      <Input placeholder="Search..." />
    </div>
  );
}
```

**Pros**: Flexible, works anywhere
**Cons**: Manual integration

### Pattern D: Wrapper Component (Declarative)

Wraps children with FTUX targeting:

```tsx
import { FTUXTarget } from '@/components/FTUXId';

<FTUXTarget 
  id="settings-button" 
  page="header"
  description="Opens settings panel"
>
  <SettingsButton />
</FTUXTarget>
```

**Pros**: Declarative, no component modification
**Cons**: Extra DOM wrapper (optional)

---

## Condition System

Events and journeys can have conditions that determine when they show:

```typescript
interface FTUXConditions {
  // Subscription tiers that should see this
  tiers?: ('window-shopper' | 'starter' | 'growth' | 'agency')[];
  
  // Integration status
  hasIntegration?: boolean;
  integrations?: string[];  // Specific integrations required
  
  // Usage metrics
  leadCount?: { min?: number; max?: number };
  daysActive?: { min?: number; max?: number };
  
  // Signup state
  daysSinceSignup?: number;
  isNewUser?: boolean;      // Signed up in last 7 days
  
  // Sandbox mode
  isWindowShopper?: boolean;
  
  // Route matching
  routes?: string[];        // Only show on these routes
  excludeRoutes?: string[]; // Don't show on these routes
  
  // Feature flags
  featureFlags?: string[];  // Required feature flags
  
  // Custom conditions (evaluated at runtime)
  custom?: Record<string, unknown>;
}
```

### Condition Evaluation

```typescript
function evaluateConditions(
  conditions: FTUXConditions,
  context: UserContext
): boolean {
  // All specified conditions must pass (AND logic)
  
  if (conditions.tiers && !conditions.tiers.includes(context.tier)) {
    return false;
  }
  
  if (conditions.isWindowShopper !== undefined && 
      conditions.isWindowShopper !== context.isWindowShopper) {
    return false;
  }
  
  if (conditions.leadCount) {
    const count = context.leadCount;
    if (conditions.leadCount.min && count < conditions.leadCount.min) return false;
    if (conditions.leadCount.max && count > conditions.leadCount.max) return false;
  }
  
  // ... evaluate other conditions
  
  return true;
}
```

---

## Journey System

### Journey Types

| Journey ID | Trigger | Purpose |
|------------|---------|---------|
| `window-shopper` | Unauthenticated visitor | Explore app value proposition |
| `new-signup` | First 24 hours after signup | Core feature onboarding |
| `starter-user` | Starter tier, first week | Basic workflow setup |
| `growth-user` | Upgraded to Growth | Advanced feature discovery |
| `agency-user` | Upgraded to Agency | Team and client features |
| `upgrade-prompt` | Hit tier limit | Encourage upgrade |
| `feature-discovery` | New feature released | Announce new capabilities |

### Journey Triggers

```typescript
interface JourneyTrigger {
  // User state conditions
  isWindowShopper?: boolean;
  isAuthenticated?: boolean;
  tier?: FeatureTier[];
  
  // Lifecycle events
  isNewSignup?: boolean;         // Signed up in last 24h
  upgradedFrom?: FeatureTier;    // Just upgraded from this tier
  daysSinceLastVisit?: number;   // Re-engagement
  
  // Completion state
  notCompleted?: boolean;        // Only show if not already completed
  
  // Route triggers
  onRoute?: string[];            // Trigger when visiting these routes
  
  // Event triggers
  onSignal?: string[];           // Trigger on these signals (e.g., '!first-lead-created')
}
```

### Journey Definition Example

```typescript
const journeys: Journey[] = [
  {
    journeyId: 'new-signup',
    name: 'Getting Started',
    description: 'Core onboarding for new users',
    trigger: {
      isAuthenticated: true,
      isNewSignup: true,
      notCompleted: true,
    },
    steps: [
      { eventId: 'welcome-banner', required: true },
      { eventId: 'add-first-lead', required: true },
      { eventId: 'connect-integration', required: false },
      { eventId: 'explore-analytics', required: false },
    ],
    showProgress: true,
    dismissible: true,
    priority: 100,
  },
];
```

---

## Progress Tracking

### Database-Based (Authenticated Users)

```typescript
async function markEventComplete(
  userId: string,
  eventId: string,
  journeyId?: string
) {
  await supabase
    .from('ftux_user_completions')
    .upsert({
      user_id: userId,
      ftux_event_id: eventId,
      journey_id: journeyId,
      completed_at: new Date().toISOString(),
    });
}

async function getJourneyProgress(
  userId: string,
  journeyId: string
): Promise<JourneyProgress> {
  const { data: completions } = await supabase
    .from('ftux_user_completions')
    .select('ftux_event_id')
    .eq('user_id', userId)
    .eq('journey_id', journeyId);
    
  const { data: events } = await supabase
    .from('ftux_events')
    .select('id')
    .eq('journey_id', journeyId);
    
  return {
    total: events?.length || 0,
    completed: completions?.length || 0,
    percentage: (completions?.length || 0) / (events?.length || 1) * 100,
  };
}
```

### LocalStorage-Based (Window Shoppers)

```typescript
const STORAGE_KEY = 'ftux_progress';

function getLocalProgress(): Record<string, boolean> {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : {};
}

function markLocalComplete(eventId: string) {
  const progress = getLocalProgress();
  progress[eventId] = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function clearLocalProgress() {
  localStorage.removeItem(STORAGE_KEY);
}
```

---

## Admin UI Components

### 1. Component Registry

Manage all FTUX-targetable component IDs:

- List all registered components with search/filter
- Add new component IDs manually
- Edit component metadata (description, page)
- Toggle active status
- View usage (which events reference this component)
- "Scan codebase" to auto-discover `data-ftux-id` attributes

### 2. Event Builder

Visual editor for configuring events:

- Select target component from registry
- Choose effect type with live preview
- Configure effect parameters
- Write tooltip text with markdown support
- Set action button (text + URL)
- Configure dismiss trigger
- Set conditions (tier, integration, etc.)
- Assign to journey with order

### 3. Journey Designer

Create and manage multi-step journeys:

- Drag-and-drop event ordering
- Set journey trigger conditions
- Configure display options (progress, dismissible)
- Preview journey flow
- Test with different user contexts
- View completion analytics

### 4. Analytics Dashboard

Track FTUX performance:

- Journey start/completion rates
- Step-by-step drop-off analysis
- Time to completion
- Conversion correlation
- Export data for analysis

---

## AI Agent Implementation Guide

### Step 1: Create Database Tables

Apply the migrations from the schema section above. Add RLS policies appropriate for your auth system.

### Step 2: Create Core Components

Create these files in your project:

1. **`src/components/FTUXId.tsx`** - HOC, hook, and wrapper for component targeting
   - Export `withFTUXId()` HOC
   - Export `useFTUXId()` hook
   - Export `FTUXTarget` wrapper component
   - Auto-register components in dev mode

2. **`src/components/FTUXWrapper.tsx`** - Renders effects on targeted components
   - Query for active events by page
   - Find matching components via `[data-ftux-id]`
   - Render appropriate effect (highlight, tooltip, etc.)
   - Handle dismiss and completion

3. **`src/components/FTUXTooltip.tsx`** - Tooltip component
   - Auto-position based on viewport
   - Support action button
   - Handle dismiss triggers

4. **`src/components/FTUXProgress.tsx`** - Journey progress indicator
   - Floating, sidebar, or inline variants
   - Animated transitions
   - Click to navigate to step

### Step 3: Create Hooks

1. **`useFTUX(pageIdentifier)`** - Load active event for a page
2. **`useFTUXAdmin()`** - CRUD operations for admin UI
3. **`useSandboxFTUX(pageIdentifier)`** - LocalStorage-based for window shoppers

### Step 4: Add Component IDs

Identify key components that should be FTUX-targetable:

- Primary action buttons (Add Lead, Connect Integration, etc.)
- Navigation elements (Sidebar links, tabs)
- Feature discovery points (New features, upgrade prompts)
- Settings and configuration panels
- Empty states and onboarding triggers

### Step 5: Create Admin UI (Optional)

If building an admin interface:

- Create routes under `/admin/ftux/`
- Build ComponentRegistry, EventBuilder, JourneyDesigner, AnalyticsDashboard
- Protect with `^super-admin` portal

### Step 6: Configure Initial Journeys

Create journeys for common user states:

- `window-shopper`: Explore the app's value
- `new-signup`: Get started with core features
- `starter-user`: Workflow for basic tier
- `growth-user`: Advanced feature discovery
- `agency-user`: Team and client management

---

## Best Practices

### 1. Component ID Naming

```
Good:
- add-lead-button
- client-switcher-dropdown
- integration-connect-facebook

Bad:
- btn1
- addLead
- AddLeadButton (use kebab-case)
```

### 2. Event Targeting

- One event per component per journey
- Keep tooltip text under 100 characters
- Use action buttons for complex flows
- Test on mobile viewport sizes

### 3. Journey Design

- Keep journeys under 7 steps
- Make first 2-3 steps required
- Allow skipping non-essential steps
- Show progress indicator for journeys > 3 steps

### 4. Condition Usage

- Start simple, add conditions as needed
- Test with all user tiers
- Don't over-target (annoys users)
- Use analytics to refine conditions

### 5. Performance

- Lazy-load FTUX components
- Cache event queries
- Debounce condition evaluation
- Use CSS animations over JS

---

## Integration with Paradigm

### Logging

Use Paradigm logger for FTUX events:

```typescript
import { log } from '@/lib/paradigmLogger';

// When event is shown
log.flow('$ftux').info('Event shown', { 
  eventId: 'add-first-lead',
  journeyId: 'new-signup',
  step: 2,
});

// When event is completed
log.signal('!ftux-event-complete').info('Event completed', {
  eventId: 'add-first-lead',
  journeyId: 'new-signup',
});

// When journey is completed
log.signal('!ftux-journey-complete').info('Journey completed', {
  journeyId: 'new-signup',
  duration: 3600000, // ms
});
```

### Portal Integration

FTUX can trigger based on portal checks:

```typescript
// Show upgrade prompt when hitting tier limit
portal.check('^feature-limit')
  .requires('usage within limit')
  .context({ feature: 'leads', used: 500, limit: 500 })
  .deny('Monthly lead limit reached')
  .then(() => {
    // Trigger upgrade journey
    triggerJourney('upgrade-prompt');
  });
```

---

---

## Platform Considerations

### Web (React, Vue, Angular)

This specification is **primarily designed for web applications**. The following features work natively:

| Feature | Web Implementation |
|---------|-------------------|
| Component Targeting | `data-ftux-id` HTML attributes |
| Effect Rendering | CSS animations, transforms, shadows |
| Tooltip Positioning | DOM getBoundingClientRect() |
| Progress Tracking | localStorage for anonymous, database for auth |
| Console Logging | Browser console with styled output |

### Mobile (React Native, Flutter, Swift, Kotlin)

Mobile implementations require **platform-specific adaptations**:

| Feature | Mobile Considerations |
|---------|----------------------|
| **Component Targeting** | Use `testID` (RN), `key` (Flutter), or accessibility identifiers |
| **Effect Rendering** | Native animations (Animated API, Lottie, platform animators) |
| **Tooltip Positioning** | Native measure functions, consider keyboard avoidance |
| **Progress Tracking** | AsyncStorage (RN), SharedPreferences, UserDefaults |
| **Console Logging** | Native logging (Logcat, os_log) - no styled output |

#### React Native Adaptations

```tsx
// Component targeting with testID
<Button testID="ftux-add-lead-button" onPress={handleAdd}>
  Add Lead
</Button>

// Effect rendering with Animated API
const pulseAnim = useRef(new Animated.Value(1)).current;
Animated.loop(
  Animated.sequence([
    Animated.timing(pulseAnim, { toValue: 1.1, duration: 500 }),
    Animated.timing(pulseAnim, { toValue: 1, duration: 500 }),
  ])
).start();

// Progress tracking with AsyncStorage
import AsyncStorage from '@react-native-async-storage/async-storage';
await AsyncStorage.setItem('ftux_progress', JSON.stringify(progress));
```

#### Flutter Adaptations

```dart
// Component targeting with Key
ElevatedButton(
  key: Key('ftux-add-lead-button'),
  onPressed: handleAdd,
  child: Text('Add Lead'),
)

// Effect rendering with AnimationController
late AnimationController _controller;
_controller = AnimationController(
  duration: Duration(milliseconds: 500),
  vsync: this,
)..repeat(reverse: true);

// Progress tracking with SharedPreferences
final prefs = await SharedPreferences.getInstance();
await prefs.setString('ftux_progress', jsonEncode(progress));
```

### Hybrid Apps (Capacitor, Cordova)

Hybrid apps can use **web implementation with caveats**:

- Console logs may not be visible without remote debugging
- localStorage works but consider Capacitor Preferences plugin for persistence
- CSS animations generally work but test on actual devices
- Touch targets should be larger (44x44pt minimum)

### Key Mobile Differences

1. **No Browser Console** - Logs go to native console (Logcat/Xcode), not browser DevTools
2. **No CSS Box Model** - Effects need native implementations
3. **Different Storage APIs** - No localStorage, use platform-specific storage
4. **Touch vs Click** - Consider touch feedback, haptics
5. **Screen Sizes** - Tooltips must adapt to varying screen sizes
6. **Keyboard Handling** - Tooltips should avoid being covered by keyboard
7. **Accessibility** - Use platform accessibility APIs for screen readers

### Recommended Approach for Mobile

1. **Share the database schema** - Same tables work across platforms
2. **Platform-specific UI components** - FTUXWrapper, FTUXTooltip per platform
3. **Shared condition logic** - Same TypeScript/Dart evaluation
4. **Platform adapters** - Abstract storage, logging, animations

---

## Changelog

| Version | Changes |
|---------|---------|
| 1.0 | Initial specification |
| 1.1 | Added platform considerations for mobile |
