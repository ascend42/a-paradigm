/**
 * Gap Narrator — human-readable explanations for enforcement check results.
 *
 * CLI-side copy of the narrator used in the doctor --explain command.
 * Canonical version lives in packages/paradigm-mcp/src/utils/gap-narrator.ts
 * Keep the two in sync when adding new check types.
 */

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export type CheckType =
  | 'missing-purpose'
  | 'stale-purpose'
  | 'missing-gate'
  | 'orphan-signal'
  | 'undocumented-flow'
  | 'aspect-drift'
  | 'portal-mismatch'
  | 'missing-test'
  | 'uncovered-route'
  | 'broken-reference'
  | 'missing-description'
  | 'enforcement-level-violation'
  | 'index-stale';

export interface CheckResult {
  type: CheckType;
  target?: string;
  severity?: 'blocking' | 'improvement' | 'note';
  details?: string[];
  context?: Record<string, unknown>;
}

export interface NarrationReport {
  gapCount: number;
  blocking: NarratedGap[];
  improvement: NarratedGap[];
  note: NarratedGap[];
  narrative: string;
}

export interface NarratedGap {
  type: CheckType;
  target?: string;
  narration: string;
  severity: 'blocking' | 'improvement' | 'note';
}

// ────────────────────────────────────────────────────────
// Narration Templates
// ────────────────────────────────────────────────────────

const TEMPLATES: Record<CheckType, (result: CheckResult) => string> = {
  'missing-purpose': (r) => {
    const target = r.target ? `"${r.target}"` : 'a directory';
    return (
      `${target} is missing a .purpose file. Without it, agents cannot discover what this directory contains or ` +
      `which components live here. The stop hook will block if source files were modified in a directory with no .purpose. ` +
      `Fix: run paradigm_purpose_init for this directory, then add components with paradigm_purpose_add_component.`
    );
  },

  'stale-purpose': (r) => {
    const target = r.target ? `"${r.target}"` : 'a .purpose file';
    const age = r.context?.ageHours != null ? ` (${r.context.ageHours}h old)` : '';
    return (
      `The .purpose file at ${target}${age} has not been updated since the last code change in its directory. ` +
      `Stale purposes mislead agents about what components exist, causing incorrect context injection. ` +
      `Fix: update the .purpose to reflect any added, removed, or changed components, then run paradigm_reindex.`
    );
  },

  'missing-gate': (r) => {
    const target = r.target ? `"${r.target}"` : 'a route or endpoint';
    return (
      `${target} appears to require authentication or authorization but has no gate declared in portal.yaml. ` +
      `Gates are how Paradigm tracks security enforcement — missing gates mean agents cannot verify that ` +
      `the route is protected. Fix: add the gate to portal.yaml using paradigm_portal_add_route or ` +
      `paradigm_purpose_add_component with the appropriate gates array.`
    );
  },

  'orphan-signal': (r) => {
    const target = r.target ? `"${r.target}"` : 'a signal';
    return (
      `${target} is emitted in code but not declared in any .purpose file. Undeclared signals cannot ` +
      `be traced by agents during ripple analysis, meaning downstream effects may be missed when the ` +
      `signal's emitter changes. Fix: add the signal to the nearest .purpose file under its component's ` +
      `signals array (e.g., signals: ["!${r.target || 'event-name'}"]). `
    );
  },

  'undocumented-flow': (r) => {
    const target = r.target ? `"${r.target}"` : 'a multi-step flow';
    return (
      `${target} spans multiple components but has no $flow declaration. Flows with 3 or more steps ` +
      `should be documented so agents can reason about the sequence end-to-end. Without a flow record, ` +
      `agents may implement duplicate logic or miss ordering constraints. ` +
      `Fix: add a flow entry to .paradigm/flows.yaml with the steps and participants.`
    );
  },

  'aspect-drift': (r) => {
    const target = r.target ? `"${r.target}"` : 'an aspect anchor';
    return (
      `${target} has drifted — the code at the anchored location no longer matches the fingerprint ` +
      `recorded when the aspect was first applied. This means the aspect may no longer be enforced correctly ` +
      `at that site. Drift is common after refactors that move or rewrite anchored code. ` +
      `Fix: re-anchor the aspect at its new location using paradigm_aspect_anchor, then delete the stale anchor.`
    );
  },

  'portal-mismatch': (r) => {
    const target = r.target ? `"${r.target}"` : 'a portal.yaml entry';
    return (
      `${target} has a mismatch between what portal.yaml declares and what the code enforces. ` +
      `This could mean a gate is declared but never applied in middleware, or code enforces a check ` +
      `that is not tracked in portal.yaml. Both directions create audit gaps. ` +
      `Fix: reconcile portal.yaml with actual middleware usage — run paradigm portal check to see specifics.`
    );
  },

  'missing-test': (r) => {
    const target = r.target ? `"${r.target}"` : 'a component';
    return (
      `${target} has no associated test file. Agents are expected to write tests alongside every ` +
      `implementation. Missing tests increase regression risk and reduce confidence scores for the ` +
      `affected component. Fix: create a test file alongside the implementation ` +
      `(e.g., ${r.target ? r.target.replace(/\.[^.]+$/, '.test$&') : 'component.test.ts'}).`
    );
  },

  'uncovered-route': (r) => {
    const target = r.target ? `"${r.target}"` : 'a route';
    return (
      `${target} appears in the codebase but is not listed in portal.yaml. All routes — protected ` +
      `or public — should be tracked in portal.yaml so the full API surface is visible to agents ` +
      `and reviewers. Uncovered routes are invisible to ripple analysis and gate audits. ` +
      `Fix: add the route to portal.yaml with paradigm_portal_add_route.`
    );
  },

  'broken-reference': (r) => {
    const target = r.target ? `"${r.target}"` : 'a symbol reference';
    return (
      `${target} references a symbol or file that no longer exists. Broken references in .purpose ` +
      `files cause agents to load stale context and may indicate a renamed or deleted component. ` +
      `Fix: update the reference to the new symbol name, or remove it if the component was deleted. ` +
      `Run paradigm_reindex after fixing to regenerate the scan index.`
    );
  },

  'missing-description': (r) => {
    const target = r.target ? `"${r.target}"` : 'a component or gate';
    return (
      `${target} has no description. Descriptions are required for agents to understand purpose and ` +
      `context during context injection. Without descriptions, agents may misapply the component or ` +
      `skip it when it would have been relevant. Fix: add a description field to the component ` +
      `or gate entry in its .purpose or portal.yaml file.`
    );
  },

  'enforcement-level-violation': (r) => {
    const target = r.target ? `"${r.target}"` : 'a data category';
    const ring = r.context?.ring as string | undefined;
    const boundary = r.context?.boundary as string | undefined;
    return (
      `${target} is being transmitted across a boundary (${boundary || 'unknown boundary'}) that exceeds ` +
      `its trust ring${ring ? ` (Ring: ${ring})` : ''}. Data policy requires project-locked content to ` +
      `never leave the project boundary. This gap could expose internal compliance data externally. ` +
      `Fix: check the data-policy.yaml configuration and ensure the content category is listed in the ` +
      `deny_content for the relevant stream.`
    );
  },

  'index-stale': (r) => {
    const target = r.target ? `"${r.target}"` : 'the scan index';
    const ageHours = r.context?.ageHours as number | undefined;
    const ageText = ageHours != null ? ` (${ageHours} hours old)` : '';
    return (
      `${target}${ageText} is stale. The scan index drives context injection, navigator, and ripple analysis. ` +
      `When the index is out of date, agents work from stale symbol maps and may miss recently added ` +
      `components or references. Fix: run paradigm_reindex (or "paradigm index") to regenerate the index.`
    );
  },
};

