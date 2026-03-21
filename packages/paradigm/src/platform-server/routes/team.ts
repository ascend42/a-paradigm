/**
 * Team Routes — Maestro team orchestration data for Platform dashboard
 *
 * Reads Symphony mailbox JSONL for orchestration threads and agent profiles
 * for roster display. No separate data files — reads directly from existing
 * Paradigm data stores.
 */

import { Router, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

// ── Types ────────────────────────────────────────────────────────────

interface AgentSummary {
  id: string;
  role: string;
  nickname?: string;
  benched: boolean;
  expertiseCount: number;
  topExpertise: Array<{ symbol: string; confidence: number }>;
  threshold?: number;
}

interface ThreadMessage {
  id: string;
  threadRoot?: string;
  timestamp: string;
  sender: { name: string; role?: string; project?: string };
  intent: string;
  text: string;
  symbols: string[];
  diff?: string;
  decision?: string;
}

interface TeamThread {
  id: string;
  displayName: string;
  messages: ThreadMessage[];
  lastActivity: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, 'utf-8')
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => { try { return JSON.parse(line) as T; } catch { return null; } })
      .filter((v): v is T => v !== null);
  } catch { return []; }
}

function loadAgentProfiles(): AgentSummary[] {
  const globalDir = path.join(os.homedir(), '.paradigm', 'agents');
  const profiles: AgentSummary[] = [];

  if (!fs.existsSync(globalDir)) return profiles;

  for (const file of fs.readdirSync(globalDir).filter(f => f.endsWith('.agent'))) {
    try {
      const content = fs.readFileSync(path.join(globalDir, file), 'utf-8');
      const p = yaml.load(content) as Record<string, any>;
      if (!p?.id) continue;

      const expertise = (p.expertise || []) as Array<{ symbol: string; confidence: number; sessions: number }>;
      expertise.sort((a, b) => b.confidence - a.confidence);

      profiles.push({
        id: p.id,
        role: p.role || p.id,
        nickname: p.nickname,
        benched: p.benched || false,
        expertiseCount: expertise.length,
        topExpertise: expertise.slice(0, 3).map(e => ({
          symbol: e.symbol,
          confidence: parseFloat(e.confidence.toFixed(2)),
        })),
        threshold: p.attention?.threshold,
      });
    } catch { /* skip */ }
  }

  return profiles;
}

function loadTeamThreads(): TeamThread[] {
  const mailDir = path.join(os.homedir(), '.paradigm', 'mail', 'agents');
  if (!fs.existsSync(mailDir)) return [];

  const allMessages: ThreadMessage[] = [];

  // Scan all agent inboxes and outboxes
  try {
    for (const agentDir of fs.readdirSync(mailDir, { withFileTypes: true })) {
      if (!agentDir.isDirectory()) continue;
      const agentPath = path.join(mailDir, agentDir.name);

      for (const file of ['inbox.jsonl', 'outbox.jsonl']) {
        const filePath = path.join(agentPath, file);
        const notes = readJsonl<any>(filePath);
        for (const note of notes) {
          if (!note.threadRoot?.startsWith('thr-orch-')) continue;
          if (allMessages.some(m => m.id === note.id)) continue;

          allMessages.push({
            id: note.id,
            threadRoot: note.threadRoot,
            timestamp: note.timestamp,
            sender: {
              name: note.sender?.name || 'unknown',
              role: note.sender?.role,
              project: note.sender?.project,
            },
            intent: note.intent || 'context',
            text: note.content?.text || '',
            symbols: note.symbols || [],
            diff: note.content?.diff,
            decision: note.content?.decision,
          });
        }
      }
    }
  } catch { /* skip */ }

  // Group by thread
  const threadMap = new Map<string, ThreadMessage[]>();
  for (const msg of allMessages) {
    const threadId = msg.threadRoot!;
    if (!threadMap.has(threadId)) threadMap.set(threadId, []);
    threadMap.get(threadId)!.push(msg);
  }

  // Sort messages within threads and build output
  const threads: TeamThread[] = [];
  for (const [threadId, messages] of threadMap) {
    messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const stripped = threadId.replace('thr-orch-', '');
    const parts = stripped.split('-');
    const displayName = parts[0] ? `Team ${parts[0]}` : threadId;

    threads.push({
      id: threadId,
      displayName,
      messages,
      lastActivity: messages[messages.length - 1]?.timestamp || '',
    });
  }

  // Sort threads by most recent activity
  threads.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return threads;
}

// ── Router ───────────────────────────────────────────────────────────

export function createTeamRouter(projectDir: string): Router {
  const router = Router();

  // GET /roster — agent roster with bench status
  router.get('/roster', (_req: Request, res: Response) => {
    try {
      const agents = loadAgentProfiles();
      const active = agents.filter(a => !a.benched);
      const benched = agents.filter(a => a.benched);
      res.json({ active, benched, total: agents.length });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load roster', detail: String(err) });
    }
  });

  // GET /threads — orchestration team threads
  router.get('/threads', (_req: Request, res: Response) => {
    try {
      const threads = loadTeamThreads();
      res.json({ threads, count: threads.length });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load threads', detail: String(err) });
    }
  });

  // PATCH /agents/:id/bench — toggle bench status
  router.patch('/agents/:id/bench', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { benched } = req.body as { benched: boolean };
      const globalDir = path.join(os.homedir(), '.paradigm', 'agents');
      const filePath = path.join(globalDir, `${id}.agent`);

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: `Agent "${id}" not found` });
        return;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const profile = yaml.load(content) as Record<string, any>;
      profile.benched = benched;
      profile.updated = new Date().toISOString();
      fs.writeFileSync(filePath, yaml.dump(profile, { lineWidth: 120, noRefs: true, sortKeys: false }), 'utf-8');

      res.json({ id, benched, updated: profile.updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update agent', detail: String(err) });
    }
  });

  return router;
}
