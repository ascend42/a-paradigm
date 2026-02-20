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

    // React Native / Expo → mobile
    if (hasDep('react-native') || hasDep('expo')) {
      return 'mobile';
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
