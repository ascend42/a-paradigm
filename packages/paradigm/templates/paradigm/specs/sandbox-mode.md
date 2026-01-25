# Sandbox Mode Pattern Specification

> Paradigm v1.0 - Freemium "Try Before You Buy" Architecture

The Sandbox Mode Pattern allows unauthenticated users ("window shoppers") to explore the full application UI, make local in-memory changes, and experience the value proposition before subscribing. Actions that would persist data trigger a subscribe modal instead.

---

## Philosophy

**Let users experience value before asking them to pay.**

Traditional approaches:
- 🚫 Lock everything behind auth → Users can't see value
- 🚫 Limited free tier → Feels like a demo
- 🚫 Time-limited trial → Creates pressure, not value

Sandbox Mode approach:
- ✅ Full UI access immediately
- ✅ Local edits feel real
- ✅ Conversion happens naturally when they try to save
- ✅ Pending changes create investment

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      SANDBOX MODE FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Window Shopper                 Authenticated User             │
│        │                               │                        │
│        ▼                               ▼                        │
│   ┌─────────┐                    ┌─────────┐                    │
│   │ Sandbox │                    │  Real   │                    │
│   │ Context │                    │   DB    │                    │
│   │ (Memory)│                    │         │                    │
│   └────┬────┘                    └────┬────┘                    │
│        │                              │                         │
│        └──────────────┬───────────────┘                         │
│                       │                                         │
│                       ▼                                         │
│        ┌─────────────────────────────────────┐                  │
│        │        Action Interceptor           │                  │
│        │                                     │                  │
│        │  if (isInSandbox) {                 │                  │
│        │    localFallback();                 │                  │
│        │    showSubscribeModal();            │                  │
│        │  } else {                           │                  │
│        │    realApiCall();                   │                  │
│        │  }                                  │                  │
│        └─────────────────────────────────────┘                  │
│                       │                                         │
│                       ▼                                         │
│        ┌─────────────────────────────────────┐                  │
│        │       Subscribe Modal               │                  │
│        │                                     │                  │
│        │  "You tried to [action]"            │                  │
│        │  "You have [N] pending changes"     │                  │
│        │                                     │                  │
│        │  [Subscribe] [Continue Exploring]   │                  │
│        └─────────────────────────────────────┘                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Sandbox Context

Central state management for local, in-memory data:

```typescript
interface SandboxState {
  // Is user currently in sandbox mode?
  isInSandbox: boolean;
  
  // Local data storage (mirrors real data structures)
  localLeads: Lead[];
  localIntegrations: Integration[];
  localSettings: Record<string, unknown>;
  
  // Pending changes counter
  pendingChanges: number;
  
  // Last attempted action (for modal context)
  lastAttemptedAction?: {
    type: string;
    description: string;
    timestamp: number;
  };
}

interface SandboxActions {
  // Enter/exit sandbox mode
  enterSandbox: () => void;
  exitSandbox: () => void;
  
  // Local data manipulation
  addLocalLead: (lead: Lead) => void;
  updateLocalLead: (id: string, updates: Partial<Lead>) => void;
  deleteLocalLead: (id: string) => void;
  
  addLocalIntegration: (integration: Integration) => void;
  removeLocalIntegration: (id: string) => void;
  
  updateLocalSettings: (key: string, value: unknown) => void;
  
  // Clear all local data
  clearSandbox: () => void;
  
  // Record attempted action
  recordAttemptedAction: (type: string, description: string) => void;
}
```

### React Context Implementation

