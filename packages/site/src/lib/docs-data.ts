/**
 * Docs Data Layer — reads Paradigm's own symbol graph for the /docs section.
 *
 * At build time, reads .paradigm/scan-index.json and .paradigm/flow-index.json
 * to generate documentation pages for useparadigm.dev. Also reads portal.yaml
 * for gate/route reference and handwritten markdown content from src/content/docs/.
 */

import * as fs from 'fs';
import * as path from 'path';

/* ── Paths ──────────────────────────────────────────────────────────────── */

const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const SCAN_INDEX_PATH = path.join(REPO_ROOT, '.paradigm', 'scan-index.json');
const FLOW_INDEX_PATH = path.join(REPO_ROOT, '.paradigm', 'flow-index.json');
const PORTAL_PATH = path.join(REPO_ROOT, 'portal.yaml');
const SENTINEL_PORTAL_PATH = path.join(REPO_ROOT, 'packages', 'sentinel', 'portal.yaml');
const CONTENT_DIR = path.join(process.cwd(), 'src', 'content', 'docs');

/* ── Types ──────────────────────────────────────────────────────────────── */

export interface SymbolEntry {
  id: string;
  name: string;
  symbol: string;
  category: string;
  path: string;
  description: string;
  visualTags: string[];
  related: string[];
}

export interface FlowStep {
  id: string;
  action: string;
  symbol?: string;
}

export interface FlowEntry {
  id: string;
  description: string;
  steps: FlowStep[];
  definedIn: string;
}

export interface PortalGate {
  id: string;
  description: string;
  type?: string;
  check?: string;
  requires?: string[];
}

export interface PortalRoute {
  route: string;
  method: string;
  gates: string[];
}

export interface PortalData {
  gates: PortalGate[];
  routes: PortalRoute[];
}

export interface SidebarSection {
  title: string;
  items: SidebarItem[];
}

export interface SidebarItem {
  label: string;
  href: string;
  symbolType?: 'component' | 'flow' | 'gate' | 'signal' | 'aspect';
}

export interface ContentPage {
  title: string;
  description: string;
  order: number;
  body: string;
}

export interface DocsManifest {
  stats: {
    components: number;
    flows: number;
    gates: number;
    signals: number;
    aspects: number;
    purposeFiles: number;
  };
  sections: SidebarSection[];
}

export type SymbolCategory = 'components' | 'flows' | 'gates' | 'signals' | 'aspects';

/* ── Cache ──────────────────────────────────────────────────────────────── */

let scanIndexCache: Record<string, unknown> | null = null;
let flowIndexCache: Record<string, unknown> | null = null;

function loadScanIndex(): Record<string, unknown> {
  if (scanIndexCache) return scanIndexCache;
  try {
    const raw = fs.readFileSync(SCAN_INDEX_PATH, 'utf-8');
    scanIndexCache = JSON.parse(raw);
    return scanIndexCache!;
  } catch {
    return { $meta: {}, components: {}, flows: {}, gates: {}, signals: {}, aspects: {} };
  }
}

