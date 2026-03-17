/**
 * Persona CLI Commands — #persona-cli
 *
 * Commands:
 * - paradigm persona list - List all personas with filtering
 * - paradigm persona show <id> - Full persona detail
 * - paradigm persona validate [<id>] - Validate schema + cross-refs
 * - paradigm persona coverage - Coverage report vs portal.yaml routes
 * - paradigm persona run <id> --base-url <url> - Execute persona journey
 * - paradigm persona affected <symbol> - Which personas use this symbol?
 * - paradigm persona delete <id> - Delete persona
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import * as yaml from 'js-yaml';

// ═══════════════════════════════════════════════════════════════════
// TYPES (minimal, matches paradigm-mcp/src/types/personas.ts)
// ═══════════════════════════════════════════════════════════════════

interface PersonaStep {
  id: string;
  description?: string;
  route: string;
  flow?: string;
  gates: string[];
  expect: { status: number; body?: { has?: string[]; match?: Record<string, unknown> } };
  produces?: Record<string, string>;
  spawns?: Array<{ persona: string; at_step?: string }>;
  signals?: string[];
}

interface Persona {
  version?: string;
  id: string;
  name: string;
  description?: string;
  traits?: Record<string, unknown>;
  trigger: { type: string; spawned_by?: string; spawned_at?: string; context?: Record<string, unknown> };
  fixtures?: Record<string, string>;
  tags?: string[];
  journey: PersonaStep[];
  created?: string;
  updated?: string;
}

interface PersonaIndex {
  personas?: Record<string, {
    name: string;
    trigger: string;
    steps: number;
    gates: string[];
    flows: string[];
    routes: string[];
    spawns: string[];
    tags: string[];
  }>;
  gate_coverage?: Record<string, string[]>;
  route_coverage?: Record<string, string[]>;
  uncovered_routes?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// LOADER
// ═══════════════════════════════════════════════════════════════════

function personasDir(rootDir: string): string {
  return path.join(rootDir, '.paradigm', 'personas');
}

function loadAllPersonas(rootDir: string): Persona[] {
  const dir = personasDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.persona'))
    .sort()
    .map(f => {
      try {
        const content = fs.readFileSync(path.join(dir, f), 'utf8');
        return yaml.load(content) as Persona;
      } catch { return null; }
    })
    .filter((p): p is Persona => p !== null && !!p.id);
}

function loadPersona(rootDir: string, id: string): Persona | null {
  const filePath = path.join(personasDir(rootDir), `${id}.persona`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8')) as Persona;
  } catch { return null; }
}

function loadIndex(rootDir: string): PersonaIndex | null {
  const indexPath = path.join(personasDir(rootDir), 'index.yaml');
  if (!fs.existsSync(indexPath)) return null;
  try {
    return yaml.load(fs.readFileSync(indexPath, 'utf8')) as PersonaIndex;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// paradigm persona list
// ═══════════════════════════════════════════════════════════════════

export async function personaListCommand(options: {
  tag?: string;
  trigger?: string;
  gate?: string;
  json?: boolean;
}) {
  const cwd = process.cwd();
  let personas = loadAllPersonas(cwd);

  if (personas.length === 0) {
    console.log(chalk.yellow('\n  No personas found. Create one with paradigm_persona_create.\n'));
    return;
  }

  if (options.tag) {
    personas = personas.filter(p => p.tags?.includes(options.tag!));
  }
  if (options.trigger) {
    personas = personas.filter(p => p.trigger.type === options.trigger);
  }
  if (options.gate) {
    personas = personas.filter(p => p.journey.some(s => s.gates.includes(options.gate!)));
  }

  if (options.json) {
    console.log(JSON.stringify(personas.map(p => ({
      id: p.id, name: p.name, trigger: p.trigger.type,
      steps: p.journey.length, tags: p.tags || [],
      gates: [...new Set(p.journey.flatMap(s => s.gates))],
    })), null, 2));
    return;
  }

  console.log(chalk.blue(`\n  Personas (${personas.length})\n`));

  for (const p of personas) {
    const gates = [...new Set(p.journey.flatMap(s => s.gates))];
    const triggerColor = p.trigger.type === 'root' ? chalk.green : chalk.cyan;

    console.log(`  ${chalk.white.bold(p.id)} — ${p.name}`);
    console.log(`    ${triggerColor(p.trigger.type)} trigger, ${p.journey.length} steps, ${gates.length} gates`);
    if (p.tags?.length) {
      console.log(`    ${chalk.gray(p.tags.map(t => `[${t}]`).join(' '))}`);
    }
    if (p.description) {
      console.log(`    ${chalk.gray(p.description)}`);
    }
    console.log();
  }
}

// ═══════════════════════════════════════════════════════════════════
// paradigm persona show <id>
// ═══════════════════════════════════════════════════════════════════

export async function personaShowCommand(id: string, options: { json?: boolean }) {
  const cwd = process.cwd();
  const persona = loadPersona(cwd, id);

  if (!persona) {
    console.log(chalk.red(`Persona "${id}" not found.`));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(persona, null, 2));
    return;
  }

  console.log(chalk.blue(`\n  Persona: ${chalk.white.bold(persona.name)}\n`));
  console.log(`  ID:       ${persona.id}`);
  console.log(`  Trigger:  ${persona.trigger.type}`);
  if (persona.trigger.spawned_by) console.log(`  Spawned:  by ${persona.trigger.spawned_by}`);
  if (persona.description) console.log(`  Desc:     ${persona.description}`);
  if (persona.tags?.length) console.log(`  Tags:     ${persona.tags.join(', ')}`);

  if (persona.traits && Object.keys(persona.traits).length) {
    console.log(chalk.cyan('\n  Traits:'));
    for (const [k, v] of Object.entries(persona.traits)) {
      console.log(`    ${k}: ${chalk.white(String(v))}`);
    }
  }

  if (persona.fixtures && Object.keys(persona.fixtures).length) {
    console.log(chalk.cyan('\n  Fixtures:'));
    for (const [k, v] of Object.entries(persona.fixtures)) {
      console.log(`    ${k}: ${chalk.gray(v)}`);
    }
  }

  console.log(chalk.cyan(`\n  Journey (${persona.journey.length} steps):`));
  for (let i = 0; i < persona.journey.length; i++) {
    const step = persona.journey[i];
    const gateStr = step.gates.map(g => chalk.yellow(g)).join(', ');
    console.log(`    ${chalk.gray(`${i + 1}.`)} ${chalk.white(step.id)} — ${step.route}`);
    console.log(`       Gates: ${gateStr}  Expect: ${step.expect.status}`);
    if (step.flow) console.log(`       Flow: ${chalk.magenta(step.flow)}`);
    if (step.produces) console.log(`       Produces: ${Object.keys(step.produces).join(', ')}`);
    if (step.spawns?.length) console.log(`       Spawns: ${step.spawns.map(s => s.persona).join(', ')}`);
    if (step.signals?.length) console.log(`       Signals: ${step.signals.join(', ')}`);
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════════
// paradigm persona validate [<id>]
// ═══════════════════════════════════════════════════════════════════

export async function personaValidateCommand(id?: string, options?: { json?: boolean }) {
  const cwd = process.cwd();
  const personas = id ? [loadPersona(cwd, id)].filter(Boolean) as Persona[] : loadAllPersonas(cwd);

  if (personas.length === 0) {
    console.log(chalk.yellow(id ? `Persona "${id}" not found.` : 'No personas found.'));
    return;
  }

  // Load portal.yaml for gate validation
  let portalGates: string[] = [];
  const portalPath = path.join(cwd, 'portal.yaml');
  if (fs.existsSync(portalPath)) {
    try {
      const portal = yaml.load(fs.readFileSync(portalPath, 'utf8')) as { gates?: Record<string, unknown> };
      portalGates = Object.keys(portal?.gates || {}).map(g => g.startsWith('^') ? g : `^${g}`);
    } catch { /* ignore */ }
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  const results: Array<{ id: string; errors: string[]; warnings: string[] }> = [];

  for (const persona of personas) {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Schema checks
    if (!persona.id) errors.push('Missing required field: id');
    if (!persona.name) errors.push('Missing required field: name');
    if (!persona.journey || persona.journey.length === 0) errors.push('Journey must have at least 1 step');

    // Step validation
    const stepIds = new Set<string>();
    for (const step of persona.journey || []) {
      if (!step.id) errors.push('Step missing id');
      if (stepIds.has(step.id)) errors.push(`Duplicate step id: ${step.id}`);
      stepIds.add(step.id);

      if (!step.route) errors.push(`Step ${step.id}: missing route`);
      if (!step.gates || step.gates.length === 0) errors.push(`Step ${step.id}: gates[] required`);
      if (!step.expect?.status) errors.push(`Step ${step.id}: expect.status required`);

      // Gate cross-ref
      if (portalGates.length > 0) {
        for (const gate of step.gates || []) {
          if (!portalGates.includes(gate)) {
            warnings.push(`Step ${step.id}: gate ${gate} not in portal.yaml`);
          }
        }
      }

      // Spawn cross-ref
      for (const spawn of step.spawns || []) {
        const target = loadPersona(cwd, spawn.persona);
        if (!target) warnings.push(`Step ${step.id}: spawns ${spawn.persona} but that persona doesn't exist`);
      }
    }

    totalErrors += errors.length;
    totalWarnings += warnings.length;
    results.push({ id: persona.id, errors, warnings });
  }

  if (options?.json) {
    console.log(JSON.stringify({ results, totalErrors, totalWarnings }, null, 2));
    return;
  }

  console.log(chalk.blue(`\n  Persona Validation (${personas.length} persona(s))\n`));

  for (const r of results) {
    if (r.errors.length === 0 && r.warnings.length === 0) {
      console.log(`  ${chalk.green('✓')} ${r.id}`);
    } else {
      if (r.errors.length > 0) {
        console.log(`  ${chalk.red('✗')} ${r.id} — ${r.errors.length} error(s)`);
        for (const e of r.errors) console.log(`    ${chalk.red('•')} ${e}`);
      }
      if (r.warnings.length > 0) {
        console.log(`  ${chalk.yellow('⚠')} ${r.id} — ${r.warnings.length} warning(s)`);
        for (const w of r.warnings) console.log(`    ${chalk.yellow('•')} ${w}`);
      }
    }
  }

  console.log();
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(chalk.green('  All personas valid.'));
  } else {
    console.log(`  ${chalk.red(`${totalErrors} error(s)`)}, ${chalk.yellow(`${totalWarnings} warning(s)`)}`);
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════════
// paradigm persona coverage
// ═══════════════════════════════════════════════════════════════════

export async function personaCoverageCommand(options: { json?: boolean }) {
  const cwd = process.cwd();
  const index = loadIndex(cwd);

  if (!index) {
    console.log(chalk.yellow('\n  No persona index found. Run paradigm_reindex first.\n'));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({
      gate_coverage: index.gate_coverage || {},
      route_coverage: index.route_coverage || {},
      uncovered_routes: index.uncovered_routes || [],
    }, null, 2));
    return;
  }

  console.log(chalk.blue('\n  Persona Coverage Report\n'));

  // Gate coverage
  const gateCov = index.gate_coverage || {};
  if (Object.keys(gateCov).length > 0) {
    console.log(chalk.cyan('  Gate Coverage:'));
    for (const [gate, personas] of Object.entries(gateCov)) {
      console.log(`    ${chalk.yellow(gate)} — ${personas.join(', ')}`);
    }
    console.log();
  }

  // Route coverage
  const routeCov = index.route_coverage || {};
  if (Object.keys(routeCov).length > 0) {
    console.log(chalk.cyan('  Route Coverage:'));
    for (const [route, personas] of Object.entries(routeCov)) {
      console.log(`    ${chalk.white(route)} — ${personas.join(', ')}`);
    }
    console.log();
  }

  // Uncovered routes
  const uncovered = index.uncovered_routes || [];
  if (uncovered.length > 0) {
    console.log(chalk.red(`  Uncovered Routes (${uncovered.length}):`));
    for (const route of uncovered) {
      console.log(`    ${chalk.red('•')} ${route}`);
    }
    console.log();
  } else {
    console.log(chalk.green('  All portal.yaml routes have persona coverage.'));
    console.log();
  }
}

