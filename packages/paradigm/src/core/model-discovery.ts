/**
 * Model Discovery
 *
 * Dynamically discovers available AI models based on the environment:
 * 1. API providers: Fetches live model lists when API keys are available
 * 2. Remote manifest: Fetches models.json from GitHub (updated without CLI release)
 * 3. Hardcoded fallback: Last-resort presets compiled into the CLI
 *
 * Environments: Cursor IDE, Claude Code, VSCode, multi-provider, fallback
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { ModelInfo, ModelDiscoveryResult } from '../commands/team/types.js';

const execAsync = promisify(exec);

/** Remote manifest URL — update models.json in the repo to push new models without a CLI release */
const MANIFEST_URL = 'https://raw.githubusercontent.com/ascend42/a-paradigm/main/models.json';
const MANIFEST_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Detected environment type
 */
export type EnvironmentType =
  | 'cursor'
  | 'claude-code'
  | 'vscode'
  | 'multi-provider'
  | 'fallback';

/**
 * Model Discovery class
 *
 * Discovers available AI models based on the current environment
 */
export class ModelDiscovery {
  private cacheFile: string;
  private manifestCacheFile: string;
  private cacheTTL = 24 * 60 * 60 * 1000; // 24 hours
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.cacheFile = path.join(rootDir, '.paradigm', 'model-cache.json');
    this.manifestCacheFile = path.join(rootDir, '.paradigm', 'model-manifest-cache.json');
  }

  /**
   * Fetch the remote model manifest (cached for 7 days).
   * Returns null on any failure — callers fall back to hardcoded presets.
   */
  private async fetchManifest(): Promise<Record<string, any> | null> {
    // Check manifest cache
    try {
      if (fs.existsSync(this.manifestCacheFile)) {
        const raw = fs.readFileSync(this.manifestCacheFile, 'utf8');
        const cached = JSON.parse(raw);
        const age = Date.now() - new Date(cached._fetchedAt).getTime();
        if (age < MANIFEST_CACHE_TTL) {
          return cached;
        }
      }
    } catch {
      // Ignore corrupt cache
    }

    // Fetch fresh
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(MANIFEST_URL, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) return null;

      const manifest = await response.json() as Record<string, any>;

      // Cache it
      try {
        const dir = path.dirname(this.manifestCacheFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.manifestCacheFile, JSON.stringify({ ...manifest, _fetchedAt: new Date().toISOString() }, null, 2));
      } catch {
        // Ignore cache write errors
      }

      return manifest;
    } catch {
      return null;
    }
  }

  /**
   * Get models for a provider from the remote manifest.
   * Returns null if manifest unavailable or provider not found.
   */
  private async getManifestModels(provider: string): Promise<ModelInfo[] | null> {
    const manifest = await this.fetchManifest();
    if (!manifest?.providers?.[provider]) return null;
    return manifest.providers[provider] as ModelInfo[];
  }

  /**
   * Get environment-specific models from the remote manifest.
   * Returns null if manifest unavailable or environment not found.
   */
  private async getManifestEnvironment(env: string): Promise<ModelInfo[] | null> {
    const manifest = await this.fetchManifest();
    if (!manifest?.environments?.[env]) return null;

    const envConfig = manifest.environments[env];

    // Direct model list
    if (envConfig.models) {
      return envConfig.models as ModelInfo[];
    }

    // Include-based: aggregate models from listed providers
    if (envConfig.include) {
      const models: ModelInfo[] = [];
      for (const providerName of envConfig.include) {
        const providerModels = manifest.providers?.[providerName];
        if (providerModels) {
          models.push(...(providerModels as ModelInfo[]));
        }
      }
      return models.length > 0 ? models : null;
    }

    return null;
  }

  /**
   * Discover available models
   */
  async discover(): Promise<ModelDiscoveryResult> {
    // Check cache first
    const cached = this.loadCache();
    if (cached) return cached;

    // Detect environment and discover models
    const env = this.detectEnvironment();
    let result: ModelDiscoveryResult;

    switch (env) {
      case 'cursor':
        result = await this.discoverCursorModels();
        break;
      case 'claude-code':
        result = this.getClaudeCodeModels();
        break;
      case 'vscode':
        result = await this.getVSCodeModels();
        break;
      case 'multi-provider':
        result = await this.discoverMultiProviderModels();
        break;
      default:
        result = this.getFallbackModels();
    }

    // Cache the result
    this.saveCache(result);
    return result;
  }

  /**
   * Detect the current environment
   */
  detectEnvironment(): EnvironmentType {
    // Claude Code detection (highest priority)
    if (process.env.CLAUDE_CODE === '1' || process.env.TERM_PROGRAM === 'claude') {
      return 'claude-code';
    }

    // Cursor detection - Cursor is VSCode-based but has specific indicators
    // Check for Cursor-specific env vars or paths
    if (
      process.env.TERM_PROGRAM === 'cursor' ||
      process.env.CURSOR_SESSION ||
      process.env.CURSOR_TRACE_ID ||
      // Cursor sets VSCODE_* vars but with cursor in the path
      (process.env.VSCODE_CWD && process.env.VSCODE_CWD.toLowerCase().includes('cursor')) ||
      (process.env.VSCODE_NLS_CONFIG && process.env.VSCODE_NLS_CONFIG.toLowerCase().includes('cursor')) ||
      // Check if running in Cursor's integrated terminal
      (process.env.TERM_PROGRAM === 'vscode' && process.env.VSCODE_GIT_ASKPASS_NODE?.toLowerCase().includes('cursor'))
    ) {
      return 'cursor';
    }

    // VSCode detection (after Cursor check)
    if (process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_PID) {
      return 'vscode';
    }

    // API key detection - use all available
    const providers = this.getAvailableProviders();
    if (providers.length > 0) {
      return 'multi-provider';
    }

    return 'fallback';
  }

  /**
   * Get list of providers with configured API keys
   */
  getAvailableProviders(): string[] {
    const providers: string[] = [];
    if (process.env.ANTHROPIC_API_KEY) providers.push('anthropic');
    if (process.env.OPENAI_API_KEY) providers.push('openai');
    if (process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) providers.push('google');
    if (process.env.XAI_API_KEY) providers.push('xai');
    if (process.env.MISTRAL_API_KEY) providers.push('mistral');
    if (process.env.DEEPSEEK_API_KEY) providers.push('deepseek');
    if (process.env.COHERE_API_KEY) providers.push('cohere');
    if (process.env.OPENROUTER_API_KEY) providers.push('openrouter');
    return providers;
  }

  /**
   * Discover models from all available providers
   */
  private async discoverMultiProviderModels(): Promise<ModelDiscoveryResult> {
    const providers = this.getAvailableProviders();
    const allModels: ModelInfo[] = [];

    // Fetch from each available provider in parallel
    const discoveries = await Promise.allSettled(
      providers.map(provider => this.discoverProviderModels(provider))
    );

    for (const result of discoveries) {
      if (result.status === 'fulfilled' && result.value) {
        allModels.push(...result.value.models);
      }
    }

    // If no API keys returned models, use comprehensive presets
    if (allModels.length === 0) {
      return this.getFallbackModels();
    }

    return {
      source: 'multi-provider',
      models: allModels,
      cached: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Discover models for a specific provider
   */
  private async discoverProviderModels(provider: string): Promise<ModelDiscoveryResult | null> {
    switch (provider) {
      case 'anthropic':
        return this.discoverAnthropicModels();
      case 'openai':
        return this.discoverOpenAIModels();
      case 'google':
        return this.discoverGoogleModels();
      case 'xai':
        return this.discoverXAIModels();
      case 'openrouter':
        return this.discoverOpenRouterModels();
      default:
        return null;
    }
  }

  /**
   * Discover Anthropic models via API
   */
  private async discoverAnthropicModels(): Promise<ModelDiscoveryResult> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
      });

      if (!response.ok) {
        return await this.getAnthropicPresets();
      }

      const data = await response.json() as { data?: Array<{ id: string; display_name?: string }> };

      if (!data.data || data.data.length === 0) {
        return await this.getAnthropicPresets();
      }

      return {
        source: 'anthropic-api',
        models: data.data.map((m) => ({
          id: m.id,
          name: m.display_name || this.formatModelName(m.id),
          provider: 'anthropic',
          family: this.extractFamily(m.id, 'claude'),
        })),
        cached: false,
        timestamp: new Date().toISOString(),
      };
    } catch {
      return await this.getAnthropicPresets();
    }
  }

  /**
   * Discover OpenAI models via API
   */
  private async discoverOpenAIModels(): Promise<ModelDiscoveryResult> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      });

      if (!response.ok) {
        return await this.getOpenAIPresets();
      }

      const data = await response.json() as { data?: Array<{ id: string }> };

      if (!data.data) {
        return await this.getOpenAIPresets();
      }

      // Filter to only chat models
      const chatModels = data.data.filter((m) =>
        m.id.includes('gpt-4') || m.id.includes('o1') || m.id.includes('o3') || m.id.includes('o4')
      );

      return {
        source: 'openai',
        models: chatModels.map((m) => ({
          id: m.id,
          name: this.formatModelName(m.id),
          provider: 'openai',
          family: this.extractFamily(m.id, 'gpt'),
        })),
        cached: false,
        timestamp: new Date().toISOString(),
      };
    } catch {
      return await this.getOpenAIPresets();
    }
  }

  /**
   * Discover Google models via API
   */
  private async discoverGoogleModels(): Promise<ModelDiscoveryResult> {
    try {
      const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );

      if (!response.ok) {
        return await this.getGooglePresets();
      }

      const data = await response.json() as { models?: Array<{ name: string; displayName?: string }> };

      if (!data.models) {
        return await this.getGooglePresets();
      }

      return {
        source: 'google',
        models: data.models
          .filter((m) => m.name.includes('gemini'))
          .map((m) => ({
            id: m.name.replace('models/', ''),
            name: m.displayName || this.formatModelName(m.name),
            provider: 'google',
            family: 'gemini',
          })),
        cached: false,
        timestamp: new Date().toISOString(),
      };
    } catch {
      return await this.getGooglePresets();
    }
  }

  /**
   * Discover xAI/Grok models via API
   */
  private async discoverXAIModels(): Promise<ModelDiscoveryResult> {
    try {
      const response = await fetch('https://api.x.ai/v1/models', {
        headers: { 'Authorization': `Bearer ${process.env.XAI_API_KEY}` },
      });

      if (!response.ok) {
        return await this.getXAIPresets();
      }

      const data = await response.json() as { data?: Array<{ id: string }> };

      if (!data.data) {
        return await this.getXAIPresets();
      }

      return {
        source: 'xai',
        models: data.data.map((m) => ({
          id: m.id,
          name: m.id.includes('grok') ? `Grok ${m.id.split('-').pop()}` : m.id,
          provider: 'xai',
          family: 'grok',
        })),
        cached: false,
        timestamp: new Date().toISOString(),
      };
    } catch {
      return await this.getXAIPresets();
    }
  }

  /**
   * Discover OpenRouter models via API
   */
  private async discoverOpenRouterModels(): Promise<ModelDiscoveryResult> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` },
      });

      if (!response.ok) {
        return { source: 'openrouter', models: [], cached: false, timestamp: new Date().toISOString() };
      }

      const data = await response.json() as { data?: Array<{ id: string; name?: string }> };

      if (!data.data) {
        return { source: 'openrouter', models: [], cached: false, timestamp: new Date().toISOString() };
      }

      // Get top models by different providers
      return {
        source: 'openrouter',
        models: data.data.slice(0, 30).map((m) => ({
          id: m.id,
          name: m.name || m.id,
          provider: m.id.split('/')[0] || 'openrouter',
        })),
        cached: false,
        timestamp: new Date().toISOString(),
      };
    } catch {
      return { source: 'openrouter', models: [], cached: false, timestamp: new Date().toISOString() };
    }
  }

  /**
   * Discover Cursor models
   */
  private async discoverCursorModels(): Promise<ModelDiscoveryResult> {
    try {
      // Try Cursor CLI (may not exist)
      const { stdout } = await execAsync('cursor agent models --json', { timeout: 5000 });
      const models = JSON.parse(stdout) as ModelInfo[];
      return {
        source: 'cursor',
        models: models.map(m => this.normalizeModel(m)),
        cached: false,
        timestamp: new Date().toISOString(),
      };
    } catch {
      // Try remote manifest → hardcoded presets
      const manifest = await this.getManifestEnvironment('cursor');
      return {
        source: manifest ? 'cursor-manifest' : 'cursor',
        models: manifest || this.getCursorPresets(),
        cached: false,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get Claude Code models (fixed list)
   */
  getClaudeCodeModels(): ModelDiscoveryResult {
    return {
      source: 'claude-code',
      models: [
        { id: 'opus', name: 'Claude Opus', provider: 'anthropic', family: 'claude' },
        { id: 'sonnet', name: 'Claude Sonnet', provider: 'anthropic', family: 'claude' },
        { id: 'haiku', name: 'Claude Haiku', provider: 'anthropic', family: 'claude' },
      ],
      cached: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get VSCode/Copilot models
   */
  private async getVSCodeModels(): Promise<ModelDiscoveryResult> {
    // Try remote manifest first
    const manifest = await this.getManifestEnvironment('vscode');
    if (manifest) {
      return { source: 'vscode-manifest', models: manifest, cached: false, timestamp: new Date().toISOString() };
    }

    // Hardcoded fallback
    return {
      source: 'vscode',
      models: [
        { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', family: 'gpt-4.1' },
        { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai', family: 'gpt-4.1' },
        { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'openai', family: 'gpt-4.1' },
        { id: 'o3', name: 'OpenAI o3', provider: 'openai', family: 'o3' },
        { id: 'o4-mini', name: 'OpenAI o4 Mini', provider: 'openai', family: 'o4' },
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'anthropic', family: 'claude-4' },
      ],
      cached: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get comprehensive preset models for Cursor
   */
  private getCursorPresets(): ModelInfo[] {
    return [
      // Anthropic Claude models
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', family: 'claude-4' },
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'anthropic', family: 'claude-4' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', family: 'claude-4' },

      // OpenAI GPT models
      { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', family: 'gpt-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai', family: 'gpt-4.1' },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'openai', family: 'gpt-4.1' },
      { id: 'o3', name: 'OpenAI o3', provider: 'openai', family: 'o3' },
      { id: 'o4-mini', name: 'OpenAI o4 Mini', provider: 'openai', family: 'o4' },
      { id: 'o3-mini', name: 'OpenAI o3 Mini', provider: 'openai', family: 'o3' },

      // Google Gemini models
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', family: 'gemini-2.5' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', family: 'gemini-2.5' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', family: 'gemini-2' },

      // xAI Grok models
      { id: 'grok-3', name: 'Grok 3', provider: 'xai', family: 'grok' },
      { id: 'grok-3-mini', name: 'Grok 3 Mini', provider: 'xai', family: 'grok' },

      // Meta Llama models
      { id: 'llama-4-scout', name: 'Llama 4 Scout', provider: 'meta', family: 'llama-4' },
      { id: 'llama-4-maverick', name: 'Llama 4 Maverick', provider: 'meta', family: 'llama-4' },

      // Mistral models
      { id: 'mistral-large', name: 'Mistral Large', provider: 'mistral', family: 'mistral' },
      { id: 'codestral', name: 'Codestral', provider: 'mistral', family: 'codestral' },

      // DeepSeek models
      { id: 'deepseek-r1', name: 'DeepSeek R1', provider: 'deepseek', family: 'deepseek' },
      { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'deepseek', family: 'deepseek' },

      // Cohere models
      { id: 'command-r-plus', name: 'Command R+', provider: 'cohere', family: 'command' },
      { id: 'command-r', name: 'Command R', provider: 'cohere', family: 'command' },
    ];
  }

  /**
   * Get Anthropic preset models (manifest → hardcoded)
   */
  private async getAnthropicPresets(): Promise<ModelDiscoveryResult> {
    const manifest = await this.getManifestModels('anthropic');
    if (manifest) {
      return { source: 'anthropic-manifest', models: manifest, cached: false, timestamp: new Date().toISOString() };
    }
    return {
      source: 'anthropic-api',
      models: [
        { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', family: 'claude-4' },
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'anthropic', family: 'claude-4' },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', family: 'claude-4' },
      ],
      cached: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get OpenAI preset models (manifest → hardcoded)
   */
  private async getOpenAIPresets(): Promise<ModelDiscoveryResult> {
    const manifest = await this.getManifestModels('openai');
    if (manifest) {
      return { source: 'openai-manifest', models: manifest, cached: false, timestamp: new Date().toISOString() };
    }
    return {
      source: 'openai',
      models: [
        { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', family: 'gpt-4.1' },
        { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai', family: 'gpt-4.1' },
        { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'openai', family: 'gpt-4.1' },
        { id: 'o3', name: 'OpenAI o3', provider: 'openai', family: 'o3' },
        { id: 'o4-mini', name: 'OpenAI o4 Mini', provider: 'openai', family: 'o4' },
        { id: 'o3-mini', name: 'OpenAI o3 Mini', provider: 'openai', family: 'o3' },
      ],
      cached: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get Google preset models (manifest → hardcoded)
   */
  private async getGooglePresets(): Promise<ModelDiscoveryResult> {
    const manifest = await this.getManifestModels('google');
    if (manifest) {
      return { source: 'google-manifest', models: manifest, cached: false, timestamp: new Date().toISOString() };
    }
    return {
      source: 'google',
      models: [
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', family: 'gemini-2.5' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', family: 'gemini-2.5' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', family: 'gemini-2' },
      ],
      cached: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get xAI preset models (manifest → hardcoded)
   */
  private async getXAIPresets(): Promise<ModelDiscoveryResult> {
    const manifest = await this.getManifestModels('xai');
    if (manifest) {
      return { source: 'xai-manifest', models: manifest, cached: false, timestamp: new Date().toISOString() };
    }
    return {
      source: 'xai',
      models: [
        { id: 'grok-3', name: 'Grok 3', provider: 'xai', family: 'grok' },
        { id: 'grok-3-mini', name: 'Grok 3 Mini', provider: 'xai', family: 'grok' },
      ],
      cached: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get fallback models (basic Claude models)
   */
  getFallbackModels(): ModelDiscoveryResult {
    return {
      source: 'fallback',
      models: [
        { id: 'opus', name: 'Claude Opus', provider: 'anthropic', family: 'claude' },
        { id: 'sonnet', name: 'Claude Sonnet', provider: 'anthropic', family: 'claude' },
        { id: 'haiku', name: 'Claude Haiku', provider: 'anthropic', family: 'claude' },
      ],
      cached: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Normalize a model from external source
   */
  private normalizeModel(model: ModelInfo): ModelInfo {
    return {
      id: model.id,
      name: model.name || this.formatModelName(model.id),
      provider: model.provider || 'unknown',
      family: model.family,
      capabilities: model.capabilities,
    };
  }

  /**
   * Format a model ID into a human-readable name
   */
  private formatModelName(id: string): string {
    return id
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/(\d)([a-z])/gi, '$1 $2');
  }

  /**
   * Extract model family from ID
   */
  private extractFamily(id: string, defaultFamily: string): string {
    const patterns: Array<[RegExp, string]> = [
      [/claude-4|claude-opus-4|claude-sonnet-4|claude-haiku-4/i, 'claude-4'],
      [/claude-3\.5|claude-3-5/i, 'claude-3.5'],
      [/claude-3/i, 'claude-3'],
      [/gpt-4\.1/i, 'gpt-4.1'],
      [/gpt-4o/i, 'gpt-4o'],
      [/gpt-4/i, 'gpt-4'],
      [/o4/i, 'o4'],
      [/o3/i, 'o3'],
      [/o1/i, 'o1'],
      [/gemini-2\.5/i, 'gemini-2.5'],
      [/gemini-2/i, 'gemini-2'],
      [/gemini-1\.5/i, 'gemini-1.5'],
      [/grok/i, 'grok'],
      [/llama-4/i, 'llama-4'],
      [/llama/i, 'llama'],
      [/mistral/i, 'mistral'],
    ];

    for (const [pattern, family] of patterns) {
      if (pattern.test(id)) {
        return family;
      }
    }

    return defaultFamily;
  }

  /**
   * Load cached models
   */
  private loadCache(): ModelDiscoveryResult | null {
    try {
      if (!fs.existsSync(this.cacheFile)) {
        return null;
      }

      const content = fs.readFileSync(this.cacheFile, 'utf8');
      const cached = JSON.parse(content) as ModelDiscoveryResult;

      // Check if cache is expired
      const cacheTime = new Date(cached.timestamp).getTime();
      if (Date.now() - cacheTime > this.cacheTTL) {
        return null;
      }

      return { ...cached, cached: true };
    } catch {
      return null;
    }
  }

  /**
   * Save models to cache
   */
  private saveCache(result: ModelDiscoveryResult): void {
    try {
      const dir = path.dirname(this.cacheFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.cacheFile, JSON.stringify(result, null, 2));
    } catch {
      // Ignore cache write errors
    }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    try {
      if (fs.existsSync(this.cacheFile)) {
        fs.unlinkSync(this.cacheFile);
      }
    } catch {
      // Ignore cache clear errors
    }
  }

  /**
   * Get models grouped by tier (high/medium/low)
   */
  groupByTier(models: ModelInfo[]): {
    high: ModelInfo[];
    medium: ModelInfo[];
    low: ModelInfo[];
  } {
    const high: ModelInfo[] = [];
    const medium: ModelInfo[] = [];
    const low: ModelInfo[] = [];

    // Word boundary patterns (match "mini" but not "gemini")
    const miniPattern = /\bmini\b/i;
    const flashPattern = /\bflash\b/i;
    const smallPattern = /\bsmall\b/i;

    for (const model of models) {
      const name = model.name.toLowerCase();
      const id = model.id.toLowerCase();
      const combined = `${name} ${id}`;

      // Check for low-tier indicators (mini, flash, haiku, nano, small)
      const isLowTier =
        name.includes('haiku') ||
        miniPattern.test(combined) ||
        name.includes('nano') ||
        (flashPattern.test(combined) && !name.includes('flash-thinking')) ||
        smallPattern.test(combined) ||
        name.includes('scout') ||
        name.includes('instant');

      // Check for high-tier indicators
      const isHighTier =
        name.includes('opus') ||
        (name.includes('gpt-4') && !miniPattern.test(combined) && !name.includes('nano')) ||
        (id.includes('gpt-4.1') && !miniPattern.test(combined) && !id.includes('nano')) ||
        (id === 'o3' || (id.includes('o3') && !miniPattern.test(combined))) ||
        (id === 'o1' || (id.includes('o1') && !miniPattern.test(combined) && !id.includes('o1-'))) ||
        // Pro models (Gemini Pro, etc.) but not mini variants
        (id.includes('-pro') && !miniPattern.test(combined)) ||
        (id.includes('grok-3') && !miniPattern.test(combined)) ||
        (id.includes('grok-2') && !miniPattern.test(combined)) ||
        name.includes('large') ||
        name.includes('maverick') ||
        name.includes('command r+') ||
        id.includes('deepseek-r1') ||
        id.includes('deepseek-v3');

      if (isLowTier) {
        low.push(model);
      } else if (isHighTier) {
        high.push(model);
      } else {
        // Medium tier: sonnet, medium, balanced models
        medium.push(model);
      }
    }

    return { high, medium, low };
  }
}
