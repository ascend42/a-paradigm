/**
 * Context Builder
 *
 * Builds role-specific context for agent facets.
 * Generates minimal, focused CLAUDE.md content per agent role.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { glob } from 'glob';
import { AgentDefinition } from '../commands/team/types.js';
import { AgentContext, FacetConfig } from './agent-provider.js';

// ============================================================================
// Types
// ============================================================================

interface ParadigmConfig {
  version: string;
  project: string;
  discipline?: string;
  'agent-guidelines'?: {
    overview?: string;
    'how-to-use'?: string[];
    'update-rules'?: string[];
  };
  'symbol-system'?: Record<string, {
    name: string;
    description: string;
    examples?: string[];
  }>;
  conventions?: string[];
}

interface ContextConfig {
  include?: string[];
  exclude?: string[];
}

// ============================================================================
// Symbol Extraction
// ============================================================================

const SYMBOL_PATTERN = /[@#$%^!?&~][a-zA-Z0-9_-]+/g;

/**
 * Extract Paradigm symbols from text
 */
export function extractSymbols(text: string): string[] {
  const matches = text.match(SYMBOL_PATTERN) || [];
  return [...new Set(matches)];
}

/**
 * Get symbol type from prefix
 */
export function getSymbolType(symbol: string): string {
  const prefix = symbol.charAt(0);
  const types: Record<string, string> = {
    '@': 'feature',
    '#': 'component',
    '$': 'flow',
    '%': 'state',
    '^': 'gate',
    '!': 'signal',
    '?': 'idea',
    '&': 'integration',
    '~': 'deprecated',
  };
  return types[prefix] || 'unknown';
}

// ============================================================================
// Context Builder
// ============================================================================

/**
 * Build agent context from task and role
 */
export async function buildAgentContext(
  agent: AgentDefinition,
  task: string,
  rootDir: string,
  facetConfig?: FacetConfig
): Promise<AgentContext> {
  const paradigmDir = path.join(rootDir, '.paradigm');

  // Extract symbols from task
  const taskSymbols = extractSymbols(task);

  // Determine context patterns based on agent and facet config
  const contextConfig = getContextPatterns(agent, facetConfig);

  // Expand patterns with task symbols
  const expandedInclude = expandPatterns(contextConfig.include || [], taskSymbols);
  const exclude = contextConfig.exclude || [];

  // Gather relevant files
  const files = await gatherFiles(rootDir, expandedInclude, exclude);

  // Build role-specific system prompt
  const systemPrompt = await buildRoleSpecificPrompt(agent, paradigmDir, taskSymbols);

  return {
    systemPrompt,
    files,
    symbols: taskSymbols,
  };
}

/**
 * Get context patterns for an agent
 */
function getContextPatterns(
  agent: AgentDefinition,
  facetConfig?: FacetConfig
): ContextConfig {
  // Priority: facetConfig > agent.context > defaults based on agent name
  if (facetConfig?.contextInclude || facetConfig?.contextExclude) {
    return {
      include: facetConfig.contextInclude,
      exclude: facetConfig.contextExclude,
    };
  }

  // Default patterns based on agent role
  const defaults: Record<string, ContextConfig> = {
    architect: {
      include: [
        'specs/*.md',
        '.purpose',
        '**/.purpose',
        'portal.yaml',
        '.paradigm/config.yaml',
      ],
      exclude: [
        'src/**',
        'tests/**',
        'node_modules/**',
        'dist/**',
      ],
    },
    builder: {
      include: [
        'src/**',
        'tests/**',
        '{feature}.purpose',
        'specs/{feature}.md',
      ],
      exclude: [
        'specs/*.md',
        'node_modules/**',
        'dist/**',
      ],
    },
    reviewer: {
      include: [
        'src/**',
        'specs/*.md',
        'portal.yaml',
        '.purpose',
      ],
      exclude: [
        'tests/**',
        'node_modules/**',
        'dist/**',
      ],
    },
    tester: {
      include: [
        'tests/**',
        'health.yaml',
        '{feature}.purpose',
      ],
      exclude: [
        'src/**',
        'specs/**',
        'node_modules/**',
        'dist/**',
      ],
    },
    security: {
      include: [
        'portal.yaml',
        'src/middleware/**',
        'src/auth/**',
        '.paradigm/wisdom/antipatterns.yaml',
      ],
      exclude: [
        'src/routes/**',
        'tests/**',
        'node_modules/**',
        'dist/**',
      ],
    },
  };

  return defaults[agent.name] || {
    include: ['.purpose', 'portal.yaml'],
    exclude: ['node_modules/**', 'dist/**'],
  };
}

