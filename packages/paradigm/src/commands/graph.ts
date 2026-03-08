import chalk from 'chalk';
import * as fs from 'fs';
import * as pathMod from 'path';

interface GraphOptions {
  port?: string;
  open?: boolean;
}

export async function graphCommand(path: string | undefined, options: GraphOptions): Promise<void> {
  const projectDir = path || process.cwd();
  const port = parseInt(options.port || '3841', 10);
  const shouldOpen = options.open !== false;

  console.log(chalk.cyan('\nStarting Symbol Graph...\n'));

  try {
    const { startGraphServer } = await import('../graph-server/index.js');

    console.log(chalk.gray(`Project: ${projectDir}`));
    console.log(chalk.gray(`Port: ${port}`));
    console.log();

    await startGraphServer({ port, projectDir, open: shouldOpen });

    console.log(chalk.green(`\nSymbol Graph is running at http://localhost:${port}`));
    console.log(chalk.gray('\nPress Ctrl+C to stop\n'));

    // Keep process running
    await new Promise(() => {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(chalk.red(`\nError: Port ${port} is already in use.`));
      console.log(chalk.gray(`Try: paradigm graph --port ${port + 1}\n`));
    } else {
      console.error(chalk.red('\nFailed to start Symbol Graph:'), error);
    }
    process.exit(1);
  }
}

// ============================================================================
// Graph Generate — CLI subcommand
// ============================================================================

const GRAPHS_DIR = '.paradigm/graphs';

interface GraphGenerateOptions {
  symbols?: string;
  group?: string[];
  link?: string[];
}

interface SymbolData {
  id: string;
  name: string;
  category: string;
  prefix: string;
  description?: string;
  path?: string;
}

interface GroupInput { label: string; symbols: string[] }
interface LinkInput { source: string; target: string; label?: string }

const CATEGORY_PREFIXES: Record<string, string> = {
  component: '#', flow: '$', gate: '^', signal: '!', aspect: '~',
};

const NODE_W = 200, NODE_H = 60, NODE_GAP = 20, GPAD = 40, GHEADER = 50, GGAP = 60;

const SCAN_CATEGORY_MAP: Record<string, string> = {
  components: 'component', flows: 'flow', gates: 'gate', signals: 'signal', aspects: 'aspect',
};

function loadSymbolsFromIndex(projectDir: string): SymbolData[] {
  const indexPath = pathMod.join(projectDir, '.paradigm', 'scan-index.json');
  if (!fs.existsSync(indexPath)) return [];
  const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const out: SymbolData[] = [];
  for (const [sectionKey, categoryName] of Object.entries(SCAN_CATEGORY_MAP)) {
    const section = raw[sectionKey];
    if (!section || typeof section !== 'object') continue;
    for (const [id, sym] of Object.entries(section)) {
      const s = sym as Record<string, unknown>;
      out.push({ id, name: id, category: categoryName, prefix: CATEGORY_PREFIXES[categoryName] || '#', description: s.description as string | undefined, path: s.path as string | undefined });
    }
  }
  return out;
}

function resolveSymbol(name: string, all: SymbolData[]): SymbolData | undefined {
  const stripped = name.replace(/^[#$^!~]/, '');
  return all.find((s) => s.id === stripped || s.name === stripped || s.id === name || s.name === name);
}

export function cliBuildGraphState(
  projectDir: string,
  symbolFilter?: string[],
  groups?: GroupInput[],
  links?: LinkInput[],
  graphName = 'Generated Graph',
) {
  const allSymbols = loadSymbolsFromIndex(projectDir);
  let included = symbolFilter && symbolFilter.length > 0
    ? symbolFilter.map((n) => resolveSymbol(n, allSymbols)).filter(Boolean) as SymbolData[]
    : allSymbols;

  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  const groupIdMap = new Map<string, string>();
  const assigned = new Set<string>();
  let nextX = 0;

  if (groups && groups.length > 0) {
    for (const g of groups) {
      const gid = `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      groupIdMap.set(g.label, gid);
      const members = g.symbols.map((n) => resolveSymbol(n, included)).filter(Boolean) as SymbolData[];
      const cols = Math.max(Math.ceil(Math.sqrt(members.length)), 1);
      const rows = Math.max(Math.ceil(members.length / cols), 1);
      for (let i = 0; i < members.length; i++) {
        const sym = members[i];
        const c = i % cols, r = Math.floor(i / cols);
        nodes.push({ id: `sym-${sym.id}`, type: 'symbolNode', position: { x: GPAD + c * (NODE_W + NODE_GAP), y: GHEADER + GPAD + r * (NODE_H + NODE_GAP) }, parentId: gid, data: { type: 'symbol', symbol: sym, label: `${CATEGORY_PREFIXES[sym.category] || '#'}${sym.name}` } });
        assigned.add(sym.id);
      }
      const gw = GPAD * 2 + cols * NODE_W + (cols - 1) * NODE_GAP;
      const gh = GHEADER + GPAD * 2 + rows * NODE_H + (rows - 1) * NODE_GAP;
      nodes.unshift({ id: gid, type: 'groupNode', position: { x: nextX, y: 0 }, style: { width: gw, height: gh }, data: { type: 'group', label: g.label } });
      nextX += gw + GGAP;
    }
  }

  const ungrouped = included.filter((s) => !assigned.has(s.id));
  if (ungrouped.length > 0) {
    const startY = groups && groups.length > 0 ? 400 : 0;
    const cols = Math.max(Math.ceil(Math.sqrt(ungrouped.length)), 1);
    for (let i = 0; i < ungrouped.length; i++) {
      const sym = ungrouped[i];
      const c = i % cols, r = Math.floor(i / cols);
      nodes.push({ id: `sym-${sym.id}`, type: 'symbolNode', position: { x: c * (NODE_W + NODE_GAP), y: startY + r * (NODE_H + NODE_GAP) }, data: { type: 'symbol', symbol: sym, label: `${CATEGORY_PREFIXES[sym.category] || '#'}${sym.name}` } });
    }
  }

  if (links && links.length > 0) {
    for (const l of links) {
      const src = groupIdMap.get(l.source), tgt = groupIdMap.get(l.target);
      if (src && tgt) edges.push({ id: `e-${src}-${tgt}`, source: src, target: tgt, type: 'default', label: l.label, data: { label: l.label } });
    }
  }

  return { version: '1.0', name: graphName, projectId: pathMod.basename(projectDir), lastModified: new Date().toISOString(), nodes, edges };
}

export async function graphGenerateCommand(
  name: string,
  path: string | undefined,
  options: GraphGenerateOptions,
): Promise<void> {
  const projectDir = path || process.cwd();
  const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  try {
    const symbolFilter = options.symbols
      ? options.symbols.split(',').map((s) => s.trim())
      : undefined;

    const groups = options.group?.map((g) => {
      const colonIdx = g.indexOf(':');
      if (colonIdx === -1) {
        console.error(chalk.red(`Invalid group format: "${g}". Expected "Label:#sym1,#sym2"`));
        process.exit(1);
      }
      return { label: g.slice(0, colonIdx), symbols: g.slice(colonIdx + 1).split(',').map((s) => s.trim()) };
    });

    const links = options.link?.map((l) => {
      const arrowIdx = l.indexOf('>');
      if (arrowIdx === -1) {
        console.error(chalk.red(`Invalid link format: "${l}". Expected "Source>Target:label"`));
        process.exit(1);
      }
      const source = l.slice(0, arrowIdx);
      const rest = l.slice(arrowIdx + 1);
      const colonIdx = rest.indexOf(':');
      return { source, target: colonIdx === -1 ? rest : rest.slice(0, colonIdx), label: colonIdx === -1 ? undefined : rest.slice(colonIdx + 1) };
    });

    const state = cliBuildGraphState(projectDir, symbolFilter, groups, links, name);
    const json = JSON.stringify(state, null, 2);

    const graphsDir = pathMod.join(projectDir, GRAPHS_DIR);
    if (!fs.existsSync(graphsDir)) fs.mkdirSync(graphsDir, { recursive: true });
    const outPath = pathMod.join(graphsDir, `${slug}.graph.json`);
    fs.writeFileSync(outPath, json, 'utf8');

    console.log(chalk.green(`Graph saved to ${outPath}`));
    console.log(chalk.gray(`${state.nodes.length} nodes, ${state.edges.length} edges, ${(json.length / 1024).toFixed(1)} KB`));
    console.log(chalk.gray(`\nView: paradigm graph`));
  } catch (error) {
    console.error(chalk.red('Failed to generate graph:'), (error as Error).message);
    process.exit(1);
  }
}