```tsx
import React, { createContext, useContext, useState, useCallback } from 'react';

const SandboxContext = createContext<SandboxState & SandboxActions | null>(null);

export function SandboxProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SandboxState>({
    isInSandbox: false,
    localLeads: [],
    localIntegrations: [],
    localSettings: {},
    pendingChanges: 0,
    lastAttemptedAction: undefined,
  });
  
  const enterSandbox = useCallback(() => {
    setState(s => ({ ...s, isInSandbox: true }));
  }, []);
  
  const exitSandbox = useCallback(() => {
    setState(s => ({ ...s, isInSandbox: false }));
  }, []);
  
  const addLocalLead = useCallback((lead: Lead) => {
    setState(s => ({
      ...s,
      localLeads: [...s.localLeads, lead],
      pendingChanges: s.pendingChanges + 1,
    }));
  }, []);
  
  // ... other actions
  
  const clearSandbox = useCallback(() => {
    setState({
      isInSandbox: false,
      localLeads: [],
      localIntegrations: [],
      localSettings: {},
      pendingChanges: 0,
      lastAttemptedAction: undefined,
    });
  }, []);
  
  return (
    <SandboxContext.Provider value={{ ...state, enterSandbox, exitSandbox, addLocalLead, clearSandbox }}>
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

---

### 2. Action Interceptor

Wraps API calls to intercept them in sandbox mode:

```typescript
interface InterceptOptions<T> {
  // Human-readable description of the action
  actionName: string;
  
  // Function to execute locally instead of API call
  localFallback: () => T;
  
  // Whether to show subscribe modal on intercept
  showModal?: boolean;
  
  // Skip intercept for this action (e.g., read-only)
  bypass?: boolean;
}

function useSandboxAction() {
  const { isInSandbox, recordAttemptedAction } = useSandbox();
  const { openSubscribeModal } = useSubscribeModal();
  
  async function interceptAction<T>(
    apiCall: () => Promise<T>,
    options: InterceptOptions<T>
  ): Promise<T> {
    // Bypass if not in sandbox or explicitly bypassed
    if (!isInSandbox || options.bypass) {
      return apiCall();
    }
    
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
  }
  
  return { interceptAction, isInSandbox };
}
```

### Usage Example

```tsx
function LeadManager() {
  const { interceptAction, isInSandbox } = useSandboxAction();
  const { addLocalLead, localLeads } = useSandbox();
  const { data: realLeads, mutate } = useLeads();
  
  // Show local leads if in sandbox, otherwise real leads
  const leads = isInSandbox ? localLeads : realLeads;
  
  async function handleAddLead(data: LeadInput) {
    await interceptAction(
      () => api.createLead(data),  // Real API call
      {
        actionName: 'Add a new lead',
        localFallback: () => {
          const localLead = { ...data, id: crypto.randomUUID() };
          addLocalLead(localLead);
          return localLead;
        },
      }
    );
  }
  
  return (
    <div>
      <Button onClick={() => handleAddLead(formData)}>
        Add Lead
      </Button>
      <LeadList leads={leads} />
    </div>
  );
}
```

---

### 3. Subscribe Modal

Shows when user attempts a gated action:

```tsx
interface SubscribeModalProps {
  trigger: string;           // What action triggered this
  message: string;           // Custom message
  pendingChanges: number;    // Number of local changes
}

