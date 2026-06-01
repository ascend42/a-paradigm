/**
 * University Server - Express server for the learning platform UI
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import * as yaml from 'js-yaml';

import { createCoursesRouter } from './routes/courses.js';
import { createPlsatRouter } from './routes/plsat.js';
import {
  normalizeSections,
  loadSectionsFromYamlFile,
  type Section,
} from './sections.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find the package root by searching upward for package.json
 */
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
      if (pkg.name === '@a-company/university') return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

const log = {
  component(name: string) {
    const symbol = chalk.magenta(`#${name}`);
    return {
      info: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.log(`${chalk.blue('ℹ')} ${symbol} ${msg}${dataStr}`);
      },
      success: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.log(`${chalk.green('✔')} ${symbol} ${msg}${dataStr}`);
      },
      warn: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.log(`${chalk.yellow('⚠')} ${symbol} ${msg}${dataStr}`);
      },
      error: (msg: string, data?: Record<string, unknown>) => {
        const dataStr = data ? chalk.gray(` ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')}`) : '';
        console.error(`${chalk.red('✖')} ${symbol} ${msg}${dataStr}`);
      },
    };
  },
};

export interface ServerOptions {
  port: number;
  open?: boolean;
  contentDir?: string;
  uiDistPath?: string;
  projectDir?: string;
  /** Absolute path to the selected pack root (from `serve --pack`). */
  packRoot?: string;
  /** Resolved pack id (display + logging only — NOT part of the pack-config contract). */
  packId?: string;
}

/**
 * Resolve content and UI paths using multiple strategies:
 * 1. Explicit paths (passed from bundled CLI context)
 * 2. Adjacent to this file (bundled into paradigm dist)
 * 3. Package root (standalone university package)
 */
function resolveAssetPaths(options?: { contentDir?: string; uiDistPath?: string }) {
  // Strategy 1: Explicit paths provided by caller
  if (options?.contentDir && options?.uiDistPath) {
    return { contentDir: options.contentDir, uiDistPath: options.uiDistPath };
  }

  // Strategy 2: Adjacent to this file (works when bundled into paradigm dist)
  const bundledContent = path.join(__dirname, 'university-content');
  const bundledUi = path.join(__dirname, 'university-ui');
  if (fs.existsSync(bundledContent) && fs.existsSync(bundledUi)) {
    return {
      contentDir: options?.contentDir || bundledContent,
      uiDistPath: options?.uiDistPath || bundledUi,
    };
  }

  // Strategy 3: University package root (standalone install)
  const packageRoot = findPackageRoot(__dirname);
  return {
    contentDir: options?.contentDir || path.join(packageRoot, 'src', 'content'),
    uiDistPath: options?.uiDistPath || path.join(packageRoot, 'ui', 'dist'),
  };
}

/**
 * Resolve a pack's content base, probing the two supported layouts.
 *
 * v6.0 packs (incl. ai-literacy) use `content/`; first-party / source
 * packs use `src/content/`. Mirrors the loader's dual-base probe
 * (university-loader.ts) and the "first base that CONTAINS content"
 * rule (spec §C4) — a base is only chosen if at least one of its known
 * content subdirs (notes/quizzes/paths) exists and is non-empty.
 *
 * Returns the resolved content base, or `null` if neither layout under
 * `packRoot` actually contains content.
 */
function resolveContentBase(packRoot: string): string | null {
  const CONTENT_SUBDIRS = ['notes', 'quizzes', 'paths'];
  for (const sub of ['content', 'src/content']) {
    const base = path.join(packRoot, sub);
    if (!fs.existsSync(base)) continue;
    const hasContent = CONTENT_SUBDIRS.some((d) => {
      const dir = path.join(base, d);
      try {
        return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
      } catch {
        return false;
      }
    });
    if (hasContent) return base;
  }
  return null;
}

// ── Pack-config types (server-local; shape mirrors PackConfigResponse in UI) ──

interface PackConfigBranding {
  name: string;
  tagline: string;
  logo: string | null;
  institution: string | null;
  favicon: string | null;
  tabs: Array<'campus' | 'courses' | 'plsat' | 'library' | 'certificates'>;
  startCourse: string | null;
}

interface PackConfig {
  mode: 'paradigm' | 'project';
  branding: PackConfigBranding;
  theme: Record<string, string> | null;
  version: string;
  hasProjectLibrary: boolean;
  sections: Section[];
}

const PARADIGM_FALLBACK_VERSION = '6.4.0';

const BRANDING_DEFAULTS: PackConfigBranding = {
  name: 'Paradigm University',
  tagline: 'Lux in Codice',
  logo: null,
  institution: null,
  favicon: null,
  tabs: ['campus', 'courses', 'plsat', 'library', 'certificates'],
  startCourse: null,
};

