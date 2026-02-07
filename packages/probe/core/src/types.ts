/**
 * Core types for Paradigm Scan - Visual discovery layer for AI agents
 */

// ============================================
// Scan Index Types
// ============================================

/**
 * Element category in the scan index
 */
export type ScanCategory = 
  | 'components'   // UI elements, reusable modules
  | 'features'     // Business logic, user-facing functionality
  | 'flows'        // Multi-step processes, user journeys
  | 'state'        // Stores, state slices, reactive data
  | 'gates'        // Access control, permissions
  | 'signals'      // Events, side effects
  | 'screens'      // Full page/view definitions
  | 'layouts';     // Layout components, structural elements

/**
 * Visual tags that help AI map images to elements
 */
export type VisualTag = 
  | 'button'       // Clickable actions
  | 'form'         // Input forms
  | 'input'        // Text inputs, selects
  | 'card'         // Card containers
  | 'list'         // Lists, tables
  | 'modal'        // Dialogs, overlays
  | 'nav'          // Navigation elements
  | 'header'       // Header sections
  | 'footer'       // Footer sections
  | 'sidebar'      // Side navigation
  | 'hero'         // Hero sections
  | 'grid'         // Grid layouts
  | 'chart'        // Data visualizations
  | 'icon'         // Icons
  | 'image'        // Images
  | 'text'         // Text blocks
  | 'badge'        // Badges, tags
  | 'avatar'       // User avatars
  | 'menu'         // Menus, dropdowns
  | 'tab'          // Tab navigation
  | 'accordion'    // Expandable sections
  | 'toast'        // Notifications
  | 'spinner'      // Loading indicators
  | 'skeleton'     // Loading placeholders
  | string;        // Custom tags

/**
 * A single element in the scan index
 */
export interface ScanElement {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Full symbol with prefix (e.g., "#checkout", "#Button") */
  symbol: string;
  /** Category of this element */
  category: ScanCategory;
  /** File path where defined */
  path: string;
  /** Human-readable description */
  description?: string;
  /** Visual tags for image-to-element mapping */
  visualTags?: VisualTag[];
  /** Related screens where this appears */
  screens?: string[];
  /** Parent feature or component */
  parent?: string;
  /** Child elements */
  children?: string[];
  /** Related symbols */
  related?: string[];
  /** Custom metadata */
  meta?: Record<string, unknown>;
}

/**
 * A flow in the scan index (user journeys, processes)
 */
export interface ScanFlow {
  /** Flow identifier */
  id: string;
  /** Display name */
  name: string;
  /** Full symbol with prefix */
  symbol: string;
  /** File path where defined */
  path: string;
  /** Description of the flow */
  description?: string;
  /** Ordered steps in the flow */
  steps: ScanFlowStep[];
  /** Related feature */
  feature?: string;
  /** Entry conditions */
  entryGates?: string[];
}

/**
 * A step in a flow
 */
export interface ScanFlowStep {
  /** Step identifier */
  id: string;
  /** Step name/label */
  name: string;
  /** Component or screen for this step */
  target?: string;
  /** Description of what happens */
  description?: string;
  /** Order index */
  order: number;
}

/**
 * State slice in the scan index
 */
export interface ScanState {
  /** State identifier */
  id: string;
  /** Display name */
  name: string;
  /** Full symbol with prefix */
  symbol: string;
  /** File path where defined */
  path: string;
  /** Description */
  description?: string;
  /** State slices/properties */
  slices?: string[];
  /** Components that consume this state */
  consumers?: string[];
}

/**
 * Screen/Page definition
 */
export interface ScanScreen {
  /** Screen identifier */
  id: string;
  /** Display name */
  name: string;
  /** Route/path if applicable */
  route?: string;
  /** File path */
  path: string;
  /** Description */
  description?: string;
  /** Components used on this screen */
  components?: string[];
  /** Features active on this screen */
  features?: string[];
  /** Gates that protect this screen */
  gates?: string[];
}

// ============================================
// Scan Index Structure
// ============================================

/**
 * Version info for the scan index
 */
export interface ScanIndexMeta {
  /** Schema version */
  version: string;
  /** Project name */
  project: string;
  /** When the index was generated */
  generatedAt: string;
  /** Paradigm version that generated this */
  paradigmVersion: string;
  /** Source files scanned */
  sources: {
    purposeFiles: number;
    portalFiles: number;
    premiseFiles: number;
  };
}

/**
 * The complete scan index structure
 * This is what gets written to .paradigm/scan-index.json
 */
export interface ScanIndex {
  /** Index metadata */
  $meta: ScanIndexMeta;
  /** UI components */
  components: Record<string, ScanElement>;
  /** Features/business logic */
  features: Record<string, ScanElement>;
  /** User flows and processes */
  flows: Record<string, ScanFlow>;
  /** State stores and slices */
  state: Record<string, ScanState>;
  /** Gates (access control) */
  gates: Record<string, ScanElement>;
  /** Signals (events) */
  signals: Record<string, ScanElement>;
  /** Screens/pages */
  screens: Record<string, ScanScreen>;
  /** Symbol lookup table (symbol -> category + id) */
  symbolMap: Record<string, { category: ScanCategory; id: string }>;
}

// ============================================
// Scan Protocol Types
// ============================================

/**
 * Scan mode for different image types
 */
export type ScanMode = 
  | 'ui'        // Screenshot of running app
  | 'design'    // Mockup or design file
  | 'error'     // Error screenshot/stack trace
  | 'arch'      // Architecture diagram
  | 'flow'      // Flow diagram
  | 'diff';     // Before/after comparison

/**
 * Confidence level for element mapping
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none';

/**
 * A single mapping result from scan
 */
export interface ScanMatch {
  /** The matched element/symbol */
  symbol: string;
  /** Category of the match */
  category: ScanCategory;
  /** File path */
  path: string;
  /** Confidence of the mapping */
  confidence: ConfidenceLevel;
  /** Why this was matched */
  reason?: string;
  /** Visual region in image (if applicable) */
  region?: {
    description: string;
  };
}

/**
 * Result structure for paradigm scan
 */
export interface ScanResult {
  /** Scan mode used */
  mode: ScanMode;
  /** Component matches */
  components: ScanMatch[];
  /** Feature matches */
  features: ScanMatch[];
  /** Flow matches */
  flows: ScanMatch[];
  /** State matches */
  state: ScanMatch[];
  /** Gate matches */
  gates: ScanMatch[];
  /** Elements in image that lack paradigm coverage */
  uncovered: {
    description: string;
    suggestedCategory: ScanCategory;
    suggestedName?: string;
  }[];
  /** Suggested actions */
  suggestions?: string[];
}

// ============================================
// Scan Configuration
// ============================================

/**
 * Scan-specific settings in .paradigm config
 */
export interface ScanConfig {
  /** Enable/disable scan protocol in cursorrules */
  enabled: boolean;
  /** Default scan mode */
  defaultMode: ScanMode;
  /** Auto-regenerate index on changes */
  autoIndex: boolean;
  /** Custom visual tag mappings */
  visualTagMappings?: Record<string, VisualTag[]>;
  /** Screens definition for better mapping */
  screens?: Record<string, {
    route?: string;
    components?: string[];
    features?: string[];
  }>;
}
