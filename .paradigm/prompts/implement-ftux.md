# Implement FTUX System

> Paradigm Prompt - AI Agent Guide for Implementing FTUX

Use this prompt when implementing the FTUX (First Time User Experience) system in a Paradigm project.

---

## Context

You are implementing the FTUX Component System in a project that uses the Paradigm framework. This system enables product teams to create guided onboarding flows, feature discovery, and contextual help by targeting components with `data-ftux-id` attributes.

## Prerequisites

Before starting, ensure:
- [ ] Project uses React with TypeScript
- [ ] Database is Supabase (or compatible PostgreSQL)
- [ ] Paradigm logger is already set up (`src/lib/paradigmLogger.ts`)
- [ ] Basic auth system is in place

## Reference Documentation

Read these specs before implementing:
- `specs/ftux-component-system.md` - Full system specification
- `specs/sandbox-mode.md` - For window shopper support (optional)

---

## Implementation Steps

### Step 1: Create Database Tables

Create a migration file to set up the FTUX tables:

```sql
-- migrations/YYYYMMDDHHMMSS_ftux_tables.sql

-- Component Registry
CREATE TABLE ftux_component_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id TEXT UNIQUE NOT NULL,
  page_identifier TEXT,
  description TEXT,
  component_path TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Events
CREATE TABLE ftux_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id TEXT NOT NULL,
  effect_type TEXT NOT NULL CHECK (effect_type IN ('highlight', 'standout', 'tooltip', 'pulse')),
  effect_params JSONB DEFAULT '{}',
  tooltip_text TEXT,
  tooltip_direction TEXT DEFAULT 'auto',
  conditions JSONB DEFAULT '{}',
  action_text TEXT,
  action_url TEXT,
  dismiss_trigger TEXT DEFAULT 'click' CHECK (dismiss_trigger IN ('click', 'cta', 'timer')),
  priority INTEGER DEFAULT 0,
  journey_id UUID REFERENCES ftux_journeys(id) ON DELETE SET NULL,
  journey_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Journeys
CREATE TABLE ftux_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  trigger_conditions JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  show_progress BOOLEAN DEFAULT true,
  dismissible BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- User Completions
CREATE TABLE ftux_user_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ftux_event_id UUID REFERENCES ftux_events(id) ON DELETE CASCADE NOT NULL,
  journey_id UUID REFERENCES ftux_journeys(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ DEFAULT now(),
  dismissed BOOLEAN DEFAULT false,
  UNIQUE(user_id, ftux_event_id)
);

-- Indexes
CREATE INDEX idx_ftux_events_component ON ftux_events(component_id);
CREATE INDEX idx_ftux_events_journey ON ftux_events(journey_id);
CREATE INDEX idx_ftux_completions_user ON ftux_user_completions(user_id);

-- RLS Policies
ALTER TABLE ftux_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftux_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftux_user_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read active events" ON ftux_events
  FOR SELECT USING (is_active = true);

CREATE POLICY "Users can read active journeys" ON ftux_journeys
  FOR SELECT USING (is_active = true);

CREATE POLICY "Users manage own completions" ON ftux_user_completions
  FOR ALL USING (auth.uid() = user_id);
```

### Step 2: Create Core Components

#### 2.1 FTUXId.tsx - Component Targeting

```tsx
// src/components/FTUXId.tsx
import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { log } from '@/lib/paradigmLogger';

export interface FTUXProps {
  'data-ftux-id': string;
  ref: React.Ref<any>;
}

// HOC for auto-registration
export function withFTUXId<P extends object>(
  componentId: string,
  pageIdentifier: string,
  description?: string,
  componentPath?: string
) {
  return (WrappedComponent: React.ComponentType<P & { ftuxProps?: FTUXProps }>) => {
    const ComponentWithFTUXId = React.forwardRef<any, P>((props, ref) => {
      const internalRef = useRef<any>(null);

      const mergedRef = useCallback((node: any) => {
        internalRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<any>).current = node;
        }
      }, [ref]);

      useEffect(() => {
        if (import.meta.env.DEV) {
          log.component('#ftux-registry').debug('Component registered', {
            componentId,
            pageIdentifier,
            description,
          });
        }
      }, []);

      const ftuxProps: FTUXProps = {
        'data-ftux-id': componentId,
        ref: mergedRef,
      };

      return <WrappedComponent {...props as P} ftuxProps={ftuxProps} />;
    });

    ComponentWithFTUXId.displayName = `withFTUXId(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;
    return ComponentWithFTUXId;
  };
}

