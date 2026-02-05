/**
 * Model Discovery
 *
 * Dynamically discovers available AI models based on the environment:
 * - Cursor IDE: Uses cursor CLI or known presets
 * - Claude Code: Fixed list (opus/sonnet/haiku)
 * - API providers: Fetches from REST APIs when API keys are available
 * - Fallback: Comprehensive presets for all major providers
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { ModelInfo, ModelDiscoveryResult } from '../commands/team/types.js';

const execAsync = promisify(exec);

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
  private cacheTTL = 24 * 60 * 60 * 1000; // 24 hours

  constructor(rootDir: string) {
    this.cacheFile = path.join(rootDir, '.paradigm', 'model-cache.json');
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
        result = this.getVSCodeModels();
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
    // IDE detection (highest priority)
    if (process.env.TERM_PROGRAM === 'cursor' || process.env.CURSOR_SESSION) {
      return 'cursor';
    }
    if (process.env.CLAUDE_CODE === '1' || process.env.TERM_PROGRAM === 'claude') {
      return 'claude-code';
    }
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
        return this.getAnthropicPresets();
      }

      const data = await response.json() as { data?: Array<{ id: string; display_name?: string }> };

      if (!data.data || data.data.length === 0) {
        return this.getAnthropicPresets();
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
      return this.getAnthropicPresets();
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
        return this.getOpenAIPresets();
      }

      const data = await response.json() as { data?: Array<{ id: string }> };

      if (!data.data) {
        return this.getOpenAIPresets();
      }

      // Filter to only chat models
      const chatModels = data.data.filter((m) =>
        m.id.includes('gpt-4') || m.id.includes('o1') || m.id.includes('o3')
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
      return this.getOpenAIPresets();
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
        return this.getGooglePresets();
      }

      const data = await response.json() as { models?: Array<{ name: string; displayName?: string }> };

      if (!data.models) {
        return this.getGooglePresets();
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
      return this.getGooglePresets();
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
        return this.getXAIPresets();
      }

      const data = await response.json() as { data?: Array<{ id: string }> };

      if (!data.data) {
        return this.getXAIPresets();
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
      return this.getXAIPresets();
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
      // Fallback to known Cursor models
      return {
        source: 'cursor',
        models: this.getCursorPresets(),
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
  private getVSCodeModels(): ModelDiscoveryResult {
    // VSCode with Copilot typically has access to GPT models
    return {
      source: 'vscode',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', family: 'gpt-4' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', family: 'gpt-4' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', family: 'gpt-4' },
        { id: 'o1', name: 'OpenAI o1', provider: 'openai', family: 'o1' },
        { id: 'o1-mini', name: 'OpenAI o1 Mini', provider: 'openai', family: 'o1' },
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
      { id: 'claude-3.5-opus', name: 'Claude 3.5 Opus', provider: 'anthropic', family: 'claude-3.5' },
      { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', family: 'claude-3.5' },
      { id: 'claude-3.5-haiku', name: 'Claude 3.5 Haiku', provider: 'anthropic', family: 'claude-3.5' },

      // OpenAI GPT models
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', family: 'gpt-4' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', family: 'gpt-4' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', family: 'gpt-4' },
      { id: 'o1', name: 'OpenAI o1', provider: 'openai', family: 'o1' },
      { id: 'o1-mini', name: 'OpenAI o1 Mini', provider: 'openai', family: 'o1' },
      { id: 'o3-mini', name: 'OpenAI o3 Mini', provider: 'openai', family: 'o3' },

      // Google Gemini models
      { id: 'gemini-2.0-pro', name: 'Gemini 2.0 Pro', provider: 'google', family: 'gemini-2' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', family: 'gemini-2' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'google', family: 'gemini-1.5' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'google', family: 'gemini-1.5' },

      // xAI Grok models
      { id: 'grok-2', name: 'Grok 2', provider: 'xai', family: 'grok' },
      { id: 'grok-2-mini', name: 'Grok 2 Mini', provider: 'xai', family: 'grok' },

      // Meta Llama models
      { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', provider: 'meta', family: 'llama-3' },
      { id: 'llama-3.2-90b', name: 'Llama 3.2 90B', provider: 'meta', family: 'llama-3' },

      // Mistral models
      { id: 'mistral-large', name: 'Mistral Large', provider: 'mistral', family: 'mistral' },
      { id: 'mistral-medium', name: 'Mistral Medium', provider: 'mistral', family: 'mistral' },
      { id: 'codestral', name: 'Codestral', provider: 'mistral', family: 'codestral' },

      // DeepSeek models
      { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'deepseek', family: 'deepseek' },
      { id: 'deepseek-coder', name: 'DeepSeek Coder', provider: 'deepseek', family: 'deepseek' },

      // Cohere models
      { id: 'command-r-plus', name: 'Command R+', provider: 'cohere', family: 'command' },
      { id: 'command-r', name: 'Command R', provider: 'cohere', family: 'command' },
    ];
  }

  /**
   * Get Anthropic preset models
   */
  private getAnthropicPresets(): ModelDiscoveryResult {
    return {
      source: 'anthropic-api',
      models: [
        { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', provider: 'anthropic', family: 'claude-4' },
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', family: 'claude-4' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', family: 'claude-3.5' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', family: 'claude-3.5' },
      ],
      cached: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get OpenAI preset models
   */
  private getOpenAIPresets(): ModelDiscoveryResult {
    return {
      source: 'openai',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', family: 'gpt-4' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', family: 'gpt-4' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', family: 'gpt-4' },
        { id: 'o1', name: 'OpenAI o1', provider: 'openai', family: 'o1' },
        { id: 'o1-mini', name: 'OpenAI o1 Mini', provider: 'openai', family: 'o1' },
      ],
      cached: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get Google preset models
   */
  private getGooglePresets(): ModelDiscoveryResult {
    return {
      source: 'google',
      models: [
        { id: 'gemini-2.0-pro', name: 'Gemini 2.0 Pro', provider: 'google', family: 'gemini-2' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', family: 'gemini-2' },
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'google', family: 'gemini-1.5' },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'google', family: 'gemini-1.5' },
      ],
      cached: false,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get xAI preset models
   */
  private getXAIPresets(): ModelDiscoveryResult {
    return {
      source: 'xai',
      models: [
        { id: 'grok-2', name: 'Grok 2', provider: 'xai', family: 'grok' },
        { id: 'grok-2-mini', name: 'Grok 2 Mini', provider: 'xai', family: 'grok' },
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
      [/claude-4|claude-opus-4|claude-sonnet-4/i, 'claude-4'],
      [/claude-3\.5|claude-3-5/i, 'claude-3.5'],
      [/claude-3/i, 'claude-3'],
      [/gpt-4o/i, 'gpt-4o'],
      [/gpt-4/i, 'gpt-4'],
      [/o1/i, 'o1'],
      [/o3/i, 'o3'],
      [/gemini-2/i, 'gemini-2'],
      [/gemini-1\.5/i, 'gemini-1.5'],
      [/grok/i, 'grok'],
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

      // Check for low-tier indicators (mini, flash, haiku, small)
      const isLowTier =
        name.includes('haiku') ||
        miniPattern.test(combined) ||
        (flashPattern.test(combined) && !name.includes('flash-thinking')) ||
        smallPattern.test(combined) ||
        name.includes('instant');

      // Check for high-tier indicators
      const isHighTier =
        name.includes('opus') ||
        (name.includes('gpt-4') && !miniPattern.test(combined)) ||
        (id.includes('o1') && !miniPattern.test(combined) && !id.includes('o1-')) ||
        id === 'o1' ||
        // Pro models (Gemini Pro, etc.) but not mini variants
        (id.includes('-pro') && !miniPattern.test(combined)) ||
        (id.includes('grok-2') && !miniPattern.test(combined)) ||
        name.includes('large') ||
        name.includes('command r+') ||
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
