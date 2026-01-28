# Portal-Driven E2E Testing Specification

> Paradigm v1.0 - Automated Testing via Portal Validation

Portal-Driven E2E Testing leverages the Portal Validation system to automatically verify authorization flows. Tests are derived from your authorization topology—not written manually—creating a feedback loop where console logs prove what actually happens.

---

## Philosophy

**Tests are derived from your authorization topology, not written manually.**

```
portal.yaml          defines          WHAT should be protected
     │
     ▼
portalValidator      logs             WHAT actually happens
     │
     ▼
Comparison           reveals          SECURITY GAPS
```

This approach provides:

- **No test code for auth** - Portal logs ARE the tests
- **Real browser validation** - Not mocked or simulated
- **Self-documenting** - Logs explain what happened and why
- **Context awareness** - AI understands nuance and edge cases
- **Continuous validation** - Every navigation is a test
- **Coverage tracking** - Know which portals are tested

---

## Architecture

**The AI agent IS the test runner.**

```
┌─────────────────────────────────────────────────────────────────┐
│                    E2E TEST ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐         ┌─────────────────┐                │
│  │   portal.yaml   │         │  scenarios.yaml │                │
│  │  (defines auth) │         │ (test cases)    │                │
│  └────────┬────────┘         └────────┬────────┘                │
│           │                           │                         │
│           ▼                           ▼                         │
│  ┌────────────────────────────────────────────────────────┐     │
│  │         AI Agent (Cursor Browser Tools)                │     │
│  │                                                        │     │
│  │  1. Read scenario configuration                        │     │
│  │  2. Set user state (browser_navigate, browser_type)    │     │
│  │  3. Navigate to target route                           │     │
│  │  4. Read console (browser_console_messages)            │     │
│  │  5. Parse portal check results                         │     │
│  │  6. Compare to expected decision                       │     │
│  └────────────────────────────────────────────────────────┘     │
│           │                                                     │
│           ▼                                                     │
│  ┌────────────────────────────────────────────────────────┐     │
│  │                    Test Report                          │    │
│  │  ┌─────┐ /leads   ^subscription-required  ALLOW        │    │
│  │  │PASS │ /admin   ^admin-only            DENY          │    │
│  │  └─────┘ /settings ^authenticated         ALLOW        │    │
│  │  ┌─────┐ /billing  ^agency-required       Expected:DENY│    │
│  │  │FAIL │           ^agency-required       Actual: ALLOW│    │
│  │  └─────┘                                               │    │
│  └────────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

No Playwright, Cypress, or other test frameworks required.

---

## Test Scenario Format

### YAML Definition

```yaml
# tests/scenarios/auth-flows.yaml

name: Authentication and Authorization Flows
description: Verify all portal checks work correctly

# Test user configurations (referenced by scenarios)
users:
  unauthenticated:
    authenticated: false
    
  starter:
    authenticated: true
    email: test-starter@example.com
    tier: starter
    
  growth:
    authenticated: true
    email: test-growth@example.com
    tier: growth
    
  agency:
    authenticated: true
    email: test-agency@example.com
    tier: agency
    
  admin:
    authenticated: true
    email: test-admin@example.com
    role: admin
    
  super_admin:
    authenticated: true
    email: test-super@example.com
    role: super_admin

