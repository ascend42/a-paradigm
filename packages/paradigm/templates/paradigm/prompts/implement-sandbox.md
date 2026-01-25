# Implement Sandbox Mode

> Paradigm Prompt - AI Agent Guide for Implementing Sandbox Mode

Use this prompt when implementing the Sandbox Mode pattern (freemium "try before you buy") in a Paradigm project.

---

## Context

You are implementing Sandbox Mode to allow unauthenticated users ("window shoppers") to explore the full application UI, make local in-memory changes, and experience the value proposition before subscribing. Actions that would persist data trigger a subscribe modal instead.

## Prerequisites

Before starting, ensure:
- [ ] Project uses React with TypeScript
- [ ] Auth context exists (`useAuth` hook available)
- [ ] Feature tiers defined (starter, growth, agency)
- [ ] Paradigm logger set up

## Reference Documentation

- `specs/sandbox-mode.md` - Full pattern specification
- `specs/ftux-component-system.md` - For window shopper FTUX journeys

---

## Implementation Steps

### Step 1: Create Sandbox Context

```tsx
// src/contexts/SandboxContext.tsx
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface SandboxState {
  isInSandbox: boolean;
  localLeads: Lead[];
  localIntegrations: Integration[];
  localSettings: Record<string, unknown>;
  pendingChanges: number;
  lastAttemptedAction?: {
    type: string;
    description: string;
    timestamp: number;
  };
}

interface SandboxContextValue extends SandboxState {
  enterSandbox: () => void;
  exitSandbox: () => void;
  addLocalLead: (lead: Lead) => void;
  updateLocalLead: (id: string, updates: Partial<Lead>) => void;
  deleteLocalLead: (id: string) => void;
  addLocalIntegration: (integration: Integration) => void;
  removeLocalIntegration: (id: string) => void;
  updateLocalSettings: (key: string, value: unknown) => void;
  clearSandbox: () => void;
  recordAttemptedAction: (type: string, description: string) => void;
}

const SandboxContext = createContext<SandboxContextValue | null>(null);

const STORAGE_KEY = 'sandbox_state';

export function SandboxProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SandboxState>(() => {
    // Try to load from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Check if data is stale (older than 7 days)
        if (Date.now() - parsed.savedAt < 7 * 24 * 60 * 60 * 1000) {
          return parsed.state;
        }
      } catch {}
    }
    
    return {
      isInSandbox: false,
      localLeads: [],
      localIntegrations: [],
      localSettings: {},
      pendingChanges: 0,
      lastAttemptedAction: undefined,
    };
  });

  // Persist to localStorage when state changes
  useEffect(() => {
    if (state.isInSandbox || state.pendingChanges > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        state,
        savedAt: Date.now(),
      }));
    }
  }, [state]);

  const enterSandbox = useCallback(() => {
    setState(s => ({ ...s, isInSandbox: true }));
  }, []);

  const exitSandbox = useCallback(() => {
    setState(s => ({ ...s, isInSandbox: false }));
  }, []);

  const addLocalLead = useCallback((lead: Lead) => {
    setState(s => ({
      ...s,
      localLeads: [...s.localLeads, { ...lead, id: lead.id || crypto.randomUUID() }],
      pendingChanges: s.pendingChanges + 1,
    }));
  }, []);

  const updateLocalLead = useCallback((id: string, updates: Partial<Lead>) => {
    setState(s => ({
      ...s,
      localLeads: s.localLeads.map(l => l.id === id ? { ...l, ...updates } : l),
      pendingChanges: s.pendingChanges + 1,
    }));
  }, []);

  const deleteLocalLead = useCallback((id: string) => {
    setState(s => ({
      ...s,
      localLeads: s.localLeads.filter(l => l.id !== id),
      pendingChanges: s.pendingChanges + 1,
    }));
  }, []);

  const addLocalIntegration = useCallback((integration: Integration) => {
    setState(s => ({
      ...s,
      localIntegrations: [...s.localIntegrations, { ...integration, isDemo: true }],
      pendingChanges: s.pendingChanges + 1,
    }));
  }, []);

  const removeLocalIntegration = useCallback((id: string) => {
    setState(s => ({
      ...s,
      localIntegrations: s.localIntegrations.filter(i => i.id !== id),
      pendingChanges: s.pendingChanges + 1,
    }));
  }, []);

  const updateLocalSettings = useCallback((key: string, value: unknown) => {
    setState(s => ({
      ...s,
      localSettings: { ...s.localSettings, [key]: value },
      pendingChanges: s.pendingChanges + 1,
    }));
  }, []);

  const clearSandbox = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({
      isInSandbox: false,
      localLeads: [],
      localIntegrations: [],
      localSettings: {},
      pendingChanges: 0,
      lastAttemptedAction: undefined,
    });
  }, []);

  const recordAttemptedAction = useCallback((type: string, description: string) => {
    setState(s => ({
      ...s,
      lastAttemptedAction: { type, description, timestamp: Date.now() },
    }));
  }, []);

  return (
    <SandboxContext.Provider value={{
      ...state,
      enterSandbox,
      exitSandbox,
      addLocalLead,
      updateLocalLead,
      deleteLocalLead,
      addLocalIntegration,
      removeLocalIntegration,
      updateLocalSettings,
      clearSandbox,
      recordAttemptedAction,
    }}>
      {children}
    </SandboxContext.Provider>
  );
}

export function useSandbox() {
  const context = useContext(SandboxContext);
  if (!context) {
    throw new Error('useSandbox must be used within SandboxProvider');
  }
  return context;
}
```