// ═══════════════════════════════════════════════════════════════════
// paradigm persona run <id>
// ═══════════════════════════════════════════════════════════════════

export async function personaRunCommand(id: string, options: {
  baseUrl: string;
  dryRun?: boolean;
  chain?: boolean;
  json?: boolean;
}) {
  const cwd = process.cwd();
  const persona = loadPersona(cwd, id);

  if (!persona) {
    console.log(chalk.red(`Persona "${id}" not found.`));
    return;
  }

  if (options.dryRun) {
    console.log(chalk.blue(`\n  Dry Run: ${persona.name}\n`));
    for (let i = 0; i < persona.journey.length; i++) {
      const step = persona.journey[i];
      console.log(`  ${chalk.gray(`${i + 1}.`)} ${step.route}`);
      console.log(`     Gates: ${step.gates.join(', ')}`);
      console.log(`     Expect: ${step.expect.status}`);
      if (step.produces) console.log(`     Produces: ${Object.keys(step.produces).join(', ')}`);
    }
    console.log(chalk.gray('\n  (dry run — no HTTP requests made)\n'));
    return;
  }

  console.log(chalk.blue(`\n  Running: ${persona.name} → ${options.baseUrl}\n`));

  const scope: Record<string, unknown> = {
    fixtures: persona.fixtures || {},
    produces: {},
    context: persona.trigger.context || {},
    env: process.env,
  };

  let passed = 0;
  let failed = 0;

  for (const step of persona.journey) {
    const url = `${options.baseUrl}${step.route.split(' ').pop()}`;
    const method = step.route.split(' ')[0];

    // Interpolate payload
    let payload: string | undefined;
    if (step.payload) {
      payload = JSON.stringify(step.payload).replace(/\{\{(\w+)\.(\w+)\}\}/g, (_, ns, key) => {
        const nsObj = scope[ns] as Record<string, unknown> | undefined;
        return nsObj?.[key] !== undefined ? String(nsObj[key]) : `{{${ns}.${key}}}`;
      });
    }

    process.stdout.write(`  ${chalk.gray(`${step.id}:`)} ${method} ${url} ... `);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(step.headers || {}),
      };

      const res = await fetch(url, {
        method,
        headers,
        body: payload,
      });

      if (res.status === step.expect.status) {
        console.log(chalk.green(`${res.status} ✓`));
        passed++;

        // Extract produces
        if (step.produces) {
          try {
            const body = await res.json();
            for (const [key, jsonPath] of Object.entries(step.produces)) {
              const value = jsonPath.split('.').reduce((obj: unknown, k: string) => (obj as Record<string, unknown>)?.[k], body);
              (scope.produces as Record<string, unknown>)[key] = value;
            }
          } catch { /* body parse optional */ }
        }
      } else {
        console.log(chalk.red(`${res.status} ✗ (expected ${step.expect.status})`));
        failed++;
      }
    } catch (err) {
      console.log(chalk.red(`ERROR: ${(err as Error).message}`));
      failed++;
    }
  }

  console.log();
  console.log(`  ${chalk.green(`${passed} passed`)}, ${failed > 0 ? chalk.red(`${failed} failed`) : chalk.green('0 failed')}`);
  console.log();
}