/**
 * Build the `/api/pack-config` payload from the server options.
 *
 * Pure (no Express) and exported as the no-server test seam (spec §5):
 * `buildPackConfig({ packRoot })` stands in for `serve --pack <id>`
 * without binding a port.
 *
 * Resolution rules (spec §SURFACE 1 / A1):
 *  - manifest path = `packRoot/pack.yaml` when `packRoot` is set, else
 *    `<projectDir>/.paradigm/university/pack.yaml` (today's behavior).
 *  - manifest dir (for reference.json) follows the same selection so the
 *    no-packRoot path is byte-identical.
 *  - packRoot set + pack.yaml present + NOT first-party  → mode:'project',
 *    branding/theme/version/sections from that manifest.
 *  - packRoot set + pack.yaml present + tenant_kind:first-party → keep
 *    paradigm branding (BRANDING_DEFAULTS) but surface the manifest's
 *    sections + version, so a first-party pack served by id renders its
 *    own sections.
 *  - packRoot set + pack.yaml missing → paradigm defaults (builder call;
 *    spec did not state this — flagged in the relay).
 *  - packRoot absent → identical to today (project-dir probe, else
 *    paradigm defaults).
 */
export function buildPackConfig(options?: {
  contentDir?: string;
  uiDistPath?: string;
  projectDir?: string;
  packRoot?: string;
  packId?: string;
}): PackConfig {
  const { contentDir } = resolveAssetPaths(options);

  // Manifest selection: explicit packRoot wins, else today's project-dir probe.
  const manifestDir = options?.packRoot
    ? options.packRoot
    : (options?.projectDir ? path.join(options.projectDir, '.paradigm', 'university') : null);
  const manifestPath = manifestDir ? path.join(manifestDir, 'pack.yaml') : null;

  // ── Detect project mode ───────────────────────────────────────────
  let mode: 'paradigm' | 'project' = 'paradigm';
  let isFirstParty = false;
  let packManifest: Record<string, unknown> = {};

  if (manifestPath && fs.existsSync(manifestPath)) {
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      packManifest = (yaml.load(raw) as Record<string, unknown>) ?? {};
    } catch {
      log.component('university-server').warn('Could not parse pack.yaml — using defaults', { path: manifestPath });
    }
    isFirstParty = packManifest.tenant_kind === 'first-party';
    // A first-party pack served by id keeps paradigm branding (mode stays
    // 'paradigm'); any other manifest activates project mode.
    if (!isFirstParty) mode = 'project';
  }

  if (mode === 'project' && manifestDir) {
    const packBranding = (packManifest.branding ?? {}) as Partial<PackConfigBranding>;
    const packTheme = (packManifest.theme ?? null) as Record<string, string> | null;
    const packVersion = typeof packManifest.version === 'string' ? packManifest.version : PARADIGM_FALLBACK_VERSION;

    // Check for project-local reference library (alongside the manifest).
    const projectRefPath = path.join(manifestDir, 'reference.json');
    const hasProjectLibrary = fs.existsSync(projectRefPath);

    // Capture whether pack explicitly set tabs before merging
    const explicitTabs = packBranding.tabs;

    const mergedBranding: PackConfigBranding = {
      ...BRANDING_DEFAULTS,
      ...packBranding,
    };

    // In project mode with no explicit tabs: default to minimal set,
    // adding 'library' only if a reference.json is present.
    if (!explicitTabs) {
      const defaultTabs: Array<'campus' | 'courses' | 'plsat' | 'library' | 'certificates'> = ['campus', 'courses', 'certificates'];
      if (hasProjectLibrary) {
        defaultTabs.splice(2, 0, 'library'); // insert before 'certificates'
      }
      mergedBranding.tabs = defaultTabs;
    }

    // ── Sections (v6.5): read from pack.yaml or fall back to implicit default
    const sections = normalizeSections(packManifest.sections);

    log.component('university-server').info('Project mode active', {
      pack: String(options?.packId ?? packManifest.id ?? 'unknown'),
      sections: sections.length,
    });

    return {
      mode: 'project',
      branding: mergedBranding,
      theme: packTheme,
      version: packVersion,
      hasProjectLibrary,
      sections,
    };
  }

  // Paradigm mode — standard branding and full tab set.
  // When a first-party pack was selected by id (packRoot + tenant_kind:
  // first-party), surface that manifest's sections + version; otherwise
  // read the bundled first-party pack.yaml from contentDir.
  const sections = (options?.packRoot && isFirstParty)
    ? normalizeSections(packManifest.sections)
    : loadSectionsFromYamlFile(path.join(contentDir, 'pack.yaml'));
  const version = (options?.packRoot && isFirstParty && typeof packManifest.version === 'string')
    ? packManifest.version
    : PARADIGM_FALLBACK_VERSION;

  return {
    mode: 'paradigm',
    branding: { ...BRANDING_DEFAULTS },
    theme: null,
    version,
    hasProjectLibrary: false,
    sections,
  };
}

