/**
 * University Types — Per-project knowledge base
 *
 * Content types: notes, policies, quizzes, learning paths, diplomas
 * All stored in .paradigm/university/
 */

// ── Content Types ────────────────────────────────────────

export type UniversityContentType = 'note' | 'policy' | 'guide' | 'runbook';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type DiplomaType = 'plsat' | 'quiz' | 'path';

// ── Pack Manifest (v6.0) ─────────────────────────────────

/**
 * Tenancy of a content pack. Determines default resolution rules, origin
 * hints, and sunset-review aggregation.
 */
export type TenantKind = 'first-party' | 'project' | 'external';

/**
 * Provenance of a content entry — how it came to exist in this pack.
 * `authored` is the default for new entries; `promoted` marks entries
 * lifted from a notebook/journal/work-log; `imported` marks entries
 * migrated from legacy layouts (e.g. PLSAT migration at v6.0).
 */
export type Origin = 'authored' | 'promoted' | 'imported';

export interface PackDependency {
  pack: string;
  min_version?: string;
  kind: 'required' | 'recommended';
}

export interface PackCompliance {
  retention_years?: number;
  revoke_on_policy_change?: boolean;
}

// ── Pack Sections (v6.5) ─────────────────────────────────

/**
 * Visual presentation style for a section. The loader and validator are
 * style-agnostic; only the UI dispatches on this enum.
 *
 *   - `track`          — ordered curriculum (e.g. PARA 001 → 701)
 *   - `index`          — alphabetical / lookup grid
 *   - `chronological`  — newest-first reverse-time list
 *   - `featured`       — small, hand-picked tile view
 */
export type SectionStyle = 'track' | 'index' | 'chronological' | 'featured';

/**
 * A logical grouping inside a content pack. Sections are additive over the
 * v6.0 manifest — packs without `sections:` synthesize a single implicit
 * `main` section flagged `default: true` to preserve v6.0-6.4 behavior.
 *
 * Constraints enforced by the Zod schema in pack-loader:
 *   - `id`           : matches /^[a-z0-9][a-z0-9-]{0,63}$/ (kebab-case)
 *   - `name`         : ≤ 120 chars
 *   - `description`  : ≤ 1000 chars, PLAIN TEXT (no markdown rendering)
 *   - `order`        : integer in [0, 9999]
 *   - At most 64 sections per pack
 *   - Exactly one section per pack may set `default: true` (single-section
 *     packs with `default: false` get auto-promoted)
 */
export interface Section {
  id: string;
  name: string;
  order: number;
  style: SectionStyle;
  description?: string;
  default?: boolean;
}

/**
 * Shape of `pack.yaml` at a content-pack root. Version 1 at v6.0.
 * See docs/private/plans/v6.0-university-builder-spec.md §1.2.
 */
export interface PackManifest {
  // Identity
  id: string;
  name: string;
  version: string;
  schema_version: string;

  // Classification
  tenant_kind: TenantKind;
  description: string;

  // Optional metadata
  authors?: string[];
  license?: string;
  origin_hint?: Origin;
  content_types?: UniversityContentType[];
  disciplines?: string[];

  // Inline config (absorbs UniversityConfig for project packs)
  branding?: UniversityBranding;
  theme?: Partial<UniversityTheme>;
  categories?: UniversityContentCategory[];

  // Compliance
  compliance?: PackCompliance;

  // Dependencies
  dependencies?: PackDependency[];

  // v6.5: optional pack sections (groupings for entries). When omitted or
  // an empty array, the loader synthesizes a single implicit `main` section
  // flagged `default: true`. See Section docstring for constraints.
  sections?: Section[];
}

/**
 * Resolved pack location on disk. Populated by the pack discoverer
 * (sub-phase 1); consumed by loaders and the CLI/MCP resolution layer.
 */
export interface PackLocation {
  manifest: PackManifest;
  rootDir: string;
  source: 'first-party' | 'npm' | 'local';
  parentPackId?: string;  // for discipline sub-packs
}

// ── Frontmatter (shared by notes and policies) ──────────

export interface UniversityFrontmatter {
  id: string;
  title: string;
  type: UniversityContentType;
  author: string;
  created: string;          // ISO date (YYYY-MM-DD)
  updated: string;          // ISO date (YYYY-MM-DD)
  tags: string[];
  symbols: string[];        // Paradigm symbols referenced
  difficulty: Difficulty;
  estimatedMinutes?: number;
  prerequisites: string[];  // IDs of prerequisite content
  category?: string;

  // v6.0 pack-manifest additions (all optional; injected by loader or authored)
  origin?: Origin;          // defaults to 'authored' when absent
  source?: string;          // provenance hint, e.g. 'courses/para-001.json' for imported
  pack_id?: string;         // injected by loader; not authored
  discipline?: string;      // for discipline sub-pack entries

  // v6.5 section additions (optional, additive). `section` is the id of a
  // Section declared on the pack manifest; `order` is the per-section sort
  // key (lower first). When `section` is absent, the entry falls through to
  // the pack's default section (the loader synthesizes one if needed).
  section?: string;
  order?: number;
}

export interface UniversityNote {
  frontmatter: UniversityFrontmatter;
  body: string;             // Markdown content after frontmatter
}

// ── Quiz ─────────────────────────────────────────────────

export interface QuizQuestion {
  id: string;
  question: string;
  choices: Record<string, string>;  // { A: "...", B: "...", ... }
  correct: string;                  // Key into choices
  explanation?: string;

  // v6.0 PLSAT additions (all optional; preserve simple-quiz compat)
  section?: string;          // e.g. 'para-101'
  slot?: string;             // e.g. 'slot-001'
  weight?: number;           // default 1
  scenario?: string;         // PLSAT preamble prose
  variants?: QuizQuestion[]; // PLSAT alt-variants per slot
}

