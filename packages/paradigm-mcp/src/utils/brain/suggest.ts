/**
 * #brain-suggest — deterministic topic suggester (model 'heuristic@1') plus the
 * suggest → verdict → acceptance loop.
 *
 *   generateCandidates(view, declared)            pure: every candidate, ranked
 *   nextSuggestions(rootHash, opts)               next ≤10 (folder-level first), logged
 *   recordVerdict(rootHash, id, verdict, opts)    accept → declared.yaml (backup + atomic)
 *   acceptanceStats(rootHash, opts)               accept / (accept + reject)
 *   suggestionsState / setSuggestionsMode         feature flag (auto|on|off)
 *   staleSuggestions(rootHash, opts)              logged rows whose sourceHash changed
 *
 * Heuristics (no model, no bodies):
 *   1. folder names (dates, numbering and stopwords stripped)
 *   2. frontmatter tags / aliases shared by ≥2 notes
 *   3. title/heading n-grams recurring in ≥3 files of one folder
 *   4. wikilink hubs (visible in-degree ≥3)
 *
 * Runs over the OWNER view only — sensitive zones are never suggested because
 * the view never hands them over. A suggestion is stale when its sourceHash
 * (hash of the anchored files' content hashes) changes; stale suggestions
 * cannot be accepted, and old reject verdicts stop suppressing them.
 *
 * Verdicts: accept and reject suppress (reject only while the sources are
 * unchanged). Skip means "not now", never "never": a skipped suggestion is
 * not removed — it moves to the back of the queue, so the next batch shows
 * everything else first and it returns once the rest are decided.
 *
 * Near-duplicates: labels that match after simple singular/plural
 * normalization ("Recipe" / "Recipes") for the same scope+target collapse to
 * the higher-scoring one.
 *
 * Feature flag: <brainDir>/features.yaml `suggestions: auto|on|off`. In `auto`
 * suggestions switch off once ≥10 decided verdicts measure acceptance < 60%
 * (scan, zones and health keep working).
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { log } from '../mcp-logger.js';
import { atomicWriteFileSync } from './atomic.js';
import { assertBrainWritePath, brainDir, brainFile, loadBrainConfig } from './config.js';
import { declareFromSuggestion, loadDeclared, toSymbolId, type DeclaredDoc, type DeclareResult } from './declared.js';
import { openBrainView } from './view.js';
import type { BrainOptions, BrainView, ViewFile } from './types.js';

const L = () => log.component('#brain-suggest');

export const SUGGEST_MODEL = 'heuristic@1';
export const MAX_BATCH = 10;
export const ACCEPTANCE_THRESHOLD = 0.6;
export const MIN_DECIDED_FOR_FLAG = 10;

export type SuggestionScope = 'folder' | 'file';
export type EvidenceType = 'folder-name' | 'tag' | 'alias' | 'ngram' | 'hub';
export type Verdict = 'accept' | 'reject' | 'skip';

export interface Suggestion {
  kind: 'suggestion';
  /** Deterministic: s_<10 hex> of scope|target|label-id. */
  id: string;
  label: string;
  scope: SuggestionScope;
  /** Folder path (scope folder, '' = root) or file id (scope file). */
  target: string;
  /** 0..1 */
  score: number;
  /** Plain-language rationale items. */
  evidence: Array<{ type: EvidenceType; detail: string }>;
  sourceHash: string;
  model: typeof SUGGEST_MODEL;
  at: string;
  /** 'f_<id>:<relpath>' anchors the label would attach to. */
  anchors: string[];
}

export interface VerdictRow {
  kind: 'verdict';
  suggestionId: string;
  verdict: Verdict;
  at: string;
  /** sourceHash of the suggestion the verdict was given on. */
  sourceHash?: string;
}

// ── Text helpers ─────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is', 'it', 'its', 'my', 'of', 'on',
  'or', 'our', 'the', 'this', 'that', 'to', 'we', 'with', 'what', 'when', 'why', 'your', 'you', 'about', 'new', 'old',
  'misc', 'miscellaneous', 'notes', 'note', 'stuff', 'other', 'others', 'archive', 'archives', 'inbox', 'untitled', 'tmp',
  'temp', 'backup', 'backups', 'draft', 'drafts', 'files', 'file', 'docs', 'documents', 'document', 'attachments', 'assets',
  'images', 'image', 'img', 'media', 'resources', 'general', 'random', 'folder', 'copy', 'todo', 'index', 'readme',
  'introduction', 'intro', 'overview', 'summary', 'references', 'links', 'part', 'section', 'chapter',
]);