### Step 2: Create Action Interceptor Hook

```tsx
// src/hooks/useSandboxAction.ts
import { useCallback } from 'react';
import { useSandbox } from '@/contexts/SandboxContext';
import { useSubscribeModal } from '@/hooks/useSubscribeModal';
import { log } from '@/lib/paradigmLogger';

interface InterceptOptions<T> {
  actionName: string;
  localFallback: () => T;
  showModal?: boolean;
  bypass?: boolean;
}

export function useSandboxAction() {
  const { isInSandbox, recordAttemptedAction } = useSandbox();
  const { openSubscribeModal } = useSubscribeModal();

  const interceptAction = useCallback(async <T,>(
    apiCall: () => Promise<T>,
    options: InterceptOptions<T>
  ): Promise<T> => {
    // Bypass if not in sandbox or explicitly bypassed
    if (!isInSandbox || options.bypass) {
      return apiCall();
    }

    log.state('%sandbox').info('Action intercepted', {
      action: options.actionName,
      isInSandbox: true,
    });

    // Record the attempted action
    recordAttemptedAction(options.actionName, options.actionName);

    // Execute local fallback
    const localResult = options.localFallback();

    // Show subscribe modal if requested
    if (options.showModal !== false) {
      openSubscribeModal({
        trigger: options.actionName,
        message: `To ${options.actionName.toLowerCase()}, you'll need to subscribe.`,
      });
    }

    return localResult;
  }, [isInSandbox, recordAttemptedAction, openSubscribeModal]);

  return { interceptAction, isInSandbox };
}
```

### Step 3: Create Subscribe Modal

```tsx
// src/components/SubscribeModal.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useSandbox } from '@/contexts/SandboxContext';

interface SubscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  trigger: string;
  message: string;
}

