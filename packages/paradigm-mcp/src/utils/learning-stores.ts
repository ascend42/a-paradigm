/**
 * Learning-Stores Registry (7.12.0, D5) — a READ-ONLY facade over every place
 * Paradigm (and the host) keeps learned material. NOT a rewrite: each store
 * keeps its own loader, format and lifecycle; this module only names them,
 * classifies them, and counts them (doctor census, `paradigm migrate
 * learning-stores`).
 *
 * Store classes:
 *   ledger    — append-only record of what happened (never pruned or merged:
 *               lore, work-log, history, raw agent journals)
 *   knowledge — distilled, retrievable beliefs (decisions, antipatterns,
 *               notebooks, protocols, skills, preferences)
 *   pipeline  — the loop's moving parts + its falsifiability instruments
 *               (event stream, nominations, debates, promotion-decisions,
 *               classroom-certifications, notebook-refs, liveness probes)
 *   policy    — enforcement config, not learning (habits = hook policy, D3)
 *   native    — host-owned memory (Claude Code auto-memory); registered
 *               read-only, NEVER migrated
 *
 * Loid's must-NOT-consolidate list is encoded by keeping each of these as its
 * own row: journals ≠ notebooks, classroom-certifications / notebook-refs /
 * promotion-decisions stay separate append-only instruments, decisions ≠ antipatterns.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type StoreClass = 'ledger' | 'knowledge' | 'pipeline' | 'policy' | 'native';

export interface LearningStore {
  id: string;
  class: StoreClass;
  /** Absolute path of the store (file or directory). May not exist. */
  path: string;
  scope: 'project' | 'global';
  /** Owning component symbol. */
  owner: string;
  /** Number of records (jsonl rows / files / yaml list items). 0 when absent. Never throws. */
  count(): number;
}

export interface LearningStoreOptions {
  /** Override the home directory (tests). Defaults to os.homedir(). */
  homeDir?: string;
}

// ── Counters (all best-effort; never throw) ──

function countJsonl(file: string): number {
  try {
    if (!fs.existsSync(file)) return 0;
    return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).length;
  } catch {
    return 0;
  }
}

/** Count files matching `match` under `dir`, optionally recursing. */
function countFiles(dir: string, match: (name: string) => boolean, recursive = false): number {
  try {
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (recursive) n += countFiles(path.join(dir, ent.name), match, true);
      } else if (match(ent.name)) {
        n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

/** Count immediate subdirectories of `dir` that contain `marker`. */
function countDirsWith(dir: string, marker: string): number {
  try {
    if (!fs.existsSync(dir)) return 0;
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, marker))).length;
  } catch {
    return 0;
  }
}