// Hook for flexible usage
export function useFTUXId(
  componentId: string,
  pageIdentifier: string,
  description?: string
) {
  const ref = useRef<any>(null);

  useEffect(() => {
    if (import.meta.env.DEV) {
      log.component('#ftux-registry').debug('Component registered via hook', {
        componentId,
        pageIdentifier,
        description,
      });
    }
  }, [componentId, pageIdentifier, description]);

  const ftuxProps: FTUXProps = useMemo(() => ({
    'data-ftux-id': componentId,
    ref: ref,
  }), [componentId]);

  return ftuxProps;
}

// Wrapper component for declarative usage
interface FTUXTargetProps {
  id: string;
  page: string;
  description?: string;
  children: React.ReactElement;
}

export function FTUXTarget({ id, page, description, children }: FTUXTargetProps) {
  const ref = useRef<any>(null);

  useEffect(() => {
    if (import.meta.env.DEV) {
      log.component('#ftux-registry').debug('Component registered via FTUXTarget', {
        componentId: id,
        pageIdentifier: page,
        description,
      });
    }
  }, [id, page, description]);

  return React.cloneElement(children, {
    'data-ftux-id': id,
    ref: ref,
  });
}
```

#### 2.2 FTUXWrapper.tsx - Effect Renderer

```tsx
// src/components/FTUXWrapper.tsx
import React, { useEffect, useState, useRef } from 'react';
import { useFTUX } from '@/hooks/useFTUX';
import { FTUXTooltip } from './FTUXTooltip';
import { log } from '@/lib/paradigmLogger';

interface FTUXWrapperProps {
  pageIdentifier: string;
  children: React.ReactNode;
}

export function FTUXWrapper({ pageIdentifier, children }: FTUXWrapperProps) {
  const { activeEvent, completeEvent, dismissEvent } = useFTUX(pageIdentifier);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!activeEvent) {
      setTargetElement(null);
      return;
    }

    const element = document.querySelector(
      `[data-ftux-id="${activeEvent.component_id}"]`
    ) as HTMLElement;

    if (element) {
      setTargetElement(element);
      log.flow('$ftux').info('Event activated', {
        eventId: activeEvent.id,
        componentId: activeEvent.component_id,
      });
    }
  }, [activeEvent]);

  useEffect(() => {
    if (!targetElement || !activeEvent) return;

    // Apply effect based on type
    const cleanup = applyEffect(targetElement, activeEvent.effect_type, activeEvent.effect_params);

    return cleanup;
  }, [targetElement, activeEvent]);

  const handleComplete = () => {
    if (activeEvent) {
      completeEvent(activeEvent.id);
      log.signal('!ftux-event-complete').info('Event completed', {
        eventId: activeEvent.id,
      });
    }
  };

  const handleDismiss = () => {
    if (activeEvent) {
      dismissEvent(activeEvent.id);
      log.signal('!ftux-event-dismissed').info('Event dismissed', {
        eventId: activeEvent.id,
      });
    }
  };

  return (
    <>
      {children}
      {activeEvent && targetElement && activeEvent.effect_type === 'tooltip' && (
        <FTUXTooltip
          targetElement={targetElement}
          text={activeEvent.tooltip_text || ''}
          direction={activeEvent.tooltip_direction || 'auto'}
          actionText={activeEvent.action_text}
          actionUrl={activeEvent.action_url}
          onComplete={handleComplete}
          onDismiss={handleDismiss}
        />
      )}
    </>
  );
}

function applyEffect(
  element: HTMLElement,
  effectType: string,
  params: Record<string, any>
): () => void {
  const originalStyles: Record<string, string> = {};

  switch (effectType) {
    case 'highlight':
      originalStyles.boxShadow = element.style.boxShadow;
      originalStyles.outline = element.style.outline;
      element.style.boxShadow = '0 0 0 4px rgba(var(--primary), 0.3)';
      element.style.outline = '2px solid rgb(var(--primary))';
      break;

    case 'standout':
      originalStyles.transform = element.style.transform;
      originalStyles.zIndex = element.style.zIndex;
      originalStyles.boxShadow = element.style.boxShadow;
      element.style.transform = 'scale(1.05)';
      element.style.zIndex = '50';
      element.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.25)';
      break;

    case 'pulse':
      element.classList.add('animate-pulse');
      break;
  }

  return () => {
    if (effectType === 'pulse') {
      element.classList.remove('animate-pulse');
    } else {
      Object.entries(originalStyles).forEach(([key, value]) => {
        (element.style as any)[key] = value;
      });
    }
  };
}
```

#### 2.3 FTUXTooltip.tsx

```tsx
// src/components/FTUXTooltip.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface FTUXTooltipProps {
  targetElement: HTMLElement;
  text: string;
  direction: string;
  actionText?: string | null;
  actionUrl?: string | null;
  onComplete: () => void;
  onDismiss: () => void;
}

