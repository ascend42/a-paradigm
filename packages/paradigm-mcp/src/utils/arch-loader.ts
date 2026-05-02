/**
 * Arch Loader — reads and writes .paradigm/arch.yaml
 *
 * The arch map declares architectural tiers and the component symbols
 * assigned to each tier. Used by Atlas (cartographer) to compute drift
 * between the declared architecture and the live symbol index.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ProjectContext } from './index-loader.js';
import { getAllSymbols, getSymbolsByType } from '@a-company/premise-core';
import { log } from './mcp-logger.js';

export const ARCH_FILE = '.paradigm/arch.yaml';

export interface ArchTier {
  id: string;
  label: string;
  responsibility: string;
  tech: { framework: string; libraries: string[] };
  components: string[];
}

export interface ArchLink {
  from: string;
  to: string;
  via?: string;
}

export interface ArchMap {
  version: string;
  tiers: ArchTier[];
  links: ArchLink[];
}

export function loadArchMap(rootDir: string): ArchMap | null {
  const archPath = path.join(rootDir, ARCH_FILE);
  if (!fs.existsSync(archPath)) return null;
  try {
    const content = fs.readFileSync(archPath, 'utf8');
    return yaml.load(content) as ArchMap;
  } catch {
    return null;
  }
}

export function saveArchMap(rootDir: string, map: ArchMap): void {
  const archPath = path.join(rootDir, ARCH_FILE);
  const dir = path.dirname(archPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(archPath, yaml.dump(map, { lineWidth: -1, noRefs: true }), 'utf8');
}

export function getArchDrift(
  rootDir: string,
  ctx: ProjectContext,
): { unassigned: string[]; missing_purpose: string[] } {
  const map = loadArchMap(rootDir);
  if (!map) return { unassigned: [], missing_purpose: [] };

  // Build set of all component symbols assigned to tiers
  const tierSet = new Set<string>();
  for (const tier of map.tiers) {
    for (const c of tier.components) tierSet.add(c);
  }

  // Build set of all indexed component symbols
  // SymbolEntry.type === 'component' is the correct check —
  // componentType holds sub-type values ('view', 'service', etc.), not 'component'
  const indexedSet = new Set<string>();
  try {
    const components = getSymbolsByType(ctx.index, 'component');
    for (const entry of components) {
      indexedSet.add(entry.symbol);
    }
  } catch (e) {
    log.component('#arch-loader').warn('Could not load symbol index for drift check', {
      error: String(e),
    });
  }

  const unassigned = Array.from(indexedSet).filter(s => !tierSet.has(s));
  const missing_purpose = Array.from(tierSet).filter(s => !indexedSet.has(s));

  return { unassigned, missing_purpose };
}

export function generateMermaid(map: ArchMap): string {
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
