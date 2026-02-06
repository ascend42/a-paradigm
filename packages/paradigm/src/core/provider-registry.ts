/**
 * Provider Registry
 *
 * Manages agent providers with configurable selection:
 *
 * Priority (highest to lowest):
 * 1. CLI flag: --provider <name>
 * 2. Environment: PARADIGM_AGENT_PROVIDER=<name>
 * 3. Config: agent-provider in .paradigm/config.yaml
 * 4. Auto-detect cascade (if config says "auto" or not set)
 *
 * Available providers:
 * - claude: Anthropic API (requires ANTHROPIC_API_KEY)
 * - claude-code-teams: Claude Code Agent Teams (experimental, parallel)
 * - claude-code: Claude Code Task tool (works with Max)
 * - cursor-cli: Cursor agent CLI (works in Cursor IDE)
 * - claude-cli: Claude CLI spawning (works with Max)
 * - manual: File-based handoff (always works)
 * - auto: Auto-detect best available (default)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AgentProvider, AgentModel } from './agent-provider.js';

// ============================================================================
// Registry State
// ============================================================================

const providers = new Map<string, AgentProvider>();
let defaultProviderName: string | null = null;
let initialized = false;

// Provider priority order (best to fallback)
// claude-code-teams is prioritized when Agent Teams is enabled
// cursor-cli is prioritized when running in Cursor environment
const PROVIDER_PRIORITY = ['claude', 'claude-code-teams', 'claude-code', 'cursor-cli', 'claude-cli', 'manual'];

// Valid provider names (including 'auto' for auto-detection)
const VALID_PROVIDERS = ['auto', ...PROVIDER_PRIORITY];

// Cached config
let configuredProvider: string | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Register a provider
 */
export function registerProvider(provider: AgentProvider): void {
  providers.set(provider.name, provider);
}

/**
 * Get a provider by name (or best available)
 */
export function getProvider(name?: string): AgentProvider | null {
  // If specific name requested, return it
  if (name && providers.has(name)) {
    return providers.get(name) || null;
  }

  // Otherwise return default (best available)
  if (defaultProviderName && providers.has(defaultProviderName)) {
    return providers.get(defaultProviderName) || null;
  }

  return null;
}

/**
 * Get the configured provider preference
 *
 * Priority:
 * 1. Environment variable: PARADIGM_AGENT_PROVIDER
 * 2. Config file: .paradigm/config.yaml -> agent-provider
 * 3. Default: 'auto'
 */
export function getConfiguredProvider(rootDir?: string): string {
  // 1. Check environment variable
  const envProvider = process.env.PARADIGM_AGENT_PROVIDER;
  if (envProvider && VALID_PROVIDERS.includes(envProvider)) {
    return envProvider;
  }

  // 2. Check config file
  if (configuredProvider !== null) {
    return configuredProvider;
  }

  const dir = rootDir || process.cwd();
  const configPath = path.join(dir, '.paradigm', 'config.yaml');

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = yaml.load(content) as Record<string, unknown>;
      const provider = config['agent-provider'] as string | undefined;
      if (provider && VALID_PROVIDERS.includes(provider)) {
        configuredProvider = provider;
        return provider;
      }
    } catch {
      // Ignore config errors
    }
  }

  // 3. Default to auto
  return 'auto';
}

/**
 * Set provider preference in config
 */
export async function setConfiguredProvider(
  provider: string,
  rootDir?: string
): Promise<void> {
  if (!VALID_PROVIDERS.includes(provider)) {
    throw new Error(`Invalid provider: ${provider}. Valid options: ${VALID_PROVIDERS.join(', ')}`);
  }

  const dir = rootDir || process.cwd();
  const configPath = path.join(dir, '.paradigm', 'config.yaml');

  let config: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      config = yaml.load(content) as Record<string, unknown>;
    } catch {
      // Start fresh
    }
  }

  config['agent-provider'] = provider;
  configuredProvider = provider;

  // Ensure directory exists
  const paradigmDir = path.dirname(configPath);
  if (!fs.existsSync(paradigmDir)) {
    fs.mkdirSync(paradigmDir, { recursive: true });
  }

  fs.writeFileSync(configPath, yaml.dump(config));
}

/**
 * Get the best available provider
 *
 * If a specific provider is configured, use that (with fallback on failure).
 * If 'auto' or not configured, cascade through priority order.
 */
export async function getBestProvider(
  rootDir?: string,
  explicitProvider?: string
): Promise<{
  provider: AgentProvider;
  name: string;
  reason: string;
  configured: boolean;
}> {
  await initializeProviders(rootDir);

  // Determine which provider to try first
  const configured = explicitProvider || getConfiguredProvider(rootDir);
  const isExplicit = configured !== 'auto';

  // If explicit provider requested, try it first
  if (isExplicit) {
    const provider = providers.get(configured);
    if (provider) {
      try {
        const available = await provider.isAvailable();
        if (available) {
          return {
            provider,
            name: configured,
            reason: `Configured: ${getProviderReason(configured)}`,
            configured: true,
          };
        }
      } catch {
        // Fall through to cascade
      }
      // Provider configured but not available - warn and fall back
      console.warn(`Configured provider '${configured}' not available, falling back...`);
    }
  }

  // Auto-detect cascade
  for (const name of PROVIDER_PRIORITY) {
    const provider = providers.get(name);
    if (!provider) continue;

    try {
      const available = await provider.isAvailable();
      if (available) {
        return {
          provider,
          name,
          reason: isExplicit
            ? `Fallback: ${getProviderReason(name)} (configured '${configured}' unavailable)`
            : getProviderReason(name),
          configured: false,
        };
      }
    } catch {
      // Provider check failed, try next
    }
  }

  // Should never reach here since manual is always available
  throw new Error('No providers available');
}

