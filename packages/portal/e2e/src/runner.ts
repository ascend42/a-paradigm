/**
 * Portal E2E Test Runner
 *
 * Executes test scenarios against a running application,
 * capturing console output and validating portal checks.
 */

import type {
  RunnerConfig,
  TestScenario,
  TestStep,
  TestStepResult,
  ScenarioResult,
  UserConfig,
  ExpectedResult,
  ValidationResult,
  TestReport,
} from './types.js';
import { parsePortalLogs } from './parser.js';

/**
 * Abstract browser interface
 * Implementations can be provided for Playwright, Puppeteer, or Cursor browser
 */
export interface BrowserInterface {
  /** Navigate to a URL */
  goto(url: string): Promise<void>;
  /** Wait for network to be idle */
  waitForNetworkIdle(): Promise<void>;
  /** Get current URL */
  url(): string;
  /** Click an element */
  click(selector: string): Promise<void>;
  /** Type text into an element */
  type(selector: string, text: string): Promise<void>;
  /** Wait for milliseconds */
  wait(ms: number): Promise<void>;
  /** Get console messages since last call */
  getConsoleLogs(): string[];
  /** Clear console log buffer */
  clearConsoleLogs(): void;
  /** Take a screenshot */
  screenshot(path: string): Promise<void>;
  /** Close browser */
  close(): Promise<void>;
}

/**
 * Portal E2E Test Runner
 */
export class PortalTestRunner {
  private config: RunnerConfig;
  private browser: BrowserInterface;
  private users: Record<string, UserConfig>;

  constructor(config: RunnerConfig, browser: BrowserInterface) {
    this.config = config;
    this.browser = browser;
    this.users = config.users || {};
  }

