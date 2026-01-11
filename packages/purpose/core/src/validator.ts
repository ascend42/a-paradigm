/**
 * Validator for Purpose files
 */

import type { PurposeFile, ValidationResult, ValidationIssue } from './types.js';

/**
 * Validate a parsed purpose file
 */
export function validatePurposeFile(data: PurposeFile, filePath?: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const prefix = filePath ? `${filePath}: ` : '';

  // Validate features
  if (data.features) {
    for (const [id, feature] of Object.entries(data.features)) {
      validatePurposeItem(id, feature, 'feature', prefix, issues);
    }
  }

  // Validate components
  if (data.components) {
    for (const [id, component] of Object.entries(data.components)) {
      validatePurposeItem(id, component, 'component', prefix, issues);
    }
  }

  // Validate relationships reference existing features/components
  if (data.relationships) {
    const allIds = new Set([
      ...Object.keys(data.features || {}),
      ...Object.keys(data.components || {}),
    ]);

    for (const rel of data.relationships) {
      // Check 'from' reference (strip symbol prefix if present)
      const fromId = rel.from.replace(/^[@#$%~^!?]/, '');
      if (!allIds.has(fromId) && !rel.from.includes('.')) {
        issues.push({
          type: 'warning',
          message: `${prefix}Relationship references unknown source: "${rel.from}"`,
          path: 'relationships',
        });
      }

      // Check 'to' reference
      const toId = rel.to.replace(/^[@#$%~^!?]/, '');
      if (!allIds.has(toId) && !rel.to.includes('.')) {
        issues.push({
          type: 'warning',
          message: `${prefix}Relationship references unknown target: "${rel.to}"`,
          path: 'relationships',
        });
      }
    }
  }

  // Validate flows reference existing components
  if (data.flows) {
    const componentIds = new Set(Object.keys(data.components || {}));

    for (const flow of data.flows) {
      if (!flow.name) {
        issues.push({
          type: 'error',
          message: `${prefix}Flow missing required "name" field`,
          path: 'flows',
        });
      }

      if (flow.steps) {
        for (const step of flow.steps) {
          const componentId = step.component.replace(/^#/, '');
          if (!componentIds.has(componentId)) {
            issues.push({
              type: 'warning',
              message: `${prefix}Flow "${flow.name}" references unknown component: "${step.component}"`,
              path: `flows.${flow.name}`,
            });
          }
        }
      }
    }
  }

  return {
    valid: issues.filter((i) => i.type === 'error').length === 0,
    issues,
  };
}

/**
 * Validate a single purpose item (feature or component)
 */
function validatePurposeItem(
  id: string,
  item: { description: string; endpoints?: string[]; tests?: string[] },
  itemType: 'feature' | 'component',
  prefix: string,
  issues: ValidationIssue[]
): void {
  const path = `${itemType}s.${id}`;

  // Validate ID format (kebab-case recommended)
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(id)) {
    issues.push({
      type: 'warning',
      message: `${prefix}${itemType} ID "${id}" should use alphanumeric characters and hyphens`,
      path,
    });
  }

  // Warn if no description
  if (!item.description || item.description.trim() === '') {
    issues.push({
      type: 'warning',
      message: `${prefix}${itemType} "${id}" has no description`,
      path,
    });
  }

  // Validate endpoint formats
  if (item.endpoints) {
    for (const endpoint of item.endpoints) {
      if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//.test(endpoint)) {
        issues.push({
          type: 'warning',
          message: `${prefix}Endpoint "${endpoint}" in ${itemType} "${id}" may not be in standard format (e.g., "GET /api/users")`,
          path: `${path}.endpoints`,
        });
      }
    }
  }
}

/**
 * Format validation result for console output
 */
export function formatValidationResult(result: ValidationResult): string {
  if (result.valid && result.issues.length === 0) {
    return '✅ Purpose file is valid';
  }

  const lines: string[] = [];

  const errors = result.issues.filter((i) => i.type === 'error');
  const warnings = result.issues.filter((i) => i.type === 'warning');

  if (errors.length > 0) {
    lines.push(`\n❌ ${errors.length} error(s):`);
    for (const issue of errors) {
      lines.push(`  • ${issue.message}${issue.path ? ` (${issue.path})` : ''}`);
    }
  }

  if (warnings.length > 0) {
    lines.push(`\n⚠️  ${warnings.length} warning(s):`);
    for (const issue of warnings) {
      lines.push(`  • ${issue.message}${issue.path ? ` (${issue.path})` : ''}`);
    }
  }

  if (result.valid) {
    lines.push('\n✅ Purpose file is valid (with warnings)');
  } else {
    lines.push('\n❌ Purpose file is invalid');
  }

  return lines.join('\n');
}