# Test scenarios
scenarios:
  # Authentication tests
  - id: unauthenticated-protected-route
    description: Unauthenticated user accessing protected route
    user: unauthenticated
    steps:
      - navigate: /leads
        expect:
          portal: ^authenticated
          decision: DENY
          redirectTo: /login

  - id: unauthenticated-public-route
    description: Unauthenticated user can access public routes
    user: unauthenticated
    steps:
      - navigate: /
        expect:
          portal: ^public-only
          decision: ALLOW
      - navigate: /login
        expect:
          portal: ^public-only
          decision: ALLOW

  # Subscription tier tests
  - id: starter-basic-access
    description: Starter user accessing basic features
    user: starter
    steps:
      - navigate: /leads
        expect:
          portal: ^subscription-required
          decision: ALLOW
      - navigate: /integrations
        expect:
          portal: ^subscription-required
          decision: ALLOW

  - id: starter-agency-denied
    description: Starter user denied agency features
    user: starter
    steps:
      - navigate: /admin/team
        expect:
          portal: ^agency-required
          decision: DENY
          redirectTo: /select-plan

  - id: growth-advanced-access
    description: Growth user accessing advanced features
    user: growth
    steps:
      - navigate: /oracle
        expect:
          portal: ^subscription-required
          decision: ALLOW
      - navigate: /analytics
        expect:
          portal: ^subscription-required
          decision: ALLOW

  - id: agency-full-access
    description: Agency user has full feature access
    user: agency
    steps:
      - navigate: /admin/team
        expect:
          portal: ^agency-required
          decision: ALLOW
      - navigate: /client-accounts
        expect:
          portal: ^agency-required
          decision: ALLOW

  # Admin tests
  - id: regular-user-admin-denied
    description: Regular user cannot access admin routes
    user: starter
    steps:
      - navigate: /admin/settings
        expect:
          portal: ^admin
          decision: DENY

  - id: admin-admin-access
    description: Admin user can access admin routes
    user: admin
    steps:
      - navigate: /admin/settings
        expect:
          portal: ^admin
          decision: ALLOW

  - id: super-admin-full-access
    description: Super admin bypasses all checks
    user: super_admin
    steps:
      - navigate: /admin/server-settings
        expect:
          portal: ^super-admin
          decision: ALLOW
      - navigate: /admin/impersonate
        expect:
          portal: ^super-admin
          decision: ALLOW

  # Multi-gate flows
  - id: authenticated-subscribed-admin
    description: User passing multiple gates
    user: admin
    steps:
      - navigate: /admin/billing
        expect:
          - portal: ^authenticated
            decision: ALLOW
          - portal: ^admin
            decision: ALLOW
```

### TypeScript Definition

```typescript
interface TestScenario {
  id: string;
  description: string;
  user: string | UserConfig;
  steps: TestStep[];
  tags?: string[];
  skip?: boolean;
}

interface TestStep {
  navigate?: string;
  click?: string;       // Selector or text
  type?: { selector: string; text: string };
  wait?: number;        // Milliseconds
  expect: ExpectedResult | ExpectedResult[];
}

interface ExpectedResult {
  portal: string;       // e.g., '^authenticated'
  decision: 'ALLOW' | 'DENY' | 'PENDING';
  reason?: string;      // Optional reason substring match
  redirectTo?: string;  // Expected redirect destination
}

interface UserConfig {
  authenticated: boolean;
  email?: string;
  password?: string;
  tier?: 'starter' | 'growth' | 'agency';
  role?: 'user' | 'admin' | 'super_admin';
}
```

---

## Console Log Parsing

The test runner parses portal check output from the console.

### Visual Format

```
┌─────────────────────────────────────────────────────────
│ 🚪 PORTAL CHECK: ^subscription-required
│ ├─ Requires: active subscription, trial not exceeded
│ ├─ Context: { userId: "abc123", plan: "growth", isTrialing: false }
│ ├─ Decision: ✅ ALLOW
│ └─ Reason: Subscription valid - growth plan active
└─────────────────────────────────────────────────────────
```

### JSON Format (Test Mode)

When `PORTAL_TEST_MODE=true`:

```
[GATE_RESULT] {"gate":"^subscription-required","requires":["active subscription","trial not exceeded"],"context":{"userId":"abc123","plan":"growth"},"decision":"allow","reason":"Subscription valid","timestamp":"2026-01-24T12:00:00.000Z","duration":15}
```

### Parser Implementation

```typescript
interface PortalCheckResult {
  gate: string;
  decision: 'ALLOW' | 'DENY' | 'PENDING';
  reason: string;
  requires?: string[];
  context?: Record<string, unknown>;
  timestamp?: string;
  duration?: number;
}

