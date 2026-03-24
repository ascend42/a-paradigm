/**
 * Session Work Log — captures agent contributions and user verdicts during a session.
 *
 * The session work log is a JSONL file that accumulates entries during a session.
 * Unlike breadcrumbs (recovery-focused, max 50), this captures rich context for
 * Maestro's postflight learning pass: what each agent contributed, what the user
 * accepted/dismissed/revised, and why.
 *
 * Storage: .paradigm/events/session-log.jsonl
 * Bounded: 200 entries per session (cleared on session start)
 */

import * as fs from 'fs';
import * as path from 'path';

const SESSION_LOG_FILE = '.paradigm/events/session-log.jsonl';
const MAX_ENTRIES = 200;

// ── Types ────────────────────────────────────────────────────────────

export interface SessionWorkEntry {
  timestamp: string;
  type: 'agent-contribution' | 'user-verdict' | 'decision';

  // Agent contributions (from orchestration execute mode)
  agent?: string;
  contribution?: string;
  attribution?: string;
  symbols?: string[];

  // User verdicts (from ambient engage)
  nominationId?: string;
  verdict?: 'accepted' | 'dismissed' | 'revised' | 'deferred';
  reason?: string;
  revisionDelta?: string;

  // Decisions
  decisionTitle?: string;
  decisionRationale?: string;
}

// ── Append ───────────────────────────────────────────────────────────

/**
 * Append an entry to the session work log.
 * Non-fatal — failure is silently ignored.
 */
export function appendSessionWorkEntry(rootDir: string, entry: SessionWorkEntry): void {
  try {
    const filePath = path.join(rootDir, SESSION_LOG_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Check entry count for bounding
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lineCount = content.trim().split('\n').filter(l => l.trim()).length;
      if (lineCount >= MAX_ENTRIES) return; // Bounded
    }

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');

    // Auto-adjust expertise based on verdicts (fire-and-forget)
    if (entry.type === 'user-verdict' && entry.agent && entry.symbols?.length) {
      import('./agent-loader.js').then(({ loadAgentProfile, saveAgentProfile }) => {
        try {
          const profile = loadAgentProfile(rootDir, entry.agent!);
          if (profile?.expertise) {
            const delta = entry.verdict === 'accepted' ? 0.03
              : entry.verdict === 'dismissed' ? -0.02
              : entry.verdict === 'revised' ? -0.01
              : 0;

            if (delta !== 0) {
              for (const symbol of entry.symbols!) {
                const exp = profile.expertise!.find(e => e.symbol === symbol);
                if (exp) {
                  exp.confidence = Math.max(0, Math.min(1, exp.confidence + delta));
                  exp.sessions = (exp.sessions || 0) + 1;
                  exp.lastTouch = new Date().toISOString();
                }
              }
              saveAgentProfile(entry.agent!, profile, 'global');
            }
          }
        } catch { /* non-fatal */ }
      }).catch(() => { /* non-fatal */ });
    }
  } catch {
    // Non-fatal — work log is advisory
  }
}

// ── Read ─────────────────────────────────────────────────────────────

/**
 * Read all entries from the current session log.
 */
export function readSessionWorkLog(rootDir: string): SessionWorkEntry[] {
  try {
    const filePath = path.join(rootDir, SESSION_LOG_FILE);
    if (!fs.existsSync(filePath)) return [];

    return fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as SessionWorkEntry; }
        catch { return null; }
      })
      .filter((e): e is SessionWorkEntry => e !== null);
  } catch {
    return [];
  }
}

// ── Clear ────────────────────────────────────────────────────────────

/**
 * Clear the session work log. Called at session start.
 */
export function clearSessionWorkLog(rootDir: string): void {
  try {
    const filePath = path.join(rootDir, SESSION_LOG_FILE);
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch {
    // Non-fatal
  }
}

// ── Queries ──────────────────────────────────────────────────────────

/**
 * Get unique agent IDs that contributed this session.
 */
export function getContributingAgents(rootDir: string): string[] {
  const entries = readSessionWorkLog(rootDir);
  const agents = new Set<string>();
  for (const entry of entries) {
    if (entry.agent) agents.add(entry.agent);
  }
  return Array.from(agents);
}

/**
 * Get all entries for a specific agent (contributions + verdicts).
 */
export function getAgentEntries(rootDir: string, agentId: string): SessionWorkEntry[] {
  return readSessionWorkLog(rootDir).filter(e => e.agent === agentId);
}

/**
 * Get contribution-verdict pairs for an agent.
 * Matches contributions to subsequent verdicts by agent name.
 */
export function getAgentVerdicts(rootDir: string, agentId: string): Array<{
  contribution?: SessionWorkEntry;
  verdict?: SessionWorkEntry;
}> {
  const entries = getAgentEntries(rootDir, agentId);
  const contributions = entries.filter(e => e.type === 'agent-contribution');
  const verdicts = entries.filter(e => e.type === 'user-verdict');

  // Pair contributions with verdicts (simple sequential matching)
  const pairs: Array<{ contribution?: SessionWorkEntry; verdict?: SessionWorkEntry }> = [];

  for (const contrib of contributions) {
    pairs.push({ contribution: contrib });
  }
  for (const verdict of verdicts) {
    // Try to match to an unpaired contribution
    const unpaired = pairs.find(p => !p.verdict && p.contribution);
    if (unpaired) {
      unpaired.verdict = verdict;
    } else {
      pairs.push({ verdict });
    }
  }

  return pairs;
}
