/**
 * YAML parser for Gate configuration files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { glob } from 'glob';
import type {
  GateConfig,
  ParsedGateConfig,
  Gate,
  Flow,
  Lock,
  Key,
  Prize,
} from './types.js';

/**
 * Default dev settings
 */
const DEFAULT_DEV_SETTINGS = {
  visualizerPort: 42195,  // Marathon: 42.195km
  watcherPort: 42196,     // Marathon + 1
  autoConnect: true,
};

/**
 * Parse a portal.yaml file and return normalized config
 */
export async function parseGateConfig(configPath: string): Promise<ParsedGateConfig> {
  const absolutePath = path.resolve(configPath);
  const rootDir = path.dirname(absolutePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Gate config not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  const config = yaml.load(content) as GateConfig;

  // Validate basic structure
  if (!config.version) {
    throw new Error('Gate config missing required "version" field');
  }

  // Parse main gates (support both 'gates' and 'portals' keys)
  const gates: Gate[] = [];
  const configAny = config as unknown as { portals?: typeof config.gates };
  const gatesSource = config.gates || configAny.portals;
  if (gatesSource) {
    for (const [rawId, gateDef] of Object.entries(gatesSource)) {
      // v5.38.0 Bug 1 fix: strip leading `^` from the YAML key. The caret is
      // the symbol-class marker (rendered when the gate is referenced), not
      // part of the gate id. Accepting both `^authenticated:` and
      // `authenticated:` as keys is the lenient migration path for projects
      // that followed the pre-fix site docs.
      const id = rawId.startsWith('^') ? rawId.slice(1) : rawId;
      gates.push(normalizeGate(id, gateDef));
    }
  }

  // Parse included files
  if (config.include) {
    for (const pattern of config.include) {
      const fullPattern = path.join(rootDir, pattern);
      const files = await glob(fullPattern.replace(/\\/g, '/'));

      for (const file of files) {
        const additionalGates = await parseGateFile(file);
        gates.push(...additionalGates);
      }
    }
  }

  // Parse flows
  const flows: Flow[] = [];
  if (config.flows) {
    for (const [id, flowDef] of Object.entries(config.flows)) {
      flows.push(normalizeFlow(id, flowDef));
    }
  }

  return {
    version: config.version,
    gates,
    flows,
    settings: {
      dev: {
        ...DEFAULT_DEV_SETTINGS,
        ...config.settings?.dev,
      },
    },
  };
}

/**
 * Parse a single .portal.yaml file containing one or more gates
 */
export async function parseGateFile(filePath: string): Promise<Gate[]> {
  const content = fs.readFileSync(filePath, 'utf8');
  const data = yaml.load(content) as Record<string, unknown>;

  // Single gate file format
  if (data.id) {
    // v5.38.0 Bug 1 fix: strip leading `^` from the declared id if present.
    const rawId = data.id as string;
    const id = rawId.startsWith('^') ? rawId.slice(1) : rawId;
    return [normalizeGate(id, data as Partial<Omit<Gate, 'id'>>)];
  }

  // Multiple gates format
  if (data.gates) {
    const gates: Gate[] = [];
    for (const [rawId, gateDef] of Object.entries(data.gates as Record<string, unknown>)) {
      // v5.38.0 Bug 1 fix: strip leading `^` (symbol-class marker).
      const id = rawId.startsWith('^') ? rawId.slice(1) : rawId;
      gates.push(normalizeGate(id, gateDef as Partial<Omit<Gate, 'id'>>));
    }
    return gates;
  }

  return [];
}

/**
 * Normalize a gate definition to full Gate type
 */
function normalizeGate(id: string, def: Partial<Omit<Gate, 'id'>>): Gate {
  const locks: Lock[] = [];

  if (def.locks) {
    for (const lockDef of def.locks as unknown[]) {
      locks.push(normalizeLock(lockDef));
    }
  }

  const prizes: Prize[] = [];
  if (def.prizes) {
    for (const prizeDef of def.prizes as unknown[]) {
      prizes.push(normalizePrize(prizeDef));
    }
  }

  return {
    id,
    description: def.description,
    locks,
    prizes,
    position: def.position,
  };
}

/**
 * Normalize a lock definition
 */
function normalizeLock(def: unknown): Lock {
  const lockDef = def as Record<string, unknown>;
  const keys: Key[] = [];

  if (lockDef.keys) {
    for (const keyDef of lockDef.keys as unknown[]) {
      if (typeof keyDef === 'string') {
        // Shorthand: just the expression
        keys.push({ expression: keyDef });
      } else if ((keyDef as Record<string, unknown>).expression) {
        const k = keyDef as Record<string, unknown>;
        keys.push({
          expression: k.expression as string,
          description: k.description as string | undefined,
        });
      }
    }
  }

  return {
    id: lockDef.id as string,
    description: lockDef.description as string | undefined,
    keys,
    mode: (lockDef.mode as 'all' | 'any') || 'all',
  };
}

/**
 * Normalize a prize definition
 */
function normalizePrize(def: unknown): Prize {
  const prizeDef = def as Record<string, unknown>;
  return {
    id: prizeDef.id as string,
    oneTime: (prizeDef.oneTime as boolean) ?? false,
    metadata: prizeDef.metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Normalize a flow definition
 */
function normalizeFlow(id: string, def: Partial<Omit<Flow, 'id'>>): Flow {
  return {
    id,
    description: def.description,
    gates: def.gates || [],
    forkable: def.forkable,
  };
}

/**
 * Serialize a ParsedGateConfig back to YAML
 */
export function serializeGateConfig(config: ParsedGateConfig): string {
  const output: GateConfig = {
    version: config.version,
    gates: {},
    flows: {},
    settings: {
      dev: config.settings.dev,
    },
  };

  // Convert gates array to record
  for (const gate of config.gates) {
    const { id, ...rest } = gate;
    output.gates[id] = rest;
  }

  // Convert flows array to record
  for (const flow of config.flows) {
    const { id, ...rest } = flow;
    output.flows![id] = rest;
  }

  return yaml.dump(output, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

/**
 * Get the default portal.yaml content for initialization
 */
export function getDefaultGateConfig(): string {
  const config: GateConfig = {
    version: '1.0.0',
    gates: {
      'example-gate': {
        description: 'An example gate to get you started',
        locks: [
          {
            id: 'example-lock',
            description: 'Requires user to be authenticated',
            keys: [{ expression: 'user.isAuthenticated === true' }],
          },
        ],
        prizes: [
          {
            id: 'example-prize',
            oneTime: true,
            metadata: { event: 'first_access' },
          },
        ],
      },
    },
    flows: {
      'example-flow': {
        description: 'An example user journey',
        gates: ['example-gate'],
      },
    },
    settings: {
      dev: {
        visualizerPort: 42195,  // Marathon: 42.195km
        watcherPort: 42196,     // Marathon + 1
        autoConnect: true,
      },
    },
  };

  return yaml.dump(config, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

/**
 * Find all portal.yaml files in a directory
 */
export async function findGateFiles(rootDir: string): Promise<string[]> {
  const absoluteRoot = path.resolve(rootDir);

  const files = await glob('**/portal.yaml', {
    cwd: absoluteRoot,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  });

  // Deterministic order so portal/gate aggregation (and any duplicate-symbol
  // resolution downstream) is stable across parses, regardless of filesystem
  // glob order or absolute temp-dir prefix. Sort key is repo-relative so two
  // different temp-worktree absolute prefixes sort identically — see Loom
  // Oracle / scan-index nondeterminism (paradigm task T-2026-06-13-011).
  return files.sort((a, b) => {
    const relA = path.relative(absoluteRoot, a);
    const relB = path.relative(absoluteRoot, b);
    return relA < relB ? -1 : relA > relB ? 1 : 0;
  });
}