/**
 * Create the Express application with all routes configured
 */
export function createApp(options?: {
  contentDir?: string;
  uiDistPath?: string;
  projectDir?: string;
  packRoot?: string;
  packId?: string;
}): Express {
  const app = express();

  app.use(express.json());

  // CORS for development
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  const resolved = resolveAssetPaths(options);
  const uiDistPath = resolved.uiDistPath;
  let contentDir = resolved.contentDir;

  // ── A1b: when a pack is selected, mount ITS content base (dual-base
  // probe: prefer `content/`, else `src/content/`). Without packRoot the
  // routers read the resolved contentDir exactly as before.
  if (options?.packRoot) {
    const packContentBase = resolveContentBase(options.packRoot);
    if (packContentBase) {
      contentDir = packContentBase;
    } else {
      log.component('university-server').warn('Selected pack has no content — falling back to bundled content', {
        packRoot: options.packRoot,
      });
    }
  }

  const packConfig: PackConfig = buildPackConfig(options);
  const mode = packConfig.mode;

  // ── API routes ────────────────────────────────────────────────────

  // Pack config
  app.get('/api/pack-config', (_req: Request, res: Response) => {
    res.json(packConfig);
  });

  // When a pack is selected (A1/A1b), the routers read ONLY that pack's
  // resolved content base — suppress projectDir-based pack discovery so a
  // single selected pack doesn't pull in sibling project packs.
  const routerProjectDir = options?.packRoot ? undefined : options?.projectDir;

  // A1b: when a pack is selected, the manifest (and thus its sections) lives
  // at <packRoot>/pack.yaml, above the resolved content base — so feed the
  // courses router the sections we already resolved in buildPackConfig.
  const sectionsOverride = options?.packRoot ? packConfig.sections : undefined;

  app.use('/api/courses', createCoursesRouter(contentDir, routerProjectDir, mode, sectionsOverride));
  app.use('/api/plsat', createPlsatRouter(contentDir, routerProjectDir));

  // Reference cards
  app.get('/api/reference', (_req: Request, res: Response) => {
    if (mode === 'project' && options?.projectDir) {
      const projectRefPath = path.join(options.projectDir, '.paradigm', 'university', 'reference.json');
      if (fs.existsSync(projectRefPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(projectRefPath, 'utf-8'));
          return res.json(data);
        } catch {
          return res.status(500).json({ error: 'Failed to parse project reference.json' });
        }
      }
      return res.status(404).json({ error: 'No reference library configured for this project.' });
    }

    // Paradigm mode — serve bundled reference.json
    const refPath = path.join(contentDir, 'reference.json');
    if (fs.existsSync(refPath)) {
      const data = JSON.parse(fs.readFileSync(refPath, 'utf-8'));
      return res.json(data);
    }
    return res.status(404).json({ error: 'Reference data not found' });
  });

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve static UI files in production
  if (fs.existsSync(uiDistPath)) {
    app.use(express.static(uiDistPath));

    // SPA fallback - serve index.html for non-API routes
    // Express v5 requires named wildcard params
    app.get('{*path}', (req: Request, res: Response) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(uiDistPath, 'index.html'));
      }
    });
  }

  return app;
}

/**
 * Start the University server
 */
export async function startServer(options: ServerOptions): Promise<void> {
  const app = createApp({
    contentDir: options.contentDir,
    uiDistPath: options.uiDistPath,
    projectDir: options.projectDir,
    packRoot: options.packRoot,
    packId: options.packId,
  });

  log.component('university-server').info('Starting server', {
    port: options.port,
    ...(options.packId ? { pack: options.packId } : {}),
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, () => {
      log.component('university-server').success('Server running', { url: `http://localhost:${options.port}` });

      if (options.open) {
        import('open').then((openModule) => {
          openModule.default(`http://localhost:${options.port}`);
          log.component('university-server').info('Opened browser');
        }).catch(() => {
          log.component('university-server').warn('Could not open browser automatically');
        });
      }

      resolve();
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.component('university-server').error('Port already in use', { port: options.port });
      } else {
        log.component('university-server').error('Server error', { error: err.message });
      }
      reject(err);
    });
  });
}