function SubscribeModal({ trigger, message, pendingChanges }: SubscribeModalProps) {
  const navigate = useNavigate();
  
  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subscribe to Continue</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <p className="text-muted-foreground">
            You tried to <strong>{trigger}</strong>.
          </p>
          
          <p>{message}</p>
          
          {pendingChanges > 0 && (
            <div className="bg-primary/10 p-3 rounded-md">
              <p className="text-sm">
                You have <strong>{pendingChanges}</strong> pending changes 
                that will be saved when you subscribe.
              </p>
            </div>
          )}
          
          <div className="flex gap-3">
            <Button 
              onClick={() => navigate('/select-plan')}
              className="flex-1"
            >
              View Plans
            </Button>
            <Button 
              variant="outline" 
              onClick={close}
              className="flex-1"
            >
              Continue Exploring
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

### 4. Sandbox Route

Route guard that allows sandbox access to protected routes:

```tsx
interface SandboxRouteProps {
  children: React.ReactNode;
  requiredTier?: FeatureTier;
}

function SandboxRoute({ children, requiredTier = 'starter' }: SandboxRouteProps) {
  const { user, isLoading } = useAuth();
  const { isInSandbox, enterSandbox } = useSandbox();
  
  // If authenticated with proper tier, allow access normally
  if (user && hasTierAccess(user.tier, requiredTier)) {
    return <>{children}</>;
  }
  
  // If not authenticated or insufficient tier, enter sandbox mode
  if (!isInSandbox) {
    enterSandbox();
  }
  
  // Log portal check
  portal.check('^sandbox-access')
    .requires('authenticated user or sandbox mode')
    .context({ isAuthenticated: !!user, isInSandbox: true })
    .allow('Sandbox mode active - viewing in demo mode');
  
  // Allow access in sandbox mode
  return <>{children}</>;
}
```

---

## Feature Gating

### Tier Levels

```typescript
type FeatureTier = 'window-shopper' | 'starter' | 'growth' | 'agency';

const TIER_LEVELS: Record<FeatureTier, number> = {
  'window-shopper': 0,  // Can see everything, save nothing
  'starter': 1,
  'growth': 2,
  'agency': 3,
};

function hasTierAccess(userTier: FeatureTier, requiredTier: FeatureTier): boolean {
  return TIER_LEVELS[userTier] >= TIER_LEVELS[requiredTier];
}
```

### Feature Requirements

```typescript
const FEATURE_REQUIREMENTS: Record<string, FeatureTier> = {
  // Basic features - Starter
  'lead-management': 'starter',
  'basic-integrations': 'starter',
  'email-support': 'starter',
  
  // Advanced features - Growth
  'advanced-analytics': 'growth',
  'automation-rules': 'growth',
  'priority-support': 'growth',
  
  // Premium features - Agency
  'team-management': 'agency',
  'client-accounts': 'agency',
  'white-label': 'agency',
  'api-access': 'agency',
};
```

### Gated Feature Component

```tsx
interface GatedFeatureProps {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

function GatedFeature({ feature, children, fallback }: GatedFeatureProps) {
  const { tier, isInSandbox } = useUserContext();
  const requiredTier = FEATURE_REQUIREMENTS[feature];
  
  // In sandbox mode, show the feature but with visual indicator
  if (isInSandbox) {
    return (
      <div className="relative">
        {children}
        <Badge 
          className="absolute top-0 right-0 -mt-2 -mr-2"
          variant="secondary"
        >
          Pro
        </Badge>
      </div>
    );
  }
  
  // Check tier access
  if (!hasTierAccess(tier, requiredTier)) {
    if (fallback) {
      return <>{fallback}</>;
    }
    
    return (
      <Tooltip content={`Requires ${requiredTier} plan`}>
        <div className="opacity-50 cursor-not-allowed">
          {children}
        </div>
      </Tooltip>
    );
  }
  
  return <>{children}</>;
}
```

---

## Seed Data

Provide meaningful demo data for sandbox users:

```typescript
const SEED_LEADS: Lead[] = [
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
  // ... more seed data
];

const SEED_INTEGRATIONS: Integration[] = [
  {
    id: 'seed-fb',
    platform: 'facebook',
    name: 'Facebook Ads (Demo)',
    status: 'connected',
    isDemo: true,
  },
  // ... more seed integrations
];

function initializeSandbox(sandbox: SandboxActions) {
  SEED_LEADS.forEach(lead => sandbox.addLocalLead(lead));
  SEED_INTEGRATIONS.forEach(int => sandbox.addLocalIntegration(int));
}
```

---

## LocalStorage Persistence

Persist sandbox state for returning visitors:

```typescript
const SANDBOX_STORAGE_KEY = 'sandbox_state';

function loadSandboxState(): SandboxState | null {
  try {
    const stored = localStorage.getItem(SANDBOX_STORAGE_KEY);
    if (!stored) return null;
    
    const parsed = JSON.parse(stored);
    
    // Check if data is stale (older than 7 days)
    if (Date.now() - parsed.savedAt > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(SANDBOX_STORAGE_KEY);
      return null;
    }
    
    return parsed.state;
  } catch {
    return null;
  }
}

function saveSandboxState(state: SandboxState) {
  localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify({
    state,
    savedAt: Date.now(),
  }));
}

function clearSandboxStorage() {
  localStorage.removeItem(SANDBOX_STORAGE_KEY);
}
```

---

## Integration Patterns

### With React Query

```typescript
function useLeadsWithSandbox() {
  const { isInSandbox, localLeads, addLocalLead } = useSandbox();
  
  // Real data query
  const { data: realLeads, ...queryState } = useQuery({
    queryKey: ['leads'],
    queryFn: api.getLeads,
    enabled: !isInSandbox,  // Don't fetch in sandbox
  });
  
  // Mutations with sandbox handling
  const createMutation = useMutation({
    mutationFn: async (data: LeadInput) => {
      if (isInSandbox) {
        const localLead = { ...data, id: crypto.randomUUID() };
        addLocalLead(localLead);
        return localLead;
      }
      return api.createLead(data);
    },
  });
  
  return {
    leads: isInSandbox ? localLeads : realLeads,
    create: createMutation.mutate,
    ...queryState,
  };
}
```

### With Zustand

```typescript
interface LeadStore {
  leads: Lead[];
  isInSandbox: boolean;
  
  addLead: (lead: LeadInput) => Promise<Lead>;
  fetchLeads: () => Promise<void>;
}

const useLeadStore = create<LeadStore>((set, get) => ({
  leads: [],
  isInSandbox: false,
  
  addLead: async (data) => {
    if (get().isInSandbox) {
      const localLead = { ...data, id: crypto.randomUUID() };
      set(s => ({ leads: [...s.leads, localLead] }));
      return localLead;
    }
    
    const lead = await api.createLead(data);
    set(s => ({ leads: [...s.leads, lead] }));
    return lead;
  },
  
  fetchLeads: async () => {
    if (get().isInSandbox) return;
    
    const leads = await api.getLeads();
    set({ leads });
  },
}));
```

---

## Visual Indicators

### Sandbox Banner

```tsx
function SandboxBanner() {
  const { isInSandbox, pendingChanges } = useSandbox();
  
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
        <Button size="sm" variant="default">
          Subscribe to save {pendingChanges} changes
        </Button>
      )}
    </div>
  );
}
```

### Demo Data Badge

```tsx
function DemoDataIndicator({ isDemo }: { isDemo: boolean }) {
  if (!isDemo) return null;
  
  return (
    <Badge variant="secondary" className="text-xs">
      Demo
    </Badge>
  );
}
```

---

## Conversion Flow

### When User Subscribes

```typescript
async function handleSubscription(userId: string, plan: string) {
  const sandbox = getSandboxState();
  
  // 1. Create subscription
  await stripe.createSubscription(userId, plan);
  
  // 2. Migrate sandbox data to real database
  if (sandbox.localLeads.length > 0) {
    await api.bulkCreateLeads(sandbox.localLeads);
  }
  
  if (sandbox.localIntegrations.length > 0) {
    // Note: Integrations need real OAuth - just record intent
    await api.recordIntegrationIntent(sandbox.localIntegrations);
  }
  
  if (Object.keys(sandbox.localSettings).length > 0) {
    await api.updateSettings(sandbox.localSettings);
  }
  
  // 3. Clear sandbox
  clearSandboxStorage();
  
  // 4. Redirect to onboarding or dashboard
  navigate('/welcome');
}
```

---

## Analytics

Track sandbox engagement:

```typescript
// When user enters sandbox
log.flow('$sandbox').info('User entered sandbox mode', {
  source: referrer,
  hasAccountAlready: !!existingAccount,
});

// When user makes changes
log.state('%sandbox.pendingChanges').info('Sandbox change made', {
  changeType: 'lead-created',
  totalPending: pendingChanges,
});

// When subscribe modal is shown
log.signal('!subscribe-modal-shown').info('Subscribe modal triggered', {
  trigger: attemptedAction,
  pendingChanges,
  timeInSandbox: Date.now() - sandboxStartTime,
});

// When user converts
log.signal('!sandbox-conversion').info('User converted from sandbox', {
  pendingChanges,
  timeInSandbox,
  plan: selectedPlan,
});

// When user leaves without converting
log.signal('!sandbox-abandoned').info('User left sandbox', {
  pendingChanges,
  timeInSandbox,
  lastAction: lastAttemptedAction,
});
```

---

## Best Practices

### 1. Make Demo Data Realistic

- Use believable names and data
- Show variety (different statuses, sources, dates)
- Include both success and edge cases

### 2. Timing for Subscribe Modal

- Don't show immediately on first action
- Let user experience 2-3 successful local changes
- Show after high-value actions (not trivial ones)

### 3. Clear Communication

- Always indicate demo/sandbox mode visually
- Explain that changes are local
- Show pending changes count prominently

### 4. Preserve Investment

- Persist sandbox state to localStorage
- Show pending changes in subscribe modal
- Promise to migrate data on subscription

### 5. Easy Exit

- Don't trap users in sandbox mode
- Provide clear path to login/subscribe
- Allow dismissing subscribe modal gracefully

---

## Integration with Paradigm

### Portal Logging

```typescript
// Sandbox access portal
portal.check('^sandbox-access')
  .requires('authenticated user or sandbox mode active')
  .context({ isAuthenticated, isInSandbox })
  .allow('Sandbox mode - demo access granted');

// Feature gate in sandbox
portal.check('^feature-access')
  .requires('subscription tier or sandbox mode')
  .context({ tier: 'window-shopper', feature: 'lead-management' })
  .allow('Feature visible in sandbox - actions intercepted');
```

### FTUX Integration

Sandbox users can have their own FTUX journey:

```typescript
const sandboxJourney: Journey = {
  journeyId: 'window-shopper',
  name: 'Explore Deal Oracle',
  trigger: {
    isWindowShopper: true,
    notCompleted: true,
  },
  steps: [
    { eventId: 'welcome-sandbox', required: true },
    { eventId: 'try-add-lead', required: true },
    { eventId: 'explore-integrations', required: false },
    { eventId: 'view-analytics', required: false },
    { eventId: 'ready-to-subscribe', required: false },
  ],
};
```

---

---

## Platform Considerations

### Web Applications (Primary Target)

This specification is **designed for web applications** with:

- React Context API or similar state management
- localStorage for persistence
- Browser-based modals and UI
- CSS transitions for visual feedback

### Mobile Applications

Mobile implementations require **platform-specific adaptations**:

| Feature | Web | Mobile |
|---------|-----|--------|
| **State Management** | React Context | React Context (RN), Provider (Flutter), ObservableObject (Swift) |
| **Local Storage** | localStorage | AsyncStorage, SharedPreferences, UserDefaults |
| **Modal Presentation** | Dialog component | Native modal, bottom sheet |
| **Visual Feedback** | CSS transitions | Native animations |
| **Deep Linking** | React Router | React Navigation, Navigator 2.0, UIKit |

#### React Native Implementation

```tsx
// SandboxContext with AsyncStorage
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@sandbox_state';

export function SandboxProvider({ children }) {
  const [state, setState] = useState<SandboxState>(initialState);

  // Load from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(stored => {
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Date.now() - parsed.savedAt < 7 * 24 * 60 * 60 * 1000) {
          setState(parsed.state);
        }
      }
    });
  }, []);

  // Persist to AsyncStorage
  useEffect(() => {
    if (state.isInSandbox || state.pendingChanges > 0) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
        state,
        savedAt: Date.now(),
      }));
    }
  }, [state]);

  // ... rest of implementation
}

// Subscribe Modal as bottom sheet
import { BottomSheetModal } from '@gorhom/bottom-sheet';

function SubscribeModal({ trigger, message }) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  
  return (
    <BottomSheetModal ref={bottomSheetRef} snapPoints={['50%']}>
      <View style={styles.content}>
        <Text>You tried to {trigger}</Text>
        <Text>{message}</Text>
        <Button title="View Plans" onPress={navigateToPlans} />
        <Button title="Continue Exploring" onPress={dismiss} />
      </View>
    </BottomSheetModal>
  );
}
```

#### Flutter Implementation

```dart
// SandboxProvider with SharedPreferences
class SandboxProvider extends ChangeNotifier {
  SandboxState _state = SandboxState();
  static const _storageKey = 'sandbox_state';

  SandboxProvider() {
    _loadState();
  }

  Future<void> _loadState() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_storageKey);
    if (stored != null) {
      final parsed = jsonDecode(stored);
      if (DateTime.now().millisecondsSinceEpoch - parsed['savedAt'] < 
          7 * 24 * 60 * 60 * 1000) {
        _state = SandboxState.fromJson(parsed['state']);
        notifyListeners();
      }
    }
  }

  Future<void> _saveState() async {
    if (_state.isInSandbox || _state.pendingChanges > 0) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_storageKey, jsonEncode({
        'state': _state.toJson(),
        'savedAt': DateTime.now().millisecondsSinceEpoch,
      }));
    }
  }
}

// Subscribe Modal as bottom sheet
void showSubscribeModal(BuildContext context, String trigger, String message) {
  showModalBottomSheet(
    context: context,
    builder: (context) => SubscribeModalContent(
      trigger: trigger,
      message: message,
    ),
  );
}
```

### iOS Native (SwiftUI)

```swift
// SandboxManager with UserDefaults
class SandboxManager: ObservableObject {
    @Published var state = SandboxState()
    private let storageKey = "sandbox_state"
    
    init() {
        loadState()
    }
    
    private func loadState() {
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let stored = try? JSONDecoder().decode(StoredState.self, from: data),
           Date().timeIntervalSince1970 - stored.savedAt < 7 * 24 * 60 * 60 {
            state = stored.state
        }
    }
    
    func saveState() {
        let stored = StoredState(state: state, savedAt: Date().timeIntervalSince1970)
        if let data = try? JSONEncoder().encode(stored) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }
}

// Subscribe sheet
struct SubscribeSheet: View {
    let trigger: String
    let message: String
    @Environment(\.dismiss) var dismiss
    
    var body: some View {
        VStack(spacing: 16) {
            Text("You tried to \(trigger)")
                .font(.headline)
            Text(message)
                .foregroundColor(.secondary)
            Button("View Plans") { /* navigate */ }
                .buttonStyle(.borderedProminent)
            Button("Continue Exploring") { dismiss() }
                .buttonStyle(.bordered)
        }
        .padding()
    }
}
```

### Key Mobile Differences

1. **Storage APIs**
   - Web: `localStorage` (sync)
   - Mobile: AsyncStorage, SharedPreferences, UserDefaults (async)

2. **Modal Presentation**
   - Web: Portal/Dialog overlays
   - Mobile: Native modals, bottom sheets, action sheets

3. **Navigation**
   - Web: URL-based routing
   - Mobile: Stack-based navigation, deep links

4. **Offline Support**
   - Mobile apps often need robust offline handling
   - Consider syncing sandbox data when online

5. **App Store Considerations**
   - iOS: In-app purchases must use StoreKit
   - Android: Google Play Billing for subscriptions
   - Sandbox mode must redirect to platform-specific purchase flows

### Cross-Platform Strategy

For apps targeting both web and mobile:

1. **Share business logic** - Condition evaluation, tier checking
2. **Platform-specific UI** - Modal components, animations
3. **Platform-specific storage** - Adapters for localStorage vs AsyncStorage
4. **Unified API** - Same methods (`enterSandbox`, `addLocalLead`, etc.)

```typescript
// Storage adapter interface
interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// Web implementation
const webStorage: StorageAdapter = {
  getItem: async (key) => localStorage.getItem(key),
  setItem: async (key, value) => localStorage.setItem(key, value),
  removeItem: async (key) => localStorage.removeItem(key),
};

// React Native implementation
const rnStorage: StorageAdapter = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};
```

---

## Changelog

| Version | Changes |
|---------|---------|
| 1.0 | Initial specification |
| 1.1 | Added platform considerations for mobile |