const MONTHS = new Set(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);

function words(s: string): string[] {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !MONTHS.has(w) && !/^\d+$/.test(w));
}

function titleCase(s: string): string {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** Folder segment → label ('' when nothing meaningful remains). */
export function folderLabel(segment: string): string {
  let s = segment.normalize('NFKC');
  s = s.replace(/^\d{2}-\d{2}\s+/, ''); // Johnny.Decimal area "10-19 "
  s = s.replace(/^\d+(\.\d+)*[\s._-]+/, ''); // "01 ", "12.03 "
  s = s.replace(/\b\d{4}([-_.]\d{1,2}){0,2}\b/g, ' '); // dates
  s = s.replace(/[_-]+/g, ' ');
  const kept = s.split(/\s+/).filter((w) => {
    const lw = w.toLowerCase();
    return w && !STOPWORDS.has(lw) && !MONTHS.has(lw) && !/^\d+$/.test(w);
  });
  return titleCase(kept.join(' ').trim()).slice(0, 60);
}

function anchorOf(f: ViewFile): string {
  return `${f.id}:${f.relpath}`;
}

function sourceHashOf(label: string, files: ViewFile[]): string {
  const parts = files.map((f) => `${f.id}:${f.hash ?? `${f.size}:${f.mtimeMs ?? 0}`}`).sort();
  return crypto.createHash('sha256').update(`${toSymbolId(label)}\n${parts.join('\n')}`).digest('hex').slice(0, 16);
}

function suggestionId(scope: SuggestionScope, target: string, label: string): string {
  return 's_' + crypto.createHash('sha256').update(`${scope}|${target}|${toSymbolId(label)}`).digest('hex').slice(0, 10);
}

function round(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

// ── Candidate generation (pure) ──────────────────────────────────────

interface Draft {
  label: string;
  scope: SuggestionScope;
  target: string;
  score: number;
  evidence: Suggestion['evidence'];
  files: ViewFile[];
}

function inFolder(f: ViewFile, folder: string): boolean {
  return folder === '' ? true : f.folder === folder || f.folder.startsWith(folder + '/');
}

/**
 * Every candidate for this view, merged by label, ranked (folder scope first,
 * then score desc, then label). Excludes labels already declared.
 */
export function generateCandidates(view: BrainView, declared: DeclaredDoc = { version: 1, components: {}, relates: [] }, at = new Date().toISOString()): Suggestion[] {
  const files = view.files();
  const notes = files.filter((f) => f.kind === 'markdown' || f.kind === 'text');
  const drafts: Draft[] = [];

  // 1. Folder names
  for (const folder of view.folders()) {
    if (!folder) continue;
    const segs = folder.split('/');
    const label = folderLabel(segs[segs.length - 1]);
    if (!label || toSymbolId(label).length < 3) continue;
    const members = files.filter((f) => inFolder(f, folder));
    if (members.length < 2) continue;
    drafts.push({
      label, scope: 'folder', target: folder, files: members,
      score: 0.5 + Math.min(0.4, members.length / 25),
      evidence: [{ type: 'folder-name', detail: `Folder "${folder}" holds ${members.length} files` }],
    });
  }

  // 2. Tags / aliases shared by ≥2 notes
  const byTag = new Map<string, { type: 'tag' | 'alias'; label: string; files: ViewFile[] }>();
  for (const f of notes) {
    const seen = new Set<string>();
    for (const [type, list] of [['tag', f.tags], ['alias', f.aliases]] as const) {
      for (const raw of list) {
        const key = toSymbolId(raw.split('/').pop() ?? raw);
        if (key.length < 3 || seen.has(key) || STOPWORDS.has(key)) continue;
        seen.add(key);
        const e = byTag.get(key) ?? { type, label: titleCase(key.replace(/-/g, ' ')), files: [] };
        e.files.push(f);
        byTag.set(key, e);
      }
    }
  }
  for (const [, e] of byTag) {
    if (e.files.length < 2) continue;
    const folderCounts = new Map<string, number>();
    for (const f of e.files) folderCounts.set(f.folder, (folderCounts.get(f.folder) ?? 0) + 1);
    const [topFolder, topCount] = [...folderCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    const folderScoped = topFolder !== '' && topCount / e.files.length >= 0.7;
    drafts.push({
      label: e.label,
      scope: folderScoped ? 'folder' : 'file',
      target: folderScoped ? topFolder : e.files[0].id,
      files: e.files,
      score: 0.6 + Math.min(0.3, e.files.length / 15),
      evidence: [{ type: e.type, detail: `${e.files.length} notes are ${e.type === 'tag' ? 'tagged' : 'also called'} "${e.label.toLowerCase()}"` }],
    });
  }

  // 3. Title/heading n-grams recurring in ≥3 files of a folder (direct children)
  const byFolder = new Map<string, ViewFile[]>();
  for (const f of notes) {
    const g = byFolder.get(f.folder) ?? [];
    g.push(f);
    byFolder.set(f.folder, g);
  }
  for (const [folder, group] of [...byFolder.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (group.length < 3) continue;
    const counts = new Map<string, ViewFile[]>();
    for (const f of group) {
      const grams = new Set<string>();
      for (const line of [f.title ?? '', ...f.headings]) {
        const w = words(line);
        for (let n = 1; n <= 3; n++) {
          for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(' '));
        }
      }
      for (const g of grams) {
        const arr = counts.get(g) ?? [];
        arr.push(f);
        counts.set(g, arr);
      }
    }
    const recurring = [...counts.entries()]
      .filter(([, fs]) => fs.length >= 3)
      .sort((a, b) => b[0].split(' ').length - a[0].split(' ').length || b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
    const chosen: Array<[string, ViewFile[]]> = [];
    for (const [g, fs] of recurring) {
      if (chosen.some(([c, cf]) => (` ${c} `).includes(` ${g} `) && cf.length >= fs.length * 0.8)) continue;
      chosen.push([g, fs]);
      if (chosen.length >= 3) break;
    }
    for (const [g, fs] of chosen) {
      drafts.push({
        label: titleCase(g), scope: 'folder', target: folder, files: fs,
        score: 0.4 + Math.min(0.4, fs.length / 12) + (g.includes(' ') ? 0.05 : 0),
        evidence: [{ type: 'ngram', detail: `"${g}" appears in the titles or headings of ${fs.length} notes in ${folder ? `"${folder}"` : 'the top folder'}` }],
      });
    }
  }

  // 4. Wikilink hubs (in-degree ≥3)
  const byId = new Map(files.map((f) => [f.id, f]));
  for (const hub of files) {
    if (hub.inbound < 3) continue;
    const linkers = files.filter((f) => f.id !== hub.id && f.links.some((l) => l.status === 'ok' && l.toId === hub.id));
    const label = hub.title || path.posix.basename(hub.relpath).replace(/\.(md|markdown|txt)$/i, '');
    if (toSymbolId(label).length < 3) continue;
    drafts.push({
      label: label.slice(0, 60), scope: 'file', target: hub.id, files: [hub, ...linkers.filter((f) => byId.has(f.id))],
      score: 0.5 + Math.min(0.4, hub.inbound / 12),
      evidence: [{ type: 'hub', detail: `${hub.inbound} notes link to "${label.slice(0, 60)}"` }],
    });
  }

  // Merge by label id; corroborating heuristics raise the score; folder scope wins.
  const merged = new Map<string, Draft>();
  for (const d of drafts) {
    const key = toSymbolId(d.label);
    if (!key || declared.components[key]) continue;
    const e = merged.get(key);
    if (!e) { merged.set(key, { ...d, evidence: [...d.evidence], files: [...d.files] }); continue; }
    const winner = e.scope === 'folder' || d.scope !== 'folder' ? e : { ...d, evidence: e.evidence, files: e.files };
    const ids = new Set(winner.files.map((f) => f.id));
    const files2 = [...winner.files, ...d.files.filter((f) => !ids.has(f.id)), ...e.files.filter((f) => !ids.has(f.id))];
    merged.set(key, {
      ...winner,
      files: [...new Map(files2.map((f) => [f.id, f])).values()],
      score: Math.max(e.score, d.score) + 0.1,
      evidence: [...e.evidence, ...(winner === e ? d.evidence : [])].slice(0, 6),
    });
  }

  const out: Suggestion[] = dedupePlurals([...merged.values()]).map((d) => ({
    kind: 'suggestion' as const,
    id: suggestionId(d.scope, d.target, d.label),
    label: d.label,
    scope: d.scope,
    target: d.target,
    score: round(d.score),
    evidence: d.evidence,
    sourceHash: sourceHashOf(d.label, d.files),
    model: SUGGEST_MODEL,
    at,
    anchors: d.files.slice(0, 200).map(anchorOf).sort(),
  }));
  out.sort((a, b) =>
    (a.scope === b.scope ? 0 : a.scope === 'folder' ? -1 : 1) ||
    b.score - a.score ||
    (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return out;
}

/** Singular/plural variants of a label's last word ('recipes' → recipes|recipe|recip). */
function pluralStems(label: string): Set<string> {
  const id = toSymbolId(label);
  const cut = id.lastIndexOf('-');
  const head = cut >= 0 ? id.slice(0, cut + 1) : '';
  const last = cut >= 0 ? id.slice(cut + 1) : id;
  const out = new Set([id]);
  if (last.length > 3 && last.endsWith('es')) out.add(head + last.slice(0, -2));
  if (last.length > 3 && last.endsWith('s') && !last.endsWith('ss')) out.add(head + last.slice(0, -1));
  return out;
}

/**
 * Collapse near-duplicate labels (singular/plural) aimed at the same scope +
 * target, keeping the higher score (ties: the earlier draft); the loser's
 * evidence is folded into the winner.
 */
function dedupePlurals(drafts: Draft[]): Draft[] {
  const ranked = drafts
    .map((d, i) => ({ d, i, stems: pluralStems(d.label) }))
    .sort((a, b) => b.d.score - a.d.score || a.i - b.i);
  const kept: Array<{ d: Draft; i: number; stems: Set<string> }> = [];
  for (const c of ranked) {
    const dup = kept.find((k) =>
      k.d.scope === c.d.scope && k.d.target === c.d.target && [...c.stems].some((x) => k.stems.has(x)));
    if (!dup) { kept.push(c); continue; }
    dup.d = { ...dup.d, evidence: [...dup.d.evidence, ...c.d.evidence].slice(0, 6) };
  }
  return kept.sort((a, b) => a.i - b.i).map((k) => k.d);
}

// ── Log (suggestions.jsonl) ──────────────────────────────────────────

export interface SuggestionLog {
  /** Latest logged row per suggestion id. */
  suggestions: Map<string, Suggestion>;
  verdicts: VerdictRow[];
}

export function readSuggestionLog(rootHash: string, opts?: BrainOptions): SuggestionLog {
  const log: SuggestionLog = { suggestions: new Map(), verdicts: [] };
  let text = '';
  try { text = fs.readFileSync(brainFile(rootHash, 'suggestions', opts), 'utf8'); } catch { return log; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Suggestion | VerdictRow;
      if (r.kind === 'suggestion' && typeof r.id === 'string') log.suggestions.set(r.id, r);
      else if (r.kind === 'verdict' && typeof r.suggestionId === 'string' && ['accept', 'reject', 'skip'].includes(r.verdict)) log.verdicts.push(r);
    } catch { /* skip malformed line */ }
  }
  return log;
}

function appendRows(rootHash: string, rows: Array<Suggestion | VerdictRow>, opts?: BrainOptions): void {
  if (rows.length === 0) return;
  const cfg = loadBrainConfig(rootHash, opts);
  const file = brainFile(rootHash, 'suggestions', opts);
  assertBrainWritePath(file, cfg.root, opts);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600, flag: 'a' });
}

/**
 * True when a verdict still suppresses this (current) suggestion. Only accept
 * and reject suppress — skip is "not now", handled by ordering (skippedNow).
 */
function suppressed(s: Suggestion, verdicts: VerdictRow[]): boolean {
  for (const v of verdicts) {
    if (v.suggestionId !== s.id) continue;
    if (v.verdict === 'accept') return true;
    if (v.verdict === 'reject' && (!v.sourceHash || v.sourceHash === s.sourceHash)) return true;
  }
  return false;
}

/** Latest verdict on this suggestion is a skip → it goes to the back of the queue. */
function skippedNow(s: Suggestion, verdicts: VerdictRow[]): boolean {
  let last: Verdict | null = null;
  for (const v of verdicts) if (v.suggestionId === s.id) last = v.verdict;
  return last === 'skip';
}

// ── Feature flag ─────────────────────────────────────────────────────

export type SuggestionsMode = 'auto' | 'on' | 'off';

export interface SuggestionsState {
  mode: SuggestionsMode;
  enabled: boolean;
  /** True when auto mode switched suggestions off (too many dismissed) — not a user 'off'. */
  paused: boolean;
  acceptance: number | null;
  decided: number;
  reason: string;
}

function featuresFile(rootHash: string, opts?: BrainOptions): string {
  return path.join(brainDir(rootHash, opts), 'features.yaml');
}

export function getSuggestionsMode(rootHash: string, opts?: BrainOptions): SuggestionsMode {
  try {
    const raw = yaml.load(fs.readFileSync(featuresFile(rootHash, opts), 'utf8')) as { suggestions?: unknown } | null;
    const m = raw?.suggestions;
    return m === 'on' || m === 'off' ? m : 'auto';
  } catch {
    return 'auto';
  }
}

export function setSuggestionsMode(rootHash: string, mode: SuggestionsMode, opts?: BrainOptions): void {
  if (mode !== 'auto' && mode !== 'on' && mode !== 'off') throw new Error('mode must be auto, on or off');
  const cfg = loadBrainConfig(rootHash, opts);
  const file = featuresFile(rootHash, opts);
  assertBrainWritePath(file, cfg.root, opts);
  atomicWriteFileSync(file, yaml.dump({ suggestions: mode }));
}

/** Pure flag decision (exported for arithmetic tests). */
export function decideSuggestions(mode: SuggestionsMode, stats: AcceptanceStats): SuggestionsState {
  const base = { mode, paused: false, acceptance: stats.acceptance, decided: stats.decided };
  if (mode === 'on') return { ...base, enabled: true, reason: 'turned on' };
  if (mode === 'off') return { ...base, enabled: false, reason: 'turned off' };
  if (stats.decided >= MIN_DECIDED_FOR_FLAG && stats.acceptance !== null && stats.acceptance < ACCEPTANCE_THRESHOLD) {
    return { ...base, enabled: false, paused: true, reason: `acceptance ${Math.round(stats.acceptance * 100)}% is below ${ACCEPTANCE_THRESHOLD * 100}%` };
  }
  return { ...base, enabled: true, reason: stats.decided < MIN_DECIDED_FOR_FLAG ? 'still measuring' : 'acceptance healthy' };
}

export function suggestionsState(rootHash: string, opts?: BrainOptions): SuggestionsState {
  return decideSuggestions(getSuggestionsMode(rootHash, opts), acceptanceStats(rootHash, opts));
}

// ── Acceptance ───────────────────────────────────────────────────────

export interface AcceptanceStats {
  accept: number;
  reject: number;
  skip: number;
  /** accept + reject */
  decided: number;
  /** accept / (accept + reject); null when nothing decided. */
  acceptance: number | null;
}

/** Arithmetic only: latest verdict per suggestion id counts once. */
export function computeAcceptance(verdicts: VerdictRow[]): AcceptanceStats {
  const latest = new Map<string, Verdict>();
  for (const v of verdicts) latest.set(v.suggestionId, v.verdict);
  let accept = 0, reject = 0, skip = 0;
  for (const v of latest.values()) {
    if (v === 'accept') accept++;
    else if (v === 'reject') reject++;
    else skip++;
  }
  const decided = accept + reject;
  return { accept, reject, skip, decided, acceptance: decided === 0 ? null : accept / decided };
}

export function acceptanceStats(rootHash: string, opts?: BrainOptions): AcceptanceStats {
  return computeAcceptance(readSuggestionLog(rootHash, opts).verdicts);
}

// ── Batch / verdict ──────────────────────────────────────────────────

export interface SuggestBatch {
  state: SuggestionsState;
  suggestions: Suggestion[];
  /** Candidates still waiting after this batch. */
  remaining: number;
}

/** Next ≤10 suggestions (folder-level first). Logs new/changed rows. Empty when the flag is off. */
export function nextSuggestions(rootHash: string, opts?: BrainOptions & { limit?: number }): SuggestBatch {
  const state = suggestionsState(rootHash, opts);
  if (!state.enabled) return { state, suggestions: [], remaining: 0 };
  const want = Number.isFinite(opts?.limit) ? Math.floor(opts!.limit!) : MAX_BATCH;
  const limit = Math.max(1, Math.min(MAX_BATCH, want));
  const view = openBrainView(rootHash, 'owner', opts);
  const logged = readSuggestionLog(rootHash, opts);
  const candidates = generateCandidates(view, loadDeclared(rootHash, opts)).filter((s) => !suppressed(s, logged.verdicts));
  // Skipped suggestions stay in the queue, just behind everything not yet skipped.
  const open = [
    ...candidates.filter((s) => !skippedNow(s, logged.verdicts)),
    ...candidates.filter((s) => skippedNow(s, logged.verdicts)),
  ];
  const batch = open.slice(0, limit);
  const fresh = batch.filter((s) => logged.suggestions.get(s.id)?.sourceHash !== s.sourceHash);
  appendRows(rootHash, fresh, opts);
  L().info('Suggestion batch', { rootHash, batch: batch.length, logged: fresh.length, remaining: open.length - batch.length });
  const merged = batch.map((s) => (fresh.includes(s) ? s : logged.suggestions.get(s.id) ?? s));
  return { state, suggestions: merged, remaining: open.length - batch.length };
}

export class SuggestionError extends Error {
  constructor(message: string, readonly code: 'not-found' | 'stale') {
    super(message);
    this.name = 'SuggestionError';
  }
}

export interface VerdictResult {
  suggestion: Suggestion;
  verdict: Verdict;
  declared?: DeclareResult;
}

/**
 * Record a human verdict on a logged suggestion. Accept requires the
 * suggestion to be current (sourceHash unchanged) and writes declared.yaml.
 */
export function recordVerdict(rootHash: string, suggestionId: string, verdict: Verdict, opts?: BrainOptions): VerdictResult {
  if (!['accept', 'reject', 'skip'].includes(verdict)) throw new Error('verdict must be accept, reject or skip');
  const logged = readSuggestionLog(rootHash, opts);
  const s = logged.suggestions.get(suggestionId);
  if (!s) throw new SuggestionError('No such suggestion — run suggest first', 'not-found');
  let declared: DeclareResult | undefined;
  if (verdict === 'accept') {
    const current = generateCandidates(openBrainView(rootHash, 'owner', opts), loadDeclared(rootHash, opts)).find((c) => c.id === s.id);
    if (!current || current.sourceHash !== s.sourceHash) {
      throw new SuggestionError('This suggestion is out of date — the notes changed. Run suggest again.', 'stale');
    }
    declared = declareFromSuggestion(rootHash, current, opts);
  }
  appendRows(rootHash, [{ kind: 'verdict', suggestionId, verdict, at: new Date().toISOString(), sourceHash: s.sourceHash }], opts);
  L().info('Verdict recorded', { rootHash, suggestionId, verdict });
  return { suggestion: s, verdict, ...(declared ? { declared } : {}) };
}

/**
 * Logged, still-open suggestions whose sources changed (or vanished) since they
 * were made. Only open, undecided rows can be stale: an accept, or a reject
 * given on the logged row's sourceHash, closes it.
 */
export function staleSuggestions(rootHash: string, opts?: BrainOptions): Suggestion[] {
  const logged = readSuggestionLog(rootHash, opts);
  const current = new Map(generateCandidates(openBrainView(rootHash, 'owner', opts), loadDeclared(rootHash, opts)).map((c) => [c.id, c]));
  const decided = (s: Suggestion) => logged.verdicts.some((v) =>
    v.suggestionId === s.id &&
    (v.verdict === 'accept' || (v.verdict === 'reject' && (!v.sourceHash || v.sourceHash === s.sourceHash))));
  return [...logged.suggestions.values()].filter((s) => !decided(s) && current.get(s.id)?.sourceHash !== s.sourceHash);
}
