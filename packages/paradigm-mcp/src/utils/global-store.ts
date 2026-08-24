/**
 * Global Store - Operations on ~/.paradigm/ (the "global brain")
 *
 * Provides:
 * - Session persistence across MCP restarts (breadcrumbs + handoffs)
 * - Cross-project wisdom storage (antipatterns, decisions, preferences)
 *
 * Directory structure:
 *   ~/.paradigm/
 *   ├── sessions/
 *   │   └── {project-hash}/
 *   │       ├── _project-meta.json
 *   │       ├── breadcrumbs.json
 *   │       └── pending-handoffs/
 *   │           └── {handoffId}.json
 *   └── wisdom/
 *       ├── antipatterns.yaml
 *       ├── preferences.yaml
 *       └── decisions/
 *           └── {id}-{slug}.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import type {
  WisdomAntipattern,
  WisdomAntipatterns,
  WisdomDecision,
  WisdomPreferences,
} from '../types/wisdom.js';

// ─── Global directory ────────────────────────────────────────────────

/**
 * Get the global Paradigm directory (~/.paradigm/), creating it if needed.
 */
export function getGlobalDir(): string {
  const dir = path.join(os.homedir(), '.paradigm');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Resolve the project root robustly, so session state (checkpoints, breadcrumbs)
 * hashes to a STABLE bucket regardless of the process's launch cwd.
 *
 * THE BUG THIS FIXES: the MCP server took `process.argv[2] || process.cwd()`, and
 * the plugin manifest passes "." with no pinned cwd — so `resolve(".")` hashed
 * whatever directory Claude Code happened to launch from (often NOT the project).
 * Different launch contexts → different project hash → checkpoints written to and
 * read from mismatched `~/.paradigm/sessions/{hash}/` buckets → recovery misses.
 *
 * Resolution order (first hit wins), all independent of a fragile cwd:
 *   1. an explicit dir hint (argv) that is real and contains `.paradigm/`;
 *   2. $PARADIGM_PROJECT_DIR, then $CLAUDE_PROJECT_DIR (Claude Code sets the latter
 *      in the env of processes it spawns), when they contain `.paradigm/`;
 *   3. walk UP from the hint (or cwd) to the nearest ancestor containing `.paradigm/`;
 *   4. the first explicit candidate even without `.paradigm/` (a named project that
 *      is simply not initialised yet beats a random cwd);
 *   5. cwd — the last-resort fallback (previous behaviour).
 */
export function resolveProjectRoot(hint?: string): string {
  const hasParadigm = (dir: string): boolean => {
    try { return fs.existsSync(path.join(dir, '.paradigm')); } catch { return false; }
  };

  const explicit: string[] = [];
  if (hint && hint !== '.') explicit.push(path.resolve(hint));
  for (const env of [process.env.PARADIGM_PROJECT_DIR, process.env.CLAUDE_PROJECT_DIR]) {
    if (env && env.trim()) explicit.push(path.resolve(env.trim()));
  }

  // (1)+(2): an explicit candidate that is actually a Paradigm project.
  for (const c of explicit) {
    if (hasParadigm(c)) return c;
  }

  // (3): walk up from the hint (or cwd) looking for `.paradigm/`.
  const start = path.resolve(hint && hint !== '.' ? hint : process.cwd());
  let dir = start;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (hasParadigm(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // (4): a named-but-uninitialised project beats a random cwd.
  if (explicit.length) return explicit[0];

  // (5): last resort — previous behaviour.
  return process.cwd();
}

/**
 * Deterministic hash of a project's absolute root path.
 * Returns a 12-char hex string (truncated SHA-256).
 */
export function getProjectHash(rootDir: string): string {
  const absolute = path.resolve(rootDir);
  return crypto.createHash('sha256').update(absolute).digest('hex').slice(0, 12);
}

/**
 * Get the session directory for a project (~/.paradigm/sessions/{hash}/),
 * creating it (and the pending-handoffs/ subdir) if needed.
 */
export function getSessionDir(rootDir: string): string {
  const hash = getProjectHash(rootDir);
  const dir = path.join(getGlobalDir(), 'sessions', hash);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const handoffsDir = path.join(dir, 'pending-handoffs');
  if (!fs.existsSync(handoffsDir)) {
    fs.mkdirSync(handoffsDir, { recursive: true });
  }
  return dir;
}

/**
 * Write _project-meta.json so the hash can be mapped back to a project.
 */
export function writeProjectMeta(rootDir: string): void {
  const sessionDir = getSessionDir(rootDir);
  const metaPath = path.join(sessionDir, '_project-meta.json');
  const projectName = path.basename(path.resolve(rootDir));
  const meta = {
    name: projectName,
    path: path.resolve(rootDir),
    lastSeen: new Date().toISOString(),
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

// ─── Handoffs ────────────────────────────────────────────────────────

export interface PendingHandoff {
  id: string;
  timestamp: string;
  from: string;
  to: string;
  summary: string;
  nextSteps: string[];
  modifiedFiles: string[];
  symbolsTouched: string[];
  openQuestions: string[];
  sessionStats?: Record<string, unknown>;
  status: 'pending' | 'delivered';
}

/**
 * Persist a handoff payload to disk.
 */
export function writePendingHandoff(rootDir: string, handoff: PendingHandoff): void {
  const sessionDir = getSessionDir(rootDir);
  const filePath = path.join(sessionDir, 'pending-handoffs', `${handoff.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(handoff, null, 2));
}

/**
 * Load all pending (not yet delivered) handoff files for a project.
 */
export function loadPendingHandoffs(rootDir: string): PendingHandoff[] {
  const sessionDir = getSessionDir(rootDir);
  const handoffsDir = path.join(sessionDir, 'pending-handoffs');

  if (!fs.existsSync(handoffsDir)) {
    return [];
  }

  const handoffs: PendingHandoff[] = [];
  try {
    const files = fs.readdirSync(handoffsDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = fs.readFileSync(path.join(handoffsDir, file), 'utf8');
        const handoff = JSON.parse(content) as PendingHandoff;
        if (handoff.status === 'pending') {
          handoffs.push(handoff);
        }
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // Directory read failed
  }

  // Sort by timestamp (oldest first)
  handoffs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return handoffs;
}

/**
 * Mark a handoff as delivered (updates the status in-place on disk).
 */
export function markHandoffDelivered(rootDir: string, handoffId: string): void {
  const sessionDir = getSessionDir(rootDir);
  const filePath = path.join(sessionDir, 'pending-handoffs', `${handoffId}.json`);

  if (!fs.existsSync(filePath)) return;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const handoff = JSON.parse(content) as PendingHandoff;
    handoff.status = 'delivered';
    fs.writeFileSync(filePath, JSON.stringify(handoff, null, 2));
  } catch {
    // Silently fail — not critical
  }
}

// ─── Global Wisdom ───────────────────────────────────────────────────

/**
 * Get the global wisdom directory (~/.paradigm/wisdom/), creating if needed.
 */
export function getGlobalWisdomDir(): string {
  const dir = path.join(getGlobalDir(), 'wisdom');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Load global antipatterns from ~/.paradigm/wisdom/antipatterns.yaml
 */
export function loadGlobalAntipatterns(): WisdomAntipattern[] {
  const filePath = path.join(getGlobalWisdomDir(), 'antipatterns.yaml');
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = yaml.load(content) as WisdomAntipatterns;
    return data?.antipatterns || [];
  } catch {
    return [];
  }
}

/**
 * Load global decisions from ~/.paradigm/wisdom/decisions/
 */
export function loadGlobalDecisions(): WisdomDecision[] {
  const decisionsDir = path.join(getGlobalWisdomDir(), 'decisions');
  if (!fs.existsSync(decisionsDir)) return [];

  const decisions: WisdomDecision[] = [];
  try {
    const files = fs.readdirSync(decisionsDir);
    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      try {
        const content = fs.readFileSync(path.join(decisionsDir, file), 'utf8');
        const decision = yaml.load(content) as WisdomDecision;
        decisions.push(decision);
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // Directory read failed
  }

  decisions.sort((a, b) => a.id.localeCompare(b.id));
  return decisions;
}

/**
 * Load global preferences from ~/.paradigm/wisdom/preferences.yaml
 */
export function loadGlobalPreferences(): WisdomPreferences | null {
  const filePath = path.join(getGlobalWisdomDir(), 'preferences.yaml');
  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) as WisdomPreferences;
  } catch {
    return null;
  }
}

/**
 * Record an antipattern to the global store.
 */
export function recordGlobalAntipattern(antipattern: Omit<WisdomAntipattern, 'added'>): void {
  const filePath = path.join(getGlobalWisdomDir(), 'antipatterns.yaml');

  let data: WisdomAntipatterns = { version: '1.0', antipatterns: [] };

  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const loaded = yaml.load(content) as Partial<WisdomAntipatterns> | null | undefined;
      // Empty file → null/undefined; hand-edited file may drop the `antipatterns`
      // key. Normalize (the old `if (!data.antipatterns)` still threw when the
      // whole object was undefined, before the push outside this try).
      if (loaded && typeof loaded === 'object') {
        data = {
          version: loaded.version || '1.0',
          antipatterns: Array.isArray(loaded.antipatterns) ? loaded.antipatterns : [],
        };
      }
    } catch {
      // Start fresh on parse error
    }
  }

  data.antipatterns.push({
    ...antipattern,
    added: new Date().toISOString(),
  });

  fs.writeFileSync(filePath, yaml.dump(data, { lineWidth: -1 }));
}

/**
 * Record a decision to the global store.
 */
export function recordGlobalDecision(decision: WisdomDecision): void {
  const decisionsDir = path.join(getGlobalWisdomDir(), 'decisions');
  if (!fs.existsSync(decisionsDir)) {
    fs.mkdirSync(decisionsDir, { recursive: true });
  }

  const slug = decision.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const fileName = `${decision.id}-${slug}.yaml`;
  const filePath = path.join(decisionsDir, fileName);

  fs.writeFileSync(filePath, yaml.dump(decision, { lineWidth: -1 }));
}
