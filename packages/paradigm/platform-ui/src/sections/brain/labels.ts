/**
 * Plain-language labels for the Brain section (React-free so it unit-tests in
 * node). Non-developer audience: no symbol prefixes, no config words, no gate
 * ids — every internal term is translated here, in ONE place.
 */

const GATE_LABELS: Record<string, string> = {
  medical: 'Health records',
  financial: 'Money & taxes',
  'third-party-data': "Other people's messages",
  quarantined: 'Passwords & keys',
};

/** Human label for a locked area's kind. Unknown kinds → "Locked". */
export function lockedKindLabel(gate: string): string {
  return GATE_LABELS[gate] ?? 'Locked';
}

/** Human label for a locked area's folder (null = scattered individual files). */
export function lockedFolderLabel(folder: string | null): string {
  if (folder === null) return 'Individual files';
  if (folder === '') return 'Top folder';
  return folder;
}

export const TYPE_LABELS = { markdown: 'Notes', text: 'Text files', other: 'Other files' } as const;
export const SIZE_LABELS = { small: 'Under 10 KB', medium: '10–100 KB', large: '100 KB–1 MB', huge: 'Over 1 MB' } as const;
export const RECENCY_LABELS = {
  week: 'This week',
  month: 'This month',
  year: 'This year',
  older: 'Older',
  unknown: 'Unknown',
} as const;

export const MATCH_LABELS = { title: 'title', heading: 'heading', path: 'location', topic: 'topic' } as const;

/** "Nothing has left this Mac" or "N things shared". */
export function badgeText(nothingLeft: boolean, count: number): string {
  if (nothingLeft) return 'Nothing has left this Mac';
  return `${count} ${count === 1 ? 'thing' : 'things'} shared`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * Last-line defence for engine-authored prose (rationales, labels): strip
 * leading symbol sigils so "#lease" reads as "lease". Never throws.
 */
export function plainText(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.replace(/(^|[\s(“"'])[#^$!~](?=[A-Za-z0-9])/g, '$1');
}

export function whenText(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';
  return new Date(t).toLocaleString();
}

/**
 * Why suggestions are off. `paused` comes from the server when it knows; older
 * servers only send acceptance, so a low measured acceptance reads as paused.
 */
export function suggestionsOffCopy(s: { paused?: boolean; acceptance: number | null }): string {
  const paused = s.paused ?? (s.acceptance !== null && s.acceptance < 0.6);
  return paused
    ? 'Suggestions paused (too many dismissed). Turn back on with `paradigm brain suggestions on`.'
    : 'Suggestions are turned off for this folder. Turn back on with `paradigm brain suggestions on`.';
}