// ────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────

export function narrateGap(checkType: CheckType, checkResult: CheckResult): string {
  const template = TEMPLATES[checkType];
  if (!template) {
    return `Unknown check type "${checkType}" — no narration template available.`;
  }
  return template({ ...checkResult, type: checkType });
}

export function narrateAllGaps(checkResults: CheckResult[]): NarrationReport {
  const blocking: NarratedGap[] = [];
  const improvement: NarratedGap[] = [];
  const note: NarratedGap[] = [];

  for (const result of checkResults) {
    const narration = narrateGap(result.type, result);
    const severity = result.severity ?? 'improvement';
    const gap: NarratedGap = {
      type: result.type,
      target: result.target,
      narration,
      severity,
    };

    if (severity === 'blocking') {
      blocking.push(gap);
    } else if (severity === 'note') {
      note.push(gap);
    } else {
      improvement.push(gap);
    }
  }

  const gapCount = blocking.length + improvement.length + note.length;
  const narrative = buildNarrativeText(blocking, improvement, note);

  return { gapCount, blocking, improvement, note, narrative };
}

// ────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────

function buildNarrativeText(
  blocking: NarratedGap[],
  improvement: NarratedGap[],
  note: NarratedGap[],
): string {
  const lines: string[] = [];
  const total = blocking.length + improvement.length + note.length;

  if (total === 0) {
    return 'No gaps found. All enforcement checks passed.';
  }

  const typeCount = countTypes(blocking, improvement, note);
  lines.push(`Found ${total} gap${total !== 1 ? 's' : ''} across ${typeCount} check type${typeCount !== 1 ? 's' : ''}.`);
  lines.push('');

  if (blocking.length > 0) {
    lines.push(`BLOCKING (${blocking.length})`);
    lines.push('─────────');
    for (const gap of blocking) {
      lines.push(`[${gap.type}]${gap.target ? ` — ${gap.target}` : ''}`);
      lines.push(gap.narration);
      lines.push('');
    }
  }

  if (improvement.length > 0) {
    lines.push(`IMPROVEMENTS (${improvement.length})`);
    lines.push('─────────────');
    for (const gap of improvement) {
      lines.push(`[${gap.type}]${gap.target ? ` — ${gap.target}` : ''}`);
      lines.push(gap.narration);
      lines.push('');
    }
  }

  if (note.length > 0) {
    lines.push(`NOTES (${note.length})`);
    lines.push('──────');
    for (const gap of note) {
      lines.push(`[${gap.type}]${gap.target ? ` — ${gap.target}` : ''}`);
      lines.push(gap.narration);
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
}

function countTypes(
  blocking: NarratedGap[],
  improvement: NarratedGap[],
  note: NarratedGap[],
): number {
  const seen = new Set<CheckType>();
  for (const g of [...blocking, ...improvement, ...note]) seen.add(g.type);
  return seen.size;
}
