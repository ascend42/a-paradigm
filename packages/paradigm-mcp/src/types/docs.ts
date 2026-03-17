/**
 * Docs Types — Auto-generated documentation from the symbol graph
 *
 * Types for the docs system that reads .purpose files, scan-index,
 * portal.yaml, and flows to produce structured documentation pages.
 */

// ── Config ─────────────────────────────────────────────────

export interface DocsConfig {
  enabled: boolean;
  title: string | null;         // defaults to "{project} Docs"
  theme: 'dark' | 'light' | 'auto';
  customCss: string | null;     // path to additional CSS
  customContent: string;        // directory for handwritten markdown pages
  exclude: {
    tags: string[];
    patterns: string[];         // glob patterns to exclude
  };
  sidebar: {
    collapsed: string[];        // sections collapsed by default
  };
  output: string;               // static build output directory
}

// ── Sidebar / Manifest ─────────────────────────────────────

export interface SidebarItem {
  id: string;                   // symbol ID, flow ID, or slug
  label: string;                // display name
  kind: 'component' | 'flow' | 'gate' | 'signal' | 'aspect' | 'custom' | 'portal' | 'guide';
  description?: string;
  badge?: string;               // e.g., tag count or type
}

export interface SidebarGroup {
  id: string;                   // section ID
  label: string;
  collapsed: boolean;
  items: SidebarItem[];
  subgroups?: SidebarGroup[];   // for component type grouping
}

export interface DocsManifest {
  title: string;
  project: string;
  generatedAt: string;
  groups: SidebarGroup[];
  totalSymbols: number;
  symbolCounts: Record<string, number>; // category → count
}

// ── Page Data ──────────────────────────────────────────────

export interface SymbolPageData {
  id: string;
  symbol: string;               // e.g., "#auth-middleware"
  name: string;
  description: string;
  category: string;             // "components", "signals", etc.
  componentType?: string;       // from .purpose type field
  tags: string[];
  path: string;                 // file path to .purpose
  related: string[];            // related symbol IDs
  referencedBy: string[];       // symbols that reference this one
  references: string[];         // symbols this one references
  flows: Array<{ id: string; name: string }>; // flows that include this symbol
  gates: Array<{ id: string; description: string }>; // gates applied to this symbol
  aspects: string[];            // aspect IDs applied to this symbol
  guides: Array<{ id: string; title: string }>; // university content referencing this
  parent?: string;              // parent component symbol
  children: string[];           // child components
}

export interface FlowStepData {
  type: 'gate' | 'action' | 'signal';
  symbol: string;
  description?: string;
}

export interface FlowPageData {
  id: string;
  symbol: string;               // e.g., "$checkout-flow"
  name: string;
  description?: string;
  trigger?: string;
  steps: FlowStepData[];
  successSignal?: string;
  errorSignal?: string;
  tags: string[];
  path: string;
}

export interface PortalRouteData {
  route: string;
  method: string;
  gates: Array<{ symbol: string; description?: string }>;
}

export interface PortalPageData {
  version: string;
  gates: Array<{
    symbol: string;
    description: string;
    check?: string;
    routes: string[];            // routes using this gate
  }>;
  routes: PortalRouteData[];
}

export interface CustomPageData {
  slug: string;
  title: string;
  body: string;                  // raw markdown content
  order?: number;                // sort order from frontmatter
  description?: string;
}

// ── Search ─────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  kind: 'component' | 'flow' | 'gate' | 'signal' | 'aspect' | 'custom' | 'portal';
  label: string;
  description: string;
  matchContext?: string;         // highlighted snippet
  score: number;                 // relevance score 0-1
}
