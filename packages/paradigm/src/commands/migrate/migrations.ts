/**
 * paradigm migrate — ordered migration registry
 *
 * Each migration is a self-contained plain object with check() and apply().
 * Order matters: earlier migrations may be prerequisites for later ones.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { MigrationStep, MigrateOptions, MigrationCheckResult, MigrationApplyResult } from './types.js';
import { getTemplatesDir } from './detector.js';

// ─── Helpers ────────────────────────────────────────────────────────

function dirExists(rootDir: string, ...segments: string[]): boolean {
  return fs.existsSync(path.join(rootDir, ...segments));
}

function ensureDir(rootDir: string, ...segments: string[]): void {
  fs.mkdirSync(path.join(rootDir, ...segments), { recursive: true });
}

function readConfig(rootDir: string): Record<string, unknown> | null {
  const p = path.join(rootDir, '.paradigm', 'config.yaml');
  if (!fs.existsSync(p)) return null;
  try {
    return yaml.load(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readConfigRaw(rootDir: string): string | null {
  const p = path.join(rootDir, '.paradigm', 'config.yaml');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function writeConfigRaw(rootDir: string, content: string): void {
  fs.writeFileSync(path.join(rootDir, '.paradigm', 'config.yaml'), content, 'utf8');
}

function findUnmigratedAssessments(assessDir: string): boolean {
  try {
    const walk = (dir: string): boolean => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (walk(path.join(dir, entry.name))) return true;
        } else if (entry.name.endsWith('.yaml') && !entry.name.endsWith('.migrated')) {
          // index.yaml and arc.yaml are metadata, not entries
          if (entry.name !== 'index.yaml' && entry.name !== 'arc.yaml') return true;
        }
      }
      return false;
    };
    return walk(assessDir);
  } catch {
    return false;
  }
}

function configHasField(config: Record<string, unknown>, field: string): boolean {
  // Check both kebab-case and snake_case
  return field in config
    || field.replace(/-/g, '_') in config
    || field.replace(/_/g, '-') in config;
}

// ─── Pre-3.0 (legacy, ported from upgrade.ts) ──────────────────────

const legacyFileToDirectory: MigrationStep = {
  id: 'legacy-file-to-directory',
  introducedIn: '1.0.0',
  description: 'Convert .paradigm file to .paradigm/ directory',
  category: 'directory',
  auto: true,
  async check(rootDir) {
    const p = path.join(rootDir, '.paradigm');
    if (!fs.existsSync(p)) return { needed: false, reason: 'No .paradigm found' };
    if (fs.statSync(p).isFile()) {
      return { needed: true, reason: '.paradigm is a file, not a directory', details: ['Legacy format — must convert to directory'] };
    }
    return { needed: false, reason: '.paradigm/ is already a directory' };
  },
  async apply(rootDir, opts) {
    if (opts.dryRun) return { status: 'skipped', message: 'Would convert .paradigm file to directory' };
    const p = path.join(rootDir, '.paradigm');
    const backup = path.join(rootDir, '.paradigm.backup');
    const content = fs.readFileSync(p, 'utf8');
    fs.copyFileSync(p, backup);
    fs.unlinkSync(p);
    fs.mkdirSync(p, { recursive: true });
    fs.mkdirSync(path.join(p, 'specs'), { recursive: true });
    fs.mkdirSync(path.join(p, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(p, 'prompts'), { recursive: true });
    // Write old content as config.yaml
    fs.writeFileSync(path.join(p, 'config.yaml'), content, 'utf8');
    return {
      status: 'applied',
      message: 'Converted .paradigm file to directory (backup at .paradigm.backup)',
      filesCreated: ['.paradigm/', '.paradigm/config.yaml', '.paradigm/specs/', '.paradigm/docs/', '.paradigm/prompts/'],
    };
  },
};

const legacyScanIndexLocation: MigrationStep = {
  id: 'legacy-scan-index-location',
  introducedIn: '1.0.0',
  description: 'Move .paradigm-scan-index.json into .paradigm/',
  category: 'format',
  auto: true,
  async check(rootDir) {
    const old = path.join(rootDir, '.paradigm-scan-index.json');
    if (fs.existsSync(old)) {
      return { needed: true, reason: 'Scan index at root level needs relocation' };
    }
    return { needed: false, reason: 'No legacy scan index at root' };
  },
  async apply(rootDir, opts) {
    if (opts.dryRun) return { status: 'skipped', message: 'Would move .paradigm-scan-index.json' };
    const old = path.join(rootDir, '.paradigm-scan-index.json');
    const dest = path.join(rootDir, '.paradigm', 'scan-index.json');
    fs.renameSync(old, dest);
    return { status: 'applied', message: 'Moved scan index into .paradigm/', filesModified: ['.paradigm/scan-index.json'] };
  },
};

// ─── 3.0–3.5 (foundation) ──────────────────────────────────────────

function makeDirectoryMigration(
  id: string,
  version: string,
  relPath: string,
  description: string,
  details?: string[],
): MigrationStep {
  return {
    id,
    introducedIn: version,
    description,
    category: 'directory',
    auto: true,
    async check(rootDir) {
      if (dirExists(rootDir, '.paradigm', relPath)) {
        return { needed: false, reason: `.paradigm/${relPath}/ already exists` };
      }
      return { needed: true, reason: `Missing .paradigm/${relPath}/`, details };
    },
    async apply(rootDir, opts) {
      if (opts.dryRun) return { status: 'skipped', message: `Would create .paradigm/${relPath}/` };
      ensureDir(rootDir, '.paradigm', relPath);
      return { status: 'applied', message: `Created .paradigm/${relPath}/`, filesCreated: [`.paradigm/${relPath}/`] };
    },
  };
}

const addSpecsDirectory = makeDirectoryMigration(
  'add-specs-directory', '3.0.0', 'specs',
  'Create .paradigm/specs/ for specifications',
  ['Stores logger spec, symbols spec, scan spec, etc.'],
);

const addDocsDirectory = makeDirectoryMigration(
  'add-docs-directory', '3.0.0', 'docs',
  'Create .paradigm/docs/ for documentation',
  ['Stores commands, patterns, troubleshooting docs'],
);

const addPromptsDirectory = makeDirectoryMigration(
  'add-prompts-directory', '3.0.0', 'prompts',
  'Create .paradigm/prompts/ for task templates',
  ['Stores add-feature, refactor, trace-flow prompts'],
);

const addTagBankConfig: MigrationStep = {
  id: 'add-tag-bank-config',
  introducedIn: '3.2.0',
  description: 'Add tag-bank section to config.yaml',
  category: 'config',
  auto: true,
  async check(rootDir) {
    const config = readConfig(rootDir);
    if (!config) return { needed: false, reason: 'No config.yaml found' };
    if (configHasField(config, 'tag-bank')) {
      return { needed: false, reason: 'tag-bank already configured' };
    }
    return { needed: true, reason: 'Missing tag-bank configuration' };
  },
  async apply(rootDir, opts) {
    if (opts.dryRun) return { status: 'skipped', message: 'Would add tag-bank to config.yaml' };
    const raw = readConfigRaw(rootDir);
    if (!raw) return { status: 'error', message: 'Cannot read config.yaml' };

    const tagBankBlock = `
# Tag bank configuration
tag-bank:
  file: tags.yaml
  core-tags:
    - feature
    - integration
    - state
    - idea
    - deprecated
    - critical
    - security
    - compliance
  allow-suggestions: true
`;
    writeConfigRaw(rootDir, raw.trimEnd() + '\n' + tagBankBlock);
    return { status: 'applied', message: 'Added tag-bank to config.yaml', filesModified: ['.paradigm/config.yaml'] };
  },
};

const addPurposeRequiredConfig: MigrationStep = {
  id: 'add-purpose-required-config',
  introducedIn: '3.3.0',
  description: 'Add purpose-required patterns to config.yaml',
  category: 'config',
  auto: true,
  async check(rootDir) {
    const config = readConfig(rootDir);
    if (!config) return { needed: false, reason: 'No config.yaml found' };
    if (configHasField(config, 'purpose-required')) {
      return { needed: false, reason: 'purpose-required already configured' };
    }
    return { needed: true, reason: 'Missing purpose-required patterns' };
  },
  async apply(rootDir, opts) {
    if (opts.dryRun) return { status: 'skipped', message: 'Would add purpose-required to config.yaml' };
    const raw = readConfigRaw(rootDir);
    if (!raw) return { status: 'error', message: 'Cannot read config.yaml' };

    const block = `
# Where .purpose files should exist
purpose-required:
  - pattern: "src/*"
    depth: 1
  - pattern: "lib/*"
    depth: 1
  - pattern: "packages/*"
    depth: 1
`;
    writeConfigRaw(rootDir, raw.trimEnd() + '\n' + block);
    return { status: 'applied', message: 'Added purpose-required to config.yaml', filesModified: ['.paradigm/config.yaml'] };
  },
};

// ─── 3.7–3.18 (features) ───────────────────────────────────────────

const addLoreDirectory = makeDirectoryMigration(
  'add-lore-directory', '3.7.0', 'lore',
  'Create .paradigm/lore/ for project reflections and decisions',
  ['Stores lore entries (reflections, decisions, arcs)'],
);

const addTasksDirectory = makeDirectoryMigration(
  'add-tasks-directory', '3.8.0', 'tasks',
  'Create .paradigm/tasks/ for work item tracking',
  ['Stores task YAML files for persistent task management'],
);

const addPersonasDirectory = makeDirectoryMigration(
  'add-personas-directory', '3.9.0', 'personas',
  'Create .paradigm/personas/ for actor-driven journey testing',
  ['Stores .persona files with traits, triggers, fixtures, journey steps'],
);

const addProtocolsDirectory = makeDirectoryMigration(
  'add-protocols-directory', '3.10.0', 'protocols',
  'Create .paradigm/protocols/ for repeatable implementation patterns',
  ['Stores protocol YAML files captured from implementation workflows'],
);

const addHabitsDirectory = makeDirectoryMigration(
  'add-habits-directory', '3.14.0', 'habits',
  'Create .paradigm/habits/ for session habit tracking',
);

const addWisdomDirectory = makeDirectoryMigration(
  'add-wisdom-directory', '3.5.0', 'wisdom',
  'Create .paradigm/wisdom/ for antipatterns and team knowledge',
  ['Stores antipatterns.yaml and other team knowledge files'],
);

const addHistoryDirectory = makeDirectoryMigration(
  'add-history-directory', '3.6.0', 'history',
  'Create .paradigm/history/ for symbol change history',
  ['Stores log.jsonl for commit-level symbol tracking'],
);

// ─── 3.19+ (refinements) ───────────────────────────────────────────

const migrateAssessmentsToLore: MigrationStep = {
  id: 'migrate-assessments-to-lore',
  introducedIn: '3.19.0',
  description: 'Convert old assessment entries to lore format',
  category: 'schema',
  auto: false, // Manual — delegates to `paradigm lore migrate-assessments`
  async check(rootDir) {
    const assessDir = path.join(rootDir, '.paradigm', 'assessments');
    if (!fs.existsSync(assessDir)) return { needed: false, reason: 'No assessments directory found' };
    try {
      // Check for unmigrated entries (non-.migrated YAML files in entries/ subdirs)
      const hasUnmigrated = findUnmigratedAssessments(assessDir);
      if (!hasUnmigrated) return { needed: false, reason: 'All assessments already migrated' };
      return {
        needed: true,
        reason: 'Unmigrated assessment entries found',
        details: ['Run: paradigm lore migrate-assessments --dry-run'],
      };
    } catch {
      return { needed: false, reason: 'Cannot read assessments directory' };
    }
  },
  async apply(_rootDir, _opts) {
    return { status: 'skipped', message: 'Run `paradigm lore migrate-assessments` manually' };
  },
};

const addComponentTypesConfig: MigrationStep = {
  id: 'add-component-types-config',
  introducedIn: '3.33.0',
  description: 'Add component_types glossary to config.yaml',
  category: 'config',
  auto: true,
  async check(rootDir) {
    const config = readConfig(rootDir);
    if (!config) return { needed: false, reason: 'No config.yaml found' };
    if (configHasField(config, 'component_types')) {
      return { needed: false, reason: 'component_types already configured' };
    }
    return { needed: true, reason: 'Missing component_types glossary' };
  },
  async apply(rootDir, opts) {
    if (opts.dryRun) return { status: 'skipped', message: 'Would add component_types to config.yaml' };
    const raw = readConfigRaw(rootDir);
    if (!raw) return { status: 'error', message: 'Cannot read config.yaml' };

    const block = `
# Component types glossary — defines the project vocabulary for the \`type\` field on components
component_types:
  command: "CLI command handler — registers subcommand, parses args, calls core logic"
  tool: "MCP tool definition + handler — serves AI agents via JSON-RPC"
  utility: "Shared helper function or module — no side effects, pure logic"
  engine: "Stateful processing core — owns data transformation lifecycle"
  loader: "Reads and parses data sources into typed structures"
  writer: "Writes structured data to files (YAML, JSON)"
  service: "Business logic coordinator — orchestrates tools, loaders, writers"
  model: "Data shape — TypeScript interface or type definition"
  view: "UI rendering unit — SwiftUI view, React component"
  provider: "Protocol-conforming platform capability wrapper — owns lifecycle"
  manager: "Stateful coordinator that owns child lifecycles"
  detector: "Observes external state and emits events"
  router: "Maps input signals to targets based on rules"
  filter: "Transforms or smooths data in a pipeline"
  store: "Persistent or reactive state container"
  handler: "Event handler, webhook receiver, or request processor"
  config: "Configuration, environment, constants"
`;
    writeConfigRaw(rootDir, raw.trimEnd() + '\n' + block);
    return { status: 'applied', message: 'Added component_types glossary to config.yaml', filesModified: ['.paradigm/config.yaml'] };
  },
};

const addDisciplineConfig: MigrationStep = {
  id: 'add-discipline-config',
  introducedIn: '3.4.0',
  description: 'Add discipline field to config.yaml',
  category: 'config',
  auto: true,
  async check(rootDir) {
    const config = readConfig(rootDir);
    if (!config) return { needed: false, reason: 'No config.yaml found' };
    if (configHasField(config, 'discipline')) {
      return { needed: false, reason: 'discipline already set' };
    }
    return { needed: true, reason: 'Missing discipline field' };
  },
  async apply(rootDir, opts) {
    if (opts.dryRun) return { status: 'skipped', message: 'Would add discipline to config.yaml' };
    const raw = readConfigRaw(rootDir);
    if (!raw) return { status: 'error', message: 'Cannot read config.yaml' };

    // Insert after the project: line
    const updated = raw.replace(
      /^(project:\s*.+)$/m,
      '$1\ndiscipline: auto',
    );
    if (updated === raw) {
      // Fallback: append
      writeConfigRaw(rootDir, raw.trimEnd() + '\ndiscipline: auto\n');
    } else {
      writeConfigRaw(rootDir, updated);
    }
    return { status: 'applied', message: 'Added discipline: auto to config.yaml', filesModified: ['.paradigm/config.yaml'] };
  },
};

// ─── Evergreen (always available) ───────────────────────────────────

const syncTemplates: MigrationStep = {
  id: 'sync-templates',
  introducedIn: 'evergreen',
  description: 'Update specs/ and docs/ from installed CLI templates',
  category: 'template',
  auto: true,
  async check(rootDir) {
    const templatesDir = getTemplatesDir();
    if (!templatesDir) return { needed: false, reason: 'Templates directory not found' };

    const newFiles: string[] = [];
    const subdirs = ['specs', 'docs', 'prompts'];
    for (const sub of subdirs) {
      const templateSub = path.join(templatesDir, sub);
      const projectSub = path.join(rootDir, '.paradigm', sub);
      if (!fs.existsSync(templateSub)) continue;

      try {
        const files = fs.readdirSync(templateSub).filter(f => {
          const s = fs.statSync(path.join(templateSub, f));
          return s.isFile();
        });
        for (const file of files) {
          if (!fs.existsSync(path.join(projectSub, file))) {
            newFiles.push(`${sub}/${file}`);
          }
        }
      } catch { /* ignore */ }
    }

    if (newFiles.length === 0) return { needed: false, reason: 'All templates are up to date' };
    return {
      needed: true,
      reason: `${newFiles.length} new template file(s) available`,
      details: newFiles.map(f => `New: ${f}`),
    };
  },
  async apply(rootDir, opts) {
    const templatesDir = getTemplatesDir();
    if (!templatesDir) return { status: 'error', message: 'Templates directory not found' };

    const projectName = path.basename(rootDir);
    const created: string[] = [];
    const subdirs = ['specs', 'docs', 'prompts'];

    for (const sub of subdirs) {
      const templateSub = path.join(templatesDir, sub);
      const projectSub = path.join(rootDir, '.paradigm', sub);
      if (!fs.existsSync(templateSub)) continue;

      if (!opts.dryRun) {
        fs.mkdirSync(projectSub, { recursive: true });
      }

      try {
        const entries = fs.readdirSync(templateSub, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) continue;
          const dest = path.join(projectSub, entry.name);
          if (!fs.existsSync(dest)) {
            if (opts.dryRun) {
              created.push(`${sub}/${entry.name}`);
              continue;
            }
            let content = fs.readFileSync(path.join(templateSub, entry.name), 'utf8');
            content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
            fs.writeFileSync(dest, content, 'utf8');
            created.push(`${sub}/${entry.name}`);
          }
        }
      } catch { /* ignore */ }
    }

    if (opts.dryRun) {
      return { status: 'skipped', message: `Would copy ${created.length} template file(s)` };
    }
    if (created.length === 0) return { status: 'skipped', message: 'No new templates to sync' };
    return {
      status: 'applied',
      message: `Synced ${created.length} template file(s)`,
      filesCreated: created.map(f => `.paradigm/${f}`),
    };
  },
};

