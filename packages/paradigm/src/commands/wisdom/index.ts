/**
 * Wisdom CLI Commands - Team preferences, antipatterns, decisions, expertise
 *
 * Commands:
 * - paradigm wisdom show [symbol] - Display wisdom for symbols
 * - paradigm wisdom add <type> - Add antipattern or preference
 * - paradigm wisdom decide - Create a new decision record
 * - paradigm wisdom expert [query] - Find experts
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import * as yaml from 'js-yaml';
import { log } from '../../utils/logger.js';

interface WisdomPreferences {
  version: string;
  updated: string;
  by_symbol: Record<string, SymbolPreference>;
  global: GlobalPreference;
}

interface SymbolPreference {
  patterns?: string[];
  testing?: string;
  performance?: string;
  ux?: string;
  notes?: string;
}

interface GlobalPreference {
  code_style?: string[];
  testing?: string[];
  error_handling?: string[];
  naming?: string[];
  documentation?: string[];
}

interface WisdomAntipattern {
  id: string;
  symbols: string[];
  description: string;
  reason: string;
  alternative: string;
  learned_from?: string;
  added?: string;
  added_by?: string;
}

interface WisdomDecision {
  id: string;
  title: string;
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  date: string;
  symbols: string[];
  context: string;
  decision: string;
  rationale: {
    factors: string[];
    conclusion: string;
  };
  consequences: {
    positive: string[];
    negative: string[];
    mitigations?: string[];
  };
  superseded_by?: string;
}

interface ExpertEntry {
  name: string;
  symbols?: string[];
  areas?: string[];
  contact?: string;
  notes?: string;
}

const WISDOM_DIR = '.paradigm/wisdom';

/**
 * paradigm wisdom show [symbol]
 */
export async function wisdomShowCommand(
  symbol?: string,
  options: { json?: boolean } = {}
): Promise<void> {
  const rootDir = process.cwd();
  const wisdomPath = path.join(rootDir, WISDOM_DIR);

  if (!fs.existsSync(wisdomPath)) {
    console.log(chalk.yellow('No wisdom directory found.'));
    console.log(chalk.gray(`Run \`paradigm wisdom init\` to create .paradigm/wisdom/`));
    return;
  }

  // Load all wisdom data
  const preferences = loadYaml<WisdomPreferences>(path.join(wisdomPath, 'preferences.yaml'));
  const antipatterns = loadYaml<{ antipatterns: WisdomAntipattern[] }>(
    path.join(wisdomPath, 'antipatterns.yaml')
  );
  const expertise = loadYaml<{ experts: ExpertEntry[] }>(path.join(wisdomPath, 'expertise.yaml'));
  const decisions = loadDecisions(wisdomPath);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          preferences,
          antipatterns: antipatterns?.antipatterns || [],
          expertise: expertise?.experts || [],
          decisions,
        },
        null,
        2
      )
    );
    return;
  }

  // Display wisdom
  console.log(chalk.magenta('\n  Wisdom\n'));

  // If symbol specified, show symbol-specific wisdom
  if (symbol) {
    console.log(chalk.cyan(`  Symbol: ${symbol}\n`));

    const pref = preferences?.by_symbol?.[symbol];
    if (pref) {
      console.log(chalk.white('  Preferences:'));
      if (pref.patterns) {
        pref.patterns.forEach((p) => console.log(chalk.gray(`    - ${p}`)));
      }
      if (pref.testing) console.log(chalk.gray(`    Testing: ${pref.testing}`));
      console.log();
    }

    const symbolAntipatterns = (antipatterns?.antipatterns || []).filter((a) =>
      a.symbols.includes(symbol)
    );
    if (symbolAntipatterns.length > 0) {
      console.log(chalk.red('  Antipatterns:'));
      symbolAntipatterns.forEach((a) => {
        console.log(chalk.gray(`    [${a.id}] ${a.description}`));
        console.log(chalk.gray(`    Reason: ${a.reason}`));
        console.log(chalk.green(`    Alternative: ${a.alternative}`));
        console.log();
      });
    }

    const symbolDecisions = decisions.filter((d) => d.symbols.includes(symbol));
    if (symbolDecisions.length > 0) {
      console.log(chalk.blue('  Decisions:'));
      symbolDecisions.forEach((d) => {
        console.log(chalk.gray(`    [${d.id}] ${d.title} (${d.status})`));
      });
      console.log();
    }

    const experts = (expertise?.experts || []).filter((e) => e.symbols?.includes(symbol));
    if (experts.length > 0) {
      console.log(chalk.yellow('  Experts:'));
      experts.forEach((e) => {
        console.log(chalk.gray(`    - ${e.name}${e.contact ? ` (${e.contact})` : ''}`));
      });
    }

    return;
  }

  // Show overview
  console.log(chalk.white('  Global Preferences:'));
  if (preferences?.global) {
    const global = preferences.global;
    if (global.code_style?.length) {
      console.log(chalk.gray('    Code Style:'));
      global.code_style.forEach((s) => console.log(chalk.gray(`      - ${s}`)));
    }
    if (global.testing?.length) {
      console.log(chalk.gray('    Testing:'));
      global.testing.forEach((t) => console.log(chalk.gray(`      - ${t}`)));
    }
  } else {
    console.log(chalk.gray('    No global preferences defined'));
  }
  console.log();

  const symbolPrefs = Object.keys(preferences?.by_symbol || {});
  if (symbolPrefs.length > 0) {
    console.log(chalk.white(`  Symbol Preferences: ${symbolPrefs.length}`));
    symbolPrefs.slice(0, 5).forEach((s) => console.log(chalk.gray(`    - ${s}`)));
    if (symbolPrefs.length > 5) {
      console.log(chalk.gray(`    ... and ${symbolPrefs.length - 5} more`));
    }
    console.log();
  }

  const antis = antipatterns?.antipatterns || [];
  if (antis.length > 0) {
    console.log(chalk.red(`  Antipatterns: ${antis.length}`));
    antis.slice(0, 3).forEach((a) => {
      console.log(chalk.gray(`    [${a.id}] ${a.description.slice(0, 60)}...`));
    });
    if (antis.length > 3) {
      console.log(chalk.gray(`    ... and ${antis.length - 3} more`));
    }
    console.log();
  }

  if (decisions.length > 0) {
    console.log(chalk.blue(`  Decisions: ${decisions.length}`));
    decisions.slice(0, 3).forEach((d) => {
      console.log(chalk.gray(`    [${d.id}] ${d.title} (${d.status})`));
    });
    if (decisions.length > 3) {
      console.log(chalk.gray(`    ... and ${decisions.length - 3} more`));
    }
    console.log();
  }

  const experts = expertise?.experts || [];
  if (experts.length > 0) {
    console.log(chalk.yellow(`  Experts: ${experts.length}`));
    experts.slice(0, 3).forEach((e) => {
      console.log(chalk.gray(`    - ${e.name}: ${e.areas?.join(', ') || e.symbols?.join(', ')}`));
    });
    console.log();
  }
}

