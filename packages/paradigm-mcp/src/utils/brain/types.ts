/**
 * #brain-types — shared types for the Paradigm Brain MVP (7.14.0).
 *
 * Builder B codes against this file. Engine modules (config/walk/detect/parse/
 * index-store/view/egress/purge) implement it.
 *
 * Security invariants encoded here:
 *   - Gates are ordered; the strictest matching gate wins; code may only tighten.
 *   - Quarantined / third-party records keep ONLY {id, relpath, size, status, kind, ext}.
 *   - Consumers never see IndexRecord directly — only ViewFile via openBrainView().
 */

// ── Gates ────────────────────────────────────────────────────────────

/**
 * Sensitivity gates. `open` < `private` < sensitive set.
 * `identity` covers Passport / IDs / Legal name-zones (spec lists them as
 * sensitive names without naming a gate; they behave exactly like the other
 * sensitive gates).
 */
export type BrainGate =
  | 'open'
  | 'private'
  | 'medical'
  | 'financial'
  | 'identity'
  | 'third-party-data'
  | 'quarantined';

/** Sensitive gates: owner sees only {folder, gate, count}; agent sees nothing. */
export const SENSITIVE_GATES: readonly BrainGate[] = Object.freeze([
  'medical',
  'financial',
  'identity',
  'third-party-data',
  'quarantined',
]);

/** Rank for "strictest wins". All sensitive gates share the top rank except quarantined. */
export const GATE_RANK: Readonly<Record<BrainGate, number>> = Object.freeze({
  open: 0,
  private: 1,
  medical: 2,
  financial: 2,
  identity: 2,
  'third-party-data': 2,
  quarantined: 3,
});

export type ZoneSource = 'detector' | 'name' | 'human';

export interface BrainZone {
  /** Root-relative glob, e.g. `Health/**`. Matched case-insensitively (fail-closed). */
  glob: string;
  gate: BrainGate;
  source: ZoneSource;
}

export interface BrainLimits {
  max_file_bytes: number;
  max_files: number;
  parse_ms: number;
}

export type AgentAccess = 'off' | 'metadata';

/** brain.yaml — the portal.yaml analogue. */
export interface BrainConfig {
  version: 1;
  /** realpath of the allow-listed root. */
  root: string;
  /** Always 'private' (default-deny for agents). */
  default_gate: 'private';
  /** Human-only globs that lower `private` → `open`. Case-sensitive match. */
  share: string[];
  zones: BrainZone[];
  agent_access: AgentAccess;
  /** Optional workspace file for brain→code cross-links. */
  workspace?: string;
  limits: BrainLimits;
  /**
   * Set (in memory only, never persisted) when brain.yaml no longer matches the
   * sha256 Paradigm recorded in `.config-hash` — i.e. it was edited outside
   * Paradigm. agent_access is then forced to 'off' (fail closed).
   */
  tampered?: boolean;
}

/** Owner-facing copy shown by CLI status and the Platform overview when brain.yaml was tampered with. */
export const TAMPER_BANNER = 'Settings changed outside Paradigm — agent access paused. Run `paradigm brain status` to review.';

export const DEFAULT_LIMITS: Readonly<BrainLimits> = Object.freeze({
  max_file_bytes: 2_000_000,
  max_files: 20_000,
  parse_ms: 200,
});

// ── Options ──────────────────────────────────────────────────────────

/** Every engine entrypoint accepts this. Tests MUST pass `homedir`. */
export interface BrainOptions {
  /** Injected home directory. Storage = <homedir>/.paradigm/brains/. Default os.homedir(). */
  homedir?: string;
}

// ── Scan / index ─────────────────────────────────────────────────────

export type FileKind = 'markdown' | 'text' | 'other';

export type RecordStatus =
  /** Parsed (md/txt) or recorded as path/size/type (other). */
  | 'indexed'
  /** Detector hit — only path + size kept. */
  | 'quarantined'
  /** Chat export shape — only path + size kept. */
  | 'third-party-data'
  /** Too large / parse timeout / unreadable — only path + size kept. */
  | 'skipped';

export interface LinkRef {
  kind: 'wikilink' | 'markdown';
  /** Link target as written (sans #heading / ^block / |alias). */
  target: string;
  heading?: string;
  block?: string;
  embed?: boolean;
}

/**
 * Persisted index record. METADATA ONLY — no bodies.
 * For status != 'indexed' only {id, relpath, size, status, kind, ext, skipReason?} are set.
 */
export interface IndexRecord {
  /** Stable id `f_<10 hex>`; carried across renames detected by inode/hash. */
  id: string;
  /** POSIX root-relative path. */
  relpath: string;
  size: number;
  status: RecordStatus;
  kind: FileKind;
  /** Lowercased extension incl. dot ('' when none). */
  ext: string;
  /** 'detector-timeout' / 'changed-during-read' accompany status 'quarantined' / 'skipped' (fail closed). */
  skipReason?: 'too-large' | 'parse-timeout' | 'unreadable' | 'binary' | 'detector-timeout' | 'changed-during-read';
  mtimeMs?: number;
  ino?: number;
  /** sha256 hex of content (md/txt/other ≤ max bytes). */
  hash?: string;
  title?: string;
  headings?: string[];
  links?: LinkRef[];
  /** Frontmatter tags (leading '#' stripped). Never symbols. */
  tags?: string[];
  aliases?: string[];
  /** Frontmatter `relates:` entries, e.g. 'a-paradigm/#skill-loader'. */
  relates?: string[];
  /** Previous relpath when a rename was detected this scan. */
  renamedFrom?: string;
}