/** Count `- ` list items under a top-level key in a yaml file (cheap, no parse). */
function countYamlListItems(file: string, key: string): number {
  try {
    if (!fs.existsSync(file)) return 0;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let inKey = false;
    let n = 0;
    for (const line of lines) {
      if (/^\S/.test(line)) inKey = line.startsWith(`${key}:`);
      else if (inKey && /^ {0,2}- /.test(line)) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Count journal yaml files across every agent under ~/.paradigm/agents/<id>/journal. */
function countJournals(agentsDir: string): number {
  try {
    if (!fs.existsSync(agentsDir)) return 0;
    let n = 0;
    for (const ent of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      n += countFiles(path.join(agentsDir, ent.name, 'journal'), f => f.endsWith('.yaml'));
    }
    return n;
  } catch {
    return 0;
  }
}

const isYaml = (f: string) => f.endsWith('.yaml') || f.endsWith('.yml');

/** Claude Code's project slug: absolute path with every `/` (and `.`) → `-`. */
export function nativeMemorySlug(rootDir: string): string {
  return path.resolve(rootDir).replace(/[/.]/g, '-');
}

/**
 * Enumerate every learning store for a project (plus the global stores it
 * reads). Pure enumeration — paths are computed, nothing is created.
 */
export function listLearningStores(rootDir: string, opts: LearningStoreOptions = {}): LearningStore[] {
  const root = path.resolve(rootDir);
  const home = opts.homeDir ?? os.homedir();
  const p = (...parts: string[]) => path.join(root, '.paradigm', ...parts);
  const g = (...parts: string[]) => path.join(home, '.paradigm', ...parts);
  const ev = (f: string) => p('events', f);

  const stores: LearningStore[] = [
    // Three conceptual stores (D5): ledger = append-only record of what
    // happened (lore, work-log, history, raw journals); knowledge = distilled,
    // retrievable beliefs (decisions, antipatterns, notebooks, protocols,
    // skills); pipeline = the loop's moving parts and its falsifiability
    // instruments (events, nominations, debates, promotion/cert/refs, probes).

    // ── ledger ──
    { id: 'lore', class: 'ledger', path: p('lore'), scope: 'project', owner: '#lore-loader',
      // Entries live under lore/entries/<date>/ as .lore (legacy .yaml); timeline.yaml is an index.
      count: () => countFiles(p('lore', 'entries'), f => f.endsWith('.lore') || isYaml(f), true) },
    { id: 'work-log', class: 'ledger', path: p('work-log'), scope: 'project', owner: '#work-log-loader',
      count: () => countFiles(p('work-log'), isYaml, true) },
    { id: 'history', class: 'ledger', path: p('history', 'log.jsonl'), scope: 'project', owner: '#history-handler',
      count: () => countJsonl(p('history', 'log.jsonl')) },
    { id: 'journals', class: 'ledger', path: g('agents'), scope: 'global', owner: '#journal-loader',
      count: () => countJournals(g('agents')) },

    // ── knowledge ──
    { id: 'decisions', class: 'knowledge', path: p('decisions'), scope: 'project', owner: '#decision-loader',
      count: () => countFiles(p('decisions'), isYaml) },
    { id: 'antipatterns', class: 'knowledge', path: p('wisdom', 'antipatterns.yaml'), scope: 'project', owner: '#wisdom-loader',
      count: () => countYamlListItems(p('wisdom', 'antipatterns.yaml'), 'antipatterns') },
    { id: 'antipatterns-global', class: 'knowledge', path: g('wisdom', 'antipatterns.yaml'), scope: 'global', owner: '#global-store',
      count: () => countYamlListItems(g('wisdom', 'antipatterns.yaml'), 'antipatterns') },
    { id: 'notebooks', class: 'knowledge', path: p('notebooks'), scope: 'project', owner: '#notebook-loader',
      count: () => countFiles(p('notebooks'), isYaml, true) },
    { id: 'notebooks-global', class: 'knowledge', path: g('notebooks'), scope: 'global', owner: '#notebook-loader',
      count: () => countFiles(g('notebooks'), isYaml, true) },
    { id: 'protocols', class: 'knowledge', path: p('protocols'), scope: 'project', owner: '#protocol-loader',
      count: () => countFiles(p('protocols'), f => f.endsWith('.protocol')) },
    { id: 'skills', class: 'knowledge', path: p('skills'), scope: 'project', owner: '#skill-loader',
      count: () => countDirsWith(p('skills'), 'SKILL.md') },
    { id: 'skills-global', class: 'knowledge', path: g('skills'), scope: 'global', owner: '#skill-loader',
      count: () => countDirsWith(g('skills'), 'SKILL.md') },
    { id: 'preferences', class: 'knowledge', path: p('wisdom', 'preferences.yaml'), scope: 'project', owner: '#wisdom-loader',
      count: () => (fs.existsSync(p('wisdom', 'preferences.yaml')) ? 1 : 0) },

    // ── pipeline ──
    { id: 'event-stream', class: 'pipeline', path: ev('stream.jsonl'), scope: 'project', owner: '#event-stream',
      count: () => countJsonl(ev('stream.jsonl')) },
    { id: 'nominations', class: 'pipeline', path: ev('nominations.jsonl'), scope: 'project', owner: '#nomination-engine',
      count: () => countJsonl(ev('nominations.jsonl')) },
    { id: 'debates', class: 'pipeline', path: ev('debates.jsonl'), scope: 'project', owner: '#nomination-engine',
      count: () => countJsonl(ev('debates.jsonl')) },
    { id: 'promotion-decisions', class: 'pipeline', path: ev('promotion-decisions.jsonl'), scope: 'project', owner: '#nomination-engine',
      count: () => countJsonl(ev('promotion-decisions.jsonl')) },
    { id: 'classroom-certifications', class: 'pipeline', path: ev('classroom-certifications.jsonl'), scope: 'project', owner: '#field-failures',
      count: () => countJsonl(ev('classroom-certifications.jsonl')) },
    { id: 'notebook-refs', class: 'pipeline', path: ev('notebook-refs.jsonl'), scope: 'project', owner: '#notebook-loader',
      count: () => countJsonl(ev('notebook-refs.jsonl')) },
    { id: 'settlement-liveness', class: 'pipeline', path: ev('settlement-liveness.jsonl'), scope: 'project', owner: '#task-settlement',
      count: () => countJsonl(ev('settlement-liveness.jsonl')) },
    { id: 'postflight-liveness', class: 'pipeline', path: ev('postflight-liveness.jsonl'), scope: 'project', owner: '#ambient-tools',
      count: () => countJsonl(ev('postflight-liveness.jsonl')) },

    // ── policy (D3: habits are hook policy, not a learning store) ──
    { id: 'habits', class: 'policy', path: p('habits'), scope: 'project', owner: '#habits',
      count: () => countFiles(p('habits'), f => f.endsWith('.habit')) },

    // ── native (read-only, never migrated) ──
    { id: 'claude-memory', class: 'native',
      path: path.join(home, '.claude', 'projects', nativeMemorySlug(root), 'memory'), scope: 'project', owner: 'claude-code',
      count: () => countFiles(path.join(home, '.claude', 'projects', nativeMemorySlug(root), 'memory'), f => f.endsWith('.md')) },
  ];

  return stores;
}

/** Legacy stores the registry knows about only so migration/doctor can report them. */
export function legacyStorePaths(rootDir: string, opts: LearningStoreOptions = {}): {
  projectWisdomDecisions: string;
  globalWisdomDecisions: string;
} {
  const home = opts.homeDir ?? os.homedir();
  return {
    projectWisdomDecisions: path.join(path.resolve(rootDir), '.paradigm', 'wisdom', 'decisions'),
    globalWisdomDecisions: path.join(home, '.paradigm', 'wisdom', 'decisions'),
  };
}
