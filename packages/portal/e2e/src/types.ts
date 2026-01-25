/**
 * Portal E2E Validation Types
 *
 * Types for AI-agent driven portal validation.
 */

/**
 * User configuration for test scenarios
 */
export interface UserConfig {
  /** Whether user is authenticated */
  authenticated: boolean;
  /** User's email for login */
  email?: string;
  /** User's password for login */
  password?: string;
  /** Subscription tier */
  tier?: 'window-shopper' | 'starter' | 'growth' | 'agency';
  /** User role */
  role?: 'user' | 'admin' | 'super_admin';
}

/**
 * Expected result from a portal check
 */
export interface ExpectedResult {
  /** Portal gate name (e.g., '^authenticated') */
  portal: string;
  /** Expected decision */
  decision: 'ALLOW' | 'DENY' | 'PENDING';
  /** Optional reason substring to match */
  reason?: string;
  /** Expected redirect destination (for DENY) */
  redirectTo?: string;
}

/**
 * Single test step
 */
export interface TestStep {
  /** Navigate to a URL */
  navigate?: string;
  /** Click an element (selector or text) */
  click?: string;
  /** Type text into an element */
  type?: {
    selector: string;
    text: string;
  };
  /** Wait for milliseconds */
  wait?: number;
  /** Expected portal check results */
  expect: ExpectedResult | ExpectedResult[];
}

/**
 * Test scenario definition
 */
export interface TestScenario {
  /** Unique scenario identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** User configuration (name or inline config) */
  user: string | UserConfig;
  /** Test steps */
  steps: TestStep[];
  /** Optional tags for filtering */
  tags?: string[];
  /** Skip this scenario */
  skip?: boolean;
}

/**
 * Scenario file structure
 */
export interface ScenarioFile {
  /** Scenario file name */
  name: string;
  /** Description */
  description?: string;
  /** Named user configurations */
  users?: Record<string, UserConfig>;
  /** Test scenarios */
  scenarios: TestScenario[];
}

/**
 * Parsed portal check result from console
 */
export interface PortalCheckResult {
  /** Gate name (e.g., '^authenticated') */
  gate: string;
  /** Decision made */
  decision: 'ALLOW' | 'DENY' | 'PENDING';
  /** Human-readable reason */
  reason: string;
  /** Requirements checked */
  requires?: string[];
  /** Context data used in decision */
  context?: Record<string, unknown>;
  /** ISO timestamp */
  timestamp?: string;
  /** Evaluation duration in ms */
  duration?: number;
}

/**
 * Validation result for a single expectation
 */
export interface ValidationResult {
  /** Portal gate checked */
  portal: string;
  /** Expected decision */
  expected: string;
  /** Actual decision found */
  actual: string;
  /** Reason from portal check */
  reason?: string;
  /** Whether validation passed */
  passed: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Result of a single test step
 */
export interface TestStepResult {
  /** The step that was executed */
  step: TestStep;
  /** Portal check results found in console */
  portalResults: PortalCheckResult[];
  /** Validation results */
  validations: ValidationResult[];
  /** Whether all validations passed */
  passed: boolean;
  /** Current URL after step */
  url?: string;
}

/**
 * Result of a complete scenario
 */
export interface ScenarioResult {
  /** The scenario that was executed */
  scenario: TestScenario;
  /** Results for each step */
  steps: TestStepResult[];
  /** Whether entire scenario passed */
  passed: boolean;
  /** Total duration in ms */
  duration?: number;
  /** Error if scenario failed to execute */
  error?: string;
}

/**
 * Coverage information for a portal
 */
export interface PortalCoverage {
  /** Portal gate name */
  name: string;
  /** Where portal is defined */
  definedIn: string;
  /** Scenario IDs that test this portal */
  testedIn: string[];
  /** Type of coverage */
  coverageType: 'allow' | 'deny' | 'both' | 'none';
}

/**
 * Coverage report summary
 */
export interface CoverageReport {
  /** Coverage per portal */
  portals: PortalCoverage[];
  /** Summary statistics */
  summary: {
    total: number;
    tested: number;
    untested: number;
    coverage: number;
  };
}

/**
 * Complete validation report
 */
export interface TestReport {
  /** Report generation timestamp */
  timestamp: string;
  /** Environment (URL) tested */
  environment: string;
  /** Results per scenario */
  results: ScenarioResult[];
  /** Coverage report */
  coverage?: CoverageReport;
  /** Summary statistics */
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}
