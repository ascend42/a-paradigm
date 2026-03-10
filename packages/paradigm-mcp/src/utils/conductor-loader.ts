/**
 * Conductor Loader — Manages ~/.conductor/sessions/ registration files
 *
 * When a Claude Code session calls paradigm_conductor_register, a JSON file
 * is written to ~/.conductor/sessions/{pid}.json. The Conductor macOS app
 * watches this directory and picks up sessions instantly.
 *
 * Storage layout:
 *   ~/.conductor/
 *     sessions/
 *       12345.json   — one file per registered session (keyed by PID)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONDUCTOR_DIR = path.join(os.homedir(), '.conductor');
const SESSIONS_DIR = path.join(CONDUCTOR_DIR, 'sessions');

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export interface ConductorSession {
  /** PID of the Claude Code process (or its parent shell) */
  pid: number;
  /** PID of the parent process (terminal app) */
  parentPid?: number;
  /** Absolute path to the project directory */
  projectDir: string;
  /** Terminal application bundle ID (e.g., "com.mitchellh.ghostty") */
  terminal?: string;
  /** Human-readable label for the session */
  label?: string;
  /** Branch name if available */
  branch?: string;
  /** ISO timestamp when the session was registered */
  registeredAt: string;
}

// ────────────────────────────────────────────────────────
// Directory Setup
// ────────────────────────────────────────────────────────

function ensureSessionsDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

// ────────────────────────────────────────────────────────
// Register / Unregister
// ────────────────────────────────────────────────────────

/**
 * Register a Claude Code session with Conductor.
 * Writes a JSON file to ~/.conductor/sessions/{pid}.json.
 */
export function registerConductorSession(session: Omit<ConductorSession, 'registeredAt'>): ConductorSession {
  ensureSessionsDir();

  const entry: ConductorSession = {
    ...session,
    registeredAt: new Date().toISOString(),
  };

  const filePath = path.join(SESSIONS_DIR, `${session.pid}.json`);
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');

  return entry;
}

/**
 * Unregister a Claude Code session from Conductor.
 * Removes the JSON file from ~/.conductor/sessions/{pid}.json.
 */
export function unregisterConductorSession(pid: number): boolean {
  const filePath = path.join(SESSIONS_DIR, `${pid}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * List all currently registered Conductor sessions.
 */
export function listConductorSessions(): ConductorSession[] {
  ensureSessionsDir();

  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  const sessions: ConductorSession[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8');
      const session = JSON.parse(content) as ConductorSession;
      sessions.push(session);
    } catch {
      // Skip corrupted files
    }
  }

  return sessions;
}

/**
 * Clean up stale sessions where the PID no longer exists.
 */
export function cleanStaleSessions(): number {
  const sessions = listConductorSessions();
  let cleaned = 0;

  for (const session of sessions) {
    if (!isProcessAlive(session.pid)) {
      unregisterConductorSession(session.pid);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Check if a process is still running.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check existence
    return true;
  } catch {
    return false;
  }
}