function parsePortalLogs(logs: string[]): PortalCheckResult[] {
  const results: PortalCheckResult[] = [];
  
  for (const log of logs) {
    // Try JSON format first (test mode)
    if (log.includes('[GATE_RESULT]')) {
      const jsonStr = log.split('[GATE_RESULT]')[1].trim();
      try {
        const parsed = JSON.parse(jsonStr);
        results.push({
          gate: parsed.gate,
          decision: parsed.decision.toUpperCase() as 'ALLOW' | 'DENY' | 'PENDING',
          reason: parsed.reason,
          requires: parsed.requires,
          context: parsed.context,
          timestamp: parsed.timestamp,
          duration: parsed.duration,
        });
        continue;
      } catch {}
    }
    
    // Try visual format
    const gateMatch = log.match(/PORTAL CHECK: (\^[\w-]+)/);
    if (gateMatch) {
      const gate = gateMatch[1];
      
      // Extract decision
      let decision: 'ALLOW' | 'DENY' | 'PENDING' = 'PENDING';
      if (log.includes('✅ ALLOW') || log.includes('Decision: ALLOW')) {
        decision = 'ALLOW';
      } else if (log.includes('❌ DENY') || log.includes('Decision: DENY')) {
        decision = 'DENY';
      }
      
      // Extract reason
      const reasonMatch = log.match(/Reason: (.+)/);
      const reason = reasonMatch?.[1] || '';
      
      // Extract requires
      const requiresMatch = log.match(/Requires: (.+)/);
      const requires = requiresMatch?.[1]?.split(', ') || [];
      
      results.push({ gate, decision, reason, requires });
    }
  }
  
  return results;
}
```

---

## Test Execution

### AI Agent Execution (Cursor Browser) - Primary Method

For AI agents using Cursor's browser tools:

```markdown
## Portal E2E Test Execution Protocol

You have access to:
- browser_navigate: Navigate to URLs
- browser_snapshot: Get page state
- browser_console_messages: Read console output
- browser_type: Enter text into fields
- browser_click: Click elements

### Execution Steps