/**
 * Expand {feature} and {symbol} placeholders in patterns
 */
function expandPatterns(patterns: string[], symbols: string[]): string[] {
  const expanded: string[] = [];

  for (const pattern of patterns) {
    if (pattern.includes('{feature}') || pattern.includes('{symbol}')) {
      // Expand for each symbol
      for (const symbol of symbols) {
        const name = symbol.substring(1); // Remove prefix
        expanded.push(
          pattern
            .replace(/\{feature\}/g, name)
            .replace(/\{symbol\}/g, name)
        );
      }
    } else {
      expanded.push(pattern);
    }
  }

  return expanded;
}

/**
 * Gather files matching include patterns, excluding exclude patterns
 */
async function gatherFiles(
  rootDir: string,
  include: string[],
  exclude: string[]
): Promise<string[]> {
  const files: Set<string> = new Set();

  for (const pattern of include) {
    try {
      const matches = await glob(pattern, {
        cwd: rootDir,
        ignore: exclude,
        nodir: true,
        absolute: false,
      });
      for (const match of matches) {
        files.add(match);
      }
    } catch {
      // Pattern didn't match anything
    }
  }

  return Array.from(files);
}

/**
 * Build role-specific system prompt
 */
async function buildRoleSpecificPrompt(
  agent: AgentDefinition,
  paradigmDir: string,
  symbols: string[]
): Promise<string> {
  const parts: string[] = [];

  // Load paradigm config
  const configPath = path.join(paradigmDir, 'config.yaml');
  let config: ParadigmConfig | null = null;

  if (fs.existsSync(configPath)) {
    try {
      config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as ParadigmConfig;
    } catch {
      // Ignore parse errors
    }
  }

  // Header
  parts.push(`# ${agent.name.charAt(0).toUpperCase() + agent.name.slice(1)} Agent Context\n`);

  // Project info
  if (config?.project) {
    parts.push(`> Project: ${config.project}`);
    if (config.discipline && config.discipline !== 'auto') {
      parts.push(`> Discipline: ${config.discipline}`);
    }
    parts.push('');
  }

  // Overview (trimmed for role)
  if (config?.['agent-guidelines']?.overview) {
    parts.push('## Project Overview\n');
    parts.push(config['agent-guidelines'].overview);
    parts.push('');
  }

  // Symbol system (always include for reference)
  if (config?.['symbol-system']) {
    parts.push('## Symbol System\n');
    parts.push('| Symbol | Meaning | Description |');
    parts.push('|--------|---------|-------------|');
    for (const [prefix, info] of Object.entries(config['symbol-system'])) {
      parts.push(`| \`${prefix}\` | ${info.name} | ${info.description} |`);
    }
    parts.push('');
  }

  // Conventions relevant to this role
  if (config?.conventions) {
    const roleConventions = filterConventionsForRole(config.conventions, agent.name);
    if (roleConventions.length > 0) {
      parts.push('## Conventions\n');
      for (const conv of roleConventions) {
        parts.push(`- ${conv}`);
      }
      parts.push('');
    }
  }

  // Symbols in scope
  if (symbols.length > 0) {
    parts.push('## Symbols in Scope\n');
    for (const symbol of symbols) {
      const type = getSymbolType(symbol);
      parts.push(`- \`${symbol}\` (${type})`);
    }
    parts.push('');
  }

  // Role-specific tips
  const tips = getRoleTips(agent.name);
  if (tips.length > 0) {
    parts.push('## Tips for This Role\n');
    for (const tip of tips) {
      parts.push(`- ${tip}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Filter conventions relevant to a role
 */
function filterConventionsForRole(conventions: string[], role: string): string[] {
  const roleKeywords: Record<string, string[]> = {
    architect: ['design', 'spec', 'document', 'flow', 'symbol', 'reference'],
    builder: ['code', 'implement', 'component', 'logger', 'test'],
    reviewer: ['review', 'portal', 'gate', 'check', 'validate'],
    tester: ['test', 'verify', 'health', 'validate'],
    security: ['portal', 'gate', 'auth', 'security', 'vulnerability'],
  };

  const keywords = roleKeywords[role] || [];

  return conventions.filter((conv) =>
    keywords.some((kw) => conv.toLowerCase().includes(kw))
  );
}

/**
 * Get role-specific tips
 */
function getRoleTips(role: string): string[] {
  const tips: Record<string, string[]> = {
    architect: [
      'Focus on design decisions, not implementation details',
      'Use paradigm symbols to reference features and components',
      'Document flows that span 3+ components',
      'Hand off to builder when spec is ready',
    ],
    builder: [
      'Follow the spec from architect exactly',
      'If spec is unclear, ask for clarification or hand back',
      'Use the Paradigm logger, not raw console.log',
      'Hand off to reviewer when implementation is ready',
    ],
    reviewer: [
      'Check that all ^gate requirements are met',
      'Verify adherence to specs',
      'Do NOT implement fixes - hand back to builder',
      'Approve or request changes with clear feedback',
    ],
    tester: [
      'Run tests and verify health status',
      'Check portal validations',
      'Update health.yaml when verified',
      'Report issues with reproduction steps',
    ],
    security: [
      'Focus on ^gate implementations',
      'Check for OWASP top 10 vulnerabilities',
      'Flag issues but do NOT implement fixes',
      'Review auth flows and session handling',
    ],
  };

  return tips[role] || [];
}

// ============================================================================
// Context Loading
// ============================================================================

/**
 * Load full context for solo mode (non-faceted)
 */
export async function loadFullContext(rootDir: string): Promise<AgentContext> {
  const paradigmDir = path.join(rootDir, '.paradigm');
  const claudeMdPath = path.join(rootDir, 'CLAUDE.md');

  let systemPrompt = '';

  // Read CLAUDE.md if it exists
  if (fs.existsSync(claudeMdPath)) {
    systemPrompt = fs.readFileSync(claudeMdPath, 'utf-8');
  } else {
    // Fallback to building from config
    const configPath = path.join(paradigmDir, 'config.yaml');
    if (fs.existsSync(configPath)) {
      const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as ParadigmConfig;
      systemPrompt = `# ${config.project || 'Project'}\n\n`;
      if (config['agent-guidelines']?.overview) {
        systemPrompt += config['agent-guidelines'].overview;
      }
    }
  }

  // Gather all relevant files
  const files = await glob('**/.purpose', { cwd: rootDir, ignore: ['node_modules/**'] });
  files.push('portal.yaml', '.paradigm/config.yaml', '.paradigm/agents.yaml');

  return {
    systemPrompt,
    files: files.filter((f) => fs.existsSync(path.join(rootDir, f))),
    symbols: [],
  };
}

/**
 * Estimate token count for context
 */
export function estimateTokens(context: AgentContext, rootDir: string): number {
  // Rough estimate: ~4 characters per token
  let chars = context.systemPrompt.length;

  for (const file of context.files) {
    const filePath = path.join(rootDir, file);
    if (fs.existsSync(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        chars += stat.size;
      } catch {
        // Ignore
      }
    }
  }

  return Math.ceil(chars / 4);
}

/**
 * Compare context sizes between full and role-specific
 */
export async function compareContextSizes(
  agent: AgentDefinition,
  task: string,
  rootDir: string
): Promise<{ full: number; roleSpecific: number; savings: number }> {
  const fullContext = await loadFullContext(rootDir);
  const roleContext = await buildAgentContext(agent, task, rootDir);

  const fullTokens = estimateTokens(fullContext, rootDir);
  const roleTokens = estimateTokens(roleContext, rootDir);
  const savings = Math.round(((fullTokens - roleTokens) / fullTokens) * 100);

  return {
    full: fullTokens,
    roleSpecific: roleTokens,
    savings,
  };
}
