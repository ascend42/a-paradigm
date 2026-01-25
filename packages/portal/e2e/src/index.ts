/**
 * Portal E2E Testing Package
 *
 * Provides tools for automated testing of portal/authorization flows
 * by parsing console output from portal checks.
 *
 * @packageDocumentation
 */

// Types
export type {
  UserConfig,
  ExpectedResult,
  TestStep,
  TestScenario,
  ScenarioFile,
  PortalCheckResult,
  ValidationResult,
  TestStepResult,
  ScenarioResult,
  PortalCoverage,
  CoverageReport,
  TestReport,
  RunnerConfig,
} from './types.js';

// Parser
export {
  parsePortalLogs,
  parsePortalLog,
  findPortalCheck,
  hasPortalDecision,
  extractGateNames,
} from './parser.js';

// Runner
export {
  PortalTestRunner,
  createPlaywrightRunner,
  type BrowserInterface,
} from './runner.js';

// Reporter
export {
  generateMarkdownReport,
  generateJsonReport,
  generateJUnitReport,
  generateCoverageReport,
  printSummary,
} from './reporter.js';