export interface UniversityQuiz {
  id: string;
  title: string;
  description?: string;
  author: string;
  created: string;
  updated: string;
  tags: string[];
  symbols: string[];
  difficulty: Difficulty;
  estimatedMinutes?: number;
  passThreshold: number;    // 0.0 to 1.0
  questions: QuizQuestion[];
  category?: string;

  // v6.0 pack-manifest additions (all optional)
  origin?: Origin;
  source?: string;
  pack_id?: string;
  discipline?: string;

  // v6.5 section additions — see notes on UniversityFrontmatter. Note: this
  // is the TOP-LEVEL section grouping the quiz into a pack section. It is
  // intentionally different from `QuizQuestion.section` (PLSAT slot id like
  // 'para-101') — different schema levels; collision accepted by design.
  section?: string;
  order?: number;

  // v6.0 PLSAT additions (all optional)
  timeLimit?: number;        // seconds
  totalSlots?: number;
  exam?: {
    kind: 'practice' | 'proctored';
    retake_policy?: string;
  };
}

// ── Learning Path ────────────────────────────────────────

export interface LearningPathStep {
  content: string;          // Content ID or "plsat:vX.X"
  required: boolean;
  passRequired?: boolean;   // For quizzes: must pass to proceed
  note?: string;
}

export interface LearningPath {
  id: string;
  title: string;
  description?: string;
  author: string;
  created: string;
  updated: string;
  tags: string[];
  ordered: boolean;
  steps: LearningPathStep[];
  category?: string;

  // v6.5 section additions — see notes on UniversityFrontmatter.
  section?: string;
  order?: number;
}

// ── Diploma ──────────────────────────────────────────────

export interface Diploma {
  id: string;
  type: DiplomaType;
  student: string;
  earnedAt: string;         // ISO 8601
  source: string;           // Quiz ID, path ID, or "plsat:vX.X"
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  details?: Record<string, unknown>;

  // v6.0 compliance additions (all optional)
  status?: 'active' | 'expired' | 'revoked';
  revoked_reason?: string;
  /** entry-address -> policy version at time of earning */
  policy_versions?: Record<string, string>;
  /** entry-address -> sha256 at time of earning */
  content_hashes?: Record<string, string>;
  /** which pack issued the diploma */
  pack_id?: string;
}

// ── Policy compliance (v6.0) ─────────────────────────────

/**
 * Compliance fields carried in the frontmatter of a `type: 'policy'`
 * entry. Shipped as optional in v6.0 so enforcement tooling (v6.x) can be
 * added without another breaking schema change.
 */
export interface PolicyComplianceFields {
  policy_version?: string;
  policy_hash?: string;
  compliance?: {
    retention_years?: number;
    revoke_on_change?: boolean;
    severity?: 'advisory' | 'required' | 'enforced';
  };
}

// ── Index ────────────────────────────────────────────────

export interface UniversityIndexEntry {
  id: string;
  title: string;
  type: string;             // 'note' | 'policy' | 'guide' | 'runbook' | 'quiz' | 'path'
  author: string;
  created: string;
  updated: string;
  tags: string[];
  symbols: string[];
  difficulty?: Difficulty;
  file: string;             // Relative path from university dir
  category?: string;

  // v6.5 section additions — propagated from frontmatter/quiz/path at
  // rebuildUniversityIndex time so downstream consumers (list grouping,
  // section filters, UI sidebar) don't need to re-parse content files.
  section?: string;
  order?: number;
}

export interface UniversityIndex {
  version: string;
  generatedAt: string;
  totalContent: number;
  entries: UniversityIndexEntry[];
  diplomaCount: number;
}

// ── Filter ───────────────────────────────────────────────

export interface UniversityFilter {
  type?: string;
  tag?: string;
  difficulty?: Difficulty;
  symbol?: string;
  author?: string;
  query?: string;           // Free-text search in title/description
  category?: string;
  track?: 'core' | 'extracurricular';
  /** v6.5: filter to entries whose `section` equals this id. */
  section?: string;
  limit?: number;
}

// ── Config ───────────────────────────────────────────────

export interface UniversityBranding {
  name: string;
  tagline?: string;
  logo?: string;
  institution?: string;
  favicon?: string;
  tabs?: Array<'campus' | 'courses' | 'plsat' | 'library' | 'certificates'>;
  startCourse?: string; // e.g. "para-101" or "crystal-ai-deep-dive"
}

export interface UniversityTheme {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  success: string;
  error: string;
  font: string;
}

export interface UniversityContentCategory {
  id: string;
  label: string;
  icon?: string;
  description?: string;
  track?: 'core' | 'extracurricular';  // default: 'core'
  excludeFromOnboarding?: boolean;
  validationStrictness?: 'standard' | 'relaxed';
}

export interface UniversityConfig {
  branding: UniversityBranding;
  theme: UniversityTheme;
  content: {
    categories: UniversityContentCategory[];
    defaultDifficulty: Difficulty;
    requireApproval: boolean;
    defaultCategory?: string;
  };
  diplomas: {
    includeGlobalPLSAT: boolean;
    customCertStyle?: string | null;
  };
}

// ── Validation ───────────────────────────────────────────

export interface UniversityValidationIssue {
  contentId: string;
  severity: 'error' | 'warning';
  check: string;
  message: string;
  fix?: string;
}

export interface UniversityValidationResult {
  status: 'healthy' | 'warnings' | 'errors';
  totalContent: number;
  checked: number;
  issues: UniversityValidationIssue[];
  symbolCoverage: {
    totalSymbols: number;
    coveredByContent: number;
    percentage: number;
  };
}
