/**
 * #teach-home — where a taught lesson lives (scoped learning S3,
 * TD-2026-10-28-820). Pure functions; the journal_record tool and the
 * /paradigm:teach skill call them.
 *
 * The human's own words NAME the home (home_source: explicit):
 *   repo  "for this repo", "in this project" (and repository / codebase);
 *   user  "for me", "everywhere", "every project", "all my projects".
 * Bare "here" and "always" are not location words ("here's the rule";
 * "always" is frequency) and are ignored.
 * A repo symbol (#x, $x, ^x, !x, ~x) or a repo path only POINTS to repo
 * (home_source: inferred). In a public repository (learning.visibility unset
 * or public) an inferred repo home is not recorded: teach asks ONE question,
 * TEACH_HOME_QUESTION, so the human is never surprised at commit time. Words
 * on both sides, or no signal at all, also ask.
 *
 * The commit guard refuses an inferred human-taught entry in a public
 * repository; after this, only entries that never went through teach reach it.
 */

import type { HomeSource, LearningHome } from '../types/knowledge-streams.js';

export type { HomeSource } from '../types/knowledge-streams.js';

/** The one question teach asks when the wording does not settle the home. */
export const TEACH_HOME_QUESTION = 'This repo or just you?';

const REPO_WORDING: Array<[RegExp, string]> = [
  [/\bfor this (?:repo|repository|project|codebase)\b/i, 'for this repo'],
  [/\bin this (?:repo|repository|project|codebase)\b/i, 'in this project'],
];

const USER_WORDING: Array<[RegExp, string]> = [
  [/\bfor me\b/i, 'for me'],
  [/\beverywhere\b/i, 'everywhere'],
  [/\b(?:every|all (?:my )?|across) (?:repos?|repositories|projects?)\b/i, 'every project'],
];

/** A repo symbol: one of # $ ^ ! ~ then a kebab-case id. */
const SYMBOL = /(?:^|[\s(`'"])([#$^!~][a-z][a-z0-9-]*)/;
/** A repo path: a slash-separated path with a known top folder, or a file with a source extension. */
const REPO_PATH = /(?:^|[\s(`'"])((?:\.paradigm|packages|apps|src|lib|plugins|docs|tests?|scripts)\/[\w./-]+|[\w-]+\/[\w./-]*\.(?:ts|tsx|js|jsx|mjs|py|rs|go|sh|ya?ml|json|md))/;

export interface TeachHomeInference {
  /** The settled home, or null when the caller must ask. */
  home: Extract<LearningHome, 'repo' | 'user'> | null;
  /** explicit when the human's words named the home; inferred from symbols or paths alone. */
  source: HomeSource;
  /** What pointed to repo. */
  repoSignals: string[];
  /** What pointed to user. */
  userSignals: string[];
}

/**
 * Infer a lesson's home from the human's words. Location words on one side
 * name it (explicit); symbols or paths alone point to repo (inferred); words
 * on both sides, or nothing, give null. Never throws.
 */
export function inferTeachHome(text: string): TeachHomeInference {
  const t = text ?? '';
  const repoWords: string[] = [];
  const userSignals: string[] = [];
  for (const [re, label] of REPO_WORDING) if (re.test(t)) repoWords.push(label);
  for (const [re, label] of USER_WORDING) if (re.test(t)) userSignals.push(label);
  const pointers: string[] = [];
  const sym = SYMBOL.exec(t);
  if (sym) pointers.push(`names ${sym[1]}`);
  const p = REPO_PATH.exec(t);
  if (p) pointers.push(`names ${p[1]}`);
  const repoSignals = [...repoWords, ...pointers];
  if (repoWords.length > 0 && userSignals.length === 0) return { home: 'repo', source: 'explicit', repoSignals, userSignals };
  if (userSignals.length > 0 && repoWords.length === 0) return { home: 'user', source: 'explicit', repoSignals, userSignals };
  if (repoWords.length === 0 && userSignals.length === 0 && pointers.length > 0) {
    return { home: 'repo', source: 'inferred', repoSignals, userSignals };
  }
  return { home: null, source: 'inferred', repoSignals, userSignals };
}

export function isHomeSource(v: unknown): v is HomeSource {
  return v === 'explicit' || v === 'inferred';
}

export interface JournalHomeInput {
  /** The home the caller passed, if any. */
  home?: unknown;
  /** explicit | inferred, if the caller said. */
  home_source?: unknown;
  /** The human's own words (teach). When present and no home is given, the home is inferred from them. */
  taught_text?: unknown;
  /** learning.visibility; unset counts as public. A public repo asks instead of inferring repo. */
  visibility?: 'public' | 'private';
}

export type JournalHomeResolution =
  | { home?: LearningHome; home_source: HomeSource }
  | { ask: string; inference: TeachHomeInference };

/**
 * The home and home_source a new journal entry is recorded with.
 *   - a valid `home`: kept; home_source as given, else explicit (the caller chose it);
 *   - else `taught_text`: location words name the home (explicit); symbols or
 *     paths alone infer repo, which in a public repo becomes `{ ask }`; when
 *     the words do not settle it, `{ ask }` (record nothing, ask once);
 *   - else no home (promotionHomeOf derives it from transferable) and inferred.
 */
export function resolveJournalHome(input: JournalHomeInput): JournalHomeResolution {
  const h = input.home;
  if (h === 'repo' || h === 'user' || h === 'machine') {
    return { home: h, home_source: isHomeSource(input.home_source) ? input.home_source : 'explicit' };
  }
  if (typeof input.taught_text === 'string' && input.taught_text.trim()) {
    const inference = inferTeachHome(input.taught_text);
    if (inference.home === null) return { ask: TEACH_HOME_QUESTION, inference };
    // No surprise at commit time: an inferred repo home in a public repo asks now.
    if (inference.source === 'inferred' && inference.home === 'repo' && (input.visibility ?? 'public') === 'public') {
      return { ask: TEACH_HOME_QUESTION, inference };
    }
    return { home: inference.home, home_source: inference.source };
  }
  return { home_source: 'inferred' };
}

/** The confirmation line teach always shows: it names the home picked and how. */
export function teachConfirmationLine(agent: string, home: LearningHome, homeSource: HomeSource): string {
  const where = home === 'repo' ? 'repo (committed, shared with the team)' : home === 'user' ? 'user (just you, every project)' : 'machine (this computer only)';
  const how = homeSource === 'explicit' ? 'you chose it' : 'inferred from your wording; say "just me" or "this repo" to flip it';
  return `Taught ${agent}. Home: ${where}. ${how}.`;
}