export interface FlaggedFolder {
  /** Root-relative folder ('' = root). */
  folder: string;
  reason: 'secret' | 'third-party-data';
  count: number;
}

export interface BrainIndex {
  version: 1;
  rootHash: string;
  root: string;
  scannedAt: string;
  truncated: boolean;
  records: IndexRecord[];
  flagged: FlaggedFolder[];
}

export interface ScanReport {
  rootHash: string;
  files: number;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  renamed: number;
  quarantined: number;
  thirdParty: number;
  skipped: number;
  /** Paths refused by hard-block / symlink rules (count only). */
  refused: number;
  truncated: boolean;
  zonesAdded: BrainZone[];
  durationMs: number;
}

// ── View (the ONLY read surface) ─────────────────────────────────────

export type Audience = 'agent' | 'owner';

export interface ViewLink {
  kind: 'wikilink' | 'markdown';
  /** Display target. '[private]' when the target is hidden from this audience. */
  target: string;
  heading?: string;
  block?: string;
  /** ok = resolves to a visible file; hidden = resolves only to a gated file; missing = broken. */
  status: 'ok' | 'hidden' | 'missing';
  /** Visible target id (status 'ok' only). */
  toId?: string;
}

/** A file as seen through the choke point. Only visible (open/private-for-owner) files. */
export interface ViewFile {
  id: string;
  relpath: string;
  /** Root-relative parent folder ('' = root). */
  folder: string;
  kind: FileKind;
  ext: string;
  size: number;
  mtimeMs?: number;
  hash?: string;
  gate: 'open' | 'private';
  status: 'indexed' | 'skipped';
  title?: string;
  headings: string[];
  tags: string[];
  aliases: string[];
  relates: string[];
  links: ViewLink[];
  /** Number of visible files linking here. */
  inbound: number;
}

/** Owner-only aggregate of hidden files. Never filenames. */
export interface LockedZone {
  /** Zone folder (glob sans trailing /**), or null for file-level detector hits. */
  folder: string | null;
  gate: BrainGate;
  count: number;
}

export interface ViewSummary {
  rootHash: string;
  audience: Audience;
  /** false for agent audience when agent_access is 'off' (view is empty). */
  enabled: boolean;
  visible: number;
  byKind: Record<FileKind, number>;
  /** Owner only; 0 for agent (hidden counts never leak to agents). */
  locked: number;
  scannedAt: string | null;
  agentAccess: AgentAccess;
}

export interface SearchHit {
  file: ViewFile;
  score: number;
  /** Which field matched. */
  field: 'title' | 'heading' | 'path' | 'topic';
}

export interface BrainView {
  readonly rootHash: string;
  readonly audience: Audience;
  readonly enabled: boolean;
  summary(): ViewSummary;
  /** Visible files, sorted by relpath. */
  files(): ViewFile[];
  get(id: string): ViewFile | undefined;
  /** Visible folders (derived from visible files only). */
  folders(): string[];
  /** Plain-substring search over title/heading/path/topic of VISIBLE files only. */
  search(query: string, limit?: number): SearchHit[];
  /** Owner: sensitive aggregates. Agent: always []. */
  lockedZones(): LockedZone[];
  /**
   * Agent-audience response hook: appends one egress row (channel 'mcp') and
   * returns the payload unchanged. Owner audience: no-op passthrough.
   */
  respond<T>(op: string, fileIds: string[], payload: T): T;
}

// ── Egress ───────────────────────────────────────────────────────────

export interface EgressRow {
  at: string;
  /** 'config' rows are local security events (e.g. tamper-detected) — nothing left the machine. */
  channel: 'mcp' | 'cloud' | 'config';
  op: string;
  fileIds: string[];
  bytes: number;
  root: string;
}

// ── Detectors ────────────────────────────────────────────────────────

export type DetectorId =
  | 'pem-private-key'
  | 'aws-access-key'
  | 'github-token'
  | 'slack-token'
  | 'anthropic-key'
  | 'openai-key'
  | 'google-api-key'
  | 'stripe-key'
  | 'jwt'
  | 'iban'
  | 'secret-assignment'
  | 'card-number'
  | 'us-ssn'
  | 'passport-mrz';

export interface DetectResult {
  /** Detector ids that fired — never the matched text. */
  secrets: DetectorId[];
  thirdParty: boolean;
}

export interface ParsedDoc {
  title?: string;
  headings: string[];
  links: LinkRef[];
  tags: string[];
  aliases: string[];
  relates: string[];
}
