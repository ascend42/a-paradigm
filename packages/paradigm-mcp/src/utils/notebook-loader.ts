/**
 * Notebook Loader — CRUD for agent notebook entries
 *
 * Storage mirrors agent-loader pattern:
 *   ~/.paradigm/notebooks/{agent-id}/    (global, travels across projects)
 *   .paradigm/notebooks/{agent-id}/      (project-level)
 *
 * Each entry is a YAML file: nb-{concept}.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import type { NotebookEntry, NotebookProvenance, NotebookScope } from '../types/notebooks.js';

// ────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────

const GLOBAL_NOTEBOOKS_DIR = path.join(os.homedir(), '.paradigm', 'notebooks');
const PROJECT_NOTEBOOKS_DIR = '.paradigm/notebooks';
const NOTEBOOK_PREFIX = 'nb-';
const NOTEBOOK_EXT = '.yaml';

// ────────────────────────────────────────────────────────
// Concept Normalization
// ────────────────────────────────────────────────────────

/**
 * Normalize a concept key so writes and reads compare on the same axis.
 *
 * Postflight promotion can tag entries with structured concepts like
 * `symbol:payment-form` or `#payment-form`, while query concepts arrive as
 * bare slugs (`payment-form`). Without normalization a promoted entry can
 * never be retrieved by its own query slug (the T-001 bug).
 *
 * Strips a leading `symbol:` prefix, any leading Paradigm sigil (#$^!~@&%?),
 * lowercases, and trims.
 */
export function normalizeConcept(s: string): string {
  if (!s) return '';
  let out = s.trim();
  // Strip a leading "symbol:" structured-tag prefix (case-insensitive)
  out = out.replace(/^symbol:/i, '');
  // Strip a single leading Paradigm sigil
  out = out.replace(/^[#$^!~@&%?]/, '');
  return out.trim().toLowerCase();
}

// ────────────────────────────────────────────────────────
// Read Operations
// ────────────────────────────────────────────────────────

/**
 * Load all notebook entries for an agent (global + project, deduplicated by id).
 */
export function loadNotebookEntries(
  agentId: string,
  rootDir: string,
  filter?: { concepts?: string[]; tags?: string[] }
): NotebookEntry[] {
  const entries = new Map<string, NotebookEntry>();

  // Load global entries first
  const globalDir = path.join(GLOBAL_NOTEBOOKS_DIR, agentId);
  loadEntriesFromDir(globalDir, entries);

  // Load project entries (override global with same id)
  const projectDir = path.join(rootDir, PROJECT_NOTEBOOKS_DIR, agentId);
  loadEntriesFromDir(projectDir, entries);

  let result = Array.from(entries.values());

  // Apply filters
  if (filter?.concepts && filter.concepts.length > 0) {
    // Normalize on BOTH sides so structured concepts (`symbol:payment-form`,
    // `#payment-form`) match bare query slugs (`payment-form`). See T-001.
    const conceptSet = new Set(filter.concepts.map(normalizeConcept));
    result = result.filter(e =>
      e.concepts.some(c => conceptSet.has(normalizeConcept(c)))
    );
  }

  if (filter?.tags && filter.tags.length > 0) {
    const tagSet = new Set(filter.tags.map(t => t.toLowerCase()));
    result = result.filter(e =>
      e.tags.some(t => tagSet.has(t.toLowerCase()))
    );
  }

  return result.sort((a, b) => b.appliedCount - a.appliedCount);
}

function loadEntriesFromDir(dir: string, entries: Map<string, NotebookEntry>): void {
  if (!fs.existsSync(dir)) return;

  try {
    const files = fs.readdirSync(dir).filter(f =>
      f.startsWith(NOTEBOOK_PREFIX) && f.endsWith(NOTEBOOK_EXT)
    );

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const entry = yaml.load(content) as NotebookEntry;
        if (entry?.id) {
          entries.set(entry.id, entry);
        }
      } catch { /* skip invalid */ }
    }
  } catch { /* dir read error */ }
}

/**
 * Default prior confidence when no matching notebook entry exists for a concept set.
 * Used by {@link notebookPrior} as the "uninformed" baseline.
 */
export const DEFAULT_PRIOR = 0.5;

