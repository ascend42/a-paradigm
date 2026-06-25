/**
 * #lifeline — meaning-aware blame. Trace a symbol's ESSENCE through the commits
 * that touched its file: who changed its MEANING, when, and with what intent — the
 * accountability-native answer git blame can't give. git blame resets on a rename;
 * lifeline follows the file across renames (`git log --follow`) and tracks the symbol
 * by its qualified name, so the thread survives the move.
 *
 * Each event is attributed to the commit that INTRODUCED that essence (the oldest
 * commit carrying it), newest-first. Read-only; absorbs up to `maxCommits` of the
 * file's history in PARALLEL (concurrency-safe per T-2026-06-23-003).
 *
 * BOUNDED MVP: tracks one symbol by its `::qualified` suffix (rename-stable across
 * file moves; a same-suffix collision in another file is a known limitation).
 *
 * Library code: no console output (the CLI prints).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { absorb } from './absorb.js';
import type { WarpState } from './warp/warp-state.js';
import type { WarpObject } from './warp/warp-object.js';
import type { GitOptions } from './git/git-exec.js';

const execFileAsync = promisify(execFile);

export interface LifelineEvent {
  /** short commit sha that introduced this essence */
  commit: string;
  /** committer/author ISO date */
  date: string;
  author: string;
  /** the commit subject — the human INTENT, git blame's missing column */
  intent: string;
  /** the symbol's essence (contentId) after this commit */
  contentId: string;
  /** the symbol's name at this commit (differs ⇒ a rename the thread survived) */
  symbol: string;
  /** the file path at this commit (differs ⇒ a move the thread survived) */
  filePath: string;
  kind: 'born' | 'essence-changed';
}

export interface Lifeline {
  query: string;
  /** resolved current symbol name */
  symbol: string;
  stableKey: string;
  filePath: string;
  /** essence-change events, NEWEST first */
  events: LifelineEvent[];
  /** true if the file's history was capped at maxCommits (earliest may be partial) */
  truncated: boolean;
}

export interface LifelineOptions extends GitOptions {
  /** max file-touching commits to scan (default 25). */
  maxCommits?: number;
}

/** The rename-stable tracking key: a code-unit's `::qualified` suffix, else the name. */
function matchKey(symbol: string): string {
  const m = symbol.match(/::(.+)$/);
  return m ? m[1] : symbol;
}

function findByName(state: WarpState, name: string): WarpObject | undefined {
  for (const o of state.objects.values()) if (o.symbol === name) return o;
  return undefined;
}

function findByKey(state: WarpState, key: string): WarpObject | undefined {
  for (const o of state.objects.values()) if (matchKey(o.symbol) === key) return o;
  return undefined;
}

export async function lifeline(query: string, opts: LifelineOptions = {}): Promise<Lifeline> {
  const cwd = opts.cwd ?? process.cwd();
  const max = opts.maxCommits ?? 25;

  // 1. resolve the symbol at HEAD → its file + tracking key.
  const head = await absorb('HEAD', { cwd });
  const target = findByName(head, query);
  if (!target) {
    throw new Error(`symbol not found at HEAD: ${query}`);
  }
  if (!target.filePath) {
    throw new Error(`symbol has no file to trace: ${query}`);
  }
  const key = matchKey(target.symbol);
  // filePath in a WarpState is repo-relative (buildWarpState normalizes it).
  const file = target.filePath;

  // 2. commits that touched the file, following renames, bounded.
  const out = await git(
    ['log', '--follow', `--max-count=${max + 1}`, '--format=%H%x1f%an%x1f%aI%x1f%s', '--', file],
    cwd,
  );
  const commits = out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, author, date, subject] = l.split('\x1f');
      return { sha, author, date, subject };
    });
  const truncated = commits.length > max;
  const window = commits.slice(0, max);

  // 3. absorb each commit in parallel; read the symbol's essence (null if absent).
  const states = await Promise.all(window.map((c) => absorb(c.sha, { cwd }).catch(() => null)));
  const objs = states.map((st) => (st ? findByKey(st, key) : undefined));

  // 4. emit, NEWEST→oldest, each essence attributed to the commit that INTRODUCED it
  //    (the oldest commit carrying it: emit when the next-OLDER essence differs, is
  //    absent ⇒ born, or is the window edge).
  const events: LifelineEvent[] = [];
  for (let i = 0; i < window.length; i++) {
    const cur = objs[i];
    if (!cur) continue; // symbol absent at this commit
    const olderObj = i + 1 < window.length ? objs[i + 1] : undefined;
    const olderEssence =
      i + 1 < window.length ? (olderObj ? olderObj.contentId : null) : 'EDGE';

    let emit = false;
    let kind: LifelineEvent['kind'] = 'essence-changed';
    if (olderEssence === null) {
      emit = true;
      kind = 'born'; // didn't exist in the next-older commit
    } else if (olderEssence === 'EDGE') {
      emit = true; // window edge — earliest known state in scope
    } else if (cur.contentId !== olderEssence) {
      emit = true; // essence changed at this commit
    }

    if (emit) {
      events.push({
        commit: window[i].sha.slice(0, 8),
        date: window[i].date,
        author: window[i].author,
        intent: window[i].subject,
        contentId: cur.contentId,
        symbol: cur.symbol,
        filePath: cur.filePath ?? file,
        kind,
      });
    }
  }

  return {
    query,
    symbol: target.symbol,
    stableKey: target.stableKey,
    filePath: file,
    events,
    truncated,
  };
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  return stdout.trim();
}
