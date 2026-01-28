# @a-company/portal-e2e

Portal validation utilities for AI-agent driven E2E testing. This package provides parsing and reporting tools for validating authorization flows via console output.

## Philosophy

**The AI agent IS the test runner.**

Instead of traditional test frameworks, portal validation works by:
1. AI agent navigates to routes using Cursor browser tools
2. Portal checks emit structured console output
3. AI agent reads and parses console logs
4. Validation compares expected vs actual decisions

No Playwright, Cypress, or other frameworks needed.

## Installation

```bash
npm install @a-company/portal-e2e
# or
pnpm add @a-company/portal-e2e
```

## Usage

### Parsing Portal Logs

```typescript
import { parsePortalLogs, findPortalCheck } from '@a-company/portal-e2e';

// Parse all portal checks from console output
const consoleLogs = [
  '🚪 PORTAL CHECK: ^authenticated',
  '├─ Decision: ✅ ALLOW',
  '└─ Reason: Session valid',
];

const results = parsePortalLogs(consoleLogs);
// [{ gate: '^authenticated', decision: 'ALLOW', reason: 'Session valid' }]

// Find specific portal check
const authCheck = findPortalCheck(consoleLogs, '^authenticated');
// { gate: '^authenticated', decision: 'ALLOW', reason: 'Session valid' }
```

### Generating Reports

```typescript
import { generateMarkdownReport, generateCoverageReport } from '@a-company/portal-e2e';

// Generate markdown report from validation results
const report = {
  timestamp: new Date().toISOString(),
  environment: 'http://localhost:5173',
  results: [...],
  summary: { total: 10, passed: 9, failed: 1, skipped: 0 },
};

const markdown = generateMarkdownReport(report);
console.log(markdown);

// Generate coverage report
const coverage = generateCoverageReport(scenarios, [
  '^authenticated',
  '^subscription-required',
  '^admin',
]);
```

## Console Output Formats

### Visual Format (Human + AI Readable)

```
┌─────────────────────────────────────────────────────────
│ 🚪 PORTAL CHECK: ^subscription-required
│ ├─ Requires: active subscription
│ ├─ Context: { userId: "abc", plan: "growth" }
│ ├─ Decision: ✅ ALLOW
│ └─ Reason: Subscription valid
└─────────────────────────────────────────────────────────
```

### JSON Format (Test Mode)

When `PORTAL_TEST_MODE=true`:

```
[GATE_RESULT] {"gate":"^authenticated","decision":"allow","reason":"Session valid"}
```

## AI Agent Validation Protocol

### Using Cursor Browser Tools

```markdown
1. Navigate to route:
   browser_navigate("/leads")

2. Read console:
   browser_console_messages()

3. Parse portal checks:
   Look for "🚪 PORTAL CHECK:" or "[GATE_RESULT]"

4. Validate:
   Compare decision to expected (ALLOW/DENY)

5. Report:
   | Portal | Expected | Actual | Status |
   |--------|----------|--------|--------|
   | ^auth  | ALLOW    | ALLOW  | ✅     |
```

### Example AI Validation Session

```
Agent: Validating ^authenticated portal...

1. [browser_navigate("/logout")] - Ensure logged out
2. [browser_navigate("/dashboard")] - Access protected route
3. [browser_console_messages()] - Read console

Found portal check:
- Gate: ^authenticated
- Decision: ❌ DENY
- Reason: No session

Expected: DENY
Result: ✅ PASS
```

## Scenario File Format

```yaml
# scenarios/auth-flows.yaml
name: Authentication Tests
scenarios:
  - id: unauth-protected-route
    description: Unauthenticated user denied protected route
    user: unauthenticated
    steps:
      - navigate: /dashboard
        expect:
          portal: ^authenticated
          decision: DENY
          redirectTo: /login
```

## API Reference

### Parser Functions

| Function | Description |
|----------|-------------|
| `parsePortalLogs(logs)` | Parse all portal checks from log lines |
| `parsePortalLog(log)` | Parse single log line |
| `findPortalCheck(logs, gate)` | Find specific portal check |
| `hasPortalDecision(logs, gate, decision)` | Check if portal has decision |
| `extractGateNames(logs)` | Get all unique gate names |

### Reporter Functions

| Function | Description |
|----------|-------------|
| `generateMarkdownReport(report)` | Generate markdown report |
| `generateJsonReport(report)` | Generate JSON report |
| `generateCoverageReport(scenarios, portals)` | Generate coverage analysis |
| `formatValidationResult(result)` | Format single result as table row |

## Related

- [Portal Validation Spec](../../paradigm/templates/paradigm/specs/portal-validation.md)
- [Portal E2E Testing Spec](../../paradigm/templates/paradigm/specs/portal-e2e-testing.md)
- [Run E2E Tests Prompt](../../paradigm/templates/paradigm/prompts/run-e2e-tests.md)

## License

MIT