function loadFlowIndex(): Record<string, unknown> {
  if (flowIndexCache) return flowIndexCache;
  try {
    const raw = fs.readFileSync(FLOW_INDEX_PATH, 'utf-8');
    flowIndexCache = JSON.parse(raw);
    return flowIndexCache!;
  } catch {
    return { flows: {} };
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function categoryLabel(cat: SymbolCategory): string {
  const labels: Record<SymbolCategory, string> = {
    components: 'Components',
    flows: 'Flows',
    gates: 'Gates',
    signals: 'Signals',
    aspects: 'Aspects',
  };
  return labels[cat] || cat;
}

function symbolTypeForCategory(
  cat: SymbolCategory
): 'component' | 'flow' | 'gate' | 'signal' | 'aspect' {
  const map: Record<SymbolCategory, 'component' | 'flow' | 'gate' | 'signal' | 'aspect'> = {
    components: 'component',
    flows: 'flow',
    gates: 'gate',
    signals: 'signal',
    aspects: 'aspect',
  };
  return map[cat];
}

function getEntries(category: SymbolCategory): SymbolEntry[] {
  const idx = loadScanIndex();
  const bucket = (idx[category] as Record<string, SymbolEntry>) || {};
  return Object.values(bucket).sort((a, b) => a.id.localeCompare(b.id));
}

/** Parse simple YAML portal files without js-yaml dependency. */
function parsePortalYaml(content: string): { gates: Record<string, PortalGate>; routes: PortalRoute[] } {
  const gates: Record<string, PortalGate> = {};
  const routes: PortalRoute[] = [];
  let inGates = false;
  let inRoutes = false;
  let currentGate: string | null = null;
  let currentGateData: Partial<PortalGate> = {};

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trimEnd();
    // Top-level section detection
    if (/^gates:\s*$/.test(trimmed)) { inGates = true; inRoutes = false; currentGate = null; continue; }
    if (/^routes:\s*$/.test(trimmed)) { inRoutes = true; inGates = false; flushGate(); continue; }
    if (/^version:/.test(trimmed)) continue;

    if (inGates) {
      // Gate ID line (2-space indent, ends with colon)
      const gateMatch = trimmed.match(/^ {2}(\S+):\s*$/);
      if (gateMatch) {
        flushGate();
        currentGate = gateMatch[1];
        currentGateData = { id: currentGate };
        continue;
      }
      // Gate property (4-space indent)
      const propMatch = trimmed.match(/^ {4}(\w+):\s*(.+)/);
      if (propMatch && currentGate) {
        const [, key, val] = propMatch;
        const cleanVal = val.replace(/^["']|["']$/g, '');
        if (key === 'description') currentGateData.description = cleanVal;
        if (key === 'type') currentGateData.type = cleanVal;
        if (key === 'check') currentGateData.check = cleanVal;
        if (key === 'requires') {
          const reqMatch = val.match(/\[([^\]]*)\]/);
          if (reqMatch) {
            currentGateData.requires = reqMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
          }
        }
      }
    }

    if (inRoutes) {
      // Route line: "METHOD /path": [^gate1, ^gate2]
      const routeMatch = trimmed.match(/^\s+"?(\w+)\s+([^"]+)"?:\s*$/);
      const routeInlineMatch = trimmed.match(/^\s+"?(\w+)\s+([^"]+)"?:\s*\[([^\]]*)\]/);
      if (routeInlineMatch) {
        const [, method, route, gatesStr] = routeInlineMatch;
        const gateNames = gatesStr.split(',').map(g => g.trim().replace(/^\^/, ''));
        routes.push({ route, method, gates: gateNames });
      } else if (routeMatch) {
        // Multi-line route (list follows)
        const [, method, route] = routeMatch;
        routes.push({ route, method, gates: [] });
      }
      // Route gate list item
      const gateItemMatch = trimmed.match(/^\s+-\s+\^(.+)/);
      if (gateItemMatch && routes.length > 0) {
        routes[routes.length - 1].gates.push(gateItemMatch[1].trim());
      }
    }
  }
  flushGate();

  function flushGate() {
    if (currentGate && currentGateData.description) {
      gates[currentGate] = currentGateData as PortalGate;
    }
    currentGate = null;
    currentGateData = {};
  }

  return { gates, routes };
}

