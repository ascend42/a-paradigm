/**
 * Sentinel Configuration
 *
 * Loads and writes .sentinel.yaml config files.
 * Provides project-level configuration for the Sentinel SDK and CLI.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SentinelYamlConfig {
  version: string;
  project: string;
  environment?: string;
  symbols?: {
    components?: string[];
    gates?: string[];
    flows?: string[];
    signals?: string[];
  };
  routes?: Record<string, string>;
  scrub?: {
    headers?: string[];
    fields?: string[];
  };
}

const CONFIG_FILES = ['.sentinel.yaml', '.sentinel.yml'];

/**
 * Load .sentinel.yaml from a project directory.
 *
 * @param projectDir - Project root directory
 * @returns Parsed config or null if not found
 */
export function loadConfig(projectDir: string): SentinelYamlConfig | null {
  for (const filename of CONFIG_FILES) {
    const filePath = path.join(projectDir, filename);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return parseSimpleYaml(content);
    }
  }
  return null;
}

/**
 * Write .sentinel.yaml to a project directory.
 *
 * @param projectDir - Project root directory
 * @param config - Config to write
 */
export function writeConfig(projectDir: string, config: SentinelYamlConfig): void {
  const filePath = path.join(projectDir, '.sentinel.yaml');
  const content = serializeSimpleYaml(config);
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Simple YAML parser for .sentinel.yaml files.
 * Handles the flat structure we need without requiring js-yaml.
 */
function parseSimpleYaml(content: string): SentinelYamlConfig {
  const config: SentinelYamlConfig = { version: '1.0', project: '' };
  const lines = content.split('\n');
  let currentSection: string | null = null;
  let currentSubSection: string | null = null;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Top-level key: value
    const topMatch = trimmed.match(/^(\w+):\s*(.+)$/);
    if (topMatch) {
      const [, key, value] = topMatch;
      if (key === 'version') config.version = value.replace(/['"]/g, '');
      else if (key === 'project') config.project = value.replace(/['"]/g, '');
      else if (key === 'environment') config.environment = value.replace(/['"]/g, '');
      currentSection = null;
      currentSubSection = null;
      continue;
    }

    // Section header (e.g. "symbols:", "routes:", "scrub:")
    const sectionMatch = trimmed.match(/^(\w+):$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      currentSubSection = null;
      if (currentSection === 'symbols' && !config.symbols) {
        config.symbols = {};
      }
      if (currentSection === 'routes' && !config.routes) {
        config.routes = {};
      }
      if (currentSection === 'scrub' && !config.scrub) {
        config.scrub = {};
      }
      continue;
    }

    // Sub-section header (e.g. "  components:", "  headers:")
    const subMatch = trimmed.match(/^\s{2}(\w+):$/);
    if (subMatch && currentSection) {
      currentSubSection = subMatch[1];
      if (currentSection === 'symbols' && config.symbols) {
        (config.symbols as any)[currentSubSection] = [];
      }
      if (currentSection === 'scrub' && config.scrub) {
        (config.scrub as any)[currentSubSection] = [];
      }
      continue;
    }

    // List item (e.g. "    - #checkout")
    const listMatch = trimmed.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentSection && currentSubSection) {
      const value = listMatch[1].replace(/['"]/g, '');
      if (currentSection === 'symbols' && config.symbols) {
        const arr = (config.symbols as any)[currentSubSection];
        if (Array.isArray(arr)) arr.push(value);
      }
      if (currentSection === 'scrub' && config.scrub) {
        const arr = (config.scrub as any)[currentSubSection];
        if (Array.isArray(arr)) arr.push(value);
      }
      continue;
    }

    // Route mapping (e.g. "  /api/checkout: '#checkout'")
    const routeMatch = trimmed.match(/^\s+(['"]?\/[^'"]+['"]?):\s+['"]?([^'"]+)['"]?$/);
    if (routeMatch && currentSection === 'routes' && config.routes) {
      const route = routeMatch[1].replace(/['"]/g, '');
      config.routes[route] = routeMatch[2];
      continue;
    }
  }

  return config;
}

/**
 * Serialize config to YAML string.
 */
function serializeSimpleYaml(config: SentinelYamlConfig): string {
  const lines: string[] = [];

  lines.push(`# Sentinel Configuration`);
  lines.push(`# Auto-generated — edit freely`);
  lines.push('');
  lines.push(`version: "${config.version}"`);
  lines.push(`project: "${config.project}"`);
  if (config.environment) {
    lines.push(`environment: "${config.environment}"`);
  }

  if (config.symbols) {
    lines.push('');
    lines.push('symbols:');
    for (const [key, values] of Object.entries(config.symbols)) {
      if (values && values.length > 0) {
        lines.push(`  ${key}:`);
        for (const v of values) {
          lines.push(`    - ${v}`);
        }
      }
    }
  }

  if (config.routes && Object.keys(config.routes).length > 0) {
    lines.push('');
    lines.push('routes:');
    for (const [route, symbol] of Object.entries(config.routes)) {
      lines.push(`  "${route}": ${symbol}`);
    }
  }

  if (config.scrub) {
    lines.push('');
    lines.push('scrub:');
    if (config.scrub.headers?.length) {
      lines.push('  headers:');
      for (const h of config.scrub.headers) {
        lines.push(`    - ${h}`);
      }
    }
    if (config.scrub.fields?.length) {
      lines.push('  fields:');
      for (const f of config.scrub.fields) {
        lines.push(`    - ${f}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}
