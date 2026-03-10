/**
 * Discipline Detection & Per-Discipline Configuration
 *
 * Examines project structure to infer the development discipline,
 * and provides discipline-specific symbol mappings, scan patterns,
 * and purpose-required paths.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Discipline, PurposeRequirement } from './paradigm-config.js';

// ============================================================================
// Types
// ============================================================================

export interface DisciplineConfig {
  /** Directory pattern → symbol type mapping for logging */
  symbolMapping: Record<string, string>;
  /** Where .purpose files should exist */
  purposeRequired: PurposeRequirement[];
  /** Example symbols for this discipline */
  examples: Record<string, string[]>;
}

export interface StackPreset {
  /** Unique preset ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Parent discipline */
  discipline: Discipline;
  /** Directory pattern → symbol type overrides (merged over discipline defaults) */
  symbolMapping: Record<string, string>;
  /** Where .purpose files should exist */
  purposeRequired: PurposeRequirement[];
  /** Hints for auto-scan to find framework-specific patterns */
  scanHints: {
    componentPatterns: string[];
    routePatterns: string[];
    authPatterns: string[];
    statePatterns: string[];
  };
  /** Auto-detection function — returns true if project matches this stack */
  detectFn: (rootDir: string) => boolean;
}

// ============================================================================
// Detection
// ============================================================================

/**
 * Detect the project discipline from its file structure and dependencies.
 *
 * Heuristics are ordered by specificity — the first match wins.
 * This is a best-guess; users can always override in config.yaml.
 */
