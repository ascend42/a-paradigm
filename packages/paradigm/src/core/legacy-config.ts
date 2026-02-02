/**
 * Legacy Configuration Types (renamed from horizon-config.ts)
 * Defines the structure of .paradigm configuration files
 *
 * Note: "Horizon" was the original codename. Interface names kept for backwards compatibility.
 */

import * as yaml from 'js-yaml';

export interface HorizonConfig {
  version: string;
  project?: string;
  'agent-guidelines': AgentGuidelines;
  'symbol-system': SymbolSystem;
  states?: StateDefinitions;
  'purpose-required': PurposeRequirement[];
  conventions: string[];
  scan?: ScanSettings;
  logging?: LoggingConfig;
}

export interface LoggingConfig {
  /** Include logging rules in generated IDE instructions */
  enforce: boolean;
  /** Default log level */
  'default-level'?: 'debug' | 'info' | 'warn' | 'error';
  /** Map directory patterns to symbol types */
  'symbol-mapping'?: Record<string, string>;
}

export interface ScanSettings {
  /** Enable scan protocol in cursorrules */
  enabled: boolean;
  /** Auto-include scan protocol when scan-index.json exists */
  autoInclude: boolean;
  /** Custom visual tag mappings for components */
  visualTagMappings?: Record<string, string[]>;
  /** Screen definitions for better UI mapping */
  screens?: Record<string, {
    route?: string;
    components?: string[];
    features?: string[];
  }>;
  /** Custom instructions to include in scan protocol */
  customInstructions?: string[];
}

export interface AgentGuidelines {
  overview: string;
  'how-to-use': string[];
  'update-rules': string[];
}

export interface SymbolSystem {
  '@': SymbolDefinition; // Features
  '#': SymbolDefinition; // Components
  '$': SymbolDefinition; // Flows
  '%': SymbolDefinition; // States
  '~': SymbolDefinition; // Aspects
  '^': SymbolDefinition; // Gates
  '!': SymbolDefinition; // Signals
  '?': SymbolDefinition; // Ideas
}

export interface SymbolDefinition {
  name: string;
  description: string;
  owner: 'purpose' | 'gate' | 'dream' | 'shared';
  examples: string[];
}

export interface PurposeRequirement {
  pattern: string;
  depth: number;
}

export interface StateDefinitions {
  [category: string]: StateCategory;
}

export interface StateCategory {
  [stateName: string]: StateDefinition | boolean;
}

export interface StateDefinition {
  type: 'boolean' | 'enum' | 'array' | 'string' | 'number';
  default?: unknown;
  values?: string[];
  description?: string;
}

/**
 * Default symbol system definitions
 */
export const DEFAULT_SYMBOL_SYSTEM: SymbolSystem = {
  '@': {
    name: 'Feature',
    description: 'User-facing capabilities and functionality',
    owner: 'purpose',
    examples: ['@checkout', '@user-login', '@search']
  },
  '#': {
    name: 'Component',
    description: 'Reusable code units, UI components, or modules',
    owner: 'purpose',
    examples: ['#Button', '#api-client', '#AuthProvider']
  },
  '$': {
    name: 'Flow',
    description: 'Multi-step processes or user journeys',
    owner: 'shared',
    examples: ['$checkout-to-confirmation', '$auth-flow']
  },
  '%': {
    name: 'State',
    description: 'Global or user state conditions',
    owner: 'purpose',
    examples: ['%user.authenticated', '%cart.items']
  },
  '~': {
    name: 'Aspect',
    description: 'Cross-cutting concerns or nested properties',
    owner: 'purpose',
    examples: ['@login~validation', '#Button~disabled']
  },
  '^': {
    name: 'Gate',
    description: 'Access control points and authorization rules',
    owner: 'gate',
    examples: ['^auth-required', '^admin-panel', '^premium-checkout']
  },
  '!': {
    name: 'Signal',
    description: 'Events, errors, and side effects',
    owner: 'gate',
    examples: ['!payment-failed', '!login-success', '!rate-limited']
  },
  '?': {
    name: 'Idea',
    description: 'Free-form exploration and future possibilities',
    owner: 'dream',
    examples: ['?subscription-model', '?ai-recommendations']
  }
};

/**
 * Default conventions
 */
export const DEFAULT_CONVENTIONS: string[] = [
  'Use kebab-case for all symbol IDs (feature-name, not featureName)',
  'Document flows when logic spans 3+ components',
  'Reference related items using symbol prefixes (@ # $ % ~ ^ ! ?)',
  'Add descriptions to all features and gates',
  'Update .purpose files when changing feature behavior',
  'Keep gates minimal - one responsibility per gate',
  'Use signals for side effects, not direct state mutations'
];

/**
 * Default Horizon config
 */
export function getDefaultHorizonConfig(projectName: string): HorizonConfig {
  return {
    version: '1.0',
    'agent-guidelines': {
      overview: `${projectName} uses Horizon for structured planning and context management.`,
      'how-to-use': [
        'Check .purpose files in directories for context before making changes',
        'Run `horizon status` to see the project symbol index',
        'Run `horizon visualize` to explore the Dreamscape',
        'Reference symbols using prefixes: @feature #component ^gate',
        'Attach an image and say "horizon scan" to map UI to code'
      ],
      'update-rules': [
        'When adding a feature, create/update the nearest .purpose file',
        'When adding authorization, update portal.yaml',
        'When exploring ideas, add to .premise or use ?symbol prefix',
        'Always update references when renaming symbols'
      ]
    },
    'symbol-system': DEFAULT_SYMBOL_SYSTEM,
    states: {
      user: {
        authenticated: { type: 'boolean', default: false, description: 'User is logged in' },
        role: { type: 'enum', values: ['guest', 'user', 'admin'], description: 'User access level' }
      },
      app: {
        loading: { type: 'boolean', default: false, description: 'App is loading' }
      }
    },
    'purpose-required': [
      { pattern: 'src/features/*', depth: 1 },
      { pattern: 'src/components/*', depth: 1 }
    ],
    conventions: DEFAULT_CONVENTIONS,
    scan: {
      enabled: true,
      autoInclude: true
    }
  };
}

/**
 * Serialize config to YAML
 */
export function serializeHorizonConfig(config: HorizonConfig): string {
  return yaml.dump(config, { lineWidth: -1, quotingType: '"' });
}

/**
 * Parse YAML config
 */
export function parseHorizonConfig(content: string): HorizonConfig {
  return yaml.load(content) as HorizonConfig;
}
