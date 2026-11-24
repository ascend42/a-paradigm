/**
 * #doctor-explain: what `paradigm doctor --explain` prints.
 *
 * `--explain` used to narrate four check names only (.purpose, the scan index,
 * portal compliance, clarification markers). When none of those four failed it
 * printed exactly what plain `doctor` prints. It now explains every check that
 * failed, warned or is missing: what the check looks at, what it found (every
 * detail line, not the first five), and the fix; and it says so plainly when
 * there is nothing to explain.
 */

export interface ExplainableFinding {
  /** Check name as printed in the report. */
  name: string;
  status: 'ok' | 'warn' | 'error' | 'missing' | 'info' | 'advisory';
  message: string;
  details?: string[];
  fix?: string;
}

/** What each check looks at, in a sentence or two. Keyed by the printed name. */
const WHAT_IT_CHECKS: Record<string, string> = {
  // Context audit
  'stale-references':
    'Reads CLAUDE.md, AGENTS.md and .cursorrules for file paths and checks that each one exists. A bare file name is looked up at the project root, so a correct name with no directory is reported too.',
  'convention-contradictions':
    'Compares conventions stated in the instruction files with each other and with .paradigm/config.yaml.',
  'undocumented-stack':
    'Compares the dependencies in the manifest with the technologies the instruction files mention.',
  'purpose-coverage':
    'Counts source directories that a .purpose file documents: one of their own, or an ancestor that names their files or paths. Placeholder stubs do not count.',
  'orphaned-symbols':
    'Lists declared symbols with no connection to another symbol: they reference nothing and nothing references them, counting structured lists, flow steps and mentions in descriptions. `paradigm integrity` and `paradigm status` use the same definition and report the same number.',
  'stale-portal':
    "For each route in portal.yaml, looks for the route's path as a string literal in source code (a handler, a mounted router, a WebSocket path). A route with none is declared and protected on paper, with nothing behind it. Implement it or remove it from portal.yaml.",
  'instruction-vagueness':
    'Finds phrases in the instruction files that leave a rule optional ("try to", "if possible").',
  'config-schema-validation':
    'Validates .paradigm/config.yaml against the schema this version of Paradigm knows. An unrecognized key may be a typo, or a key a newer version reads.',
  'purpose-file-health':
    'Flags .purpose files that are large enough to be expensive to load and hard to keep current.',
  'always-on-budget':
    'Measures the text every agent session loads before any work starts (instruction files and skill descriptions) against the configured cap.',
  'warpline-guidance':
    'Checks that a project using Warpline carries the Warpline guidance block in its instruction files.',
  // Core checks
  'Portal compliance':
    'Compares gates the code uses with gates declared in portal.yaml and .purpose. A gate used but not declared is unaudited; `paradigm portal check` lists each one.',
  'portal.yaml':
    'Parses the root portal.yaml and reports what that one file holds. The project-wide gate count is on the "Gates" line.',
  'Lore entries':
    'Counts the entry files under .paradigm/lore/entries/ (.lore, and .yaml for entries recorded before that extension).',
  'Clarification markers':
    'Counts [NEEDS CLARIFICATION] markers left in .purpose files.',
};

const STATUS_WORD: Record<ExplainableFinding['status'], string> = {
  ok: 'ok',
  info: 'info',
  error: 'ERROR',
  missing: 'MISSING',
  warn: 'WARNING',
  advisory: 'ADVISORY',
};

/** Order findings: errors, missing, warnings, then advisories. */
const RANK: Record<ExplainableFinding['status'], number> = { error: 0, missing: 1, warn: 2, advisory: 3, info: 9, ok: 9 };

/** Findings `--explain` covers: everything that is not ok or informational. */
export function findingsToExplain(findings: ExplainableFinding[]): ExplainableFinding[] {
  return findings
    .filter((f) => f.status === 'error' || f.status === 'missing' || f.status === 'warn' || f.status === 'advisory')
    .map((f, i) => ({ f, i }))
    .sort((a, b) => RANK[a.f.status] - RANK[b.f.status] || a.i - b.i)
    .map(({ f }) => f);
}

/**
 * The lines `--explain` prints. Always returns something: when no check failed
 * or warned it says there is nothing to explain.
 */
export function explainFindings(findings: ExplainableFinding[]): string[] {
  const toExplain = findingsToExplain(findings);
  if (toExplain.length === 0) {
    return ['Nothing to explain: no check failed, warned or raised an advisory.'];
  }

  const lines: string[] = [`${toExplain.length} finding${toExplain.length === 1 ? '' : 's'} explained, most severe first.`, ''];
  for (const finding of toExplain) {
    lines.push(`[${STATUS_WORD[finding.status]}] ${finding.name}`);
    lines.push(`  Found: ${finding.message}`);
    const what = WHAT_IT_CHECKS[finding.name];
    lines.push(
      what
        ? `  What this checks: ${what}`
        : '  What this checks: no longer description is written for this check; the line above is everything doctor knows.',
    );
    if (finding.details && finding.details.length > 0) {
      lines.push(`  All ${finding.details.length} detail line${finding.details.length === 1 ? '' : 's'}:`);
      for (const detail of finding.details) lines.push(`    - ${detail}`);
    }
    if (finding.fix) lines.push(`  Fix: ${finding.fix}`);
    lines.push('');
  }
  return lines;
}