export function detectDiscipline(rootDir: string): Discipline {
  const pkg = readPackageJson(rootDir);
  const pkgDeps = (pkg?.dependencies ?? {}) as Record<string, unknown>;
  const pkgDevDeps = (pkg?.devDependencies ?? {}) as Record<string, unknown>;
  const deps: Record<string, unknown> = { ...pkgDeps, ...pkgDevDeps };
  const hasDep = (name: string) => name in deps;

  // --- Monorepo ---
  if (pkg?.workspaces || fs.existsSync(path.join(rootDir, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(rootDir, 'lerna.json'))) {
    return 'monorepo';
  }

  // --- Node/JS ecosystem ---
  if (pkg) {
    // CLI
    if (pkg.bin && !hasUICode(rootDir, deps)) {
      return 'cli';
    }

    // Library (has exports/main, no bin, no UI deps)
    if ((pkg.exports || pkg.main) && !pkg.bin && !hasUIDeps(deps) && !hasServerDeps(deps)) {
      return 'library';
    }

    // React Native / Expo → mobile (BEFORE generic UI check, since RN has `react` in deps)
    if (hasDep('react-native') || hasDep('expo')) {
      return 'mobile';
    }

    // SSR frameworks → fullstack
    if (hasDep('next') || hasDep('nuxt') || hasDep('@sveltejs/kit') || hasDep('remix') || hasDep('@remix-run/node') || hasDep('astro')) {
      return 'fullstack';
    }

    // Frontend-only
    if (hasUIDeps(deps) && !hasServerDeps(deps)) {
      return 'web';
    }

    // API-only (server deps, no UI deps)
    if (hasServerDeps(deps) && !hasUIDeps(deps)) {
      return 'api';
    }

    // Both UI + server deps
    if (hasUIDeps(deps) && hasServerDeps(deps)) {
      return 'fullstack';
    }

    // ML/Data in JS (rare but possible)
    if (hasDep('@tensorflow/tfjs') || hasDep('onnxruntime-node')) {
      return 'ml';
    }
  }

  // --- Python ecosystem ---
  const pyProject = readFileIfExists(rootDir, 'pyproject.toml');
  const requirements = readFileIfExists(rootDir, 'requirements.txt');
  const pyDeps = (pyProject || '') + (requirements || '');

  if (pyDeps) {
    // ML
    if (/torch|tensorflow|scikit-learn|transformers|jax/i.test(pyDeps)) {
      return 'ml';
    }
    // Data
    if (/dbt|airflow|prefect|dagster|spark|pandas(?!.*flask)(?!.*django)/i.test(pyDeps)) {
      return 'data';
    }
    // Fullstack (Django with templates or Flask with templates)
    if (fs.existsSync(path.join(rootDir, 'manage.py')) && fs.existsSync(path.join(rootDir, 'templates'))) {
      return 'fullstack';
    }
    // API
    if (/fastapi|flask|django-rest-framework|djangorestframework|starlette/i.test(pyDeps)) {
      return 'api';
    }
    if (fs.existsSync(path.join(rootDir, 'manage.py'))) {
      return 'fullstack';
    }
    // CLI
    if (/click|typer|argparse|fire/i.test(pyDeps) && !fs.existsSync(path.join(rootDir, 'manage.py'))) {
      return 'cli';
    }
  }

  // --- Go ecosystem ---
  if (fs.existsSync(path.join(rootDir, 'go.mod'))) {
    if (fs.existsSync(path.join(rootDir, 'cmd'))) {
      return 'cli';
    }
    const goMod = readFileIfExists(rootDir, 'go.mod') || '';
    if (/gin|echo|fiber|chi|gorilla\/mux/i.test(goMod)) {
      return 'api';
    }
    return 'backend';
  }

  // --- Rust ecosystem ---
  const cargoToml = readFileIfExists(rootDir, 'Cargo.toml');
  if (cargoToml) {
    if (/embedded-hal|no_std|cortex-m/i.test(cargoToml)) {
      return 'embedded';
    }
    if (/clap|structopt/i.test(cargoToml)) {
      return 'cli';
    }
    if (/actix-web|axum|rocket|warp/i.test(cargoToml)) {
      return 'api';
    }
    if (/bevy|ggez|macroquad/i.test(cargoToml)) {
      return 'game';
    }
    if (/tauri/i.test(cargoToml)) {
      return 'fullstack';
    }
    return 'backend';
  }

  // --- Mobile ---
  if (fs.existsSync(path.join(rootDir, 'pubspec.yaml'))) {
    return 'mobile'; // Flutter
  }
  if (fs.existsSync(path.join(rootDir, 'ios')) && fs.existsSync(path.join(rootDir, 'android'))) {
    return 'mobile';
  }

  // --- Game ---
  if (
    fs.existsSync(path.join(rootDir, 'project.godot')) ||
    fs.existsSync(path.join(rootDir, 'ProjectSettings')) || // Unity
    hasFilesMatching(rootDir, '.pretend')
  ) {
    return 'game';
  }

  // --- DevOps/Infra ---
  if (
    fs.existsSync(path.join(rootDir, 'terraform')) ||
    fs.existsSync(path.join(rootDir, 'main.tf')) ||
    fs.existsSync(path.join(rootDir, 'pulumi')) ||
    fs.existsSync(path.join(rootDir, 'ansible.cfg')) ||
    (fs.existsSync(path.join(rootDir, 'Dockerfile')) && !pkg)
  ) {
    return 'devops';
  }

  // --- Embedded (PlatformIO) ---
  if (fs.existsSync(path.join(rootDir, 'platformio.ini'))) {
    return 'embedded';
  }

  // Fallback
  return 'backend';
}

// ============================================================================
// Per-Discipline Mappings
// ============================================================================

export const DISCIPLINE_MAPPINGS: Record<Exclude<Discipline, 'auto' | 'custom'>, DisciplineConfig> = {
  web: {
    symbolMapping: {
      'components/**': '#',
      'pages/**': '#',
      'views/**': '#',
      'hooks/**': '#',
      'stores/**': '#',
      'state/**': '#',
      'utils/**': '#',
      'lib/**': '#',
      'services/**': '#',
      'middleware/**': '^',
      'auth/**': '^',
      'guards/**': '^',
      'events/**': '!',
      'handlers/**': '!',
      'flows/**': '$',
      'aspects/**': '~',
      'rules/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/components/*', depth: 1 },
      { pattern: 'src/pages/*', depth: 1 },
      { pattern: 'src/features/*', depth: 1 },
    ],
    examples: {
      '#': ['#LoginForm', '#useAuth', '#CartStore', '#api-client'],
      '$': ['$checkout-flow', '$onboarding'],
      '^': ['^authenticated', '^admin-only'],
      '!': ['!form-submit', '!notification-sent'],
      '~': ['~rate-limited', '~csrf-protected'],
    },
  },

  backend: {
    symbolMapping: {
      'services/**': '#',
      'routes/**': '#',
      'api/**': '#',
      'models/**': '#',
      'lib/**': '#',
      'utils/**': '#',
      'core/**': '#',
      'config/**': '#',
      'middleware/**': '^',
      'auth/**': '^',
      'guards/**': '^',
      'policies/**': '^',
      'events/**': '!',
      'handlers/**': '!',
      'listeners/**': '!',
      'flows/**': '$',
      'workflows/**': '$',
      'pipelines/**': '$',
      'aspects/**': '~',
      'rules/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/services/*', depth: 1 },
      { pattern: 'src/routes/*', depth: 1 },
      { pattern: 'src/api/*', depth: 1 },
    ],
    examples: {
      '#': ['#users-create', '#database', '#cache', '#postgres-client'],
      '$': ['$order-fulfillment', '$data-sync'],
      '^': ['^api-key-required', '^rate-limited'],
      '!': ['!order-created', '!email-sent'],
      '~': ['~audit-logged', '~encrypted'],
    },
  },

  fullstack: {
    symbolMapping: {
      'components/**': '#',
      'pages/**': '#',
      'views/**': '#',
      'hooks/**': '#',
      'stores/**': '#',
      'services/**': '#',
      'routes/**': '#',
      'api/**': '#',
      'models/**': '#',
      'lib/**': '#',
      'utils/**': '#',
      'core/**': '#',
      'config/**': '#',
      'middleware/**': '^',
      'auth/**': '^',
      'guards/**': '^',
      'policies/**': '^',
      'events/**': '!',
      'handlers/**': '!',
      'listeners/**': '!',
      'flows/**': '$',
      'workflows/**': '$',
      'aspects/**': '~',
      'rules/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/components/*', depth: 1 },
      { pattern: 'src/pages/*', depth: 1 },
      { pattern: 'src/api/*', depth: 1 },
      { pattern: 'src/services/*', depth: 1 },
    ],
    examples: {
      '#': ['#LoginPage', '#api-users', '#UserService', '#stripe-client'],
      '$': ['$checkout-flow', '$auth-flow'],
      '^': ['^authenticated', '^admin-only'],
      '!': ['!order-created', '!notification-sent'],
      '~': ['~rate-limited', '~audit-required'],
    },
  },

  api: {
    symbolMapping: {
      'routes/**': '#',
      'endpoints/**': '#',
      'controllers/**': '#',
      'services/**': '#',
      'models/**': '#',
      'lib/**': '#',
      'utils/**': '#',
      'core/**': '#',
      'config/**': '#',
      'middleware/**': '^',
      'auth/**': '^',
      'guards/**': '^',
      'policies/**': '^',
      'events/**': '!',
      'handlers/**': '!',
      'listeners/**': '!',
      'webhooks/**': '!',
      'flows/**': '$',
      'workflows/**': '$',
      'pipelines/**': '$',
      'aspects/**': '~',
      'rules/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/routes/*', depth: 1 },
      { pattern: 'src/services/*', depth: 1 },
      { pattern: 'src/endpoints/*', depth: 1 },
    ],
    examples: {
      '#': ['#users-endpoint', '#OrderService', '#database', '#redis-client'],
      '$': ['$order-processing', '$webhook-ingestion'],
      '^': ['^api-key-required', '^rate-limited', '^authenticated'],
      '!': ['!request-received', '!order-created'],
      '~': ['~audit-logged', '~validated', '~idempotent'],
    },
  },

  cli: {
    symbolMapping: {
      'commands/**': '#',
      'cmd/**': '#',
      'lib/**': '#',
      'utils/**': '#',
      'core/**': '#',
      'config/**': '#',
      'handlers/**': '!',
      'events/**': '!',
      'flows/**': '$',
      'workflows/**': '$',
      'aspects/**': '~',
      'rules/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/commands/*', depth: 1 },
      { pattern: 'cmd/*', depth: 1 },
    ],
    examples: {
      '#': ['#init-command', '#config-loader', '#output-formatter'],
      '$': ['$setup-flow', '$migration-flow'],
      '^': ['^config-valid', '^version-check'],
      '!': ['!command-complete', '!error-occurred'],
      '~': ['~logged', '~validated'],
    },
  },

  ml: {
    symbolMapping: {
      'models/**': '#',
      'data/**': '#',
      'experiments/**': '#',
      'notebooks/**': '#',
      'features/**': '#',
      'utils/**': '#',
      'lib/**': '#',
      'config/**': '#',
      'pipelines/**': '$',
      'training/**': '$',
      'evaluation/**': '#',
      'preprocessing/**': '#',
      'auth/**': '^',
      'events/**': '!',
      'aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'models/*', depth: 1 },
      { pattern: 'pipelines/*', depth: 1 },
      { pattern: 'experiments/*', depth: 1 },
    ],
    examples: {
      '#': ['#classifier-v2', '#dataloader', '#feature-extractor', '#wandb-client'],
      '$': ['$training-pipeline', '$data-ingestion', '$evaluation-pipeline'],
      '^': ['^data-scientist', '^production-only'],
      '!': ['!epoch-complete', '!drift-detected', '!training-finished'],
      '~': ['~reproducible', '~versioned'],
    },
  },

  mobile: {
    symbolMapping: {
      'screens/**': '#',
      'components/**': '#',
      'widgets/**': '#',
      'services/**': '#',
      'stores/**': '#',
      'state/**': '#',
      'hooks/**': '#',
      'utils/**': '#',
      'lib/**': '#',
      'native/**': '#',
      'navigation/**': '$',
      'flows/**': '$',
      'middleware/**': '^',
      'auth/**': '^',
      'permissions/**': '^',
      'events/**': '!',
      'handlers/**': '!',
      'aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/screens/*', depth: 1 },
      { pattern: 'src/components/*', depth: 1 },
    ],
    examples: {
      '#': ['#home-screen', '#camera-capture', '#bottom-sheet', '#push-service'],
      '$': ['$onboarding', '$purchase-flow'],
      '^': ['^camera-permission', '^premium-user'],
      '!': ['!push-received', '!app-backgrounded'],
      '~': ['~offline-capable', '~encrypted-storage'],
    },
  },

  game: {
    symbolMapping: {
      'gameplay/**': '#',
      'systems/**': '#',
      'entities/**': '#',
      'components/**': '#',
      'scenes/**': '#',
      'ui/**': '#',
      'utils/**': '#',
      'lib/**': '#',
      'core/**': '#',
      'config/**': '#',
      'events/**': '!',
      'triggers/**': '!',
      'flows/**': '$',
      'sequences/**': '$',
      'auth/**': '^',
      'aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'gameplay/*', depth: 1 },
      { pattern: 'systems/*', depth: 1 },
      { pattern: 'entities/*', depth: 1 },
    ],
    examples: {
      '#': ['#attack', '#inventory', '#player', '#enemy-ai'],
      '$': ['$combat-loop', '$tutorial-sequence'],
      '^': ['^multiplayer-session', '^dev-mode'],
      '!': ['!enemy-killed', '!level-complete'],
      '~': ['~deterministic', '~network-synced'],
    },
  },

  embedded: {
    symbolMapping: {
      'drivers/**': '#',
      'hal/**': '#',
      'bsp/**': '#',
      'src/**': '#',
      'lib/**': '#',
      'utils/**': '#',
      'config/**': '#',
      'protocols/**': '$',
      'flows/**': '$',
      'auth/**': '^',
      'security/**': '^',
      'events/**': '!',
      'interrupts/**': '!',
      'aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/drivers/*', depth: 1 },
      { pattern: 'src/*', depth: 1 },
    ],
    examples: {
      '#': ['#spi-driver', '#gpio-handler', '#mqtt-client', '#read-sensor'],
      '$': ['$boot-sequence', '$handshake', '$firmware-update'],
      '^': ['^secure-boot', '^authenticated-cmd'],
      '!': ['!data-ready', '!watchdog-timeout'],
      '~': ['~power-optimized', '~real-time'],
    },
  },

  devops: {
    symbolMapping: {
      'modules/**': '#',
      'terraform/**': '#',
      'ansible/**': '#',
      'scripts/**': '#',
      'lib/**': '#',
      'config/**': '#',
      'pipelines/**': '$',
      'workflows/**': '$',
      'ci/**': '$',
      'auth/**': '^',
      'policies/**': '^',
      'alerts/**': '!',
      'monitoring/**': '!',
      'aspects/**': '~',
      'rules/**': '~',
    },
    purposeRequired: [
      { pattern: 'modules/*', depth: 1 },
      { pattern: 'terraform/*', depth: 1 },
      { pattern: 'pipelines/*', depth: 1 },
    ],
    examples: {
      '#': ['#vpc-module', '#backup-script', '#deploy', '#aws-client'],
      '$': ['$release-pipeline', '$disaster-recovery'],
      '^': ['^admin-access', '^vpc-restricted'],
      '!': ['!high-cpu', '!deployment-failed'],
      '~': ['~immutable-infra', '~zero-downtime'],
    },
  },

  data: {
    symbolMapping: {
      'models/**': '#',
      'dbt/**': '#',
      'transforms/**': '#',
      'sources/**': '#',
      'utils/**': '#',
      'lib/**': '#',
      'config/**': '#',
      'pipelines/**': '$',
      'dags/**': '$',
      'workflows/**': '$',
      'orchestration/**': '$',
      'auth/**': '^',
      'policies/**': '^',
      'events/**': '!',
      'alerts/**': '!',
      'aspects/**': '~',
      'tests/**': '~',
    },
    purposeRequired: [
      { pattern: 'models/*', depth: 1 },
      { pattern: 'pipelines/*', depth: 1 },
      { pattern: 'dags/*', depth: 1 },
    ],
    examples: {
      '#': ['#users-model', '#data-source', '#transform-revenue', '#snowflake-client'],
      '$': ['$etl-pipeline', '$daily-refresh', '$data-quality-check'],
      '^': ['^analyst-only', '^pii-access'],
      '!': ['!pipeline-complete', '!data-quality-fail'],
      '~': ['~idempotent', '~schema-validated'],
    },
  },

  library: {
    symbolMapping: {
      'src/**': '#',
      'lib/**': '#',
      'utils/**': '#',
      'core/**': '#',
      'config/**': '#',
      'events/**': '!',
      'handlers/**': '!',
      'flows/**': '$',
      'aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/*', depth: 1 },
      { pattern: 'lib/*', depth: 1 },
    ],
    examples: {
      '#': ['#parser', '#formatter', '#validator', '#client'],
      '$': ['$build-pipeline', '$publish-flow'],
      '^': ['^version-check', '^config-valid'],
      '!': ['!parse-error', '!validation-failed'],
      '~': ['~tree-shakeable', '~backwards-compatible'],
    },
  },

  monorepo: {
    symbolMapping: {
      'packages/**': '#',
      'apps/**': '#',
      'services/**': '#',
      'libs/**': '#',
      'shared/**': '#',
      'tools/**': '#',
      'config/**': '#',
      'middleware/**': '^',
      'auth/**': '^',
      'events/**': '!',
      'handlers/**': '!',
      'flows/**': '$',
      'pipelines/**': '$',
      'aspects/**': '~',
      'rules/**': '~',
    },
    purposeRequired: [
      { pattern: 'packages/*', depth: 1 },
      { pattern: 'apps/*', depth: 1 },
    ],
    examples: {
      '#': ['#web-app', '#api-server', '#shared-ui', '#config-loader'],
      '$': ['$deploy-all', '$release-pipeline'],
      '^': ['^authenticated', '^admin-only'],
      '!': ['!build-complete', '!package-published'],
      '~': ['~consistent-versions', '~shared-config'],
    },
  },
};

/**
 * The generic/fallback symbol mapping used when discipline is 'auto' (and detection
 * fails) or 'custom'. This is the union of all common patterns.
 */
export const GENERIC_SYMBOL_MAPPING: Record<string, string> = {
  'features/**': '#',
  'routes/**': '#',
  'api/**': '#',
  'endpoints/**': '#',
  'commands/**': '#',
  'models/**': '#',
  'components/**': '#',
  'lib/**': '#',
  'utils/**': '#',
  'services/**': '#',
  'core/**': '#',
  'drivers/**': '#',
  'systems/**': '#',
  'stores/**': '#',
  'state/**': '#',
  'reducers/**': '#',
  'config/**': '#',
  'integrations/**': '#',
  'external/**': '#',
  'vendors/**': '#',
  'middleware/**': '^',
  'auth/**': '^',
  'guards/**': '^',
  'policies/**': '^',
  'events/**': '!',
  'handlers/**': '!',
  'listeners/**': '!',
  'hooks/**': '!',
  'flows/**': '$',
  'sagas/**': '$',
  'workflows/**': '$',
  'pipelines/**': '$',
  'aspects/**': '~',
  'rules/**': '~',
};

/**
 * Get the discipline config for a given discipline.
 * Returns the specific mapping for known disciplines, or the generic fallback.
 */
export function getDisciplineConfig(discipline: Discipline): DisciplineConfig {
  if (discipline === 'auto' || discipline === 'custom') {
    return {
      symbolMapping: GENERIC_SYMBOL_MAPPING,
      purposeRequired: [
        { pattern: 'src/*', depth: 1 },
        { pattern: 'lib/*', depth: 1 },
        { pattern: 'packages/*', depth: 1 },
      ],
      examples: {
        '#': ['#checkout', '#login-handler', '#Button', '#stripe-client'],
        '$': ['$checkout-flow', '$onboarding', '$auth-flow'],
        '^': ['^authenticated', '^admin-only', '^rate-limited'],
        '!': ['!login-success', '!payment-failed', '!rate-limited'],
        '~': ['~audit-required', '~rate-limited', '~cached'],
      },
    };
  }
  return DISCIPLINE_MAPPINGS[discipline];
}

/**
 * Get discipline-specific scan patterns for auto-scan.
 * Returns additional file patterns to look for based on discipline.
 */
export function getDisciplineScanPatterns(discipline: Discipline): {
  components: string[];
  routes: string[];
  auth: string[];
} {
  const base = {
    components: [] as string[],
    routes: [] as string[],
    auth: [] as string[],
  };

  switch (discipline) {
    case 'ml':
      base.components.push('models/**/*.py', 'notebooks/**/*.ipynb', 'experiments/**/*.py', 'data/**/*.py');
      base.routes.push('pipelines/**/*.py', 'training/**/*.py');
      break;
    case 'game':
      base.components.push('entities/**/*.{ts,rs,cs,gd}', 'systems/**/*.{ts,rs,cs,gd}', 'gameplay/**/*.{ts,rs,cs,gd}', 'scenes/**/*.{ts,rs,cs,gd}');
      break;
    case 'embedded':
      base.components.push('drivers/**/*.{c,h,rs}', 'hal/**/*.{c,h,rs}', 'bsp/**/*.{c,h}');
      base.routes.push('protocols/**/*.{c,h,rs}');
      break;
    case 'data':
      base.components.push('models/**/*.sql', 'dbt/**/*.sql', 'transforms/**/*.{py,sql}', 'sources/**/*.yml');
      base.routes.push('dags/**/*.py', 'pipelines/**/*.py', 'orchestration/**/*.py');
      break;
    case 'devops':
      base.components.push('modules/**/*.tf', 'terraform/**/*.tf', 'ansible/**/*.yml', 'scripts/**/*.sh');
      base.routes.push('pipelines/**/*.yml', 'workflows/**/*.yml', '.github/workflows/**/*.yml');
      break;
    case 'cli':
      base.components.push('commands/**/*.{ts,go,rs,py}', 'cmd/**/*.go');
      break;
    case 'mobile':
      base.components.push('screens/**/*.{tsx,dart,swift,kt}', 'widgets/**/*.dart');
      base.routes.push('navigation/**/*.{ts,tsx,dart}');
      break;
    case 'monorepo':
      base.components.push('packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}');
      break;
    default:
      break;
  }

  return base;
}

// ============================================================================
// Helpers
// ============================================================================

function readPackageJson(rootDir: string): Record<string, unknown> | null {
  const pkgPath = path.join(rootDir, 'package.json');
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
}

function readFileIfExists(rootDir: string, filename: string): string | null {
  const filePath = path.join(rootDir, filename);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function hasUIDeps(deps: Record<string, unknown>): boolean {
  const uiPackages = ['react', 'vue', '@angular/core', 'svelte', 'solid-js', 'preact', 'lit'];
  return uiPackages.some((p) => p in deps);
}

function hasServerDeps(deps: Record<string, unknown>): boolean {
  const serverPackages = ['express', 'fastify', 'hono', 'koa', 'nestjs', '@nestjs/core', 'hapi', '@hapi/hapi'];
  return serverPackages.some((p) => p in deps);
}

function hasUICode(rootDir: string, deps: Record<string, unknown>): boolean {
  if (hasUIDeps(deps)) return true;
  // Check for common UI directories
  return (
    fs.existsSync(path.join(rootDir, 'src', 'components')) ||
    fs.existsSync(path.join(rootDir, 'src', 'pages'))
  );
}

function hasFilesMatching(rootDir: string, extension: string): boolean {
  try {
    const entries = fs.readdirSync(rootDir);
    return entries.some((e) => e.endsWith(extension));
  } catch {
    return false;
  }
}

// ============================================================================
// Stack Presets
// ============================================================================

export const STACK_PRESETS: Record<string, StackPreset> = {
  // --- Fullstack ---
  nextjs: {
    id: 'nextjs',
    name: 'Next.js',
    discipline: 'fullstack',
    symbolMapping: {
      'app/**/page.tsx': '#',
      'app/**/layout.tsx': '#',
      'app/**/loading.tsx': '#',
      'app/**/error.tsx': '#',
      'app/api/**': '#',
      'pages/**': '#',
      'pages/api/**': '#',
      'components/**': '#',
      'lib/**': '#',
      'hooks/**': '#',
      'stores/**': '#',
      'utils/**': '#',
      'services/**': '#',
      'config/**': '#',
      'middleware.ts': '^',
      'app/api/auth/**': '^',
      'events/**': '!',
      'handlers/**': '!',
      'flows/**': '$',
      'aspects/**': '~',
      'rules/**': '~',
    },
    purposeRequired: [
      { pattern: 'app/*', depth: 1 },
      { pattern: 'app/api/*', depth: 1 },
      { pattern: 'components/*', depth: 1 },
      { pattern: 'lib/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['app/**/page.tsx', 'app/**/layout.tsx', 'components/**/*.tsx', 'pages/**/*.tsx'],
      routePatterns: ['app/api/**/route.ts', 'app/**/page.tsx', 'pages/api/**/*.ts'],
      authPatterns: ['middleware.ts', 'app/api/auth/**', 'lib/auth.*'],
      statePatterns: ['stores/**', 'lib/*store*', 'lib/*context*'],
    },
    detectFn: (dir) => {
      try { return fs.readdirSync(dir).some((f) => f.startsWith('next.config')); } catch { return false; }
    },
  },

  remix: {
    id: 'remix',
    name: 'Remix',
    discipline: 'fullstack',
    symbolMapping: {
      'app/routes/**': '#',
      'app/components/**': '#',
      'app/models/**': '#',
      'app/utils/**': '#',
      'app/lib/**': '#',
      'app/services/**': '#',
      'app/hooks/**': '#',
      'app/stores/**': '#',
      'app/config/**': '#',
      'app/middleware/**': '^',
      'app/auth/**': '^',
      'app/events/**': '!',
      'app/flows/**': '$',
      'app/aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'app/routes/*', depth: 1 },
      { pattern: 'app/components/*', depth: 1 },
      { pattern: 'app/models/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['app/routes/**/*.tsx', 'app/components/**/*.tsx'],
      routePatterns: ['app/routes/**/*.tsx'],
      authPatterns: ['app/utils/auth.*', 'app/services/auth.*'],
      statePatterns: ['app/utils/*session*', 'app/models/**'],
    },
    detectFn: (dir) => {
      try { return fs.readdirSync(dir).some((f) => f.startsWith('remix.config')); } catch { return false; }
    },
  },

  nuxt: {
    id: 'nuxt',
    name: 'Nuxt',
    discipline: 'fullstack',
    symbolMapping: {
      'pages/**': '#',
      'components/**': '#',
      'composables/**': '#',
      'server/api/**': '#',
      'server/routes/**': '#',
      'server/utils/**': '#',
      'utils/**': '#',
      'stores/**': '#',
      'plugins/**': '#',
      'layouts/**': '#',
      'server/middleware/**': '^',
      'middleware/**': '^',
      'server/plugins/**': '!',
      'flows/**': '$',
      'aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'pages/*', depth: 1 },
      { pattern: 'components/*', depth: 1 },
      { pattern: 'server/api/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['pages/**/*.vue', 'components/**/*.vue', 'layouts/**/*.vue'],
      routePatterns: ['server/api/**/*.ts', 'server/routes/**/*.ts', 'pages/**/*.vue'],
      authPatterns: ['server/middleware/auth.*', 'middleware/auth.*', 'server/utils/auth.*'],
      statePatterns: ['stores/**/*.ts', 'composables/use*State*'],
    },
    detectFn: (dir) => {
      try { return fs.readdirSync(dir).some((f) => f.startsWith('nuxt.config')); } catch { return false; }
    },
  },

  sveltekit: {
    id: 'sveltekit',
    name: 'SvelteKit',
    discipline: 'fullstack',
    symbolMapping: {
      'src/routes/**': '#',
      'src/lib/**': '#',
      'src/lib/components/**': '#',
      'src/lib/server/**': '#',
      'src/lib/stores/**': '#',
      'src/lib/utils/**': '#',
      'src/hooks.*': '^',
      'src/lib/auth/**': '^',
      'src/lib/events/**': '!',
      'src/lib/flows/**': '$',
      'src/lib/aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/routes/*', depth: 1 },
      { pattern: 'src/lib/components/*', depth: 1 },
      { pattern: 'src/lib/server/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['src/routes/**/+page.svelte', 'src/lib/components/**/*.svelte'],
      routePatterns: ['src/routes/**/+server.ts', 'src/routes/**/+page.server.ts'],
      authPatterns: ['src/hooks.server.ts', 'src/lib/auth/**', 'src/lib/server/auth.*'],
      statePatterns: ['src/lib/stores/**'],
    },
    detectFn: (dir) => {
      try { return fs.readdirSync(dir).some((f) => f.startsWith('svelte.config')); } catch { return false; }
    },
  },

  astro: {
    id: 'astro',
    name: 'Astro',
    discipline: 'fullstack',
    symbolMapping: {
      'src/pages/**': '#',
      'src/components/**': '#',
      'src/layouts/**': '#',
      'src/content/**': '#',
      'src/lib/**': '#',
      'src/utils/**': '#',
      'src/middleware.*': '^',
      'src/events/**': '!',
      'src/flows/**': '$',
      'src/aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/pages/*', depth: 1 },
      { pattern: 'src/components/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['src/pages/**/*.astro', 'src/components/**/*.astro', 'src/layouts/**/*.astro'],
      routePatterns: ['src/pages/**/*.astro', 'src/pages/api/**/*.ts'],
      authPatterns: ['src/middleware.*'],
      statePatterns: ['src/content/**'],
    },
    detectFn: (dir) => {
      try { return fs.readdirSync(dir).some((f) => f.startsWith('astro.config')); } catch { return false; }
    },
  },

  // --- Web (SPA) ---
  'react-spa': {
    id: 'react-spa',
    name: 'React SPA',
    discipline: 'web',
    symbolMapping: {
      'src/components/**': '#',
      'src/pages/**': '#',
      'src/views/**': '#',
      'src/hooks/**': '#',
      'src/stores/**': '#',
      'src/state/**': '#',
      'src/utils/**': '#',
      'src/lib/**': '#',
      'src/services/**': '#',
      'src/api/**': '#',
      'src/config/**': '#',
      'src/middleware/**': '^',
      'src/auth/**': '^',
      'src/guards/**': '^',
      'src/events/**': '!',
      'src/handlers/**': '!',
      'src/flows/**': '$',
      'src/aspects/**': '~',
      'src/rules/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/components/*', depth: 1 },
      { pattern: 'src/pages/*', depth: 1 },
      { pattern: 'src/features/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['src/components/**/*.tsx', 'src/pages/**/*.tsx', 'src/views/**/*.tsx'],
      routePatterns: ['src/routes.*', 'src/App.tsx'],
      authPatterns: ['src/auth/**', 'src/guards/**', 'src/hooks/useAuth*'],
      statePatterns: ['src/stores/**', 'src/state/**', 'src/hooks/use*Store*'],
    },
    detectFn: (dir) => {
      const pkg = readPackageJson(dir);
      if (!pkg) return false;
      const deps = { ...(pkg.dependencies as Record<string, unknown> ?? {}), ...(pkg.devDependencies as Record<string, unknown> ?? {}) };
      return 'react' in deps && !('next' in deps) && !('remix' in deps) && !('react-native' in deps);
    },
  },

  'vue-spa': {
    id: 'vue-spa',
    name: 'Vue SPA',
    discipline: 'web',
    symbolMapping: {
      'src/components/**': '#',
      'src/views/**': '#',
      'src/pages/**': '#',
      'src/composables/**': '#',
      'src/stores/**': '#',
      'src/utils/**': '#',
      'src/lib/**': '#',
      'src/services/**': '#',
      'src/api/**': '#',
      'src/config/**': '#',
      'src/router/**': '$',
      'src/middleware/**': '^',
      'src/auth/**': '^',
      'src/guards/**': '^',
      'src/events/**': '!',
      'src/flows/**': '$',
      'src/aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/components/*', depth: 1 },
      { pattern: 'src/views/*', depth: 1 },
      { pattern: 'src/stores/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['src/components/**/*.vue', 'src/views/**/*.vue'],
      routePatterns: ['src/router/**/*.ts'],
      authPatterns: ['src/auth/**', 'src/guards/**', 'src/router/guards*'],
      statePatterns: ['src/stores/**/*.ts', 'src/composables/**/*.ts'],
    },
    detectFn: (dir) => {
      const pkg = readPackageJson(dir);
      if (!pkg) return false;
      const deps = { ...(pkg.dependencies as Record<string, unknown> ?? {}), ...(pkg.devDependencies as Record<string, unknown> ?? {}) };
      return 'vue' in deps && !('nuxt' in deps);
    },
  },

  // --- API ---
  express: {
    id: 'express',
    name: 'Express',
    discipline: 'api',
    symbolMapping: {
      'src/routes/**': '#',
      'src/controllers/**': '#',
      'src/services/**': '#',
      'src/models/**': '#',
      'src/lib/**': '#',
      'src/utils/**': '#',
      'src/config/**': '#',
      'src/middleware/**': '^',
      'src/auth/**': '^',
      'src/guards/**': '^',
      'src/policies/**': '^',
      'src/events/**': '!',
      'src/handlers/**': '!',
      'src/listeners/**': '!',
      'src/webhooks/**': '!',
      'src/flows/**': '$',
      'src/workflows/**': '$',
      'src/aspects/**': '~',
      'src/rules/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/routes/*', depth: 1 },
      { pattern: 'src/services/*', depth: 1 },
      { pattern: 'src/controllers/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['src/routes/**/*.ts', 'src/controllers/**/*.ts', 'src/services/**/*.ts'],
      routePatterns: ['src/routes/**/*.ts', 'src/index.ts', 'src/app.ts'],
      authPatterns: ['src/middleware/auth*', 'src/auth/**'],
      statePatterns: ['src/models/**/*.ts'],
    },
    detectFn: (dir) => {
      const pkg = readPackageJson(dir);
      if (!pkg) return false;
      const deps = { ...(pkg.dependencies as Record<string, unknown> ?? {}) };
      return 'express' in deps;
    },
  },

  fastify: {
    id: 'fastify',
    name: 'Fastify',
    discipline: 'api',
    symbolMapping: {
      'src/routes/**': '#',
      'src/plugins/**': '#',
      'src/services/**': '#',
      'src/models/**': '#',
      'src/schemas/**': '#',
      'src/lib/**': '#',
      'src/utils/**': '#',
      'src/config/**': '#',
      'src/hooks/**': '^',
      'src/auth/**': '^',
      'src/decorators/**': '^',
      'src/events/**': '!',
      'src/handlers/**': '!',
      'src/flows/**': '$',
      'src/aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/routes/*', depth: 1 },
      { pattern: 'src/plugins/*', depth: 1 },
      { pattern: 'src/services/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['src/routes/**/*.ts', 'src/plugins/**/*.ts', 'src/services/**/*.ts'],
      routePatterns: ['src/routes/**/*.ts'],
      authPatterns: ['src/hooks/auth*', 'src/auth/**', 'src/decorators/auth*'],
      statePatterns: ['src/models/**/*.ts', 'src/schemas/**/*.ts'],
    },
    detectFn: (dir) => {
      const pkg = readPackageJson(dir);
      if (!pkg) return false;
      const deps = { ...(pkg.dependencies as Record<string, unknown> ?? {}) };
      return 'fastify' in deps;
    },
  },

  fastapi: {
    id: 'fastapi',
    name: 'FastAPI',
    discipline: 'api',
    symbolMapping: {
      'routers/**': '#',
      'routes/**': '#',
      'api/**': '#',
      'services/**': '#',
      'models/**': '#',
      'schemas/**': '#',
      'crud/**': '#',
      'core/**': '#',
      'utils/**': '#',
      'config/**': '#',
      'deps/**': '^',
      'middleware/**': '^',
      'auth/**': '^',
      'events/**': '!',
      'handlers/**': '!',
      'flows/**': '$',
      'aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'routers/*', depth: 1 },
      { pattern: 'services/*', depth: 1 },
      { pattern: 'models/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['routers/**/*.py', 'api/**/*.py', 'services/**/*.py'],
      routePatterns: ['routers/**/*.py', 'api/**/*.py', 'main.py', 'app.py'],
      authPatterns: ['deps/**/*.py', 'auth/**/*.py', 'middleware/**/*.py'],
      statePatterns: ['models/**/*.py', 'schemas/**/*.py'],
    },
    detectFn: (dir) => {
      const pyDeps = (readFileIfExists(dir, 'pyproject.toml') || '') + (readFileIfExists(dir, 'requirements.txt') || '');
      return /fastapi/i.test(pyDeps);
    },
  },

  django: {
    id: 'django',
    name: 'Django',
    discipline: 'api',
    symbolMapping: {
      '**/views/**': '#',
      '**/views.py': '#',
      '**/serializers/**': '#',
      '**/models/**': '#',
      '**/models.py': '#',
      '**/admin.py': '#',
      '**/forms.py': '#',
      '**/urls.py': '$',
      '**/management/**': '#',
      '**/utils/**': '#',
      '**/middleware/**': '^',
      '**/permissions/**': '^',
      '**/signals/**': '!',
      '**/tasks/**': '$',
      '**/aspects/**': '~',
    },
    purposeRequired: [
      { pattern: '*/views/*', depth: 1 },
      { pattern: '*/models/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['**/views.py', '**/views/**/*.py', '**/serializers.py'],
      routePatterns: ['**/urls.py'],
      authPatterns: ['**/permissions.py', '**/permissions/**/*.py', '**/middleware/**/*.py'],
      statePatterns: ['**/models.py', '**/models/**/*.py'],
    },
    detectFn: (dir) => {
      return fs.existsSync(path.join(dir, 'manage.py'));
    },
  },

  gin: {
    id: 'gin',
    name: 'Gin (Go)',
    discipline: 'api',
    symbolMapping: {
      'handlers/**': '#',
      'controllers/**': '#',
      'services/**': '#',
      'models/**': '#',
      'repository/**': '#',
      'pkg/**': '#',
      'internal/**': '#',
      'cmd/**': '#',
      'config/**': '#',
      'middleware/**': '^',
      'auth/**': '^',
      'events/**': '!',
      'flows/**': '$',
      'aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'handlers/*', depth: 1 },
      { pattern: 'services/*', depth: 1 },
      { pattern: 'cmd/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['handlers/**/*.go', 'controllers/**/*.go', 'services/**/*.go'],
      routePatterns: ['cmd/**/*.go', 'routes/**/*.go', 'router/**/*.go'],
      authPatterns: ['middleware/**/*.go', 'auth/**/*.go'],
      statePatterns: ['models/**/*.go', 'repository/**/*.go'],
    },
    detectFn: (dir) => {
      const goMod = readFileIfExists(dir, 'go.mod') || '';
      return /gin-gonic\/gin/i.test(goMod);
    },
  },

  axum: {
    id: 'axum',
    name: 'Axum (Rust)',
    discipline: 'api',
    symbolMapping: {
      'src/handlers/**': '#',
      'src/routes/**': '#',
      'src/services/**': '#',
      'src/models/**': '#',
      'src/db/**': '#',
      'src/lib.rs': '#',
      'src/config/**': '#',
      'src/middleware/**': '^',
      'src/auth/**': '^',
      'src/extractors/**': '^',
      'src/events/**': '!',
      'src/flows/**': '$',
      'src/aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'src/handlers/*', depth: 1 },
      { pattern: 'src/services/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['src/handlers/**/*.rs', 'src/routes/**/*.rs', 'src/services/**/*.rs'],
      routePatterns: ['src/routes/**/*.rs', 'src/main.rs', 'src/lib.rs'],
      authPatterns: ['src/middleware/**/*.rs', 'src/auth/**/*.rs', 'src/extractors/**/*.rs'],
      statePatterns: ['src/models/**/*.rs', 'src/db/**/*.rs'],
    },
    detectFn: (dir) => {
      const cargo = readFileIfExists(dir, 'Cargo.toml') || '';
      return /axum/i.test(cargo);
    },
  },

  // --- Mobile ---
  'swift-ios': {
    id: 'swift-ios',
    name: 'Swift iOS',
    discipline: 'mobile',
    symbolMapping: {
      '**/Views/**': '#',
      '**/Screens/**': '#',
      '**/Components/**': '#',
      '**/ViewModels/**': '#',
      '**/Models/**': '#',
      '**/Services/**': '#',
      '**/Managers/**': '#',
      '**/Helpers/**': '#',
      '**/Utils/**': '#',
      '**/Extensions/**': '#',
      '**/Networking/**': '#',
      '**/Coordinators/**': '$',
      '**/Navigation/**': '$',
      '**/Flows/**': '$',
      '**/Auth/**': '^',
      '**/Middleware/**': '^',
      '**/Events/**': '!',
      '**/Notifications/**': '!',
      '**/Aspects/**': '~',
    },
    purposeRequired: [
      { pattern: '**/Views/*', depth: 1 },
      { pattern: '**/Screens/*', depth: 1 },
      { pattern: '**/Services/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['**/*.swift'],
      routePatterns: ['**/Navigation/**/*.swift', '**/Coordinators/**/*.swift'],
      authPatterns: ['**/Auth/**/*.swift', '**/Keychain*'],
      statePatterns: ['**/ViewModels/**/*.swift', '**/Models/**/*.swift', '**/Stores/**/*.swift'],
    },
    detectFn: (dir) => {
      const hasXcodeproj = hasFilesMatching(dir, '.xcodeproj') || hasFilesMatching(dir, '.xcworkspace');
      const hasSwift = fs.existsSync(path.join(dir, 'Package.swift')) ||
        (fs.existsSync(path.join(dir, 'Sources')) && hasFilesMatching(path.join(dir, 'Sources'), '.swift'));
      return hasXcodeproj || hasSwift;
    },
  },

  'kotlin-android': {
    id: 'kotlin-android',
    name: 'Kotlin Android',
    discipline: 'mobile',
    symbolMapping: {
      '**/ui/**': '#',
      '**/screens/**': '#',
      '**/components/**': '#',
      '**/viewmodel/**': '#',
      '**/viewmodels/**': '#',
      '**/model/**': '#',
      '**/models/**': '#',
      '**/data/**': '#',
      '**/repository/**': '#',
      '**/service/**': '#',
      '**/network/**': '#',
      '**/api/**': '#',
      '**/util/**': '#',
      '**/utils/**': '#',
      '**/di/**': '#',
      '**/navigation/**': '$',
      '**/auth/**': '^',
      '**/middleware/**': '^',
      '**/events/**': '!',
      '**/flows/**': '$',
      '**/aspects/**': '~',
    },
    purposeRequired: [
      { pattern: '**/ui/*', depth: 1 },
      { pattern: '**/screens/*', depth: 1 },
      { pattern: '**/data/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['**/*.kt'],
      routePatterns: ['**/navigation/**/*.kt'],
      authPatterns: ['**/auth/**/*.kt'],
      statePatterns: ['**/viewmodel/**/*.kt', '**/viewmodels/**/*.kt', '**/model/**/*.kt', '**/repository/**/*.kt'],
    },
    detectFn: (dir) => {
      return fs.existsSync(path.join(dir, 'build.gradle.kts')) || fs.existsSync(path.join(dir, 'build.gradle'));
    },
  },

  flutter: {
    id: 'flutter',
    name: 'Flutter',
    discipline: 'mobile',
    symbolMapping: {
      'lib/screens/**': '#',
      'lib/pages/**': '#',
      'lib/widgets/**': '#',
      'lib/components/**': '#',
      'lib/models/**': '#',
      'lib/services/**': '#',
      'lib/providers/**': '#',
      'lib/repositories/**': '#',
      'lib/utils/**': '#',
      'lib/config/**': '#',
      'lib/routes/**': '$',
      'lib/navigation/**': '$',
      'lib/auth/**': '^',
      'lib/middleware/**': '^',
      'lib/events/**': '!',
      'lib/flows/**': '$',
      'lib/aspects/**': '~',
    },
    purposeRequired: [
      { pattern: 'lib/screens/*', depth: 1 },
      { pattern: 'lib/widgets/*', depth: 1 },
      { pattern: 'lib/services/*', depth: 1 },
    ],
    scanHints: {
      componentPatterns: ['lib/**/*.dart'],
      routePatterns: ['lib/routes/**/*.dart', 'lib/navigation/**/*.dart'],
      authPatterns: ['lib/auth/**/*.dart'],
      statePatterns: ['lib/providers/**/*.dart', 'lib/models/**/*.dart', 'lib/repositories/**/*.dart'],
    },
    detectFn: (dir) => {
      return fs.existsSync(path.join(dir, 'pubspec.yaml'));
    },
  },
};

/**
 * Detect the stack preset from project files.
 * Returns the preset ID or null if no match.
 */
export function detectStack(rootDir: string): string | null {
  for (const [id, preset] of Object.entries(STACK_PRESETS)) {
    if (preset.detectFn(rootDir)) {
      return id;
    }
  }
  return null;
}

/**
 * Get the effective config for a stack preset.
 * Merges the preset's config over the discipline defaults.
 */
export function getStackConfig(stackId: string): DisciplineConfig | null {
  const preset = STACK_PRESETS[stackId];
  if (!preset) return null;

  const base = getDisciplineConfig(preset.discipline);
  return {
    symbolMapping: { ...base.symbolMapping, ...preset.symbolMapping },
    purposeRequired: preset.purposeRequired,
    examples: base.examples,
  };
}

/**
 * List all available stack presets, optionally filtered by discipline.
 */
export function listStackPresets(discipline?: Discipline): StackPreset[] {
  const presets = Object.values(STACK_PRESETS);
  if (discipline) {
    return presets.filter((p) => p.discipline === discipline);
  }
  return presets;
}
