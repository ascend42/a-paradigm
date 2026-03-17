/**
 * Docs Loader — Reads the symbol graph to produce structured documentation
 *
 * Data sources:
 *   .paradigm/scan-index.json  → components, signals, aspects
 *   .paradigm/flow-index.json  → flows
 *   portal.yaml                → gates, routes
 *   .paradigm/university/      → guides (university notes with matching symbols)
 *   docs/                      → custom handwritten markdown pages
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  DocsConfig,
  DocsManifest,
  SidebarGroup,
  SidebarItem,
  SymbolPageData,
  FlowPageData,
  FlowStepData,
  PortalPageData,
  PortalRouteData,
  CustomPageData,
  SearchResult,
} from '../types/docs.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const SCAN_INDEX_PATH = '.paradigm/scan-index.json';
const FLOW_INDEX_PATH = '.paradigm/flow-index.json';
const CONFIG_PATH = '.paradigm/config.yaml';
const PORTAL_FILE = 'portal.yaml';
const UNIVERSITY_INDEX_PATH = '.paradigm/university/index.yaml';

// ═══════════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: DocsConfig = {
  enabled: true,
  title: null,
  theme: 'dark',
  customCss: null,
  customContent: 'docs/',
  exclude: { tags: [], patterns: [] },
  sidebar: { collapsed: [] },
  output: '.paradigm/docs-site',
};

// ═══════════════════════════════════════════════════════════════════
// INTERNAL TYPES — shapes read from JSON/YAML files
// ═══════════════════════════════════════════════════════════════════

interface ScanIndexEntry {
  id: string;
  name: string;
  symbol: string;
  category: string;
  path: string;
  description?: string;
  visualTags?: string[];
  related?: string[];
  componentType?: string;
  parent?: string;
}

interface ScanIndex {
  $meta: {
    project: string;
    componentTypes?: Record<string, number>;
  };
  components: Record<string, ScanIndexEntry>;
  features?: Record<string, ScanIndexEntry>;
  flows: Record<string, ScanIndexEntry & { steps?: Array<{ id: string; name?: string; action?: string; symbol?: string; order?: number }> }>;
  state?: Record<string, ScanIndexEntry>;
  gates: Record<string, ScanIndexEntry>;
  signals: Record<string, ScanIndexEntry>;
  aspects: Record<string, ScanIndexEntry>;
}

interface FlowIndexFlow {
  id?: string;
  name?: string;
  description?: string;
  trigger?: string;
  steps: Array<{ type: string; symbol: string; description?: string }>;
  successSignal?: string;
  errorSignal?: string;
  definedIn?: string;
}

interface FlowIndex {
  version: string;
  generatedAt: string;
  flows: Record<string, FlowIndexFlow>;
}

interface PortalGate {
  description: string;
  check?: string;
  type?: string;
  location?: string;
  prizes?: string[];
}

interface PortalFile {
  version: string;
  gates: Record<string, PortalGate>;
  routes: Record<string, string[]>;
}

interface UniversityIndexEntry {
  id: string;
  title: string;
  type: string;
  tags: string[];
  symbols: string[];
}

interface UniversityIndex {
  entries: UniversityIndexEntry[];
}

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

/**
 * Load docs configuration from .paradigm/config.yaml.
 * Falls back to sensible defaults when the section is missing.
 */
export function loadDocsConfig(rootDir: string): DocsConfig {
  const configPath = path.join(rootDir, CONFIG_PATH);
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const data = yaml.load(raw) as Record<string, unknown> | null;
    if (!data || !data.docs) return { ...DEFAULT_CONFIG };

    const docs = data.docs as Partial<DocsConfig> & Record<string, unknown>;
    return {
      enabled: docs.enabled ?? DEFAULT_CONFIG.enabled,
      title: (docs.title as string | null) ?? DEFAULT_CONFIG.title,
      theme: (docs.theme as DocsConfig['theme']) ?? DEFAULT_CONFIG.theme,
      customCss: (docs.customCss as string | null) ?? DEFAULT_CONFIG.customCss,
      customContent: (docs.customContent as string) ?? DEFAULT_CONFIG.customContent,
      exclude: {
        tags: (docs.exclude as Record<string, unknown>)?.tags as string[] ?? DEFAULT_CONFIG.exclude.tags,
        patterns: (docs.exclude as Record<string, unknown>)?.patterns as string[] ?? DEFAULT_CONFIG.exclude.patterns,
      },
      sidebar: {
        collapsed: (docs.sidebar as Record<string, unknown>)?.collapsed as string[] ?? DEFAULT_CONFIG.sidebar.collapsed,
      },
      output: (docs.output as string) ?? DEFAULT_CONFIG.output,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS — file readers
// ═══════════════════════════════════════════════════════════════════

/**
 * Reads and parses .paradigm/scan-index.json.
 * Returns null when the file is missing or malformed.
 */
export function loadScanIndex(rootDir: string): ScanIndex | null {
  const filePath = path.join(rootDir, SCAN_INDEX_PATH);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as ScanIndex;
  } catch {
    return null;
  }
}

/**
 * Reads and parses .paradigm/flow-index.json.
 * Returns null when the file is missing or malformed.
 */
export function loadFlowIndex(rootDir: string): FlowIndex | null {
  const filePath = path.join(rootDir, FLOW_INDEX_PATH);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as FlowIndex;
  } catch {
    return null;
  }
}

