/**
 * Component access validation and tagging
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ComponentAccessInfo } from './types.js';

/**
 * Options for component tagging
 */
export interface ComponentTaggerOptions {
  /** Root directory to scan */
  rootDir: string;
  /** File patterns to scan (e.g., ['**/*.tsx', '**/*.jsx']) */
  patterns?: string[];
  /** Gate configuration path */
  gateConfigPath?: string;
}

/**
 * Scan components for gate requirements
 *
 * @param options - Tagger options
 * @returns Array of component access information
 */
export async function scanComponents(
  options: ComponentTaggerOptions
): Promise<ComponentAccessInfo[]> {
  const { rootDir, patterns = ['**/*.tsx', '**/*.jsx'], gateConfigPath } = options;

  const components: ComponentAccessInfo[] = [];
  const scannedFiles = new Set<string>();

  // Simple file scanner (in production, use glob or similar)
  function scanDirectory(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip node_modules and other common directories
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist' ||
          entry.name === 'build'
        ) {
          continue;
        }

        if (entry.isDirectory()) {
          scanDirectory(fullPath);
        } else if (entry.isFile()) {
          // Check if file matches patterns
          const matchesPattern = patterns.some((pattern) => {
            // Simple pattern matching (in production, use proper glob)
            if (pattern.includes('**')) {
              const ext = pattern.split('.').pop();
              return fullPath.endsWith(`.${ext}`);
            }
            return fullPath.endsWith(pattern);
          });

          if (matchesPattern && !scannedFiles.has(fullPath)) {
            scannedFiles.add(fullPath);
            const info = analyzeComponent(fullPath);
            if (info) {
              components.push(info);
            }
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  scanDirectory(rootDir);

  return components;
}

/**
 * Analyze a component file for gate requirements
 */
function analyzeComponent(filePath: string): ComponentAccessInfo | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const componentName = path.basename(filePath, path.extname(filePath));

    // Look for gate references in comments or code
    // Pattern: @Gate, @Gateway, GateGuard, checkGateway, etc.
    const gatePatterns = [
      /@Gate\(['"]([^'"]+)['"]\)/g,
      /@Gateway\(['"]([^'"]+)['"]\)/g,
      /GateGuard\(['"]([^'"]+)['"]\)/g,
      /checkGateway\(['"]([^'"]+)['"]/g,
      /gate:\s*['"]([^'"]+)['"]/g,
    ];

    const requiredGates = new Set<string>();
    const missingChecks: string[] = [];

    for (const pattern of gatePatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const gateId = match[1];
        if (gateId && gateId.startsWith('^')) {
          requiredGates.add(gateId);
        }
      }
    }

    // Check if component has proper gate checks
    // This is a simplified check - in production, use AST parsing
    const hasGateCheck =
      content.includes('checkGateway') ||
      content.includes('GateGuard') ||
      content.includes('Gateway') ||
      content.includes('useGate');

    if (requiredGates.size > 0 && !hasGateCheck) {
      missingChecks.push(...Array.from(requiredGates));
    }

    return {
      filePath,
      componentName,
      requiredGates: Array.from(requiredGates),
      missingChecks,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Generate component access report
 *
 * @param components - Component access information
 * @returns Formatted report string
 */
export function generateComponentReport(components: ComponentAccessInfo[]): string {
  const lines: string[] = [];

  lines.push('# Component Access Report\n');
  lines.push(`Generated: ${new Date().toISOString()}\n`);
  lines.push(`Total Components: ${components.length}\n`);

  const withMissingChecks = components.filter((c) => c.missingChecks.length > 0);

  if (withMissingChecks.length > 0) {
    lines.push(`\n## Components Missing Gate Checks (${withMissingChecks.length})\n`);
    for (const component of withMissingChecks) {
      lines.push(`### ${component.componentName}`);
      lines.push(`File: ${component.filePath}`);
      lines.push(`Missing checks for gates: ${component.missingChecks.join(', ')}\n`);
    }
  } else {
    lines.push('\n✅ All components have proper gate checks!\n');
  }

  return lines.join('\n');
}