export function SubscribeModal({ isOpen, onClose, trigger, message }: SubscribeModalProps) {
  const navigate = useNavigate();
  const { pendingChanges } = useSandbox();

  const handleSubscribe = () => {
    navigate('/select-plan');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subscribe to Continue</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-muted-foreground">
            You tried to <strong>{trigger}</strong>.
          </p>

          <p className="text-sm">{message}</p>

          {pendingChanges > 0 && (
            <div className="bg-primary/10 border border-primary/20 p-3 rounded-md">
              <p className="text-sm">
                You have <strong>{pendingChanges}</strong> pending changes
                that will be saved when you subscribe.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button onClick={handleSubscribe} className="flex-1">
              View Plans
            </Button>
            <Button variant="outline" onClick={onClose} className="flex-1">
              Continue Exploring
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### Step 4: Create Subscribe Modal Context

```tsx
// src/hooks/useSubscribeModal.tsx
import React, { createContext, useContext, useState, useCallback } from 'react';
import { SubscribeModal } from '@/components/SubscribeModal';

interface SubscribeModalContextValue {
  openSubscribeModal: (config: { trigger: string; message: string }) => void;
  closeSubscribeModal: () => void;
}

const SubscribeModalContext = createContext<SubscribeModalContextValue | null>(null);

export function SubscribeModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState({ trigger: '', message: '' });

  const openSubscribeModal = useCallback((newConfig: { trigger: string; message: string }) => {
    setConfig(newConfig);
    setIsOpen(true);
  }, []);

  const closeSubscribeModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <SubscribeModalContext.Provider value={{ openSubscribeModal, closeSubscribeModal }}>
      {children}
      <SubscribeModal
        isOpen={isOpen}
        onClose={closeSubscribeModal}
        trigger={config.trigger}
        message={config.message}
      />
    </SubscribeModalContext.Provider>
  );
}

export function useSubscribeModal() {
  const context = useContext(SubscribeModalContext);
  if (!context) {
    throw new Error('useSubscribeModal must be used within SubscribeModalProvider');
  }
  return context;
}
```

### Step 5: Create Sandbox Route Guard

```tsx
// src/components/SandboxRoute.tsx
import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSandbox } from '@/contexts/SandboxContext';
import { portal } from '@/lib/portalValidator';

interface SandboxRouteProps {
  children: React.ReactNode;
}

export function SandboxRoute({ children }: SandboxRouteProps) {
  const { user, isLoading } = useAuth();
  const { isInSandbox, enterSandbox } = useSandbox();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  // If authenticated, allow normal access
  if (user) {
    portal.check('^sandbox-route')
      .requires('authenticated user or sandbox mode')
      .context({ isAuthenticated: true, isInSandbox: false })
      .allow('User authenticated - normal access');
    
    return <>{children}</>;
  }

  // If not authenticated and not in sandbox, enter sandbox mode
  if (!isInSandbox) {
    enterSandbox();
  }

  portal.check('^sandbox-route')
    .requires('authenticated user or sandbox mode')
    .context({ isAuthenticated: false, isInSandbox: true })
    .allow('Sandbox mode active - demo access granted');

  return <>{children}</>;
}
```

### Step 6: Update Feature Gating

```tsx
// src/lib/featureGating.ts

// Add window-shopper tier
export type FeatureTier = 'window-shopper' | 'starter' | 'growth' | 'agency';

export const TIER_LEVELS: Record<FeatureTier, number> = {
  'window-shopper': 0,  // Can see everything, save nothing
  'starter': 1,
  'growth': 2,
  'agency': 3,
};

export function hasTierAccess(userTier: FeatureTier, requiredTier: FeatureTier): boolean {
  return TIER_LEVELS[userTier] >= TIER_LEVELS[requiredTier];
}
```

### Step 7: Wrap App with Providers

```tsx
// src/App.tsx
import { SandboxProvider } from '@/contexts/SandboxContext';
import { SubscribeModalProvider } from '@/hooks/useSubscribeModal';

function App() {
  return (
    <AuthProvider>
      <SandboxProvider>
        <SubscribeModalProvider>
          <BrowserRouter>
            <Routes>
              {/* ... routes ... */}
            </Routes>
          </BrowserRouter>
        </SubscribeModalProvider>
      </SandboxProvider>
    </AuthProvider>
  );
}
```

### Step 8: Use Sandbox Route for Protected Pages

```tsx
// src/config/routes.tsx
<Route
  path="/leads"
  element={
    <SandboxRoute>
      <LeadsPage />
    </SandboxRoute>
  }
/>
```

### Step 9: Integrate with Data Hooks

```tsx
// src/hooks/useSandboxLeads.ts
import { useSandbox } from '@/contexts/SandboxContext';
import { useSandboxAction } from '@/hooks/useSandboxAction';
import { useLeads } from '@/hooks/useLeads';

export function useSandboxLeads() {
  const { isInSandbox, localLeads, addLocalLead, updateLocalLead, deleteLocalLead } = useSandbox();
  const { interceptAction } = useSandboxAction();
  const { data: realLeads, ...queryState } = useLeads();

  // Return local leads if in sandbox, real leads otherwise
  const leads = isInSandbox ? localLeads : realLeads;

  const createLead = async (data: LeadInput) => {
    return interceptAction(
      () => api.createLead(data),
      {
        actionName: 'Add a new lead',
        localFallback: () => {
          const newLead = { ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
          addLocalLead(newLead);
          return newLead;
        },
      }
    );
  };

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    return interceptAction(
      () => api.updateLead(id, updates),
      {
        actionName: 'Update lead',
        localFallback: () => {
          updateLocalLead(id, updates);
          return { id, ...updates };
        },
      }
    );
  };

  const deleteLead = async (id: string) => {
    return interceptAction(
      () => api.deleteLead(id),
      {
        actionName: 'Delete lead',
        localFallback: () => {
          deleteLocalLead(id);
          return { id };
        },
      }
    );
  };

  return {
    leads,
    createLead,
    updateLead,
    deleteLead,
    isInSandbox,
    ...queryState,
  };
}
```

### Step 10: Add Sandbox Banner

```tsx
// src/components/SandboxBanner.tsx
import { useSandbox } from '@/contexts/SandboxContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export function SandboxBanner() {
  const { isInSandbox, pendingChanges } = useSandbox();
  const navigate = useNavigate();

  if (!isInSandbox) return null;

  return (
    <div className="bg-primary/10 border-b border-primary/20 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Badge variant="outline">Demo Mode</Badge>
        <span className="text-sm text-muted-foreground">
          Explore freely • Changes are saved locally
        </span>
      </div>

      {pendingChanges > 0 && (
        <Button size="sm" onClick={() => navigate('/select-plan')}>
          Subscribe to save {pendingChanges} changes
        </Button>
      )}
    </div>
  );
}
```

---

## Seed Data (Optional)

Add demo data for sandbox users:

```tsx
// src/lib/seedData.ts
export const SEED_LEADS: Lead[] = [
  {
    id: 'seed-1',
    name: 'Sarah Johnson',
    email: 'sarah@example.com',
    phone: '+1 555-0101',
    source: 'Facebook Lead Ad',
    status: 'new',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'seed-2',
    name: 'Michael Chen',
    email: 'michael@example.com',
    phone: '+1 555-0102',
    source: 'Google Ads',
    status: 'contacted',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  // Add more...
];

// Initialize sandbox with seed data
export function initializeSandbox(addLocalLead: (lead: Lead) => void) {
  SEED_LEADS.forEach(lead => addLocalLead(lead));
}
```

---

## Verification Checklist

After implementation, verify:

- [ ] Unauthenticated users can access protected routes
- [ ] Sandbox mode activates automatically for unauthenticated users
- [ ] Local changes persist in localStorage
- [ ] Subscribe modal shows when performing gated actions
- [ ] Pending changes count displays correctly
- [ ] Sandbox banner shows in demo mode
- [ ] Portal logs show sandbox access
- [ ] Authenticated users bypass sandbox mode

---

## Common Issues

### Sandbox State Lost on Refresh

1. Check localStorage persistence in SandboxContext
2. Verify STORAGE_KEY is consistent
3. Check for stale data clearing logic

### Subscribe Modal Not Showing

1. Verify SubscribeModalProvider wraps the app
2. Check showModal option in interceptAction
3. Ensure useSandboxAction hook is used

### Local Data Not Updating

1. Verify correct sandbox action (add/update/delete)
2. Check state immutability in updates
3. Ensure component re-renders on state change