/**
 * Reads and parses portal.yaml from the project root.
 * Returns null when the file is missing or malformed.
 */
export function loadPortal(rootDir: string): PortalFile | null {
  const filePath = path.join(rootDir, PORTAL_FILE);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return yaml.load(raw) as PortalFile;
  } catch {
    return null;
  }
}

/**
 * Load university index to find guide-type content.
 * Returns null when the index is missing or malformed.
 */
function loadUniversityIndex(rootDir: string): UniversityIndex | null {
  const filePath = path.join(rootDir, UNIVERSITY_INDEX_PATH);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return yaml.load(raw) as UniversityIndex;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS — markdown frontmatter
// ═══════════════════════════════════════════════════════════════════

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  try {
    const frontmatter = yaml.load(match[1]) as Record<string, unknown>;
    return { frontmatter, body: match[2].trim() };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS — internal utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Collect every symbol entry from the scan-index into a flat map.
 */
function allEntries(scanIndex: ScanIndex): Map<string, ScanIndexEntry> {
  const entries = new Map<string, ScanIndexEntry>();
  const categories: Array<Record<string, ScanIndexEntry> | undefined> = [
    scanIndex.components,
    scanIndex.features,
    scanIndex.flows as Record<string, ScanIndexEntry>,
    scanIndex.state,
    scanIndex.gates,
    scanIndex.signals,
    scanIndex.aspects,
  ];

  for (const cat of categories) {
    if (!cat) continue;
    for (const [id, entry] of Object.entries(cat)) {
      entries.set(id, entry);
    }
  }

  return entries;
}

/**
 * Map scan-index category to SearchResult kind.
 */
function categoryToSearchKind(category: string): SearchResult['kind'] {
  const mapping: Record<string, SearchResult['kind']> = {
    components: 'component',
    features: 'component',
    flows: 'flow',
    state: 'component',
    gates: 'gate',
    signals: 'signal',
    aspects: 'aspect',
  };
  return mapping[category] || 'component';
}

/**
 * Check whether a symbol should be excluded based on config.
 */
function isExcluded(entry: ScanIndexEntry, config: DocsConfig): boolean {
  // Tag exclusion
  if (config.exclude.tags.length > 0 && entry.visualTags) {
    for (const tag of entry.visualTags) {
      if (config.exclude.tags.includes(tag)) return true;
    }
  }

  // Pattern exclusion (simple glob: only supports trailing *)
  if (config.exclude.patterns.length > 0 && entry.path) {
    for (const pattern of config.exclude.patterns) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (entry.path.includes(prefix)) return true;
      } else if (entry.path.includes(pattern)) {
        return true;
      }
    }
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════
// CUSTOM PAGES
// ═══════════════════════════════════════════════════════════════════

/**
 * Scan the custom content directory for .md files, parse each with frontmatter.
 */
export function loadCustomPages(rootDir: string, customContentDir: string): CustomPageData[] {
  const dir = path.join(rootDir, customContentDir);
  if (!fs.existsSync(dir)) return [];

  const pages: CustomPageData[] = [];

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf8');
        const slug = file.replace(/\.md$/, '');
        const parsed = parseFrontmatter(raw);

        if (parsed) {
          pages.push({
            slug,
            title: (parsed.frontmatter.title as string) || slug,
            body: parsed.body,
            order: typeof parsed.frontmatter.order === 'number' ? parsed.frontmatter.order : undefined,
            description: (parsed.frontmatter.description as string) || undefined,
          });
        } else {
          // No frontmatter — treat entire file as body
          pages.push({
            slug,
            title: slug,
            body: raw.trim(),
          });
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory read failed
  }

  // Sort by order (defined first), then by title
  pages.sort((a, b) => {
    if (a.order != null && b.order != null) return a.order - b.order;
    if (a.order != null) return -1;
    if (b.order != null) return 1;
    return a.title.localeCompare(b.title);
  });

  return pages;
}

/**
 * Load a single custom page by slug.
 */
export function loadCustomPage(rootDir: string, slug: string, config?: DocsConfig): CustomPageData | null {
  const resolvedConfig = config || loadDocsConfig(rootDir);
  const dir = path.join(rootDir, resolvedConfig.customContent);
  const filePath = path.join(dir, `${slug}.md`);

  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontmatter(raw);

    if (parsed) {
      return {
        slug,
        title: (parsed.frontmatter.title as string) || slug,
        body: parsed.body,
        order: typeof parsed.frontmatter.order === 'number' ? parsed.frontmatter.order : undefined,
        description: (parsed.frontmatter.description as string) || undefined,
      };
    }

    // No frontmatter
    return {
      slug,
      title: slug,
      body: raw.trim(),
    };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MANIFEST
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the complete docs manifest: sidebar groups, symbol counts, and metadata.
 *
 * Sources:
 *   1. scan-index.json  → components, signals, aspects, flows (from scan)
 *   2. flow-index.json  → flow step details
 *   3. portal.yaml      → gates, routes
 *   4. custom pages     → docs/ directory markdown
 *   5. university index → guide-type content (notes/policies)
 */
export function buildDocsManifest(rootDir: string, config?: DocsConfig): DocsManifest {
  const resolvedConfig = config || loadDocsConfig(rootDir);
  const scanIndex = loadScanIndex(rootDir);
  const flowIndex = loadFlowIndex(rootDir);
  const portal = loadPortal(rootDir);
  const customPages = loadCustomPages(rootDir, resolvedConfig.customContent);
  const uniIndex = loadUniversityIndex(rootDir);

  // Determine project name
  const projectName = scanIndex?.$meta?.project || path.basename(rootDir);
  const title = resolvedConfig.title || `${projectName} Docs`;

  const groups: SidebarGroup[] = [];
  const symbolCounts: Record<string, number> = {};
  let totalSymbols = 0;

  // ── Custom Pages ───────────────────────────────────────────
  if (customPages.length > 0) {
    groups.push({
      id: 'custom-pages',
      label: 'Pages',
      collapsed: resolvedConfig.sidebar.collapsed.includes('custom-pages'),
      items: customPages.map(p => ({
        id: p.slug,
        label: p.title,
        kind: 'custom' as const,
        description: p.description,
      })),
    });
  }

  // ── Guides (university notes/policies with matching symbols) ─
  if (uniIndex && uniIndex.entries.length > 0) {
    const guideEntries = uniIndex.entries.filter(
      e => (e.type === 'note' || e.type === 'policy') && e.symbols.length > 0,
    );

    if (guideEntries.length > 0) {
      groups.push({
        id: 'guides',
        label: 'Guides',
        collapsed: resolvedConfig.sidebar.collapsed.includes('guides'),
        items: guideEntries.map(e => ({
          id: e.id,
          label: e.title,
          kind: 'guide' as const,
          description: undefined,
          badge: e.symbols.length > 0 ? `${e.symbols.length} symbols` : undefined,
        })),
      });
    }
  }

  // ── Components (grouped by componentType) ──────────────────
  if (scanIndex) {
    const componentEntries = Object.values(scanIndex.components || {})
      .filter(e => !isExcluded(e, resolvedConfig));

    if (componentEntries.length > 0) {
      // Group by componentType
      const byType = new Map<string, ScanIndexEntry[]>();
      for (const entry of componentEntries) {
        const cType = entry.componentType || 'other';
        if (!byType.has(cType)) byType.set(cType, []);
        byType.get(cType)!.push(entry);
      }

      // Sort type groups by count descending
      const sortedTypes = [...byType.entries()].sort((a, b) => b[1].length - a[1].length);

      const subgroups: SidebarGroup[] = sortedTypes.map(([cType, entries]) => ({
        id: `components-${cType}`,
        label: `${cType.charAt(0).toUpperCase() + cType.slice(1)} (${entries.length})`,
        collapsed: resolvedConfig.sidebar.collapsed.includes(`components-${cType}`),
        items: entries
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(e => ({
            id: e.id,
            label: e.name,
            kind: 'component' as const,
            description: e.description,
            badge: e.componentType,
          })),
      }));

      groups.push({
        id: 'components',
        label: `Components (${componentEntries.length})`,
        collapsed: resolvedConfig.sidebar.collapsed.includes('components'),
        items: [],
        subgroups,
      });

      symbolCounts['components'] = componentEntries.length;
      totalSymbols += componentEntries.length;
    }

    // ── Features (if any) ──────────────────────────────────────
    const featureEntries = Object.values(scanIndex.features || {})
      .filter(e => !isExcluded(e, resolvedConfig));

    if (featureEntries.length > 0) {
      groups.push({
        id: 'features',
        label: `Features (${featureEntries.length})`,
        collapsed: resolvedConfig.sidebar.collapsed.includes('features'),
        items: featureEntries
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(e => ({
            id: e.id,
            label: e.name,
            kind: 'component' as const,
            description: e.description,
          })),
      });

      symbolCounts['features'] = featureEntries.length;
      totalSymbols += featureEntries.length;
    }

    // ── Flows ────────────────────────────────────────────────────
    const flowEntries = Object.values(scanIndex.flows || {})
      .filter(e => !isExcluded(e as ScanIndexEntry, resolvedConfig));

    // Merge in flow-index flows that aren't already in scan-index
    const flowIds = new Set(flowEntries.map(f => f.id));
    const additionalFlows: SidebarItem[] = [];
    if (flowIndex) {
      for (const [fId, flow] of Object.entries(flowIndex.flows)) {
        const cleanId = fId.replace(/^\$/, '');
        if (!flowIds.has(cleanId)) {
          additionalFlows.push({
            id: cleanId,
            label: flow.name || cleanId,
            kind: 'flow' as const,
            description: flow.description,
          });
        }
      }
    }

    const allFlowItems: SidebarItem[] = [
      ...flowEntries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(e => ({
          id: e.id,
          label: e.name,
          kind: 'flow' as const,
          description: e.description,
        })),
      ...additionalFlows,
    ];

    if (allFlowItems.length > 0) {
      groups.push({
        id: 'flows',
        label: `Flows (${allFlowItems.length})`,
        collapsed: resolvedConfig.sidebar.collapsed.includes('flows'),
        items: allFlowItems,
      });

      symbolCounts['flows'] = allFlowItems.length;
      totalSymbols += allFlowItems.length;
    }

    // ── Gates (from scan-index) ──────────────────────────────────
    const gateEntries = Object.values(scanIndex.gates || {})
      .filter(e => !isExcluded(e, resolvedConfig));

    if (gateEntries.length > 0) {
      groups.push({
        id: 'gates',
        label: `Gates (${gateEntries.length})`,
        collapsed: resolvedConfig.sidebar.collapsed.includes('gates'),
        items: gateEntries
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(e => ({
            id: e.id,
            label: e.name,
            kind: 'gate' as const,
            description: e.description,
          })),
      });

      symbolCounts['gates'] = gateEntries.length;
      totalSymbols += gateEntries.length;
    }

    // ── Signals ──────────────────────────────────────────────────
    const signalEntries = Object.values(scanIndex.signals || {})
      .filter(e => !isExcluded(e, resolvedConfig));

    if (signalEntries.length > 0) {
      groups.push({
        id: 'signals',
        label: `Signals (${signalEntries.length})`,
        collapsed: resolvedConfig.sidebar.collapsed.includes('signals'),
        items: signalEntries
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(e => ({
            id: e.id,
            label: e.name,
            kind: 'signal' as const,
            description: e.description,
          })),
      });

      symbolCounts['signals'] = signalEntries.length;
      totalSymbols += signalEntries.length;
    }

    // ── Aspects ──────────────────────────────────────────────────
    const aspectEntries = Object.values(scanIndex.aspects || {})
      .filter(e => !isExcluded(e, resolvedConfig));

    if (aspectEntries.length > 0) {
      groups.push({
        id: 'aspects',
        label: `Aspects (${aspectEntries.length})`,
        collapsed: resolvedConfig.sidebar.collapsed.includes('aspects'),
        items: aspectEntries
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(e => ({
            id: e.id,
            label: e.name,
            kind: 'aspect' as const,
            description: e.description,
          })),
      });

      symbolCounts['aspects'] = aspectEntries.length;
      totalSymbols += aspectEntries.length;
    }
  }

  // ── Portal (single overview item) ────────────────────────────
  if (portal) {
    const routeCount = Object.keys(portal.routes || {}).length;
    const gateCount = Object.keys(portal.gates || {}).length;

    groups.push({
      id: 'portal',
      label: 'Portal',
      collapsed: resolvedConfig.sidebar.collapsed.includes('portal'),
      items: [{
        id: 'portal-overview',
        label: 'Authorization Overview',
        kind: 'portal' as const,
        description: `${gateCount} gates, ${routeCount} routes`,
        badge: `${routeCount} routes`,
      }],
    });
  }

  return {
    title,
    project: projectName,
    generatedAt: new Date().toISOString(),
    groups,
    totalSymbols,
    symbolCounts,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SYMBOL PAGE
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the detail page data for a single symbol.
 *
 * Searches all categories in the scan-index (components, flows, gates,
 * signals, aspects) and enriches with cross-references, flows, gates,
 * university guides, and parent/child relationships.
 */
export function buildSymbolPage(rootDir: string, symbolId: string): SymbolPageData | null {
  const scanIndex = loadScanIndex(rootDir);
  if (!scanIndex) return null;

  // Find the symbol in any category
  const entries = allEntries(scanIndex);
  const entry = entries.get(symbolId);
  if (!entry) return null;

  // Cross-references: find symbols that reference this one
  const referencedBy: string[] = [];
  for (const [otherId, otherEntry] of entries) {
    if (otherId === symbolId) continue;
    if (otherEntry.related && otherEntry.related.includes(entry.symbol)) {
      referencedBy.push(otherEntry.symbol);
    }
  }

  // References: symbols this one references
  const references = (entry.related || []).slice();

  // Flows that include this symbol
  const flows: Array<{ id: string; name: string }> = [];
  const flowIndex = loadFlowIndex(rootDir);
  if (flowIndex) {
    for (const [fId, flow] of Object.entries(flowIndex.flows)) {
      const stepSymbols = (flow.steps || []).map(s => s.symbol);
      if (stepSymbols.includes(entry.symbol) || stepSymbols.includes(`#${symbolId}`)) {
        flows.push({ id: fId.replace(/^\$/, ''), name: flow.name || fId });
      }
    }
  }
  // Also check scan-index flows for step symbols
  if (scanIndex.flows) {
    for (const [fId, flow] of Object.entries(scanIndex.flows)) {
      if (flows.some(f => f.id === fId)) continue;
      const stepSymbols = (flow.steps || []).map(s => s.symbol).filter(Boolean);
      if (stepSymbols.includes(entry.symbol) || stepSymbols.includes(`#${symbolId}`)) {
        flows.push({ id: fId, name: flow.name });
      }
    }
  }

  // Gates from portal that apply to routes involving this component
  const gates: Array<{ id: string; description: string }> = [];
  const portal = loadPortal(rootDir);
  if (portal && entry.category === 'gates') {
    // If the symbol IS a gate, include its own description
    const gateKey = Object.keys(portal.gates || {}).find(
      k => k.replace(/^\^/, '') === symbolId,
    );
    if (gateKey) {
      gates.push({
        id: gateKey.replace(/^\^/, ''),
        description: portal.gates[gateKey].description,
      });
    }
  } else if (portal) {
    // Find routes that reference this symbol via related gates
    const relatedGateSymbols = new Set((entry.related || []).filter(r => r.startsWith('^')));
    for (const [_route, routeGates] of Object.entries(portal.routes || {})) {
      for (const gateRef of routeGates) {
        const cleanGate = gateRef.replace(/^\^/, '');
        if (relatedGateSymbols.has(gateRef) || relatedGateSymbols.has(`^${cleanGate}`)) {
          const gateEntry = portal.gates[gateRef] || portal.gates[`^${cleanGate}`] || portal.gates[cleanGate];
          if (gateEntry && !gates.some(g => g.id === cleanGate)) {
            gates.push({ id: cleanGate, description: gateEntry.description });
          }
        }
      }
    }
  }

  // Aspects that relate to this symbol
  const aspects: string[] = [];
  if (scanIndex.aspects) {
    for (const [_aId, aspect] of Object.entries(scanIndex.aspects)) {
      if (aspect.related && aspect.related.includes(entry.symbol)) {
        aspects.push(aspect.symbol);
      }
    }
  }
  // Also include aspects referenced by this symbol
  for (const ref of entry.related || []) {
    if (ref.startsWith('~') && !aspects.includes(ref)) {
      aspects.push(ref);
    }
  }

  // University guides referencing this symbol
  const guides: Array<{ id: string; title: string }> = [];
  const uniIndex = loadUniversityIndex(rootDir);
  if (uniIndex) {
    for (const uEntry of uniIndex.entries) {
      if (uEntry.symbols.includes(entry.symbol)) {
        guides.push({ id: uEntry.id, title: uEntry.title });
      }
    }
  }

  // Parent/children from component hierarchy
  const parent = entry.parent || undefined;
  const children: string[] = [];
  if (scanIndex.components) {
    for (const comp of Object.values(scanIndex.components)) {
      if (comp.parent === entry.symbol) {
        children.push(comp.symbol);
      }
    }
  }

  return {
    id: entry.id,
    symbol: entry.symbol,
    name: entry.name,
    description: entry.description || '',
    category: entry.category || 'components',
    componentType: entry.componentType,
    tags: entry.visualTags || [],
    path: entry.path || '',
    related: entry.related || [],
    referencedBy,
    references,
    flows,
    gates,
    aspects,
    guides,
    parent,
    children,
  };
}

// ═══════════════════════════════════════════════════════════════════
// FLOW PAGE
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the detail page data for a single flow.
 *
 * Prefers the flow-index (which has typed steps) and falls back
 * to the scan-index flow entry.
 */
export function buildFlowPage(rootDir: string, flowId: string): FlowPageData | null {
  const flowIndex = loadFlowIndex(rootDir);
  const scanIndex = loadScanIndex(rootDir);

  // Try flow-index first (more detailed step data)
  if (flowIndex) {
    const flowKey = flowIndex.flows[`$${flowId}`] ? `$${flowId}` : flowId;
    const flow = flowIndex.flows[flowKey];
    if (flow) {
      const steps: FlowStepData[] = (flow.steps || []).map(s => ({
        type: (s.type as FlowStepData['type']) || 'action',
        symbol: s.symbol || '',
        description: s.description,
      }));

      // Try to get tags and path from scan-index
      const scanEntry = scanIndex?.flows?.[flowId.replace(/^\$/, '')];

      return {
        id: flowId.replace(/^\$/, ''),
        symbol: `$${flowId.replace(/^\$/, '')}`,
        name: flow.name || flowId,
        description: flow.description,
        trigger: flow.trigger,
        steps,
        successSignal: flow.successSignal,
        errorSignal: flow.errorSignal,
        tags: scanEntry?.visualTags || [],
        path: scanEntry?.path || flow.definedIn || '',
      };
    }
  }

  // Fallback to scan-index
  if (scanIndex?.flows) {
    const cleanId = flowId.replace(/^\$/, '');
    const scanFlow = scanIndex.flows[cleanId];
    if (scanFlow) {
      const steps: FlowStepData[] = (scanFlow.steps || []).map(s => ({
        type: 'action' as const,
        symbol: s.symbol || '',
        description: s.action || s.name,
      }));

      return {
        id: cleanId,
        symbol: `$${cleanId}`,
        name: scanFlow.name,
        description: scanFlow.description,
        steps,
        tags: scanFlow.visualTags || [],
        path: scanFlow.path || '',
      };
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// PORTAL PAGE
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the portal overview page with gates and routes.
 * Returns an empty page structure when no portal.yaml exists.
 */
export function buildPortalPage(rootDir: string): PortalPageData {
  const portal = loadPortal(rootDir);
  if (!portal) {
    return { version: '0', gates: [], routes: [] };
  }

  // Build gate list with route references
  const gateRouteMap = new Map<string, string[]>();
  for (const [routeKey, routeGates] of Object.entries(portal.routes || {})) {
    for (const gateRef of routeGates) {
      const cleanGate = gateRef.replace(/^\^/, '');
      if (!gateRouteMap.has(cleanGate)) gateRouteMap.set(cleanGate, []);
      gateRouteMap.get(cleanGate)!.push(routeKey);
    }
  }

  const gates = Object.entries(portal.gates || {}).map(([key, gate]) => {
    const cleanKey = key.replace(/^\^/, '');
    return {
      symbol: `^${cleanKey}`,
      description: gate.description,
      check: gate.check,
      routes: gateRouteMap.get(cleanKey) || [],
    };
  });

  // Build route list
  const routes: PortalRouteData[] = Object.entries(portal.routes || {}).map(([routeKey, routeGates]) => {
    // Parse "METHOD /path" format
    const spaceIdx = routeKey.indexOf(' ');
    const method = spaceIdx > 0 ? routeKey.substring(0, spaceIdx) : 'GET';
    const route = spaceIdx > 0 ? routeKey.substring(spaceIdx + 1) : routeKey;

    return {
      route,
      method,
      gates: routeGates.map(gateRef => {
        const cleanGate = gateRef.replace(/^\^/, '');
        const gateEntry = portal.gates[gateRef] || portal.gates[`^${cleanGate}`] || portal.gates[cleanGate];
        return {
          symbol: `^${cleanGate}`,
          description: gateEntry?.description,
        };
      }),
    };
  });

  return {
    version: portal.version || '1.0',
    gates,
    routes,
  };
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════

/**
 * Search across all docs content: symbols, custom pages, and portal.
 *
 * Scoring: exact match (1.0) > starts-with (0.8) > contains (0.5) > tag match (0.3)
 */
export function searchDocs(rootDir: string, query: string, limit?: number): SearchResult[] {
  const maxResults = limit || 20;
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  // Search scan-index symbols
  const scanIndex = loadScanIndex(rootDir);
  if (scanIndex) {
    const entries = allEntries(scanIndex);
    for (const [_id, entry] of entries) {
      const score = scoreMatch(entry.name, entry.description || '', entry.visualTags || [], queryLower);
      if (score > 0) {
        results.push({
          id: entry.id,
          kind: categoryToSearchKind(entry.category),
          label: entry.name,
          description: entry.description || '',
          matchContext: buildMatchContext(entry.name, entry.description || '', queryLower),
          score,
        });
      }
    }
  }

  // Search custom pages
  const config = loadDocsConfig(rootDir);
  const customPages = loadCustomPages(rootDir, config.customContent);
  for (const page of customPages) {
    const bodySnippet = page.body.substring(0, 200);
    const score = scoreMatch(page.title, bodySnippet, [], queryLower);
    if (score > 0) {
      results.push({
        id: page.slug,
        kind: 'custom',
        label: page.title,
        description: page.description || bodySnippet.substring(0, 100),
        matchContext: buildMatchContext(page.title, page.body, queryLower),
        score,
      });
    }
  }

  // Search portal gates
  const portal = loadPortal(rootDir);
  if (portal) {
    for (const [key, gate] of Object.entries(portal.gates || {})) {
      const cleanKey = key.replace(/^\^/, '');
      const score = scoreMatch(cleanKey, gate.description, [], queryLower);
      if (score > 0) {
        results.push({
          id: cleanKey,
          kind: 'portal',
          label: `^${cleanKey}`,
          description: gate.description,
          score,
        });
      }
    }
  }

  // Sort by score descending, then by label
  results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  return results.slice(0, maxResults);
}

/**
 * Score a match against a query string.
 * Returns 0 for no match, up to 1.0 for exact name match.
 */
function scoreMatch(name: string, description: string, tags: string[], queryLower: string): number {
  const nameLower = name.toLowerCase();
  const descLower = description.toLowerCase();

  // Exact name match
  if (nameLower === queryLower) return 1.0;

  // Name starts with query
  if (nameLower.startsWith(queryLower)) return 0.8;

  // Name contains query
  if (nameLower.includes(queryLower)) return 0.6;

  // Description contains query
  if (descLower.includes(queryLower)) return 0.5;

  // Tag match
  if (tags.some(t => t.toLowerCase().includes(queryLower))) return 0.3;

  return 0;
}

/**
 * Build a context snippet showing where the query matched.
 */
function buildMatchContext(name: string, text: string, queryLower: string): string | undefined {
  const textLower = text.toLowerCase();
  const idx = textLower.indexOf(queryLower);
  if (idx < 0) {
    // Match was in the name
    if (name.toLowerCase().includes(queryLower)) {
      return name;
    }
    return undefined;
  }

  // Extract surrounding context (up to 40 chars on each side)
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + queryLower.length + 40);
  let snippet = text.substring(start, end).trim();
  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;
  return snippet;
}