  /**
   * Run a single test scenario
   */
  async runScenario(scenario: TestScenario): Promise<ScenarioResult> {
    const startTime = Date.now();
    const stepResults: TestStepResult[] = [];

    try {
      // Resolve user config
      const userConfig = this.resolveUser(scenario.user);

      // Setup user state
      await this.setupUser(userConfig);

      // Execute each step
      for (const step of scenario.steps) {
        const result = await this.runStep(step);
        stepResults.push(result);

        // Stop on first failure (configurable)
        if (!result.passed) {
          if (this.config.screenshotOnFailure) {
            await this.browser.screenshot(
              `${this.config.outputDir || '.'}/failure-${scenario.id}-${Date.now()}.png`
            );
          }
          break;
        }
      }

      return {
        scenario,
        steps: stepResults,
        passed: stepResults.every((s) => s.passed),
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        scenario,
        steps: stepResults,
        passed: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Run all scenarios from config
   */
  async runAll(scenarios: TestScenario[]): Promise<TestReport> {
    const results: ScenarioResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const scenario of scenarios) {
      if (scenario.skip) {
        skipped++;
        continue;
      }

      const result = await this.runScenario(scenario);
      results.push(result);

      if (result.passed) {
        passed++;
      } else {
        failed++;
      }
    }

    return {
      timestamp: new Date().toISOString(),
      environment: this.config.baseUrl,
      results,
      summary: {
        total: scenarios.length,
        passed,
        failed,
        skipped,
      },
    };
  }

  /**
   * Set up user authentication state
   */
  private async setupUser(user: UserConfig): Promise<void> {
    if (!user.authenticated) {
      // Ensure logged out
      await this.browser.goto(`${this.config.baseUrl}/logout`);
      await this.browser.wait(500);
      return;
    }

    if (!user.email || !user.password) {
      throw new Error('Authenticated user requires email and password');
    }

    // Navigate to login
    await this.browser.goto(`${this.config.baseUrl}/login`);
    await this.browser.waitForNetworkIdle();

    // Enter credentials
    await this.browser.type('[data-testid="email"], [name="email"], #email', user.email);
    await this.browser.type(
      '[data-testid="password"], [name="password"], #password',
      user.password
    );

    // Submit
    await this.browser.click(
      '[data-testid="login-button"], [type="submit"], button:has-text("Login"), button:has-text("Sign in")'
    );

    // Wait for navigation
    await this.browser.waitForNetworkIdle();
  }

  /**
   * Execute a single test step
   */
  private async runStep(step: TestStep): Promise<TestStepResult> {
    this.browser.clearConsoleLogs();

    // Execute step action
    if (step.navigate) {
      const url = step.navigate.startsWith('http')
        ? step.navigate
        : `${this.config.baseUrl}${step.navigate}`;
      await this.browser.goto(url);
      await this.browser.waitForNetworkIdle();
    }

    if (step.click) {
      await this.browser.click(step.click);
      await this.browser.wait(500);
    }

    if (step.type) {
      await this.browser.type(step.type.selector, step.type.text);
    }

    if (step.wait) {
      await this.browser.wait(step.wait);
    }

    // Capture console logs
    const logs = this.browser.getConsoleLogs();
    const portalResults = parsePortalLogs(logs);

    // Validate expectations
    const expectations = Array.isArray(step.expect) ? step.expect : [step.expect];
    const validations = this.validateExpectations(expectations, portalResults, this.browser.url());

    return {
      step,
      portalResults,
      validations,
      passed: validations.every((v) => v.passed),
      url: this.browser.url(),
    };
  }

  /**
   * Validate expected results against actual portal checks
   */
  private validateExpectations(
    expectations: ExpectedResult[],
    portalResults: ReturnType<typeof parsePortalLogs>,
    currentUrl: string
  ): ValidationResult[] {
    const results: ValidationResult[] = [];

    for (const expected of expectations) {
      const actual = portalResults.find((r) => r.gate === expected.portal);

      if (!actual) {
        results.push({
          portal: expected.portal,
          expected: expected.decision,
          actual: 'NOT_FOUND',
          passed: false,
          error: `Portal check for ${expected.portal} not found in console logs`,
        });
        continue;
      }

      const decisionMatch = actual.decision === expected.decision;
      const reasonMatch = !expected.reason || actual.reason.includes(expected.reason);

      if (!decisionMatch) {
        results.push({
          portal: expected.portal,
          expected: expected.decision,
          actual: actual.decision,
          reason: actual.reason,
          passed: false,
          error: `Expected ${expected.decision}, got ${actual.decision}`,
        });
        continue;
      }

      if (!reasonMatch) {
        results.push({
          portal: expected.portal,
          expected: `reason containing "${expected.reason}"`,
          actual: actual.reason,
          passed: false,
          error: `Reason "${actual.reason}" does not contain "${expected.reason}"`,
        });
        continue;
      }

      // Check redirect if specified
      if (expected.redirectTo && actual.decision === 'DENY') {
        if (!currentUrl.includes(expected.redirectTo)) {
          results.push({
            portal: expected.portal,
            expected: `redirect to ${expected.redirectTo}`,
            actual: currentUrl,
            passed: false,
            error: `Expected redirect to ${expected.redirectTo}, but URL is ${currentUrl}`,
          });
          continue;
        }
      }

      results.push({
        portal: expected.portal,
        expected: expected.decision,
        actual: actual.decision,
        reason: actual.reason,
        passed: true,
      });
    }

    return results;
  }

  /**
   * Resolve user reference to UserConfig
   */
  private resolveUser(user: string | UserConfig): UserConfig {
    if (typeof user === 'string') {
      const resolved = this.users[user];
      if (!resolved) {
        throw new Error(`User "${user}" not found in configuration`);
      }
      return resolved;
    }
    return user;
  }
}

/**
 * Create a runner with default browser interface
 * (Requires @playwright/test to be installed)
 */
export async function createPlaywrightRunner(
  config: RunnerConfig
): Promise<PortalTestRunner> {
  // Dynamic import to make Playwright optional
  const { chromium } = await import('@playwright/test');

  const browser = await chromium.launch({
    headless: config.headless ?? true,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleLogs: string[] = [];
  page.on('console', (msg) => {
    consoleLogs.push(msg.text());
  });

  const browserInterface: BrowserInterface = {
    async goto(url: string) {
      await page.goto(url);
    },
    async waitForNetworkIdle() {
      await page.waitForLoadState('networkidle');
    },
    url() {
      return page.url();
    },
    async click(selector: string) {
      await page.click(selector);
    },
    async type(selector: string, text: string) {
      await page.fill(selector, text);
    },
    async wait(ms: number) {
      await page.waitForTimeout(ms);
    },
    getConsoleLogs() {
      return [...consoleLogs];
    },
    clearConsoleLogs() {
      consoleLogs.length = 0;
    },
    async screenshot(path: string) {
      await page.screenshot({ path });
    },
    async close() {
      await browser.close();
    },
  };

  return new PortalTestRunner(config, browserInterface);
}
