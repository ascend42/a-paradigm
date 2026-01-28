/**
 * Portal E2E Validation Package
 *
 * Provides utilities for AI-agent driven validation of portal/authorization flows.
 * Works with Cursor browser tools or any console log capture mechanism.
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
} from './types.js';

// Parser - for parsing portal check output from console logs
export {
  parsePortalLogs,
  parsePortalLog,
  findPortalCheck,
  hasPortalDecision,
  extractGateNames,
} from './parser.js';

// Reporter - for generating validation reports
export {
  generateMarkdownReport,
  generateJsonReport,
  generateCoverageReport,
  formatValidationResult,
} from './reporter.js';
