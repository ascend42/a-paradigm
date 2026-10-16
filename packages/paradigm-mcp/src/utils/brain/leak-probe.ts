/**
 * #brain-leak-probe — reusable leak-probe harness (engine tests + Builder B's
 * MCP handler / Platform route tests).
 *
 *   const corpus = createLeakProbeCorpus(root);        // writes a sentinel corpus
 *   // … initBrain(root) + scanBrain + share 'Public/**' (corpus.shareGlob) …
 *   for (const q of leakProbeQueries(corpus, fileIds)) { output = handler(q); }
 *   expect(findLeaks(output, corpus.forbiddenFor('agent'))).toEqual([]);
 *
 * Sentinels:
 *   BRAIN-GATED-SENTINEL-n  — sensitive files (medical / financial / quarantined /
 *                             third-party): forbidden for BOTH audiences.
 *   BRAIN-PRIVATE-SENTINEL-n — default-private files: forbidden for agents only.
 * Folder names that become owner-visible zone labels (Health, Taxes, Chats)
 * carry no sentinel; nested folders/files inside them do.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Audience } from './types.js';

export const GATED_SENTINEL = 'BRAIN-GATED-SENTINEL';
export const PRIVATE_SENTINEL = 'BRAIN-PRIVATE-SENTINEL';

export interface LeakProbeCorpus {
  root: string;
  /** Glob to pass to addShare so Public/** is 'open'. */
  shareGlob: string;
  gatedSentinels: string[];
  privateSentinels: string[];
  /** Root-relative paths that are sensitive (hidden from everyone). */
  gatedRelpaths: string[];
  /** Root-relative paths that are private (hidden from agents). */
  privateRelpaths: string[];
  /** Strings that must never appear in output for this audience. */
  forbiddenFor(audience: Audience): string[];
}

function write(root: string, rel: string, text: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

/** Assemble a key shape at runtime so the repo never contains token-shaped literals. */
export function fakeAwsKey(): string {
  return ['AK', 'IA', 'Z7Q2', 'X9R4', 'M1N8', 'P3K5'].join('');
}

export function createLeakProbeCorpus(root: string): LeakProbeCorpus {
  const G = (n: number) => `${GATED_SENTINEL}-${n}`;
  const P = (n: number) => `${PRIVATE_SENTINEL}-${n}`;
  const gatedRelpaths: string[] = [];
  const privateRelpaths: string[] = [];
  const gated = (rel: string, text: string) => { write(root, rel, text); gatedRelpaths.push(rel); };
  const priv = (rel: string, text: string) => { write(root, rel, text); privateRelpaths.push(rel); };

  // Open (shared) files — link INTO gated files; links must render '[private]'.
  write(root, 'Public/Welcome.md', `---\ntitle: Welcome\ntags: [home]\nrelates: ['a-paradigm/#skill-loader']\n---\n# Welcome\n\nSee [[${G(1)} checkup]] and [[${P(1)} journal]] and [labs](../Health/${G(2)}/${G(3)}%20labs.md).\n## Index\n[[Lease]]\n`);
  write(root, 'Public/Lease.md', `# Lease\n\nRent is due monthly. [[Welcome]]\n`);
  write(root, 'Public/Recipes.md', `---\ntags: [cooking]\n---\n# Recipes\n## Pasta\n`);

  // Medical zone (name-based: Health/**)
  gated(`Health/${G(1)} checkup.md`, `---\ntitle: ${G(4)} title\ntags: [${G(5)}]\nrelates: ['a-paradigm/#${G(6)}']\n---\n# ${G(7)} heading\n## ${G(8)} sub\n[[Welcome]]\n`);
  gated(`Health/${G(2)}/${G(3)} labs.md`, `# ${G(9)}\n`);
  // Financial zone (Taxes/**)
  gated(`Taxes/${G(10)} 2024.md`, `# ${G(11)} return\n`);
  gated(`Taxes/${G(12)}/receipt.txt`, `${G(13)} receipt\n`);
  // Quarantined by detector (file-level) in an otherwise private folder
  gated(`Notes/${G(14)} keys.md`, `# ${G(15)} heading\naws = ${fakeAwsKey()}\n`);
  // Third-party chat export (Slack shape) — folder 'Chats' becomes the zone label
  gated(`Chats/${G(16)} export.json`, JSON.stringify([{ type: 'message', user: 'U024BE7LH', text: `${G(17)} hi`, ts: '1355517523.000005' }]));
  // Private (default-deny) — owner sees, agent must not
  priv(`Notes/${P(1)} journal.md`, `---\ntitle: ${P(2)} title\n---\n# ${P(3)} heading\n[[Welcome]]\n`);
  priv(`${P(4)}/plan.md`, `# ${P(5)} plan\n`);

  const gatedSentinels = Array.from({ length: 17 }, (_, i) => G(i + 1));
  const privateSentinels = Array.from({ length: 5 }, (_, i) => P(i + 1));
  return {
    root,
    shareGlob: 'Public/**',
    gatedSentinels,
    privateSentinels,
    gatedRelpaths,
    privateRelpaths,
    forbiddenFor(audience: Audience): string[] {
      const base = [GATED_SENTINEL, ...gatedRelpaths];
      return audience === 'agent' ? [...base, PRIVATE_SENTINEL, ...privateRelpaths] : base;
    },
  };
}

/**
 * ≥100 probe queries: sentinel tokens + case variants, traversal, globs, empty,
 * regex metachars, enumerated file ids, stale/relates lookups.
 */
export function leakProbeQueries(corpus: Pick<LeakProbeCorpus, 'gatedSentinels' | 'privateSentinels' | 'gatedRelpaths' | 'privateRelpaths'>, fileIds: string[] = []): string[] {
  const q: string[] = [];
  for (const s of [...corpus.gatedSentinels, ...corpus.privateSentinels]) {
    q.push(s, s.toLowerCase(), s.replace(/-/g, ' '), s.slice(0, -2));
  }
  q.push(GATED_SENTINEL, PRIVATE_SENTINEL, 'sentinel', 'SENTINEL', 'SeNtInEl', 'gated', 'brain-');
  q.push('../', '../../', '../../etc/passwd', '/etc/passwd', '..\\..', '%2e%2e%2f', '*', '**', '**/*', '?', '');
  q.push(' ', '\t', '.*', '.', '(', ')', '[', ']', '{', '}', '\\', '$', '^', '|', '+', '(?:x)', '[^]*', 'a{1,99999}');
  q.push('Health', 'health', 'Taxes', 'Chats', 'Notes', 'checkup', 'labs', 'receipt', 'keys', 'journal', 'plan', 'export');
  q.push('a-paradigm/#skill-loader', '#skill-loader', 'relates', 'stale', '[private]', 'private', 'quarantined', 'medical', 'financial');
  for (const r of [...corpus.gatedRelpaths, ...corpus.privateRelpaths]) q.push(r, path.posix.basename(r));
  q.push('f_', 'f_0', 'F_');
  q.push(...fileIds);
  return q;
}

/** Returns every forbidden string found (case-insensitive) in JSON.stringify(output). */
export function findLeaks(output: unknown, forbidden: string[]): string[] {
  let s: string;
  try { s = JSON.stringify(output) ?? ''; } catch { s = String(output); }
  const hay = s.toLowerCase();
  const out: string[] = [];
  for (const f of forbidden) {
    if (!f) continue;
    const needle = f.toLowerCase();
    if (hay.includes(needle) || hay.includes(JSON.stringify(needle).slice(1, -1))) out.push(f);
  }
  return out;
}
