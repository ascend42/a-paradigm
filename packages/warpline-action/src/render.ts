/**
 * #guard-render — GuardReport → GitHub job-summary markdown + terse log lines.
 * Pure string building; no I/O. Wording discipline (TD-2026-07-16-810): every
 * claim scoped, the scope line on every render, ripple always folded to a
 * count, direct-contested symbols listed first and only within the validated
 * knot-size stratum.
 */

import type { GuardFlag, GuardReport } from './report.js';

function short(sha: string): string {
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, 8) : sha;
}

function headline(r: GuardReport): string {
  switch (r.verdict) {
    case 'clean':
      return 'CLEAN — no contested-symbol knots found';
    case 'ripple-only':
      return `QUIET — ${r.flagCount} ripple-only flag(s), zero direct-contested symbols`;
    case 'flagged':
      return `FLAGGED — ${r.knotSize} direct-contested symbol(s) in a merge git completes clean`;
    case 'avalanche':
      return `AVALANCHE — ${r.knotSize} direct-contested symbols exceed the threshold (${r.threshold}); folded, not listed`;
    case 'git-conflict':
      return 'GIT CONFLICT — git itself blocks this merge; Warpline defers';
  }
}

function verdictNote(r: GuardReport): string {
  switch (r.verdict) {
    case 'clean':
      return 'Meaning and bytes agree: nothing contested.';
    case 'ripple-only':
      return (
        `Every flag is ripple-only (essence transitivity — a dependency's meaning shifted), ` +
        `none is a symbol both branches edited. Folded to a count by design.`
      );
    case 'flagged':
      return (
        `Git merges this without conflict; both branches contested the meaning of the ` +
        `symbol(s) below. Knot size ${r.knotSize} ≤ ${r.threshold} — inside the stratum that was ` +
        `50% churn-validated on ground-truthed real merges.`
      );
    case 'avalanche':
      return (
        `Flag sets this large were 0% churn-validated in ground truth (they are essence-` +
        `transitivity avalanches, typically off ~2 genuinely contested units), so Guard does ` +
        `not list them. Lower \`threshold\` is not the fix; this stratum is noise by evidence.`
      );
    case 'git-conflict':
      return (
        `GitHub already refuses to merge a conflicted PR — no advisory needed. ` +
        `${r.gitReality.conflictPaths.length} conflicted path(s).`
      );
  }
}

function touchCell(f: GuardFlag, side: 'A' | 'B'): string {
  return f.touchedBy[side] ? 'touched' : '—';
}

function flagDetail(f: GuardFlag): string {
  if (f.kind === 'dangling' && f.dangling) {
    return `dangling ${f.dangling.edgeKind} → \`${f.dangling.targetSymbol}\` (retired by ${f.dangling.retiredBy})`;
  }
  return f.conflictingSlots.length ? f.conflictingSlots.join(', ') : '—';
}

/** The GitHub job-summary markdown (written to GITHUB_STEP_SUMMARY). */
export function renderSummary(r: GuardReport): string {
  const lines: string[] = [];
  lines.push('## Warpline Guard — merge adjudication');
  lines.push('');
  const advisory = r.failOnFlag ? '' : ' (advisory — this check never blocks)';
  lines.push(`**${headline(r)}**${advisory}`);
  lines.push('');
  lines.push(
    `base \`${r.base.ref}\` × head \`${r.head.ref}\` — merge-base \`${short(r.mergeBase)}\``,
  );
  lines.push('');
  lines.push(verdictNote(r));
  lines.push('');

  if (r.flags.length > 0) {
    lines.push('| contested symbol | file | kind | contested slots / dangle | base×base-branch | base×head |');
    lines.push('|---|---|---|---|---|---|');
    for (const f of r.flags) {
      lines.push(
        `| \`${f.symbol}\` | ${f.file ? `\`${f.file}\`` : '—'} | ${f.kind} | ` +
          `${flagDetail(f)} | ${touchCell(f, 'A')} | ${touchCell(f, 'B')} |`,
      );
    }
    lines.push('');
  }

  if (r.filteredOutCount > 0) {
    lines.push(
      `${r.filteredOutCount} direct-contested symbol(s) fall outside the configured ` +
        `\`paths\` filter — counted above, not listed.`,
    );
    lines.push('');
  }

  if (r.rippleCount > 0 && r.verdict !== 'git-conflict') {
    lines.push(
      `Ripple (folded): ${r.rippleCount} symbol(s) flagged only via essence transitivity — ` +
        `a dependency's meaning changed, not the symbol's own text. Not listed by design.`,
    );
    lines.push('');
  }

  lines.push('| branch | ref | tip intent | touched symbols |');
  lines.push('|---|---|---|---|');
  lines.push(`| base | \`${r.base.ref}\` | ${r.base.intent || '—'} | ${r.base.touchedSymbols} |`);
  lines.push(`| head | \`${r.head.ref}\` | ${r.head.intent || '—'} | ${r.head.touchedSymbols} |`);
  lines.push('');
  lines.push(`_${r.scopeLine}_`);
  lines.push('');
  return lines.join('\n');
}

/** Terse stdout lines for the action log. */
export function renderLog(r: GuardReport): string[] {
  const out: string[] = [];
  out.push('Warpline Guard — deterministic merge adjudication');
  out.push(`  base ${r.base.ref} × head ${r.head.ref}  (merge-base ${short(r.mergeBase)})`);
  out.push(`  verdict: ${headline(r)}`);
  if (r.verdict !== 'git-conflict') {
    out.push(
      `  flags: ${r.flagCount} total — ${r.knotSize} direct-contested, ${r.rippleCount} ripple (folded)` +
        (r.filteredOutCount ? `, ${r.filteredOutCount} outside paths filter` : ''),
    );
  }
  for (const f of r.flags) {
    out.push(`    ${f.symbol}  [${f.kind}] ${flagDetail(f)}  base:${touchCell(f, 'A')} head:${touchCell(f, 'B')}`);
  }
  out.push(`  ${r.scopeLine}`);
  return out;
}