export function FTUXTooltip({
  targetElement,
  text,
  direction,
  actionText,
  actionUrl,
  onComplete,
  onDismiss,
}: FTUXTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const updatePosition = () => {
      const rect = targetElement.getBoundingClientRect();
      const tooltip = tooltipRef.current;
      if (!tooltip) return;

      const tooltipRect = tooltip.getBoundingClientRect();
      let top = 0;
      let left = 0;

      const actualDirection = direction === 'auto'
        ? calculateBestDirection(rect, tooltipRect)
        : direction;

      switch (actualDirection) {
        case 'top':
          top = rect.top - tooltipRect.height - 8;
          left = rect.left + (rect.width - tooltipRect.width) / 2;
          break;
        case 'bottom':
          top = rect.bottom + 8;
          left = rect.left + (rect.width - tooltipRect.width) / 2;
          break;
        case 'left':
          top = rect.top + (rect.height - tooltipRect.height) / 2;
          left = rect.left - tooltipRect.width - 8;
          break;
        case 'right':
          top = rect.top + (rect.height - tooltipRect.height) / 2;
          left = rect.right + 8;
          break;
      }

      setPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition);
    };
  }, [targetElement, direction]);

  const handleAction = () => {
    if (actionUrl) {
      window.location.href = actionUrl;
    }
    onComplete();
  };

  return (
    <div
      ref={tooltipRef}
      className="fixed z-[100] max-w-xs bg-popover border rounded-lg shadow-lg p-4 animate-in fade-in-0 zoom-in-95"
      style={{ top: position.top, left: position.left }}
    >
      <button
        onClick={onDismiss}
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <p className="text-sm pr-6">{text}</p>

      {actionText && (
        <div className="mt-3">
          <Button size="sm" onClick={handleAction}>
            {actionText}
          </Button>
        </div>
      )}
    </div>
  );
}

function calculateBestDirection(
  targetRect: DOMRect,
  tooltipRect: DOMRect
): string {
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  const spaceAbove = targetRect.top;
  const spaceBelow = viewportHeight - targetRect.bottom;
  const spaceLeft = targetRect.left;
  const spaceRight = viewportWidth - targetRect.right;

  if (spaceBelow >= tooltipRect.height + 8) return 'bottom';
  if (spaceAbove >= tooltipRect.height + 8) return 'top';
  if (spaceRight >= tooltipRect.width + 8) return 'right';
  if (spaceLeft >= tooltipRect.width + 8) return 'left';

  return 'bottom';
}
```

### Step 3: Create Hooks

#### 3.1 useFTUX.ts

```tsx
// src/hooks/useFTUX.ts
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { log } from '@/lib/paradigmLogger';

interface FTUXEvent {
  id: string;
  component_id: string;
  effect_type: string;
  effect_params: Record<string, any>;
  tooltip_text: string | null;
  tooltip_direction: string | null;
  conditions: Record<string, any>;
  action_text: string | null;
  action_url: string | null;
  dismiss_trigger: string;
  priority: number;
  journey_id: string | null;
  journey_order: number;
}