/**
 * Derive the prior confidence the notebook already holds for a set of concepts.
 *
 * This is the read side of the promotion belief loop: before promoting a journal
 * entry, we want to know what the notebook currently believes about the same
 * concepts. Concepts are normalized the same way promotion derives them, so a
 * structured tag (`symbol:payment-form`) and a bare slug (`payment-form`) match.
 *
 * Returns the MAX confidence across matching entries (the strongest existing
 * belief), or {@link DEFAULT_PRIOR} when no entry matches. The `found` flag
 * distinguishes "no prior on record" from a real entry that happens to sit at
 * the default value — useful for the promotion-decision instrument.
 *
 * NOTE: This is an INSTRUMENT, not a gate. It only measures; it does not decide
 * which entries promote.
 */
export function notebookPrior(
  agentId: string,
  concepts: string[],
  rootDir: string
): { value: number; found: boolean } {
  const normalized = Array.from(
    new Set((concepts || []).map(normalizeConcept).filter(Boolean))
  );
  if (normalized.length === 0) {
    return { value: DEFAULT_PRIOR, found: false };
  }

  const matches = loadNotebookEntries(agentId, rootDir, { concepts: normalized });
  if (matches.length === 0) {
    return { value: DEFAULT_PRIOR, found: false };
  }

  const value = Math.max(
    ...matches.map(m => (typeof m.confidence === 'number' ? m.confidence : DEFAULT_PRIOR))
  );
  return { value, found: true };
}

/**
 * Search notebook entries by query string across context, snippet, and concepts.
 */
export function searchNotebooks(
  agentId: string,
  query: string,
  rootDir: string
): NotebookEntry[] {
  const all = loadNotebookEntries(agentId, rootDir);
  const q = query.toLowerCase();

  return all.filter(e =>
    e.context.toLowerCase().includes(q) ||
    e.snippet.toLowerCase().includes(q) ||
    e.concepts.some(c => c.toLowerCase().includes(q)) ||
    e.tags.some(t => t.toLowerCase().includes(q))
  );
}

// ────────────────────────────────────────────────────────
// Scope Auto-Classification
// ────────────────────────────────────────────────────────

/**
 * Auto-classify a notebook entry's publish scope based on content signals.
 *
 * Rules (in priority order):
 * - platform-specific: mentions Paradigm/nevr.land internals (MCP tools, .paradigm paths,
 *   lore/aspect/gate/portal terminology, symphony, ambient, PAN)
 * - project-specific: contains absolute file paths or Paradigm symbol IDs (#x, $x, ^x, !x, ~x)
 * - generalizable: everything else
 *
 * This is a suggestion — the owner confirms/overrides via `nevr notebook audit`.
 */