1. **Read test scenarios** from tests/scenarios/*.yaml

2. **For each scenario**:

   a. **Set up user state**:
      - If `authenticated: false`: Navigate to /logout, confirm logged out
      - If `authenticated: true`: Navigate to /login, enter credentials, submit
   
   b. **Execute each step**:
      - Navigate to specified route
      - Wait for page load
      - Read console messages
   
   c. **Parse portal results**:
      - Find lines containing "🚪 PORTAL CHECK:" or "[GATE_RESULT]"
      - Extract gate name, decision, reason
   
   d. **Compare to expected**:
      - Match portal name to expected
      - Compare decision (ALLOW/DENY)
      - Record pass/fail

3. **Generate report**:

| Scenario | Step | Portal | Expected | Actual | Status |
|----------|------|--------|----------|--------|--------|
| starter-basic | /leads | ^subscription | ALLOW | ALLOW | ✅ |
| starter-admin | /admin | ^admin | DENY | DENY | ✅ |
| growth-agency | /team | ^agency | DENY | ALLOW | ❌ |

### Example Execution

**Scenario: starter-accessing-agency-feature**

1. Login as starter user:
   - Navigate to /login
   - Type test-starter@example.com in email field
   - Type password in password field
   - Click login button
   - Wait for redirect

2. Navigate to /admin/team:
   - browser_navigate("/admin/team")
   - browser_console_messages()
   - Look for: "🚪 PORTAL CHECK: ^agency-required"
   - Found: "Decision: ❌ DENY"
   - Expected: DENY
   - Result: ✅ PASS

3. Navigate to /leads:
   - browser_navigate("/leads")
   - browser_console_messages()
   - Look for: "🚪 PORTAL CHECK: ^subscription-required"
   - Found: "Decision: ✅ ALLOW"
   - Expected: ALLOW
   - Result: ✅ PASS
```

---

## Coverage Reporting

Track which portals have test coverage:

```typescript
interface CoverageReport {
  portals: {
    name: string;
    definedIn: string;     // portal.yaml location
    testedIn: string[];    // Scenario IDs that test this portal
    coverageType: 'allow' | 'deny' | 'both' | 'none';
  }[];
  summary: {
    total: number;
    tested: number;
    untested: number;
    coverage: number;      // Percentage
  };
}

function generateCoverageReport(
  portalYaml: PortalConfig,
  scenarios: TestScenario[]
): CoverageReport {
  const portals = [];
  
  for (const portal of portalYaml.portals) {
    const testedBy = scenarios.filter(s => 
      s.steps.some(step => {
        const expects = Array.isArray(step.expect) ? step.expect : [step.expect];
        return expects.some(e => e.portal === `^${portal.id}`);
      })
    );
    
    const hasAllowTest = testedBy.some(s => 
      s.steps.some(step => {
        const expects = Array.isArray(step.expect) ? step.expect : [step.expect];
        return expects.some(e => e.portal === `^${portal.id}` && e.decision === 'ALLOW');
      })
    );
    
    const hasDenyTest = testedBy.some(s =>
      s.steps.some(step => {
        const expects = Array.isArray(step.expect) ? step.expect : [step.expect];
        return expects.some(e => e.portal === `^${portal.id}` && e.decision === 'DENY');
      })
    );
    
    portals.push({
      name: `^${portal.id}`,
      definedIn: 'portal.yaml',
      testedIn: testedBy.map(s => s.id),
      coverageType: hasAllowTest && hasDenyTest ? 'both' 
        : hasAllowTest ? 'allow'
        : hasDenyTest ? 'deny'
        : 'none',
    });
  }
  
  const tested = portals.filter(p => p.coverageType !== 'none').length;
  
  return {
    portals,
    summary: {
      total: portals.length,
      tested,
      untested: portals.length - tested,
      coverage: (tested / portals.length) * 100,
    },
  };
}
```

---

## Validation Protocol

### Complete AI Agent Session

Here's a complete example of an AI agent validating portal scenarios:

```markdown
User: Validate the authentication portal scenarios from tests/portal-e2e/scenarios/auth-flows.yaml

Agent: I'll validate the authentication portal checks.

## Session: Portal E2E Validation

### Scenario 1: unauthenticated-protected-route
**Description**: Unauthenticated user accessing protected route

1. **Ensuring logged out state**
   [browser_navigate("/logout")]
   ✓ Logged out

2. **Navigating to /leads**
   [browser_navigate("/leads")]

3. **Reading console logs**
   [browser_console_messages()]
   
   Found portal check:
   ```
   🚪 PORTAL CHECK: ^authenticated
   ├─ Decision: ❌ DENY
   └─ Reason: No active session - redirecting to login
   ```

4. **Validating redirect**
   Current URL: /login
   Expected redirect: /login ✓

**Result**: ✅ PASS - Expected DENY, got DENY

---

### Scenario 2: starter-basic-access
**Description**: Starter user accessing basic features

1. **Logging in as starter user**
   [browser_navigate("/login")]
   [browser_type email: "test-starter@example.com"]
   [browser_type password: "********"]
   [browser_click "Sign In"]
   ✓ Logged in

2. **Navigating to /leads**
   [browser_navigate("/leads")]

3. **Reading console logs**
   [browser_console_messages()]
   
   Found portal check:
   ```
   🚪 PORTAL CHECK: ^subscription-required
   ├─ Decision: ✅ ALLOW
   └─ Reason: Subscription valid - starter plan active
   ```

**Result**: ✅ PASS - Expected ALLOW, got ALLOW

---

## Summary

| Scenario | Portal | Expected | Actual | Status |
|----------|--------|----------|--------|--------|
| unauthenticated-protected-route | ^authenticated | DENY | DENY | ✅ |
| starter-basic-access | ^subscription-required | ALLOW | ALLOW | ✅ |
| starter-agency-denied | ^agency-required | DENY | DENY | ✅ |

**Total**: 3/3 passed (100%)
```

### Triggering Validation

Simply ask the AI agent:

```
Validate portal checks using tests/portal-e2e/scenarios/auth-flows.yaml
```

Or for specific portals:

```
Test the ^subscription-required portal with starter and growth users
```

Or for comprehensive validation:

```
Run complete portal E2E validation and generate coverage report
```

---

## Best Practices

### 1. Scenario Organization

- Group related scenarios by feature area
- Use descriptive IDs and descriptions
- Tag scenarios for selective execution

### 2. User Configuration

- Create test users for each tier/role combination
- Use environment variables for credentials
- Reset user state between scenarios

### 3. Assertions

- Always specify both ALLOW and DENY scenarios
- Check redirects for DENY decisions
- Verify reason strings for debugging

### 4. Maintenance

- Update scenarios when adding new portals
- Run coverage report regularly
- Archive old scenarios, don't delete

### 5. Performance

- Run scenarios in parallel when possible
- Use test isolation (separate browser contexts)
- Cache auth tokens for faster setup

---

## Integration with Paradigm

### Portal Validation System

This spec extends the Portal Validation system (`specs/portal-validation.md`):

- Portal Validation defines the console output format
- E2E Testing consumes that output for validation
- Both systems use the `^portal` symbol

### Logging

Use Paradigm logger for test execution:

```typescript
import { log } from '@/lib/paradigmLogger';

log.flow('$portal-e2e').info('Running scenario', { 
  id: scenario.id,
  user: scenario.user,
});

log.signal('!test-passed').info('Scenario passed', {
  id: scenario.id,
  duration: elapsed,
});

log.signal('!test-failed').error('Scenario failed', {
  id: scenario.id,
  step: failedStep,
  error: validationError,
});
```

---

---

## Platform Considerations

### Web Applications (Primary Target)

This specification is **designed for web applications** where:

- Browser console is accessible for log parsing
- Playwright/Puppeteer can automate browser interactions
- AI agents can use Cursor browser tools
- Console output is styled and readable

### Mobile Applications

Mobile E2E testing requires **different approaches**:

| Aspect | Web | Mobile |
|--------|-----|--------|
| **Console Access** | Browser DevTools | Logcat (Android), os_log (iOS) |
| **Test Runners** | Playwright, Cypress | Detox, Appium, XCTest, Espresso |
| **Log Parsing** | `browser_console_messages()` | Device log streaming |
| **Portal Output** | Styled console blocks | Plain text or structured JSON |
| **AI Integration** | Cursor browser tools | Limited - requires device bridges |

#### Mobile Testing Adaptations

**1. Use JSON-only output format:**
```typescript
// Mobile portal validator should emit JSON only
portal.check('^authenticated')
  .context({ userId })
  .allow('Session valid');
// Output: {"gate":"^authenticated","decision":"allow","reason":"Session valid"}
```

**2. Stream device logs:**
```bash
# Android - stream Logcat
adb logcat -s "PORTAL" | grep "GATE_RESULT"

# iOS - stream os_log
log stream --predicate 'subsystem == "com.app.portal"'
```

**3. Use platform-specific test runners:**

```typescript
// Detox (React Native)
describe('Portal Validation', () => {
  it('denies unauthenticated access', async () => {
    await device.launchApp({ newInstance: true });
    await element(by.id('protected-screen')).tap();
    
    // Check logs via device log streaming
    const logs = await getDeviceLogs();
    expect(logs).toContain('"gate":"^authenticated","decision":"deny"');
  });
});
```

```swift
// XCTest (iOS)
func testAuthenticationPortal() {
    let app = XCUIApplication()
    app.launch()
    
    // Tap protected screen
    app.buttons["protectedScreen"].tap()
    
    // Verify redirect to login
    XCTAssertTrue(app.staticTexts["Login"].exists)
}
```

**4. Consider native testing frameworks:**

| Platform | Framework | Log Access |
|----------|-----------|------------|
| React Native | Detox | Metro bundler logs |
| Flutter | integration_test | `debugPrint()` output |
| iOS Native | XCTest | os_log / Console.app |
| Android Native | Espresso | Logcat |

### Hybrid Apps

Hybrid apps (Capacitor, Cordova) can use **web testing with remote debugging**:

```typescript
// Enable remote debugging in Capacitor
await Browser.open({
  url: 'http://localhost:5173',
  windowName: '_self',
});

// Use Chrome DevTools Protocol for log access
const client = await CDP({ port: 9222 });
const { Log } = client;
await Log.enable();
Log.entryAdded(({ entry }) => {
  if (entry.text.includes('PORTAL CHECK')) {
    // Parse portal result
  }
});
```

### Recommended Mobile Approach

1. **Emit JSON-only logs** - No styled console output
2. **Use native test runners** - Detox, Appium, XCTest, Espresso
3. **Stream device logs** - Parse from native logging systems
4. **Simplify assertions** - Check navigation state, not console output
5. **Consider screenshot comparison** - Visual regression for access denied states

### AI Agent Limitations on Mobile

Current AI agents (including Cursor) have **limited mobile testing capabilities**:

- ❌ Cannot directly interact with mobile simulators/emulators
- ❌ Cannot read native device logs in real-time
- ⚠️ Can review test code and suggest scenarios
- ⚠️ Can analyze log files if provided
- ✅ Can generate test scenarios from portal.yaml
- ✅ Can validate test results from reports

For mobile testing, use AI agents for:
- Test scenario generation
- Code review of test implementations
- Analysis of test reports and logs (post-execution)

---

## Changelog

| Version | Changes |
|---------|---------|
| 1.0 | Initial specification |
| 1.1 | Added platform considerations for mobile |
