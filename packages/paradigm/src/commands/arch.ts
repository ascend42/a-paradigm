/**
 * paradigm arch — Query the architectural layer map (.paradigm/arch.yaml)
 *
 * Subcommands:
 *   paradigm arch status    Show tier summary and drift report
 *   paradigm arch diagram   Print Mermaid diagram to stdout
 *
 * Symbol: #atlas-cartographer-cli
 */

import * as path from 'path';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import { out, dim, json, header, kv } from '../utils/cli-output.js';

const ARCH_FILE = '.paradigm/arch.yaml';

interface ArchTier {
  id: string;
  label: string;
  responsibility: string;
  tech?: { framework?: string; libraries?: string[] };
  components: string[];
}

interface ArchLink {
  from: string;
  to: string;
  via?: string;
}

interface ArchMap {
  version: string;
  tiers: ArchTier[];
  links: ArchLink[];
}

function loadArchMap(rootDir: string): ArchMap | null {
  const archPath = path.join(rootDir, ARCH_FILE);
  if (!fs.existsSync(archPath)) return null;
  try {
    const content = fs.readFileSync(archPath, 'utf8');
    return yaml.load(content) as ArchMap;
  } catch {
    return null;
  }
}

function generateMermaid(map: ArchMap): string {
  const sanitize = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const lines: string[] = ['graph TD'];
  for (const tier of map.tiers) {
    const nodeId = sanitize(tier.id);
    lines.push(`  ${nodeId}["${tier.label}\\n(${tier.responsibility})"]`);
  }
  for (const link of map.links) {
    const from = sanitize(link.from);
    const to = sanitize(link.to);
    if (link.via) {
      lines.push(`  ${from} -->|"${link.via}"| ${to}`);
    } else {
      lines.push(`  ${from} --> ${to}`);
    }
  }
  return lines.join('\n');
}

export interface ArchStatusOptions {
  json?: boolean;
}

/** `paradigm arch status` — show tier summary */
export async function archStatusCommand(options: ArchStatusOptions): Promise<void> {
  const rootDir = process.cwd();
  const map = loadArchMap(rootDir);

  if (!map) {
    dim('No .paradigm/arch.yaml found — create one to map your architecture.');
    dim('Example: .paradigm/arch.yaml with version, tiers, and links fields.');
    return;
  }

  if (options.json) {
    const payload = {
      version: map.version,
      tierCount: map.tiers.length,
      tiers: map.tiers.map(tier => ({
        id: tier.id,
        label: tier.label,
        responsibility: tier.responsibility,
        framework: tier.tech?.framework ?? '',
        componentCount: tier.components.length,
        components: tier.components,
      })),
      links: map.links,
    };
    json(payload);
    return;
  }

  header(`Architectural Map  v${map.version}`);
  out('');

  for (const tier of map.tiers) {
    out(`  ${tier.label}`);
    kv('  id', tier.id);
    kv('  responsibility', tier.responsibility);
    if (tier.tech?.framework) kv('  framework', tier.tech.framework);
    kv('  components', `${tier.components.length} declared`);
    if (tier.components.length > 0) {
      dim(`    ${tier.components.slice(0, 5).join(', ')}${tier.components.length > 5 ? ` +${tier.components.length - 5} more` : ''}`);
    }
    out('');
  }

  if (map.links.length > 0) {
    out('  Links:');
    for (const link of map.links) {
      const via = link.via ? ` via ${link.via}` : '';
      dim(`    ${link.from} → ${link.to}${via}`);
    }
    out('');
  }

  dim(`  Run 'paradigm arch diagram' to render a Mermaid diagram.`);
}

/** `paradigm arch diagram` — print Mermaid diagram to stdout */
export async function archDiagramCommand(_options: Record<string, unknown>): Promise<void> {
  const rootDir = process.cwd();
  const map = loadArchMap(rootDir);

  if (!map) {
    dim('No .paradigm/arch.yaml found — cannot render diagram.');
    return;
  }

  const diagram = generateMermaid(map);
  out(diagram);
}