/** Parse markdown frontmatter + body. */
function parseMarkdown(raw: string): { meta: Record<string, string | number>; body: string } {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return { meta: {}, body: raw };

  const meta: Record<string, string | number> = {};
  for (const line of fmMatch[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) {
      const val = m[2].replace(/^["']|["']$/g, '');
      meta[m[1]] = /^\d+$/.test(val) ? parseInt(val, 10) : val;
    }
  }
  return { meta, body: fmMatch[2].trim() };
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Build the docs sidebar manifest from the scan index.
 * Includes handwritten content pages, symbol categories, portal, and flows.
 */
export function getDocsManifest(): DocsManifest {
  const idx = loadScanIndex();
  const meta = (idx.$meta as Record<string, unknown>) || {};
  const sources = (meta.sources as Record<string, number>) || {};

  const categories: SymbolCategory[] = ['components', 'flows', 'gates', 'signals', 'aspects'];
  const counts: Record<string, number> = {};
  for (const cat of categories) {
    const bucket = (idx[cat] as Record<string, unknown>) || {};
    counts[cat] = Object.keys(bucket).length;
  }

  // Handwritten content
  const contentPages = getContentPages();

  const sections: SidebarSection[] = [];

  // Guides section (handwritten content)
  if (contentPages.length > 0) {
    sections.push({
      title: 'Guides',
      items: contentPages
        .sort((a, b) => a.order - b.order)
        .map(p => ({
          label: p.title,
          href: `/docs/${p.slug}`,
        })),
    });
  }

  // Reference sections for each symbol category
  for (const cat of categories) {
    const entries = getEntries(cat);
    if (entries.length === 0) continue;

    // Pick a representative subset for the sidebar (top 20 by name)
    const top = entries.slice(0, 20);
    const symType = symbolTypeForCategory(cat);

    sections.push({
      title: categoryLabel(cat),
      items: [
        { label: `All ${categoryLabel(cat)} (${entries.length})`, href: `/docs/${cat}` },
        ...top.map(e => ({
          label: e.name,
          href: `/docs/${cat}/${e.id}`,
          symbolType: symType,
        })),
      ],
    });
  }

  // Portal section
  sections.push({
    title: 'Portal',
    items: [{ label: 'Routes & Gates', href: '/docs/portal' }],
  });

  return {
    stats: {
      components: counts.components || 0,
      flows: counts.flows || 0,
      gates: counts.gates || 0,
      signals: counts.signals || 0,
      aspects: counts.aspects || 0,
      purposeFiles: sources.purposeFiles || 0,
    },
    sections,
  };
}

/** Get all symbol entries for a category. */
export function getSymbolList(category: SymbolCategory): SymbolEntry[] {
  return getEntries(category);
}

/** Get a single symbol entry by category and ID. */
export function getSymbolPage(category: SymbolCategory, id: string): SymbolEntry | null {
  const idx = loadScanIndex();
  const bucket = (idx[category] as Record<string, SymbolEntry>) || {};
  return bucket[id] || null;
}

/** Get all symbol IDs for generateStaticParams. */
export function getAllSymbolIds(): Array<{ category: SymbolCategory; id: string }> {
  const categories: SymbolCategory[] = ['components', 'flows', 'gates', 'signals', 'aspects'];
  const result: Array<{ category: SymbolCategory; id: string }> = [];
  for (const cat of categories) {
    const entries = getEntries(cat);
    for (const e of entries) {
      result.push({ category: cat, id: e.id });
    }
  }
  return result;
}

/** Get a flow with its steps. Checks flow-index first, falls back to scan-index. */
export function getFlowPage(id: string): FlowEntry | null {
  // Try flow-index first (has richer step data with action/symbol)
  const flowIdx = loadFlowIndex();
  const flowIndexFlows = (flowIdx.flows as Record<string, FlowEntry>) || {};
  const fromFlowIndex = flowIndexFlows[`$${id}`] || flowIndexFlows[id];
  if (fromFlowIndex) return fromFlowIndex;

  // Fall back to scan-index (steps have name/target/order shape)
  const scanIdx = loadScanIndex();
  const scanFlows = (scanIdx.flows as Record<string, Record<string, unknown>>) || {};
  const scanFlow = scanFlows[id];
  if (!scanFlow) return null;

  // Normalize scan-index step shape to FlowEntry shape
  const rawSteps = (scanFlow.steps as Array<Record<string, unknown>>) || [];
  const steps: FlowStep[] = rawSteps
    .sort((a, b) => ((a.order as number) || 0) - ((b.order as number) || 0))
    .map(s => ({
      id: (s.id as string) || '',
      action: (s.name as string) || (s.action as string) || '',
      symbol: (s.target as string) || (s.symbol as string) || undefined,
    }));

  return {
    id: `$${id}`,
    description: (scanFlow.description as string) || '',
    steps,
    definedIn: (scanFlow.path as string) || '',
  };
}

/** Get all flow IDs. */
export function getAllFlowIds(): string[] {
  const flowIdx = loadFlowIndex();
  const flows = (flowIdx.flows as Record<string, FlowEntry>) || {};
  return Object.keys(flows).map(k => k.replace(/^\$/, ''));
}

/** Get combined portal data from all portal.yaml files. */
export function getPortalData(): PortalData {
  const allGates: PortalGate[] = [];
  const allRoutes: PortalRoute[] = [];

  for (const portalPath of [PORTAL_PATH, SENTINEL_PORTAL_PATH]) {
    try {
      const raw = fs.readFileSync(portalPath, 'utf-8');
      const parsed = parsePortalYaml(raw);
      allGates.push(...Object.values(parsed.gates));
      allRoutes.push(...parsed.routes);
    } catch {
      // File not found — skip
    }
  }

  return { gates: allGates, routes: allRoutes };
}

/** Load a handwritten markdown content page by slug. */
export function getContentPage(slug: string): ContentPage | null {
  const filePath = path.join(CONTENT_DIR, `${slug}.md`);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { meta, body } = parseMarkdown(raw);
    return {
      title: (meta.title as string) || slug,
      description: (meta.description as string) || '',
      order: (meta.order as number) || 99,
      body,
    };
  } catch {
    return null;
  }
}

/** Get all content page slugs and metadata. */
export function getContentPages(): Array<ContentPage & { slug: string }> {
  try {
    const files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.md'));
    return files
      .map(f => {
        const slug = f.replace(/\.md$/, '');
        const page = getContentPage(slug);
        return page ? { ...page, slug } : null;
      })
      .filter((p): p is ContentPage & { slug: string } => p !== null);
  } catch {
    return [];
  }
}

/** Get all static params for the docs catch-all route. */
export function getAllDocsParams(): string[][] {
  const params: string[][] = [];

  // Index page (no slug)
  params.push([]);

  // Handwritten content pages
  const contentPages = getContentPages();
  for (const page of contentPages) {
    params.push([page.slug]);
  }

  // Category index pages
  const categories: SymbolCategory[] = ['components', 'flows', 'gates', 'signals', 'aspects'];
  for (const cat of categories) {
    params.push([cat]);
  }

  // Individual symbol pages
  const allIds = getAllSymbolIds();
  for (const { category, id } of allIds) {
    params.push([category, id]);
  }

  // Portal page
  params.push(['portal']);

  return params;
}

/** Resolve a slug array to a page type and relevant data. */
export function resolveDocsSlug(slugParts: string[]): {
  type: 'index' | 'content' | 'category-list' | 'symbol-detail' | 'portal' | 'not-found';
  data: unknown;
} {
  if (slugParts.length === 0) {
    return { type: 'index', data: getDocsManifest() };
  }

  const [first, second] = slugParts;

  // Portal page
  if (first === 'portal') {
    return { type: 'portal', data: getPortalData() };
  }

  // Category pages
  const categories: SymbolCategory[] = ['components', 'flows', 'gates', 'signals', 'aspects'];
  if (categories.includes(first as SymbolCategory)) {
    const cat = first as SymbolCategory;
    if (!second) {
      return { type: 'category-list', data: { category: cat, entries: getSymbolList(cat) } };
    }
    // Symbol detail
    const entry = getSymbolPage(cat, second);
    if (entry) {
      // For flows, also load the flow steps
      const flow = cat === 'flows' ? getFlowPage(second) : null;
      return { type: 'symbol-detail', data: { entry, flow, category: cat } };
    }
    return { type: 'not-found', data: null };
  }

  // Handwritten content
  const content = getContentPage(first);
  if (content) {
    return { type: 'content', data: content };
  }

  return { type: 'not-found', data: null };
}