export function classifyNotebookScope(entry: {
  context: string;
  snippet: string;
  concepts: string[];
  tags: string[];
}): NotebookScope {
  const text = [entry.context, entry.snippet, ...entry.concepts, ...entry.tags]
    .join(' ')
    .toLowerCase();

  const platformTerms = [
    'paradigm', 'mcp_', 'mcp tool', '.paradigm/', 'lore entry', 'lore record',
    'aspect', '^gate', 'portal.yaml', '.purpose', 'sentinel', 'symphony',
    'ambient nomination', 'paradigm_', ' pan ', 'agent notebook', 'concept anchor',
    'symbol system', 'work log', 'knowledge stream', 'nevr.land', 'neverland',
  ];
  if (platformTerms.some(t => text.includes(t))) return 'platform-specific';

  // Paradigm symbol IDs (#x-y, $x-y, ^x-y, !x-y, ~x-y) or absolute paths
  if (/[#$^!~][a-z][a-z0-9-]{2,}/.test(text) || /\/[a-z0-9_-]{2,}\/[a-z0-9_-]/.test(text)) {
    return 'project-specific';
  }

  return 'generalizable';
}

// ────────────────────────────────────────────────────────
// Write Operations
// ────────────────────────────────────────────────────────

/**
 * Add a new notebook entry.
 */
export function addNotebookEntry(
  agentId: string,
  entry: Omit<NotebookEntry, 'id' | 'created' | 'updated' | 'appliedCount'>,
  scope: 'global' | 'project',
  rootDir?: string
): { entry: NotebookEntry; filePath: string } {
  const now = new Date().toISOString();

  // Generate stable deterministic ID: nb-{agentId}-{slug}
  // Slug derived from first concept — no timestamps, no random suffixes.
  // Stable IDs are required for the nevr.land merge-by-id algorithm.
  const conceptSlug = (entry.concepts[0] || entry.context.split(' ').slice(0, 4).join(' ') || 'entry')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const agentSlug = agentId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = `nb-${agentSlug}-${conceptSlug}`;

  // Auto-classify scope if not explicitly set
  const resolvedScope: NotebookScope = entry.scope ?? classifyNotebookScope({
    context: entry.context,
    snippet: entry.snippet,
    concepts: entry.concepts,
    tags: entry.tags,
  });

  // Normalize concepts on store so retrieval (which also normalizes) can match.
  // Drops empties and de-dupes while preserving order. See T-001.
  const normalizedConcepts = Array.from(
    new Set((entry.concepts || []).map(normalizeConcept).filter(Boolean))
  );

  const fullEntry: NotebookEntry = {
    ...entry,
    concepts: normalizedConcepts,
    id,
    scope: resolvedScope,
    publishable: entry.publishable ?? true,
    // Persist confidence explicitly. The NotebookEntry type requires a number,
    // but callers (e.g. autoPromoteJournalEntries before the open-loop fix) could
    // omit it, leaving the stored entry's confidence silently absent → any future
    // prior read would be garbage. Default to 0.5 (DEFAULT_PRIOR) when a caller
    // gives us nothing to anchor on. No ratchet: latest measurement wins.
    confidence: entry.confidence ?? 0.5,
    appliedCount: 0,
    created: now,
    updated: now,
  };

  const dir = scope === 'global'
    ? path.join(GLOBAL_NOTEBOOKS_DIR, agentId)
    : path.join(rootDir || process.cwd(), PROJECT_NOTEBOOKS_DIR, agentId);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const fileName = `${id}${NOTEBOOK_EXT}`;
  const filePath = path.join(dir, fileName);

  const content = yaml.dump(fullEntry, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });

  fs.writeFileSync(filePath, content, 'utf-8');

  return { entry: fullEntry, filePath };
}

/**
 * Promote a lore entry into a notebook entry.
 */
export async function promoteFromLore(
  agentId: string,
  loreEntryId: string,
  rootDir: string,
  scope: 'global' | 'project' = 'global'
): Promise<{ entry: NotebookEntry; filePath: string } | null> {
  // Dynamic import to avoid circular deps
  const { loadLoreEntry } = await import('./lore-loader.js');

  const loreEntry = await loadLoreEntry(rootDir, loreEntryId);
  if (!loreEntry) return null;

  // Extract concepts from symbols and tags
  const concepts: string[] = [];
  if (loreEntry.symbols_touched) {
    for (const sym of loreEntry.symbols_touched) {
      // Strip prefix and convert to concept
      const clean = sym.replace(/^[#$^!~]/, '').toLowerCase();
      concepts.push(clean);
    }
  }

  // Build snippet from summary + body
  let snippet = loreEntry.summary || '';
  if (loreEntry.body) {
    snippet += '\n\n' + loreEntry.body;
  }

  const provenance: NotebookProvenance = {
    source: 'lore',
    loreEntryId,
    originProject: path.basename(rootDir),
    createdBy: agentId,
  };

  return addNotebookEntry(
    agentId,
    {
      context: loreEntry.title || `Promoted from ${loreEntryId}`,
      snippet,
      provenance,
      confidence: loreEntry.confidence ?? 0.7,
      concepts,
      tags: loreEntry.tags || [],
    },
    scope,
    rootDir
  );
}

/**
 * Increment the applied count for a notebook entry.
 */
export function incrementApplied(
  agentId: string,
  entryId: string,
  rootDir: string
): boolean {
  // Try project first, then global
  const projectDir = path.join(rootDir, PROJECT_NOTEBOOKS_DIR, agentId);
  const globalDir = path.join(GLOBAL_NOTEBOOKS_DIR, agentId);

  for (const dir of [projectDir, globalDir]) {
    const filePath = path.join(dir, `${entryId}${NOTEBOOK_EXT}`);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const entry = yaml.load(content) as NotebookEntry;
        if (entry) {
          entry.appliedCount = (entry.appliedCount || 0) + 1;
          // The Classroom: stamp the application receipt timestamp so the future
          // decay pass can tell a recently-used entry from a silent one.
          entry.lastAppliedAt = new Date().toISOString();
          entry.updated = new Date().toISOString();
          fs.writeFileSync(filePath, yaml.dump(entry, {
            lineWidth: 120,
            noRefs: true,
            sortKeys: false,
          }), 'utf-8');
          return true;
        }
      } catch { /* skip */ }
    }
  }

  return false;
}