/**
 * Get all available providers (for display)
 */
export async function getAvailableProviders(rootDir?: string): Promise<Array<{
  name: string;
  available: boolean;
  reason: string;
  features: {
    parallel: boolean;
    mcp: boolean;
    billing: 'api' | 'subscription' | 'none';
  };
}>> {
  await initializeProviders(rootDir);

  const results = [];

  for (const name of PROVIDER_PRIORITY) {
    const provider = providers.get(name);
    if (!provider) continue;

    let available = false;
    try {
      available = await provider.isAvailable();
    } catch {
      // Provider check failed
    }

    results.push({
      name,
      available,
      reason: available ? getProviderReason(name) : getProviderUnavailableReason(name),
      features: {
        parallel: provider.supportsParallel(),
        mcp: provider.supportsMcp(),
        billing: getProviderBilling(name),
      },
    });
  }

  return results;
}

/**
 * Set the default provider explicitly
 */
export function setDefaultProvider(name: string): void {
  if (!providers.has(name)) {
    throw new Error(`Provider '${name}' not registered`);
  }
  defaultProviderName = name;
}

/**
 * List all registered providers
 */
export function listProviders(): string[] {
  return Array.from(providers.keys());
}

/**
 * Check if a provider is registered
 */
export function hasProvider(name: string): boolean {
  return providers.has(name);
}

/**
 * Get available models across all providers
 */
export function getAvailableModels(): AgentModel[] {
  const models = new Set<AgentModel>();
  for (const provider of providers.values()) {
    for (const model of provider.listModels()) {
      models.add(model);
    }
  }
  return Array.from(models);
}

// ============================================================================
// Provider Discovery
// ============================================================================

/**
 * Initialize and discover available providers
 */
export async function initializeProviders(rootDir?: string): Promise<void> {
  if (initialized) return;

  const dir = rootDir || process.cwd();

  // Register providers in priority order
  try {
    const { ClaudeAgentProvider } = await import('./providers/claude.js');
    registerProvider(new ClaudeAgentProvider());
  } catch {
    // Claude API provider not available
  }

  try {
    const { ClaudeCodeTeamsProvider } = await import('./providers/claude-code-teams.js');
    registerProvider(new ClaudeCodeTeamsProvider(dir));
  } catch {
    // Claude Code Teams provider not available
  }

  try {
    const { ClaudeCodeTaskProvider } = await import('./providers/claude-code.js');
    registerProvider(new ClaudeCodeTaskProvider(dir));
  } catch {
    // Claude Code provider not available
  }

  try {
    const { CursorCliProvider } = await import('./providers/cursor-cli.js');
    registerProvider(new CursorCliProvider());
  } catch {
    // Cursor CLI provider not available
  }

  try {
    const { ClaudeCliProvider } = await import('./providers/claude-cli.js');
    registerProvider(new ClaudeCliProvider());
  } catch {
    // Claude CLI provider not available
  }

  try {
    const { ManualProvider } = await import('./providers/manual.js');
    registerProvider(new ManualProvider(dir));
  } catch {
    // Manual provider not available (should never fail)
  }

  // Find best available provider
  for (const name of PROVIDER_PRIORITY) {
    const provider = providers.get(name);
    if (provider) {
      try {
        const available = await provider.isAvailable();
        if (available) {
          defaultProviderName = name;
          break;
        }
      } catch {
        // Continue to next
      }
    }
  }

  // Fallback to manual if nothing else available
  if (!defaultProviderName && providers.has('manual')) {
    defaultProviderName = 'manual';
  }

  initialized = true;
}

/**
 * Reset the registry (for testing)
 */
export function resetRegistry(): void {
  providers.clear();
  defaultProviderName = null;
  initialized = false;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getProviderReason(name: string): string {
  switch (name) {
    case 'claude':
      return 'Using Anthropic API (ANTHROPIC_API_KEY found)';
    case 'claude-code-teams':
      return 'Using Claude Code Agent Teams (experimental, parallel teammates)';
    case 'claude-code':
      return 'Using Claude Code Task tool (running in Claude Code)';
    case 'cursor-cli':
      return 'Using Cursor agent CLI (running in Cursor)';
    case 'claude-cli':
      return 'Using Claude CLI (claude command found)';
    case 'manual':
      return 'Using manual handoff (no automation available)';
    default:
      return 'Unknown provider';
  }
}

function getProviderUnavailableReason(name: string): string {
  switch (name) {
    case 'claude':
      return 'ANTHROPIC_API_KEY not set';
    case 'claude-code-teams':
      return 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS not set or not in Claude Code';
    case 'claude-code':
      return 'Not running inside Claude Code';
    case 'cursor-cli':
      return 'Not running in Cursor or agent CLI not found';
    case 'claude-cli':
      return 'claude CLI not found in PATH';
    case 'manual':
      return 'Should always be available';
    default:
      return 'Unknown';
  }
}

function getProviderBilling(name: string): 'api' | 'subscription' | 'none' {
  switch (name) {
    case 'claude':
      return 'api';
    case 'claude-code-teams':
    case 'claude-code':
    case 'cursor-cli':
    case 'claude-cli':
      return 'subscription';
    case 'manual':
      return 'none';
    default:
      return 'none';
  }
}