export function useFTUX(pageIdentifier: string) {
  const { user } = useAuth();
  const [activeEvent, setActiveEvent] = useState<FTUXEvent | null>(null);
  const [completedEvents, setCompletedEvents] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Fetch completed events
  useEffect(() => {
    if (!user) return;

    const fetchCompleted = async () => {
      const { data } = await supabase
        .from('ftux_user_completions')
        .select('ftux_event_id')
        .eq('user_id', user.id);

      if (data) {
        setCompletedEvents(new Set(data.map(c => c.ftux_event_id)));
      }
    };

    fetchCompleted();
  }, [user]);

  // Fetch and evaluate active event for page
  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);

      // Get all active events for this page
      const { data: events } = await supabase
        .from('ftux_events')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .order('journey_order', { ascending: true });

      if (!events) {
        setActiveEvent(null);
        setLoading(false);
        return;
      }

      // Find first uncompleted event that matches conditions
      const matchingEvent = events.find(event => {
        if (completedEvents.has(event.id)) return false;
        return evaluateConditions(event.conditions, { pageIdentifier });
      });

      setActiveEvent(matchingEvent || null);
      setLoading(false);
    };

    fetchEvents();
  }, [pageIdentifier, completedEvents]);

  const completeEvent = useCallback(async (eventId: string) => {
    if (!user) return;

    await supabase.from('ftux_user_completions').insert({
      user_id: user.id,
      ftux_event_id: eventId,
    });

    setCompletedEvents(prev => new Set([...prev, eventId]));
    setActiveEvent(null);

    log.signal('!ftux-complete').info('FTUX event completed', { eventId });
  }, [user]);

  const dismissEvent = useCallback(async (eventId: string) => {
    if (!user) return;

    await supabase.from('ftux_user_completions').insert({
      user_id: user.id,
      ftux_event_id: eventId,
      dismissed: true,
    });

    setCompletedEvents(prev => new Set([...prev, eventId]));
    setActiveEvent(null);

    log.signal('!ftux-dismiss').info('FTUX event dismissed', { eventId });
  }, [user]);

  return {
    activeEvent,
    loading,
    completeEvent,
    dismissEvent,
  };
}

function evaluateConditions(
  conditions: Record<string, any>,
  context: { pageIdentifier: string }
): boolean {
  if (!conditions || Object.keys(conditions).length === 0) {
    return true;
  }

  if (conditions.routes && !conditions.routes.includes(context.pageIdentifier)) {
    return false;
  }

  // Add more condition evaluations as needed
  return true;
}
```

### Step 4: Add Component IDs to Key Components

Identify and tag important components:

```tsx
// Example: Add Lead Button
<Button
  data-ftux-id="add-lead-button"
  onClick={handleAddLead}
>
  Add Lead
</Button>

// Example: Integration Connect Button
<Button
  data-ftux-id="connect-facebook-integration"
  onClick={handleConnect}
>
  Connect Facebook
</Button>

// Example: Sidebar Navigation
<NavLink
  data-ftux-id="nav-analytics"
  to="/analytics"
>
  Analytics
</NavLink>
```

### Step 5: Wrap Pages with FTUXWrapper

```tsx
// src/pages/LeadsPage.tsx
import { FTUXWrapper } from '@/components/FTUXWrapper';

export function LeadsPage() {
  return (
    <FTUXWrapper pageIdentifier="leads-page">
      <div className="container">
        {/* Page content */}
      </div>
    </FTUXWrapper>
  );
}
```

### Step 6: Create Admin UI (Optional)

If the project needs admin management of FTUX:

1. Create `src/pages/AdminFTUX/index.tsx` - Main admin page with tabs
2. Create `src/pages/AdminFTUX/ComponentRegistry.tsx` - Manage component IDs
3. Create `src/pages/AdminFTUX/EventBuilder.tsx` - Visual event editor
4. Create `src/pages/AdminFTUX/JourneyDesigner.tsx` - Journey management
5. Create `src/pages/AdminFTUX/AnalyticsDashboard.tsx` - Completion metrics

Add route:
```tsx
<Route
  path="/admin/ftux/*"
  element={
    <SuperAdminRoute>
      <AdminFTUX />
    </SuperAdminRoute>
  }
/>
```

---

## Verification Checklist

After implementation, verify:

- [ ] Database tables created with correct schema
- [ ] RLS policies working (users can only see active events)
- [ ] Component IDs appear on key elements (`data-ftux-id`)
- [ ] FTUXWrapper renders effects correctly
- [ ] Events can be created in database and appear
- [ ] Completing event records in ftux_user_completions
- [ ] Completed events don't show again
- [ ] Paradigm logger outputs FTUX events

---

## Common Issues

### Events Not Showing

1. Check `is_active = true` on event
2. Verify component has `data-ftux-id` attribute
3. Check conditions match current user context
4. Ensure event not already completed

### Tooltip Positioning Wrong

1. Check target element is visible in viewport
2. Verify no CSS transforms on ancestors
3. Use `direction: 'auto'` for automatic positioning

### Performance Issues

1. Lazy-load FTUX components
2. Debounce condition evaluation
3. Cache completed events in state