/**
 * The Classroom (TD-2026-06-19-007) — the fail side of the learning loop.
 *
 * Records that an entry, after being applied, BROKE in the field: bumps
 * `appliedAndBrokeCount` and revises `confidence` DOWN. Uses the SAME latest-wins
 * entry-update path `incrementApplied` uses — there is NO ratchet and no second
 * store of truth; the YAML file is rewritten in place.
 *
 * MVP penalty is a FLAT decrement, clamped at ≥ 0. The principled form is
 * severity-weighted / Bayesian on the applied↔broke ratio (decision §4) — this is
 * the seam: replace `MVP_PENALTY` with `f(failure.severity, appliedCount, appliedAndBrokeCount)`.
 *
 * REFINEMENT CAPTURE ("X except Y") — Phase 2 (TD-2026-06-19-007):
 * On an attributed break this records a STRUCTURED exception, not a prose rewrite.
 *   - `refinement.base` ("the X") is seeded ONCE from the entry's snippet/context.
 *   - an exception `{when, then, sourceFailureId}` is appended where:
 *       when = the break CONTEXT (the field-failure detail — what actually broke),
 *       then = the corrective. The scenario bank's `expected` is only a
 *              `{must: survive|reject}` flag and carries NO corrective prose, so
 *              the `then` is a clear STUB. The PROSE rewrite of the corrective is
 *              authored at the gated `/paradigm:class review` `refine` verdict
 *              (the skill, where an LLM + the human gate live) — the reducer is
 *              mechanical only and runs NO model. That division is intentional
 *              per the spec ("refine rewrites X except Y" is a gated arm).
 *   - DEDUPE: an exception is appended at most ONCE per `sourceFailureId`,
 *     mirroring the reducer's one-revision-per-(entryId, orchestrationId) guard.
 *     This is defense-in-depth: even if the reducer's durable guard is bypassed,
 *     the exception list never accrues a duplicate for the same break.
 *
 * @returns true if an entry was found and revised, false otherwise.
 */
const MVP_PENALTY = 0.15;

/** Sentinel `then` corrective — the prose is authored at the gated class review. */
const REFINE_THEN_STUB = 'needs authoring in gated class review (/paradigm:class refine)';

export function reviseDown(
  agentName: string,
  entryId: string,
  failure: { failureId: string; signal: string; detail: string; severity?: string },
  rootDir: string
): boolean {
  const projectDir = path.join(rootDir, PROJECT_NOTEBOOKS_DIR, agentName);
  const globalDir = path.join(GLOBAL_NOTEBOOKS_DIR, agentName);

  for (const dir of [projectDir, globalDir]) {
    const filePath = path.join(dir, `${entryId}${NOTEBOOK_EXT}`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const entry = yaml.load(content) as NotebookEntry;
      if (!entry) continue;

      // Fail-side mirror of appliedCount.
      entry.appliedAndBrokeCount = (entry.appliedAndBrokeCount || 0) + 1;

      // Latest-wins confidence revision (no ratchet). FLAT for the MVP; the
      // severity-weighted/Bayesian form plugs in here (decision §4).
      const current = typeof entry.confidence === 'number' ? entry.confidence : DEFAULT_PRIOR;
      entry.confidence = Math.max(0, current - MVP_PENALTY);

      // REFINEMENT CAPTURE ("base EXCEPT when→then"). The reducer captures the
      // structural exception MECHANICALLY (no model); the corrective PROSE is
      // authored at the gated /paradigm:class refine verdict — hence the stub.
      const now = new Date().toISOString();
      // base ("the X") is the entry's original claim — set ONCE, never rewritten here.
      const base = entry.refinement?.base ?? (entry.context || entry.snippet || '').slice(0, 200);
      const exceptions = entry.refinement?.exceptions ?? [];
      // DEDUPE: skip if this exact break already produced an exception (mirrors
      // the reducer's one-revision-per-(entryId, orchestrationId) guard).
      const alreadyCaptured = exceptions.some(ex => ex.sourceFailureId === failure.failureId);
      if (!alreadyCaptured) {
        exceptions.push({
          // when = the break CONTEXT (what actually broke), not the bare signal.
          when: (failure.detail || failure.signal).slice(0, 200),
          // then = corrective; authored later at the gated review (no prose here).
          then: REFINE_THEN_STUB,
          sourceFailureId: failure.failureId,
        });
      }
      entry.refinement = { base, exceptions, revisedAt: now };
      entry.lineageType = 'refine';
      entry.updated = now;

      fs.writeFileSync(filePath, yaml.dump(entry, {
        lineWidth: 120,
        noRefs: true,
        sortKeys: false,
      }), 'utf-8');
      return true;
    } catch { /* skip */ }
  }

  return false;
}

