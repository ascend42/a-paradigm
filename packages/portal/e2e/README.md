# @a-company/portal-e2e

Portal-driven E2E testing for validating authorization flows. This package provides tools to automatically test portal/gate checks by parsing structured console output.

## Installation

```bash
npm install @a-company/portal-e2e
# or
pnpm add @a-company/portal-e2e
```

For Playwright support:

```bash
npm install @playwright/test
```

## Quick Start

### 1. Define Test Scenarios

Create a YAML file with your test scenarios:

```yaml
# tests/scenarios/auth-flows.yaml

name: Authentication Flows
description: Verify authentication portal checks

users:
  unauthenticated:
    authenticated: false
  
  starter:
    authenticated: true
    email: test-starter@example.com
    password: TestPassword123!
    tier: starter

scenarios:
  - id: unauthenticated-protected-route
    description: Unauthenticated user accessing protected route
    user: unauthenticated
    steps:
      - navigate: /leads
        expect:
          portal: ^authenticated
          decision: DENY
          redirectTo: /login

  - id: starter-basic-access
    description: Starter user accessing basic features
    user: starter
    steps:
      - navigate: /leads
        expect:
          portal: ^subscription-required
          decision: ALLOW
```

### 2. Run Tests

```typescript
import { PortalTestRunner, createPlaywrightRunner, printSummary } from '@a-company/portal-e2e';
import scenarios from './scenarios/auth-flows.yaml';

async function main() {
  const runner = await createPlaywrightRunner({
    baseUrl: 'http://localhost:5173',
    scenarioGlob: 'tests/scenarios/*.yaml',
    users: scenarios.users,
    headless: true,
  });

  const report = await runner.runAll(scenarios.scenarios);
  
  printSummary(report);
  
  if (report.summary.failed > 0) {
    process.exit(1);
  }
}

main();
```

### 3. Generate Reports

```typescript
import { generateMarkdownReport, generateJUnitReport } from '@a-company/portal-e2e';

// Markdown report
const markdown = generateMarkdownReport(report);
fs.writeFileSync('test-results.md', markdown);

// JUnit XML (for CI)
const junit = generateJUnitReport(report);
fs.writeFileSync('test-results.xml', junit);
```

## Console Log Parsing

The package parses two formats of portal check output:

### Visual Format

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

```
[GATE_RESULT] {"gate":"^authenticated","decision":"allow","reason":"Session valid"}
```

Enable JSON format with `PORTAL_TEST_MODE=true`.

## API Reference

### Parser

```typescript
import { parsePortalLogs, findPortalCheck, hasPortalDecision } from '@a-company/portal-e2e/parser';

// Parse all portal checks from console logs
const results = parsePortalLogs(consoleLogs);

// Find specific portal check
const authCheck = findPortalCheck(logs, '^authenticated');

// Check if portal has specific decision
const isAllowed = hasPortalDecision(logs, '^authenticated', 'ALLOW');
```

### Runner

```typescript
import { PortalTestRunner, BrowserInterface } from '@a-company/portal-e2e/runner';

// With Playwright
const runner = await createPlaywrightRunner(config);

// Custom browser interface
const customRunner = new PortalTestRunner(config, myBrowserInterface);

// Run single scenario
const result = await runner.runScenario(scenario);

// Run all scenarios
const report = await runner.runAll(scenarios);
```

### Reporter

```typescript
import { 
  generateMarkdownReport, 
  generateJsonReport, 
  generateJUnitReport,
  generateCoverageReport,
  printSummary 
} from '@a-company/portal-e2e/reporter';

// Generate various report formats
const markdown = generateMarkdownReport(report);
const json = generateJsonReport(report);
const junit = generateJUnitReport(report);

// Generate coverage report
const coverage = generateCoverageReport(scenarios, portalNames);

// Print summary to console
printSummary(report);
```

## Integration with Playwright Test

```typescript
// tests/portal.spec.ts
import { test, expect } from '@playwright/test';
import { parsePortalLogs } from '@a-company/portal-e2e';

test.describe('Portal Validation', () => {
  test('authenticated user can access dashboard', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', msg => logs.push(msg.text()));
    
    // Login
    await page.goto('/login');
    await page.fill('[name="email"]', 'user@example.com');
    await page.fill('[name="password"]', 'password');
    await page.click('button[type="submit"]');
    
    // Navigate to protected route
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    
    // Parse and validate
    const portalResults = parsePortalLogs(logs);
    const authCheck = portalResults.find(r => r.gate === '^authenticated');
    
    expect(authCheck).toBeDefined();
    expect(authCheck?.decision).toBe('ALLOW');
  });
});
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Run Portal E2E Tests
  run: npm run test:portals
  env:
    TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
    TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}

- name: Upload Results
  uses: actions/upload-artifact@v4
  with:
    name: portal-test-results
    path: tests/results/
```

## Related

- [Portal Validation Spec](../../paradigm/templates/paradigm/specs/portal-validation.md)
- [Portal E2E Testing Spec](../../paradigm/templates/paradigm/specs/portal-e2e-testing.md)
- [Run E2E Tests Prompt](../../paradigm/templates/paradigm/prompts/run-e2e-tests.md)

## License

MIT
