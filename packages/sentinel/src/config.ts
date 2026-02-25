/**
 * Sentinel Configuration
 *
 * Loads and writes .sentinel.yaml config files.
 * Provides project-level configuration for the Sentinel SDK and CLI.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SERVER_CONFIG, type SentinelServerConfig } from './types.js';

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
  server?: {
    port?: number;
    maxLogs?: number;
    maxBatchSize?: number;
    wsMaxSubscribers?: number;
    pruneIntervalInserts?: number;
    logRetentionDays?: number;
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

    // Section header (e.g. "symbols:", "routes:", "scrub:", "server:")
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
      if (currentSection === 'server' && !config.server) {
        config.server = {};
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

    // Server section key-value pairs (e.g. "  port: 3838")
    const serverKvMatch = trimmed.match(/^\s+(\w+):\s+(\d+)$/);
    if (serverKvMatch && currentSection === 'server' && config.server) {
      const key = serverKvMatch[1];
      const value = parseInt(serverKvMatch[2], 10);
      if (key in { port: 1, maxLogs: 1, maxBatchSize: 1, wsMaxSubscribers: 1, pruneIntervalInserts: 1, logRetentionDays: 1 }) {
        (config.server as any)[key] = value;
      }
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

  if (config.server && Object.keys(config.server).length > 0) {
    lines.push('');
    lines.push('server:');
    for (const [key, value] of Object.entries(config.server)) {
      if (value !== undefined) {
        lines.push(`  ${key}: ${value}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Load server configuration with resolution order:
 * env vars → local .sentinel.yaml → global ~/.paradigm/sentinel.yaml → defaults
 */
export function loadServerConfig(projectDir?: string): SentinelServerConfig {
  const config = { ...DEFAULT_SERVER_CONFIG };

  // Load from YAML (project-level first, then global)
  const yamlConfig = projectDir ? loadConfig(projectDir) : null;
  const globalDir = path.join(process.env.HOME || '~', '.paradigm');
  const globalConfig = loadConfig(globalDir);

  // Apply global config first, then project config (project overrides global)
  for (const src of [globalConfig, yamlConfig]) {
    if (src?.server) {
      if (src.server.port !== undefined) config.port = src.server.port;
      if (src.server.maxLogs !== undefined) config.maxLogs = src.server.maxLogs;
      if (src.server.maxBatchSize !== undefined) config.maxBatchSize = src.server.maxBatchSize;
      if (src.server.wsMaxSubscribers !== undefined) config.wsMaxSubscribers = src.server.wsMaxSubscribers;
      if (src.server.pruneIntervalInserts !== undefined) config.pruneIntervalInserts = src.server.pruneIntervalInserts;
      if (src.server.logRetentionDays !== undefined) config.logRetentionDays = src.server.logRetentionDays;
    }
  }

  // Env vars override everything
  if (process.env.SENTINEL_PORT) config.port = parseInt(process.env.SENTINEL_PORT, 10);
  if (process.env.SENTINEL_MAX_LOGS) config.maxLogs = parseInt(process.env.SENTINEL_MAX_LOGS, 10);

  return config;
}