/**
 * paradigm wisdom init
 */
export async function wisdomInitCommand(options: { force?: boolean } = {}): Promise<void> {
  const rootDir = process.cwd();
  const wisdomPath = path.join(rootDir, WISDOM_DIR);

  if (fs.existsSync(wisdomPath) && !options.force) {
    console.log(chalk.yellow('Wisdom directory already exists.'));
    console.log(chalk.gray('Use --force to reinitialize'));
    return;
  }

  // Create directories
  fs.mkdirSync(wisdomPath, { recursive: true });
  fs.mkdirSync(path.join(wisdomPath, 'decisions'), { recursive: true });

  // Create template files
  const preferencesTemplate: WisdomPreferences = {
    version: '1.0',
    updated: new Date().toISOString(),
    by_symbol: {
      '@example': {
        patterns: ['Use optimistic UI updates', 'Show skeleton loaders'],
        testing: 'Require e2e tests for happy path',
      },
    },
    global: {
      code_style: ['Prefer early returns', 'Named exports only'],
      testing: ['Unit for pure functions', 'E2E for critical flows'],
    },
  };

  const antipatternsTemplate = {
    version: '1.0',
    antipatterns: [
      {
        id: 'example-001',
        symbols: ['@example'],
        description: 'Example antipattern - do NOT do this',
        reason: 'Explain why this is bad',
        alternative: 'Do this instead',
        added: new Date().toISOString(),
      },
    ],
  };

  const expertiseTemplate = {
    version: '1.0',
    experts: [
      {
        name: 'your-name',
        symbols: ['@feature'],
        areas: ['domain-area'],
        contact: 'email or slack',
      },
    ],
  };

  fs.writeFileSync(
    path.join(wisdomPath, 'preferences.yaml'),
    yaml.dump(preferencesTemplate, { lineWidth: -1 })
  );
  fs.writeFileSync(
    path.join(wisdomPath, 'antipatterns.yaml'),
    yaml.dump(antipatternsTemplate, { lineWidth: -1 })
  );
  fs.writeFileSync(
    path.join(wisdomPath, 'expertise.yaml'),
    yaml.dump(expertiseTemplate, { lineWidth: -1 })
  );

  console.log(chalk.green('Wisdom directory initialized!'));
  console.log(chalk.gray(`  ${wisdomPath}/`));
  console.log(chalk.gray('    preferences.yaml'));
  console.log(chalk.gray('    antipatterns.yaml'));
  console.log(chalk.gray('    expertise.yaml'));
  console.log(chalk.gray('    decisions/'));
}