// ═══════════════════════════════════════════════════════════════════
// paradigm persona affected <symbol>
// ═══════════════════════════════════════════════════════════════════

export async function personaAffectedCommand(symbol: string, options: { json?: boolean }) {
  const cwd = process.cwd();
  const personas = loadAllPersonas(cwd);

  const affected: Array<{ id: string; name: string; steps: string[] }> = [];

  for (const p of personas) {
    const matchingSteps = p.journey.filter(s =>
      s.gates.includes(symbol) ||
      s.flow === symbol ||
      s.signals?.includes(symbol)
    );
    if (matchingSteps.length > 0) {
      affected.push({ id: p.id, name: p.name, steps: matchingSteps.map(s => s.id) });
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ symbol, affected }, null, 2));
    return;
  }

  if (affected.length === 0) {
    console.log(chalk.gray(`\n  No personas reference ${symbol}.\n`));
    return;
  }

  console.log(chalk.blue(`\n  Personas affected by ${chalk.yellow(symbol)}:\n`));
  for (const a of affected) {
    console.log(`  ${chalk.white.bold(a.id)} — ${a.name}`);
    console.log(`    Steps: ${a.steps.join(', ')}`);
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════════
// paradigm persona delete <id>
// ═══════════════════════════════════════════════════════════════════

export async function personaDeleteCommand(id: string) {
  const cwd = process.cwd();
  const filePath = path.join(personasDir(cwd), `${id}.persona`);

  if (!fs.existsSync(filePath)) {
    console.log(chalk.red(`Persona "${id}" not found.`));
    return;
  }

  // Check for spawn references
  const allPersonas = loadAllPersonas(cwd);
  const referencedBy = allPersonas.filter(p =>
    p.id !== id && p.journey.some(s => s.spawns?.some(sp => sp.persona === id))
  );

  if (referencedBy.length > 0) {
    console.log(chalk.yellow(`\n  Warning: ${id} is spawned by: ${referencedBy.map(p => p.id).join(', ')}`));
    console.log(chalk.yellow('  Deleting it will break their spawn chains.\n'));
  }

  fs.unlinkSync(filePath);
  console.log(chalk.green(`  Deleted persona "${id}".`));
}
