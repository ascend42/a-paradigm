/**
 * Validator for Purpose files
 */

import type { PurposeFile, PurposeItem, PurposeItemArray, ValidationResult, ValidationIssue } from './types.js';

/**
 * Helper to normalize features/components to entries regardless of format
 */
function normalizeToEntries(
  items: Record<string, PurposeItem> | PurposeItemArray[] | undefined
): Array<[string, PurposeItem]> {
  if (!items) return [];
  
  if (Array.isArray(items)) {
    // Array format: [{ id, description, ... }]
    return items.map((item) => [item.id, item]);
  } else {
    // Record format: { id: { description, ... } }
    return Object.entries(items);
  }
}

/**
 * Get all IDs from features/components (handles both formats)
 */
function getItemIds(items: Record<string, PurposeItem> | PurposeItemArray[] | undefined): string[] {
  if (!items) return [];
  
  if (Array.isArray(items)) {
    return items.map((item) => item.id);
  } else {
    return Object.keys(items);
  }
}

/**
 * Validate a parsed purpose file
 */
export function validatePurposeFile(data: PurposeFile, filePath?: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const prefix = filePath ? `${filePath}: ` : '';

  // Validate features (handles both array and record formats)
  const featureEntries = normalizeToEntries(data.features);
  for (const [id, feature] of featureEntries) {
    validatePurposeItem(id, feature, 'feature', prefix, issues);
  }

  // Validate components (handles both array and record formats)
  const componentEntries = normalizeToEntries(data.components);
  for (const [id, component] of componentEntries) {
    validatePurposeItem(id, component, 'component', prefix, issues);
  }

  // Validate relationships reference existing features/components
  if (data.relationships) {
    const allIds = new Set([
      ...getItemIds(data.features),
      ...getItemIds(data.components),
    ]);

    for (const rel of data.relationships) {
      // Skip if relationship is a string (shorthand format) or malformed
      if (typeof rel === 'string' || !rel || !rel.from || !rel.to) {
        continue;
      }
      
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
    const componentIds = new Set(getItemIds(data.components));

    // Handle both array format and record format
    if (Array.isArray(data.flows)) {
      // Array format: [{ name, steps }]
      for (const flow of data.flows) {
        if (!flow || typeof flow !== 'object') continue;
        
        if (!flow.name) {
          issues.push({
            type: 'error',
            message: `${prefix}Flow missing required "name" field`,
            path: 'flows',
          });
        }

        if (flow.steps && Array.isArray(flow.steps)) {
          for (const step of flow.steps) {
            // Skip string steps (simple descriptions) or malformed steps
            if (typeof step === 'string' || !step || !step.component) continue;
            
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
    } else {
      // Record format: { flow-name: { description, gates, steps } }
      for (const [flowId, flowDef] of Object.entries(data.flows)) {
        if (!flowDef || typeof flowDef !== 'object') continue;
        
        if (flowDef.steps && Array.isArray(flowDef.steps)) {
          for (const step of flowDef.steps) {
            // Skip string steps (simple descriptions) or malformed steps
            if (typeof step === 'string' || !step || !step.component) continue;
            
            const componentId = step.component.replace(/^#/, '');
            if (!componentIds.has(componentId)) {
              issues.push({
                type: 'warning',
                message: `${prefix}Flow "${flowId}" references unknown component: "${step.component}"`,
                path: `flows.${flowId}`,
              });
            }
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
 * Cross-file validation: check that symbol references across all .purpose files resolve.
 *
 * Checks:
 *   1. All `parent` references resolve to a defined component
 *   2. All flow steps referencing symbols point to existing definitions
 *   3. All component/signal/gate lists reference existing definitions
 *
 * Reports as warnings (not errors) since portal.yaml gates aren't in .purpose.
 */
export function validateCrossFile(
  allFiles: Array<{ filePath: string; data: PurposeFile }>,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Build a set of all defined symbols across all files
  const definedSymbols = new Set<string>();

  for (const { data } of allFiles) {
    // Components (record or array)
    const components = normalizeToEntries(data.components);
    for (const [id] of components) {
      definedSymbols.add(`#${id}`);
      definedSymbols.add(id);
    }

    // Features (record or array)
    const features = normalizeToEntries(data.features);
    for (const [id] of features) {
      definedSymbols.add(`#${id}`);
      definedSymbols.add(id);
    }

    // Gates
    if (data.gates) {
      for (const id of Object.keys(data.gates)) {
        definedSymbols.add(`^${id}`);
        definedSymbols.add(id);
      }
    }

    // Signals
    if (data.signals) {
      for (const id of Object.keys(data.signals)) {
        definedSymbols.add(`!${id}`);
        definedSymbols.add(id);
      }
    }

    // Flows
    if (data.flows) {
      if (Array.isArray(data.flows)) {
        for (const flow of data.flows) {
          if (flow?.name) {
            definedSymbols.add(`$${flow.name}`);
            definedSymbols.add(flow.name);
          }
        }
      } else {
        for (const id of Object.keys(data.flows)) {
          definedSymbols.add(`$${id}`);
          definedSymbols.add(id);
        }
      }
    }

    // Aspects
    if (data.aspects) {
      for (const id of Object.keys(data.aspects)) {
        definedSymbols.add(`~${id}`);
        definedSymbols.add(id);
      }
    }

    // States
    if (data.states) {
      for (const id of Object.keys(data.states)) {
        definedSymbols.add(`#${id}`);
        definedSymbols.add(id);
      }
    }
  }

  // Check all references resolve
  for (const { filePath, data } of allFiles) {
    const prefix = filePath ? `${filePath}: ` : '';

    // Check parent references on components and features
    const allEntries = [
      ...normalizeToEntries(data.components),
      ...normalizeToEntries(data.features),
    ];

    for (const [id, item] of allEntries) {
      if (item.parent) {
        const parentRef = item.parent.replace(/^["']|["']$/g, '');
        const bareRef = parentRef.replace(/^[#$^!~@%?&]/, '');
        if (!definedSymbols.has(parentRef) && !definedSymbols.has(bareRef)) {
          issues.push({
            type: 'warning',
            message: `${prefix}Component "${id}" references parent "${parentRef}" which is not defined in any .purpose file`,
            path: `components.${id}.parent`,
          });
        }
      }

      // Check symbol list references (gates, signals, flows, components, aspects)
      const refLists: Array<{ field: string; refs: string[] | undefined }> = [
        { field: 'gates', refs: item.gates },
        { field: 'signals', refs: item.signals },
        { field: 'flows', refs: item.flows },
        { field: 'components', refs: item.components },
        { field: 'aspects', refs: item.aspects },
      ];

      for (const { field, refs } of refLists) {
        if (!refs) continue;
        for (const ref of refs) {
          const bareRef = ref.replace(/^[#$^!~@%?&]/, '');
          if (!definedSymbols.has(ref) && !definedSymbols.has(bareRef)) {
            issues.push({
              type: 'warning',
              message: `${prefix}Symbol "${id}" references ${field} "${ref}" which is not defined`,
              path: `components.${id}.${field}`,
            });
          }
        }
      }
    }

    // Check flow step references
    if (data.flows) {
      if (Array.isArray(data.flows)) {
        for (const flow of data.flows) {
          if (!flow?.steps) continue;
          for (const step of flow.steps) {
            if (typeof step === 'string' || !step?.component) continue;
            const bareRef = step.component.replace(/^#/, '');
            if (!definedSymbols.has(step.component) && !definedSymbols.has(bareRef)) {
              issues.push({
                type: 'warning',
                message: `${prefix}Flow "${flow.name}" step references "${step.component}" which is not defined`,
                path: `flows.${flow.name}.steps`,
              });
            }
          }
        }
      } else {
        for (const [flowId, flowDef] of Object.entries(data.flows)) {
          if (!flowDef?.steps) continue;
          for (const step of flowDef.steps) {
            if (typeof step === 'string' || !step?.component) continue;
            const bareRef = step.component.replace(/^#/, '');
            if (!definedSymbols.has(step.component) && !definedSymbols.has(bareRef)) {
              issues.push({
                type: 'warning',
                message: `${prefix}Flow "${flowId}" step references "${step.component}" which is not defined`,
                path: `flows.${flowId}.steps`,
              });
            }
          }
        }
      }
    }
  }

  return {
    valid: issues.filter(i => i.type === 'error').length === 0,
    issues,
  };
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