const refreshHooks: MigrationStep = {
  id: 'refresh-hooks',
  introducedIn: 'evergreen',
  description: 'Reinstall hook scripts from plugin',
  category: 'hook',
  auto: true,
  async check(rootDir) {
    // Check for hooks in any supported location
    const hookLocations = [
      path.join(rootDir, '.claude', 'hooks'),
      path.join(rootDir, '.cursor', 'hooks'),
    ];

    for (const hookDir of hookLocations) {
      if (!fs.existsSync(hookDir)) continue;
      try {
        const files = fs.readdirSync(hookDir);
        if (files.some(f => f.includes('paradigm'))) {
          return { needed: false, reason: 'Hooks are installed' };
        }
      } catch { /* ignore */ }
    }

    // Also check if plugin manages hooks (settings.json hook config)
    const claudeSettings = path.join(rootDir, '.claude', 'settings.local.json');
    if (fs.existsSync(claudeSettings)) {
      try {
        const settings = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'));
        if (settings.hooks) {
          return { needed: false, reason: 'Plugin-managed hooks are configured' };
        }
      } catch { /* ignore */ }
    }

    return { needed: true, reason: 'No paradigm hooks found' };
  },
  async apply(rootDir, opts) {
    if (opts.dryRun) return { status: 'skipped', message: 'Would reinstall hooks' };
    try {
      const { hooksInstallCommand } = await import('../hooks/index.js');
      await hooksInstallCommand({ force: true });
      return { status: 'applied', message: 'Hooks reinstalled' };
    } catch (err) {
      return { status: 'error', message: `Hook install failed: ${(err as Error).message}` };
    }
  },
};

// ─── Migration registry (ordered) ──────────────────────────────────

export const migrations: MigrationStep[] = [
  // Pre-3.0 legacy
  legacyFileToDirectory,
  legacyScanIndexLocation,

  // 3.0–3.5 foundation
  addSpecsDirectory,
  addDocsDirectory,
  addPromptsDirectory,
  addTagBankConfig,
  addPurposeRequiredConfig,
  addDisciplineConfig,

  // 3.5–3.18 features
  addWisdomDirectory,
  addHistoryDirectory,
  addLoreDirectory,
  addTasksDirectory,
  addPersonasDirectory,
  addProtocolsDirectory,
  addHabitsDirectory,

  // 3.19+ refinements
  migrateAssessmentsToLore,
  addComponentTypesConfig,

  // Evergreen
  syncTemplates,
  refreshHooks,
];