/**
 * A located notebook entry plus where on disk it lives — the unit the decay pass
 * iterates. `scope` records which store the file was read from so a writer can
 * round-trip it in place.
 */
export interface LocatedNotebookEntry {
  entry: NotebookEntry;
  agentId: string;
  filePath: string;
  scope: 'project' | 'global';
}

/**
 * The Classroom decay pass (TD-2026-06-19-007): enumerate EVERY notebook entry
 * across every agent, in both project and global scope. Best-effort — an
 * unreadable dir or file is skipped, never thrown. Project and global entries
 * with the same id are BOTH returned (the decay pass mutates files in place, so
 * it must see each physical file; this differs from {@link loadNotebookEntries}
 * which dedupes by id for context loading).
 */
export function listAllAgentNotebookEntries(rootDir: string): LocatedNotebookEntry[] {
  const located: LocatedNotebookEntry[] = [];

  const scan = (base: string, scope: 'project' | 'global') => {
    if (!fs.existsSync(base)) return;
    let agentDirs: string[];
    try {
      agentDirs = fs.readdirSync(base, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch { return; }

    for (const agentId of agentDirs) {
      const dir = path.join(base, agentId);
      let files: string[];
      try {
        files = fs.readdirSync(dir).filter(
          f => f.startsWith(NOTEBOOK_PREFIX) && f.endsWith(NOTEBOOK_EXT),
        );
      } catch { continue; }

      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const entry = yaml.load(fs.readFileSync(filePath, 'utf-8')) as NotebookEntry;
          if (entry?.id) located.push({ entry, agentId, filePath, scope });
        } catch { /* skip invalid */ }
      }
    }
  };

  scan(GLOBAL_NOTEBOOKS_DIR, 'global');
  scan(path.join(rootDir, PROJECT_NOTEBOOKS_DIR), 'project');
  return located;
}

/**
 * The Classroom decay pass (TD-2026-06-19-007) — UNUSED-ENTRY DECAY. "Silence is
 * signal": an entry that has not been applied in a long time, and was barely
 * applied to begin with, gently loses a little confidence. CONSERVATIVE by
 * design — never deletes, decrements by a small clamped amount, and writes
 * through the SAME latest-wins YAML path `incrementApplied`/`reviseDown` use.
 *
 * @param located the file to decay (from {@link listAllAgentNotebookEntries}).
 * @param decrement how much confidence to shed (clamped at ≥ 0).
 * @returns true if the file was written (confidence actually changed), else false.
 */
export function decayUnusedEntry(
  located: LocatedNotebookEntry,
  decrement: number,
): boolean {
  const { entry, filePath } = located;
  const current = typeof entry.confidence === 'number' ? entry.confidence : DEFAULT_PRIOR;
  const next = Math.max(0, current - decrement);
  if (next === current) return false; // already at floor — nothing to write

  try {
    entry.confidence = next;
    entry.updated = new Date().toISOString();
    fs.writeFileSync(filePath, yaml.dump(entry, {
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    }), 'utf-8');
    return true;
  } catch {
    return false;
  }
}
