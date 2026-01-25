/**
 * Portal E2E Test Reporter
 *
 * Generates reports from test results in various formats.
 */

import type {
  TestReport,
  ScenarioResult,
  ValidationResult,
  CoverageReport,
  PortalCoverage,
  TestScenario,
} from './types.js';

/**
 * Generate a markdown report from test results
 */
export function generateMarkdownReport(report: TestReport): string {
  const lines: string[] = [];

  // Header
  lines.push('# Portal E2E Test Results');
  lines.push('');
  lines.push(`**Date**: ${report.timestamp}`);
  lines.push(`**Environment**: ${report.environment}`);
  lines.push(`**Total Scenarios**: ${report.summary.total}`);
  lines.push(`**Passed**: ${report.summary.passed}`);
  lines.push(`**Failed**: ${report.summary.failed}`);
  if (report.summary.skipped > 0) {
    lines.push(`**Skipped**: ${report.summary.skipped}`);
  }
  lines.push('');

  // Results table
  lines.push('## Results');
  lines.push('');
  lines.push('| Scenario | Step | Portal | Expected | Actual | Status |');
  lines.push('|----------|------|--------|----------|--------|--------|');

  for (const result of report.results) {
    for (const step of result.steps) {
      const stepDesc = step.step.navigate || step.step.click || 'action';
      for (const validation of step.validations) {
        const status = validation.passed ? '✅' : '❌';
        lines.push(
          `| ${result.scenario.id} | ${stepDesc} | ${validation.portal} | ${validation.expected} | ${validation.actual} | ${status} |`
        );
      }
    }
  }

  lines.push('');

  // Failures detail
  const failures = report.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push('## Failures');
    lines.push('');

    for (const failure of failures) {
      lines.push(`### ${failure.scenario.id}`);
      lines.push('');
      lines.push(`**Description**: ${failure.scenario.description}`);
      lines.push('');

      if (failure.error) {
        lines.push(`**Error**: ${failure.error}`);
        lines.push('');
      }

      for (const step of failure.steps) {
        const failedValidations = step.validations.filter((v) => !v.passed);
        if (failedValidations.length > 0) {
          const stepDesc = step.step.navigate || step.step.click || 'action';
          lines.push(`**Step**: ${stepDesc}`);
          lines.push('');

          for (const validation of failedValidations) {
            lines.push(`- **Portal**: ${validation.portal}`);
            lines.push(`- **Expected**: ${validation.expected}`);
            lines.push(`- **Actual**: ${validation.actual}`);
            lines.push(`- **Error**: ${validation.error}`);
            if (validation.reason) {
              lines.push(`- **Reason**: ${validation.reason}`);
            }
            lines.push('');
          }
        }
      }
    }
  }

  // Coverage report
  if (report.coverage) {
    lines.push('## Coverage');
    lines.push('');
    lines.push(
      `**Coverage**: ${report.coverage.summary.tested}/${report.coverage.summary.total} portals tested (${report.coverage.summary.coverage.toFixed(1)}%)`
    );
    lines.push('');
    lines.push('| Portal | Tested | ALLOW Test | DENY Test |');
    lines.push('|--------|--------|------------|-----------|');

    for (const portal of report.coverage.portals) {
      const tested = portal.coverageType !== 'none' ? '✅' : '❌';
      const allowTest = portal.coverageType === 'allow' || portal.coverageType === 'both' ? '✅' : '❌';
      const denyTest = portal.coverageType === 'deny' || portal.coverageType === 'both' ? '✅' : '❌';
      lines.push(`| ${portal.name} | ${tested} | ${allowTest} | ${denyTest} |`);
    }

    lines.push('');

    // Recommendations
    const untested = report.coverage.portals.filter((p) => p.coverageType === 'none');
    if (untested.length > 0) {
      lines.push('### Recommendations');
      lines.push('');
      lines.push('Add test scenarios for:');
      for (const portal of untested) {
        lines.push(`- ${portal.name}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate a JSON report
 */
export function generateJsonReport(report: TestReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Generate a JUnit XML report (for CI integration)
 */
export function generateJUnitReport(report: TestReport): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="Portal E2E Tests" tests="${report.summary.total}" failures="${report.summary.failed}" skipped="${report.summary.skipped}" time="0">`
  );

  for (const result of report.results) {
    const failures = result.steps.flatMap((s) => s.validations.filter((v) => !v.passed));
    const duration = (result.duration || 0) / 1000;

    lines.push(
      `  <testsuite name="${escapeXml(result.scenario.id)}" tests="${result.steps.length}" failures="${failures.length}" time="${duration.toFixed(3)}">`
    );

    for (const step of result.steps) {
      const stepName = step.step.navigate || step.step.click || 'action';
      const stepFailed = step.validations.some((v) => !v.passed);

      lines.push(`    <testcase name="${escapeXml(stepName)}" classname="${escapeXml(result.scenario.id)}">`);

      if (stepFailed) {
        for (const validation of step.validations.filter((v) => !v.passed)) {
          lines.push(
            `      <failure message="${escapeXml(validation.error || 'Validation failed')}" type="AssertionError">`
          );
          lines.push(`Portal: ${escapeXml(validation.portal)}`);
          lines.push(`Expected: ${escapeXml(validation.expected)}`);
          lines.push(`Actual: ${escapeXml(validation.actual)}`);
          lines.push('      </failure>');
        }
      }

      lines.push('    </testcase>');
    }

    lines.push('  </testsuite>');
  }

  lines.push('</testsuites>');

  return lines.join('\n');
}

/**
 * Generate coverage report from scenarios and portal definitions
 */
export function generateCoverageReport(
  scenarios: TestScenario[],
  portalNames: string[]
): CoverageReport {
  const portals: PortalCoverage[] = [];

  for (const portalName of portalNames) {
    const testedBy = scenarios.filter((s) =>
      s.steps.some((step) => {
        const expects = Array.isArray(step.expect) ? step.expect : [step.expect];
        return expects.some((e) => e.portal === portalName);
      })
    );

    const hasAllowTest = testedBy.some((s) =>
      s.steps.some((step) => {
        const expects = Array.isArray(step.expect) ? step.expect : [step.expect];
        return expects.some((e) => e.portal === portalName && e.decision === 'ALLOW');
      })
    );

    const hasDenyTest = testedBy.some((s) =>
      s.steps.some((step) => {
        const expects = Array.isArray(step.expect) ? step.expect : [step.expect];
        return expects.some((e) => e.portal === portalName && e.decision === 'DENY');
      })
    );

    let coverageType: PortalCoverage['coverageType'];
    if (hasAllowTest && hasDenyTest) {
      coverageType = 'both';
    } else if (hasAllowTest) {
      coverageType = 'allow';
    } else if (hasDenyTest) {
      coverageType = 'deny';
    } else {
      coverageType = 'none';
    }

    portals.push({
      name: portalName,
      definedIn: 'portal.yaml',
      testedIn: testedBy.map((s) => s.id),
      coverageType,
    });
  }

  const tested = portals.filter((p) => p.coverageType !== 'none').length;

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

/**
 * Print a summary to console
 */
export function printSummary(report: TestReport): void {
  console.log('\n' + '='.repeat(60));
  console.log('Portal E2E Test Results');
  console.log('='.repeat(60));
  console.log(`Environment: ${report.environment}`);
  console.log(`Total: ${report.summary.total}`);
  console.log(`Passed: ${report.summary.passed}`);
  console.log(`Failed: ${report.summary.failed}`);
  if (report.summary.skipped > 0) {
    console.log(`Skipped: ${report.summary.skipped}`);
  }
  console.log('='.repeat(60) + '\n');

  // Print failures
  const failures = report.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log('FAILURES:\n');
    for (const failure of failures) {
      console.log(`  ❌ ${failure.scenario.id}`);
      console.log(`     ${failure.scenario.description}`);

      for (const step of failure.steps) {
        const failedValidations = step.validations.filter((v) => !v.passed);
        for (const v of failedValidations) {
          console.log(`     - ${v.portal}: Expected ${v.expected}, got ${v.actual}`);
        }
      }
      console.log('');
    }
  }

  // Print coverage if available
  if (report.coverage) {
    console.log(`Coverage: ${report.coverage.summary.coverage.toFixed(1)}%`);
    console.log(`  ${report.coverage.summary.tested}/${report.coverage.summary.total} portals tested`);

    const untested = report.coverage.portals.filter((p) => p.coverageType === 'none');
    if (untested.length > 0) {
      console.log('\nUntested portals:');
      for (const p of untested) {
        console.log(`  - ${p.name}`);
      }
    }
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