/**
 * paradigm wisdom add antipattern
 */
export async function wisdomAddAntipatternCommand(options: {
  id: string;
  symbols: string;
  description: string;
  reason: string;
  alternative: string;
}): Promise<void> {
  const rootDir = process.cwd();
  const filePath = path.join(rootDir, WISDOM_DIR, 'antipatterns.yaml');

  let data: { version: string; antipatterns: WisdomAntipattern[] } = {
    version: '1.0',
    antipatterns: [],
  };

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    data = yaml.load(content) as typeof data;
  } else {
    fs.mkdirSync(path.join(rootDir, WISDOM_DIR), { recursive: true });
  }

  const antipattern: WisdomAntipattern = {
    id: options.id,
    symbols: options.symbols.split(',').map((s) => s.trim()),
    description: options.description,
    reason: options.reason,
    alternative: options.alternative,
    added: new Date().toISOString(),
  };

  data.antipatterns.push(antipattern);
  fs.writeFileSync(filePath, yaml.dump(data, { lineWidth: -1 }));

  console.log(chalk.green(`Antipattern ${options.id} added!`));
}

/**
 * paradigm wisdom decide
 */
export async function wisdomDecideCommand(options: {
  id: string;
  title: string;
  symbols: string;
  context: string;
  decision: string;
  status?: 'proposed' | 'accepted';
}): Promise<void> {
  const rootDir = process.cwd();
  const decisionsPath = path.join(rootDir, WISDOM_DIR, 'decisions');

  fs.mkdirSync(decisionsPath, { recursive: true });

  const decision: WisdomDecision = {
    id: options.id,
    title: options.title,
    status: options.status || 'proposed',
    date: new Date().toISOString().split('T')[0],
    symbols: options.symbols.split(',').map((s) => s.trim()),
    context: options.context,
    decision: options.decision,
    rationale: {
      factors: [],
      conclusion: '',
    },
    consequences: {
      positive: [],
      negative: [],
    },
  };

  const fileName = `${decision.id}-${slugify(decision.title)}.yaml`;
  const filePath = path.join(decisionsPath, fileName);

  fs.writeFileSync(filePath, yaml.dump(decision, { lineWidth: -1 }));

  console.log(chalk.green(`Decision ${decision.id} created!`));
  console.log(chalk.gray(`  ${filePath}`));
  console.log(chalk.gray('  Edit the file to add rationale and consequences'));
}

/**
 * paradigm wisdom expert [query]
 */
export async function wisdomExpertCommand(
  query?: string,
  options: { json?: boolean } = {}
): Promise<void> {
  const rootDir = process.cwd();
  const filePath = path.join(rootDir, WISDOM_DIR, 'expertise.yaml');

  if (!fs.existsSync(filePath)) {
    console.log(chalk.yellow('No expertise file found.'));
    return;
  }

  const data = loadYaml<{ experts: ExpertEntry[] }>(filePath);
  let experts = data?.experts || [];

  if (query) {
    experts = experts.filter(
      (e) =>
        e.symbols?.some((s) => s.includes(query)) ||
        e.areas?.some((a) => a.toLowerCase().includes(query.toLowerCase()))
    );
  }

  if (options.json) {
    console.log(JSON.stringify({ experts }, null, 2));
    return;
  }

  if (experts.length === 0) {
    console.log(chalk.yellow('No experts found'));
    return;
  }

  console.log(chalk.magenta('\n  Experts\n'));
  experts.forEach((e) => {
    console.log(chalk.white(`  ${e.name}`));
    if (e.symbols) console.log(chalk.gray(`    Symbols: ${e.symbols.join(', ')}`));
    if (e.areas) console.log(chalk.gray(`    Areas: ${e.areas.join(', ')}`));
    if (e.contact) console.log(chalk.gray(`    Contact: ${e.contact}`));
    console.log();
  });
}

// Helper functions
function loadYaml<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) as T;
  } catch {
    return null;
  }
}

function loadDecisions(wisdomPath: string): WisdomDecision[] {
  const decisionsPath = path.join(wisdomPath, 'decisions');
  if (!fs.existsSync(decisionsPath)) return [];

  const decisions: WisdomDecision[] = [];
  const files = fs.readdirSync(decisionsPath);

  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const content = fs.readFileSync(path.join(decisionsPath, file), 'utf8');
    try {
      decisions.push(yaml.load(content) as WisdomDecision);
    } catch {
      // Skip invalid files
    }
  }

  return decisions.sort((a, b) => a.id.localeCompare(b.id));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
